<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$lib/api';
	import { decodeQrFile } from '$lib/qr';
	import { plants } from '$lib/stores/plants.svelte';
	import { session } from '$lib/stores/session.svelte';

	let code = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	async function restore(candidate: string) {
		const value = candidate.trim();
		if (value.length < 8) {
			error = 'Il codice sembra incompleto';
			return;
		}
		busy = true;
		error = null;
		try {
			// Il token va nel BODY, non in query string: una URL finirebbe nei log
			// del reverse proxy, nella cronologia e nel Referer.
			const data = await api.post<{ valid: boolean }>('/session/verify', { token: value });
			if (!data.valid) {
				error = 'Questo codice non corrisponde a nessuna sessione';
				return;
			}
			await session.adopt(value);
			await plants.load();
			await plants.loadSettings();
			await goto(resolve('/'));
		} catch (err) {
			error = err instanceof Error ? err.message : 'Ripristino non riuscito';
		} finally {
			busy = false;
		}
	}

	async function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		busy = true;
		error = null;
		try {
			const decoded = await decodeQrFile(file);
			if (!decoded) {
				error = 'Nessun QR leggibile in questa immagine';
				return;
			}
			code = decoded;
			await restore(decoded);
		} catch {
			error = 'Immagine non leggibile';
		} finally {
			busy = false;
		}
	}
</script>

<header class="topbar">
	<a class="back-btn" href={resolve('/benvenuto')} aria-label="Indietro">
		<svg
			viewBox="0 0 24 24"
			width="20"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		>
			<path d="M15 18l-6-6 6-6" />
		</svg>
	</a>
	<h1>Ripristina sessione</h1>
</header>

<div class="scroll">
	<p class="intro">
		Incolla il codice che avevi salvato, oppure carica l'immagine del QR: viene letta qui sul
		telefono, non viene caricata da nessuna parte.
	</p>

	<form
		onsubmit={(event) => {
			event.preventDefault();
			void restore(code);
		}}
	>
		<div class="field">
			<label for="restore-code">Codice sessione</label>
			<input
				id="restore-code"
				bind:value={code}
				autocomplete="off"
				spellcheck="false"
				placeholder="es. 7f3c1a20-9b4e-4d61-8a02-c5e7d1f39a44"
			/>
		</div>
		<button class="btn btn-primary" type="submit" disabled={busy}>
			{busy ? 'Verifico…' : 'Ripristina'}
		</button>
	</form>

	{#if error}<p class="error">{error}</p>{/if}

	<div class="or">
		<span class="line"></span><span class="or-text">OPPURE</span><span class="line"></span>
	</div>

	<button class="drop" onclick={() => fileInput?.click()} disabled={busy}>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<rect x="3" y="3" width="7" height="7" rx="1" />
			<rect x="14" y="3" width="7" height="7" rx="1" />
			<rect x="3" y="14" width="7" height="7" rx="1" />
			<path d="M14 14h3v3h-3zM19 19h2M14 21h3" />
		</svg>
		<div><b>Carica l'immagine del QR</b><br />PNG o JPG dalla galleria</div>
	</button>
	<input bind:this={fileInput} type="file" accept="image/*" hidden onchange={onFile} />
</div>

<style>
	.drop {
		border: 2px dashed var(--line);
		border-radius: var(--r-lg);
		padding: 26px 16px;
		text-align: center;
		color: var(--text-mute);
		font-size: 14px;
		background: var(--surface);
		width: 100%;
		transition: transform var(--dur-fast) var(--ease-out);
	}
	.drop:active {
		transform: scale(0.99);
	}
	.drop svg {
		width: 34px;
		height: 34px;
		margin-bottom: 8px;
		stroke-width: 1.5;
	}
	.intro {
		color: var(--text-dim);
		font-size: 14.5px;
		margin-bottom: 16px;
	}
	.error {
		color: var(--late);
		font-size: 13.5px;
		margin-top: 12px;
	}
	.or {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 20px 0;
	}
	.line {
		flex: 1;
		height: 1px;
		background: var(--line);
	}
	.or-text {
		font-size: 12px;
		color: var(--text-mute);
		font-weight: 650;
	}
	.drop b {
		color: var(--text);
	}
</style>
