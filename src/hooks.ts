import type { Reroute } from '@sveltejs/kit';
import { ADMIN_INTERNAL_BASE, adminPublicBase } from '$lib/admin-path';

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
 * Da ricordare: questo è un hook universale e gira anche nel browser. Non deve
 * leggere niente di privato, e infatti non lo fa.
 */
export const reroute: Reroute = ({ url }) => {
	const publicBase = adminPublicBase();

	if (url.pathname === publicBase || url.pathname.startsWith(`${publicBase}/`)) {
		return ADMIN_INTERNAL_BASE + url.pathname.slice(publicBase.length);
	}

	if (url.pathname === ADMIN_INTERNAL_BASE || url.pathname.startsWith(`${ADMIN_INTERNAL_BASE}/`)) {
		// Rotta inesistente -> 404, esattamente come qualunque altro indirizzo
		// sbagliato. Il caso publicBase === '/admin' è già stato intercettato sopra.
		return '/__admin_non_raggiungibile';
	}

	return url.pathname;
};
