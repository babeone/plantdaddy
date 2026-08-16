import { sql } from '$lib/server/db';
import { today } from '$lib/server/date';
import { adminShowUserText } from './config';

/**
 * Query del pannello, TUTTE di sola lettura.
 *
 * Regole rispettate qui dentro, e da rispettare se se ne aggiungono altre:
 *
 * 1. Nessuna scrittura. Non ci sono insert, update o delete: il pannello guarda
 *    e basta. Un errore in una pagina non può rovinare i dati di nessuno.
 *
 * 2. Mai token_hash verso l'esterno. È la chiave che collega utente, piante,
 *    eventi e subscription, ed è trattata come un segreto in tutto il progetto.
 *    Al suo posto viaggia users.admin_ref, che non apre nulla.
 *
 * 3. Mai endpoint, p256dh o auth delle push subscription, in nessuna forma
 *    parziale. endpoint contiene l'identificativo con cui si inviano notifiche a
 *    quel dispositivo: è a tutti gli effetti una credenziale. Del provider si
 *    mostra solo l'host.
 *
 * 4. plants e non plant_status quando bastano i conteggi: la view fa tre
 *    left join lateral per riga, e su una pagina di riepilogo è spreco puro.
 *
 * 5. Il testo scritto dagli utenti (note delle piante e degli eventi) di default
 *    non esce: si conta soltanto. Vedi ADMIN_SHOW_USER_TEXT.
 */

export type Overview = {
	users: number;
	plants: number;
	events: number;
	active_30d: number;
	due_now: number;
	users_with_push: number;
	subscriptions: number;
	plants_with_notes: number;
	newest_user: Date | null;
};

export async function overview(): Promise<Overview> {
	// Una sola andata e ritorno: sono tutti conteggi indipendenti e non c'è
	// motivo di pagare otto round trip verso il database per disegnare una pagina.
	const [row] = await sql<Overview[]>`
		select
			(select count(*)::int from users) as users,
			(select count(*)::int from plants) as plants,
			(select count(*)::int from care_events) as events,
			(select count(distinct p.user_token_hash)::int
				from care_events ce join plants p on p.id = ce.plant_id
				where ce.created_at > now() - interval '30 days') as active_30d,
			(select count(*)::int from plant_status
				where next_watering is null or next_watering <= ${today()}::date) as due_now,
			(select count(distinct user_token_hash)::int from push_subscriptions) as users_with_push,
			(select count(*)::int from push_subscriptions) as subscriptions,
			(select count(*)::int from plants where notes is not null and notes <> '') as plants_with_notes,
			(select max(created_at) from users) as newest_user
	`;
	return row;
}

/** Distribuzione degli orari scelti per il riepilogo: dice quando gira il cron davvero. */
export async function notifyHourHistogram(): Promise<{ hour: number; users: number }[]> {
	return sql<{ hour: number; users: number }[]>`
		select notify_hour as hour, count(*)::int as users
		from users
		group by notify_hour
		order by notify_hour
	`;
}

export type UserRow = {
	admin_ref: string;
	/**
	 * NULL per le sessioni create prima della migrazione 007: non c'era modo di
	 * chiedere il nome a chi era già registrato. Il pannello lo mostra come
	 * "senza nome" invece di inventarne uno.
	 *
	 * Non passa da ADMIN_SHOW_USER_TEXT, come i nomi delle piante: è il campo che
	 * risponde alla domanda per cui l'elenco esiste, e senza di esso restano otto
	 * cifre esadecimali.
	 */
	display_name: string | null;
	created_at: Date;
	plants: number;
	events: number;
	last_event: string | null;
	notify_hour: number;
	winter_mode: boolean;
	push: number;
};

/**
 * Elenco utenti, paginato.
 *
 * La pagina si ritaglia in una CTE PRIMA dei lateral, e non con un LIMIT in
 * fondo. Con il limit finale il piano diventa `Limit -> Sort -> Nested Loop`:
 * il Sort è un nodo bloccante e sta sopra i join, quindi i due lateral vengono
 * eseguiti per OGNI utente del database prima che il limite possa fermare
 * qualcosa. Paginare limita l'output; la CTE limita il LAVORO.
 *
 * Misurato su 5.000 utenti / 15.000 piante / 75.000 eventi, prima pagina da 50:
 * 167 ms e 85.092 buffer con il LIMIT in fondo e senza indice, contro 2,8 ms e
 * 942 buffer con la CTE. L'indice su users.created_at (migrazione 006) da solo
 * risolverebbe altrettanto — i numeri completi stanno nel commento di quella
 * migrazione — ma la CTE non dipende dal fatto che il planner scelga di usarlo,
 * e quel presupposto salta appena si aggiunge un filtro o le statistiche
 * invecchiano.
 */
export async function listUsers(limit: number, offset: number): Promise<UserRow[]> {
	return sql<UserRow[]>`
		with pagina as (
			select token_hash, admin_ref, display_name, created_at, notify_hour, winter_mode
			from users
			order by created_at desc
			limit ${limit} offset ${offset}
		)
		select
			u.admin_ref,
			u.display_name,
			u.created_at,
			u.notify_hour,
			u.winter_mode,
			coalesce(p.n, 0)::int as plants,
			coalesce(p.events, 0)::int as events,
			to_char(p.last_event, 'YYYY-MM-DD') as last_event,
			coalesce(s.n, 0)::int as push
		from pagina u
		left join lateral (
			select
				count(*)::int as n,
				coalesce(sum(ce.n), 0)::int as events,
				max(ce.last_event) as last_event
			from plants pl
			left join lateral (
				select count(*)::int as n, max(event_date) as last_event
				from care_events where plant_id = pl.id
			) ce on true
			where pl.user_token_hash = u.token_hash
		) p on true
		left join lateral (
			select count(*)::int as n from push_subscriptions
			where user_token_hash = u.token_hash
		) s on true
		order by u.created_at desc
	`;
}

export async function countUsers(): Promise<number> {
	const [row] = await sql<{ n: number }[]>`select count(*)::int as n from users`;
	return row.n;
}

export type UserDetail = {
	admin_ref: string;
	display_name: string | null;
	created_at: Date;
	notify_hour: number;
	winter_mode: boolean;
	winter_multiplier: number;
	push: number;
};

/**
 * Dettaglio di un utente, cercato per admin_ref e mai per token_hash.
 * undefined se non esiste: la pagina risponde 404, non 500.
 */
export async function getUser(adminRef: string): Promise<UserDetail | undefined> {
	const [row] = await sql<UserDetail[]>`
		select
			u.admin_ref,
			u.display_name,
			u.created_at,
			u.notify_hour,
			u.winter_mode,
			u.winter_multiplier::float8 as winter_multiplier,
			(select count(*)::int from push_subscriptions where user_token_hash = u.token_hash) as push
		from users u
		where u.admin_ref = ${adminRef}
	`;
	return row;
}

export type AdminPlant = {
	name: string;
	emoji: string | null;
	location: string | null;
	watering_interval_days: number;
	fertilizing_interval_days: number | null;
	last_watered: string | null;
	next_watering: string | null;
	events: number;
	notes: string | null;
	has_notes: boolean;
};

export async function listUserPlants(adminRef: string): Promise<AdminPlant[]> {
	// Il testo della nota entra nella SELECT solo se l'istanza lo consente. Con
	// l'impostazione spenta il contenuto non lascia proprio il database, invece di
	// uscire e poi essere nascosto in pagina.
	const notesColumn = adminShowUserText() ? sql`ps.notes` : sql`null::text as notes`;
	return sql<AdminPlant[]>`
		select
			ps.name,
			ps.emoji,
			ps.location,
			ps.watering_interval_days,
			ps.fertilizing_interval_days,
			to_char(ps.last_watered, 'YYYY-MM-DD') as last_watered,
			to_char(ps.next_watering, 'YYYY-MM-DD') as next_watering,
			(select count(*)::int from care_events where plant_id = ps.id) as events,
			${notesColumn},
			(ps.notes is not null and ps.notes <> '') as has_notes
		from plant_status ps
		join users u on u.token_hash = ps.user_token_hash
		where u.admin_ref = ${adminRef}
		order by ps.name
	`;
}

export type AdminEvent = {
	plant: string;
	type: string;
	event_date: string;
	note: string | null;
	has_note: boolean;
};

export async function listUserEvents(adminRef: string, limit: number): Promise<AdminEvent[]> {
	const noteColumn = adminShowUserText() ? sql`ce.note` : sql`null::text as note`;
	return sql<AdminEvent[]>`
		select
			p.name as plant,
			ce.type,
			to_char(ce.event_date, 'YYYY-MM-DD') as event_date,
			${noteColumn},
			(ce.note is not null and ce.note <> '') as has_note
		from care_events ce
		join plants p on p.id = ce.plant_id
		join users u on u.token_hash = p.user_token_hash
		where u.admin_ref = ${adminRef}
		order by ce.event_date desc, ce.created_at desc
		limit ${limit}
	`;
}

export type SystemInfo = {
	migrations: { version: string; applied_at: Date }[];
	providers: { host: string; n: number }[];
	action_tokens: { active: number; expired: number; used: number };
	postgres: string;
	db_size: string;
	admins: { email: string; totp: boolean; disabled: boolean; last_login_at: Date | null }[];
	audit: { at: Date; email: string | null; action: string; ip: string | null }[];
};

export async function systemInfo(): Promise<SystemInfo> {
	const [migrations, providers, [tokens], [version], admins, audit] = await Promise.all([
		sql<{ version: string; applied_at: Date }[]>`
			select version, applied_at from schema_migrations order by version
		`,
		// split_part(endpoint, '/', 3) prende solo l'host della URL: si vede se le
		// notifiche vanno a Google, Mozilla o Apple, e l'identificativo del
		// dispositivo — che è una credenziale — non esce dal database.
		sql<{ host: string; n: number }[]>`
			select split_part(endpoint, '/', 3) as host, count(*)::int as n
			from push_subscriptions
			group by 1
			order by 2 desc
		`,
		sql<{ active: number; expired: number; used: number }[]>`
			select
				count(*) filter (where used_at is null and expires_at > now())::int as active,
				count(*) filter (where used_at is null and expires_at <= now())::int as expired,
				count(*) filter (where used_at is not null)::int as used
			from action_tokens
		`,
		sql<{ postgres: string; db_size: string }[]>`
			select
				split_part(version(), ' ', 2) as postgres,
				pg_size_pretty(pg_database_size(current_database())) as db_size
		`,
		sql<{ email: string; totp: boolean; disabled: boolean; last_login_at: Date | null }[]>`
			select email, (totp_confirmed_at is not null) as totp, disabled, last_login_at
			from admins order by email
		`,
		sql<{ at: Date; email: string | null; action: string; ip: string | null }[]>`
			select at, email, action, ip from admin_audit order by at desc limit 40
		`
	]);

	return {
		migrations,
		providers,
		action_tokens: tokens,
		postgres: version.postgres,
		db_size: version.db_size,
		admins,
		audit
	};
}
