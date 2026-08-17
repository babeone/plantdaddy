-- 010_foto_supporto — limite giornaliero degli upload e idempotenza dei promemoria

-- ---------------------------------------------------------------------------
-- Log degli upload, per il limite giornaliero per utente.
--
-- Perché una tabella e non un conteggio su plant_photos: gli slot limitano quante
-- foto sono CONSERVATE insieme, non quante ne sono state caricate. Un utente
-- potrebbe cancellare e ricaricare all'infinito restando sempre dentro la quota,
-- e ogni giro costa decodifica, encoding e scritture su disco. Le foto cancellate
-- non sono più in plant_photos, quindi contarle lì non frenerebbe nulla.
--
-- Perché non la mappa in memoria di src/lib/server/rate-limit.ts: quella si
-- azzera a ogni deploy, e un limite giornaliero che si resetta con un
-- aggiornamento non è un limite giornaliero.
--
-- Le righe vengono potate dal job di cleanup: oltre la finestra non servono più.
-- ---------------------------------------------------------------------------
create table photo_uploads (
	id              bigserial primary key,
	user_token_hash text not null references users (token_hash) on delete cascade,
	at              timestamptz not null default now()
);

create index photo_uploads_user_at_idx on photo_uploads (user_token_hash, at desc);

-- ---------------------------------------------------------------------------
-- Promemoria già inviati.
--
-- La chiave primaria (plant_id, slot) È il meccanismo di idempotenza: un secondo
-- invio per la stessa pianta e lo stesso slot viola la chiave, quindi rieseguire
-- il job lo stesso giorno — o due volte per un riavvio a metà — non produce
-- notifiche duplicate. Non serve confrontare date né tenere un flag "già fatto".
--
-- Nessuna riga per lo slot 1: quello nasce con la pianta, mentre l'utente è
-- davanti allo schermo, e non genera promemoria. Il primo arriva a tre mesi.
-- ---------------------------------------------------------------------------
create table photo_reminders (
	plant_id uuid not null references plants (id) on delete cascade,
	slot     int not null check (slot >= 2),
	sent_at  timestamptz not null default now(),
	primary key (plant_id, slot)
);
