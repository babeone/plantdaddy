import { type RequestHandler } from '@sveltejs/kit';
import { requireUuid } from '$lib/server/auth';
import { utentePerImmagini } from '$lib/server/photos/cookie';
import { serviFoto } from '$lib/server/photos/serve';

/** Thumbnail: 400 px, ~38 KB. È quella che le griglie devono chiedere. */
export const GET: RequestHandler = async ({ params, locals, cookies }) => {
	const tokenHash = await utentePerImmagini(locals, cookies);
	return serviFoto(tokenHash, { photoId: requireUuid(params.id, 'Foto non trovata') }, 'thumb');
};
