-- 013_metriche_esiti — la latenza si misura sulle risposte RIUSCITE
--
-- PROBLEMA CORRETTO QUI. Prima avg_ms, p50, p95, p99 e max erano calcolati su
-- TUTTE le richieste del bucket, errori compresi. Basta una chiamata che va in
-- timeout a 30 secondi per portarsi via la media di un'ora intera: il numero
-- diventa inservibile proprio quando serve, perché non distingue "il sito è
-- lento" da "una richiesta è morta".
--
-- Da qui in avanti le statistiche di latenza si calcolano SOLO sulle risposte
-- riuscite (2xx e 3xx) che stanno sotto METRICS_TIMEOUT_MS. Tutto il resto non
-- sparisce: viene contato a parte, in colonne sue, e la dashboard lo mostra
-- accanto — errori client, errori server e risposte oltre soglia.
--
-- Il 3xx conta come riuscita: un 304 Not Modified è una risposta corretta e
-- velocissima, escluderla falserebbe la media al ribasso opposto.
--
-- Le tabelle di rollup sono vuote o quasi al momento di questa migrazione, quindi
-- si possono cambiare le colonne senza migrare dati: il prossimo giro del job
-- ricalcola tutto dai grezzi, che non cambiano forma.

alter table request_metrics_hourly
	-- Numero di risposte su cui la latenza è calcolata. Serve anche come PESO
	-- quando si aggregano più bucket: `sum(avg_ms * c_ok) / sum(c_ok)`. Con
	-- `requests` come peso si otterrebbe una media sbagliata, perché avg_ms non
	-- descrive più tutte le richieste.
	add column c_ok integer not null default 0,
	-- Risposte riuscite ma oltre soglia: quelle che l'utente vede come "non
	-- risponde". Non entrano nella latenza, ma sono la cosa da guardare per prima.
	add column c_lente integer not null default 0,
	-- c2xx spariva dentro c_ok + c_lente ed era ambiguo (non contava i 3xx).
	drop column c2xx;

alter table request_metrics_daily
	add column c_ok integer not null default 0,
	add column c_lente integer not null default 0,
	drop column c2xx;
