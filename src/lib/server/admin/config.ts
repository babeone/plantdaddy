import { env } from '$env/dynamic/private';

/**
 * Configurazione del pannello admin.
 *
 * DEFAULT = SPENTO. Chi clona il repository non si ritrova un'area di
 * amministrazione esposta senza saperlo: finché ADMIN_ENABLED non vale
 * esattamente 'true', ogni rotta del pannello risponde 404.
 *
 * 404 e non 403: un 403 confermerebbe che il pannello esiste ed è solo chiuso.
 *
 * Tutto viene letto da $env/dynamic, quindi a ogni richiesta e non al momento
 * del build: le variabili si cambiano in Dokploy e basta riavviare il container,
 * senza ricompilare l'immagine.
 *
 * Il percorso pubblico sta a parte, in $lib/admin-path: serve anche a reroute()
 * in src/hooks.ts, che viene compilato anche per il client.
 */

// Riesportati perché il codice server li cerca qui insieme al resto.
export { ADMIN_INTERNAL_BASE, adminPublicBase, adminUrl } from '$lib/admin-path';

export function adminEnabled(): boolean {
	return env.ADMIN_ENABLED === 'true';
}

/**
 * Allowlist di IP, opzionale. Se valorizzata, chi non è in elenco riceve 404
 * come se il pannello non esistesse — prima ancora che venga letta una riga dal
 * database. È il filtro più economico ed è quello che regge meglio il rumore di
 * fondo di internet.
 *
 * Confronto per uguaglianza esatta, niente CIDR: chi ha bisogno di reti intere
 * ha anche un firewall o una VPN, che sono il posto giusto per farlo.
 */
export function adminIpAllowed(ip: string): boolean {
	const raw = (env.ADMIN_IP_ALLOWLIST ?? '').trim();
	if (!raw) return true;
	return raw
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		.includes(ip);
}

/**
 * Testo libero scritto dagli utenti (note delle piante e degli eventi).
 *
 * Di default NON viene mostrato: il pannello serve a sapere quanti utenti ci
 * sono e se l'app funziona, non a leggere gli appunti di qualcuno. Con questa a
 * 'true' chi ospita l'istanza se ne prende la responsabilità.
 */
export function adminShowUserText(): boolean {
	return env.ADMIN_SHOW_USER_TEXT === 'true';
}

/**
 * Foto degli utenti visibili nel pannello.
 *
 * EREDITA da ADMIN_SHOW_USER_TEXT se non impostata esplicitamente. Il ragionamento:
 * sono la stessa categoria — contenuto caricato dalle persone che usano l'app — e
 * chi ha già deciso di poter leggere le note difficilmente vuole essere cieco sulle
 * foto. Chi le vuole separate imposta ADMIN_SHOW_USER_PHOTOS e quella vince.
 *
 * Il default resta quindi SPENTO per chi clona il repository: un pannello che
 * mostra le foto di casa altrui non deve accendersi da solo.
 */
export function adminShowUserPhotos(): boolean {
	const esplicita = env.ADMIN_SHOW_USER_PHOTOS;
	if (esplicita === 'true') return true;
	if (esplicita === 'false') return false;
	return adminShowUserText();
}

/** Scadenza assoluta della sessione admin, in ore. Fuori range torna 8. */
export function adminSessionHours(): number {
	const parsed = Number(env.ADMIN_SESSION_HOURS ?? 8);
	if (!Number.isFinite(parsed) || parsed < 1 || parsed > 168) return 8;
	return Math.trunc(parsed);
}

/** Nome dell'app dentro l'app authenticator (issuer dell'URI otpauth). */
export const ADMIN_TOTP_ISSUER = 'PlantDaddy';
