import { sql } from '$lib/server/db';
import { inBuffer, stato } from '$lib/server/metrics/buffer';
import {
	alwaysAboveMs,
	bufferMax,
	dailyDays,
	flushMs,
	hourlyDays,
	maxRawRows,
	metricsEnabled,
	rawDays,
	sampleRate
} from '$lib/server/metrics/config';

/**
 * Query della dashboard metriche. Tutte di sola lettura.
 *
 * DUE REGOLE RISPETTATE OVUNQUE QUI DENTRO, e da rispettare se se ne aggiungono:
 *
 * 1. FILTRO TEMPORALE OBBLIGATORIO. Nessuna query senza `where ... >= now() - ...`.
 *    Una query che scandisce la tabella intera su una VPS con 2 vCPU condivise fa
 *    danno proprio quando la stai guardando perché qualcosa va male.
 *
 * 2. `statement_timeout` LOCALE. Ogni lettura gira in una transazione con un tetto
 *    di 3 secondi: una query pesante viene interrotta da Postgres invece di tenere
 *    occupata una connessione del pool, che ne ha dieci in tutto.
 *
 * E una regola di instradamento: range brevi dalla tabella grezza, range lunghi
 * dagli aggregati. Mai la grezza per un mese.
 */

const TIMEOUT = '3s';

/**
 * Ogni lettura passa da qui, così il timeout non si può dimenticare.
 *
 * Il cast in uscita serve perché `sql.begin` dichiara UnwrapPromiseArray sul
 * ritorno del callback: è pensato per chi restituisce un array di query e vuole
 * l'array dei risultati. Qui il callback restituisce già un valore risolto, quindi
 * i due tipi coincidono a runtime ma TypeScript non lo può dimostrare.
 */
async function conTimeout<T>(lavoro: (tx: typeof sql) => Promise<T>): Promise<T> {
	const esito = await sql.begin(async (tx) => {
		// set_config(..., true) e NON `set local statement_timeout = $1`: il comando
		// SET di Postgres non accetta parametri di bind, e passarglieli dà
		// `syntax error at or near "$1"`. set_config è una funzione, quindi il valore
		// può essere parametrizzato — e il terzo argomento `true` significa
		// esattamente `local`, cioè valido per questa transazione e annullato al
		// commit, così la connessione torna pulita nel pool.
		await tx`select set_config('statement_timeout', ${TIMEOUT}, true)`;
		return lavoro(tx as unknown as typeof sql);
	});
	return esito as T;
}

export type Range = '24h' | '7g' | '30g';

/** Ore corrispondenti al range, e se serve la grezza o un aggregato. */
function finestra(range: Range): { ore: number; fonte: 'raw' | 'hourly' | 'daily' } {
	if (range === '24h') return { ore: 24, fonte: 'raw' };
	if (range === '7g') return { ore: 24 * 7, fonte: 'hourly' };
	return { ore: 24 * 30, fonte: 'daily' };
}

export type Riepilogo = {
	requests: number;
	avg_ms: number;
	p95_ms: number;
	c4xx: number;
	c5xx: number;
	error_rate: number;
};

export async function riepilogo24h(): Promise<Riepilogo> {
	return conTimeout(async (tx) => {
		const [row] = await tx<
			{ requests: number; avg_ms: number; p95_ms: number; c4xx: number; c5xx: number }[]
		>`
			select
				count(*)::int as requests,
				coalesce(avg(duration_ms), 0)::real as avg_ms,
				coalesce(percentile_disc(0.95) within group (order by duration_ms), 0)::int as p95_ms,
				count(*) filter (where status >= 400 and status < 500)::int as c4xx,
				count(*) filter (where status >= 500)::int as c5xx
			from request_metrics
			where created_at >= now() - interval '24 hours'
		`;
		return {
			...row,
			error_rate: row.requests === 0 ? 0 : (row.c5xx / row.requests) * 100
		};
	});
}

export type PerEndpoint = {
	route: string;
	method: string;
	requests: number;
	avg_ms: number;
	p95_ms: number;
	p99_ms: number;
	c4xx: number;
	c5xx: number;
};

/** Ordinamenti ammessi: whitelist, perché finiscono in un frammento SQL. */
const ORDINI = {
	requests: 'requests desc',
	avg: 'avg_ms desc',
	p95: 'p95_ms desc',
	p99: 'p99_ms desc',
	errori: 'c5xx desc, c4xx desc',
	route: 'route asc'
} as const;

export type Ordine = keyof typeof ORDINI;

export function ordineValido(valore: string | null): Ordine {
	return valore && valore in ORDINI ? (valore as Ordine) : 'requests';
}

export async function perEndpoint(range: Range, ordine: Ordine): Promise<PerEndpoint[]> {
	const { ore, fonte } = finestra(range);
	// L'ordinamento arriva da una whitelist e non dalla query string grezza: è
	// l'unico punto di questo file dove un frammento non è parametrizzato, e per
	// questo il valore non può che venire da ORDINI.
	const orderBy = sql.unsafe(ORDINI[ordine]);

	return conTimeout(async (tx) => {
		if (fonte === 'raw') {
			return tx<PerEndpoint[]>`
				select
					route, method,
					count(*)::int as requests,
					avg(duration_ms)::real as avg_ms,
					percentile_disc(0.95) within group (order by duration_ms)::int as p95_ms,
					percentile_disc(0.99) within group (order by duration_ms)::int as p99_ms,
					count(*) filter (where status >= 400 and status < 500)::int as c4xx,
					count(*) filter (where status >= 500)::int as c5xx
				from request_metrics
				where created_at >= now() - make_interval(hours => ${ore})
				group by route, method
				order by ${orderBy}
				limit 100
			`;
		}
		// Dagli aggregati: le richieste si sommano, la media si pondera sul numero di
		// richieste (una media di medie non ponderata sarebbe sbagliata), e per i
		// percentili si prende il MASSIMO dei percentili dei bucket — approssimazione
		// conservativa, perché la media di percentili non ha senso matematico.
		const tabella = fonte === 'hourly' ? sql`request_metrics_hourly` : sql`request_metrics_daily`;
		return tx<PerEndpoint[]>`
			select
				route, method,
				sum(requests)::int as requests,
				(sum(avg_ms * requests) / greatest(sum(requests), 1))::real as avg_ms,
				max(p95_ms)::int as p95_ms,
				max(p99_ms)::int as p99_ms,
				sum(c4xx)::int as c4xx,
				sum(c5xx)::int as c5xx
			from ${tabella}
			where bucket >= now() - make_interval(hours => ${ore})
			group by route, method
			order by ${orderBy}
			limit 100
		`;
	});
}

export type PuntoSerie = { at: Date; p95_ms: number; requests: number; c5xx: number };

/** Serie temporale per i due grafici. Un punto per ora o per giorno. */
export async function serie(range: Range): Promise<PuntoSerie[]> {
	const { ore, fonte } = finestra(range);
	return conTimeout(async (tx) => {
		if (fonte === 'raw') {
			return tx<PuntoSerie[]>`
				select
					date_trunc('hour', created_at) as at,
					percentile_disc(0.95) within group (order by duration_ms)::int as p95_ms,
					count(*)::int as requests,
					count(*) filter (where status >= 500)::int as c5xx
				from request_metrics
				where created_at >= now() - make_interval(hours => ${ore})
				group by 1
				order by 1
			`;
		}
		const tabella = fonte === 'hourly' ? sql`request_metrics_hourly` : sql`request_metrics_daily`;
		return tx<PuntoSerie[]>`
			select
				bucket::timestamptz as at,
				max(p95_ms)::int as p95_ms,
				sum(requests)::int as requests,
				sum(c5xx)::int as c5xx
			from ${tabella}
			where bucket >= now() - make_interval(hours => ${ore})
			group by 1
			order by 1
		`;
	});
}

export type Salute = {
	enabled: boolean;
	sample_rate: number;
	always_above_ms: number;
	buffer_usati: number;
	buffer_max: number;
	flush_ms: number;
	scritti: number;
	scartati: number;
	flush_ok: number;
	flush_falliti: number;
	ultimo_flush_ok: Date | null;
	ultimo_errore: string | null;
	breaker_aperto_fino_a: Date | null;
	righe_grezze: number;
	tetto_righe: number;
	bytes_metriche: number;
	retention: { raw: number; hourly: number; daily: number };
};

/**
 * Salute del sistema di metriche.
 *
 * Metà arriva dalla memoria del processo (buffer, circuit breaker) e metà dal
 * database. La parte in memoria è la ragione per cui questa pagina è utile: dice
 * se la raccolta sta funzionando, non solo cosa ha raccolto.
 */
export async function salute(): Promise<Salute> {
	const db = await conTimeout(async (tx) => {
		const [row] = await tx<{ righe: number; bytes: string }[]>`
			select
				(select count(*)::int from request_metrics) as righe,
				(
					pg_total_relation_size('request_metrics')
					+ pg_total_relation_size('request_metrics_hourly')
					+ pg_total_relation_size('request_metrics_daily')
				)::text as bytes
		`;
		return row;
	});

	return {
		enabled: metricsEnabled(),
		sample_rate: sampleRate(),
		always_above_ms: alwaysAboveMs(),
		buffer_usati: inBuffer(),
		buffer_max: bufferMax(),
		flush_ms: flushMs(),
		scritti: stato.scritti,
		scartati: stato.scartati,
		flush_ok: stato.flushOk,
		flush_falliti: stato.flushFalliti,
		ultimo_flush_ok: stato.ultimoFlushOk,
		ultimo_errore: stato.ultimoErrore,
		breaker_aperto_fino_a: stato.apertoFinoA,
		righe_grezze: db.righe,
		tetto_righe: maxRawRows(),
		bytes_metriche: Number(db.bytes),
		retention: { raw: rawDays(), hourly: hourlyDays(), daily: dailyDays() }
	};
}

export type Extra = {
	foto: { n: number; stored: number; thumb: number; original: number } | null;
	upload: { ok: number; rifiutati_quota: number; rifiutati_limite: number; falliti: number };
	attivi: { giorno: number; mese: number };
	job: { job: string; ok: boolean; started_at: Date; duration_ms: number }[];
	push: { inviate: number; fallite: number; rimosse: number };
	occupazione: { at: Date; bytes_stored: number; db_bytes: number; db_connections: number }[];
};

/**
 * Metriche aggiuntive.
 *
 * Quasi tutto qui NON richiede una raccolta dedicata: `plant_photos` salva già i
 * byte prima e dopo la compressione, `care_events` ha i timestamp per gli utenti
 * attivi, e gli esiti degli upload si leggono dalle metriche di richiesta filtrando
 * le rotte delle foto. Aggiungere tabelle per dati già presenti sarebbe stato
 * lavoro e disco sprecati.
 */
export async function extra(): Promise<Extra> {
	return conTimeout(async (tx) => {
		const [foto] = await tx<{ n: number; stored: string; thumb: string; original: string }[]>`
			select
				count(*)::int as n,
				coalesce(sum(bytes_stored), 0)::text as stored,
				coalesce(sum(bytes_thumb), 0)::text as thumb,
				coalesce(sum(bytes_original), 0)::text as original
			from plant_photos
		`;

		// Esiti degli upload dalle metriche di richiesta: POST sulle rotte foto.
		const [upload] = await tx<{ ok: number; quota: number; limite: number; falliti: number }[]>`
			select
				count(*) filter (where status = 201)::int as ok,
				count(*) filter (where status = 409)::int as quota,
				count(*) filter (where status = 429)::int as limite,
				count(*) filter (where status >= 500)::int as falliti
			from request_metrics
			where created_at >= now() - interval '30 days'
				and method = 'POST'
				and (route like '/api/plants/[id]/photos%' or route like '/api/plants/[id]/avatar%')
		`;

		const [attivi] = await tx<{ giorno: number; mese: number }[]>`
			select
				count(distinct p.user_token_hash) filter (where ce.created_at >= now() - interval '1 day')::int as giorno,
				count(distinct p.user_token_hash) filter (where ce.created_at >= now() - interval '30 days')::int as mese
			from care_events ce
			join plants p on p.id = ce.plant_id
			where ce.created_at >= now() - interval '30 days'
		`;

		const job = await tx<{ job: string; ok: boolean; started_at: Date; duration_ms: number }[]>`
			select distinct on (job) job, ok, started_at, duration_ms
			from job_runs
			where started_at >= now() - interval '7 days'
			order by job, started_at desc
		`;

		// Le push le contano già i due job che le inviano: i numeri stanno in
		// job_runs.detail, quindi si sommano da lì senza una tabella nuova.
		const [push] = await tx<{ inviate: number; fallite: number; rimosse: number }[]>`
			select
				coalesce(sum((detail->>'push_inviate')::int) + sum((detail->>'sent')::int), 0)::int as inviate,
				coalesce(sum((detail->>'push_fallite')::int) + sum((detail->>'failed')::int), 0)::int as fallite,
				coalesce(sum((detail->>'subscription_rimosse')::int) + sum((detail->>'removed')::int), 0)::int as rimosse
			from job_runs
			where started_at >= now() - interval '30 days' and detail is not null
		`;

		const occupazione = await tx<
			{ at: Date; bytes_stored: string; db_bytes: string; db_connections: number }[]
		>`
			select at, bytes_stored::text, db_bytes::text, db_connections
			from storage_samples
			where at >= now() - interval '30 days'
			order by at
		`;

		return {
			foto:
				foto.n === 0
					? null
					: {
							n: foto.n,
							stored: Number(foto.stored),
							thumb: Number(foto.thumb),
							original: Number(foto.original)
						},
			upload: {
				ok: upload.ok,
				rifiutati_quota: upload.quota,
				rifiutati_limite: upload.limite,
				falliti: upload.falliti
			},
			attivi,
			job,
			push,
			occupazione: occupazione.map((o) => ({
				at: o.at,
				bytes_stored: Number(o.bytes_stored),
				db_bytes: Number(o.db_bytes),
				db_connections: o.db_connections
			}))
		};
	});
}
