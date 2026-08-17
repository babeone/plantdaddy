<script lang="ts">
	import { EMOJI_DEFAULT } from '$lib/emoji';
	import type { Plant } from '$lib/types';

	/**
	 * L'immagine identificativa della pianta: emoji oppure foto.
	 *
	 * FALLBACK: se l'avatar è una foto ma l'oggetto non arriva — archivio spento,
	 * file sparito, rete che cade — l'`onerror` dell'img fa comparire l'emoji al
	 * suo posto. La UI non si rompe e non lascia un rettangolo vuoto: è il
	 * comportamento richiesto quando l'archivio è giù.
	 *
	 * L'URL è sempre della NOSTRA origine (`/api/plants/<id>/avatar/...`), quindi
	 * passa la CSP `img-src 'self'` senza bisogno di allargarla. Nessun URL di
	 * dell'archivio arriva mai al browser.
	 */
	let {
		plant,
		size = 44,
		full = false
	}: { plant: Plant; size?: number; full?: boolean } = $props();

	let rotta = $state(false);

	// La foto è stata sostituita? Cambia l'id, quindi si riprova: altrimenti un
	// errore momentaneo resterebbe per sempre.
	$effect(() => {
		void plant.avatar_photo_id;
		rotta = false;
	});

	// PRIORITÀ ALLA FOTO: decide la presenza dell'id, non avatar_type. Se c'è una
	// foto si vede quella; l'emoji resta il ripiego per chi non ne ha o per quando
	// l'immagine non si carica.
	const mostraFoto = $derived(plant.avatar_photo_id !== null && !rotta);
	// Indirizzata per ID DELLA FOTO e non per pianta: l'id cambia a ogni
	// sostituzione, quindi il browser scarica la nuova immagine invece di servire
	// quella in cache — che è esattamente il bug per cui "Pianta aggiornata" non
	// cambiava niente a schermo.
	const src = $derived(`/api/photos/${plant.avatar_photo_id}${full ? '' : '/thumb'}`);
</script>

{#if mostraFoto}
	<img
		class="avatar foto"
		style:width="{size}px"
		style:height="{size}px"
		{src}
		alt={plant.name}
		loading="lazy"
		decoding="async"
		onerror={() => (rotta = true)}
	/>
{:else}
	<span
		class="avatar"
		style:width="{size}px"
		style:height="{size}px"
		style:font-size="{Math.round(size * 0.54)}px"
	>
		{plant.emoji ?? EMOJI_DEFAULT}
	</span>
{/if}

<style>
	/* object-fit: cover con aspect-ratio quadrato: le foto verticali e orizzontali
	   riempiono lo stesso cerchio senza deformarsi. */
	.avatar.foto {
		object-fit: cover;
		display: block;
		flex-shrink: 0;
	}
</style>
