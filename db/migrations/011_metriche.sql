-- 011_metriche — latenza ed errori per endpoint, con rollup e retention
--
-- Tre tabelle: i dati grezzi per le ultime ore, l'aggregato orario per le
-- settimane, quello giornaliero per l'anno. La dashboard legge dal livello giusto
-- in base al range chiesto, così nessuna query attraversa mai la tabella grezza
-- per un mese di dati.
--
-- PRIVACY, per costruzione e non per disciplina: qui non c'è un indirizzo IP, non
-- c'è uno user agent, non c'è una query string, non c'è un corpo di richiesta e non
-- c'è nessun identificatore di utente. Un solo booleano distingue autenticato da
-- anonimo, che è l'unica cosa utile di quella categoria. Le colonne che non
-- esistono non possono essere esfiltrate da un dump.
--
-- SPAZIO ATTESO a 10.000 richieste/giorno:
--   grezza, 7 giorni     70.000 righe    5,7 MB + 4,1 MB di indici =  9,8 MB
--   oraria, 90 giorni    32.400 righe    3,6 MB + 1,0 MB           =  4,6 MB
--   giornaliera, 12 mesi  5.500 righe    0,6 MB + 0,2 MB           =  0,8 MB
--                                                        totale   ≈ 15 MB
-- Al tetto di sicurezza di 2 milioni di righe grezze si arriva a ~290 MB, ed è il
-- numero che giustifica l'hard cap indipendente dalla retention temporale.

-- ---------------------------------------------------------------------------
-- PARTITIONING: valutato e scartato, con la soglia a cui cambierei idea.
--
-- `drop partition` è più economico di `delete`, ma a questi volumi la differenza
-- non esiste: la tabella grezza vive su 70.000 righe e una delete a batch da
-- 10.000 su una tabella così è irrilevante. Il partitioning porterebbe una
-- partizione al giorno da creare in anticipo con un job — pg_partman non è
-- disponibile su postgres:16-alpine — sette o più oggetti da gestire e la chiave
-- primaria da ripensare.
--
-- SOGLIA: sopra il milione di righe al giorno il partitioning diventa la scelta
-- giusta, perché lì le delete iniziano a gonfiare il WAL in modo visibile. A
-- 10.000/giorno siamo due ordini di grandezza sotto.
-- ---------------------------------------------------------------------------

create table request_metrics (
	id bigserial primary key,
	-- ROUTE ID di SvelteKit, non l'URL: '/api/plants/[id]/photos', mai
	-- '/api/plants/<uuid>/photos'. Due conseguenze, entrambe volute: la cardinalità
	-- resta bassa e stabile quindi i GROUP BY sono economici, e la tabella non
	-- contiene identificatori delle risorse di nessuno.
	route       text not null,
	method      text not null,
	status      smallint not null,
	duration_ms integer not null check (duration_ms >= 0),
	-- L'unica informazione sull'utente, e non lo identifica.
	authed      boolean not null default false,
	created_at  timestamptz not null default now()
);

-- Due indici e nient'altro. Il primo serve alla retention e a ogni finestra
-- temporale, il secondo alla tabella per endpoint. Niente indice su `status`: le
-- classi si contano con `filter (where ...)` dentro l'aggregazione, e su una
-- finestra già ristretta dal tempo non ha bisogno di un indice proprio. Ogni
-- indice in più costa disco e rallenta le scritture, che qui sono il caso normale.
create index request_metrics_created_idx on request_metrics (created_at);
create index request_metrics_route_created_idx on request_metrics (route, created_at);

-- ---------------------------------------------------------------------------
-- Rollup orario e giornaliero.
--
-- La chiave primaria composta È l'indice per le query della dashboard, e rende il
-- rollup IDEMPOTENTE: `on conflict do update`, quindi rieseguire il job sulla
-- stessa ora ricalcola invece di duplicare. È anche ciò che permette di far girare
-- il job più spesso di una volta all'ora senza pensarci.
-- ---------------------------------------------------------------------------
create table request_metrics_hourly (
	bucket   timestamptz not null,
	route    text not null,
	method   text not null,
	requests integer not null,
	avg_ms   real not null,
	p50_ms   integer not null,
	p95_ms   integer not null,
	p99_ms   integer not null,
	max_ms   integer not null,
	c2xx     integer not null,
	c4xx     integer not null,
	c5xx     integer not null,
	primary key (bucket, route, method)
);

create table request_metrics_daily (
	bucket   date not null,
	route    text not null,
	method   text not null,
	requests integer not null,
	avg_ms   real not null,
	p50_ms   integer not null,
	p95_ms   integer not null,
	p99_ms   integer not null,
	max_ms   integer not null,
	c2xx     integer not null,
	c4xx     integer not null,
	c5xx     integer not null,
	primary key (bucket, route, method)
);
