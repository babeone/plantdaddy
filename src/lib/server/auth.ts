import { createHash, randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { sql } from './db';

/**
 * Il token di sessione è un UUID v4 generato SOLO da crypto.randomUUID():
 * CSPRNG del sistema, nessuna libreria di terze parti, mai Math.random().
 */
export function newSessionToken(): string {
	return randomUUID();
}

/**
 * Nel database finisce solo questo hash, mai il token in chiaro.
 * SHA-256 senza sale è la scelta giusta qui: un UUID v4 ha 122 bit di entropia
 * e non è attaccabile per forza bruta né con rainbow table, quindi bcrypt o
 * argon2 aggiungerebbero solo latenza a ogni richiesta.
 */
export function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Autenticazione: l'hash arriva da hooks.server.ts (header X-Session-Token) e
 * qui si verifica che la sessione esista davvero. Restituisce l'hash da usare
 * come filtro in tutte le query: è la chiave di ogni controllo di proprietà.
 */
export async function requireUser(locals: App.Locals): Promise<string> {
	const tokenHash = locals.userTokenHash;
	if (!tokenHash) error(401, 'Header X-Session-Token mancante');

	const rows = await sql`select 1 from users where token_hash = ${tokenHash}`;
	if (rows.length === 0) error(401, 'Sessione non valida');

	return tokenHash;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un id non-UUID farebbe fallire Postgres con un errore di sintassi (22P02) e
 * quindi un 500: qui diventa un 404, che è anche la risposta corretta perché
 * non rivela nulla su cosa esiste.
 */
export function requireUuid(
	value: string | undefined,
	notFoundMessage = 'Risorsa non trovata'
): string {
	if (!value || !UUID_RE.test(value)) error(404, notFoundMessage);
	return value;
}
