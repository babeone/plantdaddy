import type { PageServerLoad } from './$types';
import { adminUrl } from '$lib/server/admin/config';
import { requireAdmin } from '$lib/server/admin/guard';
import { countUsers, listUsers } from '$lib/server/admin/queries';

const PER_PAGE = 50;

export const load: PageServerLoad = async (event) => {
	await requireAdmin(event);

	// Tetto e pagina ricavati dalla query string, ma normalizzati qui: un
	// ?page=-1 o ?page=abc non deve arrivare fino a LIMIT/OFFSET.
	const raw = Number(event.url.searchParams.get('page') ?? 1);
	const page = Number.isFinite(raw) ? Math.max(1, Math.trunc(raw)) : 1;

	const [users, total] = await Promise.all([
		listUsers(PER_PAGE, (page - 1) * PER_PAGE),
		countUsers()
	]);

	return {
		users,
		page,
		pages: Math.max(1, Math.ceil(total / PER_PAGE)),
		total,
		base: adminUrl()
	};
};
