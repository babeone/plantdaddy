import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin/guard';
import { systemInfo } from '$lib/server/admin/queries';

export const load: PageServerLoad = async (event) => {
	await requireAdmin(event);
	return { info: await systemInfo() };
};
