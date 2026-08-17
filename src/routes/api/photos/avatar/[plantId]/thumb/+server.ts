import { type RequestHandler } from '@sveltejs/kit';
import { requireUuid } from '$lib/server/auth';
import { utentePerImmagini } from '$lib/server/photos/cookie';
import { serviFoto } from '$lib/server/photos/serve';

/** Thumbnail dell'avatar (128 px): quella che usano card e liste. */
export const GET: RequestHandler = async ({ params, locals, cookies }) => {
	const tokenHash = await utentePerImmagini(locals, cookies);
	const plantId = requireUuid(params.plantId, 'Pianta non trovata');
	return serviFoto(tokenHash, { plantId, kind: 'avatar' }, 'thumb');
};
