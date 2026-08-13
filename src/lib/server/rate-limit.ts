import type { RequestEvent } from '@sveltejs/kit';

/**
 * Rate limit in memoria.
 *
 * LIMITE NOTO E ACCETTATO: la mappa vive nel processo, quindi si azzera a ogni
 * deploy e non è condivisa tra repliche. Per un'app personale a singola istanza
 * va bene; se un giorno gira con più repliche o dietro autoscaling va sostituita
 * con Redis o con una tabella Postgres, altrimenti il limite reale diventa
 * "5 per replica" e basta riavviare per ripartire da zero.
 */
const hits = new Map<string, number[]>();

/**
 * L'IP del client, letto in modo NON aggirabile.
 *
 * x-forwarded-for è un header che il client può inviare a piacere. Traefik non
 * lo sostituisce: APPENDE il vero IP in coda alla catena. Quindi il valore
 * attendibile è quello PIÙ A DESTRA, e prendere il primo (`split(',')[0]`)
 * significa fidarsi di un valore scelto dall'attaccante, che cambiandolo a ogni
 * richiesta aggira qualunque limite.
 *
 * Alternativa equivalente: configurare adapter-node con ADDRESS_HEADER=x-forwarded-for
 * e XFF_DEPTH pari al numero di proxy davanti all'app, e usare getClientAddress().
 */
export function clientIp(event: RequestEvent): string {
	const forwarded = event.request.headers.get('x-forwarded-for');
	if (forwarded) {
		const chain = forwarded
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean);
		const rightmost = chain.at(-1);
		if (rightmost) return rightmost;
	}
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}

/**
 * Restituisce true se la richiesta è dentro il limite, false se va respinta.
 * Finestra scorrevole: tiene solo i timestamp ancora dentro la finestra.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();
	const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);

	if (recent.length >= limit) {
		hits.set(key, recent);
		return false;
	}

	recent.push(now);
	hits.set(key, recent);

	// Pulizia opportunistica: senza questa la mappa cresce con ogni IP visto.
	if (hits.size > 5000) {
		for (const [otherKey, times] of hits) {
			if (times.every((time) => now - time >= windowMs)) hits.delete(otherKey);
		}
	}

	return true;
}
