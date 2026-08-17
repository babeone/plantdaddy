import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
// $env/dynamic/private ESCLUDE le variabili con prefisso PUBLIC_: la chiave
// pubblica VAPID va letta da $env/dynamic/public anche qui sul server.
import { env as publicEnv } from '$env/dynamic/public';
import webpush, { WebPushError } from 'web-push';
import { sql } from '$lib/server/db';
import { currentHour } from '$lib/server/date';
import {
	buildSummary,
	createActionToken,
	findDuePlants,
	purgeExpiredActionTokens,
	secretMatches,
	type DuePlant
} from '$lib/server/notify';
import { registraRun } from '$lib/server/metrics/jobs';

/**
 * Invio del riepilogo giornaliero. Va chiamato dal cron di Dokploy ogni ora:
 * ogni utente riceve la notifica nell'ora che ha scelto in notify_hour.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/notify
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const inizioRun = Date.now();
	/*
	 * L'AUTORIZZAZIONE VIENE PRIMA DI QUALSIASI QUERY.
	 * Se si controllasse dopo, una richiesta HTTP banale e senza credenziali
	 * scatenerebbe la scansione di plant_status per l'intero database: l'endpoint
	 * diventerebbe un amplificatore di denial of service, dove il costo per chi
	 * attacca è una riga di curl e il costo per me è il carico su Postgres.
	 */
	const expected = env.CRON_SECRET;
	if (!expected) error(503, 'CRON_SECRET non configurato');

	const header = request.headers.get('authorization');
	const provided = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
	// Confronto a tempo costante: con === la differenza di tempo fra un segreto
	// sbagliato al primo carattere e uno sbagliato all'ultimo è misurabile.
	if (!secretMatches(provided, expected)) error(401, 'Non autorizzato');

	const vapidPublicKey = publicEnv.PUBLIC_VAPID_PUBLIC_KEY;
	if (!env.VAPID_PRIVATE_KEY || !vapidPublicKey || !env.VAPID_SUBJECT) {
		error(503, 'Chiavi VAPID non configurate');
	}
	webpush.setVapidDetails(env.VAPID_SUBJECT, vapidPublicKey, env.VAPID_PRIVATE_KEY);

	// L'ora si può forzare per provare l'invio a mano; resta dietro il segreto.
	// Senza parametro si usa l'ora nel fuso dell'app (APP_TIMEZONE) e non quella
	// del container, che gira in UTC: notify_hour è l'orologio dell'utente.
	const hourParam = url.searchParams.get('hour');
	const hour =
		hourParam === null
			? currentHour()
			: Math.min(23, Math.max(0, Number.parseInt(hourParam, 10) || 0));

	const duePlants = await findDuePlants(hour);

	// Raggruppa per utente: UNA notifica per persona, non una per pianta.
	const byUser = new Map<string, DuePlant[]>();
	for (const plant of duePlants) {
		const list = byUser.get(plant.user_token_hash) ?? [];
		list.push(plant);
		byUser.set(plant.user_token_hash, list);
	}

	let sent = 0;
	let failed = 0;
	let removed = 0;
	let notified = 0;

	for (const [tokenHash, plants] of byUser) {
		const subscriptions = await sql<
			{ id: string; endpoint: string; p256dh: string; auth: string }[]
		>`
			select id, endpoint, p256dh, auth
			from push_subscriptions
			where user_token_hash = ${tokenHash}
		`;
		if (subscriptions.length === 0) continue;

		const summary = buildSummary(plants);

		// Le azioni rapide hanno senso solo con UNA pianta da curare: con tre
		// piante "Annaffiata" non saprebbe quale annaffiare.
		const actions =
			plants.length === 1
				? [
						{
							action: 'water',
							title: 'Annaffiata',
							token: await createActionToken(plants[0].id, 'water')
						},
						{
							action: 'snooze',
							title: 'Rimanda',
							token: await createActionToken(plants[0].id, 'snooze')
						}
					]
				: [];

		const payload = JSON.stringify({
			title: summary.title,
			body: summary.body,
			url: '/',
			tag: 'plantdaddy-daily',
			actions
		});

		notified += 1;

		for (const subscription of subscriptions) {
			try {
				await webpush.sendNotification(
					{
						endpoint: subscription.endpoint,
						keys: { p256dh: subscription.p256dh, auth: subscription.auth }
					},
					payload,
					{ TTL: 6 * 60 * 60, urgency: 'normal' }
				);
				sent += 1;
			} catch (err) {
				failed += 1;
				// 404 e 410 significano che quella subscription non esiste più:
				// tenerla in tabella vorrebbe dire ritentare per sempre.
				const status = err instanceof WebPushError ? err.statusCode : 0;
				if (status === 404 || status === 410) {
					await sql`delete from push_subscriptions where id = ${subscription.id}`;
					removed += 1;
				} else {
					console.error(`push fallita (${status || 'errore di rete'})`);
				}
			}
		}
	}

	const purged = await purgeExpiredActionTokens();

	const esito = {
		hour,
		users_with_due_plants: byUser.size,
		notified,
		sent,
		failed,
		subscriptions_removed: removed,
		action_tokens_purged: purged
	};
	// Traccia in job_runs: senza, "il cron delle notifiche sta girando?" era una
	// domanda a cui il pannello poteva rispondere solo per indizi.
	await registraRun('notify', inizioRun, { ok: true, detail: esito });
	return json(esito);
};
