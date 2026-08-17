<script lang="ts">
	import { EMOJI_PIANTE } from '$lib/emoji';

	/**
	 * Scelta dell'emoji da un insieme curato.
	 *
	 * Prima il campo era un input di testo libero con maxlength 8: si poteva
	 * scriverci qualunque cosa, e il server accettava. La stessa lista alimenta il
	 * picker e la validazione in $lib/server/schemas, quindi non può capitare che il
	 * picker offra qualcosa che l'API rifiuta.
	 *
	 * radiogroup e non una griglia di bottoni: è una scelta singola fra opzioni note,
	 * ed è così che i lettori di schermo la annunciano.
	 */
	let { value, onpick }: { value: string; onpick: (emoji: string) => void } = $props();
</script>

<div class="picker" role="radiogroup" aria-label="Emoji della pianta">
	{#each EMOJI_PIANTE as emoji (emoji)}
		<button
			type="button"
			role="radio"
			aria-checked={value === emoji}
			aria-label={emoji}
			onclick={() => onpick(emoji)}
		>
			{emoji}
		</button>
	{/each}
</div>

<style>
	/* Griglia a colonne automatiche: sta su 390px senza numeri fissi da mantenere,
	   e scorre in verticale se la lista cresce. */
	.picker {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
		gap: 6px;
		max-height: 148px;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 8px;
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}
	.picker button {
		aspect-ratio: 1;
		font-size: 22px;
		line-height: 1;
		border-radius: var(--r-sm);
		border: 2px solid transparent;
		background: var(--surface);
		display: grid;
		place-items: center;
		transition: transform var(--dur-fast) var(--ease-out);
	}
	.picker button:active {
		transform: scale(0.9);
	}
	.picker button[aria-checked='true'] {
		border-color: var(--brand);
		background: var(--surface);
	}
</style>
