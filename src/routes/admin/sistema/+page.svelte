<script lang="ts">
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const info = $derived(data.info);
	const stamp = (value: string | Date) => new Date(value).toLocaleString('it-IT');
</script>

<div class="stat-grid">
	<div class="stat"><b>{info.postgres}</b><small>PostgreSQL</small></div>
	<div class="stat"><b>{info.db_size}</b><small>Dimensione database</small></div>
	<div class="stat"><b>{info.migrations.length}</b><small>Migrazioni applicate</small></div>
	<div class="stat"><b>{info.action_tokens.active}</b><small>Action token attivi</small></div>
</div>

<div class="group-title">Migrazioni</div>
<div class="group">
	{#each info.migrations as m (m.version)}
		<div class="item compact">
			<span class="facts"><span>{m.version}</span></span>
			<small class="when">{stamp(m.applied_at)}</small>
		</div>
	{/each}
</div>

<div class="group-title">Notifiche push</div>
<div class="card">
	{#if info.providers.length === 0}
		<p class="muted-text">Nessun dispositivo iscritto.</p>
	{:else}
		<ul class="plain">
			{#each info.providers as p (p.host)}
				<li><span>{p.host}</span><b>{p.n}</b></li>
			{/each}
		</ul>
	{/if}
	<div class="divider"></div>
	<!-- Solo l'host, mai l'endpoint completo: quello contiene l'identificativo con
	     cui si inviano notifiche a quel dispositivo, cioè una credenziale. -->
	<p class="muted-text">
		Dell’endpoint si mostra solo l’host del provider. Chiavi e indirizzo completo delle subscription
		non escono mai dal database.
	</p>
</div>

<div class="group-title">Action token</div>
<div class="card">
	<ul class="plain">
		<li><span>Attivi</span><b>{info.action_tokens.active}</b></li>
		<li><span>Scaduti da ripulire</span><b>{info.action_tokens.expired}</b></li>
		<li><span>Già usati</span><b>{info.action_tokens.used}</b></li>
	</ul>
	<div class="divider"></div>
	<p class="muted-text">
		Scaduti e usati vengono cancellati dal job del cron a ogni giro. Se il numero cresce e non
		scende mai, il cron non sta girando.
	</p>
</div>

<div class="group-title">Amministratori</div>
<div class="group">
	{#each info.admins as a (a.email)}
		<div class="item compact">
			<span class="facts">
				<span>{a.email}</span>
				<small>
					{a.totp ? '2FA attiva' : '2FA non ancora configurata'}
					{a.disabled ? '· disabilitato' : ''}
				</small>
			</span>
			<small class="when">{a.last_login_at ? stamp(a.last_login_at) : 'mai entrato'}</small>
		</div>
	{/each}
</div>

<div class="group-title">Ultimi accessi e tentativi</div>
<div class="group scroll-box">
	{#each info.audit as row, i (`${row.at}-${i}`)}
		<div class="item compact">
			<span class="facts">
				<span>{row.action}</span>
				<small>{row.email ?? '—'} · {row.ip ?? '—'}</small>
			</span>
			<small class="when">{stamp(row.at)}</small>
		</div>
	{/each}
</div>

<style>
	.plain {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13.5px;
	}
	.plain li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.plain span {
		color: var(--text-mute);
		overflow-wrap: anywhere;
	}
	.facts {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 13.5px;
		overflow-wrap: anywhere;
	}
	.facts small {
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.when {
		font-size: 11.5px;
		color: var(--text-mute);
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}
	.scroll-box {
		max-height: 50vh;
		overflow-y: auto;
	}
</style>
