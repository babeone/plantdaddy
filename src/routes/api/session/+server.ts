import { error, json, type RequestHandler } from '@sveltejs/kit';
import { hashToken, newSessionToken } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { clientIp, rateLimit } from '$lib/server/rate-limit';
import { parseBody, sessionCreateSchema } from '$lib/server/schemas';

const MAX_SESSIONS_PER_HOUR = 5;
const ONE_HOUR = 60 * 60 * 1000;

/**
 * Crea una nuova sessione. Il token in chiaro viene restituito UNA SOLA VOLTA,
 * qui: nel database resta solo il suo SHA-256, quindi non è recuperabile dopo.
 *
 * Il nome è obbligatorio, e la validazione viene PRIMA di generare il token: un
 * body senza nome non deve lasciare dietro di sé una riga in users con un
 * display_name vuoto e un token che nessuno ha mai ricevuto.
 *
 * Il rate limit però resta la primissima cosa: contare i tentativi solo dopo
 * aver letto e validato il corpo darebbe a chi martella l'endpoint un po' di
 * lavoro gratis a ogni richiesta.
 */
export const POST: RequestHandler = async (event) => {
	const ip = clientIp(event);
	if (!rateLimit(`session:${ip}`, MAX_SESSIONS_PER_HOUR, ONE_HOUR)) {
		error(429, 'Troppe sessioni create da questo indirizzo, riprova più tardi');
	}

	const body = await parseBody(event.request, sessionCreateSchema);

	const token = newSessionToken();
	await sql`
		insert into users (token_hash, display_name)
		values (${hashToken(token)}, ${body.display_name})
	`;

	return json({ token }, { status: 201, headers: { 'cache-control': 'no-store' } });
};
