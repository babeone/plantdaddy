import { sql } from './db';

/**
 * Proiezione della view plant_status.
 *
 * Le colonne DATE passano da to_char: postgres restituirebbe un oggetto Date,
 * che serializzato in JSON diventa un timestamp UTC e può slittare di un giorno
 * rispetto al fuso dell'utente. Il client vuole solo 'YYYY-MM-DD'.
 *
 * È una FUNZIONE e non una costante: un frammento `sql` creato a livello di
 * modulo verrebbe valutato all'import, e il passo di analisi di `vite build`
 * importa questi moduli quando DATABASE_URL non esiste ancora. Così il
 * frammento nasce solo quando la query parte davvero.
 */
const statusColumns = () => sql`
	id,
	name,
	emoji,
	location,
	notes,
	state,
	avatar_type,
	photo_reminders,
	-- Id della foto avatar, se c'è. Sottoquery scalare e non un quarto left join
	-- lateral: colpisce l'indice unico parziale plant_photos_avatar_key, quindi è
	-- una lettura di indice per riga.
	--
	-- Serve al client per costruire /api/photos/<id>/thumb. L'avatar NON si
	-- indirizza per pianta: quella URL non cambierebbe sostituendo la foto, e con
	-- Cache-Control immutable il browser continuerebbe a mostrare la vecchia
	-- immagine per un anno. Con l'id nella URL, sostituire la foto cambia
	-- l'indirizzo e la cache torna corretta invece di mentire.
	(
		select ph.id from plant_photos ph
		where ph.plant_id = plant_status.id and ph.kind = 'avatar'
	) as avatar_photo_id,
	watering_interval_days,
	fertilizing_interval_days,
	effective_watering_interval,
	effective_fertilizing_interval,
	to_char(last_watered, 'YYYY-MM-DD') as last_watered,
	to_char(last_fertilized, 'YYYY-MM-DD') as last_fertilized,
	to_char(next_watering, 'YYYY-MM-DD') as next_watering,
	to_char(next_fertilizing, 'YYYY-MM-DD') as next_fertilizing,
	to_char(water_snoozed_until, 'YYYY-MM-DD') as water_snoozed_until,
	to_char(fertilize_snoozed_until, 'YYYY-MM-DD') as fertilize_snoozed_until,
	created_at
`;

export type PlantStatus = {
	id: string;
	name: string;
	emoji: string | null;
	location: string | null;
	notes: string | null;
	state: 'active' | 'archived' | 'dead';
	avatar_type: 'emoji' | 'photo';
	photo_reminders: boolean;
	avatar_photo_id: string | null;
	watering_interval_days: number;
	fertilizing_interval_days: number | null;
	effective_watering_interval: number;
	effective_fertilizing_interval: number | null;
	last_watered: string | null;
	last_fertilized: string | null;
	next_watering: string | null;
	next_fertilizing: string | null;
	water_snoozed_until: string | null;
	fertilize_snoozed_until: string | null;
	created_at: Date;
};

/** Ordine "cosa devo fare": prima le scadenze più vicine, mai annaffiate in testa. */
export async function listPlantStatus(tokenHash: string): Promise<PlantStatus[]> {
	return sql<PlantStatus[]>`
		select ${statusColumns()}
		from plant_status
		where user_token_hash = ${tokenHash}
		order by next_watering asc nulls first, name asc
	`;
}

/** Il filtro sul token è il controllo di proprietà: un id di altri dà 0 righe. */
export async function getPlantStatus(
	tokenHash: string,
	plantId: string
): Promise<PlantStatus | undefined> {
	const rows = await sql<PlantStatus[]>`
		select ${statusColumns()}
		from plant_status
		where user_token_hash = ${tokenHash} and id = ${plantId}
	`;
	return rows[0];
}

export async function countPlants(tokenHash: string): Promise<number> {
	const [row] = await sql<{ count: number }[]>`
		select count(*)::int as count from plants where user_token_hash = ${tokenHash}
	`;
	return row.count;
}
