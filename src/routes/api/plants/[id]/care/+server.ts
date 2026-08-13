import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser, requireUuid } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { today } from '$lib/server/date';
import { careCreateSchema, parseBody, parsePagination } from '$lib/server/schemas';

type CareEvent = {
	id: string;
	type: 'water' | 'fertilize';
	event_date: string;
	note: string | null;
	created_at: Date;
};

/** Proprietà verificata dal filtro sul token: id di altri = 404. */
async function assertOwnedPlant(tokenHash: string, plantId: string): Promise<void> {
	const rows = await sql`
		select 1 from plants where id = ${plantId} and user_token_hash = ${tokenHash}
	`;
	if (rows.length === 0) error(404, 'Pianta non trovata');
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const tokenHash = await requireUser(locals);
	const plantId = requireUuid(params.id, 'Pianta non trovata');
	const body = await parseBody(request, careCreateSchema);

	await assertOwnedPlant(tokenHash, plantId);

	// date assente = tap immediato; date presente = inserimento retroattivo.
	const eventDate = body.date ?? today();
	if (eventDate > today()) error(400, 'Non si può registrare una cura in una data futura');

	const snoozeColumn = body.type === 'water' ? 'water_snoozed_until' : 'fertilize_snoozed_until';

	const result = await sql.begin(async (tx) => {
		// Il vincolo UNIQUE (plant_id, type, event_date) rende il doppio tap
		// idempotente nel database: il secondo insert non fa nulla e la richiesta
		// resta un successo, non un errore da gestire lato client.
		const inserted = await tx<CareEvent[]>`
			insert into care_events ${tx({
				plant_id: plantId,
				type: body.type,
				event_date: eventDate,
				note: body.note ?? null
			})}
			on conflict (plant_id, type, event_date) do nothing
			returning id, type, to_char(event_date, 'YYYY-MM-DD') as event_date, note, created_at
		`;

		// Registrare una cura azzera sempre lo snooze corrispondente: la pianta
		// è stata curata, il rinvio non ha più senso.
		await tx`
			update plants set ${tx({ [snoozeColumn]: null })}
			where id = ${plantId}
		`;

		if (inserted.length > 0) return { event: inserted[0], created: true };

		const [existing] = await tx<CareEvent[]>`
			select id, type, to_char(event_date, 'YYYY-MM-DD') as event_date, note, created_at
			from care_events
			where plant_id = ${plantId} and type = ${body.type} and event_date = ${eventDate}
		`;
		return { event: existing, created: false };
	});

	return json(
		{ event: result.event, created: result.created },
		{ status: result.created ? 201 : 200 }
	);
};

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const tokenHash = await requireUser(locals);
	const plantId = requireUuid(params.id, 'Pianta non trovata');
	const { limit, offset } = parsePagination(url);

	await assertOwnedPlant(tokenHash, plantId);

	const events = await sql<CareEvent[]>`
		select id, type, to_char(event_date, 'YYYY-MM-DD') as event_date, note, created_at
		from care_events
		where plant_id = ${plantId}
		order by event_date desc, created_at desc
		limit ${limit} offset ${offset}
	`;
	const [{ count }] = await sql<{ count: number }[]>`
		select count(*)::int as count from care_events where plant_id = ${plantId}
	`;

	return json({ events, total: count, limit, offset });
};
