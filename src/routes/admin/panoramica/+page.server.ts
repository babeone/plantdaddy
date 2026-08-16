import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin/guard';
import { notifyHourHistogram, overview } from '$lib/server/admin/queries';

export const load: PageServerLoad = async (event) => {
	// PRIMA l'autorizzazione, POI le query. Invertire l'ordine renderebbe questa
	// pagina un amplificatore: un count(*) su tutto il database eseguito da
	// chiunque passi, senza nemmeno bisogno di una password.
	await requireAdmin(event);

	const [stats, hours] = await Promise.all([overview(), notifyHourHistogram()]);
	return { stats, hours };
};
