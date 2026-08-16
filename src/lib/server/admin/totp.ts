import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ADMIN_TOTP_ISSUER } from './config';

/**
 * TOTP secondo RFC 6238 (HOTP di RFC 4226 con contatore derivato dal tempo).
 *
 * Scritto a mano con node:crypto invece di aggiungere otplib o speakeasy: sono
 * quaranta righe, e una dipendenza in più è una superficie in più da aggiornare
 * proprio nel punto che protegge l'accesso al pannello.
 *
 * Parametri: SHA-1, 6 cifre, passo da 30 secondi. Sono i valori che Google
 * Authenticator, Aegis, 1Password e gli altri assumono per default quando non
 * sono scritti nell'URI otpauth. Cambiarli qui significa che metà delle app non
 * funzionerebbe più.
 *
 * Verificato sul vettore di prova ufficiale della RFC 6238 (segreto ASCII
 * "12345678901234567890", T = 59 secondi, atteso 94287082).
 */

const DIGITS = 6;
const STEP_SECONDS = 30;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Segreto da 20 byte (160 bit), la dimensione del blocco di HMAC-SHA1. */
export function generateSecret(): string {
	return base32Encode(randomBytes(20));
}

function base32Encode(buffer: Buffer): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of buffer) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += B32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += B32[(value << (5 - bits)) & 31];
	// Niente padding '=': gli authenticator lo accettano ma diversi lo rifiutano
	// quando è incollato a mano, e senza è più corto da digitare.
	return out;
}

function base32Decode(secret: string): Buffer {
	const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
	let bits = 0;
	let value = 0;
	const bytes: number[] = [];
	for (const char of clean) {
		const index = B32.indexOf(char);
		if (index === -1) continue;
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return Buffer.from(bytes);
}

/** Passo temporale corrente: è anche il valore da confrontare per l'anti-replay. */
export function currentStep(atMs = Date.now()): number {
	return Math.floor(atMs / 1000 / STEP_SECONDS);
}

function codeForStep(secret: string, step: number): string {
	// Contatore su 8 byte big-endian. BigInt64 e non due Number: oltre il 2038 la
	// metà alta smetterebbe di essere zero, e con i Number si perderebbe.
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(step));

	const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();

	// Troncamento dinamico (RFC 4226 §5.3): i 4 bit bassi dell'ultimo byte dicono
	// da dove leggere le 4 cifre significative.
	const offset = digest[digest.length - 1] & 0x0f;
	const binary =
		((digest[offset] & 0x7f) << 24) |
		((digest[offset + 1] & 0xff) << 16) |
		((digest[offset + 2] & 0xff) << 8) |
		(digest[offset + 3] & 0xff);

	return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Verifica con finestra ±1 passo (±30 secondi), per tollerare l'orologio del
 * telefono leggermente fuori sincrono e il tempo di digitazione.
 *
 * Restituisce il passo effettivamente usato, non true/false: il chiamante deve
 * scriverlo su admins.last_totp_step e rifiutare i codici di un passo già visto,
 * altrimenti chi legge il codice da sopra la spalla ha 30 secondi per riusarlo.
 */
export function verifyTotp(
	secret: string,
	code: string,
	options: { lastStep?: number | null; atMs?: number } = {}
): { ok: boolean; step?: number; reason?: 'formato' | 'riuso' | 'errato' } {
	const clean = code.replace(/\D/g, '');
	if (clean.length !== DIGITS) return { ok: false, reason: 'formato' };

	const now = currentStep(options.atMs);
	for (const step of [now, now - 1, now + 1]) {
		const expected = codeForStep(secret, step);
		// Stessa lunghezza garantita da entrambe le parti: timingSafeEqual non lancia.
		if (!timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) continue;
		if (options.lastStep != null && step <= options.lastStep) {
			return { ok: false, reason: 'riuso' };
		}
		return { ok: true, step };
	}
	return { ok: false, reason: 'errato' };
}

/**
 * URI otpauth:// da mettere nel QR. L'etichetta porta l'issuer anche come
 * prefisso perché le app più vecchie leggono solo quello e ignorano il parametro.
 */
export function otpauthUri(email: string, secret: string): string {
	const label = encodeURIComponent(`${ADMIN_TOTP_ISSUER}:${email}`);
	const params = new URLSearchParams({
		secret,
		issuer: ADMIN_TOTP_ISSUER,
		algorithm: 'SHA1',
		digits: String(DIGITS),
		period: String(STEP_SECONDS)
	});
	return `otpauth://totp/${label}?${params}`;
}

/** Segreto spezzato in gruppi di 4, per chi lo digita a mano invece del QR. */
export function formatSecret(secret: string): string {
	return secret.replace(/(.{4})/g, '$1 ').trim();
}
