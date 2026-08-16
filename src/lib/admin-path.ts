import { env } from '$env/dynamic/public';

/**
 * Percorso pubblico del pannello admin, per default /superman.
 *
 * Sta FUORI da $lib/server perché serve anche a reroute() in src/hooks.ts, che è
 * un hook universale e viene compilato anche per il client. Per lo stesso motivo
 * la variabile ha il prefisso PUBLIC_: $env/dynamic/private esclude per
 * costruzione tutto ciò che comincia per PUBLIC_, e leggerla da lì darebbe
 * sempre undefined.
 *
 * CONSEGUENZA DA CONOSCERE: essendo pubblica, questa stringa finisce nel bundle
 * servito al browser. Non è un segreto e non va trattata come tale. Cambiare
 * percorso serve solo a togliere rumore dai log — i bot provano /admin e
 * /wp-admin — non a nascondere il pannello. La sicurezza sta altrove: 404 se non
 * configurato, scrypt + TOTP obbligatorio, sola lettura, sessione breve.
 */
export function adminPublicBase(): string {
	const raw = (env.PUBLIC_ADMIN_PATH ?? '/superman').trim();
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	// Niente slash finale: le URL si compongono come `${base}/pagina`.
	return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

/** Percorso interno reale: la cartella dentro src/routes. Non è configurabile. */
export const ADMIN_INTERNAL_BASE = '/admin';

/** URL di una pagina del pannello, da usare in href e redirect. */
export function adminUrl(path = ''): string {
	return `${adminPublicBase()}${path}`;
}
