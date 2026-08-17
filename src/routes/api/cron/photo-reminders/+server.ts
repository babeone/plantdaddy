import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import webpush, { WebPushError } from 'web-push';
import { sql } from '$lib/server/db';
import { currentHour } from '$lib/server/date';
import { secretMatches } from '$lib/server/notify';
import { registraRun } from '$lib/server/metrics/jobs';
import {
	LOCK_PROMEMORIA_FOTO,
	candidatiFoto,
	oraCivile,
	segnaInviati,
	testoPromemoria,
	type CandidatoFoto
} from '$lib/server/photos/reminders';

/**
 * Promemoria trimestrale per la foto del diario.
 *
 * Va chiamato dal cron di Dokploy UNA VOLTA AL GIORNO — non serve precisione al
 * secondo per un avviso trimestrale. Gira comunque a ogni ora utile perché
 * notify_hour è per utente: lo schedule consigliato è ogni ora, e la query serve
 * solo gli utenti la cui ora coincide.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/photo-reminders
 */

/** Destinatari per esecuzione. Oltre, si riprende al giro dopo. */
const MAX_UTENTI = 50;
/** Push inviate insieme. Cinque per volta, non tutte in parallelo. */
const CONCORRENZA = 5;

export const GET: RequestHandler = async ({ request, url }) => {
	const inizioRun = Date.now();
	/*
	 * AUTORIZZAZIONE PRIMA DI QUALSIASI QUERY, come in /api/cron/notify. Senza
	 * questo ordine una riga di curl senza credenziali farebbe valutare
	 * gallery_slots() su tutte le piante del database: l'endpoint sarebbe un
	 * amplificatore, gratis per chi attacca e costoso per Postgres.
	 */
	const expected = env.CRON_SECRET;
	if (!expected) error(503, 'CRON_SECRET non configurato');
	const header = request.headers.get('authorization');
	const provided = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
	if (!secretMatches(provided, expected)) error(401, 'Non autorizzato');

	const vapidPublicKey = publicEnv.PUBLIC_VAPID_PUBLIC_KEY;
	if (!env.VAPID_PRIVATE_KEY || !vapidPublicKey || !env.VAPID_SUBJECT) {
		error(503, 'Chiavi VAPID non configurate');
	}
	webpush.setVapidDetails(env.VAPID_SUBJECT, vapidPublicKey, env.VAPID_PRIVATE_KEY);

	const hourParam = url.searchParams.get('hour');
	const hour =
		hourParam === null
			? oraCivile(currentHour())
			: Math.min(23, Math.max(0, Number.parseInt(hourParam, 10) || 0));

	// Lock legato alla transazione: se il processo muore a metà si rilascia da
	// solo, mentre un flag su tabella lascerebbe il job bloccato per sempre.
	const esito = await sql.begin(async (tx) => {
		const [{ locked }] = await tx<{ locked: boolean }[]>`
			select pg_try_advisory_xact_lock(${LOCK_PROMEMORIA_FOTO}) as locked
		`;
		if (!locked) return null;

		const candidati = await candidatiFoto(hour, MAX_UTENTI * 4);

		// Raggruppa per utente: UNA notifica a persona anche se cinque piante
		// maturano lo stesso giorno — che con piante aggiunte nello stesso periodo
		// è la norma, non l'eccezione.
		const perUtente = new Map<string, CandidatoFoto[]>();
		for (const c of candidati) {
			const lista = perUtente.get(c.user_token_hash) ?? [];
			lista.push(c);
			perUtente.set(c.user_token_hash, lista);
		}

		const utenti = [...perUtente.entries()].slice(0, MAX_UTENTI);
		return { utenti, trovati: candidati.length, rimandati: perUtente.size - utenti.length };
	});

	if (!esito) {
		// Un'altra esecuzione è in corso: non è un errore, è il lock che funziona.
		return json({ hour, skipped: 'un’altra esecuzione è già in corso' });
	}

	let inviate = 0;
	let fallite = 0;
	let rimosse = 0;
	let notificati = 0;
	let senzaSubscription = 0;

	for (const [tokenHash, piante] of esito.utenti) {
		const subscriptions = await sql<
			{ id: string; endpoint: string; p256dh: string; auth: string }[]
		>`
			select id, endpoint, p256dh, auth
			from push_subscriptions
			where user_token_hash = ${tokenHash}
		`;

		if (subscriptions.length === 0) {
			// Promemoria acceso ma nessun dispositivo iscritto: si degrada in
			// silenzio. NON si registra l'invio, così quando l'utente attiverà le
			// notifiche il promemoria lo troverà ancora ad aspettarlo.
			senzaSubscription += 1;
			continue;
		}

		const testo = testoPromemoria(piante);
		const payload = JSON.stringify({
			title: testo.title,
			body: testo.body,
			// DEEP LINK: con una pianta sola si va direttamente al suo dettaglio,
			// dove c'è il diario. Con più piante all'elenco, perché non esiste una
			// pianta "giusta" verso cui puntare.
			url: piante.length === 1 ? `/piante/${piante[0].plant_id}` : '/piante',
			tag: 'plantdaddy-foto',
			actions: []
		});

		notificati += 1;

		// A blocchi di CONCORRENZA: cinque per volta, mai tutte in parallelo.
		for (let i = 0; i < subscriptions.length; i += CONCORRENZA) {
			const blocco = subscriptions.slice(i, i + CONCORRENZA);
			await Promise.all(
				blocco.map(async (s) => {
					try {
						await webpush.sendNotification(
							{ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
							payload,
							{ TTL: 24 * 60 * 60, urgency: 'low' }
						);
						inviate += 1;
					} catch (err) {
						fallite += 1;
						const status = err instanceof WebPushError ? err.statusCode : 0;
						// 404 e 410: quella subscription non esiste più. Tenerla vorrebbe
						// dire ritentarla a ogni run, per sempre.
						if (status === 404 || status === 410) {
							await sql`delete from push_subscriptions where id = ${s.id}`;
							rimosse += 1;
						} else {
							console.error(`[foto] push fallita (${status || 'errore di rete'})`);
						}
					}
				})
			);
		}

		await segnaInviati(
			tokenHash,
			piante.map((p) => ({ plant_id: p.plant_id, slot: p.slot }))
		);
	}

	const esitoLog = {
		hour,
		candidati: esito.trovati,
		utenti_notificati: notificati,
		utenti_senza_subscription: senzaSubscription,
		utenti_rimandati: esito.rimandati,
		push_inviate: inviate,
		push_fallite: fallite,
		subscription_rimosse: rimosse
	};
	console.log('[cron/photo-reminders]', JSON.stringify(esitoLog));
	// Traccia in job_runs: la dashboard risponde a "il cron gira davvero?" con un
	// dato, non con un indizio. Non fa fallire il job se la scrittura non riesce.
	await registraRun('photo-reminders', inizioRun, { ok: true, detail: esitoLog });
	return json(esitoLog);
};
