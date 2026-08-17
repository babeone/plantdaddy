import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser, requireUuid } from '$lib/server/auth';
import { utentePerImmagini } from '$lib/server/photos/cookie';
import { serviFoto } from '$lib/server/photos/serve';
import { cancellaFoto } from '$lib/server/photos/upload';

/** Versione piena di una foto del diario. Vedi $lib/server/photos/serve. */
export const GET: RequestHandler = async ({ params, locals, cookies }) => {
	const tokenHash = await utentePerImmagini(locals, cookies);
	return serviFoto(tokenHash, { photoId: requireUuid(params.id, 'Foto non trovata') }, 'full');
};

/**
 * Cancella davvero: riga in Postgres E oggetti nell'archivio. Senza la seconda
 * parte la quota diventerebbe finzione e il disco si riempirebbe comunque.
 *
 * requireUser e NON utentePerImmagini: questa rotta modifica lo stato, quindi
 * pretende l'header. Il cookie `pd_photo` arriva anche qui — stesso Path — ma non
 * viene guardato, ed è la ragione per cui contiene solo l'hash e non il token.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const tokenHash = await requireUser(locals);
	const photoId = requireUuid(params.id, 'Foto non trovata');
	const esito = await cancellaFoto(tokenHash, photoId);
	if (!esito) error(404, 'Foto non trovata');
	return json({ deleted: photoId, slots: esito.slots });
};
