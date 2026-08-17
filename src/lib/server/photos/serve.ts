import { error } from '@sveltejs/kit';
import { sql } from '$lib/server/db';
import { getObjectStream, storageConfigured } from './storage';

/**
 * Il proxy delle immagini.
 *
 * PERCHÉ UN PROXY E NON UN PRESIGNED URL. La CSP dell'app è `img-src 'self' blob:`
 * senza host esterni (vite.config.ts). Un URL firmato verso l'archivio
 * richiederebbe di allargare quella direttiva e di pubblicarlo su internet
 * attraverso Traefik: due indebolimenti reali per risparmiare banda su immagini da
 * 38 KB. Passando da qui, l'archivio resta raggiungibile solo dalla rete interna
 * di Docker e il browser vede solo la nostra origine.
 *
 * Il costo è banda e CPU del processo Node, e si paga UNA VOLTA per immagine: le
 * chiavi contengono un uuid e il contenuto non cambia mai, quindi la risposta è
 * marcata `immutable` e il browser non richiede più lo stesso file.
 *
 * `private` e non `public`: le foto sono di una sola persona e non devono finire in
 * una cache condivisa lungo la strada.
 */
const CACHE = 'private, max-age=31536000, immutable';

type Quale = 'full' | 'thumb';

async function chiave(
	tokenHash: string,
	where: { photoId: string } | { plantId: string; kind: 'avatar' },
	quale: Quale
): Promise<string | null> {
	// La join su plants con il filtro sul token È il controllo di proprietà: la foto
	// di un altro non produce righe, quindi 404 senza rivelare se esista.
	const righe =
		'photoId' in where
			? await sql<{ object_key: string; thumb_key: string }[]>`
					select ph.object_key, ph.thumb_key
					from plant_photos ph
					join plants p on p.id = ph.plant_id
					where ph.id = ${where.photoId} and p.user_token_hash = ${tokenHash}
				`
			: await sql<{ object_key: string; thumb_key: string }[]>`
					select ph.object_key, ph.thumb_key
					from plant_photos ph
					join plants p on p.id = ph.plant_id
					where ph.plant_id = ${where.plantId}
						and ph.kind = 'avatar'
						and p.user_token_hash = ${tokenHash}
				`;
	const riga = righe[0];
	if (!riga) return null;
	return quale === 'thumb' ? riga.thumb_key : riga.object_key;
}

export async function serviFoto(
	tokenHash: string,
	where: { photoId: string } | { plantId: string; kind: 'avatar' },
	quale: Quale
): Promise<Response> {
	if (!storageConfigured()) error(503, 'Archivio foto non configurato');

	const key = await chiave(tokenHash, where, quale);
	if (!key) error(404, 'Foto non trovata');

	let oggetto;
	try {
		oggetto = await getObjectStream(key);
	} catch (err) {
		// Archivio spento o oggetto sparito: 503 e non 500. La UI mette un
		// segnaposto e il resto della pagina continua a funzionare, che è
		// esattamente il comportamento richiesto quando l'archivio è giù.
		console.error('[foto] lettura da storage fallita', key, err);
		error(503, 'Archivio foto non raggiungibile');
	}

	return new Response(oggetto.body, {
		headers: {
			'content-type': oggetto.contentType,
			'cache-control': CACHE,
			...(oggetto.contentLength ? { 'content-length': String(oggetto.contentLength) } : {}),
			// Le foto non devono essere incorniciate da terzi né finire in un indice.
			'x-content-type-options': 'nosniff',
			'x-robots-tag': 'noindex, nofollow'
		}
	});
}
