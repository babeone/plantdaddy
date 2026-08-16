<script lang="ts">
	import { prefersReducedMotion } from '$lib/motion';

	/**
	 * Trascina verso il basso per aggiornare, senza ricaricare la pagina.
	 *
	 * Nella PWA installata non c'è la barra degli indirizzi, quindi il gesto è
	 * l'unico modo ovvio per forzare un aggiornamento. Quello nativo di Chrome
	 * però ricarica l'intera app: un giro di boot completo per rileggere due
	 * liste, con tutto quello che può andare storto nel frattempo. Qui il gesto
	 * resta identico per l'utente ma chiama solo l'API.
	 *
	 * Il reload nativo è disattivato da `overscroll-behavior-y: contain` su html
	 * (src/app.css), altrimenti partirebbero entrambi.
	 */
	let { onrefresh }: { onrefresh: () => Promise<void> } = $props();

	const THRESHOLD = 70; // px di trascinamento oltre i quali il rilascio aggiorna
	const MAX = 110; // oltre non si tira più: resistenza come nelle app native

	let pull = $state(0);
	let refreshing = $state(false);
	// Serve anche alla UI: durante il trascinamento l'indicatore deve seguire il
	// dito senza transizione, al rilascio invece torna su con la curva dell'app.
	let dragging = $state(false);
	let startY = 0;
	let tracking = false;

	const ready = $derived(pull >= THRESHOLD);
	const visible = $derived(pull > 0 || refreshing);

	function onTouchStart(event: TouchEvent) {
		// Solo se siamo già in cima: altrimenti è uno scroll normale.
		if (window.scrollY > 0 || refreshing || event.touches.length !== 1) return;
		startY = event.touches[0].clientY;
		tracking = true;
		dragging = true;
	}

	function onTouchMove(event: TouchEvent) {
		if (!tracking) return;
		const delta = event.touches[0].clientY - startY;
		if (delta <= 0) {
			pull = 0;
			tracking = false;
			dragging = false;
			return;
		}
		// Resistenza progressiva: il dito corre più della grafica.
		pull = Math.min(MAX, delta * 0.5);
	}

	async function onTouchEnd() {
		if (!tracking) return;
		tracking = false;
		dragging = false;

		if (pull < THRESHOLD) {
			pull = 0;
			return;
		}

		refreshing = true;
		pull = THRESHOLD;
		try {
			await onrefresh();
		} finally {
			refreshing = false;
			pull = 0;
		}
	}

	// La traduzione dell'indicatore è calcolata qui e applicata via transform:
	// nessun ricalcolo di layout durante il trascinamento.
	const translate = $derived(prefersReducedMotion() ? Math.min(pull, THRESHOLD) : pull);
</script>

<svelte:window
	ontouchstart={onTouchStart}
	ontouchmove={onTouchMove}
	ontouchend={onTouchEnd}
	ontouchcancel={onTouchEnd}
/>

{#if visible}
	<div
		class="indicator"
		class:ready
		class:refreshing
		class:dragging
		style:--pull="{translate}px"
		aria-live="polite"
		aria-label={refreshing ? 'Aggiornamento in corso' : 'Trascina per aggiornare'}
	>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		>
			<path d="M3.05 11a9 9 0 1 1 .5 4" />
			<path d="M3 4v5h5" />
		</svg>
	</div>
{/if}

<style>
	/* Il solo elemento che si muove, e si muove con transform + opacity:
	   niente layout, niente repaint dell'app sotto. */
	.indicator {
		position: fixed;
		top: calc(8px + var(--safe-t));
		left: 50%;
		z-index: 25;
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--surface-2);
		border: 1px solid var(--line);
		color: var(--text-mute);
		box-shadow: var(--shadow-1);
		pointer-events: none;
		transform: translate3d(-50%, var(--pull), 0) scale(0.9);
		opacity: 0.75;
		/* Le stesse durate del resto dell'app, prese dalle CSS variables.
		   Durante il trascinamento la transizione è disattivata, altrimenti
		   l'indicatore arriverebbe in ritardo sul dito. */
		transition:
			transform var(--dur-fast) var(--ease-out),
			opacity var(--dur-fast) var(--ease-out);
	}
	.indicator.dragging {
		transition: none;
	}
	.indicator.ready {
		color: var(--brand);
		transform: translate3d(-50%, var(--pull), 0) scale(1);
		opacity: 1;
	}
	.indicator.refreshing {
		animation: spin 900ms linear infinite;
	}
	.indicator svg {
		width: 20px;
		height: 20px;
	}
	@keyframes spin {
		from {
			transform: translate3d(-50%, var(--pull), 0) rotate(0deg);
		}
		to {
			transform: translate3d(-50%, var(--pull), 0) rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.indicator.refreshing {
			animation: none;
		}
	}
</style>
