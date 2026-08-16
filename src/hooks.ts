import type { Reroute } from '@sveltejs/kit';
import { ADMIN_INTERNAL_BASE, adminPublicBase, decodePath } from '$lib/admin-path';

/**
 * Percorso configurabile del pannello admin.
 *
 * Le rotte stanno in src/routes/admin, ma l'indirizzo che si digita è quello di
 * PUBLIC_ADMIN_PATH (per default /superman). reroute() traduce l'uno nell'altro
 * prima che SvelteKit scelga la rotta, ed è l'unico punto dove SvelteKit lo
 * permette: l'URL nella barra degli indirizzi resta quella pubblica.
 *
 * Il percorso interno /admin viene reso 404 apposta. Senza questa riga
 * esisterebbero DUE indirizzi per lo stesso pannello — quello configurato e
 * /admin — e il secondo è precisamente quello che i bot provano per primo,
 * vanificando l'unico beneficio reale del percorso configurabile.
 *
 * I confronti si fanno sul percorso DECODIFICATO, non su quello grezzo.
 * SvelteKit decodifica il valore restituito da reroute, quindi confrontando la
 * stringa così com'è arriva `/%61dmin` non corrispondeva a `/admin`, scivolava
 * fino all'ultimo return e veniva poi decodificato in `/admin`: il pannello
 * finiva servito esattamente sull'indirizzo che queste righe dichiarano di
 * bloccare. Verificato sul build di produzione: `/admin` dava 404 e `/%61dmin`
 * dava 200 con la pagina di login.
 *
 * Da ricordare: questo è un hook universale e gira anche nel browser. Non deve
 * leggere niente di privato, e infatti non lo fa.
 */
export const reroute: Reroute = ({ url }) => {
	const publicBase = adminPublicBase();
	const path = decodePath(url.pathname);

	if (path === publicBase || path.startsWith(`${publicBase}/`)) {
		// Si restituisce il suffisso già decodificato. Le rotte del pannello sono
		// stringhe fisse (/2fa, /panoramica, /utenti/<uuid>) senza caratteri da
		// percent-encodare, quindi la seconda decodifica di SvelteKit non ha nulla
		// da rifare; un suffisso strano non corrisponderebbe a nessuna rotta e
		// finirebbe comunque 404.
		return ADMIN_INTERNAL_BASE + path.slice(publicBase.length);
	}

	if (path === ADMIN_INTERNAL_BASE || path.startsWith(`${ADMIN_INTERNAL_BASE}/`)) {
		// Rotta inesistente -> 404, esattamente come qualunque altro indirizzo
		// sbagliato. Il caso publicBase === '/admin' è già stato intercettato sopra.
		return '/__admin_non_raggiungibile';
	}

	return url.pathname;
};
