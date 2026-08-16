<script lang="ts">
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<div class="card login">
	<h1>Pannello di controllo</h1>
	<p class="hint">Accesso riservato a chi ospita questa istanza.</p>

	<!-- Nessun action= esplicito: la form invia a questa stessa URL, e la CSP ha
	     form-action 'self'. SvelteKit verifica l'Origin di ogni POST verso una
	     form action, quindi il CSRF è coperto anche senza token nascosti. -->
	<form method="POST">
		<div class="field">
			<label for="ad-email">Email</label>
			<input
				id="ad-email"
				name="email"
				type="email"
				autocomplete="username"
				maxlength="254"
				value={form?.email ?? ''}
				required
			/>
		</div>

		<div class="field">
			<label for="ad-pass">Password</label>
			<input
				id="ad-pass"
				name="password"
				type="password"
				autocomplete="current-password"
				maxlength="200"
				required
			/>
		</div>

		{#if form?.error}<p class="error">{form.error}</p>{/if}

		<button class="btn btn-primary" type="submit">Entra</button>
	</form>
</div>

<style>
	.login {
		max-width: 400px;
		margin: 8vh auto 0;
	}
	h1 {
		font-family: var(--font-display);
		font-size: 21px;
	}
	.hint {
		font-size: 13px;
		color: var(--text-mute);
		margin-bottom: 16px;
	}
</style>
