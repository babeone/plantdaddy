/** Utilità sulle date 'YYYY-MM-DD', lato client. Nessuna dipendenza. */

const pad = (n: number) => String(n).padStart(2, '0');

export function toIso(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today(): string {
	return toIso(new Date());
}

export function parseIso(iso: string): Date {
	const [year, month, day] = iso.split('-').map(Number);
	return new Date(year, month - 1, day);
}

/** Giorni da oggi: negativo = passato. */
export function daysFromToday(iso: string): number {
	const ms = parseIso(iso).getTime() - parseIso(today()).getTime();
	return Math.round(ms / 86_400_000);
}

export function formatShort(iso: string): string {
	return parseIso(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

export function formatRelative(iso: string): string {
	const days = daysFromToday(iso);
	if (days === 0) return 'oggi';
	if (days === -1) return 'ieri';
	if (days === 1) return 'domani';
	if (days < 0) return `${Math.abs(days)} giorni fa`;
	return `tra ${days} giorni`;
}
