import type { Handle, HandleServerError, RequestEvent } from '@sveltejs/kit';
import { ADMIN_INTERNAL_BASE } from '$lib/admin-path';
import { hashToken } from '$lib/server/auth';
import { adminHeaders } from '$lib/server/admin/guard';
import { avvia, push } from '$lib/server/metrics/buffer';
import {
	alwaysAboveMs,
	metricsEnabled,
	routeEsclusa,
	sampleRate
} from '$lib/server/metrics/config';

// Il flush periodico e il flush allo SIGTERM si registrano una volta, all'import
// del modulo degli hook: è il punto che SvelteKit carica per primo e una volta sola.
avvia();

/**
 * Registrazione di una richiesta nel buffer delle metriche.
 *
 * FIRE AND FORGET, letteralmente: questa funzione non è `await`-ata e non fa I/O.
 * Mette un oggetto in un array e torna. La scrittura sul database la fa il flusher
 * in batch, quindi la response al client non aspetta niente — è il requisito per
 * cui l'overhead resta sotto il millisecondo.
 *
 * ORDINE DEI CONTROLLI, dal più economico al più costoso: interruttore generale,
 * esclusione per rotta, poi il campionamento. Con METRICS_ENABLED=false si esce
 * alla prima riga e non si valuta nient'altro.
 */
function registraRichiesta(event: RequestEvent, status: number, durata: number): void {
	if (!metricsEnabled()) return;

	const route = event.route.id;
	if (routeEsclusa(route)) return;

	const ms = Math.round(durata);

	/*
	 * IL CAMPIONAMENTO NON TOCCA 5xx E RICHIESTE LENTE.
	 *
	 * Sono gli unici dati per cui questa dashboard esiste. Campionare al 10% un
	 * errore che accade tre volte al giorno significa vederlo una volta ogni tre
	 * giorni, cioè non vederlo. Il volume non è un problema: per definizione questi
	 * eventi sono rari, e se diventassero frequenti sarebbe proprio il momento di
	 * averli tutti.
	 */
	const sempre = status >= 500 || ms >= alwaysAboveMs();
	if (!sempre) {
		const rate = sampleRate();
		if (rate <= 0) return;
		if (rate < 1 && Math.random() >= rate) return;
	}

	push({
		route: route as string,
		method: event.request.method,
		status,
		duration_ms: ms,
		// Solo un booleano: chi è l'utente non entra in questa tabella.
		authed: event.locals.userTokenHash !== null
	});
}

/**
 * Risoluzione della sessione.
 *
 * IL COOKIE NON AUTENTICA MAI.
 * In Fase 5 il token verrà scritto anche in un cookie, ma solo come storage di
 * backup che il JavaScript del client rilegge. Il server autentica
 * ESCLUSIVAMENTE dall'header X-Session-Token e non deve leggere quel cookie da
 * nessun handler.
 *
 * Motivo: oggi l'app è immune a CSRF proprio perché un sito terzo non può
 * impostare un header custom su una richiesta cross-origin senza superare il
 * preflight CORS, che qui non è configurato e quindi fallisce. Se il server
 * accettasse il cookie, il browser lo allegherebbe da solo a ogni richiesta
 * partita da un sito esterno e ogni endpoint diventerebbe attaccabile,
 * incluso POST /api/import?mode=replace che è distruttivo.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const token = event.request.headers.get('x-session-token')?.trim();
	event.locals.userTokenHash = token ? hashToken(token) : null;

	// Fuori dall'if: due letture di performance.now() costano nanosecondi, e
	// metterla dentro un ramo condizionale significherebbe non poter misurare la
	// richiesta se il flag cambia a metà.
	const inizio = performance.now();

	const response = await resolve(event);

	registraRichiesta(event, response.status, performance.now() - inizio);

	// Header del pannello applicati QUI e non nei singoli load: così coprono
	// anche le POST delle form action, i redirect e l'immagine del QR, cioè
	// proprio le risposte che sarebbe più facile dimenticare.
	//
	// Non sui 404: quando il pannello è spento, o l'IP non è in allowlist,
	// requireAdminArea risponde 404 proprio per non confermare che il pannello
	// esista. Aggiungerci sopra cache-control, x-robots-tag e referrer-policy lo
	// confermerebbe lo stesso, perché un 404 qualunque non li ha.
	if (event.route.id?.startsWith(ADMIN_INTERNAL_BASE) && response.status !== 404) {
		adminHeaders(response.headers);
	}

	return response;
};

/** Header il cui valore non deve finire in un log per nessun motivo. */
const SENSITIVE_HEADERS = new Set(['x-session-token', 'cookie', 'authorization']);

function scrubbedHeaders(headers: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of headers) {
		out[key] = SENSITIVE_HEADERS.has(key) ? '[rimosso]' : value;
	}
	return out;
}

/**
 * SCRUBBING DEI LOG.
 * Un token in un log è una credenziale permanente in chiaro: X-Session-Token e
 * i cookie vengono sostituiti prima di stampare qualsiasi cosa.
 *
 * PROMEMORIA: se in futuro si aggiunge Sentry (o qualunque error tracker), va
 * configurato esplicitamente per NON catturare gli header, perché per default
 * li invia tutti. Serve un beforeSend che applichi la stessa rimozione.
 *
 * Il messaggio restituito al client resta generico: i dettagli stanno nel log
 * del server, non nella response.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	if (status !== 404) {
		console.error(
			`[${status}] ${event.request.method} ${event.url.pathname}`,
			JSON.stringify({ headers: scrubbedHeaders(event.request.headers) }),
			error
		);
	}
	return { message: status === 404 ? 'Non trovato' : message };
};
