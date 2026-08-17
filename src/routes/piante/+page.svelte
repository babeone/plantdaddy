<script lang="ts">
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import Logo from '$lib/components/Logo.svelte';
	import PlantCard from '$lib/components/PlantCard.svelte';
	import PlantFormSheet from '$lib/components/PlantFormSheet.svelte';
	import { DUR, EASE_OUT, dur, staggerDelay } from '$lib/motion';
	import { plants } from '$lib/stores/plants.svelte';
	import { toasts } from '$lib/stores/toast.svelte';

	let creating = $state(false);

	const sorted = $derived(
		[...plants.plants].sort((a, b) => {
			const aDue = a.next_watering ?? '0000-00-00';
			const bDue = b.next_watering ?? '0000-00-00';
			return aDue.localeCompare(bDue) || a.name.localeCompare(b.name);
		})
	);
</script>

<header class="topbar">
	<Logo size={30} />
	<h1>Le mie piante</h1>
	{#if plants.settings.winter_mode}
		<span class="winter-chip">❄️ ×{plants.settings.winter_multiplier}</span>
	{/if}
</header>

<div class="scroll">
	{#if plants.settings.winter_mode}
		<div class="winter-strip">
			❄️ <span>Modalità inverno attiva: intervalli ×{plants.settings.winter_multiplier}</span>
		</div>
	{/if}

	{#if sorted.length === 0 && plants.loaded}
		<div class="empty">
			<div class="ico"><Logo size={96} /></div>
			<p>Nessuna pianta.<br />Aggiungi la prima col bottone in basso.</p>
		</div>
	{/if}

	{#each sorted as plant, index (plant.id)}
		<div
			animate:flip={{ duration: dur(DUR.mid), easing: EASE_OUT }}
			in:fly={{ y: 14, duration: dur(DUR.slow), delay: staggerDelay(index), easing: EASE_OUT }}
			out:fly={{ y: -8, duration: dur(DUR.mid), easing: EASE_OUT }}
		>
			<PlantCard {plant} />
		</div>
	{/each}
</div>

<button class="fab" onclick={() => (creating = true)} aria-label="Aggiungi pianta">
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round">
		<path d="M12 5v14M5 12h14" />
	</svg>
</button>

{#if creating}
	<PlantFormSheet
		onclose={() => (creating = false)}
		onsave={async (input, avatar) => {
			const creata = await plants.create(input);
			// La foto si carica DOPO: l'endpoint dell'avatar ha bisogno dell'id, che
			// prima della create non esiste. Se il caricamento fallisce la pianta
			// resta creata con la sua emoji, e si riprova dal dettaglio: preferibile
			// a perdere tutto il resto del form.
			if (avatar) {
				try {
					await plants.setAvatarPhoto(creata.id, avatar);
				} catch (err) {
					toasts.error(err instanceof Error ? err.message : 'Foto non caricata');
				}
			}
			toasts.show('Pianta aggiunta');
		}}
	/>
{/if}
