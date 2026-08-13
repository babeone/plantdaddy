-- Controllo dello schema: verifica la view plant_status, la precedenza dello
-- snooze, la derivazione delle date dagli eventi, la rotazione FIFO a 300 e
-- l'idempotenza del doppio tap.
--
-- Gira dentro una transazione che finisce in ROLLBACK: non lascia dati, quindi
-- si può lanciare anche sul database di sviluppo.
--
--   psql "$DATABASE_URL" -f db/verify.sql
--
-- Se qualcosa non torna solleva un'eccezione con il valore trovato.

begin;

do $$
declare
	tok   text := repeat('f', 64);
	pid   uuid;
	qid   uuid;
	st    record;
	n     int;
	oldest date;
begin
	insert into users (token_hash) values (tok);
	insert into plants (user_token_hash, name, watering_interval_days, fertilizing_interval_days)
	values (tok, 'Verify', 7, 30) returning id into pid;

	insert into care_events (plant_id, type, event_date) values (pid, 'water', current_date - 3);
	insert into care_events (plant_id, type, event_date) values (pid, 'fertilize', current_date - 10);

	-- 1. intervalli nominali e scadenze derivate
	select * into st from plant_status where id = pid;
	if st.last_watered <> current_date - 3 then
		raise exception 'last_watered atteso %, trovato %', current_date - 3, st.last_watered;
	end if;
	if st.next_watering <> current_date + 4 then
		raise exception 'next_watering atteso %, trovato %', current_date + 4, st.next_watering;
	end if;
	if st.next_fertilizing <> current_date + 20 then
		raise exception 'next_fertilizing atteso %, trovato %', current_date + 20, st.next_fertilizing;
	end if;

	-- 2. modalità inverno: 7 x 1.5 = 10.5 -> 11, 30 x 1.5 = 45
	update users set winter_mode = true where token_hash = tok;
	select * into st from plant_status where id = pid;
	if st.effective_watering_interval <> 11 or st.effective_fertilizing_interval <> 45 then
		raise exception 'inverno: intervalli % e %', st.effective_watering_interval, st.effective_fertilizing_interval;
	end if;
	update users set winter_mode = false where token_hash = tok;

	-- 3. snooze futuro prevale, snooze passato non arretra la scadenza
	update plants set water_snoozed_until = current_date + 30 where id = pid;
	select * into st from plant_status where id = pid;
	if st.next_watering <> current_date + 30 then
		raise exception 'snooze futuro ignorato: %', st.next_watering;
	end if;
	update plants set water_snoozed_until = current_date - 90 where id = pid;
	select * into st from plant_status where id = pid;
	if st.next_watering <> current_date + 4 then
		raise exception 'snooze passato ha arretrato la scadenza: %', st.next_watering;
	end if;
	update plants set water_snoozed_until = null where id = pid;

	-- 4. eliminando l'ultimo evento la data torna a quella precedente
	insert into care_events (plant_id, type, event_date) values (pid, 'water', current_date - 17);
	delete from care_events where plant_id = pid and type = 'water' and event_date = current_date - 3;
	select * into st from plant_status where id = pid;
	if st.last_watered <> current_date - 17 or st.next_watering <> current_date - 10 then
		raise exception 'rollback data: last % next %', st.last_watered, st.next_watering;
	end if;

	-- 5. mai annaffiata -> NULL, mai concimata -> NULL
	select * into st from plant_status where id = pid;
	delete from care_events where plant_id = pid;
	select * into st from plant_status where id = pid;
	if st.next_watering is not null or st.next_fertilizing is not null then
		raise exception 'senza eventi le scadenze devono essere NULL: % %', st.next_watering, st.next_fertilizing;
	end if;

	-- 6. quota: 305 inserimenti, restano i 300 più recenti
	insert into plants (user_token_hash, name, watering_interval_days)
	values (tok, 'Quota', 7) returning id into qid;
	insert into care_events (plant_id, type, event_date)
	select qid, 'water', current_date - g from generate_series(0, 304) g;
	select count(*), min(event_date) into n, oldest from care_events where plant_id = qid;
	if n <> 300 or oldest <> current_date - 299 then
		raise exception 'rotazione FIFO: % eventi, più vecchio %', n, oldest;
	end if;

	-- 7. doppio tap: il DB rifiuta il secondo evento identico
	begin
		insert into care_events (plant_id, type, event_date) values (qid, 'water', current_date);
		raise exception 'doppio tap accettato: manca il vincolo UNIQUE';
	exception
		when unique_violation then null;
	end;

	raise notice 'verify: tutti i controlli passati';
end;
$$;

rollback;
