<script lang="ts">
	import { untrack } from 'svelte';
	import BottomSheet from './BottomSheet.svelte';
	import EmojiPicker from './EmojiPicker.svelte';
	import { EMOJI_DEFAULT } from '$lib/emoji';
	import type { Plant, PlantInput } from '$lib/types';

	let {
		plant = null,
		onsave,
		onclose
	}: {
		plant?: Plant | null;
		/**
		 * `avatar` è il file scelto dall'utente, se ha preferito una foto all'emoji.
		 * Non si carica da qui: per una pianta nuova l'id non esiste ancora, quindi
		 * il caricamento avviene DOPO la creazione ed è il chiamante a orchestrarlo.
		 */
		onsave: (input: PlantInput, avatar?: File | null) => Promise<void>;
		onclose: () => void;
	} = $props();

	// untrack: i campi partono dai valori della pianta e poi vivono di vita
	// propria. Senza untrack Svelte avverte che stiamo leggendo una prop
	// reattiva in posizione non reattiva — qui è voluto, il foglio viene
	// rimontato da zero ogni volta che si apre.
	let name = $state(untrack(() => plant?.name ?? ''));
	let emoji = $state(untrack(() => plant?.emoji ?? EMOJI_DEFAULT));
	let location = $state(untrack(() => plant?.location ?? ''));
	let notes = $state(untrack(() => plant?.notes ?? ''));
	let watering = $state(untrack(() => plant?.watering_interval_days ?? 7));
	let fertilizeOn = $state(
		untrack(() => (plant ? plant.fertilizing_interval_days !== null : true))
	);
	let fertilizing = $state(untrack(() => plant?.fertilizing_interval_days ?? 30));

	/** 'emoji' o 'photo': quale immagine identifica la pianta. */
	let avatarMode = $state(untrack(() => plant?.avatar_type ?? 'emoji'));
	let avatarFile = $state<File | null>(null);
	let avatarPreview = $state<string | null>(null);

	let saving = $state(false);
	let error = $state<string | null>(null);

	function scegliFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		if (avatarPreview) URL.revokeObjectURL(avatarPreview);
		avatarFile = file;
		// blob: e non un data URL: la CSP ha img-src 'self' blob: e non ammette
		// data:. È anche più economico, non serializza il file in base64.
		avatarPreview = file ? URL.createObjectURL(file) : null;
		if (file) avatarMode = 'photo';
	}

	// L'URL del blob va revocato, altrimenti il file resta in memoria finché la
	// scheda è aperta.
	$effect(() => () => {
		if (avatarPreview) URL.revokeObjectURL(avatarPreview);
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			error = 'Serve almeno il nome';
			return;
		}
		saving = true;
		error = null;
		try {
			await onsave(
				{
					name: name.trim(),
					emoji: emoji.trim() || null,
					location: location.trim() || null,
					notes: notes.trim() || null,
					watering_interval_days: Number(watering),
					fertilizing_interval_days: fertilizeOn ? Number(fertilizing) : null
				},
				avatarMode === 'photo' ? avatarFile : null
			);
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
			<span class="label-like">Immagine</span>
			<div class="seg">
				<button
					type="button"
					aria-pressed={avatarMode === 'emoji'}
					onclick={() => (avatarMode = 'emoji')}
				>
					{emoji} Emoji
				</button>
				<button
					type="button"
					aria-pressed={avatarMode === 'photo'}
					onclick={() => (avatarMode = 'photo')}
				>
					📷 Foto
				</button>
			</div>

			{#if avatarMode === 'emoji'}
				<EmojiPicker value={emoji} onpick={(scelta) => (emoji = scelta)} />
			{:else}
				<!-- Anteprima SOPRA e bottone a piena larghezza sotto, non affiancati:
				     a 390px la riga orizzontale lasciava al bottone ~200px, e
				     "Scegli una foto" ci andava a capo dentro. -->
				<div class="foto-blocco">
					{#if avatarPreview}
						<img class="anteprima" src={avatarPreview} alt="Anteprima della foto scelta" />
					{:else if plant?.avatar_photo_id}
						<img
							class="anteprima"
							src="/api/photos/{plant.avatar_photo_id}/thumb"
							alt="Foto attuale della pianta"
						/>
					{:else}
						<span class="anteprima vuota">📷</span>
					{/if}

					<!-- accept="image/*" e non un elenco di estensioni: su iOS è ciò che
					     fa convertire l'HEIC in JPEG durante il caricamento. -->
					<label class="btn btn-secondary" for="pf-avatar">
						{avatarFile || plant?.avatar_photo_id ? 'Cambia foto' : 'Scegli una foto'}
					</label>
					<input
						id="pf-avatar"
						class="file-nascosto"
						type="file"
						accept="image/*"
						onchange={scegliFile}
					/>

					{#if avatarFile}
						<small class="scelto">{avatarFile.name}</small>
					{:else}
						<small>Massimo 15 MB. Le foto vengono rimpicciolite e i dati GPS rimossi.</small>
					{/if}
				</div>
			{/if}
		</div>

		<div class="field">
			<label for="pf-room">Stanza</label>
			<input id="pf-room" bind:value={location} maxlength="60" placeholder="opzionale" />
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
	.cancel {
		margin-top: 8px;
		border: 0;
	}
	/* Stessa resa di .field label, ma su uno span: non etichetta un singolo
	   controllo, quindi un <label> sarebbe scorretto per i lettori di schermo. */
	.label-like {
		display: block;
		font-size: 13px;
		font-weight: 650;
		color: var(--text-dim);
		margin-bottom: 6px;
	}
	.seg {
		margin-bottom: 8px;
	}
	.foto-blocco {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 12px;
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}
	.anteprima {
		width: 96px;
		height: 96px;
		border-radius: var(--r-md);
		object-fit: cover;
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.anteprima.vuota {
		display: grid;
		place-items: center;
		font-size: 34px;
		opacity: 0.5;
	}
	.foto-blocco small {
		font-size: 11.5px;
		color: var(--text-mute);
		text-align: center;
		line-height: 1.35;
	}
	/* Il nome del file può essere lunghissimo: si tronca invece di allargare il
	   riquadro oltre la larghezza del foglio. */
	.foto-blocco small.scelto {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-dim);
	}
	/* L'input file nativo non si può stilare: si nasconde e si usa la <label>
	   come bottone, che apre il selettore comunque. */
	.file-nascosto {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
</style>
