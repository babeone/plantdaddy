import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { MAX_PLANTS_PER_USER, importSchema, parseBody } from '$lib/server/schemas';

const SUPPORTED_VERSIONS = new Set(['1']);
const CHUNK = 500;

function chunks<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/**
 * Reimporta un backup sulla sessione corrente.
 *
 * PROPRIETÀ FORZATA: qualunque `id`, `plant_id`, `user_token`, `user_token_hash`
 * presente nel file viene ignorato come valore da scrivere. Gli id sono
 * rigenerati dal database e ogni riga è legata al token della sessione
 * chiamante. `plant_id` serve solo come riferimento interno al file per
 * ricollegare gli eventi alle rispettive piante. Senza questo, un JSON
 * costruito ad arte scriverebbe righe dentro la sessione di un altro utente.
 *
 * Due modalità:
 * - `?mode=merge` (default): le piante con lo stesso nome vengono riusate,
 *   gli eventi già presenti per pianta/data/tipo vengono saltati.
 * - `?mode=replace`: svuota le piante della sessione e ricarica da zero.
 *
 * L'import è l'unica operazione distruttiva dell'app: la validazione completa
 * del JSON avviene PRIMA di aprire la transazione, quindi un file corrotto non
 * arriva mai a cancellare niente.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const tokenHash = await requireUser(locals);

	const mode = url.searchParams.get('mode') ?? 'merge';
	if (mode !== 'merge' && mode !== 'replace') {
		error(400, "mode deve essere 'merge' o 'replace'");
	}

	const backup = await parseBody(request, importSchema);
	if (!SUPPORTED_VERSIONS.has(String(backup.version))) {
		error(400, `Versione di backup non supportata: ${backup.version}`);
	}

	const result = await sql.begin(async (tx) => {
		if (mode === 'replace') {
			// CASCADE porta via anche gli eventi delle piante cancellate.
			await tx`delete from plants where user_token_hash = ${tokenHash}`;
		}

		const existing = await tx<{ id: string; name: string }[]>`
			select id, name from plants where user_token_hash = ${tokenHash}
		`;
		const byName = new Map(existing.map((row) => [row.name.toLowerCase(), row.id]));

		// Chiave locale del file -> id reale nel database.
		const plantIdMap = new Map<string, string>();
		let plantsCreated = 0;
		let plantsMatched = 0;

		for (const [index, plant] of backup.plants.entries()) {
			const localKey = plant.id ?? `#${index}`;

			const reused = mode === 'merge' ? byName.get(plant.name.toLowerCase()) : undefined;
			if (reused) {
				plantIdMap.set(localKey, reused);
				plantsMatched += 1;
				continue;
			}

			if (existing.length + plantsCreated >= MAX_PLANTS_PER_USER) {
				error(409, `L'import supererebbe il limite di ${MAX_PLANTS_PER_USER} piante`);
			}

			const [row] = await tx<{ id: string }[]>`
				insert into plants ${tx({
					user_token_hash: tokenHash,
					name: plant.name,
					emoji: plant.emoji ?? null,
					location: plant.location ?? null,
					notes: plant.notes ?? null,
					watering_interval_days: plant.watering_interval_days,
					fertilizing_interval_days: plant.fertilizing_interval_days ?? null,
					water_snoozed_until: plant.water_snoozed_until ?? null,
					fertilize_snoozed_until: plant.fertilize_snoozed_until ?? null
				})}
				returning id
			`;
			plantIdMap.set(localKey, row.id);
			byName.set(plant.name.toLowerCase(), row.id);
			plantsCreated += 1;
		}

		// Eventi orfani (plant_id che non corrisponde a nessuna pianta del file)
		// e duplicati interni scartati qui: il conflitto lo gestisce comunque il
		// vincolo UNIQUE, ma deduplicare prima rende il conteggio veritiero.
		const seen = new Set<string>();
		let orphanEvents = 0;
		const rows: Record<string, unknown>[] = [];

		for (const event of backup.care_events) {
			const plantId = plantIdMap.get(event.plant_id);
			if (!plantId) {
				orphanEvents += 1;
				continue;
			}
			const key = `${plantId}|${event.type}|${event.event_date}`;
			if (seen.has(key)) continue;
			seen.add(key);
			rows.push({
				plant_id: plantId,
				type: event.type,
				event_date: event.event_date,
				note: event.note ?? null
			});
		}

		let eventsImported = 0;
		for (const chunk of chunks(rows, CHUNK)) {
			const inserted = await tx`
				insert into care_events ${tx(chunk, 'plant_id', 'type', 'event_date', 'note')}
				on conflict (plant_id, type, event_date) do nothing
				returning id
			`;
			eventsImported += inserted.length;
		}

		// display_name è ESCLUSO di proposito, anche se l'export lo scrive.
		// L'import scarica un file dentro una sessione che esiste già: leggerlo
		// significherebbe che caricare il backup di qualcun altro — o un backup
		// vecchio — rinomina la sessione corrente senza chiedere niente. Non è una
		// perdita: una sessione nuova il nome se lo fa dare alla creazione.
		if (backup.settings) {
			const patch: Record<string, unknown> = {};
			if (backup.settings.notify_hour !== undefined) {
				patch.notify_hour = backup.settings.notify_hour;
			}
			if (backup.settings.winter_mode !== undefined) {
				patch.winter_mode = backup.settings.winter_mode;
			}
			if (backup.settings.winter_multiplier !== undefined) {
				const multiplier = Number(backup.settings.winter_multiplier);
				if (Number.isFinite(multiplier) && multiplier >= 1 && multiplier <= 3) {
					patch.winter_multiplier = multiplier;
				}
			}
			if (Object.keys(patch).length > 0) {
				await tx`update users set ${tx(patch)} where token_hash = ${tokenHash}`;
			}
		}

		return {
			mode,
			plants_created: plantsCreated,
			plants_matched: plantsMatched,
			events_imported: eventsImported,
			events_skipped: rows.length - eventsImported,
			events_orphan: orphanEvents
		};
	});

	return json(result);
};
