import { error, json, type RequestHandler } from '@sveltejs/kit';
import { hashToken, newSessionToken } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { clientIp, rateLimit } from '$lib/server/rate-limit';

const MAX_SESSIONS_PER_HOUR = 5;
const ONE_HOUR = 60 * 60 * 1000;

/**
 * Crea una nuova sessione. Il token in chiaro viene restituito UNA SOLA VOLTA,
 * qui: nel database resta solo il suo SHA-256, quindi non è recuperabile dopo.
 */
export const POST: RequestHandler = async (event) => {
	const ip = clientIp(event);
	if (!rateLimit(`session:${ip}`, MAX_SESSIONS_PER_HOUR, ONE_HOUR)) {
		error(429, 'Troppe sessioni create da questo indirizzo, riprova più tardi');
	}

	const token = newSessionToken();
	await sql`insert into users (token_hash) values (${hashToken(token)})`;

	return json({ token }, { status: 201, headers: { 'cache-control': 'no-store' } });
};
