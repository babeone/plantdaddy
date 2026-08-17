import { sql } from '$lib/server/db';
import { bufferMax, flushMs, metricsEnabled } from './config';

/**
 * Buffer in memoria e scrittura in batch.
 *
 * IL PRINCIPIO: la raccolta metriche non deve MAI poter degradare l'app che
 * sorveglia. Ogni meccanismo qui dentro esiste per un modo diverso in cui
 * potrebbe farlo.
 */

export type Record = {
	route: string;
	method: string;
	status: number;
	duration_ms: number;
	authed: boolean;
};

/**
 * Array a dimensione limitata. Il tetto è controllato a ogni push, quindi non
 * esiste un percorso di codice in cui questo cresca oltre `bufferMax()`.
 */
let buffer: Record[] = [];

/** Un solo flush alla volta: è anche il tetto sulle connessioni che le metriche usano. */
let inCorso = false;

let timer: ReturnType<typeof setInterval> | null = null;

/** Stato osservabile dalla dashboard, senza esporre il buffer stesso. */
export const stato = {
	scartati: 0,
	scritti: 0,
	flushOk: 0,
	flushFalliti: 0,
	ultimoFlushOk: null as Date | null,
	ultimoErrore: null as string | null,
	consecutiviFalliti: 0,
	apertoFinoA: null as Date | null
};

/**
 * CIRCUIT BREAKER. Tre flush consecutivi falliti e la raccolta si spegne per
 * cinque minuti, con un warning nel log.
 *
 * Il motivo non è risparmiare: è che se il database è in difficoltà, continuare a
 * bussargli ogni dieci secondi peggiora esattamente la situazione che ha causato i
 * fallimenti. L'app continua a servire richieste normalmente con le metriche
 * spente — è il comportamento richiesto, non un degrado.
 */
const SOGLIA_BREAKER = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

function breakerAperto(): boolean {
	if (!stato.apertoFinoA) return false;
	if (stato.apertoFinoA.getTime() > Date.now()) return true;
	// Cooldown scaduto: si riprova, e il contatore riparte da zero.
	stato.apertoFinoA = null;
	stato.consecutiviFalliti = 0;
	return false;
}

/**
 * DEADLINE SUL FLUSH, ed è qui che sta la differenza rispetto a quanto avevo
 * previsto nel piano.
 *
 * L'idea era "se il pool è oltre l'80% di connessioni in uso, salta il flush".
 * postgres.js NON espone quel dato: le code interne (`busy`, `open`, `full`) sono
 * chiusure dentro il modulo, e leggerle vorrebbe dire dipendere da dettagli
 * privati che si rompono al primo aggiornamento di versione.
 *
 * La garanzia si ottiene comunque, misurando il sintomo invece dello stato: se il
 * pool è saturo, postgres.js mette la nostra query in coda e il flush non
 * completa entro la deadline. A quel punto lo si abbandona e conta come
 * fallimento, quindi il circuit breaker interviene da sé. Il risultato pratico è
 * lo stesso — le metriche si tirano indietro quando il database è sotto pressione
 * — senza dipendere da API private.
 *
 * Da notare: una richiesta utente NON aspetta mai un flush. Le query dell'app e
 * questa condividono il pool, ma la nostra è una sola e in coda come le altre.
 */
const DEADLINE_MS = 3000;

export function push(record: Record): void {
	if (!metricsEnabled() || breakerAperto()) return;

	const max = bufferMax();
	if (buffer.length >= max) {
		if (inCorso) {
			// Flush già in volo e buffer pieno: si SCARTA il più vecchio. Accumulare
			// sarebbe l'unico modo di far crescere la memoria senza limite, ed è
			// esattamente ciò che non deve succedere.
			buffer.shift();
			stato.scartati += 1;
		} else {
			void flush();
		}
	}
	buffer.push(record);
	if (buffer.length >= max && !inCorso) void flush();
}

/**
 * Scrive il buffer in una sola INSERT multi-riga. Non lancia mai: è chiamata in
 * fire-and-forget dall'hook, e una promise rifiutata lì diventerebbe un
 * unhandledRejection che può portarsi via il processo.
 */
export async function flush(): Promise<void> {
	if (inCorso || buffer.length === 0) return;
	if (breakerAperto()) return;

	inCorso = true;
	// Si stacca il lotto prima di scrivere: le richieste che arrivano durante il
	// flush finiscono nel buffer nuovo e non vengono perse né scritte due volte.
	const lotto = buffer;
	buffer = [];

	try {
		await Promise.race([
			sql`
				insert into request_metrics ${sql(lotto, 'route', 'method', 'status', 'duration_ms', 'authed')}
			`,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error(`flush oltre ${DEADLINE_MS}ms`)), DEADLINE_MS)
			)
		]);
		stato.scritti += lotto.length;
		stato.flushOk += 1;
		stato.consecutiviFalliti = 0;
		stato.ultimoFlushOk = new Date();
		stato.ultimoErrore = null;
	} catch (err) {
		// Il lotto è perso: NON si rimette nel buffer. Rimetterlo significherebbe
		// che un database lento fa crescere la memoria a ogni tentativo, cioè
		// trasformare un problema di scrittura in un problema di RAM.
		stato.scartati += lotto.length;
		stato.flushFalliti += 1;
		stato.consecutiviFalliti += 1;
		stato.ultimoErrore = err instanceof Error ? err.message : String(err);
		if (stato.consecutiviFalliti >= SOGLIA_BREAKER && !stato.apertoFinoA) {
			stato.apertoFinoA = new Date(Date.now() + COOLDOWN_MS);
			console.warn(
				`[metriche] ${SOGLIA_BREAKER} flush falliti di seguito: raccolta sospesa per ${COOLDOWN_MS / 60000} minuti. Ultimo errore: ${stato.ultimoErrore}`
			);
		}
	} finally {
		inCorso = false;
	}
}

export function inBuffer(): number {
	return buffer.length;
}

/**
 * Avvia il flush periodico e registra lo svuotamento allo spegnimento.
 *
 * Il flush alla chiusura serve davvero: Dokploy manda SIGTERM a ogni redeploy, e
 * senza questo si perderebbero gli ultimi secondi di dati — proprio quelli che si
 * guardano quando si cerca di capire cosa è andato storto prima di un riavvio.
 *
 * SI ASCOLTA `sveltekit:shutdown`, NON SIGTERM.
 *
 * adapter-node ha già i suoi handler per SIGTERM e SIGINT: chiudono il server
 * HTTP, aspettano che le richieste in volo finiscano (fino a SHUTDOWN_TIMEOUT) e
 * solo allora emettono questo evento. Registrare un secondo handler su SIGTERM che
 * chiama process.exit() avrebbe troncato quel drenaggio, cioè avrebbe interrotto
 * richieste di utenti veri a ogni redeploy per salvare qualche riga di metriche.
 * Uno scambio assurdo, ed è quello che il codice faceva prima di questa nota.
 *
 * Non si chiama process.exit() nemmeno qui: il flush è una promise pendente su un
 * socket attivo, quindi tiene vivo l'event loop finché non si risolve, e poi Node
 * esce da solo perché non resta niente da fare.
 *
 * unref() sul timer: un interval attivo terrebbe vivo il processo per sempre e
 * impedirebbe al container di terminare.
 */
export function avvia(): void {
	if (timer) return;
	timer = setInterval(() => void flush(), flushMs());
	timer.unref?.();

	process.once('sveltekit:shutdown', () => {
		void flush();
	});
}
