<script lang="ts">
	import { fly } from 'svelte/transition';
	import Logo from './Logo.svelte';
	import { DUR, EASE_OUT, dur } from '$lib/motion';
	import { install } from '$lib/stores/install.svelte';

	let { onguide }: { onguide: () => void } = $props();

	async function primary() {
		if (install.canPrompt) {
			const outcome = await install.promptInstall();
			// Se l'utente annulla, il banner resta: non è un rifiuto definitivo.
			if (outcome === 'unavailable') onguide();
		} else {
			onguide();
		}
	}
</script>

{#if install.shouldShowBanner}
	<div class="banner" transition:fly={{ y: 24, duration: dur(DUR.slow), easing: EASE_OUT }}>
		<div class="inner">
			<Logo size={30} />
			<div class="text">
				<b>Installa PlantDaddy</b>
				<small>
					{install.canPrompt ? 'Un tap e la aggiungi alla Home' : 'Serve per ricevere le notifiche'}
				</small>
			</div>
			<button class="cta" onclick={primary}>{install.canPrompt ? 'Installa' : 'Come'}</button>
			<button class="x" onclick={() => install.dismiss()} aria-label="Chiudi">
				<svg
					viewBox="0 0 24 24"
					width="17"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				>
					<path d="M18 6 6 18M6 6l12 12" />
				</svg>
			</button>
		</div>
	</div>
{/if}

<style>
	/* Sopra la tabbar, senza coprirla. Chiuso resta chiuso: la scelta è in
	   localStorage e si riapre solo da Impostazioni. */
	.banner {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(94px + var(--safe-b));
		width: min(430px, 100%);
		margin-inline: auto;
		padding: 0 calc(12px + var(--safe-r)) 0 calc(12px + var(--safe-l));
		z-index: 30;
	}
	.inner {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-2);
		padding: 13px 14px;
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.text {
		flex: 1;
		min-width: 0;
	}
	.text b {
		font-size: 14.5px;
		display: block;
	}
	.text small {
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.cta {
		flex: none;
		background: var(--brand);
		color: var(--brand-ink);
		padding: 10px 14px;
		border-radius: var(--r-md);
		font-weight: 650;
		font-size: 14px;
		transition: transform var(--dur-fast) var(--ease-out);
	}
	.cta:active {
		transform: scale(0.97);
	}
	.x {
		width: 30px;
		height: 30px;
		flex: none;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: var(--text-mute);
		transition: transform var(--dur-fast) var(--ease-out);
	}
	.x:active {
		transform: scale(0.85);
	}
</style>
