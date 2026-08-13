/**
 * Rendering interamente lato client.
 *
 * L'utente è identificato da un token in localStorage: il server non sa chi sia
 * finché il JavaScript non parte. Renderizzare sul server produrrebbe solo uno
 * stato vuoto seguito da un flash di contenuto, quindi SSR qui è peso morto.
 */
export const ssr = false;

/** Niente prerender: ogni vista dipende dai dati della sessione. */
export const prerender = false;
