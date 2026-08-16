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
const DEFAULT_BASE = '/superman';

/**
 * Prefissi dell'app utente. Il pannello non può prendersi uno di questi, né la
 * radice: si porterebbe via una pagina che serve a tutti.
 */
const RISERVATI = ['/api', '/piante', '/impostazioni', '/benvenuto', '/ripristina', '/_app'];

/**
 * Un solo segmento, con i soli caratteri che una URL lascia passare identici.
 *
 * Serve a evitare percorsi che il browser percent-encoda (spazi, accenti) o che
 * cambiano forma fra quello che si scrive nella variabile e quello che arriva al
 * server: il pannello risulterebbe irraggiungibile senza un motivo visibile.
 */
const FORMA_VALIDA = /^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/;

export function adminPublicBase(): string {
	// `.trim() || DEFAULT` e non `??`: una variabile CREATA MA VUOTA nella UI di
	// Dokploy arriva come stringa vuota, che `??` lascia passare. Senza questa
	// riga il percorso diventava '/', cioè reroute() dirottava la home dell'app
	// sul login del pannello, il cookie pd_admin nasceva con Path=/ e finiva
	// allegato a tutte le chiamate /api/* dell'utente, e adminUrl('/2fa')
	// produceva '//2fa' — che un browser interpreta come https://2fa/, cioè un
	// redirect fuori dal sito. Stesso trattamento che riceve ADMIN_IP_ALLOWLIST.
	const raw = (env.PUBLIC_ADMIN_PATH ?? '').trim() || DEFAULT_BASE;
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	// Niente slash finale: le URL si compongono come `${base}/pagina`.
	const base = withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;

	// Valore inutilizzabile: si torna al default invece di lanciare. Questa
	// funzione gira a ogni richiesta, e un throw qui spegnerebbe tutta l'app —
	// compresa quella degli utenti, che col pannello non c'entra niente.
	if (!FORMA_VALIDA.test(base)) return DEFAULT_BASE;
	if (RISERVATI.some((p) => base === p || base.startsWith(`${p}/`))) return DEFAULT_BASE;

	return base;
}

/** Percorso interno reale: la cartella dentro src/routes. Non è configurabile. */
export const ADMIN_INTERNAL_BASE = '/admin';

/**
 * Percorso decodificato, per i confronti di reroute().
 *
 * SvelteKit decodifica il percorso DOPO aver chiamato reroute (respond.js chiama
 * decode_pathname sul valore restituito), quindi un confronto sulla stringa
 * grezza si lascia scappare le forme equivalenti: `/%61dmin` non corrispondeva a
 * `/admin`, scivolava fino al `return url.pathname` finale e veniva poi
 * decodificato in `/admin` — servendo il pannello proprio sull'indirizzo che
 * reroute() dichiara di voler rendere irraggiungibile.
 *
 * Stessa spezzatura su '%25' usata da SvelteKit, così le due decodifiche
 * combaciano. decodeURI lancia su percentuali malformate (`%zz`): in quel caso
 * si tiene la stringa originale, che non corrisponderà a nulla e finirà 404.
 */
export function decodePath(pathname: string): string {
	try {
		return pathname.split('%25').map(decodeURI).join('%25');
	} catch {
		return pathname;
	}
}

/** URL di una pagina del pannello, da usare in href e redirect. */
export function adminUrl(path = ''): string {
	return `${adminPublicBase()}${path}`;
}
