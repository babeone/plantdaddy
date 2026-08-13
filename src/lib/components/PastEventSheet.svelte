<script lang="ts">
	import BottomSheet from './BottomSheet.svelte';
	import { today } from '$lib/date';
	import type { CareType, Plant } from '$lib/types';

	/**
	 * Inserimento retroattivo. È volutamente un percorso separato e più lento del
	 * tap immediato: form, data, tipo, nota. Non deve mai intralciare il flusso
	 * rapido, che resta un solo tap sulla card.
	 */
	let {
		plant,
		onsave,
		onclose
	}: {
		plant: Plant;
		onsave: (input: { type: CareType; date: string; note: string | null }) => Promise<void>;
		onclose: () => void;
	} = $props();

	let type = $state<CareType>('water');
	let date = $state(today());
	let note = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		error = null;
		try {
			await onsave({ type, date, note: note.trim() || null });
			onclose();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Salvataggio non riuscito';
		} finally {
			saving = false;
		}
	}
</script>

<BottomSheet
	title="Evento passato"
	hint="{plant.name} — registra una cura che avevi dimenticato di segnare."
	{onclose}
>
	<form onsubmit={submit}>
		<div class="field">
			<span class="label">Tipo</span>
			<div class="seg">
				<button
					type="button"
					class="w"
					aria-pressed={type === 'water'}
					onclick={() => (type = 'water')}
				>
					💧 Annaffiata
				</button>
				<button
					type="button"
					class="f"
					aria-pressed={type === 'fertilize'}
					disabled={plant.fertilizing_interval_days === null}
					onclick={() => (type = 'fertilize')}
				>
					🌾 Concimata
				</button>
			</div>
		</div>

		<div class="field">
			<label for="pe-date">Data</label>
			<!-- input type=date nativo: niente librerie di calendario, e su mobile
			     apre il selettore di sistema, che è già quello che l'utente conosce -->
			<input id="pe-date" type="date" bind:value={date} max={today()} />
		</div>

		<div class="field">
			<label for="pe-note">Nota (opzionale)</label>
			<input
				id="pe-note"
				bind:value={note}
				maxlength="280"
				placeholder="es. poca acqua, terra ancora umida"
			/>
		</div>

		{#if error}<p class="error">{error}</p>{/if}

		<button class="btn btn-primary" type="submit" disabled={saving}>
			{saving ? 'Salvo…' : 'Salva evento'}
		</button>
		<button class="btn btn-secondary cancel" type="button" onclick={onclose}>Annulla</button>
	</form>
</BottomSheet>

<style>
	.label {
		display: block;
		font-size: 13px;
		font-weight: 650;
		color: var(--text-dim);
		margin-bottom: 6px;
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
	button[disabled] {
		opacity: 0.4;
	}
</style>
