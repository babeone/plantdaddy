import { env } from '$env/dynamic/private';

/**
 * Configurazione della raccolta metriche.
 *
 * Ogni parametro da variabile d'ambiente con un default sensato, letto a ogni
 * richiesta da $env/dynamic/private: si cambia in Dokploy e basta riavviare il
 * container, senza ricompilare.
 *
 * Il default di METRICS_ENABLED è ACCESO. È una scelta: le metriche non
 * contengono dati personali (vedi migrazione 011) e senza di loro la dashboard
 * non ha niente da mostrare al primo avvio. Chi clona il repo e non le vuole
 * mette METRICS_ENABLED=false e l'overhead torna a zero.
 */

function numero(valore: string | undefined, predefinito: number, min: number, max: number): number {
	const parsed = Number(valore ?? predefinito);
	if (!Number.isFinite(parsed)) return predefinito;
	return Math.min(max, Math.max(min, parsed));
}

/** Interruttore generale. A false il primo `if` dell'hook esce: overhead zero. */
export function metricsEnabled(): boolean {
	return env.METRICS_ENABLED !== 'false';
}

/**
 * Frazione di richieste registrate, 0–1. Default 1.0: a 10.000 richieste al
 * giorno non c'è motivo di campionare, e i numeri restano esatti.
 */
export function sampleRate(): number {
	return numero(env.METRICS_SAMPLE_RATE, 1, 0, 1);
}

/**
 * Soglia oltre la quale una richiesta viene registrata SEMPRE, qualunque sia il
 * sample rate. Insieme ai 5xx sono gli unici dati per cui la dashboard esiste:
 * campionare proprio quelli significherebbe perdere l'evento raro che si sta
 * cercando.
 */
export function alwaysAboveMs(): number {
	return numero(env.METRICS_ALWAYS_ABOVE_MS, 1000, 1, 600_000);
}

/**
 * Tetto FISSO del buffer in memoria. Al raggiungimento si fa un flush immediato
 * e, se non è possibile, si scartano i record più vecchi: mai un array che cresce.
 * 500 record sono ~125 KB, contro un tetto dichiarato di 10 MB.
 */
export function bufferMax(): number {
	return numero(env.METRICS_BUFFER_MAX, 500, 50, 5000);
}

/** Intervallo del flush periodico. Il buffer si svuota al primo dei due eventi. */
export function flushMs(): number {
	return numero(env.METRICS_FLUSH_MS, 10_000, 1000, 300_000);
}

/** Retention dei dati grezzi, in giorni. Oltre restano solo gli aggregati. */
export function rawDays(): number {
	return numero(env.METRICS_RAW_DAYS, 7, 1, 90);
}

export function hourlyDays(): number {
	return numero(env.METRICS_HOURLY_DAYS, 90, 7, 730);
}

export function dailyDays(): number {
	return numero(env.METRICS_DAILY_DAYS, 365, 30, 3650);
}

/**
 * Tetto di sicurezza sulle righe grezze, indipendente dalla retention temporale.
 * Serve al caso che la retention non copre: un picco di traffico che riempie il
 * disco prima che i sette giorni siano passati.
 */
export function maxRawRows(): number {
	return numero(env.METRICS_MAX_RAW_ROWS, 2_000_000, 10_000, 100_000_000);
}

/**
 * Rotte escluse dalla raccolta.
 *
 * `/api/health` perché è interrogato dall'HEALTHCHECK ogni 30 secondi e
 * riempirebbe la tabella di rumore. Le rotte `/admin/*` perché la dashboard
 * metriche si auto-alimenterebbe: guardarla genererebbe le righe che si stanno
 * guardando. Le rotte `/api/cron/*` perché sono chiamate una volta all'ora da un
 * job e la loro durata la registra già job_runs, con più dettaglio.
 */
const ESCLUSI = ['/api/health', '/admin', '/api/cron'];

export function routeEsclusa(routeId: string | null): boolean {
	// routeId null significa che SvelteKit non ha trovato una rotta: è un 404 su un
	// indirizzo inesistente, tipicamente uno scanner. Non interessa.
	if (!routeId) return true;
	return ESCLUSI.some((p) => routeId === p || routeId.startsWith(`${p}/`));
}
