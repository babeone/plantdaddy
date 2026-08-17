import type { Sql, TransactionSql } from 'postgres';
import { sql } from '$lib/server/db';

/**
 * Stato degli slot della galleria per una pianta.
 *
 * Il calcolo NON viene rifatto qui: si chiamano le funzioni SQL gallery_slots() e
 * gallery_next_slot_at() della migrazione 009, che sono le stesse usate dal trigger
 * di quota. Una seconda implementazione in TypeScript sarebbe finita per divergere,
 * e la divergenza si manifesta nel modo peggiore: l'API risponde "1 slot libero" e
 * il database rifiuta l'inserimento.
 */

export type StatoSlot = {
	/** Slot maturati dalla creazione: 1 subito, +1 ogni tre mesi di calendario. */
	total: number;
	used: number;
	free: number;
	/** Quando maturerà il prossimo, o null oltre il tetto dei 15 anni. */
	next_slot_at: string | null;
};

export async function statoSlot(plantId: string): Promise<StatoSlot | null> {
	const [row] = await sql<{ total: number; used: number; next_slot_at: Date | null }[]>`
		select
			gallery_slots(p.created_at, now()) as total,
			(select count(*)::int from plant_photos
				where plant_id = p.id and kind = 'gallery') as used,
			gallery_next_slot_at(p.created_at, now()) as next_slot_at
		from plants p
		where p.id = ${plantId}
	`;
	if (!row) return null;
	return {
		total: row.total,
		used: row.used,
		free: Math.max(0, row.total - row.used),
		next_slot_at: row.next_slot_at ? row.next_slot_at.toISOString() : null
	};
}

/**
 * Come statoSlot ma DENTRO una transazione e con il lock sulla riga della pianta.
 *
 * Il `for update` serializza due upload concorrenti sulla stessa pianta: la seconda
 * transazione aspetta la prima e, quando riparte, conta la foto appena inserita. Il
 * trigger in migrazione 009 prende lo stesso lock ed è la rete di sicurezza vera;
 * questo serve a poter rispondere 409 con un messaggio sensato invece di lasciare
 * risalire un errore di Postgres come 500 — e a non spendere un secondo di CPU per
 * elaborare un'immagine che verrà comunque rifiutata.
 */
export async function statoSlotConLock(
	// Sql | TransactionSql: la stessa funzione serve dentro una transazione (dove il
	// lock ha effetto fino al commit) e fuori, per rileggere lo stato dopo. Il tipo
	// della transazione in postgres.js non è assegnabile a Sql, quindi va nominato.
	tx: Sql | TransactionSql,
	plantId: string,
	tokenHash: string
): Promise<StatoSlot | null> {
	const [row] = await tx<{ total: number; used: number; next_slot_at: Date | null }[]>`
		select
			gallery_slots(p.created_at, now()) as total,
			(select count(*)::int from plant_photos
				where plant_id = p.id and kind = 'gallery') as used,
			gallery_next_slot_at(p.created_at, now()) as next_slot_at
		from plants p
		where p.id = ${plantId} and p.user_token_hash = ${tokenHash}
		for update of p
	`;
	if (!row) return null;
	return {
		total: row.total,
		used: row.used,
		free: Math.max(0, row.total - row.used),
		next_slot_at: row.next_slot_at ? row.next_slot_at.toISOString() : null
	};
}
