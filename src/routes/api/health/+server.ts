import { json, type RequestHandler } from '@sveltejs/kit';
import { sql } from '$lib/server/db';

/**
 * Healthcheck per Docker e Traefik. Nessuna autenticazione, e per questo
 * risponde SOLO { ok: true }: niente versione dell'app, niente stringa di
 * connessione, niente messaggio d'errore di Postgres. In caso di fallimento
 * 503 con corpo vuoto, così un probe pubblico non diventa una fonte di
 * informazioni sull'infrastruttura.
 */
const CACHE_MS = 5000;

let cachedAt = 0;
let cachedOk = false;

export const GET: RequestHandler = async () => {
	const now = Date.now();

	// Senza cache ogni probe (Docker ogni 10-30s, più Traefik) sarebbe una query.
	if (now - cachedAt >= CACHE_MS) {
		try {
			await sql`select 1`;
			cachedOk = true;
		} catch {
			cachedOk = false;
		}
		cachedAt = now;
	}

	if (!cachedOk) {
		// json()/error() scriverebbero un corpo: qui serve vuoto per davvero.
		return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
	}

	return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
};
