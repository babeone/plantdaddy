<script lang="ts">
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const s = $derived(data.stats);
	// Le barre sono in percentuale sul massimo: senza normalizzare, un'istanza con
	// tre utenti avrebbe barre invisibili e una con mille le avrebbe fuori scala.
	const peak = $derived(Math.max(1, ...data.hours.map((h) => h.users)));
</script>

<div class="stat-grid">
	<div class="stat"><b>{s.users}</b><small>Utenti</small></div>
	<div class="stat"><b>{s.plants}</b><small>Piante</small></div>
	<div class="stat"><b>{s.events}</b><small>Eventi di cura</small></div>
	<div class="stat"><b>{s.active_30d}</b><small>Attivi (30 giorni)</small></div>
	<div class="stat"><b>{s.due_now}</b><small>Piante da curare adesso</small></div>
	<div class="stat"><b>{s.users_with_push}</b><small>Utenti con notifiche</small></div>
	<div class="stat"><b>{s.subscriptions}</b><small>Dispositivi iscritti</small></div>
	<div class="stat"><b>{s.plants_with_notes}</b><small>Piante con nota</small></div>
</div>

<div class="group-title">Orario del riepilogo</div>
<div class="card">
	{#if data.hours.length === 0}
		<p class="muted-text">Nessun utente registrato.</p>
	{:else}
		<ul class="hours">
			{#each data.hours as row (row.hour)}
				<li>
					<span class="h">{String(row.hour).padStart(2, '0')}:00</span>
					<span class="bar"><i style:width="{(row.users / peak) * 100}%"></i></span>
					<span class="n">{row.users}</span>
				</li>
			{/each}
		</ul>
		<div class="divider"></div>
		<p class="muted-text">
			Il cron gira ogni ora e serve solo gli utenti che hanno scelto quell’orario. Le righe qui
			sopra sono le ore in cui parte davvero qualcosa.
		</p>
	{/if}
</div>

{#if s.newest_user}
	<p class="muted-text">
		Ultima registrazione: {new Date(s.newest_user).toLocaleString('it-IT')}
	</p>
{/if}

<style>
	.hours {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.hours li {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}
	.h {
		width: 48px;
		color: var(--text-mute);
		font-variant-numeric: tabular-nums;
	}
	.bar {
		flex: 1;
		height: 8px;
		border-radius: 4px;
		background: var(--surface-2);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		background: var(--brand);
	}
	.n {
		width: 32px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
