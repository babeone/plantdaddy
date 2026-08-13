<script lang="ts">
	import { DUR, prefersReducedMotion } from '$lib/motion';
	import type { CareType } from '$lib/types';

	/**
	 * Bottone di registrazione immediata. Un solo tap, nessuna conferma.
	 *
	 * La conferma è una micro-animazione sull'icona (scale + fade), non un toast:
	 * registrando cinque piante di fila un toast coprirebbe l'interfaccia cinque
	 * volte. Il feedback :active è CSS puro, quindi risponde al dito prima che
	 * parta qualunque richiesta.
	 */
	let {
		type,
		disabled = false,
		onclick
	}: { type: CareType; disabled?: boolean; onclick: () => void | Promise<void> } = $props();

	let confirming = $state(false);

	const icon = $derived(type === 'water' ? '💧' : '🌾');
	const label = $derived(type === 'water' ? 'Annaffiata' : 'Concimata');

	function handleClick() {
		if (!prefersReducedMotion()) {
			confirming = true;
			setTimeout(() => (confirming = false), DUR.slow + 120);
		}
		// La chiamata parte dopo aver già avviato il feedback: la percezione di
		// velocità nasce da qui, non dai millisecondi reali della rete.
		void onclick();
	}
</script>

<button
	class="btn btn-care"
	class:fert={type === 'fertilize'}
	class:confirming
	{disabled}
	onclick={handleClick}
>
	<span class="icon">{icon}</span>
	<span>{label}</span>
</button>

<style>
	.icon {
		display: inline-block;
		/* will-change solo mentre l'animazione è in corso: lasciarlo fisso su
		   ogni bottone della lista consumerebbe memoria GPU per niente. */
		will-change: auto;
	}
	.confirming .icon {
		animation: confirm var(--dur-slow) var(--ease-back) both;
		will-change: transform, opacity;
	}
	@keyframes confirm {
		0% {
			transform: scale(1);
			opacity: 1;
		}
		40% {
			transform: scale(1.55);
			opacity: 0.65;
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}
	button[disabled] {
		opacity: 0.55;
	}
</style>
