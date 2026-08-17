import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { cancellaCookieFoto, scriviCookieFoto } from '$lib/server/photos/cookie';

/**
 * Scambia la sessione (header) per il cookie di sola lettura delle immagini.
 *
 * Va chiamata una volta all'avvio dell'app, dopo che la sessione è confermata.
 * L'autenticazione qui è quella normale — header `X-Session-Token` — quindi il
 * cookie lo può ottenere solo chi ha già il token: non è un modo per aggirare
 * niente, è un modo per far vedere le immagini a un tag <img>, che non può
 * inviare header.
 *
 * Il perché di un cookie separato invece di `pd_token` sta in
 * $lib/server/photos/cookie.
 */
export const POST: RequestHandler = async ({ locals, cookies }) => {
	const tokenHash = await requireUser(locals);
	scriviCookieFoto(cookies, tokenHash);
	return json({ ok: true });
};

/** Al logout: senza questo il cookie resterebbe su un dispositivo condiviso. */
export const DELETE: RequestHandler = async ({ cookies }) => {
	cancellaCookieFoto(cookies);
	return json({ ok: true });
};
