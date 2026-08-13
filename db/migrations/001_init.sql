-- 001_init — schema iniziale PlantDaddy
--
-- Sessione senza account: nel database non finisce MAI il token in chiaro,
-- solo il suo SHA-256 in esadecimale. Il client conserva l'UUID v4, il server
-- lo hasha a ogni richiesta e confronta. Un dump del DB non espone sessioni.
-- Hash veloce e non salato di proposito: un UUID v4 ha 122 bit di entropia,
-- non è forzabile, e bcrypt/argon2 servirebbero solo contro password deboli.
--
-- Richiede PostgreSQL >= 13 per gen_random_uuid() senza pgcrypto.

create table users (
	token_hash        text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
	created_at        timestamptz not null default now(),
	notify_hour       smallint not null default 8 check (notify_hour between 0 and 23),
	winter_mode       boolean not null default false,
	winter_multiplier numeric(3, 2) not null default 1.5
		check (winter_multiplier between 1.0 and 3.0)
);

create table plants (
	id                        uuid primary key default gen_random_uuid(),
	user_token_hash           text not null references users (token_hash) on delete cascade,
	name                      text not null check (length(name) between 1 and 60),
	emoji                     text check (length(emoji) <= 8),
	location                  text check (length(location) <= 60),
	watering_interval_days    int not null check (watering_interval_days between 1 and 365),
	fertilizing_interval_days int check (fertilizing_interval_days between 1 and 365),
	water_snoozed_until       date,
	fertilize_snoozed_until   date,
	created_at                timestamptz not null default now()
);

-- Nessuna colonna last_watered / last_fertilized: le ultime date sono SEMPRE
-- derivate da care_events (vedi la view plant_status). Così eliminare un evento
-- riporta la scadenza all'evento precedente senza logica di rollback.
create table care_events (
	id         uuid primary key default gen_random_uuid(),
	plant_id   uuid not null references plants (id) on delete cascade,
	type       text not null check (type in ('water', 'fertilize')),
	event_date date not null,
	note       text check (length(note) <= 280),
	created_at timestamptz not null default now(),
	-- Rende il doppio tap idempotente nel database, non solo nell'applicazione.
	unique (plant_id, type, event_date)
);

create table push_subscriptions (
	id              uuid primary key default gen_random_uuid(),
	user_token_hash text not null references users (token_hash) on delete cascade,
	endpoint        text not null unique check (length(endpoint) <= 1000),
	p256dh          text not null,
	auth            text not null,
	created_at      timestamptz not null default now()
);

create index plants_user_idx on plants (user_token_hash);
create index care_events_plant_type_date_idx on care_events (plant_id, type, event_date desc);
create index push_subscriptions_user_idx on push_subscriptions (user_token_hash);

-- ---------------------------------------------------------------------------
-- QUOTA: massimo 300 eventi per pianta, rotazione FIFO.
-- Si cancellano i più VECCHI, non il più recente: cancellare l'ultimo
-- perderebbe l'annaffiatura appena registrata e "ultima annaffiatura"
-- resterebbe indietro per sempre. A 300 eventi con cadenza settimanale
-- sono circa 5 anni di storico per pianta.
-- ---------------------------------------------------------------------------
create or replace function care_events_rotate() returns trigger
language plpgsql as $$
begin
	delete from care_events
	where id in (
		select id
		from care_events
		where plant_id = new.plant_id
		order by event_date desc, created_at desc, id desc
		offset 300
	);
	return null;
end;
$$;

create trigger care_events_rotate_after_insert
after insert on care_events
for each row execute function care_events_rotate();

-- ---------------------------------------------------------------------------
-- VIEW plant_status — quello che legge il frontend quasi sempre.
-- Deriva le ultime date dagli eventi e applica la modalità inverno letta
-- da users. Lo snooze non è un evento di cura: sposta solo la scadenza.
-- ---------------------------------------------------------------------------
create view plant_status as
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
		when lw.last_watered is null then null
		-- greatest() ignora i NULL: senza snooze resta la scadenza calcolata.
		else greatest(lw.last_watered + e.effective_watering_interval, p.water_snoozed_until)
	end as next_watering,
	case
		when lf.last_fertilized is null or p.fertilizing_interval_days is null then null
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
