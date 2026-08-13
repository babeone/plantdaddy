-- 002_action_tokens — credenziali monouso per le azioni rapide della notifica
--
-- Il service worker non ha accesso a localStorage, quindi non conosce il token
-- di sessione, e il payload della push NON deve contenerlo: è cifrato in
-- transito (aes128gcm) ma resta memorizzato nell'oggetto notifica sul
-- dispositivo, e lì una credenziale permanente sarebbe un regalo a chiunque
-- metta le mani sul telefono.
--
-- Al suo posto ogni notifica porta un token monouso valido SOLO per quella
-- azione su quella pianta e per 24 ore. Come per le sessioni, nel database
-- finisce solo lo SHA-256 esadecimale.

create table action_tokens (
	token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
	plant_id   uuid not null references plants (id) on delete cascade,
	action     text not null check (action in ('water', 'snooze')),
	expires_at timestamptz not null,
	used_at    timestamptz,
	created_at timestamptz not null default now()
);

-- Per la cancellazione degli scaduti, fatta dal job del cron a ogni giro.
create index action_tokens_expires_idx on action_tokens (expires_at);
-- Per invalidare i token di una pianta quando serve.
create index action_tokens_plant_idx on action_tokens (plant_id);
