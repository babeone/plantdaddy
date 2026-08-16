import type { LayoutServerLoad } from './$types';
import { adminUrl } from '$lib/server/admin/config';
import { requireAdminArea } from '$lib/server/admin/guard';
import { readAdminSession } from '$lib/server/admin/session';

/**
 * Load comune a tutta l'area.
 *
 * requireAdminArea è la PRIMA istruzione e vale per ogni pagina figlia: se il
 * pannello non è abilitato, o l'IP non è in allowlist, si esce con 404 prima che
 * venga letta una sola riga dal database.
 *
 * Qui NON si pretende una sessione: questo layout avvolge anche il login. Il
 * controllo vero lo fa requireAdmin() nel load di ogni pagina con dati.
 */
export const load: LayoutServerLoad = async (event) => {
	requireAdminArea(event);

	const session = await readAdminSession(event.cookies);

	return {
		base: adminUrl(),
		email: session?.mfa_done ? session.email : null
	};
};
