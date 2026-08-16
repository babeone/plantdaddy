import { SvelteSet } from 'svelte/reactivity';
import { api } from '$lib/api';
import { daysFromToday, today } from '$lib/date';
import type { CareType, Plant, PlantInput, PlantState, Settings } from '$lib/types';

/** true se quel tipo di cura è stato rimandato a una data futura. */
function isSnoozed(plant: Plant, type: CareType): boolean {
	const until = type === 'water' ? plant.water_snoozed_until : plant.fertilize_snoozed_until;
	return until !== null && daysFromToday(until) > 0;
}

/**
 * Stato di una pianta a partire dalle scadenze calcolate dalla view.
 *
 * Lo snooze si guarda PRIMA del caso "mai curata": una pianta senza storico ha
 * next_watering nullo, e valutandolo per primo il rinvio restava invisibile —
 * la card non usciva dalla Home e la pill continuava a dire "Mai curata".
 */
export function plantState(plant: Plant): PlantState {
	const pending = dueTypes(plant);
	const snoozedTypes = careTypesOf(plant).filter((type) => isSnoozed(plant, type));

	// Tutto ciò che era in scadenza è stato rimandato: niente da fare oggi.
	if (pending.length === 0 && snoozedTypes.length > 0) return 'snoozed';

	const due = nextDueDays(plant);
	if (due === null) return 'today'; // mai curata e non rimandata: da fare adesso
	if (due < 0) return 'late';
	if (due === 0) return 'today';
	if (due <= 3) return 'soon';
	return 'ok';
}

/** I tipi di cura previsti per questa pianta (il concime è opzionale). */
function careTypesOf(plant: Plant): CareType[] {
	return plant.fertilizing_interval_days === null ? ['water'] : ['water', 'fertilize'];
}

/** Giorni alla prima scadenza (acqua o concime). null se non ce n'è nessuna. */
export function nextDueDays(plant: Plant): number | null {
	const dates = [plant.next_watering, plant.next_fertilizing].filter(
		(date): date is string => date !== null
	);
	if (dates.length === 0) return null;
	// Se l'acqua non ha una scadenza calcolabile ed è nemmeno rimandata, la
	// pianta è da curare adesso: lo dice il chiamante, non questa funzione.
	if (plant.next_watering === null && !isSnoozed(plant, 'water')) return null;
	return Math.min(...dates.map(daysFromToday));
}

/**
 * Cosa serve oggi: tipi di cura scaduti o in scadenza odierna, escludendo
 * quelli rimandati. Il controllo sullo snooze serve anche quando next_* è
 * nullo, cioè proprio sulle piante mai curate.
 */
export function dueTypes(plant: Plant): CareType[] {
	const out: CareType[] = [];
	if (
		!isSnoozed(plant, 'water') &&
		(plant.next_watering === null || daysFromToday(plant.next_watering) <= 0)
	) {
		out.push('water');
	}
	if (
		plant.fertilizing_interval_days !== null &&
		!isSnoozed(plant, 'fertilize') &&
		plant.next_fertilizing !== null &&
		daysFromToday(plant.next_fertilizing) <= 0
	) {
		out.push('fertilize');
	}
	return out;
}

/**
 * Stato globale piante e impostazioni.
 *
 * Le azioni di cura sono OTTIMISTICHE: aggiornano la copia in memoria e fanno
 * partire la richiesta in background. Il tap immediato è il gesto che uso ogni
 * giorno, non deve aspettare la rete. In caso di errore si ripristina la copia
 * salvata prima della modifica e si mostra il messaggio.
 */
class PlantsStore {
	plants = $state<Plant[]>([]);
	settings = $state<Settings>({ notify_hour: 8, winter_mode: false, winter_multiplier: 1.5 });
	loading = $state(false);
	loaded = $state(false);
	error = $state<string | null>(null);
	/**
	 * Id delle piante con una richiesta in volo, per lo stato "in corso".
	 * SvelteSet e non Set: è reattivo alla mutazione, quindi add/delete
	 * aggiornano la UI senza ricreare l'insieme a ogni tap.
	 */
	pending = new SvelteSet<string>();

	due = $derived(
		this.plants
			.filter((plant) => {
				const state = plantState(plant);
				return state === 'late' || state === 'today';
			})
			.sort((a, b) => (nextDueDays(a) ?? -999) - (nextDueDays(b) ?? -999))
	);

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const data = await api.get<{ plants: Plant[] }>('/plants');
			this.plants = data.plants;
			this.loaded = true;
		} catch (err) {
			this.error = messageOf(err);
		} finally {
			this.loading = false;
		}
	}

	byId(id: string): Plant | undefined {
		return this.plants.find((plant) => plant.id === id);
	}

	private replace(plant: Plant): void {
		this.plants = this.plants.map((current) => (current.id === plant.id ? plant : current));
	}

	private markPending(id: string, on: boolean): void {
		if (on) this.pending.add(id);
		else this.pending.delete(id);
	}

	/** Registrazione immediata: stato aggiornato subito, rete dopo. */
	async care(id: string, type: CareType, date?: string, note?: string | null): Promise<void> {
		const snapshot = this.plants;
		const plant = this.byId(id);
		if (!plant) return;

		if (!date || date === today()) {
			// Previsione locale della nuova scadenza, così la card cambia subito.
			const interval =
				type === 'water' ? plant.effective_watering_interval : plant.effective_fertilizing_interval;
			const optimistic: Plant = { ...plant };
			if (type === 'water') {
				optimistic.last_watered = today();
				optimistic.next_watering = addDaysIso(today(), interval ?? 0);
				optimistic.water_snoozed_until = null;
			} else {
				optimistic.last_fertilized = today();
				optimistic.next_fertilizing = addDaysIso(today(), interval ?? 0);
				optimistic.fertilize_snoozed_until = null;
			}
			this.replace(optimistic);
		}

		this.markPending(id, true);
		try {
			await api.post(`/plants/${id}/care`, {
				type,
				...(date ? { date } : {}),
				...(note ? { note } : {})
			});
			// La verità sta nel server: lo storico può aver ruotato o l'evento
			// esistere già, e la scadenza reale la calcola la view.
			await this.refreshOne(id);
		} catch (err) {
			this.plants = snapshot; // rollback
			this.error = messageOf(err);
			throw err;
		} finally {
			this.markPending(id, false);
		}
	}

	async snooze(id: string, type: CareType, days = 1): Promise<void> {
		const snapshot = this.plants;
		const plant = this.byId(id);
		if (!plant) return;

		const until = addDaysIso(today(), days);
		const optimistic: Plant = { ...plant };
		// Senza la parte `?? until` una pianta mai curata restava con next_* a
		// null e il rinvio non si vedeva finché non tornava la risposta.
		if (type === 'water') {
			optimistic.water_snoozed_until = until;
			if ((optimistic.next_watering ?? until) <= until) optimistic.next_watering = until;
		} else {
			optimistic.fertilize_snoozed_until = until;
			if ((optimistic.next_fertilizing ?? until) <= until) optimistic.next_fertilizing = until;
		}
		this.replace(optimistic);

		this.markPending(id, true);
		try {
			const data = await api.post<{ plant: Plant }>(`/plants/${id}/snooze`, { type, days });
			this.replace(data.plant);
		} catch (err) {
			this.plants = snapshot;
			this.error = messageOf(err);
			throw err;
		} finally {
			this.markPending(id, false);
		}
	}

	async refreshOne(id: string): Promise<void> {
		const data = await api.get<{ plants: Plant[] }>('/plants');
		this.plants = data.plants;
		void id;
	}

	async create(input: PlantInput): Promise<Plant> {
		const data = await api.post<{ plant: Plant }>('/plants', input);
		this.plants = [...this.plants, data.plant];
		return data.plant;
	}

	async update(id: string, input: Partial<PlantInput>): Promise<Plant> {
		const data = await api.patch<{ plant: Plant }>(`/plants/${id}`, input);
		this.replace(data.plant);
		return data.plant;
	}

	async remove(id: string): Promise<void> {
		await api.del(`/plants/${id}`);
		this.plants = this.plants.filter((plant) => plant.id !== id);
	}

	async loadSettings(): Promise<void> {
		// Non rilancia: viene chiamata anche dal layout con `void`, e una promise
		// rifiutata lì diventerebbe un errore non gestito in console.
		try {
			const data = await api.get<{ settings: Settings }>('/settings');
			this.settings = data.settings;
		} catch (err) {
			this.error = messageOf(err);
		}
	}

	async saveSettings(patch: Partial<Settings>): Promise<void> {
		const data = await api.patch<{ settings: Settings }>('/settings', patch);
		this.settings = data.settings;
		// La modalità inverno cambia gli intervalli effettivi di tutte le piante.
		await this.load();
	}
}

function addDaysIso(iso: string, days: number): string {
	const [year, month, day] = iso.split('-').map(Number);
	// Aritmetica sull'epoch invece di mutare un Date: in UTC un giorno è sempre
	// 86.400.000 ms, quindi l'ora legale non sposta il risultato.
	const ms = Date.UTC(year, month - 1, day) + days * 86_400_000;
	return new Date(ms).toISOString().slice(0, 10);
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : 'Errore inatteso';
}

export const plants = new PlantsStore();
