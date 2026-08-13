<script lang="ts">
	import { resolve } from '$app/paths';
	import CareButton from './CareButton.svelte';
	import StatusPill from './StatusPill.svelte';
	import { dueTypes, plants } from '$lib/stores/plants.svelte';
	import { formatRelative } from '$lib/date';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { CareType, Plant } from '$lib/types';

	let {
		plant,
		showActions = false,
		onpastevent
	}: { plant: Plant; showActions?: boolean; onpastevent?: (plant: Plant) => void } = $props();

	const needs = $derived(dueTypes(plant));
	const busy = $derived(plants.pending.has(plant.id));

	async function care(type: CareType) {
		try {
			await plants.care(plant.id, type);
		} catch {
			toasts.error(plants.error ?? 'Registrazione non riuscita');
		}
	}

	async function snooze() {
		try {
			await plants.snooze(plant.id, needs[0] ?? 'water', 1);
		} catch {
			toasts.error(plants.error ?? 'Rinvio non riuscito');
		}
	}
</script>

<article class="card">
	<a class="card-head" href={resolve('/piante/[id]', { id: plant.id })}>
		<span class="avatar">{plant.emoji ?? '🪴'}</span>
		<span class="card-title">
			<span class="name">{plant.name}</span>
			<span class="room">{plant.location ?? '—'}</span>
		</span>
		<StatusPill {plant} />
	</a>

	<div class="meta-row">
		{#if plant.next_watering}
			<span class="pill water">💧 annaffiatura {formatRelative(plant.next_watering)}</span>
		{:else}
			<span class="pill water">💧 mai annaffiata</span>
		{/if}
		{#if plant.next_fertilizing}
			<span class="pill fert">🌾 concime {formatRelative(plant.next_fertilizing)}</span>
		{:else if plant.fertilizing_interval_days}
			<span class="pill fert">🌾 mai concimata</span>
		{/if}
	</div>

	{#if showActions && needs.length > 0}
		<!-- PRIMARIO: un solo tap, nessun dialog -->
		<div class="actions">
			{#each needs as type (type)}
				<CareButton {type} disabled={busy} onclick={() => care(type)} />
			{/each}
			<button
				class="btn btn-ghost"
				disabled={busy}
				onclick={snooze}
				title="Rimanda a domani"
				aria-label="Rimanda a domani"
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round">
					<path d="M12 8v4l2.5 2.5" />
					<path d="M3.05 11a9 9 0 1 1 .5 4" />
					<path d="M3 4v5h5" />
				</svg>
			</button>
		</div>

		<!-- SECONDARIO: defilato, non intralcia il flusso rapido -->
		<div class="past">
			<button class="btn btn-mini" onclick={() => onpastevent?.(plant)}>
				🗓 + evento passato
			</button>
		</div>
	{/if}
</article>

<style>
	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: 14px;
		box-shadow: var(--shadow-1);
		margin-bottom: 12px;
		/* Salta il rendering fuori viewport. contain-intrinsic-size stimata
		   sull'altezza reale per non far saltare lo scroll. */
		content-visibility: auto;
		contain-intrinsic-size: auto 150px;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 12px;
		text-decoration: none;
		color: inherit;
	}
	.card-title {
		flex: 1;
		min-width: 0;
	}
	.past {
		margin-top: 9px;
		display: flex;
		justify-content: flex-end;
	}
</style>
