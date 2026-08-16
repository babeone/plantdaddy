<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Logo from '$lib/components/Logo.svelte';
	import { api } from '$lib/api';
	import { drawQr, downloadQrPng } from '$lib/qr';
	import { session } from '$lib/stores/session.svelte';
	import { plants } from '$lib/stores/plants.svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import { today } from '$lib/date';

	let token = $state<string | null>(null);
	let displayName = $state('');
	let creating = $state(false);
	let error = $state<string | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);

	// Se una sessione esiste già (per esempio si arriva qui dal menu), la mostra
	// invece di crearne una nuova: creare token a raffica è solo confusione.
	$effect(() => {
		if (session.ready && session.token && !token) token = session.token;
	});

	$effect(() => {
		if (canvas && token) void drawQr(canvas, token);
	});

	async function createSession(event: SubmitEvent) {
		event.preventDefault();
		// Il controllo vero è del server (zod, e il CHECK del database): questo
		// serve solo a dare la risposta subito, senza un giro di rete.
		const name = displayName.trim();
		if (!name) {
			error = 'Scrivi come ti chiami';
			return;
		}

		creating = true;
		error = null;
		try {
			const data = await api.post<{ token: string }>('/session', { display_name: name });
			await session.adopt(data.token);
			token = data.token;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Creazione non riuscita';
		} finally {
			creating = false;
		}
	}

	async function copyToken() {
		if (!token) return;
		try {
			await navigator.clipboard.writeText(token);
			toasts.show('Codice copiato');
		} catch {
			toasts.error('Copia non riuscita, selezionalo a mano');
		}
	}

	async function start() {
		await plants.load();
		await plants.loadSettings();
		await goto(resolve('/'));
	}
</script>

<div class="scroll">
	<div class="hero">
		<div class="logo"><Logo size={132} /></div>
		<h2>PlantDaddy</h2>
		<p>
			Annaffiature e concimazioni delle tue piante di casa.<br />Nessun account, nessuna email.
		</p>
	</div>

	{#if !token}
		<!-- Una <form> e non un bottone sciolto: così l'invio da tastiera funziona,
		     e `required` fa comparire il messaggio nativo del browser prima ancora
		     che parta una richiesta. -->
		<form onsubmit={createSession}>
			<div class="field">
				<label for="bv-nome">Come ti chiami?</label>
				<input
					id="bv-nome"
					bind:value={displayName}
					maxlength="60"
					autocomplete="nickname"
					placeholder="es. Andrea"
					required
				/>
				<p class="field-hint">Serve solo a distinguerti. Non è un account e non è pubblico.</p>
			</div>

			<button class="btn btn-primary" type="submit" disabled={creating}>
				{creating ? 'Creo la sessione…' : 'Inizia'}
			</button>
		</form>
		{#if error}
			<p class="error">{error}</p>
		{/if}
		<button class="btn btn-secondary spaced" onclick={() => goto(resolve('/ripristina'))}>
			Ho già un codice
		</button>
	{:else}
		<div class="token-box">
			<div class="token-label">Il tuo codice di sessione</div>
			<div class="token-code">{token}</div>
			<div class="qr-wrap">
				<canvas bind:this={canvas} width="320" height="320" aria-label="QR code del codice sessione"
				></canvas>
			</div>
			<div class="pair">
				<button class="btn btn-secondary" onclick={copyToken}>Copia codice</button>
				<button
					class="btn btn-secondary"
					onclick={() => canvas && downloadQrPng(canvas, `plantdaddy-codice-${today()}.png`)}
				>
					Scarica QR
				</button>
			</div>
		</div>

		<div class="warn">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			>
				<path
					d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
				/>
			</svg>
			<div>
				<b>Conserva questo codice.</b> È l'unica chiave dei tuoi dati: chi ce l'ha vede le tue piante,
				e se lo perdi non c'è modo di recuperarlo. Salva il QR nelle foto.
			</div>
		</div>

		{#if session.storagePersisted === false}
			<div class="warn muted">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="9" />
					<path d="M12 8v5M12 16h.01" />
				</svg>
				<div>
					Il browser non ha concesso storage persistente: dopo settimane di inattività potrebbe
					cancellare i dati del sito. Il QR salvato fuori dal browser resta la tua copia sicura.
				</div>
			</div>
		{/if}

		<button class="btn btn-primary spaced" onclick={start}>Ho salvato il codice, iniziamo</button>
	{/if}
</div>

<style>
	.hero {
		text-align: center;
		padding: 34px 8px 18px;
	}
	/* flex e non text-align: l'svg del componente Logo è display:block, che
	   text-align non centra. Puntare all'svg da qui non funzionerebbe comunque,
	   perché lo scoping di Svelte non attraversa i componenti figli. */
	.hero .logo {
		display: flex;
		justify-content: center;
		animation: pop var(--dur-slow) var(--ease-back) both;
	}
	.hero h2 {
		font-size: 27px;
		font-weight: 750;
		letter-spacing: -0.03em;
		margin-top: 8px;
	}
	.hero p {
		color: var(--text-dim);
		font-size: 15px;
		margin-top: 8px;
	}
	.field-hint {
		font-size: 12px;
		color: var(--text-mute);
		margin-top: 6px;
	}
	.token-label {
		font-size: 13px;
		font-weight: 650;
		color: var(--text-dim);
	}
	.pair {
		display: flex;
		gap: 8px;
	}
	.spaced {
		margin-top: 12px;
	}
	.error {
		color: var(--late);
		font-size: 13.5px;
		margin-top: 10px;
		text-align: center;
	}
	.warn.muted {
		background: var(--surface-2);
		color: var(--text-dim);
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
