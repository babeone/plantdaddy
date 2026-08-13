import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { parseBody, settingsSchema } from '$lib/server/schemas';

type Settings = {
	notify_hour: number;
	winter_mode: boolean;
	winter_multiplier: number;
};

/**
 * Aggiunta in Fase 5: il client ha bisogno di leggere le impostazioni all'avvio
 * e senza questa dovrebbe usare /api/export, scaricando piante e storico
 * completo per tre campi.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const tokenHash = await requireUser(locals);

	const [settings] = await sql<Settings[]>`
		select notify_hour, winter_mode, winter_multiplier::float8 as winter_multiplier
		from users
		where token_hash = ${tokenHash}
	`;

	return json({ settings }, { headers: { 'cache-control': 'no-store' } });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const tokenHash = await requireUser(locals);
	const body = await parseBody(request, settingsSchema);

	const patch: Record<string, unknown> = {};
	if (body.notify_hour !== undefined) patch.notify_hour = body.notify_hour;
	if (body.winter_mode !== undefined) patch.winter_mode = body.winter_mode;
	if (body.winter_multiplier !== undefined) patch.winter_multiplier = body.winter_multiplier;

	// winter_multiplier è NUMERIC: senza il cast postgres lo restituirebbe come
	// stringa e il client dovrebbe ricordarsi di convertirlo.
	const [settings] = await sql<Settings[]>`
		update users set ${sql(patch)}
		where token_hash = ${tokenHash}
		returning notify_hour, winter_mode, winter_multiplier::float8 as winter_multiplier
	`;

	return json({ settings });
};
