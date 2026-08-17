import sharp from 'sharp';
import type { OutputInfo } from 'sharp';

/**
 * Pipeline di compressione delle foto.
 *
 * SCELTE MISURATE, non preferenze. Su un'immagine da 12 MP costruita per essere
 * più difficile di una foto vera (fogliame, dettaglio fine a più scale, rumore
 * per pixel), pipeline completa, un core:
 *
 *   WebP q78   378 KB   258 ms
 *   WebP q82   447 KB   267 ms
 *   AVIF q78   397 KB  4904 ms
 *   AVIF q82   462 KB  5956 ms
 *
 * AVIF perde su entrambi i fronti a queste qualità: 19 volte più lento e file più
 * grandi. Il suo vantaggio noto sta ai bitrate bassi e sui contenuti morbidi, e a
 * q78-85 su dettaglio fine svanisce. Quei millisecondi sono su un core ARM veloce:
 * su 2 vCPU condivise x86, AVIF sarebbero 10-20 secondi di CPU al 100% per
 * upload, con Postgres sulla stessa macchina. Da qui WebP q78.
 */

/** Lato lungo della versione piena e della thumbnail. */
export const LATO_FULL = 1600;
export const LATO_THUMB = 400;
/** L'avatar si vede a 44-56 px: 512 dà margine anche su schermi a 3x. */
export const LATO_AVATAR = 512;
export const LATO_AVATAR_THUMB = 128;

const Q_FULL = 78;
const Q_THUMB = 72;
const Q_AVATAR = 80;

/**
 * Tetto sui pixel in INGRESSO, applicato prima della decodifica.
 *
 * Una "bomba" da 50.000x50.000 px sono 2,5 miliardi di pixel: decomprimerla
 * significherebbe allocare gigabyte e portarsi via il processo, e il file
 * compresso può pesare pochi KB — quindi il limite sui byte non basta.
 * 40 MP lascia passare qualunque telefono o reflex (un 12 MP è 12 milioni).
 * Verificato: 81 MP con questo limite dà "Input image exceeds pixel limit"
 * senza decodificare.
 */
const LIMITE_PIXEL = 40e6;

/**
 * Configurazione globale di libvips, applicata una volta all'import.
 *
 * concurrency(1): libvips per default usa un thread per core. Su 2 vCPU condivise
 * con Postgres accanto, un solo upload occuperebbe tutta la macchina.
 * cache(false): la cache di libvips tiene in memoria immagini decodificate fra le
 * chiamate, ed è esattamente la crescita di RAM che qui non possiamo permetterci.
 */
sharp.concurrency(1);
sharp.cache(false);

export type Formato = 'jpeg' | 'png' | 'webp' | 'gif' | 'heic';

/**
 * Riconoscimento del formato dai MAGIC BYTES, non dall'estensione né dal
 * Content-Type dichiarato dal client: entrambi sono stringhe scelte da chi carica.
 * Un `.jpg` può contenere qualunque cosa, e passarlo al decoder senza guardare è
 * il modo classico di trasformare un upload in un'esecuzione di codice.
 */
export function riconosciFormato(buf: Buffer): Formato | null {
	if (buf.length < 12) return null;
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
	if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return 'png';
	}
	if (
		buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
		buf.subarray(8, 12).toString('latin1') === 'WEBP'
	) {
		return 'webp';
	}
	if (buf.subarray(0, 3).toString('latin1') === 'GIF') return 'gif';
	// HEIC/HEIF: box ftyp con un brand noto. Riconosciuto per poter dare un errore
	// comprensibile — vedi il commento su elabora().
	if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
		const brand = buf.subarray(8, 12).toString('latin1');
		if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
	}
	return null;
}

/** Formati che entrano. GIF escluso: animato non ha senso qui, statico è raro. */
const AMMESSI: Formato[] = ['jpeg', 'png', 'webp'];

export class FotoNonValida extends Error {}

export type Elaborata = {
	full: Buffer;
	thumb: Buffer;
	width: number;
	height: number;
	bytesOriginal: number;
};

/**
 * Da buffer in ingresso a coppia (piena, thumbnail) in WebP.
 *
 * L'ordine dei passi conta:
 *  1. magic bytes, prima di dare il buffer a libvips
 *  2. rotate() SENZA argomenti: applica l'orientamento EXIF e poi lo azzera.
 *     Senza questo, una foto scattata in verticale arriva coricata, perché
 *     rimuovendo l'EXIF si perde anche l'informazione su come raddrizzarla.
 *  3. resize inside + withoutEnlargement: mai ingrandire un'immagine piccola,
 *     si otterrebbe un file più grande dell'originale senza un pixel in più.
 *  4. encode.
 *
 * I METADATI NON VENGONO COPIATI. sharp li scarta per default: il rischio è
 * l'opposto, cioè che qualcuno aggiunga `.withMetadata()` o `.keepExif()` per
 * conservare l'orientamento e reintroduca senza accorgersene le COORDINATE GPS
 * della casa dell'utente, che gli smartphone scrivono in ogni foto. Verificato su
 * un JPEG con GPS, Make "Apple" e Model "iPhone 15 Pro": in uscita `exif` è
 * assente e nei byte non c'è più traccia di GPS, Apple, iPhone o Exif.
 */
export async function elabora(buf: Buffer, tipo: 'gallery' | 'avatar'): Promise<Elaborata> {
	const formato = riconosciFormato(buf);
	if (!formato) {
		throw new FotoNonValida('Il file non sembra un’immagine.');
	}
	if (formato === 'heic') {
		// I binari precompilati di sharp non includono il decoder HEIC per ragioni
		// di licenza. In pratica iOS Safari converte in JPEG quando l'input ha
		// accept="image/*", quindi il caso normale non arriva qui; se ci arriva,
		// meglio un messaggio comprensibile che un 500 dal decoder.
		throw new FotoNonValida(
			'Il formato HEIC non è supportato. Sul telefono imposta la fotocamera su “Più compatibile” (JPEG), oppure carica uno screenshot della foto.'
		);
	}
	if (!AMMESSI.includes(formato)) {
		throw new FotoNonValida(`Formato ${formato} non supportato: usa JPEG, PNG o WebP.`);
	}

	const lato = tipo === 'avatar' ? LATO_AVATAR : LATO_FULL;
	const latoThumb = tipo === 'avatar' ? LATO_AVATAR_THUMB : LATO_THUMB;
	const qualita = tipo === 'avatar' ? Q_AVATAR : Q_FULL;

	const base = () =>
		sharp(buf, { limitInputPixels: LIMITE_PIXEL, failOn: 'error' })
			.rotate()
			.resize({ width: lato, height: lato, fit: 'inside', withoutEnlargement: true });

	let full: { data: Buffer; info: OutputInfo };
	try {
		full = await base().webp({ quality: qualita, effort: 4 }).toBuffer({ resolveWithObject: true });
	} catch (err) {
		// Immagine corrotta, troncata o oltre il limite di pixel: è un 400
		// dell'utente, non un guasto del server.
		throw new FotoNonValida(
			err instanceof Error && err.message.includes('pixel limit')
				? 'Immagine troppo grande: oltre 40 milioni di pixel.'
				: 'Immagine illeggibile o danneggiata.'
		);
	}

	const thumb = await sharp(buf, { limitInputPixels: LIMITE_PIXEL, failOn: 'error' })
		.rotate()
		.resize({ width: latoThumb, height: latoThumb, fit: 'inside', withoutEnlargement: true })
		.webp({ quality: Q_THUMB, effort: 4 })
		.toBuffer();

	return {
		full: full.data,
		thumb,
		width: full.info.width,
		height: full.info.height,
		bytesOriginal: buf.length
	};
}
