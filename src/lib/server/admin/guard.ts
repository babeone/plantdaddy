import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { clientIp } from '$lib/server/rate-limit';
import { adminEnabled, adminIpAllowed, adminUrl } from './config';
import { readAdminSession, type AdminSession } from './session';

/**
 * Prima linea di difesa: il pannello esiste o no.
 *
 * Da chiamare come PRIMA istruzione di ogni load e di ogni handler dell'area
 * admin, prima di leggere qualunque cosa dal database. Se il pannello non è
 * configurato, o l'IP non è in allowlist, la risposta è 404. Un 403 direbbe
 * "c'è, ma non per te", che è l'informazione da non regalare, e soprattutto
 * inviterebbe a insistere.
 *
 * LIMITE MISURATO, da non raccontarsi diversamente: quel 404 NON è identico a
 * quello di un indirizzo qualunque. SvelteKit ha già risolto la rotta interna
 * quando questa funzione lancia, quindi nella pagina d'errore restano i <link>
 * dei CSS del pannello: 1796 byte contro 1492. Gli header in più li abbiamo
 * tolti (vedi src/hooks.server.ts), la differenza di corpo no — richiederebbe
 * di non instradare affatto, e reroute() è universale e non può leggere
 * ADMIN_ENABLED.
 *
 * Non è un buco: il percorso del pannello è pubblico per costruzione, sta nel
 * bundle servito al browser (vedi $lib/admin-path). Chi vuole saperlo lo legge
 * da lì, non da un content-length. Quello che protegge davvero l'area sono
 * scrypt, il TOTP obbligatorio, l'allowlist IP e la sola lettura.
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
 * percorso, almeno non finisce indicizzato.
 *
 * NON usare `no-referrer` qui, per quanto sembri la scelta più prudente.
 *
 * La regola di Fetch che compone l'header `Origin` dice che per una richiesta
 * di NAVIGAZIONE con metodo diverso da GET/HEAD — cioè esattamente l'invio di
 * una form — se la referrer policy è `no-referrer` allora `Origin` viene
 * serializzato come la stringa `null`. Il browser lo fa anche quando la form
 * punta alla stessa origine da cui è stata servita.
 *
 * Conseguenza vista in produzione: il login rispondeva
 * "Cross-site POST form submissions are forbidden", perché il controllo CSRF di
 * SvelteKit confronta `Origin` con l'origine della richiesta e si trovava
 * `null`. Sembrava una ORIGIN configurata male, e non lo era.
 *
 * `same-origin` ottiene la stessa protezione che si voleva — verso un sito
 * esterno il Referer non parte affatto, quindi il percorso del pannello non
 * viene comunicato a nessuno — e lascia intatto l'header `Origin` sulle POST
 * verso di noi.
 *
 * Attenzione: una prova con curl NON vede questo problema, perché l'header
 * `Origin` lo si scrive a mano e nessuna referrer policy lo tocca. Serve un
 * browser vero che invii la form.
 */
export function adminHeaders(headers: Headers): void {
	headers.set('cache-control', 'no-store, no-cache, must-revalidate');
	headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
	headers.set('referrer-policy', 'same-origin');
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
