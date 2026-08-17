import { randomUUID, timingSafeEqual } from 'node:crypto';
import { hashToken } from './auth';
import { sql } from './db';
import { today } from './date';

/**
 * Confronto del segreto del cron a tempo costante.
 *
 * timingSafeEqual pretende buffer della stessa lunghezza e lancia altrimenti,
 * quindi si confrontano gli SHA-256 dei due valori: hanno sempre 32 byte e la
 * lunghezza del segreto atteso non trapela dal confronto.
 */
export function secretMatches(provided: string | null, expected: string): boolean {
	if (!provided || !expected) return false;
	const a = Buffer.from(hashToken(provided), 'hex');
	const b = Buffer.from(hashToken(expected), 'hex');
	return timingSafeEqual(a, b);
}

export type DuePlant = {
	user_token_hash: string;
	id: string;
	name: string;
	water_due: boolean;
	fertilize_due: boolean;
};

/**
 * Piante da curare, lette da plant_status: snooze e modalità inverno sono già
 * applicati dalla view, quindi qui non si ricalcola niente.
 *
 * `hour` filtra gli utenti che hanno scelto quell'orario per il riepilogo: il
 * cron gira ogni ora e ogni utente riceve una sola notifica al giorno.
 */
export async function findDuePlants(hour: number): Promise<DuePlant[]> {
	return sql<DuePlant[]>`
		select
			ps.user_token_hash,
			ps.id,
			ps.name,
			(ps.next_watering is null or ps.next_watering <= ${today()}::date) as water_due,
			(ps.next_fertilizing is not null and ps.next_fertilizing <= ${today()}::date) as fertilize_due
		from plant_status ps
		join users u on u.token_hash = ps.user_token_hash
		-- Una pianta archiviata o morta non va annaffiata: senza questo filtro
		-- l'app continuerebbe a chiederlo per una pianta che l'utente ha appena
		-- dichiarato secca. Fino alla migrazione 008 lo stato non esisteva, quindi
		-- tutte le righe sono 'active' e il comportamento non cambia per nessuno.
		where ps.state = 'active'
			and u.notify_hour = ${hour}
			and (
				ps.next_watering is null
				or ps.next_watering <= ${today()}::date
				or ps.next_fertilizing <= ${today()}::date
			)
		order by ps.user_token_hash, ps.name
	`;
}

/** Testo del riepilogo: una sola notifica per utente, non una per pianta. */
export function buildSummary(plants: DuePlant[]): { title: string; body: string } {
	if (plants.length === 1) {
		const plant = plants[0];
		const what =
			plant.water_due && plant.fertilize_due
				? 'acqua e concime'
				: plant.water_due
					? 'acqua'
					: 'concime';
		return {
			title: `${plant.name} ha bisogno di ${what}`,
			body: 'Tocca per aprire, o usa le azioni qui sotto.'
		};
	}
	const names = plants.map((plant) => plant.name);
	const shown = names.slice(0, 3).join(', ');
	const rest = names.length - 3;
	return {
		title: `${plants.length} piante da curare`,
		body: rest > 0 ? `${shown} e altre ${rest}.` : `${shown}.`
	};
}

/**
 * Action token monouso per le azioni rapide. Nel database va solo l'hash: il
 * valore in chiaro esiste soltanto nel payload della push.
 */
export async function createActionToken(
	plantId: string,
	action: 'water' | 'snooze'
): Promise<string> {
	const token = randomUUID();
	await sql`
		insert into action_tokens (token_hash, plant_id, action, expires_at)
		values (${hashToken(token)}, ${plantId}, ${action}, now() + interval '24 hours')
	`;
	return token;
}

/** Pulizia dei token scaduti o già usati: gira insieme al cron. */
export async function purgeExpiredActionTokens(): Promise<number> {
	const deleted = await sql`
		delete from action_tokens
		where expires_at < now() or used_at is not null
		returning token_hash
	`;
	return deleted.length;
}
