<script lang="ts">
	import Sparkline from '$lib/components/Sparkline.svelte';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData & { base: string } } = $props();

	const s = $derived(data.sommario);
	const h = $derived(data.health);

	const RANGE = [
		['24h', '24 ore'],
		['7g', '7 giorni'],
		['30g', '30 giorni']
	] as const;

	// Etichette CORTE: le colonne numeriche sono larghe poco più di tre caratteri,
	// e "Richieste" o "Media" ci sfondavano dentro sovrapponendosi alla vicina.
	// Il significato completo sta nel titolo della sezione e nell'aria-label.
	const COLONNE = [
		['route', 'Endpoint', 'Endpoint'],
		['requests', 'N.', 'Numero totale di richieste'],
		['avg', 'med', 'Latenza media delle risposte riuscite, in ms'],
		['p95', 'p95', 'p95 delle risposte riuscite, in ms'],
		['p99', 'p99', 'p99 delle risposte riuscite, in ms'],
		['errori', '5xx/4xx', 'Errori server e client']
	] as const;

	/**
	 * Ordinamento e range viaggiano in query string, non con JavaScript: il pannello
	 * ha csr = false. Sono link, quindi funzionano anche col tasto indietro e si
	 * possono mettere nei preferiti.
	 */
	const link = (p: { range?: string; ord?: string }) =>
		`${data.base}/metriche?range=${p.range ?? data.range}&ord=${p.ord ?? data.ordine}`;

	const mb = (b: number) => (b / 1048576).toFixed(1) + ' MB';
	// Sopra il secondo si passa ai secondi: "30000 ms" richiede di contare gli zeri,
	// "30,0 s" no — e questi numeri si guardano di fretta quando qualcosa non va.
	const ms = (v: number) =>
		v >= 1000 ? (v / 1000).toFixed(1).replace('.', ',') + ' s' : Math.round(v) + ' ms';
	const stamp = (d: Date | string | null) => (d ? new Date(d).toLocaleString('it-IT') : '—');

	// Le etichette dell'asse dipendono dal range: ore per le 24h, date per il resto.
	const etichette = $derived(
		data.punti.map((p) =>
			data.range === '24h'
				? new Date(p.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
				: new Date(p.at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
		)
	);

	const p95 = $derived(data.punti.map((p) => p.p95_ms));
	const lente = $derived(data.punti.map((p) => p.c_lente));
	const totaleLente = $derived(data.punti.reduce((a, p) => a + p.c_lente, 0));
	const secondi = (v: number) => (v / 1000).toFixed(1).replace('.', ',') + ' s';
	// Error rate per punto, in percentuale con un decimale: su volumi bassi
	// arrotondare all'intero farebbe sparire ogni errore isolato.
	const errorRate = $derived(
		data.punti.map((p) => (p.requests === 0 ? 0 : Math.round((p.c5xx / p.requests) * 1000) / 10))
	);

	const risparmio = $derived.by(() => {
		const f = data.altro.foto;
		if (!f || f.original === 0) return null;
		return Math.round((1 - (f.stored + f.thumb) / f.original) * 100);
	});
</script>

<div class="stat-grid">
	<div class="stat"><b>{s.requests}</b><small>Richieste (24h)</small></div>
	<!-- L'etichetta dice ESATTAMENTE cosa è nel numero. Escludere errori e risposte
	     oltre soglia dalla media è corretto — una chiamata appesa a 30 secondi la
	     falserebbe da sola — ma diventa una bugia se non lo si scrive. -->
	<div class="stat">
		<b>{ms(s.avg_ms)}</b>
		<small>Latenza media <em>delle risposte riuscite</em> — su {s.c_ok} di {s.requests}</small>
	</div>
	<div class="stat">
		<b>{ms(s.p95_ms)}</b>
		<small>p95 riuscite · mediana {ms(s.p50_ms)}</small>
	</div>
	<div class="stat">
		<b class:allarme={s.error_rate > 1}>{s.error_rate.toFixed(2)}%</b>
		<small>Error rate 5xx — {s.c5xx} su {s.requests}</small>
	</div>
</div>

<div class="group-title">Esiti nelle 24 ore</div>
<div class="stat-grid">
	<div class="stat">
		<b class="buono">{s.c_ok}</b>
		<small>Riuscite sotto {secondi(s.soglia_ms)}</small>
	</div>
	<div class="stat">
		<b class:allarme={s.c_lente > 0}>{s.c_lente}</b>
		<small>Oltre {secondi(s.soglia_ms)} — escluse dalla latenza</small>
	</div>
	<div class="stat">
		<b class:allarme={s.c5xx > 0}>{s.c5xx}</b>
		<small>Errori server (5xx)</small>
	</div>
	<div class="stat"><b>{s.c4xx}</b><small>Errori client (4xx)</small></div>
</div>
<p class="muted-text">
	La più lenta in assoluto nelle 24 ore è stata <b>{ms(s.max_ms)}</b>: il massimo è calcolato su
	<em>tutte</em>
	le richieste, anche quelle escluse dalla media, così una singola risposta disastrosa resta visibile
	invece di sparire in un filtro. La soglia si cambia con <code>METRICS_TIMEOUT_MS</code>.
</p>

<nav class="range" aria-label="Periodo">
	{#each RANGE as [valore, etichetta] (valore)}
		<a href={link({ range: valore })} aria-current={data.range === valore ? 'page' : undefined}>
			{etichetta}
		</a>
	{/each}
</nav>

<div class="group-title">Latenza p95 delle risposte riuscite</div>
<div class="card">
	<Sparkline punti={p95} {etichette} unita=" ms" />
</div>

{#if totaleLente > 0}
	<div class="group-title">Risposte oltre {secondi(s.soglia_ms)}</div>
	<div class="card">
		<Sparkline punti={lente} {etichette} colore="var(--today)" />
		<div class="divider"></div>
		<p class="muted-text">
			Riuscite ma lentissime: per chi le ha aspettate sono indistinguibili da un blocco. Non entrano
			nella media proprio perché la falserebbero — è questo il grafico dove guardarle.
		</p>
	</div>
{/if}

<div class="group-title">Error rate 5xx</div>
<div class="card">
	<Sparkline punti={errorRate} {etichette} colore="var(--late)" unita="%" />
</div>

<div class="group-title">Per endpoint</div>
<div class="group">
	<div class="item compact testata">
		{#each COLONNE as [chiave, etichetta, titolo] (chiave)}
			<a
				class="col col-{chiave}"
				href={link({ ord: chiave })}
				aria-current={data.ordine === chiave ? 'page' : undefined}
				aria-label="Ordina per {titolo}"
				title={titolo}
			>
				{etichetta}
			</a>
		{/each}
	</div>
	{#if data.endpoint.length === 0}
		<div class="item compact"><span class="muted-text">Nessuna richiesta nel periodo.</span></div>
	{:else}
		{#each data.endpoint as e (e.route + e.method)}
			<div class="item compact">
				<span class="col col-route">
					<span class="metodo">{e.method}</span>
					<span class="rotta">{e.route}</span>
				</span>
				<span class="col col-requests num">{e.requests}</span>
				<span class="col col-avg num">{Math.round(e.avg_ms)}</span>
				<span class="col col-p95 num">{e.p95_ms}</span>
				<span class="col col-p99 num">{e.p99_ms}</span>
				<span class="col col-errori num">
					{#if e.c5xx > 0}<b class="allarme">{e.c5xx}</b>{:else}0{/if}
					<small>/ {e.c4xx}</small>
				</span>
			</div>
		{/each}
	{/if}
</div>

<div class="group-title">Salute della raccolta</div>
<div class="card">
	{#if !h.enabled}
		<p class="error">
			Raccolta DISATTIVATA (<code>METRICS_ENABLED=false</code>). I numeri qui sopra sono storici.
		</p>
	{:else if h.breaker_aperto_fino_a}
		<p class="error">
			Circuit breaker APERTO fino a {stamp(h.breaker_aperto_fino_a)} — {h.flush_falliti} flush falliti.
			L'app funziona normalmente, le metriche sono sospese.
			{#if h.ultimo_errore}<br />Ultimo errore: {h.ultimo_errore}{/if}
		</p>
	{/if}
	<ul class="plain">
		<li><span>Campionamento</span><b>{(h.sample_rate * 100).toFixed(0)}%</b></li>
		<li>
			<span>5xx e oltre {h.always_above_ms} ms</span><b>sempre al 100%</b>
		</li>
		<li><span>Buffer</span><b>{h.buffer_usati} / {h.buffer_max}</b></li>
		<li><span>Flush ogni</span><b>{(h.flush_ms / 1000).toFixed(0)} s</b></li>
		<li><span>Ultimo flush riuscito</span><b>{stamp(h.ultimo_flush_ok)}</b></li>
		<li><span>Flush riusciti / falliti</span><b>{h.flush_ok} / {h.flush_falliti}</b></li>
		<li>
			<span>Record scritti / scartati</span>
			<b>{h.scritti} / {h.scartati}</b>
		</li>
		<li>
			<span>Righe grezze</span><b>{h.righe_grezze} / {h.tetto_righe} (tetto)</b>
		</li>
		<li><span>Spazio delle tabelle metriche</span><b>{mb(h.bytes_metriche)}</b></li>
		<li>
			<span>Retention</span>
			<b
				>{h.retention.raw}g grezzi · {h.retention.hourly}g orari · {h.retention.daily}g giornalieri</b
			>
		</li>
	</ul>
	<div class="divider"></div>
	<p class="muted-text">
		I record scartati non sono un guasto in sé: succede quando il buffer è pieno mentre un flush è
		in volo, ed è il comportamento voluto — scartare invece di far crescere la memoria. Se il numero
		cresce di continuo, alza <code>METRICS_BUFFER_MAX</code> o abbassa
		<code>METRICS_FLUSH_MS</code>.
	</p>
</div>

<div class="group-title">Foto e archivio</div>
<div class="card">
	{#if data.altro.foto}
		<ul class="plain">
			<li><span>Foto</span><b>{data.altro.foto.n}</b></li>
			<li>
				<span>Occupato (full + thumb)</span>
				<b>{mb(data.altro.foto.stored + data.altro.foto.thumb)}</b>
			</li>
			<li><span>Originali prima della compressione</span><b>{mb(data.altro.foto.original)}</b></li>
			{#if risparmio !== null}
				<li><span>Risparmio della compressione</span><b>{risparmio}%</b></li>
			{/if}
		</ul>
	{:else}
		<p class="muted-text">Nessuna foto caricata.</p>
	{/if}
	<div class="divider"></div>
	<ul class="plain">
		<li><span>Upload riusciti (30g)</span><b>{data.altro.upload.ok}</b></li>
		<li><span>Rifiutati per slot esauriti</span><b>{data.altro.upload.rifiutati_quota}</b></li>
		<li>
			<span>Rifiutati per limite giornaliero</span><b>{data.altro.upload.rifiutati_limite}</b>
		</li>
		<li>
			<span>Falliti (5xx)</span>
			<b class:allarme={data.altro.upload.falliti > 0}>{data.altro.upload.falliti}</b>
		</li>
	</ul>
</div>

{#if data.altro.occupazione.length > 1}
	<div class="group-title">Occupazione nel tempo</div>
	<div class="card">
		<Sparkline
			punti={data.altro.occupazione.map((o) => Math.round(o.bytes_stored / 1048576))}
			etichette={data.altro.occupazione.map((o) =>
				new Date(o.at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
			)}
			colore="var(--water)"
			unita=" MB"
		/>
		<div class="divider"></div>
		<ul class="plain">
			<li>
				<span>Connessioni al database, massimo campionato</span>
				<b>{Math.max(...data.altro.occupazione.map((o) => o.db_connections))}</b>
			</li>
			<li>
				<span>Dimensione del database</span>
				<b>{mb(data.altro.occupazione[data.altro.occupazione.length - 1].db_bytes)}</b>
			</li>
		</ul>
	</div>
{/if}

<div class="group-title">Utenti attivi</div>
<div class="stat-grid">
	<div class="stat"><b>{data.altro.attivi.giorno}</b><small>Nelle ultime 24 ore</small></div>
	<div class="stat"><b>{data.altro.attivi.mese}</b><small>Negli ultimi 30 giorni</small></div>
</div>
<p class="muted-text">
	"Attivo" significa che ha registrato una cura: aprire l'app senza fare niente non conta, perché
	non lascia una traccia che si possa contare senza tracciare le persone.
</p>

<div class="group-title">Ultima esecuzione dei job</div>
<div class="group">
	{#if data.altro.job.length === 0}
		<div class="item compact">
			<span class="muted-text">
				Nessun job eseguito negli ultimi 7 giorni. Se gli Schedule sono configurati, è un problema:
				vedi DEPLOY.md § 8 e § 10b.
			</span>
		</div>
	{:else}
		{#each data.altro.job as j (j.job)}
			<div class="item compact">
				<span class="facts">
					<span>{j.ok ? '✓' : '✕'} {j.job}</span>
					<small>{stamp(j.started_at)} · {j.duration_ms} ms</small>
				</span>
			</div>
		{/each}
	{/if}
</div>

<div class="group-title">Notifiche push (30 giorni)</div>
<div class="card">
	<ul class="plain">
		<li><span>Inviate</span><b>{data.altro.push.inviate}</b></li>
		<li><span>Fallite</span><b>{data.altro.push.fallite}</b></li>
		<li><span>Subscription rimosse (404/410)</span><b>{data.altro.push.rimosse}</b></li>
	</ul>
	<div class="divider"></div>
	<p class="muted-text">
		"Inviate" significa accettate dal push service, non necessariamente mostrate: la consegna finale
		al dispositivo non è osservabile dal server, e nessun fornitore la comunica.
	</p>
</div>

<style>
	.range {
		display: flex;
		gap: 6px;
		margin: 4px 0 8px;
	}
	.range a {
		padding: 6px 12px;
		font-size: 13px;
		border-radius: var(--r-sm);
		background: var(--surface);
		border: 1px solid var(--line);
		color: var(--text-mute);
		text-decoration: none;
	}
	.range a[aria-current='page'] {
		background: var(--brand);
		color: var(--brand-ink);
		border-color: var(--brand);
	}
	/* Griglia a colonne fisse invece di una <table>: su 390px una tabella vera
	   sfonderebbe in orizzontale, e qui le larghezze sono note. */
	/* minmax(0, 1fr) sulla prima colonna e non 1fr: con 1fr il contenuto largo
	   (una rotta lunga) impedisce alla colonna di restringersi sotto la propria
	   larghezza minima, e le colonne numeriche vengono spinte fuori. */
	.item.compact {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 2.6rem 2.6rem 2.6rem 2.6rem 3.4rem;
		gap: 4px;
		align-items: baseline;
		font-size: 12.5px;
	}
	.testata {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--text-mute);
	}
	/* Le celle non devono mai sbordare sulla vicina: il testo si taglia. */
	.testata .col {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.testata .col:not(.col-route) {
		text-align: right;
	}
	.testata a {
		color: inherit;
		text-decoration: none;
	}
	.testata a[aria-current='page'] {
		color: var(--brand);
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.col-route {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.metodo {
		font-size: 10px;
		color: var(--text-mute);
		letter-spacing: 0.04em;
	}
	.rotta {
		overflow-wrap: anywhere;
	}
	.col-errori small {
		color: var(--text-mute);
		font-size: 10.5px;
	}
	.allarme {
		color: var(--late);
	}
	.plain {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
	}
	.plain li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.plain span {
		color: var(--text-mute);
	}
	.plain b {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.facts {
		display: flex;
		flex-direction: column;
		gap: 1px;
		grid-column: 1 / -1;
	}
	.facts small {
		font-size: 11px;
		color: var(--text-mute);
	}
	/* Riga a piena larghezza sotto la voce: si vede solo quando c'è qualcosa da
	   dire, così la tabella resta compatta nel caso normale. */
	.nota-lente {
		grid-column: 1 / -1;
		font-size: 10.5px;
		color: var(--today);
	}
	.buono {
		color: var(--ok);
	}
	em {
		font-style: normal;
		color: var(--text-dim);
	}
	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.92em;
	}
</style>
