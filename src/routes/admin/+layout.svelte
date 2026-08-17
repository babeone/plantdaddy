<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import type { LayoutServerData } from './$types';

	let { data, children }: { data: LayoutServerData; children: Snippet } = $props();

	// La barra compare solo a sessione completa: sul login e sul secondo fattore
	// non c'è niente da navigare, e mostrarla suggerirebbe il contrario.
	const TABS = [
		{ href: '/panoramica', label: 'Panoramica' },
		{ href: '/utenti', label: 'Utenti' },
		{ href: '/metriche', label: 'Metriche' },
		{ href: '/sistema', label: 'Sistema' }
	];

	const current = $derived(page.url.pathname);
</script>

<svelte:head>
	<title>PlantDaddy — pannello</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="admin">
	<header>
		<span class="mark">🪴 <b>PlantDaddy</b></span>
		{#if data.email}
			<span class="who">{data.email}</span>
			<!-- Il logout è una POST: una GET verrebbe eseguita da qualunque
			     prefetch o scanner e chiuderebbe la sessione senza motivo. -->
			<form method="POST" action="{data.base}/logout">
				<button class="btn btn-mini" type="submit">Esci</button>
			</form>
		{/if}
	</header>

	{#if data.email}
		<nav>
			{#each TABS as tab (tab.href)}
				<a
					href="{data.base}{tab.href}"
					aria-current={current.startsWith(data.base + tab.href) ? 'page' : undefined}
				>
					{tab.label}
				</a>
			{/each}
		</nav>
	{/if}

	<main>{@render children()}</main>
</div>

<style>
	.admin {
		max-width: 720px;
		margin: 0 auto;
		padding: calc(14px + var(--safe-t)) calc(16px + var(--safe-r)) calc(28px + var(--safe-b))
			calc(16px + var(--safe-l));
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 14px;
	}
	.mark {
		font-family: var(--font-display);
		font-size: 17px;
		flex: 1;
	}
	.who {
		font-size: 12px;
		color: var(--text-mute);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 45%;
	}
	nav {
		display: flex;
		gap: 6px;
		margin-bottom: 16px;
		border-bottom: 1px solid var(--line);
	}
	nav a {
		padding: 8px 12px;
		font-size: 14px;
		color: var(--text-mute);
		text-decoration: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	nav a[aria-current='page'] {
		color: var(--brand);
		border-bottom-color: var(--brand);
	}
</style>
