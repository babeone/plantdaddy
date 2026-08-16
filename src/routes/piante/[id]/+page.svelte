<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { tweened } from 'svelte/motion';
	import CareButton from '$lib/components/CareButton.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import PastEventSheet from '$lib/components/PastEventSheet.svelte';
	import PlantFormSheet from '$lib/components/PlantFormSheet.svelte';
	import StatusPill from '$lib/components/StatusPill.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import { api } from '$lib/api';
	import { formatRelative } from '$lib/date';
	import { DUR, EASE_OUT, dur } from '$lib/motion';
	import { dueTypes, plants } from '$lib/stores/plants.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { CareEvent, CareType } from '$lib/types';

	const plantId = $derived(page.params.id ?? '');
	const plant = $derived(plants.byId(plantId));

	let events = $state<CareEvent[]>([]);
	let loadingEvents = $state(true);
	let eventsError = $state<string | null>(null);
	let editing = $state(false);
	let pastEvent = $state(false);
	let deletingEvent = $state<CareEvent | null>(null);
	let deletingPlant = $state(false);

	/**
	 * Intervallo medio reale: la media delle distanze tra le ultime
	 * annaffiature registrate. Serve a capire se l'intervallo teorico che ho
	 * impostato somiglia a quello che faccio davvero.
	 */
	const realAverage = $derived.by(() => {
		const dates = events
			.filter((event) => event.type === 'water')
			.map((event) => event.event_date)
			.sort()
			.slice(-10);
		if (dates.length < 2) return null;
		let total = 0;
		for (let i = 1; i < dates.length; i++) {
			total += Math.round(
				(new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86_400_000
			);
		}
		return Math.round(total / (dates.length - 1));
	});

	// tweened: il numero si muove invece di saltare quando cambia (per esempio
	// accendendo la modalità inverno, o dopo aver eliminato un evento).
	const shownInterval = tweened(0, { duration: dur(DUR.slow), easing: EASE_OUT });
	const shownAverage = tweened(0, { duration: dur(DUR.slow), easing: EASE_OUT });

	$effect(() => {
		if (plant) shownInterval.set(plant.effective_watering_interval);
	});
	$effect(() => {
		shownAverage.set(realAverage ?? 0);
	});

	$effect(() => {
		// Anche la sessione confermata, non solo l'id: era l'unica chiamata
		// automatica dell'app che partiva senza aspettare il bootstrap, e un 401
		// da lì era indistinguibile da un rifiuto vero.
		if (!plantId || !session.verified) return;
		void loadEvents();
	});

	async function loadEvents() {
		loadingEvents = true;
		eventsError = null;
		try {
			const data = await api.get<{ events: CareEvent[] }>(`/plants/${plantId}/care?limit=100`);
			events = data.events;
		} catch (err) {
			eventsError = err instanceof Error ? err.message : 'Storico non disponibile';
		} finally {
			loadingEvents = false;
		}
	}

	async function care(type: CareType, date?: string, note?: string | null) {
		try {
			await plants.care(plantId, type, date, note);
			await loadEvents();
		} catch {
			toasts.error(plants.error ?? 'Registrazione non riuscita');
		}
	}

	async function confirmDeleteEvent() {
		const target = deletingEvent;
		deletingEvent = null;
		if (!target) return;
		const snapshot = events;
		events = events.filter((event) => event.id !== target.id);
		try {
			await api.del(`/care/${target.id}`);
			await plants.load(); // le date derivate cambiano: la view le ricalcola
		} catch (err) {
			events = snapshot;
			toasts.error(err instanceof Error ? err.message : 'Eliminazione non riuscita');
		}
	}

	async function confirmDeletePlant() {
		deletingPlant = false;
		try {
			await plants.remove(plantId);
			toasts.show('Pianta eliminata');
			await goto(resolve('/piante'));
		} catch (err) {
			toasts.error(err instanceof Error ? err.message : 'Eliminazione non riuscita');
		}
	}
</script>

<header class="topbar">
	<a class="back-btn" href={resolve('/piante')} aria-label="Indietro">
		<svg
			viewBox="0 0 24 24"
			width="20"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		>
			<path d="M15 18l-6-6 6-6" />
		</svg>
	</a>
	<h1>{plant?.name ?? 'Pianta'}</h1>
	{#if plant}
		<button class="back-btn" onclick={() => (editing = true)} aria-label="Modifica">
			<svg
				viewBox="0 0 24 24"
				width="18"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			>
				<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
			</svg>
		</button>
	{/if}
</header>

<div class="scroll">
	{#if !plant}
		{#if plants.loaded}
			<div class="empty"><p>Pianta non trovata.</p></div>
		{/if}
	{:else}
		{#if plants.settings.winter_mode}
			<div class="winter-strip">
				❄️ <span>Inverno attivo: intervalli ×{plants.settings.winter_multiplier}</span>
			</div>
		{/if}

		<article class="card">
			<div class="card-head">
				<span class="avatar big">{plant.emoji ?? '🪴'}</span>
				<span class="card-title">
					<span class="name">{plant.name}</span>
					<span class="room">{plant.location ?? '—'}</span>
				</span>
				<StatusPill {plant} />
			</div>

			<div class="actions">
				<CareButton
					type="water"
					disabled={plants.pending.has(plantId)}
					onclick={() => care('water')}
				/>
				{#if plant.fertilizing_interval_days !== null}
					<CareButton
						type="fertilize"
						disabled={plants.pending.has(plantId)}
						onclick={() => care('fertilize')}
					/>
				{/if}
			</div>

			<div class="secondary">
				<button class="btn btn-mini" onclick={() => (pastEvent = true)}>🗓 + evento passato</button>
				{#if dueTypes(plant).length > 0}
					<button
						class="btn btn-mini"
						disabled={plants.pending.has(plantId)}
						onclick={async () => {
							try {
								await plants.snooze(plantId, dueTypes(plant)[0], 1);
								toasts.show('Rimandata a domani');
							} catch {
								toasts.error(plants.error ?? 'Rinvio non riuscito');
							}
						}}
					>
						😴 Rimanda a domani
					</button>
				{/if}
			</div>
		</article>

		{#if plant.notes}
			<div class="group-title">Note</div>
			<!-- Testo dell'utente: interpolato, mai {@html}. white-space: pre-wrap
			     tiene gli a capo che ha scritto senza permettere altro. -->
			<div class="card"><p class="notes">{plant.notes}</p></div>
		{/if}

		<div class="group-title">Ritmo</div>
		<div class="stat-grid">
			<div class="stat">
				<b>{Math.round($shownInterval)}g</b>
				<small>Intervallo impostato{plants.settings.winter_mode ? ' (inverno)' : ''}</small>
			</div>
			<div class="stat">
				<b>{realAverage === null ? '—' : `${Math.round($shownAverage)}g`}</b>
				<small>Media reale ultime volte</small>
			</div>
			<div class="stat">
				<b>{plant.last_watered ? formatRelative(plant.last_watered) : 'mai'}</b>
				<small>Ultima annaffiatura</small>
			</div>
			<div class="stat">
				<b>
					{plant.fertilizing_interval_days === null
						? '—'
						: plant.last_fertilized
							? formatRelative(plant.last_fertilized)
							: 'mai'}
				</b>
				<small>Ultima concimazione</small>
			</div>
		</div>

		{#if realAverage !== null && Math.abs(realAverage - plant.effective_watering_interval) >= 2}
			<div class="warn spaced">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="9" />
					<path d="M12 8v5M12 16h.01" />
				</svg>
				<div>
					In pratica la annaffi ogni <b>{realAverage} giorni</b>, non ogni
					{plant.effective_watering_interval}. L'intervallo impostato forse non è realistico.
				</div>
			</div>
		{/if}

		{#if plant.water_snoozed_until}
			<div class="warn muted spaced">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="9" />
					<path d="M12 8v4l2.5 2.5" />
				</svg>
				<div>Annaffiatura rimandata a {formatRelative(plant.water_snoozed_until)}.</div>
			</div>
		{/if}

		{#if plant.fertilize_snoozed_until}
			<div class="warn muted spaced">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="9" />
					<path d="M12 8v4l2.5 2.5" />
				</svg>
				<div>Concimazione rimandata a {formatRelative(plant.fertilize_snoozed_until)}.</div>
			</div>
		{/if}

		<div class="group-title">Storico ({events.length} eventi)</div>
		<div class="card">
			{#if loadingEvents}
				<p class="muted-text">Carico lo storico…</p>
			{:else if eventsError}
				<p class="muted-text">{eventsError}</p>
			{:else if events.length === 0}
				<p class="muted-text">Nessun evento registrato.</p>
			{:else}
				<Timeline {events} ondelete={(event) => (deletingEvent = event)} />
			{/if}
			<div class="divider"></div>
			<p class="muted-text">
				Le date "ultima cura" sono ricavate da questo storico: eliminando un evento la scadenza
				torna automaticamente a quella precedente. Tieni premuto su una riga per eliminarla.
			</p>
		</div>

		<button class="btn btn-secondary btn-danger" onclick={() => (deletingPlant = true)}>
			Elimina pianta
		</button>
	{/if}
</div>

{#if editing && plant}
	<PlantFormSheet
		{plant}
		onclose={() => (editing = false)}
		onsave={async (input) => {
			await plants.update(plantId, input);
			toasts.show('Pianta aggiornata');
		}}
	/>
{/if}

{#if pastEvent && plant}
	<PastEventSheet
		{plant}
		onclose={() => (pastEvent = false)}
		onsave={async ({ type, date, note }) => care(type, date, note)}
	/>
{/if}

{#if deletingEvent}
	<ConfirmDialog
		title="Eliminare l'evento?"
		message="Sparisce dallo storico e la data di ultima cura torna a quella precedente."
		confirmLabel="Elimina evento"
		danger
		onconfirm={confirmDeleteEvent}
		oncancel={() => (deletingEvent = null)}
	/>
{/if}

{#if deletingPlant}
	<ConfirmDialog
		title="Eliminare {plant?.name}?"
		message="Vengono cancellati anche tutti i suoi eventi di cura. Non è recuperabile."
		confirmLabel="Elimina pianta"
		danger
		onconfirm={confirmDeletePlant}
		oncancel={() => (deletingPlant = false)}
	/>
{/if}

<style>
	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: 14px;
		box-shadow: var(--shadow-1);
		margin-bottom: 12px;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.avatar.big {
		width: 56px;
		height: 56px;
		font-size: 30px;
	}
	.card-title .name {
		font-size: 19px;
	}
	.secondary {
		margin-top: 9px;
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.warn.spaced {
		margin-top: 12px;
	}
	.warn.muted {
		background: var(--surface-2);
		color: var(--text-dim);
	}
	.muted-text {
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.notes {
		font-size: 14px;
		line-height: 1.55;
		color: var(--text-dim);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.winter-strip span {
		flex: 1;
	}
</style>
