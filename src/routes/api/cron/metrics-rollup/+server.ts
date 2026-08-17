import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sql } from '$lib/server/db';
import { secretMatches } from '$lib/server/notify';
import { conTraccia } from '$lib/server/metrics/jobs';
import {
	campionaOccupazione,
	pulizia,
	puliziaExtra,
	rollupGiornaliero,
	rollupOrario
} from '$lib/server/metrics/rollup';

/**
 * Aggregazione e pulizia delle metriche. Uno Schedule ogni ora.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/metrics-rollup
 *
 * L'ordine conta: prima si aggrega, poi si cancella. Invertirlo cancellerebbe dati
 * grezzi non ancora riassunti, e quel buco non si recupera.
 */

/** Lock dedicato, accanto a quelli dei job foto. */
const LOCK_METRICHE = 918_273_643;

export const GET: RequestHandler = async ({ request }) => {
	/*
	 * AUTORIZZAZIONE PRIMA DI OGNI QUERY, come negli altri tre cron. Qui conta il
	 * doppio: questo job scrive, aggrega e cancella. Un endpoint del genere
	 * raggiungibile senza credenziali sarebbe sia un amplificatore di DoS sia un
	 * modo per far cancellare i dati a comando.
	 */
	const expected = env.CRON_SECRET;
	if (!expected) error(503, 'CRON_SECRET non configurato');
	const header = request.headers.get('authorization');
	const provided = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
	if (!secretMatches(provided, expected)) error(401, 'Non autorizzato');

	// Lock legato alla transazione: se il processo muore a metà si rilascia da solo,
	// mentre un flag su tabella lascerebbe il job bloccato per sempre.
	const preso = await sql.begin(async (tx) => {
		const [{ locked }] = await tx<{ locked: boolean }[]>`
			select pg_try_advisory_xact_lock(${LOCK_METRICHE}) as locked
		`;
		return locked;
	});
	if (!preso) return json({ skipped: 'un’altra esecuzione è già in corso' });

	const esito = await conTraccia('metrics-rollup', async () => {
		const orari = await rollupOrario();
		const giornalieri = await rollupGiornaliero();
		await campionaOccupazione();
		const p = await pulizia();
		const extra = await puliziaExtra();
		return {
			righe_orarie: orari,
			righe_giornaliere: giornalieri,
			...p,
			campioni_potati: extra.campioni,
			job_runs_potati: extra.run
		};
	});

	console.log('[cron/metrics-rollup]', JSON.stringify(esito));
	return json(esito);
};
