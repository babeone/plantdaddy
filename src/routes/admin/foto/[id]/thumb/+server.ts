import { error, type RequestHandler } from '@sveltejs/kit';
import { requireUuid } from '$lib/server/auth';
import { adminShowUserPhotos } from '$lib/server/admin/config';
import { requireAdmin } from '$lib/server/admin/guard';
import { serviFotoAdmin } from '$lib/server/photos/serve';

/** Thumbnail: è quella che chiedono le griglie del pannello, ~38 KB l'una. */
export const GET: RequestHandler = async (event) => {
	await requireAdmin(event);
	if (!adminShowUserPhotos()) error(404, 'Non trovato');
	return serviFotoAdmin(requireUuid(event.params.id, 'Foto non trovata'), 'thumb');
};
