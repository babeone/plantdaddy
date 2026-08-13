import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { today } from '$lib/server/date';

/**
 * Backup completo della sessione. Senza account, perdere il codice significa
 * perdere tutto: questo file è la rete di sicurezza reale.
 *
 * Le DATE passano da to_char: un oggetto Date serializzato in JSON diventerebbe
 * un timestamp UTC e al reimport potrebbe slittare di un giorno.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const tokenHash = await requireUser(locals);

	const [settings] = await sql`
		select notify_hour, winter_mode, winter_multiplier::float8 as winter_multiplier
		from users
		where token_hash = ${tokenHash}
	`;

	const plants = await sql`
		select
			id,
			name,
			emoji,
			location,
			watering_interval_days,
			fertilizing_interval_days,
			to_char(water_snoozed_until, 'YYYY-MM-DD') as water_snoozed_until,
			to_char(fertilize_snoozed_until, 'YYYY-MM-DD') as fertilize_snoozed_until,
			created_at
		from plants
		where user_token_hash = ${tokenHash}
		order by created_at asc
	`;

	const careEvents = await sql`
		select
			ce.id,
			ce.plant_id,
			ce.type,
			to_char(ce.event_date, 'YYYY-MM-DD') as event_date,
			ce.note,
			ce.created_at
		from care_events ce
		join plants p on p.id = ce.plant_id
		where p.user_token_hash = ${tokenHash}
		order by ce.event_date desc, ce.created_at desc
	`;

	return json(
		{
			version: 1,
			exported_at: new Date().toISOString(),
			settings,
			plants,
			care_events: careEvents
		},
		{
			headers: {
				'content-disposition': `attachment; filename="plantdaddy-backup-${today()}.json"`,
				'cache-control': 'no-store'
			}
		}
	);
};
