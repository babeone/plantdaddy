/** Forme restituite dalle API della Fase 4. Le date sono sempre 'YYYY-MM-DD'. */

export type CareType = 'water' | 'fertilize';

/** Ciclo di vita della pianta. 'dead' conserva lo storico, cancellarla no. */
export type PlantLifecycle = 'active' | 'archived' | 'dead';

export type Plant = {
	id: string;
	name: string;
	emoji: string | null;
	location: string | null;
	/** Nota della pianta (max 2000). Diversa da CareEvent.note, che è per evento. */
	notes: string | null;
	state: PlantLifecycle;
	/** 'photo' significa che GET /api/plants/<id>/avatar/thumb restituisce un'immagine. */
	avatar_type: 'emoji' | 'photo';
	photo_reminders: boolean;
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
	created_at: string;
};

export type CareEvent = {
	id: string;
	type: CareType;
	event_date: string;
	note: string | null;
	created_at: string;
};

export type Settings = {
	notify_hour: number;
	winter_mode: boolean;
	winter_multiplier: number;
	/** Promemoria trimestrale per la foto del diario. Interruttore globale. */
	photo_reminders: boolean;
};

export type PlantInput = {
	name: string;
	emoji: string | null;
	location: string | null;
	/** Nota della pianta (max 2000). Diversa da CareEvent.note, che è per evento. */
	notes: string | null;
	watering_interval_days: number;
	fertilizing_interval_days: number | null;
};

/** Slot della galleria, calcolati dal server: mai ricalcolati sul client. */
export type PhotoSlots = {
	total: number;
	used: number;
	free: number;
	/** ISO, oppure null oltre il tetto dei 15 anni. */
	next_slot_at: string | null;
};

export type PlantPhoto = {
	id: string;
	width: number;
	height: number;
	bytes_stored: number;
	created_at: string;
};

/** In ritardo, oggi, tra pochi giorni, a posto, rimandata. */
export type PlantState = 'late' | 'today' | 'soon' | 'ok' | 'snoozed';
