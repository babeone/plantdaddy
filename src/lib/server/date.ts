import { env } from '$env/dynamic/private';

/**
 * "Oggi" è quello dell'utente, non quello del container.
 * Il server gira in UTC: un'annaffiatura registrata alle 00:30 di Roma
 * verrebbe salvata col giorno precedente, e la scadenza risulterebbe sbagliata
 * di un giorno per tutta la vita di quell'evento.
 */
const TIMEZONE = env.APP_TIMEZONE || 'Europe/Rome';

// en-CA formatta come YYYY-MM-DD, che è anche il formato che vuole Postgres.
const formatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIMEZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

export function today(): string {
	return formatter.format(new Date());
}

export function addDays(isoDate: string, days: number): string {
	const [year, month, day] = isoDate.split('-').map(Number);
	// UTC per non incappare nei cambi di ora legale sommando giorni.
	const date = new Date(Date.UTC(year, month - 1, day));
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Scarta anche le date sintatticamente valide ma inesistenti, tipo 2026-02-30. */
export function isRealDate(isoDate: string): boolean {
	if (!ISO_DATE_RE.test(isoDate)) return false;
	const [year, month, day] = isoDate.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}
