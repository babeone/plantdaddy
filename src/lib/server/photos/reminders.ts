import { sql } from '$lib/server/db';

/**
 * Promemoria trimestrale per la foto del diario.
 *
 * Regole, e ognuna corrisponde a una riga della query:
 *
 *  - solo piante `active`: archiviate e morte non generano niente
 *  - solo con `photo_reminders` accesa, sia sulla pianta sia sull'utente
 *  - solo se HANNO uno slot libero: chiedere una foto quando non c'è posto è
 *    un'infastidimento senza rimedio
 *  - MAI per lo slot 1, che nasce con la pianta mentre l'utente è già davanti
 *    allo schermo: il primo promemoria arriva a tre mesi
 *  - una volta sola per (pianta, slot), garantito dalla chiave primaria di
 *    photo_reminders
 *  - al massimo UNA notifica al giorno per utente, con `last_photo_reminder_on`
 *  - solo nell'ora scelta dall'utente in notify_hour, ristretta a una fascia
 *    civile
 */

/**
 * FASCIA CIVILE. notify_hour è già un'ora che l'utente ha scelto e che accetta —
 * riceve lì il riepilogo giornaliero — ma può averla messa alle 6 del mattino, e
 * un promemoria trimestrale non merita di svegliare nessuno. Si stringe
 * all'intervallo 10-20 nel fuso dell'istanza (APP_TIMEZONE): fuori, si sposta
 * all'estremo più vicino.
 */
export const ORA_MIN = 10;
export const ORA_MAX = 20;

export function oraCivile(notifyHour: number): number {
	return Math.min(ORA_MAX, Math.max(ORA_MIN, notifyHour));
}

export type CandidatoFoto = {
	user_token_hash: string;
	plant_id: string;
	plant_name: string;
	slot: number;
};

/**
 * Piante che HANNO maturato un nuovo slot e non hanno ancora ricevuto l'avviso.
 *
 * Non è "il cui anniversario cade oggi": se il job non gira per un giorno — un
 * deploy, un container riavviato — quel promemoria andrebbe perso per sempre. Qui
 * si guarda lo stato attuale (slot maturati contro slot usati contro promemoria
 * già inviati), quindi un giorno saltato viene recuperato al giro successivo.
 *
 * La query parte dall'indice parziale `plants_promemoria_idx` e scarta subito le
 * piante più giovani di tre mesi, che non possono aver maturato nulla: senza quel
 * filtro si valuterebbe gallery_slots() su ogni riga della tabella.
 *
 * `limite` esiste perché il job gira su una VPS piccola: si serve un blocco per
 * volta e si riprende alla run successiva.
 */
export async function candidatiFoto(hour: number, limite: number): Promise<CandidatoFoto[]> {
	return sql<CandidatoFoto[]>`
		select
			p.user_token_hash,
			p.id as plant_id,
			p.name as plant_name,
			gallery_slots(p.created_at, now()) as slot
		from plants p
		join users u on u.token_hash = p.user_token_hash
		where p.state = 'active'
			and p.photo_reminders
			and u.photo_reminders
			-- Filtro indicizzabile: sotto i tre mesi non c'è nulla da maturare.
			and p.created_at <= now() - interval '3 months'
			-- L'ora scelta dall'utente, stretta alla fascia civile.
			and least(${ORA_MAX}, greatest(${ORA_MIN}, u.notify_hour)) = ${hour}
			-- Tetto di una notifica al giorno per utente.
			and (u.last_photo_reminder_on is null or u.last_photo_reminder_on < current_date)
			-- Ci deve essere posto per la foto che stiamo chiedendo.
			and (
				select count(*) from plant_photos
				where plant_id = p.id and kind = 'gallery'
			) < gallery_slots(p.created_at, now())
			-- Mai due volte per lo stesso slot.
			and not exists (
				select 1 from photo_reminders r
				where r.plant_id = p.id and r.slot = gallery_slots(p.created_at, now())
			)
		order by p.user_token_hash, p.name
		limit ${limite}
	`;
}

/**
 * Registra l'invio. È la parte che rende il job IDEMPOTENTE: la chiave primaria
 * (plant_id, slot) rifiuta il secondo inserimento, quindi rieseguire il job lo
 * stesso giorno — o due volte per un riavvio a metà — non manda niente di
 * duplicato. `on conflict do nothing` perché arrivare secondi non è un errore.
 *
 * Insieme si aggiorna last_photo_reminder_on: da qui in poi quell'utente non
 * riceve altri promemoria foto fino a domani.
 */
export async function segnaInviati(
	tokenHash: string,
	piante: { plant_id: string; slot: number }[]
): Promise<void> {
	await sql.begin(async (tx) => {
		for (const p of piante) {
			await tx`
				insert into photo_reminders (plant_id, slot)
				values (${p.plant_id}, ${p.slot})
				on conflict (plant_id, slot) do nothing
			`;
		}
		await tx`
			update users set last_photo_reminder_on = current_date
			where token_hash = ${tokenHash}
		`;
	});
}

/** Testo della notifica: una sola, aggregata, col nome quando la pianta è una. */
export function testoPromemoria(piante: CandidatoFoto[]): { title: string; body: string } {
	if (piante.length === 1) {
		return {
			title: `È ora di fotografare ${piante[0].plant_name} 🌿`,
			body: 'Vediamo quanto è cresciuta: tocca per aggiungere la foto al diario.'
		};
	}
	const nomi = piante.map((p) => p.plant_name);
	const mostrati = nomi.slice(0, 3).join(', ');
	const resto = nomi.length - 3;
	return {
		title: `${piante.length} piante aspettano la loro foto 📷`,
		body: resto > 0 ? `${mostrati} e altre ${resto}.` : `${mostrati}.`
	};
}

/**
 * Lock per impedire due esecuzioni sovrapposte.
 *
 * pg_try_advisory_xact_lock e non una tabella di stato: è legato alla
 * transazione, quindi si rilascia da solo anche se il processo muore a metà. Con
 * un flag su tabella, un container ucciso lascerebbe il job bloccato per sempre.
 *
 * Il numero è arbitrario ma fisso: identifica QUESTO job.
 */
export const LOCK_PROMEMORIA_FOTO = 918_273_641;
export const LOCK_PULIZIA_FOTO = 918_273_642;
