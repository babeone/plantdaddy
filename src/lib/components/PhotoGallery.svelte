<script lang="ts">
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { api } from '$lib/api';
	import { daysFromToday } from '$lib/date';
	import { toasts } from '$lib/stores/toast.svelte';
	import type { PhotoSlots, Plant, PlantPhoto } from '$lib/types';

	/**
	 * Diario di crescita: le foto della pianta più lo stato degli slot.
	 *
	 * Gli slot arrivano SEMPRE dal server (`slots` nella risposta): maturati, usati,
	 * liberi e la data del prossimo. Non si ricalcola nulla qui — sarebbe una
	 * seconda implementazione dell'aritmetica dei mesi, destinata a divergere da
	 * quella del trigger in migrazione 009, e la divergenza si vedrebbe come "la UI
	 * dice che c'è posto, il server dice no".
	 */
	let { plant }: { plant: Plant } = $props();

	let photos = $state<PlantPhoto[]>([]);
	let slots = $state<PhotoSlots | null>(null);
	let loading = $state(true);
	let uploading = $state(false);
	let error = $state<string | null>(null);
	let daEliminare = $state<PlantPhoto | null>(null);
	let aperta = $state<PlantPhoto | null>(null);

	$effect(() => {
		void plant.id;
		void carica();
	});

	async function carica() {
		loading = true;
		error = null;
		try {
			const data = await api.get<{ photos: PlantPhoto[]; slots: PhotoSlots }>(
				`/plants/${plant.id}/photos`
			);
			photos = data.photos;
			slots = data.slots;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Foto non disponibili';
		} finally {
			loading = false;
		}
	}

	async function carica_file(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Si azzera subito: senza, riscegliere lo stesso file non fa scattare change.
		input.value = '';
		if (!file) return;

		uploading = true;
		error = null;
		try {
			const data = await api.upload<{ photo: PlantPhoto; slots: PhotoSlots }>(
				`/plants/${plant.id}/photos`,
				file
			);
			photos = [data.photo, ...photos];
			slots = data.slots;
			toasts.show('Foto aggiunta al diario');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Caricamento non riuscito';
		} finally {
			uploading = false;
		}
	}

	async function elimina() {
		const target = daEliminare;
		daEliminare = null;
		if (!target) return;
		try {
			const data = await api.del<{ slots: PhotoSlots }>(`/photos/${target.id}`);
			photos = photos.filter((p) => p.id !== target.id);
			slots = data.slots;
			toasts.show('Foto eliminata');
		} catch (err) {
			toasts.error(err instanceof Error ? err.message : 'Eliminazione non riuscita');
		}
	}

	const prossimo = $derived.by(() => {
		if (!slots?.next_slot_at) return null;
		const giorni = daysFromToday(slots.next_slot_at.slice(0, 10));
		if (giorni <= 0) return 'oggi';
		if (giorni === 1) return 'domani';
		return `tra ${giorni} giorni`;
	});

	const dataDi = (iso: string) => new Date(iso).toLocaleDateString('it-IT');
</script>

<div class="group-title">
	Diario di crescita
	{#if slots}<span class="conteggio">{slots.used} di {slots.total}</span>{/if}
</div>

<div class="card">
	{#if loading}
		<p class="muted-text">Carico le foto…</p>
	{:else}
		{#if photos.length > 0}
			<!-- Si chiede la THUMBNAIL, ~38 KB: una griglia di full-size da 380 KB
			     sarebbe mezzo megabyte per schermata senza motivo. -->
			<ul class="griglia">
				{#each photos as foto (foto.id)}
					<li>
						<button
							class="scatto"
							onclick={() => (aperta = foto)}
							aria-label="Apri la foto del {dataDi(foto.created_at)}"
						>
							<img
								src="/api/photos/{foto.id}/thumb"
								alt="Foto del {dataDi(foto.created_at)}"
								loading="lazy"
								decoding="async"
							/>
							<span class="quando">{dataDi(foto.created_at)}</span>
						</button>
						<button
							class="cestino"
							onclick={() => (daEliminare = foto)}
							aria-label="Elimina la foto del {dataDi(foto.created_at)}"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
							>
								<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
							</svg>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if error}<p class="error">{error}</p>{/if}

		{#if slots && slots.free > 0}
			<label class="btn btn-primary carica" for="pg-file">
				{uploading
					? 'Elaboro la foto…'
					: `📷 Aggiungi foto (${slots.free} liber${slots.free === 1 ? 'o' : 'i'})`}
			</label>
			<input
				id="pg-file"
				class="file-nascosto"
				type="file"
				accept="image/*"
				disabled={uploading}
				onchange={carica_file}
			/>
		{:else if slots}
			<p class="muted-text">
				{#if photos.length === 0}
					Nessuno slot disponibile.
				{:else}
					Hai usato tutti gli slot maturati.
				{/if}
				{#if prossimo}
					Il prossimo si libera <b>{prossimo}</b>.
				{:else}
					Elimina una foto per liberare uno slot.
				{/if}
			</p>
		{/if}

		<div class="divider"></div>
		<p class="muted-text">
			Uno slot alla creazione, poi uno ogni tre mesi. Eliminando una foto lo slot torna disponibile.
			Le foto vengono rimpicciolite e i dati di posizione rimossi prima di salvarle.
		</p>
	{/if}
</div>

{#if aperta}
	<!-- Il full-size si scarica SOLO qui, quando l'utente lo chiede davvero. -->
	<div class="lente" role="dialog" aria-modal="true" aria-label="Foto ingrandita">
		<button class="chiudi" onclick={() => (aperta = null)} aria-label="Chiudi">✕</button>
		<img src="/api/photos/{aperta.id}" alt="Foto del {dataDi(aperta.created_at)}" />
		<span class="lente-data">{dataDi(aperta.created_at)}</span>
	</div>
{/if}

{#if daEliminare}
	<ConfirmDialog
		title="Eliminare la foto?"
		message="Viene rimossa anche dall'archivio, e lo slot torna disponibile. Non è recuperabile."
		confirmLabel="Elimina foto"
		danger
		onconfirm={elimina}
		oncancel={() => (daEliminare = null)}
	/>
{/if}

<style>
	.conteggio {
		float: right;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 500;
	}
	.griglia {
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		gap: 8px;
		margin-bottom: 12px;
	}
	.griglia li {
		position: relative;
	}
	.scatto {
		display: block;
		width: 100%;
		border-radius: var(--r-md);
		overflow: hidden;
		background: var(--surface-2);
		border: 1px solid var(--line);
	}
	.scatto img {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
	}
	.quando {
		display: block;
		font-size: 10.5px;
		color: var(--text-mute);
		padding: 4px 0 5px;
		font-variant-numeric: tabular-nums;
	}
	.cestino {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: rgba(4, 12, 8, 0.66);
		color: #fff;
	}
	.cestino svg {
		width: 14px;
		height: 14px;
	}
	.carica {
		display: block;
		text-align: center;
	}
	.file-nascosto {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.lente {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: rgba(4, 12, 8, 0.94);
		display: grid;
		place-items: center;
		padding: calc(20px + var(--safe-t)) 16px calc(20px + var(--safe-b));
	}
	.lente img {
		max-width: 100%;
		max-height: 80dvh;
		border-radius: var(--r-md);
		object-fit: contain;
	}
	.lente-data {
		position: absolute;
		bottom: calc(24px + var(--safe-b));
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.chiudi {
		position: absolute;
		top: calc(14px + var(--safe-t));
		right: 16px;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--surface);
		color: var(--text);
		font-size: 15px;
	}
</style>
