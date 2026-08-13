<script lang="ts">
	import BottomSheet from './BottomSheet.svelte';
	import { install } from '$lib/stores/install.svelte';

	/**
	 * Istruzioni di installazione. Dove esiste l'API si apre il prompt nativo con
	 * un tap; dove non esiste (iOS, Firefox) si mostra il passo passo con le
	 * icone di sistema ridisegnate, perché "il tasto Condividi" a parole non si
	 * trova.
	 */
	let { onclose }: { onclose: () => void } = $props();

	let outcome = $state<string | null>(null);

	async function prompt() {
		const result = await install.promptInstall();
		if (result === 'accepted') onclose();
		else if (result === 'dismissed') outcome = 'Installazione annullata. Puoi rifarlo quando vuoi.';
		else outcome = 'Il browser non ha reso disponibile il prompt.';
	}
</script>

<BottomSheet
	title="Installa PlantDaddy"
	hint="Aggiunta alla Home è l'unico modo per ricevere le notifiche su iPhone."
	{onclose}
>
	{#if install.route === 'prompt'}
		<div class="center">
			<p class="lead">Il tuo browser installa l'app da solo: un tap e finisce sulla Home.</p>
			<button class="btn btn-primary" onclick={prompt}>Installa app</button>
		</div>
	{:else if install.route === 'ios-safari'}
		<p class="lead">
			Su iOS nessun sito può installarsi da solo: Apple non espone alcuna API. Servono tre tap, ma
			senza questi le notifiche non funzionano affatto.
		</p>
		<ol class="steps">
			<li>
				<span class="n">1</span>
				<div>
					<p>Tocca il tasto <b>Condividi</b> nella barra di Safari.</p>
					<span class="sys">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="#0a84ff"
							stroke-width="1.7"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M12 15V3" />
							<path d="m8 7 4-4 4 4" />
							<path
								d="M6 12H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"
							/>
						</svg>
						<span>Condividi</span>
					</span>
				</div>
			</li>
			<li>
				<span class="n">2</span>
				<div>
					<p>Scorri la lista e scegli <b>Aggiungi a Home</b>.</p>
					<span class="sys">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="#0a84ff"
							stroke-width="1.7"
							stroke-linecap="round"
						>
							<rect x="3" y="3" width="18" height="18" rx="5" />
							<path d="M12 8v8M8 12h8" />
						</svg>
						<span>Aggiungi a Home</span>
					</span>
				</div>
			</li>
			<li>
				<span class="n">3</span>
				<div>
					<p>
						Conferma con <b>Aggiungi</b>, poi apri l'app dall'icona sulla Home e attiva le notifiche
						da Impostazioni.
					</p>
				</div>
			</li>
		</ol>
	{:else if install.route === 'ios-other'}
		<p class="lead">
			Su iOS solo <b>Safari</b> può aggiungere un sito alla schermata Home: Chrome, Firefox ed Edge usano
			lo stesso motore ma non hanno quella voce di menu.
		</p>
		<p class="lead">Apri <b>plantdaddy</b> in Safari e ritorna qui: il passo passo comparirà.</p>
	{:else if install.route === 'android-manual'}
		<p class="lead">Se il prompt automatico non compare, si installa dal menu del browser.</p>
		<ol class="steps">
			<li>
				<span class="n">1</span>
				<div>
					<p>Tocca il menu <b>⋮</b> in alto a destra.</p>
					<span class="sys">
						<svg viewBox="0 0 24 24" fill="#e8f1ea">
							<circle cx="12" cy="5" r="2" />
							<circle cx="12" cy="12" r="2" />
							<circle cx="12" cy="19" r="2" />
						</svg>
						<span>Menu</span>
					</span>
				</div>
			</li>
			<li>
				<span class="n">2</span>
				<div>
					<p>Scegli <b>Installa app</b> oppure <b>Aggiungi a schermata Home</b>.</p>
					<span class="sys">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="#e8f1ea"
							stroke-width="1.7"
							stroke-linecap="round"
						>
							<rect x="6" y="2" width="12" height="20" rx="3" />
							<path d="M12 8v8M8 12h8" />
						</svg>
						<span>Installa app</span>
					</span>
				</div>
			</li>
			<li>
				<span class="n">3</span>
				<div><p>Conferma con <b>Installa</b>: l'icona compare sulla Home.</p></div>
			</li>
		</ol>
	{:else if install.route === 'chromium-manual'}
		<p class="lead">
			Il browser non ha proposto il prompt: si installa comunque a mano, dall'icona nella barra
			degli indirizzi oppure dal menu.
		</p>
		<ol class="steps">
			<li>
				<span class="n">1</span>
				<div>
					<p>Cerca l'icona di installazione a destra nella barra degli indirizzi.</p>
					<span class="sys">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="#e8f1ea"
							stroke-width="1.7"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<rect x="3" y="4" width="18" height="14" rx="2" />
							<path d="M12 8v6M9 11l3 3 3-3" />
						</svg>
						<span>Installa</span>
					</span>
				</div>
			</li>
			<li>
				<span class="n">2</span>
				<div>
					<p>In alternativa apri il menu <b>⋮</b> e scegli <b>Installa PlantDaddy</b>.</p>
				</div>
			</li>
			<li>
				<span class="n">3</span>
				<div><p>Poi attiva le notifiche da Impostazioni dentro l'app installata.</p></div>
			</li>
		</ol>
	{:else if install.route === 'firefox-desktop'}
		<p class="lead">
			Firefox su desktop non installa le PWA: non c'è nessun passaggio che possa funzionare. L'app
			resta usabile in una scheda normale, ma per le notifiche serve Chrome, Edge, o Safari su
			iPhone con l'app aggiunta alla Home.
		</p>
	{:else}
		<p class="lead">
			Questo browser non espone nessuna via di installazione. Su Android usa Chrome, su iPhone
			Safari.
		</p>
	{/if}

	{#if outcome}<p class="outcome">{outcome}</p>{/if}

	<button class="btn btn-secondary close" onclick={onclose}>Chiudi</button>
</BottomSheet>

<style>
	.center {
		text-align: center;
	}
	.lead {
		font-size: 14.5px;
		color: var(--text-dim);
		line-height: 1.5;
		margin-bottom: 14px;
	}
	.steps {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.steps li {
		display: flex;
		gap: 12px;
		padding: 14px 0;
		border-bottom: 1px solid var(--line);
	}
	.steps li:last-child {
		border-bottom: 0;
	}
	.n {
		width: 26px;
		height: 26px;
		flex: none;
		border-radius: 50%;
		background: var(--brand);
		color: var(--brand-ink);
		display: grid;
		place-items: center;
		font-size: 13px;
		font-weight: 700;
	}
	.steps p {
		font-size: 14.5px;
		line-height: 1.45;
	}
	.sys {
		margin-top: 9px;
		display: inline-flex;
		align-items: center;
		gap: 9px;
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: 8px 12px;
	}
	.sys svg {
		width: 24px;
		height: 24px;
	}
	.sys span {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-dim);
	}
	.outcome {
		font-size: 13px;
		color: var(--text-mute);
		margin-top: 12px;
	}
	.close {
		margin-top: 12px;
		border: 0;
	}
</style>
