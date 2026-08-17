import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser, requireUuid } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { statoSlot } from '$lib/server/photos/slots';
import { gestisciUpload } from '$lib/server/photos/upload';

type FotoGalleria = {
	id: string;
	width: number;
	height: number;
	bytes_stored: number;
	created_at: Date;
};

/**
 * Elenco del diario di crescita, più lo stato degli slot.
 *
 * NON tocca MinIO: legge solo Postgres. È voluto — con l'archivio spento la pagina
 * deve caricarsi comunque, e sono le singole immagini a mostrare un segnaposto,
 * non la schermata a rompersi.
 *
 * Restituisce anche `slots` con maturati, usati, liberi e la data del prossimo, così
 * la UI può scrivere "prossima foto disponibile tra 12 giorni" senza rifare il
 * calcolo lato client — dove sarebbe una seconda implementazione destinata a
 * divergere da quella del trigger.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const tokenHash = await requireUser(locals);
	const plantId = requireUuid(params.id, 'Pianta non trovata');

	// Il filtro sul token è il controllo di proprietà: la pianta di un altro dà 0
	// righe e quindi 404, senza rivelare se esista.
	const [pianta] = await sql<{ id: string }[]>`
		select id from plants where id = ${plantId} and user_token_hash = ${tokenHash}
	`;
	if (!pianta) error(404, 'Pianta non trovata');

	const photos = await sql<FotoGalleria[]>`
		select id, width, height, bytes_stored, created_at
		from plant_photos
		where plant_id = ${plantId} and kind = 'gallery'
		order by created_at desc
	`;

	return json(
		{ photos, slots: await statoSlot(plantId) },
		{
			headers: { 'cache-control': 'no-store' }
		}
	);
};

export const POST: RequestHandler = async (event) => gestisciUpload(event, { kind: 'gallery' });
