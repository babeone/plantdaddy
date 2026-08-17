import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sql } from '$lib/server/db';
import { secretMatches } from '$lib/server/notify';
import { LOCK_PULIZIA_FOTO } from '$lib/server/photos/reminders';
import { deleteObjects, listKeys, storageConfigured } from '$lib/server/photos/storage';

/**
 * Pulizia degli oggetti ORFANI e potatura dei log.
 *
 * Un orfano è un file presente nell'archivio senza riga corrispondente nel
 * database. Nasce nei casi in cui l'upload si interrompe fra la scrittura del file
 * e l'inserimento della riga, o quando una cancellazione riesce sul database e
 * fallisce sull'archivio. La direzione è voluta — meglio un file di troppo che una
 * riga che punta al nulla — ma senza questo job quei file resterebbero a occupare
 * disco per sempre, e la quota diventerebbe finzione.
 *
 * Schedule consigliato: una volta al giorno.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/photo-cleanup
 */

/** Chiavi esaminate per esecuzione: si riprende al giro dopo. */
const MAX_CHIAVI = 5000;
/** Cancellazioni per esecuzione, per non tenere occupato l'archivio troppo a lungo. */
const MAX_CANCELLAZIONI = 500;

/**
 * GRAZIA. Un upload in corso ha già scritto il file ma non ancora la riga: senza
 * questa finestra il job glielo cancellerebbe sotto. Cinque minuti sono
 * abbondanti, visto che un upload dura al massimo qualche secondo.
 */
const GRAZIA_MS = 5 * 60 * 1000;

export const GET: RequestHandler = async ({ request, url }) => {
	// Autorizzazione prima di ogni query e prima di parlare con l'archivio.
	const expected = env.CRON_SECRET;
	if (!expected) error(503, 'CRON_SECRET non configurato');
	const header = request.headers.get('authorization');
	const provided = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
	if (!secretMatches(provided, expected)) error(401, 'Non autorizzato');

	if (!storageConfigured()) error(503, 'Archivio foto non configurato');

	/** Con ?dry-run si vede cosa sparirebbe senza cancellare niente. */
	const dryRun = url.searchParams.has('dry-run');

	const preso = await sql.begin(async (tx) => {
		const [{ locked }] = await tx<{ locked: boolean }[]>`
			select pg_try_advisory_xact_lock(${LOCK_PULIZIA_FOTO}) as locked
		`;
		return locked;
	});
	// Il lock è per transazione, quindi è già stato rilasciato: serve solo a evitare
	// che due esecuzioni partano insieme, non a tenerlo per tutta la durata. Due run
	// sovrapposte cancellerebbero comunque le stesse chiavi senza fare danno, ma
	// pagherebbero due volte l'elenco del bucket.
	if (!preso) return json({ skipped: 'un’altra esecuzione è già in corso' });

	// 1. Potatura del log degli upload: oltre la finestra del rate limit non serve.
	const [{ potati }] = await sql<{ potati: number }[]>`
		with tolti as (
			delete from photo_uploads where at < now() - interval '7 days' returning 1
		)
		select count(*)::int as potati from tolti
	`;

	// 2. Tutte le chiavi che il database conosce. Le foto sono al massimo
	//    100 piante x (1 avatar + 61 slot) x 2 file per utente: un insieme in
	//    memoria è la struttura giusta, non una query per chiave.
	const conosciute = new Set<string>();
	for (const riga of await sql<{ object_key: string; thumb_key: string }[]>`
		select object_key, thumb_key from plant_photos
	`) {
		conosciute.add(riga.object_key);
		conosciute.add(riga.thumb_key);
	}

	// 3. Confronto con l'archivio.
	//
	// Le chiavi vengono lette DOPO quelle del database, non prima. Se un upload
	// finisce nel frattempo, la sua riga c'è già ma la chiave non è nell'elenco:
	// caso innocuo. Nell'ordine inverso avremmo una chiave elencata la cui riga non
	// era ancora stata letta, e la cancelleremmo per errore.
	const nelBucket = await listKeys('plants/', MAX_CHIAVI);

	// FINESTRA DI GRAZIA. Un upload in corso ha già scritto i file ma non ancora la
	// riga: senza questo filtro il job glieli cancellerebbe sotto, e l'utente si
	// ritroverebbe una foto rotta appena caricata. Un oggetto senza data si
	// considera vecchio, perché MinIO la restituisce sempre e la sua assenza
	// indicherebbe un elenco anomalo, non un file appena creato.
	const soglia = Date.now() - GRAZIA_MS;
	const candidati = nelBucket.filter(
		(o) => !conosciute.has(o.key) && (o.lastModified ? o.lastModified.getTime() < soglia : true)
	);
	const inGrazia = nelBucket.filter(
		(o) => !conosciute.has(o.key) && o.lastModified !== null && o.lastModified.getTime() >= soglia
	).length;

	const orfani = candidati.slice(0, MAX_CANCELLAZIONI);

	let cancellati = 0;
	if (!dryRun && orfani.length > 0) {
		await deleteObjects(orfani.map((o) => o.key));
		cancellati = orfani.length;
	}

	const esito = {
		dry_run: dryRun,
		chiavi_nel_bucket: nelBucket.length,
		chiavi_nel_database: conosciute.size,
		orfani_trovati: candidati.length,
		orfani_cancellati: cancellati,
		/** Senza riga ma troppo recenti: probabilmente upload ancora in corso. */
		risparmiati_per_grazia: inGrazia,
		troncato: nelBucket.length >= MAX_CHIAVI || candidati.length > MAX_CANCELLAZIONI,
		log_upload_potati: potati
	};
	console.log('[cron/photo-cleanup]', JSON.stringify(esito));
	return json(esito);
};
