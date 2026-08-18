<script lang="ts">
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const withNotes = $derived(data.plants.filter((plant) => plant.has_notes).length);
	const conFoto = $derived(
		data.plants.filter((p) => p.avatar_photo_id || p.gallery_ids.length > 0).length
	);
</script>

<p class="crumb"><a href="{data.base}/utenti">← Tutti gli utenti</a></p>

<div class="group-title">
	{data.user.display_name ?? `Utente senza nome · ${data.user.admin_ref.slice(0, 8)}`}
</div>
<div class="stat-grid">
	<div class="stat">
		<b>{data.plants.length}</b>
		<small>
			Piante{withNotes > 0 ? `, ${withNotes} con nota` : ''}{conFoto > 0
				? `, ${conFoto} con foto`
				: ''}
		</small>
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

<!-- admin_ref per intero: è la chiave con cui si riempie a mano display_name
     delle sessioni create prima che il nome fosse obbligatorio, e l'unico
     identificatore di questo utente che si possa scrivere in una query senza
     toccare token_hash. select-all per copiarlo con un tap. -->
<p class="riferimento">
	<span>Riferimento</span>
	<code>{data.user.admin_ref}</code>
</p>

<div class="group-title">Piante</div>
{#if data.plants.length === 0}
	<div class="card"><p class="muted-text">Nessuna pianta.</p></div>
{:else}
	<div class="group">
		{#each data.plants as plant (plant.name)}
			<div class="item">
				<!-- L'avatar è la foto se c'è, l'emoji altrimenti: stessa priorità
				     dell'app.
				     NIENTE onerror qui: il pannello ha csr = false e non riceve un byte di
				     JavaScript, quindi un gestore di eventi non scatterebbe mai — sarebbe
				     codice morto che dà una falsa sensazione di sicurezza. Se l'archivio è
				     giù si vede il segnaposto del browser, e lo stato dello storage sta
				     comunque nella scheda Sistema. Nell'app utente il ripiego sull'emoji
				     funziona perché lì il JavaScript c'è. -->
				{#if plant.avatar_photo_id}
					<img
						class="avatar small foto"
						src="{data.base}/foto/{plant.avatar_photo_id}/thumb"
						alt="Avatar di {plant.name}"
						loading="lazy"
						decoding="async"
					/>
				{:else}
					<span class="avatar small">{plant.emoji ?? '🪴'}</span>
				{/if}
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
				{#if plant.gallery_ids.length > 0}
					<!-- Diario a piena larghezza sotto la voce. Si chiedono le thumbnail e
					     al massimo otto per pianta: il pannello risponde no-store, quindi
					     ogni miniatura è una richiesta vera all'archivio a ogni apertura. -->
					<span class="diario">
						{#each plant.gallery_ids as id (id)}
							<a href="{data.base}/foto/{id}" target="_blank" rel="noreferrer">
								<img
									src="{data.base}/foto/{id}/thumb"
									alt="Foto del diario di {plant.name}"
									loading="lazy"
									decoding="async"
								/>
							</a>
						{/each}
						{#if plant.events > 0 && plant.gallery_ids.length === 8}
							<span class="altre">altre…</span>
						{/if}
					</span>
				{/if}
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

{#if !data.showText || !data.showPhotos}
	<p class="muted-text privacy">
		{#if !data.showText}
			Il testo scritto dall’utente non viene mostrato: viene solo contato. Per vederlo serve
			<code>ADMIN_SHOW_USER_TEXT=true</code>.
		{/if}
		{#if !data.showPhotos}
			Le foto degli utenti non vengono mostrate: con l’interruttore spento gli id non lasciano
			nemmeno il database. Per vederle serve <code>ADMIN_SHOW_USER_PHOTOS=true</code>, oppure basta
			<code>ADMIN_SHOW_USER_TEXT=true</code> da cui questa eredita quando non è impostata.
		{/if}
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
	.riferimento {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 11.5px;
		color: var(--text-mute);
		margin: -4px 4px 4px;
	}
	.riferimento code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		user-select: all;
		overflow-wrap: anywhere;
	}
	.avatar.small {
		width: 32px;
		height: 32px;
		font-size: 17px;
		flex-shrink: 0;
	}
	.avatar.small.foto {
		object-fit: cover;
		display: block;
	}
	/* `.group > .item` in app.css è FLEX, non grid: `grid-column: 1 / -1` lì dentro
	   non fa assolutamente niente, e il diario finiva in riga accanto alle date
	   invece che sotto. Con wrap sul contenitore e flex-basis 100% qui, la riga va
	   a capo per davvero. */
	.group > .item {
		flex-wrap: wrap;
	}
	/* Scorre in orizzontale invece di far crescere l'altezza della riga: un utente
	   con otto foto per pianta non deve trasformare la pagina in un chilometro. */
	.diario {
		flex-basis: 100%;
		width: 100%;
		display: flex;
		gap: 6px;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		padding: 2px 0;
	}
	.diario img {
		width: 56px;
		height: 56px;
		object-fit: cover;
		border-radius: var(--r-sm);
		border: 1px solid var(--line);
		display: block;
		flex-shrink: 0;
	}
	.altre {
		align-self: center;
		font-size: 10.5px;
		color: var(--text-mute);
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
