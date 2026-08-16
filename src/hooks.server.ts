import type { Handle, HandleServerError } from '@sveltejs/kit';
import { ADMIN_INTERNAL_BASE } from '$lib/admin-path';
import { hashToken } from '$lib/server/auth';
import { adminHeaders } from '$lib/server/admin/guard';

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

	const response = await resolve(event);

	// Header del pannello applicati QUI e non nei singoli load: così coprono
	// anche le POST delle form action, i redirect e l'immagine del QR, cioè
	// proprio le risposte che sarebbe più facile dimenticare.
	if (event.route.id?.startsWith(ADMIN_INTERNAL_BASE)) adminHeaders(response.headers);

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
