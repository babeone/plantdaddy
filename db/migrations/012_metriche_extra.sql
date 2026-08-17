-- 012_metriche_extra — esiti dei job e campioni di occupazione
--
-- Due tabelle piccolissime che riempiono due buchi conoscitivi.
--
-- Buona parte delle metriche aggiuntive NON ha bisogno di tabelle: plant_photos
-- salva già bytes_original, bytes_stored e bytes_thumb per ogni foto, quindi
-- compressione media, occupazione totale e conteggio oggetti si leggono da lì a
-- costo zero. Gli utenti attivi si contano da care_events.created_at. Gli esiti
-- degli upload si leggono dalle metriche di richiesta filtrando le rotte foto.
-- Queste due tabelle esistono solo per ciò che oggi non è scritto da nessuna parte.

-- ---------------------------------------------------------------------------
-- Esiti dei job schedulati.
--
-- Oggi i quattro cron stampano il risultato in stdout e finisce nel log del
-- container, che nessuno guarda e che Docker non ruota. Risultato: alla domanda
-- "il cron sta girando davvero?" il pannello può solo rispondere per indizi,
-- guardando se gli action token vengono ripuliti. Una riga per esecuzione la
-- rende una domanda con risposta.
--
-- `detail` in jsonb e non colonne fisse: ogni job ha numeri diversi (push inviate,
-- orfani cancellati, promemoria registrati) e non ha senso una tabella con dodici
-- colonne quasi sempre nulle.
-- ---------------------------------------------------------------------------
create table job_runs (
	id          bigserial primary key,
	job         text not null,
	started_at  timestamptz not null,
	finished_at timestamptz not null default now(),
	duration_ms integer not null check (duration_ms >= 0),
	ok          boolean not null,
	detail      jsonb,
	error       text
);

create index job_runs_job_started_idx on job_runs (job, started_at desc);

-- ---------------------------------------------------------------------------
-- Campioni di occupazione, uno all'ora dal job di rollup.
--
-- Le dimensioni ATTUALI si calcolano da plant_photos in qualsiasi momento; questa
-- tabella serve al TREND, che è la cosa che dice quando ti stai avvicinando al
-- limite del disco. Senza campioni storici la domanda "sto crescendo o sono
-- stabile?" non ha risposta.
--
-- 24 righe al giorno, ~9.000 all'anno: nell'ordine dei KB.
-- ---------------------------------------------------------------------------
create table storage_samples (
	at            timestamptz primary key default now(),
	photos        integer not null,
	bytes_stored  bigint not null,
	bytes_thumb   bigint not null,
	bytes_original bigint not null,
	db_bytes      bigint not null,
	-- Connessioni in uso sul database al momento del campione, da pg_stat_activity.
	-- Il pool dell'app ha max 10: questo dice quanto ci si avvicina.
	db_connections integer not null
);
