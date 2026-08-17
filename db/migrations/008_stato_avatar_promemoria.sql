-- 008_stato_avatar_promemoria — stato della pianta, tipo di avatar, preferenze
--
-- Tre aggiunte che servono alle foto ma che sono tutte colonne di plants/users,
-- quindi la view plant_status si ricostruisce UNA volta sola qui in fondo.
--
-- 1. plants.state — oggi una pianta esiste o è cancellata, non c'è nient'altro.
--    Serve perché una pianta morta si può solo eliminare, e l'eliminazione porta
--    via anche tutto lo storico delle cure: esattamente la cosa che un diario di
--    crescita dovrebbe conservare. Serve anche ai promemoria trimestrali, che non
--    devono arrivare per piante archiviate o morte.
--
-- 2. plants.avatar_type — l'immagine identificativa della pianta è un'emoji
--    oppure una foto. La colonna emoji esisteva già e non viene toccata: le righe
--    esistenti diventano 'emoji', che è esattamente quello che sono adesso.
--
-- 3. Le preferenze sui promemoria foto, a due livelli: users.photo_reminders
--    spegne tutto, plants.photo_reminders spegne una singola pianta.
--    users.last_photo_reminder_on è il tetto di UNA notifica foto al giorno per
--    utente: una data sola, invece di contare righe in una tabella di log.
--
-- Tutte con default, quindi nessuna riga esistente va toccata a mano e la
-- migrazione non riscrive dati degli utenti.

alter table plants
	add column state text not null default 'active'
		check (state in ('active', 'archived', 'dead')),
	add column avatar_type text not null default 'emoji'
		check (avatar_type in ('emoji', 'photo')),
	add column photo_reminders boolean not null default true;

alter table users
	add column photo_reminders boolean not null default true,
	add column last_photo_reminder_on date;

-- Per la query del job dei promemoria: restringe alle sole piante candidate senza
-- leggere tutta la tabella. `state` sta nel predicato parziale e non fra le
-- colonne chiave, dove sarebbe ridondante: nell'indice ci finiscono solo righe che
-- hanno già state = 'active'. La chiave è created_at perché il job filtra per età
-- (una pianta più giovane di tre mesi non può maturare nulla).
create index plants_promemoria_idx on plants (created_at)
	where state = 'active' and photo_reminders;

-- ---------------------------------------------------------------------------
-- plant_status: si ricostruisce per esporre le tre colonne nuove.
--
-- STESSA TRAPPOLA della 004: `create or replace view` in Postgres può SOLO
-- aggiungere colonne in coda. Mettere p.state accanto a p.name, dove starebbe
-- bene, fa fallire la migrazione con "cannot change name of view column". Quindi
-- la select della 004 è ripetuta identica e le tre colonne nuove sono appese
-- dopo p.notes, alle posizioni 18, 19 e 20.
--
-- La view NON filtra per state: l'app deve continuare a mostrare le piante
-- archiviate e morte, con un contrassegno. Il filtro sta nei job, che sono i soli
-- posti dove una pianta morta non deve comparire.
-- ---------------------------------------------------------------------------
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
		when lw.last_watered is null then p.water_snoozed_until
		else greatest(lw.last_watered + e.effective_watering_interval, p.water_snoozed_until)
	end as next_watering,
	case
		when p.fertilizing_interval_days is null then null
		when lf.last_fertilized is null then p.fertilize_snoozed_until
		else greatest(lf.last_fertilized + e.effective_fertilizing_interval, p.fertilize_snoozed_until)
	end as next_fertilizing,
	p.notes,
	-- Colonne nuove: obbligatoriamente in coda, vedi il commento qui sopra.
	p.state,
	p.avatar_type,
	p.photo_reminders
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
