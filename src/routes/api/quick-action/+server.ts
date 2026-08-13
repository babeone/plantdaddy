import { error, json, type RequestHandler } from '@sveltejs/kit';
import { hashToken } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { addDays, today } from '$lib/server/date';
import { parseBody, quickActionSchema } from '$lib/server/schemas';

/**
 * Azione rapida dalla notifica, chiamata dal service worker.
 *
 * NON usa la sessione: il service worker non legge localStorage. Autentica un
 * ACTION TOKEN monouso, generato dal cron, valido solo per una pianta, una
 * azione e 24 ore. Nel database c'è solo il suo SHA-256.
 *
 * 410 quando il token è scaduto o già usato: è il codice giusto perché la
 * risorsa esisteva e non esiste più, e il service worker lo distingue per
 * mostrare un messaggio comprensibile invece di fallire in silenzio.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await parseBody(request, quickActionSchema);
	const tokenHash = hashToken(body.token);

	const result = await sql.begin(async (tx) => {
		// Il token si consuma con un UPDATE condizionato: due click contemporanei
		// sulla stessa notifica non possono passare entrambi, perché il secondo
		// non trova più la riga con used_at nullo.
		const claimed = await tx<{ plant_id: string; action: 'water' | 'snooze' }[]>`
			update action_tokens
			set used_at = now()
			where token_hash = ${tokenHash}
				and used_at is null
				and expires_at > now()
			returning plant_id, action
		`;
		if (claimed.length === 0) return null;

		const { plant_id, action } = claimed[0];
		// Il token vale per l'azione con cui è stato creato: se il payload chiede
		// altro, la richiesta è malformata.
		if (action !== body.action) error(400, 'Azione non corrispondente al token');

		if (action === 'water') {
			await tx`
				insert into care_events (plant_id, type, event_date)
				values (${plant_id}, 'water', ${today()})
				on conflict (plant_id, type, event_date) do nothing
			`;
			// Registrare una cura azzera sempre lo snooze corrispondente.
			await tx`update plants set water_snoozed_until = null where id = ${plant_id}`;
		} else {
			await tx`
				update plants set water_snoozed_until = ${addDays(today(), 1)} where id = ${plant_id}
			`;
		}

		const [plant] = await tx<{ name: string }[]>`
			select name from plants where id = ${plant_id}
		`;
		return { action, plant: plant?.name ?? null };
	});

	if (!result) error(410, 'Azione già usata o scaduta');

	return json({ ok: true, action: result.action, plant: result.plant });
};
