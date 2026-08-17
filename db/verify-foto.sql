-- Controllo della quota foto: maturazione degli slot sui casi limite del
-- calendario, unicità dell'avatar, rete di sicurezza del trigger.
--
-- Gira dentro una transazione che finisce in ROLLBACK: non lascia dati, quindi si
-- può lanciare anche sul database di sviluppo.
--
--   psql "$DATABASE_URL" -f db/verify-foto.sql
--
-- Il calcolo degli slot è implementato in SQL (gallery_slots, migrazione 009) e
-- viene provato QUI, sulla funzione vera. Una versione parallela in TypeScript da
-- testare a parte sarebbe finita per divergere dal trigger, e la divergenza si
-- manifesta nel modo peggiore: l'API dice "3 slot liberi" e il database ne
-- accetta 2.
--
-- I confronti usano `is distinct from` e non `<>`: in SQL `NULL <> x` vale NULL,
-- quindi un valore mancante passerebbe il controllo invece di farlo fallire.

begin;

-- ---------------------------------------------------------------------------
-- 1. Maturazione degli slot. Nessun dato coinvolto: è tutta la funzione.
--    Formula attesa: 1 slot alla creazione, +1 a ogni anniversario trimestrale.
-- ---------------------------------------------------------------------------
do $$
declare
	c   record;
	got int;
begin
	for c in
		select * from (values
			-- (creazione, momento, slot attesi, descrizione)
			('2026-01-15', '2026-01-15', 1, 'appena creata'),
			('2026-01-15', '2026-04-14', 1, 'un giorno prima dei 3 mesi'),
			('2026-01-15', '2026-04-15', 2, 'esattamente 3 mesi'),
			('2026-01-15', '2026-07-15', 3, '6 mesi'),
			('2026-01-15', '2027-01-15', 5, '12 mesi'),
			('2026-01-15', '2028-01-15', 9, '24 mesi'),

			-- Il caso che rompe l'aritmetica fatta a mano: il 31 aprile non esiste.
			-- Postgres tronca al 30, ed è lì che lo slot deve maturare.
			('2026-01-31', '2026-04-29', 1, '31 gennaio, il 29 aprile'),
			('2026-01-31', '2026-04-30', 2, '31 gennaio, il 30 aprile: lo slot matura qui'),
			('2026-01-31', '2026-05-01', 2, '31 gennaio, il primo maggio'),
			-- E senza deriva: a sei mesi torna al 31, non resta al 30.
			('2026-01-31', '2026-07-30', 2, '31 gennaio, il 30 luglio: ancora 2'),
			('2026-01-31', '2026-07-31', 3, '31 gennaio, il 31 luglio: il terzo'),

			-- 30 novembre + 3 mesi cade in febbraio, che ha 28 giorni.
			('2025-11-30', '2026-02-27', 1, '30 novembre, il 27 febbraio'),
			('2025-11-30', '2026-02-28', 2, '30 novembre, il 28 febbraio'),

			-- 29 febbraio di un anno bisestile: l'anniversario annuale cade il 28.
			('2024-02-29', '2024-05-28', 1, '29 febbraio, il 28 maggio'),
			('2024-02-29', '2024-05-29', 2, '29 febbraio, il 29 maggio'),
			('2024-02-29', '2025-02-28', 5, '29 febbraio, un anno dopo'),

			-- 31 agosto -> 30 novembre: altro mese corto.
			('2026-08-31', '2026-11-29', 1, '31 agosto, il 29 novembre'),
			('2026-08-31', '2026-11-30', 2, '31 agosto, il 30 novembre'),

			-- Il tetto dichiarato: 15 anni, 61 slot, e oltre non cresce.
			('2010-01-01', '2025-01-01', 61, '15 anni: il tetto'),
			('2010-01-01', '2040-01-01', 61, '30 anni: resta al tetto')
		) t(creata, adesso, attesi, descrizione)
	loop
		got := gallery_slots(c.creata::timestamptz, c.adesso::timestamptz);
		if got is distinct from c.attesi then
			raise exception 'slot %: attesi %, ottenuti % (creata %, adesso %)',
				c.descrizione, c.attesi, got, c.creata, c.adesso;
		end if;
	end loop;
	raise notice 'verify-foto 1: maturazione degli slot, 20 casi passati';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Data del prossimo slot: quella che la UI mostra come "prossima foto tra N
--    giorni". Deve essere la prima STRETTAMENTE successiva al momento dato.
-- ---------------------------------------------------------------------------
do $$
declare
	c   record;
	got timestamptz;
begin
	for c in
		select * from (values
			('2026-01-15', '2026-01-15', '2026-04-15', 'appena creata'),
			('2026-01-15', '2026-04-15', '2026-07-15', 'il giorno stesso in cui matura'),
			('2026-01-31', '2026-04-29', '2026-04-30', '31 gennaio: il prossimo e il 30 aprile'),
			('2026-01-31', '2026-04-30', '2026-07-31', 'e quello dopo torna al 31')
		) t(creata, adesso, atteso, descrizione)
	loop
		got := gallery_next_slot_at(c.creata::timestamptz, c.adesso::timestamptz);
		if got is distinct from c.atteso::timestamptz then
			raise exception 'prossimo slot %: atteso %, ottenuto %', c.descrizione, c.atteso, got;
		end if;
	end loop;

	-- Oltre il tetto non c'è un prossimo slot: NULL, non una data inventata.
	if gallery_next_slot_at('2010-01-01'::timestamptz, '2040-01-01'::timestamptz) is not null then
		raise exception 'oltre il tetto il prossimo slot deve essere NULL';
	end if;
	raise notice 'verify-foto 2: data del prossimo slot, 4 casi + tetto passati';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Il trigger: quota rispettata, avatar unico, avatar che non consuma slot.
-- ---------------------------------------------------------------------------
do $$
declare
	tok    text := repeat('e', 64);
	nuova  uuid;   -- creata adesso: 1 solo slot
	vecchia uuid;  -- creata 7 mesi fa: 3 slot
	n      int;
begin
	insert into users (token_hash, display_name) values (tok, 'Verify Foto');

	insert into plants (user_token_hash, name, watering_interval_days, created_at)
	values (tok, 'Nuova', 7, now()) returning id into nuova;
	insert into plants (user_token_hash, name, watering_interval_days, created_at)
	values (tok, 'Vecchia', 7, now() - interval '7 months') returning id into vecchia;

	-- 3a. una pianta appena creata ha 1 slot: la prima foto passa
	insert into plant_photos (plant_id, kind, object_key, thumb_key, width, height,
		bytes_original, bytes_stored, bytes_thumb)
	values (nuova, 'gallery', 'plants/n/1.webp', 'plants/n/1_thumb.webp', 1600, 1200, 4000000, 380000, 38000);

	-- 3b. la seconda no
	begin
		insert into plant_photos (plant_id, kind, object_key, thumb_key, width, height,
			bytes_original, bytes_stored, bytes_thumb)
		values (nuova, 'gallery', 'plants/n/2.webp', 'plants/n/2_thumb.webp', 1600, 1200, 4000000, 380000, 38000);
		raise exception 'seconda foto accettata su una pianta con 1 solo slot';
	exception
		when check_violation then null;
	end;

	-- 3c. l'AVATAR passa comunque: non consuma slot della galleria
	insert into plant_photos (plant_id, kind, object_key, thumb_key, width, height,
		bytes_original, bytes_stored, bytes_thumb)
	values (nuova, 'avatar', 'plants/n/av.webp', 'plants/n/av_thumb.webp', 512, 512, 4000000, 35000, 4000);

	-- 3d. e un secondo avatar no: lo blocca l'indice unico parziale
	begin
		insert into plant_photos (plant_id, kind, object_key, thumb_key, width, height,
			bytes_original, bytes_stored, bytes_thumb)
		values (nuova, 'avatar', 'plants/n/av2.webp', 'plants/n/av2_thumb.webp', 512, 512, 4000000, 35000, 4000);
		raise exception 'secondo avatar accettato: manca l''indice unico';
	exception
		when unique_violation then null;
	end;

	-- 3e. cancellare una foto della galleria libera lo slot
	delete from plant_photos where plant_id = nuova and kind = 'gallery';
	insert into plant_photos (plant_id, kind, object_key, thumb_key, width, height,
		bytes_original, bytes_stored, bytes_thumb)
	values (nuova, 'gallery', 'plants/n/3.webp', 'plants/n/3_thumb.webp', 1600, 1200, 4000000, 380000, 38000);

	-- 3f. gli slot NON scadono: 7 mesi = 3 slot, e si possono usare tutti insieme
	if gallery_slots((select created_at from plants where id = vecchia), now()) is distinct from 3 then
		raise exception 'pianta di 7 mesi: attesi 3 slot';
	end if;
	insert into plant_photos (plant_id, kind, object_key, thumb_key, width, height,
		bytes_original, bytes_stored, bytes_thumb)
	select vecchia, 'gallery', 'plants/v/' || g || '.webp', 'plants/v/' || g || '_thumb.webp',
		1600, 1200, 4000000, 380000, 38000
	from generate_series(1, 3) g;

	select count(*) into n from plant_photos where plant_id = vecchia and kind = 'gallery';
	if n is distinct from 3 then
		raise exception 'attese 3 foto sulla pianta vecchia, trovate %', n;
	end if;

	-- 3g. la quarta no
	begin
		insert into plant_photos (plant_id, kind, object_key, thumb_key, width, height,
			bytes_original, bytes_stored, bytes_thumb)
		values (vecchia, 'gallery', 'plants/v/4.webp', 'plants/v/4_thumb.webp', 1600, 1200, 4000000, 380000, 38000);
		raise exception 'quarta foto accettata su una pianta con 3 slot';
	exception
		when check_violation then null;
	end;

	-- 3h. una URL assoluta non entra: è la garanzia di portabilità verso R2
	begin
		insert into plant_photos (plant_id, kind, object_key, thumb_key, width, height,
			bytes_original, bytes_stored, bytes_thumb)
		values (vecchia, 'gallery', 'https://minio.esempio/plants/v/5.webp', 'plants/v/5_thumb.webp',
			1600, 1200, 4000000, 380000, 38000);
		raise exception 'URL assoluta accettata come object_key: manca il CHECK';
	exception
		when check_violation then null;
	end;

	-- 3i. cancellare la pianta porta via le sue foto (CASCADE)
	delete from plants where id = vecchia;
	select count(*) into n from plant_photos where plant_id = vecchia;
	if n is distinct from 0 then
		raise exception 'CASCADE non ha rimosso le foto della pianta cancellata: % righe', n;
	end if;

	raise notice 'verify-foto 3: trigger di quota e vincoli, tutti i controlli passati';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Idempotenza dei promemoria: la chiave primaria è il meccanismo.
-- ---------------------------------------------------------------------------
do $$
declare
	tok text := repeat('d', 64);
	p   uuid;
begin
	insert into users (token_hash, display_name) values (tok, 'Verify Promemoria');
	insert into plants (user_token_hash, name, watering_interval_days)
	values (tok, 'Promemoria', 7) returning id into p;

	insert into photo_reminders (plant_id, slot) values (p, 2);
	begin
		insert into photo_reminders (plant_id, slot) values (p, 2);
		raise exception 'promemoria duplicato accettato: il job potrebbe inviare due volte';
	exception
		when unique_violation then null;
	end;

	-- Lo slot 1 non genera promemoria, e il vincolo lo rende esplicito.
	begin
		insert into photo_reminders (plant_id, slot) values (p, 1);
		raise exception 'promemoria per lo slot 1 accettato: quello non deve esistere';
	exception
		when check_violation then null;
	end;

	raise notice 'verify-foto 4: idempotenza dei promemoria, controlli passati';
end;
$$;

rollback;
