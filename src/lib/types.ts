/** Forme restituite dalle API della Fase 4. Le date sono sempre 'YYYY-MM-DD'. */

export type CareType = 'water' | 'fertilize';

export type Plant = {
	id: string;
	name: string;
	emoji: string | null;
	location: string | null;
	/** Nota della pianta (max 2000). Diversa da CareEvent.note, che è per evento. */
	notes: string | null;
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

/** In ritardo, oggi, tra pochi giorni, a posto, rimandata. */
export type PlantState = 'late' | 'today' | 'soon' | 'ok' | 'snoozed';
