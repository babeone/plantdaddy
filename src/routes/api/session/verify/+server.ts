import { json, type RequestHandler } from '@sveltejs/kit';
import { hashToken } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { parseBody, sessionTokenSchema } from '$lib/server/schemas';

/**
 * Verifica che un token esista, per la schermata di ripristino.
 *
 * Il token arriva nel BODY (oppure nell'header X-Session-Token, se il client
 * preferisce), MAI nel path o in query string: una URL finisce nei log di
 * Traefik, nella cronologia del browser e nell'header Referer verso risorse
 * esterne, e il token diventerebbe una credenziale in chiaro sparsa in giro.
 *
 * Risponde sempre 200 con { valid }: un 404 direbbe la stessa cosa ma
 * incoraggerebbe a trattare l'esito come errore di rete.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	let tokenHash = locals.userTokenHash;

	if (!tokenHash) {
		const body = await parseBody(request, sessionTokenSchema);
		tokenHash = hashToken(body.token);
	}

	const rows = await sql`select 1 from users where token_hash = ${tokenHash}`;

	return json({ valid: rows.length > 0 }, { headers: { 'cache-control': 'no-store' } });
};
