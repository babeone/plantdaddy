import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser, requireUuid } from '$lib/server/auth';
import { sql } from '$lib/server/db';

/**
 * Elimina un singolo evento inserito per errore.
 *
 * La proprietà si verifica risalendo care_events -> plants -> users dentro la
 * stessa DELETE: senza il join un id indovinato cancellerebbe l'evento di un
 * altro utente. Eliminando l'ultimo evento la data di "ultima cura" torna
 * automaticamente a quella precedente, perché è derivata dalla view.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const tokenHash = await requireUser(locals);
	const eventId = requireUuid(params.eventId, 'Evento non trovato');

	const deleted = await sql<{ id: string; plant_id: string }[]>`
		delete from care_events ce
		using plants p
		where ce.id = ${eventId}
			and p.id = ce.plant_id
			and p.user_token_hash = ${tokenHash}
		returning ce.id, ce.plant_id
	`;
	if (deleted.length === 0) error(404, 'Evento non trovato');

	return json({ deleted: deleted[0].id, plant_id: deleted[0].plant_id });
};
