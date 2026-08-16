-- 003_snooze_senza_storico — lo snooze vale anche senza eventi di cura
--
-- Difetto corretto: nella versione precedente della view, next_watering era
--
--     case when lw.last_watered is null then null else greatest(...) end
--
-- quindi su una pianta senza storico il ramo NULL corto-circuitava e
-- water_snoozed_until non veniva mai letto. Conseguenza pratica: "Rimanda"
-- scriveva la colonna, rispondeva 200, e non cambiava assolutamente nulla —
-- proprio sulle piante appena aggiunte, che sono quelle su cui si prova.
-- Lo stesso difetto faceva arrivare la notifica giornaliera anche per una
-- pianta rimandata, perché il cron legge da questa view.
--
-- Semantica dopo la correzione:
--   mai curata e non rimandata  -> NULL   (da fare adesso, come prima)
--   mai curata ma rimandata     -> la data del rinvio
--   con storico                 -> greatest(ultima + intervallo, rinvio)
--
-- create or replace: la view cambia definizione senza toccare i dati, e senza
-- doverla droppare (cosa che fallirebbe se qualcosa vi dipendesse).

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
	end as next_fertilizing
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
