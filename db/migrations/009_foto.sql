-- 009_foto — le foto delle piante, e la quota a slot
--
-- Due tipi di foto nella stessa tabella, distinti da `kind`:
--   'avatar'  — UNA per pianta, l'immagine identificativa. Non consuma slot.
--   'gallery' — il diario di crescita. Consuma uno slot maturato.
--
-- Il file vero sta in MinIO; qui c'è solo la chiave con cui ritrovarlo.

create table plant_photos (
	id       uuid primary key default gen_random_uuid(),
	plant_id uuid not null references plants (id) on delete cascade,
	kind     text not null check (kind in ('avatar', 'gallery')),

	-- CHIAVE RELATIVA, mai una URL assoluta.
	--
	-- Il CHECK non è decorativo: è la garanzia che migrare da MinIO a Cloudflare
	-- R2 richieda solo il cambio di una variabile d'ambiente e la copia dei file,
	-- senza un UPDATE su Postgres. Se qualcuno tentasse di salvare
	-- 'https://minio.esempio/plants/...', il database rifiuta la riga invece di
	-- accumulare silenziosamente dati non portabili.
	object_key text not null unique check (object_key not like '%://%'),
	thumb_key  text not null unique check (thumb_key not like '%://%'),

	width  int not null check (width > 0),
	height int not null check (height > 0),
	-- I byte prima e dopo: servono a sapere quanto sta occupando il disco e
	-- quanto sta effettivamente risparmiando la compressione, senza doverlo
	-- chiedere a MinIO.
	bytes_original int not null check (bytes_original > 0),
	bytes_stored   int not null check (bytes_stored > 0),
	bytes_thumb    int not null check (bytes_thumb > 0),
	format         text not null default 'webp',
	created_at     timestamptz not null default now()
);

-- UN SOLO avatar per pianta, garantito dal database e non dalla buona volontà
-- dell'applicazione. Indice parziale: vincola solo le righe kind = 'avatar' e
-- lascia libere quelle della galleria.
create unique index plant_photos_avatar_key on plant_photos (plant_id)
	where kind = 'avatar';

-- Per l'elenco della galleria, dal più recente.
create index plant_photos_gallery_idx on plant_photos (plant_id, created_at desc)
	where kind = 'gallery';

-- ---------------------------------------------------------------------------
-- SLOT DELLA GALLERIA — unica fonte di verità
--
--   slot = 1 + numero di anniversari trimestrali già passati
--
-- Uno slot alla creazione, così l'utente ha subito qualcosa da fare, poi uno
-- ogni tre mesi di CALENDARIO.
--
-- Il conteggio usa `+ interval '3 months'` e NON `age()`. Verificato: su una
-- pianta creata il 31 gennaio, il 30 aprile `age()` restituisce "2 mons 30 days"
-- e quindi 1 solo slot, mentre l'anniversario è proprio quel giorno — Postgres
-- calcola 2026-01-31 + 3 mesi = 2026-04-30, troncando al mese più corto. Con
-- age() lo slot maturava un giorno tardi.
--
-- Gli intervalli restano ANCORATI alla data originale, quindi non accumulano
-- deriva: 31 gennaio -> 30 aprile -> 31 luglio, non 30 luglio.
--
-- Il tetto di 60 iterazioni è un limite dichiarato: 15 anni, 61 slot. Serve anche
-- a impedire che una data assurda (per esempio un created_at nel 1900 per un
-- errore di import) generi una serie enorme a ogni chiamata.
--
-- immutable: con entrambi gli argomenti passati dal chiamante la funzione è
-- deterministica, quindi il planner può usarla dentro un indice o una CHECK. È il
-- motivo per cui `adesso` è un parametro e non un now() interno.
-- ---------------------------------------------------------------------------
create or replace function gallery_slots(creata timestamptz, adesso timestamptz)
returns int language sql immutable as $$
	select 1 + (
		select count(*)
		from generate_series(1, 60) n
		where creata + (n * 3 || ' months')::interval <= adesso
	)::int
$$;

-- Data in cui maturerà il PROSSIMO slot: serve alla UI per dire "prossima foto
-- disponibile tra 12 giorni". Restituisce NULL oltre il tetto dei 15 anni.
create or replace function gallery_next_slot_at(creata timestamptz, adesso timestamptz)
returns timestamptz language sql immutable as $$
	select min(creata + (n * 3 || ' months')::interval)
	from generate_series(1, 60) n
	where creata + (n * 3 || ' months')::interval > adesso
$$;

-- ---------------------------------------------------------------------------
-- RETE DI SICUREZZA sulla quota
--
-- L'applicazione controlla già la quota prima di elaborare l'immagine, per poter
-- restituire un 409 leggibile invece di un 500 e per non spendere CPU su un
-- upload destinato a essere rifiutato. Questo trigger esiste perché quel
-- controllo, da solo, non basta:
--
--   - una rotta scritta in futuro potrebbe dimenticarsene;
--   - due richieste simultanee potrebbero leggere entrambe "1 slot libero".
--
-- Il `for update` sulla riga di plants è la parte che risolve davvero la race
-- condition: la seconda transazione aspetta la prima, e quando riparte conta le
-- righe già inserite. Sta QUI e non solo nell'applicazione proprio perché deve
-- valere per chiunque scriva in questa tabella.
--
-- errcode check_violation: l'API lo riconosce e lo traduce in 409.
-- ---------------------------------------------------------------------------
create or replace function plant_photos_quota() returns trigger
language plpgsql as $$
declare
	creata   timestamptz;
	maturati int;
	usati    int;
begin
	-- L'avatar non consuma slot: esce subito, e l'unicità la garantisce l'indice.
	if new.kind <> 'gallery' then
		return new;
	end if;

	select created_at into creata from plants where id = new.plant_id for update;
	if creata is null then
		raise exception 'pianta % inesistente', new.plant_id using errcode = 'foreign_key_violation';
	end if;

	maturati := gallery_slots(creata, now());
	select count(*) into usati
	from plant_photos
	where plant_id = new.plant_id and kind = 'gallery';

	if usati >= maturati then
		raise exception 'quota galleria esaurita: % slot maturati, % usati', maturati, usati
			using errcode = 'check_violation';
	end if;

	return new;
end
$$;

create trigger plant_photos_quota_before_insert
before insert on plant_photos
for each row execute function plant_photos_quota();
