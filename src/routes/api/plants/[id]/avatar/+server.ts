import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser, requireUuid } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { cancellaFoto, gestisciUpload } from '$lib/server/photos/upload';

/**
 * L'avatar della pianta: l'immagine identificativa, una sola, indipendente dalla
 * galleria.
 *
 * Non consuma slot: il trigger di quota in migrazione 009 esce subito quando
 * kind <> 'gallery', e l'unicità la garantisce un indice unico parziale. Quindi
 * sostituire l'avatar non tocca il diario di crescita in nessun modo, e una foto
 * del diario non diventa mai avatar da sola.
 *
 * Il corpo è l'immagine grezza, non multipart: c'è un solo file e nessun altro
 * campo, quindi il parsing multipart sarebbe solo un layer in più su cui sbagliare.
 * Il client manda il File direttamente come body.
 */
export const POST: RequestHandler = async (event) =>
	gestisciUpload(event, { kind: 'avatar', sostituisci: true });

// La LETTURA dell'avatar sta in /api/photos/avatar/<pianta>, non qui: il cookie
// di sola lettura delle immagini ha Path=/api/photos, e un <img> non può inviare
// l'header X-Session-Token. Vedi $lib/server/photos/cookie.

/** Torna all'emoji e rimuove la foto dallo storage. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const tokenHash = await requireUser(locals);
	const plantId = requireUuid(params.id, 'Pianta non trovata');

	const [foto] = await sql<{ id: string }[]>`
		select ph.id
		from plant_photos ph
		join plants p on p.id = ph.plant_id
		where ph.plant_id = ${plantId}
			and ph.kind = 'avatar'
			and p.user_token_hash = ${tokenHash}
	`;
	if (!foto) error(404, 'Nessuna foto avatar da rimuovere');

	await cancellaFoto(tokenHash, foto.id);
	return json({ avatar_type: 'emoji' });
};
