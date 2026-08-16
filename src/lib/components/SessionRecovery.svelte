<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fade, fly } from 'svelte/transition';
	import Logo from './Logo.svelte';
	import { DUR, EASE_OUT, dur } from '$lib/motion';
	import { today } from '$lib/date';
	import { downloadQrPng, drawQr } from '$lib/qr';
	import { session } from '$lib/stores/session.svelte';
	import { plants } from '$lib/stores/plants.svelte';

	/**
	 * Compare quando il server risponde che la sessione non esiste.
	 *
	 * Il token NON viene cancellato: resta in localStorage e nel cookie, e da qui
	 * l'utente può rileggerlo, salvarne il QR, riprovare, oppure decidere lui di
	 * usarne un altro. Un rifiuto può arrivare anche per cause temporanee — un
	 * database ripristinato, un proxy che perde l'header — e senza account
	 * buttare via il token significherebbe perdere i dati per sempre.
	 */
	let retrying = $state(false);
	let showCode = $state(false);
	let canvas = $state<HTMLCanvasElement | null>(null);

	$effect(() => {
		if (showCode && canvas && session.token) void drawQr(canvas, session.token);
	});

	async function retry() {
		retrying = true;
		try {
			const valid = await session.verify();
			if (valid) {
				session.clearRejected();
				await plants.load();
				await plants.loadSettings();
			}
		} finally {
			retrying = false;
		}
	}

	async function useAnotherCode() {
		// L'unico punto in cui cancellare è legittimo: lo ha chiesto l'utente.
		session.clear();
		await goto(resolve('/ripristina'));
	}
</script>

<div class="backdrop" transition:fade={{ duration: dur(DUR.fast) }}></div>

<div
	class="panel"
	role="alertdialog"
	aria-modal="true"
	aria-label="Sessione non riconosciuta"
	transition:fly={{ y: 24, duration: dur(DUR.mid), easing: EASE_OUT }}
>
	<Logo size={64} />
	<h2>Il server non riconosce questa sessione</h2>
	<p>
		Il tuo codice è ancora salvato su questo dispositivo, non è andato perso. Può capitare se il
		server è stato ripristinato o se la connessione ha perso qualcosa per strada.
	</p>

	<button class="btn btn-primary" onclick={retry} disabled={retrying}>
		{retrying ? 'Riprovo…' : 'Riprova'}
	</button>

	<button class="btn btn-secondary" onclick={() => (showCode = !showCode)}>
		{showCode ? 'Nascondi il codice' : 'Mostra il mio codice'}
	</button>

	{#if showCode}
		<div class="code" transition:fly={{ y: -8, duration: dur(DUR.fast), easing: EASE_OUT }}>
			<div class="token-code">{session.token}</div>
			<div class="qr-wrap">
				<canvas bind:this={canvas} width="320" height="320" aria-label="QR del codice sessione"
				></canvas>
			</div>
			<div class="pair">
				<button
					class="btn btn-secondary"
					onclick={async () => {
						if (session.token) await navigator.clipboard.writeText(session.token);
					}}
				>
					Copia
				</button>
				<button
					class="btn btn-secondary"
					onclick={() => canvas && downloadQrPng(canvas, `plantdaddy-codice-${today()}.png`)}
				>
					Scarica QR
				</button>
			</div>
			<p class="hint">Salvalo prima di fare qualsiasi altra cosa.</p>
		</div>
	{/if}

	<button class="btn btn-secondary quiet" onclick={useAnotherCode}>Usa un altro codice</button>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: rgba(4, 12, 8, 0.75);
	}
	.panel {
		position: fixed;
		z-index: 71;
		inset-inline: 0;
		bottom: 0;
		width: min(430px, 100%);
		margin-inline: auto;
		max-height: 92dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--surface);
		border-radius: var(--r-xl) var(--r-xl) 0 0;
		box-shadow: var(--shadow-2);
		padding: 24px 18px calc(24px + var(--safe-b));
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		text-align: center;
	}
	h2 {
		font-size: 20px;
		font-family: var(--font-display);
		letter-spacing: -0.01em;
	}
	p {
		font-size: 14.5px;
		color: var(--text-dim);
		line-height: 1.45;
		margin-bottom: 6px;
	}
	.code {
		width: 100%;
	}
	.pair {
		display: flex;
		gap: 8px;
	}
	.hint {
		font-size: 12.5px;
		color: var(--text-mute);
		margin-top: 8px;
	}
	.quiet {
		border: 0;
		color: var(--text-mute);
		margin-top: 4px;
	}
	canvas {
		width: 172px;
		height: 172px;
		background: #fff;
		padding: 8px;
		border-radius: 12px;
		border: 1px solid var(--line);
	}
</style>
