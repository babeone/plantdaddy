import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin/guard';
import {
	extra,
	ordineValido,
	perEndpoint,
	riepilogo24h,
	salute,
	serie,
	type Range
} from '$lib/server/admin/metrics-queries';

const RANGE: Range[] = ['24h', '7g', '30g'];

export const load: PageServerLoad = async (event) => {
	// PRIMA l'autorizzazione, POI le query: invertire l'ordine renderebbe questa
	// pagina un amplificatore, con aggregazioni su tutta la tabella eseguite da
	// chiunque passi. Stessa regola del cron.
	await requireAdmin(event);

	const raw = event.url.searchParams.get('range');
	const range: Range = RANGE.includes(raw as Range) ? (raw as Range) : '24h';
	const ordine = ordineValido(event.url.searchParams.get('ord'));

	// In parallelo: sono letture indipendenti e ognuna ha il suo statement_timeout,
	// quindi al massimo occupano quattro connessioni per tre secondi.
	const [sommario, endpoint, punti, health, altro] = await Promise.all([
		riepilogo24h(),
		perEndpoint(range, ordine),
		serie(range),
		salute(),
		extra()
	]);

	// `base` non si restituisce qui: SvelteKit fonde i dati del layout in quelli
	// della pagina, e +layout.server.ts lo espone già per tutta l'area admin.
	return { sommario, endpoint, punti, health, altro, range, ordine };
};
