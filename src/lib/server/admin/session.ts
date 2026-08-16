import { randomUUID } from 'node:crypto';
import { dev } from '$app/environment';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { hashToken } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { clientIp } from '$lib/server/rate-limit';
import { adminPublicBase, adminSessionHours } from './config';

/**
 * Sessioni del pannello admin.
 *
 * QUI IL COOKIE AUTENTICA — ed è l'unico posto dell'applicazione dove succede.
 * Va letto insieme al commento in testa a src/hooks.server.ts, che vieta di
 * autenticare col cookie `pd_token`: quella regola riguarda le API utente, dove
 * il cookie è solo una copia di riserva del token e accettarlo aprirebbe ogni
 * endpoint a CSRF.
 *
 * Il pannello è l'opposto per costruzione:
 *   - nome diverso (pd_admin) e Path limitato al percorso admin, quindi il
 *     browser non lo allega MAI alle chiamate /api/* dell'utente;
 *   - HttpOnly, quindi invisibile al JavaScript;
 *   - SameSite=Strict, quindi non parte da un link su un altro sito;
 *   - le poche POST usano le form action di SvelteKit, che verificano l'Origin.
 *
 * Come per i token utente, nel database finisce solo lo SHA-256 esadecimale.
 */

const COOKIE = 'pd_admin';

/** Inattività: una sessione dimenticata aperta si chiude da sola. */
const IDLE_MINUTES = 30;

export type AdminSession = {
	admin_id: string;
	email: string;
	mfa_done: boolean;
	totp_secret: string | null;
	last_totp_step: string | null;
};

function cookieOptions(maxAge: number) {
	return {
		path: adminPublicBase(),
		httpOnly: true,
		sameSite: 'strict' as const,
		// In sviluppo il server è in chiaro su localhost: con Secure il cookie non
		// verrebbe mai memorizzato e il login sembrerebbe rotto.
		secure: !dev,
		maxAge
	};
}

/**
 * Crea la sessione e restituisce il token in chiaro (che finisce solo nel
 * cookie). `mfaDone` è false subito dopo la password: la sessione esiste ma non
 * apre nulla finché il TOTP non passa.
 */
export async function createAdminSession(
	event: RequestEvent,
	adminId: string,
	mfaDone: boolean
): Promise<void> {
	const token = randomUUID();
	const hours = adminSessionHours();

	await sql`
		insert into admin_sessions (token_hash, admin_id, mfa_done, expires_at, ip, user_agent)
		values (
			${hashToken(token)},
			${adminId},
			${mfaDone},
			now() + make_interval(hours => ${hours}),
			${clientIp(event)},
			${event.request.headers.get('user-agent')?.slice(0, 400) ?? null}
		)
	`;

	event.cookies.set(COOKIE, token, cookieOptions(hours * 3600));
}

/**
 * Promozione dopo il secondo fattore, con ROTAZIONE del token.
 *
 * La riga vecchia viene cancellata e ne nasce una nuova con un token diverso.
 * Senza questo, chi fosse riuscito a far usare alla vittima un token noto prima
 * del login (session fixation) si ritroverebbe in mano una sessione promossa a
 * pieni poteri.
 */
export async function promoteAdminSession(event: RequestEvent, adminId: string): Promise<void> {
	await destroyAdminSession(event);
	await createAdminSession(event, adminId, true);
}

/**
 * Legge la sessione dal cookie. Restituisce null se manca, è scaduta, è rimasta
 * ferma troppo a lungo o l'admin nel frattempo è stato disabilitato.
 *
 * Il controllo di scadenza è nella WHERE e non in JavaScript: una riga scaduta
 * non viene proprio restituita, quindi non c'è modo di dimenticarsi di guardarla.
 */
export async function readAdminSession(cookies: Cookies): Promise<AdminSession | null> {
	const token = cookies.get(COOKIE);
	if (!token) return null;

	const [row] = await sql<AdminSession[]>`
		select
			s.admin_id,
			a.email,
			s.mfa_done,
			a.totp_secret,
			a.last_totp_step::text as last_totp_step
		from admin_sessions s
		join admins a on a.id = s.admin_id
		where s.token_hash = ${hashToken(token)}
			and s.expires_at > now()
			and s.last_seen_at > now() - make_interval(mins => ${IDLE_MINUTES})
			and a.disabled = false
	`;
	if (!row) return null;

	await sql`
		update admin_sessions set last_seen_at = now() where token_hash = ${hashToken(token)}
	`;
	return row;
}

/** Logout, e pulizia della riga: la sessione non deve restare revocabile solo lato client. */
export async function destroyAdminSession(event: RequestEvent): Promise<void> {
	const token = event.cookies.get(COOKIE);
	if (token) {
		await sql`delete from admin_sessions where token_hash = ${hashToken(token)}`;
	}
	event.cookies.delete(COOKIE, { path: adminPublicBase() });
}

/** Scadute e inattive: girano via a ogni login riuscito, senza bisogno di un cron. */
export async function purgeExpiredAdminSessions(): Promise<void> {
	await sql`
		delete from admin_sessions
		where expires_at < now() or last_seen_at < now() - make_interval(mins => ${IDLE_MINUTES})
	`;
}

/**
 * Traccia in admin_audit. L'email è ripetuta sulla riga apposta: se l'admin
 * viene cancellato, admin_id diventa NULL ma resta scritto chi aveva fatto cosa.
 */
export async function audit(
	event: RequestEvent,
	action: string,
	who: { adminId?: string | null; email?: string | null },
	// Solo valori semplici: `detail` finisce in una colonna jsonb, e accettare
	// `unknown` significherebbe poterci infilare per sbaglio un oggetto con
	// dentro una credenziale.
	detail?: Record<string, string | number | boolean | null | undefined>
): Promise<void> {
	await sql`
		insert into admin_audit (admin_id, email, action, ip, detail)
		values (
			${who.adminId ?? null},
			${who.email ?? null},
			${action},
			${clientIp(event)},
			${detail ? sql.json(detail) : null}
		)
	`;
}
