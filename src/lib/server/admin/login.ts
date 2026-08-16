import { sql } from '$lib/server/db';
import { burnTime, verifyPassword } from './password';

/**
 * Verifica delle credenziali, con blocco per account.
 *
 * Perché il blocco sta sul database e non nella mappa di rate-limit.ts: quella
 * vive nel processo e si azzera a ogni deploy, quindi come unica difesa
 * significherebbe che basta aspettare un aggiornamento per ripartire da zero.
 * I due limiti si sommano: rate-limit.ts frena l'IP, questo frena l'account.
 */

/** Tentativi consentiti prima del blocco. */
const MAX_ATTEMPTS = 5;

/**
 * Attesa dopo il blocco, crescente: 1, 2, 4, 8… minuti fino a un tetto di un'ora.
 * Cresce abbastanza da rendere inutile un dizionario, non tanto da chiudere
 * fuori l'unico amministratore per sempre.
 */
function lockMinutes(failedAttempts: number): number {
	const over = Math.max(0, failedAttempts - MAX_ATTEMPTS);
	return Math.min(60, 2 ** over);
}

type AdminRow = {
	id: string;
	email: string;
	password_hash: string;
	locked_until: Date | null;
	failed_attempts: number;
};

export type LoginResult =
	{ ok: true; adminId: string; email: string } | { ok: false; locked: boolean };

/**
 * MESSAGGIO UNICO per ogni fallimento (lo compone il chiamante): email
 * inesistente, password sbagliata e account disabilitato devono essere
 * indistinguibili, altrimenti il pannello diventa un modo per scoprire quali
 * indirizzi sono registrati.
 *
 * Anche i TEMPI devono esserlo: quando l'email non esiste si spende comunque il
 * costo di uno scrypt su un hash finto, altrimenti la differenza fra 1 ms e
 * 70 ms racconterebbe la stessa cosa.
 */
export async function attemptLogin(email: string, password: string): Promise<LoginResult> {
	const [admin] = await sql<AdminRow[]>`
		select id, email, password_hash, locked_until, failed_attempts
		from admins
		where lower(email) = lower(${email}) and disabled = false
	`;

	if (!admin) {
		await burnTime(password);
		return { ok: false, locked: false };
	}

	if (admin.locked_until && admin.locked_until > new Date()) {
		// Anche da bloccati si spende il tempo: senza, una risposta immediata
		// direbbe "questo account esiste ed è sotto attacco".
		await burnTime(password);
		return { ok: false, locked: true };
	}

	if (!(await verifyPassword(password, admin.password_hash))) {
		const attempts = admin.failed_attempts + 1;
		await sql`
			update admins set
				failed_attempts = ${attempts},
				locked_until = case
					when ${attempts} >= ${MAX_ATTEMPTS}
					then now() + make_interval(mins => ${lockMinutes(attempts)})
					else locked_until
				end
			where id = ${admin.id}
		`;
		return { ok: false, locked: attempts >= MAX_ATTEMPTS };
	}

	// Login riuscito: il contatore riparte, altrimenti quattro errori distribuiti
	// in un anno basterebbero a far scattare il blocco al quinto.
	await sql`
		update admins set failed_attempts = 0, locked_until = null, last_login_at = now()
		where id = ${admin.id}
	`;
	return { ok: true, adminId: admin.id, email: admin.email };
}

/** Arruolamento del secondo fattore: scrive il segreto solo se non ce n'è già uno. */
export async function saveTotpSecret(adminId: string, secret: string): Promise<void> {
	await sql`
		update admins set totp_secret = ${secret}
		where id = ${adminId} and totp_secret is null
	`;
}

/**
 * Conferma del secondo fattore e anti-replay.
 *
 * last_totp_step viene alzato a ogni verifica riuscita e la condizione è nella
 * WHERE: se due richieste con lo stesso codice arrivano insieme, la seconda
 * aggiorna zero righe e viene respinta dal chiamante. Il controllo in JavaScript
 * da solo lascerebbe aperta proprio quella finestra.
 */
export async function commitTotpStep(adminId: string, step: number): Promise<boolean> {
	const rows = await sql`
		update admins set
			last_totp_step = ${step},
			totp_confirmed_at = coalesce(totp_confirmed_at, now())
		where id = ${adminId} and (last_totp_step is null or last_totp_step < ${step})
		returning id
	`;
	return rows.length > 0;
}
