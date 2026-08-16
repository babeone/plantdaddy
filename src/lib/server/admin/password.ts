import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * promisify sceglie da solo la firma a 3 argomenti, quella senza opzioni: senza
 * questo tipo esplicito maxmem non sarebbe nemmeno accettato dal compilatore.
 */
const scryptAsync = promisify(scrypt) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

/**
 * Hash delle password admin.
 *
 * NON si riusa hashToken() di $lib/server/auth: quello è SHA-256 nudo, ed è la
 * scelta corretta SOLO perché un token di sessione è un UUID v4 con 122 bit di
 * entropia. Una password scelta da una persona non ha niente del genere, e con
 * SHA-256 un dump del database si trasforma in una lista di password in poche
 * ore di GPU.
 *
 * scrypt sta in node:crypto: nessuna dipendenza nuova da mantenere aggiornata,
 * ed è un KDF con costo di memoria, quindi resiste anche all'hardware dedicato.
 */

/**
 * Parametri di costo. N=32768 (2^15), r=8, p=1 sono i valori raccomandati da
 * RFC 7914 per l'uso interattivo: ~67 ms per tentativo su questa macchina, che è
 * impercettibile a un login e proibitivo su un dizionario.
 *
 * maxmem NON è opzionale con questi parametri: scrypt ha bisogno di circa
 * 128 * N * r = 33,5 MB, mentre il default di Node è 32 MB, e senza alzarlo la
 * chiamata fallisce con ERR_CRYPTO_INVALID_SCRYPT_PARAMS. Verificato.
 */
const N = 32768;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const MAXMEM = 64 * 1024 * 1024;

/**
 * Formato memorizzato:  scrypt$N$r$p$sale$hash  (le due parti in base64url).
 * I parametri stanno DENTRO la stringa: alzarli in futuro non invalida gli hash
 * già scritti, perché ogni riga porta con sé quelli con cui è stata generata.
 */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LEN, {
		N,
		r: R,
		p: P,
		maxmem: MAXMEM
	});
	return ['scrypt', N, R, P, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

/**
 * Verifica a tempo costante. Qualunque anomalia (formato illeggibile, parametri
 * non numerici, hash troncato) restituisce false senza lanciare: un errore che
 * risale fino a un 500 direbbe all'attaccante che quell'email esiste.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	try {
		const parts = stored.split('$');
		if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

		const n = Number(parts[1]);
		const r = Number(parts[2]);
		const p = Number(parts[3]);
		if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
		// Tetto di sicurezza: senza questo una riga manomessa nel database (N enorme)
		// bloccherebbe il processo per minuti a ogni tentativo di login.
		if (n > 1 << 20 || r > 32 || p > 16) return false;

		const salt = Buffer.from(parts[4], 'base64url');
		const expected = Buffer.from(parts[5], 'base64url');
		if (salt.length === 0 || expected.length === 0) return false;

		const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
			N: n,
			r,
			p,
			maxmem: MAXMEM
		});

		return timingSafeEqual(derived, expected);
	} catch {
		return false;
	}
}

/**
 * Hash finto su cui spendere lo stesso tempo quando l'email non esiste.
 *
 * Senza questo, un login su un'email inesistente risponderebbe in 1 ms e uno su
 * un'email valida in 70 ms: la differenza è misurabile da fuori e trasforma il
 * pannello in un elenco di indirizzi validi.
 */
const DUMMY_HASH =
	'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function burnTime(password: string): Promise<void> {
	await verifyPassword(password, DUMMY_HASH);
}

/**
 * Requisiti minimi. Non si impongono simboli o maiuscole: la ricerca dice che
 * spingono verso "Password1!" e basta. La lunghezza è quello che conta.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblem(password: string): string | null {
	if (password.length < MIN_PASSWORD_LENGTH) {
		return `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`;
	}
	if (password.length > 200) return 'La password non può superare i 200 caratteri.';
	return null;
}
