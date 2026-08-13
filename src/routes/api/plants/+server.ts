import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { countPlants, getPlantStatus, listPlantStatus } from '$lib/server/plants';
import { MAX_PLANTS_PER_USER, parseBody, plantCreateSchema } from '$lib/server/schemas';

/** Legge la view plant_status, non la tabella grezza: contiene già le scadenze. */
export const GET: RequestHandler = async ({ locals }) => {
	const tokenHash = await requireUser(locals);
	const plants = await listPlantStatus(tokenHash);
	return json({ plants }, { headers: { 'cache-control': 'no-store' } });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const tokenHash = await requireUser(locals);
	const body = await parseBody(request, plantCreateSchema);

	// Quota: il conteggio prima dell'INSERT dà un 409 spiegabile all'utente,
	// invece di far crescere il volume del disco senza limite.
	if ((await countPlants(tokenHash)) >= MAX_PLANTS_PER_USER) {
		error(409, `Limite di ${MAX_PLANTS_PER_USER} piante raggiunto`);
	}

	const [created] = await sql<{ id: string }[]>`
		insert into plants ${sql({
			user_token_hash: tokenHash,
			name: body.name,
			emoji: body.emoji ?? null,
			location: body.location ?? null,
			watering_interval_days: body.watering_interval_days,
			fertilizing_interval_days: body.fertilizing_interval_days ?? null
		})}
		returning id
	`;

	const plant = await getPlantStatus(tokenHash, created.id);
	return json({ plant }, { status: 201 });
};
