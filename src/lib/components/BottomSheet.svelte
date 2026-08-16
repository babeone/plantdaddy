<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { DUR, EASE_OUT, dur } from '$lib/motion';
	import type { Snippet } from 'svelte';

	let {
		title,
		hint = '',
		onclose,
		children
	}: { title: string; hint?: string; onclose: () => void; children: Snippet } = $props();

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

<!-- Il backdrop è un div con role="presentation": chiuderlo è una scorciatoia,
     la via accessibile è Esc o il bottone Annulla dentro al foglio. -->
<div
	class="backdrop"
	role="presentation"
	onclick={onclose}
	transition:fade={{ duration: dur(DUR.fast) }}
></div>

<div
	class="sheet"
	role="dialog"
	aria-modal="true"
	aria-label={title}
	transition:fly={{ y: 400, duration: dur(DUR.mid), easing: EASE_OUT, opacity: 1 }}
>
	<div class="grabber"></div>
	<h2>{title}</h2>
	{#if hint}<p class="hint">{hint}</p>{/if}
	{@render children()}
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: rgba(4, 12, 8, 0.55);
	}
	/* Centraggio con margin-inline:auto e NON con translateX(-50%): la
	   transizione fly scrive transform, e lo azzererebbe spostando il foglio
	   di mezza larghezza. */
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 41;
		width: min(430px, 100%);
		margin-inline: auto;
		background: var(--surface);
		border-radius: var(--r-xl) var(--r-xl) 0 0;
		padding: 10px calc(18px + var(--safe-r)) calc(22px + var(--safe-b)) calc(18px + var(--safe-l));
		box-shadow: var(--shadow-2);
		/* dvh come il resto dell'app: con vh la barra dinamica di iOS fa
		   sbordare il foglio oltre l'area visibile. */
		max-height: 88dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.grabber {
		width: 38px;
		height: 4px;
		border-radius: 2px;
		background: var(--line);
		margin: 0 auto 14px;
	}
	h2 {
		font-size: 19px;
		margin-bottom: 4px;
		letter-spacing: -0.01em;
		font-family: var(--font-display);
	}
	.hint {
		font-size: 13px;
		color: var(--text-mute);
		margin-bottom: 14px;
	}
</style>
