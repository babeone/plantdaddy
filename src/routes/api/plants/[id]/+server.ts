import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser, requireUuid } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { getPlantStatus } from '$lib/server/plants';
import { parseBody, plantPatchSchema } from '$lib/server/schemas';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const tokenHash = await requireUser(locals);
	const plantId = requireUuid(params.id, 'Pianta non trovata');
	const body = await parseBody(request, plantPatchSchema);

	// Si costruisce un oggetto con SOLO le chiavi validate da zod, poi lo passa
	// a sql(): niente concatenazione di stringhe, niente colonne arbitrarie.
	const patch: Record<string, unknown> = {};
	if (body.name !== undefined) patch.name = body.name;
	if (body.emoji !== undefined) patch.emoji = body.emoji;
	if (body.location !== undefined) patch.location = body.location;
	if (body.notes !== undefined) patch.notes = body.notes;
	if (body.state !== undefined) patch.state = body.state;
	if (body.photo_reminders !== undefined) patch.photo_reminders = body.photo_reminders;
	if (body.watering_interval_days !== undefined) {
		patch.watering_interval_days = body.watering_interval_days;
	}
	if (body.fertilizing_interval_days !== undefined) {
		patch.fertilizing_interval_days = body.fertilizing_interval_days;
	}

	// Il filtro sul token nella WHERE è il controllo anti-IDOR: l'id di un'altra
	// sessione non aggiorna niente e risponde 404.
	const updated = await sql<{ id: string }[]>`
		update plants set ${sql(patch)}
		where id = ${plantId} and user_token_hash = ${tokenHash}
		returning id
	`;
	if (updated.length === 0) error(404, 'Pianta non trovata');

	const plant = await getPlantStatus(tokenHash, plantId);
	return json({ plant });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const tokenHash = await requireUser(locals);
	const plantId = requireUuid(params.id, 'Pianta non trovata');

	// ON DELETE CASCADE porta via anche gli eventi di cura della pianta.
	const deleted = await sql<{ id: string }[]>`
		delete from plants
		where id = ${plantId} and user_token_hash = ${tokenHash}
		returning id
	`;
	if (deleted.length === 0) error(404, 'Pianta non trovata');

	return json({ deleted: deleted[0].id });
};
