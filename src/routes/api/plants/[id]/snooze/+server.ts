import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser, requireUuid } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { addDays, today } from '$lib/server/date';
import { getPlantStatus } from '$lib/server/plants';
import { parseBody, snoozeSchema } from '$lib/server/schemas';

/**
 * Rimanda una cura. NON crea un evento: sposta solo la data in cui la pianta
 * ricompare tra quelle da curare, così lo storico resta veritiero e la media
 * degli intervalli reali non viene falsata.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const tokenHash = await requireUser(locals);
	const plantId = requireUuid(params.id, 'Pianta non trovata');
	const body = await parseBody(request, snoozeSchema);

	// Calcolata in JS sul fuso dell'utente, non con current_date: il container
	// gira in UTC e a notte fonda sposterebbe di un giorno in meno.
	const until = addDays(today(), body.days);
	const column = body.type === 'water' ? 'water_snoozed_until' : 'fertilize_snoozed_until';

	const updated = await sql<{ id: string }[]>`
		update plants set ${sql({ [column]: until })}
		where id = ${plantId} and user_token_hash = ${tokenHash}
		returning id
	`;
	if (updated.length === 0) error(404, 'Pianta non trovata');

	const plant = await getPlantStatus(tokenHash, plantId);
	return json({ snoozed_until: until, plant });
};
