-- 004_note_pianta — una nota di testo libero sulla pianta
--
-- Diversa da care_events.note, che riguarda il singolo evento ("poca acqua,
-- terra ancora umida"). Questa riguarda la pianta in sé — esposizione,
-- terriccio, che d'inverno va spostata — e resta visibile senza scorrere lo
-- storico. Il nome è `notes` al plurale proprio per non confondersi con
-- l'altra: due campi omonimi a livelli diversi sono una trappola per chi legge
-- il codice dopo.
--
-- 2000 caratteri contro i 280 dell'evento: qui si scrive una scheda, non un
-- commento al volo. Lo stesso numero è ripetuto in src/lib/server/schemas.ts,
-- così l'utente riceve un 400 leggibile invece di un 500 di Postgres.
--
-- ATTENZIONE alla view: `create or replace view` in Postgres può SOLO
-- aggiungere colonne in coda. Mettere p.notes accanto a p.location, dove
-- starebbe bene, farebbe fallire la migrazione con
-- "cannot change name of view column". Per questo la select di
-- 003_snooze_senza_storico.sql è ripetuta per intero, identica, e p.notes è
-- appeso come ultima colonna dopo next_fertilizing.

alter table plants add column notes text check (length(notes) <= 2000);

create or replace view plant_status as
select
	p.id,
	p.user_token_hash,
	p.name,
	p.emoji,
	p.location,
	p.watering_interval_days,
	p.fertilizing_interval_days,
	p.water_snoozed_until,
	p.fertilize_snoozed_until,
	p.created_at,
	lw.last_watered,
	lf.last_fertilized,
	e.effective_watering_interval,
	e.effective_fertilizing_interval,
	case
		-- Senza storico la scadenza non è calcolabile, ma un rinvio esplicito sì:
		-- è una data che l'utente ha scelto, e va rispettata.
		when lw.last_watered is null then p.water_snoozed_until
		-- greatest() ignora i NULL: senza snooze resta la scadenza calcolata.
		else greatest(lw.last_watered + e.effective_watering_interval, p.water_snoozed_until)
	end as next_watering,
	case
		when p.fertilizing_interval_days is null then null
		when lf.last_fertilized is null then p.fertilize_snoozed_until
		else greatest(lf.last_fertilized + e.effective_fertilizing_interval, p.fertilize_snoozed_until)
	end as next_fertilizing,
	-- Colonna nuova: obbligatoriamente in coda, vedi il commento in testa.
	p.notes
from plants p
join users u on u.token_hash = p.user_token_hash
left join lateral (
	select max(ce.event_date) as last_watered
	from care_events ce
	where ce.plant_id = p.id and ce.type = 'water'
) lw on true
left join lateral (
	select max(ce.event_date) as last_fertilized
	from care_events ce
	where ce.plant_id = p.id and ce.type = 'fertilize'
) lf on true
left join lateral (
	select
		round(p.watering_interval_days * m.mult)::int as effective_watering_interval,
		round(p.fertilizing_interval_days * m.mult)::int as effective_fertilizing_interval
	from (
		select case when u.winter_mode then u.winter_multiplier else 1.0 end as mult
	) m
) e on true;
