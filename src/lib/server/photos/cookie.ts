import { dev } from '$app/environment';
import { error, type Cookies } from '@sveltejs/kit';
import { hashToken } from '$lib/server/auth';
import { sql } from '$lib/server/db';

/**
 * Credenziale di SOLA LETTURA per le immagini.
 *
 * IL PROBLEMA, concreto: un `<img src="/api/photos/...">` non può inviare header
 * personalizzati. Tutta l'app autentica con `X-Session-Token`, e con quello le
 * immagini nel browser restavano rotte — verificato: curl le serviva, il browser
 * no.
 *
 * COSA NON SI È FATTO: leggere il cookie `pd_token` in queste rotte. È la
 * credenziale principale, e il commento in testa a src/hooks.server.ts dice in
 * maiuscolo che nessun handler deve autenticare con quel cookie. La ragione non è
 * formale: appena una rotta lo accetta, l'invariante diventa "il cookie
 * autentica a volte", e chi aggiungerà la prossima rotta copierà l'helper
 * sbagliato. Il rischio non è il codice di oggi, è quello di domani.
 *
 * COSA SI È FATTO: un secondo cookie, `pd_photo`, con lo stesso ragionamento di
 * `pd_admin` nel pannello di controllo —
 *
 *   - `Path=/api/photos`: il browser lo allega SOLO alle rotte delle immagini.
 *     Non arriva a /api/plants, non arriva a /api/import.
 *   - `HttpOnly`: il JavaScript della pagina non può leggerlo, quindi un XSS non
 *     se lo porta via (il token vero sta in localStorage, e quello è un problema
 *     già noto e documentato altrove).
 *   - `SameSite=Strict`: non parte da nessun contesto di terze parti, quindi
 *     nessun sito esterno può nemmeno provare a incorporare le immagini.
 *   - contiene lo SHA-256 del token, non il token: chi lo intercetta può
 *     GUARDARE le foto, non agire sull'account. Le rotte che modificano qualcosa
 *     — DELETE di una foto, upload — continuano a pretendere l'header, anche
 *     quando stanno sotto /api/photos.
 *
 * Il valore è l'hash e non il token perché l'hash è quello che serve alle query e
 * perché così il cookie non è riutilizzabile come X-Session-Token: chi lo prende
 * non ottiene la credenziale principale.
 */

const COOKIE = 'pd_photo';
const GIORNI = 30;
const PATH = '/api/photos';

export function scriviCookieFoto(cookies: Cookies, tokenHash: string): void {
	cookies.set(COOKIE, tokenHash, {
		path: PATH,
		httpOnly: true,
		sameSite: 'strict',
		// Su http://localhost il browser scarterebbe un cookie Secure e le immagini
		// resterebbero rotte in sviluppo.
		secure: !dev,
		maxAge: GIORNI * 24 * 60 * 60
	});
}

export function cancellaCookieFoto(cookies: Cookies): void {
	cookies.delete(COOKIE, { path: PATH });
}

/**
 * Autenticazione per le sole letture di immagini.
 *
 * Accetta l'header se c'è — così curl e i test funzionano senza giri — altrimenti
 * il cookie. In entrambi i casi verifica che la sessione esista davvero: un hash
 * inventato nel cookie non apre niente.
 */
export async function utentePerImmagini(locals: App.Locals, cookies: Cookies): Promise<string> {
	const dallHeader = locals.userTokenHash;
	const dalCookie = cookies.get(COOKIE);
	const tokenHash = dallHeader ?? dalCookie ?? null;

	// Formato prima della query: un valore arbitrario nel cookie non deve
	// nemmeno arrivare a Postgres.
	if (!tokenHash || !/^[0-9a-f]{64}$/.test(tokenHash)) {
		error(401, 'Sessione non valida per le immagini');
	}

	const righe = await sql`select 1 from users where token_hash = ${tokenHash}`;
	if (righe.length === 0) error(401, 'Sessione non valida');

	return tokenHash;
}

/** Ricava l'hash dal token in chiaro, per l'endpoint che imposta il cookie. */
export function hashDaToken(token: string): string {
	return hashToken(token);
}
