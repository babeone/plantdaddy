import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { clientIp } from '$lib/server/rate-limit';
import { adminEnabled, adminIpAllowed, adminUrl } from './config';
import { readAdminSession, type AdminSession } from './session';

/**
 * Prima linea di difesa: il pannello esiste o no.
 *
 * Da chiamare come PRIMA istruzione di ogni load e di ogni handler dell'area
 * admin, prima di leggere qualunque cosa dal database. Se il pannello non è
 * configurato, o l'IP non è in allowlist, la risposta è 404 — indistinguibile da
 * una rotta che non esiste. Un 403 direbbe "c'è, ma non per te", che è
 * esattamente l'informazione da non regalare.
 */
export function requireAdminArea(event: RequestEvent): void {
	if (!adminEnabled()) error(404, 'Non trovato');
	if (!adminIpAllowed(clientIp(event))) error(404, 'Non trovato');
}

/**
 * Header delle risposte del pannello.
 *
 * no-store: le pagine contengono dati di altri utenti e non devono restare nella
 * cache del browser né in quella di un proxy. noindex: se qualcuno arriva al
 * percorso, almeno non finisce indicizzato. no-referrer: seguendo un link
 * esterno il percorso del pannello non viene comunicato al sito di destinazione.
 */
export function adminHeaders(headers: Headers): void {
	headers.set('cache-control', 'no-store, no-cache, must-revalidate');
	headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
	headers.set('referrer-policy', 'no-referrer');
}

/**
 * Seconda linea: sessione completa di secondo fattore.
 *
 * Chi ha superato solo la password (mfa_done = false) viene rimandato al
 * secondo fattore, non fatto entrare a metà. Chi non ha nessuna sessione torna
 * al login. Nessuna pagina con dati chiama qualcosa di diverso da questa.
 */
export async function requireAdmin(event: RequestEvent): Promise<AdminSession> {
	requireAdminArea(event);

	const session = await readAdminSession(event.cookies);
	if (!session) redirect(303, adminUrl());
	if (!session.mfa_done) redirect(303, adminUrl('/2fa'));

	return session;
}
