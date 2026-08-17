import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser, requireUuid } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { conSemaforo, consumaGettoneUpload, controllaDimensione, leggiCorpo } from './gate';
import { FotoNonValida, elabora } from './pipeline';
import { statoSlotConLock, type StatoSlot } from './slots';
import { deleteObjects, photoKeys, putObject, storageConfigured } from './storage';

/**
 * Il corpo di un upload, condiviso da avatar e galleria.
 *
 * ORDINE DEI PASSI, ed è la parte che conta:
 *
 *  1. autenticazione e proprietà della pianta
 *  2. dimensione dichiarata (header), prima di leggere un byte
 *  3. lettura del corpo con tetto rispettato durante la lettura
 *  4. QUOTA E GETTONE in transazione con lock, PRIMA di elaborare
 *  5. semaforo, poi elaborazione: una immagine alla volta
 *  6. scrittura su storage
 *  7. riga nel database
 *
 * Il punto 4 prima del 5 non è estetica: elaborare e poi scoprire che la quota era
 * esaurita significa aver speso un secondo di CPU e 110 MB di picco per niente,
 * sulla stessa macchina dove gira Postgres.
 *
 * Il punto 6 prima del 7 lascia la possibilità di un oggetto senza riga, se il
 * processo muore in mezzo. È voluto: è la direzione recuperabile. Al contrario, una
 * riga senza oggetto darebbe un'immagine rotta all'utente e nessun modo di
 * accorgersene. Gli oggetti orfani li raccoglie il job di pulizia.
 */

export type Caricata = {
	id: string;
	created_at: string;
	width: number;
	height: number;
	bytes_stored: number;
};

type Opzioni = {
	kind: 'avatar' | 'gallery';
	/** Se true, il vecchio avatar viene sostituito invece di aggiungersi. */
	sostituisci?: boolean;
};

export async function gestisciUpload(event: RequestEvent, opzioni: Opzioni): Promise<Response> {
	const tokenHash = await requireUser(event.locals);
	const plantId = requireUuid(event.params.id, 'Pianta non trovata');

	if (!storageConfigured()) {
		// 503 e non 500: non è un bug, è un'istanza senza storage configurato. Il
		// messaggio dice cosa manca a chi ospita, non all'utente finale.
		error(503, 'Archivio foto non configurato su questa istanza');
	}

	controllaDimensione(event.request);

	const buf = await leggiCorpo(event.request);

	// Quota, gettone e lock in una transazione sola. Restituisce anche le chiavi
	// vecchie da cancellare, nel caso dell'avatar sostituito.
	const preparazione = await sql.begin(async (tx) => {
		const slot = await statoSlotConLock(tx, plantId, tokenHash);
		if (!slot) error(404, 'Pianta non trovata');

		if (opzioni.kind === 'gallery' && slot.free <= 0) {
			error(
				409,
				slot.next_slot_at
					? `Slot esauriti: ${slot.used} di ${slot.total} usati. Il prossimo matura il ${slot.next_slot_at.slice(0, 10)}.`
					: `Slot esauriti: ${slot.used} di ${slot.total} usati.`
			);
		}

		const gettone = await consumaGettoneUpload(tx, tokenHash);
		if (!gettone.ok) {
			error(429, `Limite di ${gettone.limite} foto al giorno raggiunto. Riprova domani.`);
		}

		const vecchie = opzioni.sostituisci
			? await tx<{ id: string; object_key: string; thumb_key: string }[]>`
					select id, object_key, thumb_key from plant_photos
					where plant_id = ${plantId} and kind = 'avatar'
				`
			: [];

		return { slot, vecchie };
	});

	// Semaforo: da qui in poi una sola immagine alla volta in tutto il processo.
	const immagine = await conSemaforo(async () => {
		try {
			return await elabora(buf, opzioni.kind);
		} catch (err) {
			if (err instanceof FotoNonValida) error(400, err.message);
			throw err;
		}
	});

	// L'id si genera QUI e si passa all'INSERT invece di lasciarlo a
	// gen_random_uuid(): le chiavi degli oggetti servono prima che la riga esista,
	// e con due uuid diversi il nome del file non direbbe niente su quale riga lo
	// possiede. Così `plants/<pianta>/<foto>.webp` si mappa a occhio su
	// plant_photos.id, che è la differenza fra poter indagare un orfano e non
	// poterlo fare.
	const photoId = crypto.randomUUID();
	const chiavi = photoKeys(plantId, photoId);

	try {
		await putObject(chiavi.full, immagine.full, 'image/webp');
		await putObject(chiavi.thumb, immagine.thumb, 'image/webp');
	} catch (err) {
		console.error('[foto] scrittura su storage fallita', err);
		error(503, 'Archivio foto non raggiungibile, riprova');
	}

	let creata: Caricata;
	try {
		creata = await sql.begin(async (tx) => {
			if (opzioni.sostituisci && preparazione.vecchie.length > 0) {
				await tx`
					delete from plant_photos
					where plant_id = ${plantId} and kind = 'avatar'
				`;
			}
			const [row] = await tx<Caricata[]>`
				insert into plant_photos ${tx({
					id: photoId,
					plant_id: plantId,
					kind: opzioni.kind,
					object_key: chiavi.full,
					thumb_key: chiavi.thumb,
					width: immagine.width,
					height: immagine.height,
					bytes_original: immagine.bytesOriginal,
					bytes_stored: immagine.full.length,
					bytes_thumb: immagine.thumb.length
				})}
				returning id, created_at, width, height, bytes_stored
			`;
			if (opzioni.kind === 'avatar') {
				await tx`
					update plants set avatar_type = 'photo'
					where id = ${plantId} and user_token_hash = ${tokenHash}
				`;
			}
			return row;
		});
	} catch (err) {
		// La riga non è entrata: gli oggetti appena scritti diventerebbero orfani e
		// occuperebbero disco per sempre. Si tolgono subito, e il job di pulizia
		// resta la rete per i casi in cui anche questa cancellazione fallisce.
		await deleteObjects([chiavi.full, chiavi.thumb]).catch(() => {});
		// Il trigger di quota della migrazione 009: due upload concorrenti passati
		// entrambi dal controllo applicativo, il database ne ferma uno.
		if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23514') {
			error(409, 'Slot esauriti: un altro upload ha appena occupato l’ultimo posto.');
		}
		throw err;
	}

	// Le vecchie chiavi dell'avatar si cancellano DOPO il commit: se questa fallisce
	// restano orfane e le prende il job di pulizia, mentre cancellarle prima
	// avrebbe potuto lasciare l'utente senza avatar per un rollback.
	if (opzioni.sostituisci && preparazione.vecchie.length > 0) {
		await deleteObjects(preparazione.vecchie.flatMap((v) => [v.object_key, v.thumb_key])).catch(
			(err) => console.error('[foto] vecchio avatar non cancellato', err)
		);
	}

	const slot = opzioni.kind === 'gallery' ? await statoSlotConLock(sql, plantId, tokenHash) : null;
	return json({ photo: creata, slots: slot }, { status: 201 });
}

/** Cancella una foto: prima la riga, poi gli oggetti. */
export async function cancellaFoto(
	tokenHash: string,
	photoId: string
): Promise<{ plantId: string; slots: StatoSlot | null } | null> {
	const [riga] = await sql<
		{ plant_id: string; kind: string; object_key: string; thumb_key: string }[]
	>`
		delete from plant_photos ph
		using plants p
		where ph.id = ${photoId}
			and p.id = ph.plant_id
			and p.user_token_hash = ${tokenHash}
		returning ph.plant_id, ph.kind, ph.object_key, ph.thumb_key
	`;
	if (!riga) return null;

	if (riga.kind === 'avatar') {
		await sql`update plants set avatar_type = 'emoji' where id = ${riga.plant_id}`;
	}

	// La riga è già via, quindi la foto è sparita per l'utente anche se questa
	// cancellazione fallisce; in quel caso gli oggetti restano orfani e li prende il
	// job di pulizia. L'ordine inverso rischiava una riga che punta al nulla.
	await deleteObjects([riga.object_key, riga.thumb_key]).catch((err) =>
		console.error('[foto] oggetti non cancellati da storage', err)
	);

	return {
		plantId: riga.plant_id,
		slots: riga.kind === 'gallery' ? await statoSlotConLock(sql, riga.plant_id, tokenHash) : null
	};
}
