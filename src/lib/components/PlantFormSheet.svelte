<script lang="ts">
	import { untrack } from 'svelte';
	import BottomSheet from './BottomSheet.svelte';
	import type { Plant, PlantInput } from '$lib/types';

	let {
		plant = null,
		onsave,
		onclose
	}: {
		plant?: Plant | null;
		onsave: (input: PlantInput) => Promise<void>;
		onclose: () => void;
	} = $props();

	// untrack: i campi partono dai valori della pianta e poi vivono di vita
	// propria. Senza untrack Svelte avverte che stiamo leggendo una prop
	// reattiva in posizione non reattiva — qui è voluto, il foglio viene
	// rimontato da zero ogni volta che si apre.
	let name = $state(untrack(() => plant?.name ?? ''));
	let emoji = $state(untrack(() => plant?.emoji ?? '🪴'));
	let location = $state(untrack(() => plant?.location ?? ''));
	let notes = $state(untrack(() => plant?.notes ?? ''));
	let watering = $state(untrack(() => plant?.watering_interval_days ?? 7));
	let fertilizeOn = $state(
		untrack(() => (plant ? plant.fertilizing_interval_days !== null : true))
	);
	let fertilizing = $state(untrack(() => plant?.fertilizing_interval_days ?? 30));

	let saving = $state(false);
	let error = $state<string | null>(null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			error = 'Serve almeno il nome';
			return;
		}
		saving = true;
		error = null;
		try {
			await onsave({
				name: name.trim(),
				emoji: emoji.trim() || null,
				location: location.trim() || null,
				notes: notes.trim() || null,
				watering_interval_days: Number(watering),
				fertilizing_interval_days: fertilizeOn ? Number(fertilizing) : null
			});
			onclose();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Salvataggio non riuscito';
		} finally {
			saving = false;
		}
	}
</script>

<BottomSheet
	title={plant ? 'Modifica pianta' : 'Nuova pianta'}
	hint="Solo l'essenziale: nome e ogni quanti giorni."
	{onclose}
>
	<form onsubmit={submit}>
		<div class="field">
			<label for="pf-name">Nome</label>
			<input id="pf-name" bind:value={name} maxlength="60" placeholder="es. Monstera" />
		</div>

		<div class="field">
			<div class="row">
				<div>
					<label for="pf-emoji">Emoji</label>
					<input id="pf-emoji" bind:value={emoji} maxlength="8" />
				</div>
				<div>
					<label for="pf-room">Stanza</label>
					<input id="pf-room" bind:value={location} maxlength="60" placeholder="opzionale" />
				</div>
			</div>
		</div>

		<div class="field">
			<label for="pf-water">Annaffiatura ogni (giorni)</label>
			<input id="pf-water" type="number" min="1" max="365" bind:value={watering} />
		</div>

		<div class="field">
			<div class="switch-row">
				<label for="pf-fert">Concimazione ogni (giorni)</label>
				<button
					type="button"
					class="switch"
					role="switch"
					aria-checked={fertilizeOn}
					aria-label="Attiva concimazione"
					onclick={() => (fertilizeOn = !fertilizeOn)}
				>
					<i></i>
				</button>
			</div>
			<input
				id="pf-fert"
				type="number"
				min="1"
				max="365"
				bind:value={fertilizing}
				disabled={!fertilizeOn}
			/>
		</div>

		<div class="field">
			<label for="pf-notes">Note</label>
			<textarea
				id="pf-notes"
				bind:value={notes}
				maxlength="2000"
				rows="3"
				placeholder="opzionale — es. luce indiretta, terriccio drenante, d'inverno spostare"
			></textarea>
		</div>

		{#if error}<p class="error">{error}</p>{/if}

		<button class="btn btn-primary" type="submit" disabled={saving}>
			{saving ? 'Salvo…' : plant ? 'Salva' : 'Aggiungi'}
		</button>
		<button class="btn btn-secondary cancel" type="button" onclick={onclose}>Annulla</button>
	</form>
</BottomSheet>

<style>
	.switch-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}
	.switch-row label {
		flex: 1;
		margin: 0;
	}
	input[disabled] {
		opacity: 0.45;
	}
	.error {
		color: var(--late);
		font-size: 13px;
		margin-bottom: 10px;
	}
	.cancel {
		margin-top: 8px;
		border: 0;
	}
</style>
