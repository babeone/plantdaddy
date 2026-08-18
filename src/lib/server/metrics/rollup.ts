import { sql } from '$lib/server/db';
import { dailyDays, hourlyDays, maxRawRows, rawDays, timeoutMs } from './config';

/**
 * Aggregazione e pulizia. Gira una volta all'ora, chiamato da uno Schedule.
 *
 * Ogni funzione è idempotente: rieseguire il job non duplica e non sbaglia. È la
 * proprietà che permette di farlo girare più spesso del necessario senza pensarci,
 * e di rilanciarlo a mano dopo un guasto.
 */

/**
 * Grezzi → orario.
 *
 * Si ricalcolano le ultime `ORE_INDIETRO` ore e non solo quella appena chiusa: se
 * il job salta un giro — un redeploy, un container riavviato — il buco si richiude
 * da sé al giro successivo invece di restare per sempre. Il costo è ricalcolare
 * qualche ora già fatta, che con `on conflict do update` è innocuo.
 */
const ORE_INDIETRO = 3;

export async function rollupOrario(): Promise<number> {
	const soglia = timeoutMs();
	const righe = await sql`
		insert into request_metrics_hourly (
			bucket, route, method, requests, c_ok, c_lente, avg_ms, p50_ms, p95_ms, p99_ms, max_ms, c4xx, c5xx
		)
		select
			date_trunc('hour', created_at) as bucket,
			route,
			method,
			count(*)::int,
			count(*) filter (where riuscita)::int,
			count(*) filter (where status < 400 and duration_ms >= ${soglia})::int,
			-- LATENZA SOLO SULLE RIUSCITE SOTTO SOGLIA. La clausola filter qui sotto è
			-- il punto di tutta questa migrazione: senza, una chiamata appesa a 30
			-- secondi si porta via la media dell'ora.
			-- (niente apici inversi nei commenti: questa è una template literal di
			-- JavaScript, e un backtick la chiuderebbe a metà query.)
			-- coalesce a 0: con zero riuscite l'aggregato è NULL e le colonne sono
			-- not null. Zero qui significa "nessun campione", non "zero millisecondi",
			-- e la dashboard lo distingue guardando c_ok.
			coalesce(avg(duration_ms) filter (where riuscita), 0)::real,
			-- percentile_disc e non _cont: restituisce un valore realmente osservato
			-- invece di interpolarne uno che nessuna richiesta ha mai avuto.
			coalesce(percentile_disc(0.50) within group (order by duration_ms) filter (where riuscita), 0)::int,
			coalesce(percentile_disc(0.95) within group (order by duration_ms) filter (where riuscita), 0)::int,
			coalesce(percentile_disc(0.99) within group (order by duration_ms) filter (where riuscita), 0)::int,
			-- max su TUTTE, anche le escluse: è il numero che dice quanto è stata
			-- brutta la peggiore, e nasconderlo vanificherebbe metà del senso.
			max(duration_ms),
			count(*) filter (where status >= 400 and status < 500)::int,
			count(*) filter (where status >= 500)::int
		from (
			select *, (status < 400 and duration_ms < ${soglia}) as riuscita
			from request_metrics
			where created_at >= date_trunc('hour', now()) - make_interval(hours => ${ORE_INDIETRO})
		) m
		group by 1, 2, 3
		on conflict (bucket, route, method) do update set
			requests = excluded.requests,
			c_ok     = excluded.c_ok,
			c_lente  = excluded.c_lente,
			avg_ms   = excluded.avg_ms,
			p50_ms   = excluded.p50_ms,
			p95_ms   = excluded.p95_ms,
			p99_ms   = excluded.p99_ms,
			max_ms   = excluded.max_ms,
			c4xx     = excluded.c4xx,
			c5xx     = excluded.c5xx
		returning bucket
	`;
	return righe.length;
}

/**
 * Grezzi → giornaliero, finché i grezzi ci sono.
 *
 * I PERCENTILI NON SI MEDIANO. Prendere la media dei p95 orari per ottenere il p95
 * giornaliero è matematicamente sbagliato: il p95 di un insieme non è la media dei
 * p95 dei suoi sottoinsiemi. Quindi si calcola dai dati grezzi, che per i sette
 * giorni di retention ci sono sempre.
 *
 * Per i giorni in cui i grezzi sono già stati cancellati, il rollup giornaliero è
 * già stato scritto: non si ricalcola. Si guardano solo gli ultimi due giorni,
 * quello corrente e il precedente, che sono sempre coperti dai grezzi.
 */
export async function rollupGiornaliero(): Promise<number> {
	const soglia = timeoutMs();
	const righe = await sql`
		insert into request_metrics_daily (
			bucket, route, method, requests, c_ok, c_lente, avg_ms, p50_ms, p95_ms, p99_ms, max_ms, c4xx, c5xx
		)
		select
			date_trunc('day', created_at)::date as bucket,
			route,
			method,
			count(*)::int,
			count(*) filter (where riuscita)::int,
			count(*) filter (where status < 400 and duration_ms >= ${soglia})::int,
			-- Stessa regola dell'orario: la latenza descrive le risposte riuscite.
			coalesce(avg(duration_ms) filter (where riuscita), 0)::real,
			coalesce(percentile_disc(0.50) within group (order by duration_ms) filter (where riuscita), 0)::int,
			coalesce(percentile_disc(0.95) within group (order by duration_ms) filter (where riuscita), 0)::int,
			coalesce(percentile_disc(0.99) within group (order by duration_ms) filter (where riuscita), 0)::int,
			max(duration_ms),
			count(*) filter (where status >= 400 and status < 500)::int,
			count(*) filter (where status >= 500)::int
		from (
			select *, (status < 400 and duration_ms < ${soglia}) as riuscita
			from request_metrics
			where created_at >= date_trunc('day', now()) - interval '1 day'
		) m
		group by 1, 2, 3
		on conflict (bucket, route, method) do update set
			requests = excluded.requests,
			c_ok     = excluded.c_ok,
			c_lente  = excluded.c_lente,
			avg_ms   = excluded.avg_ms,
			p50_ms   = excluded.p50_ms,
			p95_ms   = excluded.p95_ms,
			p99_ms   = excluded.p99_ms,
			max_ms   = excluded.max_ms,
			c4xx     = excluded.c4xx,
			c5xx     = excluded.c5xx
		returning bucket
	`;
	return righe.length;
}

/**
 * Cancellazione a BATCH da 10.000 righe, con una pausa fra i giri.
 *
 * Perché non una sola DELETE: una delete gigante prende un lock lungo sulla
 * tabella, genera un blocco di WAL proporzionale e su una VPS con 2 vCPU
 * condivise si sente. A batch, ogni transazione è breve e Postgres può
 * intercalare il lavoro vero.
 *
 * La pausa da 50 ms non è superstizione: dà al checkpointer e all'autovacuum la
 * possibilità di stare al passo invece di accumulare lavoro.
 */
const BATCH = 10_000;
const MAX_BATCH_PER_RUN = 50;

async function cancellaABatch(condizione: 'retention' | 'tetto', limite: number): Promise<number> {
	let totale = 0;
	for (let giro = 0; giro < MAX_BATCH_PER_RUN; giro++) {
		const righe =
			condizione === 'retention'
				? await sql`
						delete from request_metrics
						where id in (
							select id from request_metrics
							where created_at < now() - make_interval(days => ${limite})
							limit ${BATCH}
						)
						returning id
					`
				: await sql`
						delete from request_metrics
						where id in (
							select id from request_metrics order by id asc limit ${BATCH}
						)
						returning id
					`;
		totale += righe.length;
		if (righe.length < BATCH) break;
		await new Promise((r) => setTimeout(r, 50));
	}
	return totale;
}

export type EsitoPulizia = {
	grezzi_cancellati: number;
	grezzi_cancellati_per_tetto: number;
	orari_cancellati: number;
	giornalieri_cancellati: number;
	righe_grezze_residue: number;
};

export async function pulizia(): Promise<EsitoPulizia> {
	// 1. Retention temporale sui grezzi.
	const perRetention = await cancellaABatch('retention', rawDays());

	// 2. TETTO DI SICUREZZA, indipendente dal tempo. Copre il caso che la retention
	//    non copre: un picco che riempie il disco prima che i sette giorni passino.
	//    Si cancella dalle righe più vecchie per id, che è anche l'ordine temporale.
	const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from request_metrics`;
	const tetto = maxRawRows();
	let perTetto = 0;
	if (n > tetto) {
		console.warn(`[metriche] ${n} righe grezze oltre il tetto di ${tetto}: pulizia aggressiva`);
		perTetto = await cancellaABatch('tetto', 0);
	}

	// 3. Retention sugli aggregati. Qui i volumi sono piccoli, una delete basta.
	const orari = await sql`
		delete from request_metrics_hourly
		where bucket < now() - make_interval(days => ${hourlyDays()})
		returning bucket
	`;
	const giornalieri = await sql`
		delete from request_metrics_daily
		where bucket < (now() - make_interval(days => ${dailyDays()}))::date
		returning bucket
	`;

	const [{ residue }] = await sql<{ residue: number }[]>`
		select count(*)::int as residue from request_metrics
	`;

	return {
		grezzi_cancellati: perRetention,
		grezzi_cancellati_per_tetto: perTetto,
		orari_cancellati: orari.length,
		giornalieri_cancellati: giornalieri.length,
		righe_grezze_residue: residue
	};
}

/**
 * Campione di occupazione, uno per esecuzione.
 *
 * Le dimensioni attuali si calcolano da plant_photos in qualunque momento; questo
 * serve al TREND, cioè alla domanda "sto crescendo o sono stabile?", che senza
 * storia non ha risposta.
 */
export async function campionaOccupazione(): Promise<void> {
	await sql`
		insert into storage_samples (photos, bytes_stored, bytes_thumb, bytes_original, db_bytes, db_connections)
		select
			(select count(*)::int from plant_photos),
			(select coalesce(sum(bytes_stored), 0) from plant_photos),
			(select coalesce(sum(bytes_thumb), 0) from plant_photos),
			(select coalesce(sum(bytes_original), 0) from plant_photos),
			pg_database_size(current_database()),
			(select count(*)::int from pg_stat_activity where datname = current_database())
		on conflict (at) do nothing
	`;
}

/** Retention dei campioni e degli esiti dei job: un anno basta a vedere un trend. */
export async function puliziaExtra(): Promise<{ campioni: number; run: number }> {
	const campioni = await sql`
		delete from storage_samples where at < now() - interval '365 days' returning at
	`;
	const run = await sql`
		delete from job_runs where started_at < now() - interval '90 days' returning id
	`;
	return { campioni: campioni.length, run: run.length };
}
