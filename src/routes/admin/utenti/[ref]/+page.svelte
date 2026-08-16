<script lang="ts">
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const withNotes = $derived(data.plants.filter((plant) => plant.has_notes).length);
</script>

<p class="crumb"><a href="{data.base}/utenti">← Tutti gli utenti</a></p>

<div class="group-title">Utente {data.user.admin_ref.slice(0, 8)}</div>
<div class="stat-grid">
	<div class="stat">
		<b>{data.plants.length}</b>
		<small>Piante{withNotes > 0 ? `, ${withNotes} con nota` : ''}</small>
	</div>
	<div class="stat">
		<b>{String(data.user.notify_hour).padStart(2, '0')}:00</b>
		<small>Orario riepilogo</small>
	</div>
	<div class="stat">
		<b>{data.user.winter_mode ? `×${data.user.winter_multiplier}` : 'no'}</b>
		<small>Modalità inverno</small>
	</div>
	<div class="stat">
		<b>{data.user.push}</b>
		<small>Dispositivi iscritti</small>
	</div>
</div>

<div class="group-title">Piante</div>
{#if data.plants.length === 0}
	<div class="card"><p class="muted-text">Nessuna pianta.</p></div>
{:else}
	<div class="group">
		{#each data.plants as plant (plant.name)}
			<div class="item">
				<span class="avatar small">{plant.emoji ?? '🪴'}</span>
				<span class="facts">
					<span>{plant.name}{plant.location ? ` · ${plant.location}` : ''}</span>
					<small>
						acqua ogni {plant.watering_interval_days}g
						{#if plant.fertilizing_interval_days}· concime ogni {plant.fertilizing_interval_days}g{/if}
						· {plant.events} eventi
					</small>
					{#if plant.notes}
						<small class="note">{plant.notes}</small>
					{:else if plant.has_notes}
						<small class="note hidden-note">(nota presente, non mostrata)</small>
					{/if}
				</span>
				<span class="dates">
					<small>ultima: {plant.last_watered ?? '—'}</small>
					<small>prossima: {plant.next_watering ?? 'adesso'}</small>
				</span>
			</div>
		{/each}
	</div>
{/if}

<div class="group-title">
	Storico {data.events.length >= data.maxEvents ? `(ultimi ${data.maxEvents})` : ''}
</div>
{#if data.events.length === 0}
	<div class="card"><p class="muted-text">Nessun evento registrato.</p></div>
{:else}
	<div class="group scroll-box">
		{#each data.events as ev, i (`${ev.event_date}-${ev.plant}-${ev.type}-${i}`)}
			<div class="item compact">
				<span class="kind">{ev.type === 'water' ? '💧' : '🌾'}</span>
				<span class="facts">
					<span>{ev.plant}</span>
					{#if ev.note}
						<small class="note">{ev.note}</small>
					{:else if ev.has_note}
						<small class="note hidden-note">(nota presente, non mostrata)</small>
					{/if}
				</span>
				<small class="when">{ev.event_date}</small>
			</div>
		{/each}
	</div>
{/if}

{#if !data.showText}
	<p class="muted-text privacy">
		Il testo scritto dall’utente non viene mostrato: viene solo contato. Per vederlo serve
		<code>ADMIN_SHOW_USER_TEXT=true</code> nella configurazione dell’istanza.
	</p>
{/if}

<style>
	.crumb {
		font-size: 13px;
		margin-bottom: 10px;
	}
	.crumb a {
		color: var(--text-mute);
		text-decoration: none;
	}
	.avatar.small {
		width: 32px;
		height: 32px;
		font-size: 17px;
		flex-shrink: 0;
	}
	.kind {
		width: 24px;
		flex-shrink: 0;
	}
	.facts {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 13.5px;
	}
	.facts small {
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.note {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--text-dim);
	}
	.hidden-note {
		font-style: italic;
		opacity: 0.7;
	}
	.dates {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		flex-shrink: 0;
		font-size: 11px;
		color: var(--text-mute);
		font-variant-numeric: tabular-nums;
	}
	.when {
		font-size: 11.5px;
		color: var(--text-mute);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}
	/* Lo storico può essere lungo: scorre dentro il suo riquadro invece di
	   spingere il resto della pagina fuori schermo. */
	.scroll-box {
		max-height: 60vh;
		overflow-y: auto;
	}
	.privacy {
		margin-top: 12px;
	}
</style>
