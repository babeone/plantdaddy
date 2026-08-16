<script lang="ts">
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
</script>

<div class="card two-fa">
	<h1>{data.enrolling ? 'Attiva il secondo fattore' : 'Codice di verifica'}</h1>

	{#if data.enrolling}
		<p class="hint">
			Inquadra il codice con l’app di autenticazione (Google Authenticator, Aegis, 1Password, quella
			che usi), poi scrivi qui il numero che mostra.
		</p>

		<!-- Il QR è un endpoint che risponde image/png, non un data: URL e non SVG
		     inline. La CSP ha img-src 'self' blob: — senza data: — e {@html} non si
		     usa da nessuna parte nel progetto: un <img> verso la stessa origine è
		     l'unica strada che rispetta entrambe le cose. -->
		<img class="qr" src="{data.base}/2fa/qr" alt="Codice QR per l’app di autenticazione" />

		<p class="label">Oppure inserisci il codice a mano:</p>
		<p class="token-code">{data.secret}</p>

		<p class="warn-text">
			Conservalo: senza l’app e senza questo codice si rientra solo azzerando
			<code>totp_secret</code> dal database.
		</p>
	{:else}
		<p class="hint">Scrivi il codice a sei cifre dell’app di autenticazione.</p>
	{/if}

	<form method="POST">
		<div class="field">
			<label for="ad-code">Codice</label>
			<input
				id="ad-code"
				name="code"
				inputmode="numeric"
				autocomplete="one-time-code"
				pattern="[0-9]&lbrace;6&rbrace;"
				maxlength="6"
				placeholder="000000"
				required
			/>
		</div>

		{#if form?.error}<p class="error">{form.error}</p>{/if}

		<button class="btn btn-primary" type="submit">Conferma</button>
	</form>
</div>

<style>
	.two-fa {
		max-width: 400px;
		margin: 6vh auto 0;
	}
	h1 {
		font-family: var(--font-display);
		font-size: 20px;
	}
	.hint {
		font-size: 13px;
		color: var(--text-mute);
		margin-bottom: 14px;
	}
	.qr {
		display: block;
		width: 200px;
		height: 200px;
		margin: 0 auto 14px;
		border-radius: var(--r-md);
		background: #fff;
	}
	.label {
		font-size: 12px;
		color: var(--text-mute);
		margin-bottom: 6px;
	}
	.warn-text {
		font-size: 12px;
		color: var(--text-dim);
		margin: 10px 0 16px;
	}
	#ad-code {
		font-size: 24px;
		letter-spacing: 0.3em;
		text-align: center;
	}
</style>
