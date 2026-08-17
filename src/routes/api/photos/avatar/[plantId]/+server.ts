import { type RequestHandler } from '@sveltejs/kit';
import { requireUuid } from '$lib/server/auth';
import { utentePerImmagini } from '$lib/server/photos/cookie';
import { serviFoto } from '$lib/server/photos/serve';

/**
 * Avatar indirizzato per PIANTA e non per foto: se avatar_type vale 'photo',
 * l'URL è deducibile dal client senza conoscere l'id della foto, e plant_status
 * non ha bisogno di un quarto left join lateral per portarlo in giro.
 *
 * Sta sotto /api/photos e non sotto /api/plants perché il cookie `pd_photo` ha
 * `Path=/api/photos`: un solo percorso copre tutte le immagini, e il cookie non
 * viene allegato a nient'altro.
 */
export const GET: RequestHandler = async ({ params, locals, cookies }) => {
	const tokenHash = await utentePerImmagini(locals, cookies);
	const plantId = requireUuid(params.plantId, 'Pianta non trovata');
	return serviFoto(tokenHash, { plantId, kind: 'avatar' }, 'full');
};
