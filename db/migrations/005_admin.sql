-- 005_admin — pannello di controllo di sola lettura per chi ospita l'istanza
--
-- Queste tabelle sono INERTI finché ADMIN_ENABLED non vale 'true': senza quella
-- variabile ogni rotta del pannello risponde 404 e nulla qui viene letto. Chi
-- clona il repository si porta dietro lo schema ma non un'area esposta.
--
-- Differenza importante rispetto agli utenti: un admin ha email e PASSWORD,
-- quindi l'hash veloce e non salato usato per i token di sessione (SHA-256, vedi
-- 001_init) non basta. Le password stanno in password_hash con scrypt e sale,
-- nel formato  scrypt$N$r$p$sale$hash  — i parametri viaggiano dentro la stringa
-- così si possono alzare in futuro senza invalidare gli hash già scritti.
--
-- Le SESSIONI admin invece seguono la stessa regola dei token utente: nel
-- database finisce solo lo SHA-256 esadecimale, mai il valore in chiaro.

create table admins (
	id                uuid primary key default gen_random_uuid(),
	email             text not null check (length(email) between 3 and 254),
	password_hash     text not null,
	-- Segreto TOTP in Base32. NULL finché l'admin non completa l'arruolamento al
	-- primo accesso: è così che "prima volta" viene riconosciuto, senza flag extra.
	totp_secret       text,
	totp_confirmed_at timestamptz,
	-- Ultimo passo temporale accettato: un codice già usato non vale più, neanche
	-- entro i suoi 30 secondi di validità.
	last_totp_step    bigint,
	-- Blocco per ACCOUNT, non solo per IP: il rate limit in memoria si azzera a
	-- ogni deploy, questo no.
	failed_attempts   int not null default 0,
	locked_until      timestamptz,
	disabled          boolean not null default false,
	created_at        timestamptz not null default now(),
	last_login_at     timestamptz
);

-- lower(): le email non sono sensibili al maiuscolo, e senza questo indice
-- 'Mario@x.it' e 'mario@x.it' sarebbero due account distinti.
create unique index admins_email_key on admins (lower(email));

create table admin_sessions (
	token_hash   text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
	admin_id     uuid not null references admins (id) on delete cascade,
	-- Sessione PARZIALE: nasce con false dopo la password e diventa true solo
	-- dopo il TOTP. Nessuna pagina con dati è raggiungibile finché è false, e
	-- il token viene rigenerato al passaggio (difesa da session fixation).
	mfa_done     boolean not null default false,
	created_at   timestamptz not null default now(),
	last_seen_at timestamptz not null default now(),
	expires_at   timestamptz not null,
	ip           text,
	user_agent   text
);

create index admin_sessions_admin_idx on admin_sessions (admin_id);
create index admin_sessions_expires_idx on admin_sessions (expires_at);

create table admin_audit (
	id       bigserial primary key,
	at       timestamptz not null default now(),
	admin_id uuid references admins (id) on delete set null,
	-- Ripetuta qui apposta: se l'admin viene cancellato admin_id diventa NULL,
	-- ma la traccia di chi aveva fatto cosa deve restare leggibile.
	email    text,
	action   text not null,
	ip       text,
	detail   jsonb
);

create index admin_audit_at_idx on admin_audit (at desc);

-- Riferimento non sensibile per le URL del pannello.
--
-- token_hash è la chiave che correla utente, piante, eventi e subscription, ed è
-- già trattato come un segreto (hooks.server.ts lo rimuove dai log). Non deve
-- comparire in una URL, dove finirebbe nella cronologia del browser, nei log del
-- reverse proxy e nell'header Referer. admin_ref è un identificatore separato,
-- che serve solo al pannello e non apre nulla.
alter table users add column admin_ref uuid not null default gen_random_uuid();
create unique index users_admin_ref_key on users (admin_ref);
