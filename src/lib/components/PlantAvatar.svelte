<script lang="ts">
	import { EMOJI_DEFAULT } from '$lib/emoji';
	import type { Plant } from '$lib/types';

	/**
	 * L'immagine identificativa della pianta: emoji oppure foto.
	 *
	 * FALLBACK: se l'avatar è una foto ma l'oggetto non arriva — archivio spento,
	 * file sparito, rete che cade — l'`onerror` dell'img fa comparire l'emoji al
	 * suo posto. La UI non si rompe e non lascia un rettangolo vuoto: è il
	 * comportamento richiesto quando MinIO è giù.
	 *
	 * L'URL è sempre della NOSTRA origine (`/api/plants/<id>/avatar/...`), quindi
	 * passa la CSP `img-src 'self'` senza bisogno di allargarla. Nessun URL di
	 * MinIO arriva mai al browser.
	 */
	let {
		plant,
		size = 44,
		full = false
	}: { plant: Plant; size?: number; full?: boolean } = $props();

	let rotta = $state(false);

	// La foto è stata sostituita? Cambia avatar_type o cambia pianta: in entrambi i
	// casi si riprova, altrimenti un errore momentaneo resterebbe per sempre.
	const chiave = $derived(`${plant.id}:${plant.avatar_type}`);
	$effect(() => {
		void chiave;
		rotta = false;
	});

	const mostraFoto = $derived(plant.avatar_type === 'photo' && !rotta);
	const src = $derived(`/api/photos/avatar/${plant.id}${full ? '' : '/thumb'}`);
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
