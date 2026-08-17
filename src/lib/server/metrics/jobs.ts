import { sql } from '$lib/server/db';

/**
 * Registrazione degli esiti dei job schedulati.
 *
 * Prima di questo, i quattro cron stampavano il risultato in stdout e finiva nel
 * log del container: nessuno lo guarda, Docker non lo ruota, e alla domanda "il
 * cron sta girando davvero?" il pannello poteva rispondere solo per indizi —
 * guardando se gli action token venivano ripuliti. Una riga per esecuzione la
 * trasforma in una domanda con risposta.
 *
 * NON DEVE MAI FAR FALLIRE IL JOB. Se la scrittura della traccia non riesce, il
 * lavoro vero è già stato fatto e l'errore va nel log, non all'utente.
 */

type Dettaglio = Record<string, string | number | boolean | null | undefined>;

export async function registraRun(
	job: string,
	inizio: number,
	esito: { ok: boolean; detail?: Dettaglio; error?: string }
): Promise<void> {
	try {
		await sql`
			insert into job_runs (job, started_at, duration_ms, ok, detail, error)
			values (
				${job},
				${new Date(inizio)},
				${Math.round(Date.now() - inizio)},
				${esito.ok},
				${esito.detail ? sql.json(esito.detail) : null},
				${esito.error ?? null}
			)
		`;
	} catch (err) {
		console.error('[job_runs] traccia non scritta', err);
	}
}

/**
 * Avvolge un job: misura, registra l'esito e RILANCIA l'errore.
 *
 * Rilanciare è voluto: chi chiama deve continuare a rispondere 500 al cron, così
 * lo Schedule di Dokploy vede il fallimento. La traccia serve a te che guardi la
 * dashboard, non a nascondere il problema a chi lo sta segnalando.
 */
export async function conTraccia<T extends Dettaglio>(
	job: string,
	lavoro: () => Promise<T>
): Promise<T> {
	const inizio = Date.now();
	try {
		const esito = await lavoro();
		await registraRun(job, inizio, { ok: true, detail: esito });
		return esito;
	} catch (err) {
		await registraRun(job, inizio, {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}
