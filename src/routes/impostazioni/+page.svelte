<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import InstallGuide from '$lib/components/InstallGuide.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { api } from '$lib/api';
	import { today } from '$lib/date';
	import { drawQr, downloadQrPng } from '$lib/qr';
	import { plants } from '$lib/stores/plants.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import { install } from '$lib/stores/install.svelte';
	import { push } from '$lib/stores/push.svelte';

	let showToken = $state(false);
	let showInstallGuide = $state(false);
	let tokenCanvas = $state<HTMLCanvasElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let savingSettings = $state(false);

	/** Anteprima dell'import: si vede cosa sta per entrare prima di confermare. */
	let pendingImport = $state<{
		payload: unknown;
		plants: number;
		events: number;
		mode: 'merge' | 'replace';
	} | null>(null);
	let confirmReplace = $state(false);
	let importing = $state(false);

	$effect(() => {
		if (showToken && tokenCanvas && session.token) void drawQr(tokenCanvas, session.token);
	});

	async function saveSettings(patch: Parameters<typeof plants.saveSettings>[0]) {
		savingSettings = true;
		try {
			await plants.saveSettings(patch);
		} catch (err) {
			toasts.error(err instanceof Error ? err.message : 'Salvataggio non riuscito');
		} finally {
			savingSettings = false;
		}
	}

	async function exportBackup() {
		try {
			const response = await api.raw('/export');
			if (!response.ok) throw new Error(`Errore ${response.status}`);
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `piante-backup-${today()}.json`;
			link.click();
			URL.revokeObjectURL(url);
			toasts.show('Backup scaricato');
		} catch (err) {
			toasts.error(err instanceof Error ? err.message : 'Export non riuscito');
		}
	}

	async function onImportFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const payload = JSON.parse(await file.text());
			const plantCount = Array.isArray(payload?.plants) ? payload.plants.length : 0;
			const eventCount = Array.isArray(payload?.care_events) ? payload.care_events.length : 0;
			if (plantCount === 0 && eventCount === 0) {
				toasts.error('Il file non contiene piante né eventi');
				return;
			}
			pendingImport = { payload, plants: plantCount, events: eventCount, mode: 'merge' };
		} catch {
			toasts.error('File JSON non valido');
		}
	}

	async function runImport() {
		if (!pendingImport) return;
		const { payload, mode } = pendingImport;
		importing = true;
		try {
			const result = await api.post<{
				plants_created: number;
				plants_matched: number;
				events_imported: number;
				events_skipped: number;
			}>(`/import?mode=${mode}`, payload);
			await plants.load();
			await plants.loadSettings();
			toasts.show(
				`Importate ${result.plants_created} piante nuove, ${result.events_imported} eventi`
			);
			pendingImport = null;
			confirmReplace = false;
		} catch (err) {
			toasts.error(err instanceof Error ? err.message : 'Import non riuscito');
		} finally {
			importing = false;
		}
	}
</script>

<header class="topbar">
	<Logo size={30} />
	<h1>Impostazioni</h1>
	{#if plants.settings.winter_mode}
		<span class="winter-chip">❄️ ×{plants.settings.winter_multiplier}</span>
	{/if}
</header>

<div class="scroll">
	<div class="group-title">Stagione</div>
	<div class="group">
		<div class="item">
			<div class="t">
				<b>❄️ Modalità inverno</b>
				<small>D'inverno le piante d'appartamento bevono molto meno</small>
			</div>
			<button
				class="switch"
				role="switch"
				aria-checked={plants.settings.winter_mode}
				aria-label="Modalità inverno"
				disabled={savingSettings}
				onclick={() => saveSettings({ winter_mode: !plants.settings.winter_mode })}
			>
				<i></i>
			</button>
		</div>
		<div class="item">
			<div class="t">
				<b>Moltiplicatore</b>
				<small>Tutti gli intervalli vengono allungati</small>
			</div>
			<select
				aria-label="Moltiplicatore inverno"
				value={String(plants.settings.winter_multiplier)}
				onchange={(event) => saveSettings({ winter_multiplier: Number(event.currentTarget.value) })}
			>
				<option value="1.2">×1.2</option>
				<option value="1.5">×1.5</option>
				<option value="2">×2</option>
				<option value="2.5">×2.5</option>
			</select>
		</div>
	</div>

	<div class="group-title">Notifiche</div>
	<div class="group">
		<div class="item">
			<div class="t">
				<b>Notifiche push</b>
				<small>
					{#if push.state === 'on'}
						Attive su questo dispositivo
					{:else if push.state === 'ios-needs-install'}
						Su iPhone funzionano solo con l'app aggiunta alla Home
					{:else if push.state === 'denied'}
						Negate: vanno riattivate dalle impostazioni del browser
					{:else if push.state === 'unsupported'}
						Questo browser non le supporta
					{:else}
						Non attive
					{/if}
				</small>
			</div>
			{#if push.state === 'on'}
				<button class="btn btn-mini" disabled={push.busy} onclick={() => push.disable()}>
					Disattiva
				</button>
			{:else if push.state === 'ios-needs-install'}
				<!-- Su iOS Notification.requestPermission() fuori dalla PWA installata
				     non funziona: il bottone resta disabilitato e la via è l'installazione,
				     non un tentativo che fallisce in silenzio. -->
				<button class="btn btn-mini" disabled aria-describedby="ios-push-hint">Attiva</button>
			{:else if push.state === 'off'}
				<button class="btn btn-mini" disabled={push.busy} onclick={() => push.enable()}>
					{push.busy ? 'Attivo…' : 'Attiva'}
				</button>
			{/if}
		</div>
		<div class="item">
			<div class="t">
				<b>Orario del riepilogo</b>
				<small>Una sola notifica al giorno con le piante da curare</small>
			</div>
			<select
				aria-label="Ora della notifica"
				value={String(plants.settings.notify_hour)}
				onchange={(event) => saveSettings({ notify_hour: Number(event.currentTarget.value) })}
			>
				{#each Array.from({ length: 24 }, (_, hour) => hour) as hour (hour)}
					<option value={String(hour)}>{String(hour).padStart(2, '0')}:00</option>
				{/each}
			</select>
		</div>
	</div>

	{#if push.state === 'ios-needs-install'}
		<div class="warn" id="ios-push-hint">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="9" />
				<path d="M12 8v5M12 16h.01" />
			</svg>
			<div>
				Su iPhone e iPad le notifiche push arrivano solo se PlantDaddy è aggiunta alla schermata
				Home (iOS 16.4 o successivo). Da Safari normale il permesso non si può nemmeno chiedere.
				<button class="btn btn-mini spaced" onclick={() => (showInstallGuide = true)}>
					Come si installa
				</button>
			</div>
		</div>
	{/if}
	{#if push.error}
		<div class="warn"><div>{push.error}</div></div>
	{/if}

	<div class="group-title">App</div>
	<div class="group">
		<button class="item" onclick={() => (showInstallGuide = true)}>
			<div class="t">
				<b>Installa app</b>
				<small>
					{#if install.installed}
						Già installata su questo dispositivo
					{:else if install.canPrompt}
						Un tap e la aggiungi alla schermata Home
					{:else}
						Istruzioni per la tua piattaforma
					{/if}
				</small>
			</div>
			<svg
				viewBox="0 0 24 24"
				width="18"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				class="chev"
			>
				<path d="M9 18l6-6-6-6" />
			</svg>
		</button>
		{#if !install.installed && install.dismissed}
			<button
				class="item"
				onclick={() => {
					install.reopen();
					toasts.show('Banner di installazione riattivato');
				}}
			>
				<div class="t">
					<b>Rimostra il banner</b>
					<small>L'avevi chiuso: la scelta era salvata</small>
				</div>
				<svg
					viewBox="0 0 24 24"
					width="18"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					class="chev"
				>
					<path d="M9 18l6-6-6-6" />
				</svg>
			</button>
		{/if}
	</div>

	<div class="group-title">Sessione</div>
	<div class="group">
		<button class="item" onclick={() => (showToken = true)}>
			<div class="t">
				<b>Il mio codice</b>
				<small>{session.token ? `${session.token.slice(0, 13)}…` : '—'}</small>
			</div>
			<svg
				viewBox="0 0 24 24"
				width="18"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				class="chev"
			>
				<path d="M9 18l6-6-6-6" />
			</svg>
		</button>
		<div class="item">
			<div class="t">
				<b>Storage persistente</b>
				<small>
					{#if session.storagePersisted === true}
						Concesso: il browser non cancellerà i dati del sito
					{:else if session.storagePersisted === false}
						Non concesso: dopo settimane di inattività i dati possono sparire
					{:else}
						Non disponibile su questo browser
					{/if}
				</small>
			</div>
			{#if session.storagePersisted !== true}
				<button class="btn btn-mini" onclick={() => session.requestPersistence()}>Richiedi</button>
			{/if}
		</div>
		<button class="item" onclick={() => goto(resolve('/ripristina'))}>
			<div class="t">
				<b>Usa un altro codice</b>
				<small>Ripristina la sessione su questo dispositivo</small>
			</div>
			<svg
				viewBox="0 0 24 24"
				width="18"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				class="chev"
			>
				<path d="M9 18l6-6-6-6" />
			</svg>
		</button>
	</div>

	{#if session.storagePersisted === false}
		<div class="warn">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="9" />
				<path d="M12 8v5M12 16h.01" />
			</svg>
			<div>
				Lo storage non è persistente. Esporta il backup e tieni il QR fuori dal browser: senza
				account, il codice perso significa dati persi.
			</div>
		</div>
	{/if}

	<div class="group-title">Backup</div>
	<div class="group">
		<button class="item" onclick={exportBackup}>
			<div class="t">
				<b>Esporta backup</b>
				<small>JSON con piante, storico completo e impostazioni</small>
			</div>
			<svg
				viewBox="0 0 24 24"
				width="19"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				class="chev"
			>
				<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
			</svg>
		</button>
		<button class="item" onclick={() => fileInput?.click()}>
			<div class="t">
				<b>Importa backup</b>
				<small>Ti mostro cosa contiene prima di scrivere qualsiasi cosa</small>
			</div>
			<svg
				viewBox="0 0 24 24"
				width="19"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				class="chev"
			>
				<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
			</svg>
		</button>
		<input
			bind:this={fileInput}
			type="file"
			accept="application/json"
			hidden
			onchange={onImportFile}
		/>
	</div>

	<p class="footer">PlantDaddy · {plants.plants.length} piante in questa sessione</p>
</div>

{#if showInstallGuide}
	<InstallGuide onclose={() => (showInstallGuide = false)} />
{/if}

{#if showToken}
	<BottomSheet
		title="Il tuo codice"
		hint="Chi ha questo codice vede i tuoi dati. Non condividerlo."
		onclose={() => (showToken = false)}
	>
		<div class="token-code">{session.token}</div>
		<div class="qr-wrap">
			<canvas bind:this={tokenCanvas} width="320" height="320" aria-label="QR del codice sessione"
			></canvas>
		</div>
		<div class="pair">
			<button
				class="btn btn-secondary"
				onclick={async () => {
					if (!session.token) return;
					await navigator.clipboard.writeText(session.token);
					toasts.show('Codice copiato');
				}}
			>
				Copia
			</button>
			<button
				class="btn btn-secondary"
				onclick={() =>
					tokenCanvas && downloadQrPng(tokenCanvas, `plantdaddy-codice-${today()}.png`)}
			>
				Scarica QR
			</button>
		</div>
	</BottomSheet>
{/if}

{#if pendingImport && !confirmReplace}
	<BottomSheet title="Importare questo backup?" onclose={() => (pendingImport = null)}>
		<p class="summary">
			Il file contiene <b>{pendingImport.plants} piante</b> e
			<b>{pendingImport.events} eventi</b> di cura.
		</p>
		<div class="seg">
			<button
				type="button"
				aria-pressed={pendingImport.mode === 'merge'}
				onclick={() => pendingImport && (pendingImport.mode = 'merge')}
			>
				Unisci
			</button>
			<button
				type="button"
				aria-pressed={pendingImport.mode === 'replace'}
				onclick={() => pendingImport && (pendingImport.mode = 'replace')}
			>
				Sostituisci
			</button>
		</div>
		<p class="mode-hint">
			{#if pendingImport.mode === 'merge'}
				Le piante con lo stesso nome vengono riusate e gli eventi già presenti saltati. Niente viene
				cancellato.
			{:else}
				<b>Cancella tutte le piante attuali</b> di questa sessione e ricarica solo quelle del file.
			{/if}
		</p>
		<button
			class="btn btn-primary"
			disabled={importing}
			onclick={() => {
				if (pendingImport?.mode === 'replace') confirmReplace = true;
				else void runImport();
			}}
		>
			{importing ? 'Importo…' : 'Procedi'}
		</button>
		<button class="btn btn-secondary cancel" onclick={() => (pendingImport = null)}>Annulla</button>
	</BottomSheet>
{/if}

{#if confirmReplace && pendingImport}
	<ConfirmDialog
		title="Sostituire tutti i dati?"
		message="Le {plants.plants
			.length} piante attuali e il loro storico vengono cancellati e sostituiti con {pendingImport.plants} piante dal file. Non è recuperabile."
		confirmLabel="Sostituisci tutto"
		danger
		onconfirm={runImport}
		oncancel={() => (confirmReplace = false)}
	/>
{/if}

<style>
	select {
		padding: 9px;
		border-radius: 10px;
		border: 1px solid var(--line);
		background: var(--surface);
	}
	.chev {
		color: var(--text-mute);
		flex: none;
	}
	.footer {
		text-align: center;
		color: var(--text-mute);
		font-size: 12px;
		margin-top: 22px;
	}
	.summary,
	.mode-hint {
		font-size: 14px;
		color: var(--text-dim);
		margin-bottom: 14px;
		line-height: 1.45;
	}
	.mode-hint {
		margin-top: 12px;
		font-size: 13px;
	}
	.cancel {
		margin-top: 8px;
		border: 0;
	}
	.spaced {
		margin-top: 8px;
	}
	.pair {
		display: flex;
		gap: 8px;
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
