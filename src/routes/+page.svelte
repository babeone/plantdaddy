<script lang="ts">
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { resolve } from '$app/paths';
	import Logo from '$lib/components/Logo.svelte';
	import PlantCard from '$lib/components/PlantCard.svelte';
	import PastEventSheet from '$lib/components/PastEventSheet.svelte';
	import { DUR, EASE_OUT, dur, staggerDelay } from '$lib/motion';
	import { plants } from '$lib/stores/plants.svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { Plant } from '$lib/types';

	let pastEventFor = $state<Plant | null>(null);

	const dueCount = $derived(plants.due.length);
	const oggi = new Date().toLocaleDateString('it-IT', {
		weekday: 'short',
		day: 'numeric',
		month: 'short'
	});
</script>

<header class="topbar topbar-home">
	<span class="logo-badge"><Logo size={42} /></span>
	<div class="brand">
		PlantDaddy
		<small>
			{#if plants.loading && !plants.loaded}
				caricamento…
			{:else if dueCount === 0}
				niente da fare oggi
			{:else}
				{dueCount} {dueCount === 1 ? 'pianta' : 'piante'} da curare
			{/if}
		</small>
	</div>
	{#if plants.settings.winter_mode}
		<span class="winter-chip">❄️ ×{plants.settings.winter_multiplier}</span>
	{/if}
	<div class="date">{oggi}</div>
</header>

<div class="scroll">
	{#if plants.settings.winter_mode}
		<div class="winter-strip">
			❄️
			<span>Modalità inverno attiva: intervalli ×{plants.settings.winter_multiplier}</span>
			<a class="btn btn-mini solid" href={resolve('/impostazioni')}>Gestisci</a>
		</div>
	{/if}

	{#if plants.error && !plants.loaded}
		<div class="warn">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="9" />
				<path d="M12 8v5M12 16h.01" />
			</svg>
			<div>
				{plants.error}
				<button class="btn btn-mini solid retry" onclick={() => plants.load()}>Riprova</button>
			</div>
		</div>
	{:else if plants.loading && !plants.loaded}
		<!-- Scheletro invece di uno spinner: la pagina non salta quando arrivano i dati -->
		{#each [0, 1, 2] as index (index)}
			<div class="skeleton"></div>
		{/each}
	{:else if dueCount === 0}
		<div class="empty">
			<div class="ico"><Logo size={96} /></div>
			<p>Tutto a posto.<br />Nessuna pianta da curare oggi.</p>
		</div>
	{:else}
		{#each plants.due as plant, index (plant.id)}
			<div
				animate:flip={{ duration: dur(DUR.mid), easing: EASE_OUT }}
				in:fly={{ y: 14, duration: dur(DUR.slow), delay: staggerDelay(index), easing: EASE_OUT }}
				out:fly={{ y: -8, duration: dur(DUR.mid), easing: EASE_OUT }}
			>
				<PlantCard {plant} showActions onpastevent={(p) => (pastEventFor = p)} />
			</div>
		{/each}
	{/if}
</div>

{#if pastEventFor}
	<PastEventSheet
		plant={pastEventFor}
		onclose={() => (pastEventFor = null)}
		onsave={async ({ type, date, note }) => {
			await plants.care(pastEventFor!.id, type, date, note);
			toasts.show('Evento aggiunto allo storico');
		}}
	/>
{/if}

<style>
	.winter-strip span {
		flex: 1;
	}
	.btn-mini.solid {
		border-style: solid;
		text-decoration: none;
	}
	.retry {
		display: inline-block;
		margin-top: 8px;
	}
	.skeleton {
		height: 150px;
		border-radius: var(--r-lg);
		background: var(--surface);
		border: 1px solid var(--line);
		margin-bottom: 12px;
		opacity: 0.55;
		animation: pulse 1.4s ease-in-out infinite;
	}
	/* Solo opacity: nessun ricalcolo di layout mentre pulsa */
	@keyframes pulse {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 0.6;
		}
	}
</style>
