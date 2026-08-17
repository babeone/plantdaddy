import {
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { env } from '$env/dynamic/private';

/**
 * Object storage delle foto.
 *
 * Si usa `@aws-sdk/client-s3` e non il client specifico di un server: è lo stesso
 * protocollo, quindi lo stesso codice gira identico su RustFS self-hosted, su
 * MinIO e su Cloudflare R2. Cambiare archivio vuol dire cambiare tre variabili
 * d'ambiente e copiare i file.
 *
 * Non è teoria: il passaggio da MinIO a RustFS non ha richiesto una riga di
 * modifica in questo file.
 *
 * QUI NON SI COSTRUISCONO URL. Le funzioni parlano solo di chiavi relative, come
 * `plants/<id>/<foto>.webp`, e nel database finiscono solo quelle — c'è anche un
 * CHECK che rifiuta le stringhe con `://` (migrazione 009). L'endpoint vive in una
 * variabile d'ambiente e l'immagine viene servita dal proxy in
 * src/routes/api/photos, mai linkata direttamente.
 */

const globalForS3 = globalThis as unknown as { __plantdaddyS3?: S3Client };

function createClient(): S3Client {
	const endpoint = env.S3_ENDPOINT;
	const accessKeyId = env.S3_ACCESS_KEY;
	const secretAccessKey = env.S3_SECRET_KEY;
	if (!endpoint || !accessKeyId || !secretAccessKey) {
		throw new Error('S3_ENDPOINT, S3_ACCESS_KEY e S3_SECRET_KEY non impostate');
	}
	return new S3Client({
		endpoint,
		// I server self-hosted non hanno regioni, ma il protocollo pretende un valore
		// per firmare la richiesta.
		region: env.S3_REGION ?? 'us-east-1',
		credentials: { accessKeyId, secretAccessKey },
		// Indispensabile con RustFS e MinIO: senza, l'SDK userebbe
		// https://bucket.host/chiave (virtual-hosted) invece di
		// https://host/bucket/chiave, e il server risponderebbe 404 su tutto.
		forcePathStyle: true
	});
}

function client(): S3Client {
	return (globalForS3.__plantdaddyS3 ??= createClient());
}

export function bucket(): string {
	const name = env.S3_BUCKET;
	if (!name) throw new Error('S3_BUCKET non impostata');
	return name;
}

/**
 * Il client nasce alla PRIMA operazione, non all'import.
 *
 * Stessa ragione di src/lib/server/db.ts, e non è teoria: `vite build` importa i
 * moduli server per leggere le opzioni delle route, in un momento in cui le
 * variabili di runtime non esistono. Un client creato a livello di modulo aveva
 * già rotto una volta il build Docker di questo progetto.
 */
export function storageConfigured(): boolean {
	return Boolean(env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY && env.S3_BUCKET);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
	await client().send(
		new PutObjectCommand({
			Bucket: bucket(),
			Key: key,
			Body: body,
			ContentType: contentType,
			// Le chiavi contengono un uuid e il contenuto non cambia mai: il file
			// può essere considerato immutabile da qualunque cache.
			CacheControl: 'public, max-age=31536000, immutable'
		})
	);
}

export type ObjectStream = {
	body: ReadableStream<Uint8Array>;
	contentType: string;
	contentLength?: number;
};

/**
 * Legge un oggetto come stream, senza portarselo in memoria: il proxy lo passa
 * direttamente al browser. Una foto da 400 KB non è un problema, ma farlo a
 * stream significa che la RAM del processo non cresce col numero di richieste
 * in volo.
 */
export async function getObjectStream(key: string): Promise<ObjectStream> {
	const out = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
	if (!out.Body) throw new Error(`oggetto ${key} senza corpo`);
	return {
		body: out.Body.transformToWebStream(),
		contentType: out.ContentType ?? 'application/octet-stream',
		contentLength: out.ContentLength
	};
}

/**
 * Cancella una o più chiavi. Le chiavi inesistenti non sono un errore in S3, e va
 * bene così: cancellare due volte la stessa foto deve essere innocuo, altrimenti
 * un ritentativo dopo un errore di rete diventerebbe un 500.
 */
export async function deleteObjects(keys: string[]): Promise<void> {
	const puliti = keys.filter(Boolean);
	if (puliti.length === 0) return;
	await client().send(
		new DeleteObjectsCommand({
			Bucket: bucket(),
			Delete: { Objects: puliti.map((Key) => ({ Key })), Quiet: true }
		})
	);
}

/**
 * Elenca le chiavi sotto un prefisso, seguendo la paginazione.
 *
 * Serve al job di pulizia degli orfani. `limite` esiste perché quel job gira su
 * una VPS piccola: meglio ripulire un pezzo per volta e riprendere alla
 * prossima esecuzione che tenere in memoria l'elenco di un bucket intero.
 */
export type OggettoElencato = { key: string; lastModified: Date | null };

export async function listKeys(prefix: string, limite = 5000): Promise<OggettoElencato[]> {
	const oggetti: OggettoElencato[] = [];
	let token: string | undefined;
	do {
		const out = await client().send(
			new ListObjectsV2Command({
				Bucket: bucket(),
				Prefix: prefix,
				ContinuationToken: token,
				MaxKeys: 1000
			})
		);
		for (const o of out.Contents ?? []) {
			// lastModified serve al job di pulizia: un file appena scritto può
			// appartenere a un upload ancora in volo, la cui riga nel database non
			// esiste ancora. Senza questo dato il job glielo cancellerebbe sotto.
			if (o.Key) oggetti.push({ key: o.Key, lastModified: o.LastModified ?? null });
		}
		token = out.IsTruncated ? out.NextContinuationToken : undefined;
	} while (token && oggetti.length < limite);
	return oggetti;
}

/** Chiavi di una foto. Prefisso per pianta: cancellarla diventa un solo prefisso. */
export function photoKeys(plantId: string, photoId: string): { full: string; thumb: string } {
	return {
		full: `plants/${plantId}/${photoId}.webp`,
		thumb: `plants/${plantId}/${photoId}_thumb.webp`
	};
}

export function plantPrefix(plantId: string): string {
	return `plants/${plantId}/`;
}
