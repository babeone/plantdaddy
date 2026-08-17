import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { TransactionSql } from 'postgres';

/**
 * I tre freni prima di toccare un'immagine: dimensione, concorrenza, frequenza.
 *
 * L'elaborazione immagini è la cosa più affamata di RAM e CPU di questa
 * applicazione, e gira sulla stessa macchina di Postgres. Nessuno di questi tre
 * controlli è ridondante: fermano tre abusi diversi.
 */

/** 15 MB: una foto da 12 MP sta in 4-6 MB, il resto è margine. */
export const MAX_BYTE = 15 * 1024 * 1024;

/**
 * Rifiuta per dimensione leggendo `content-length`, PRIMA di consumare il corpo.
 *
 * Il punto è proprio questo: `await request.arrayBuffer()` su un corpo da 500 MB
 * lo porta in RAM tutto prima che il codice possa dire di no. L'header può essere
 * mentito, quindi non è l'unica difesa — la seconda è che adapter-node interrompe
 * comunque lo stream oltre BODY_SIZE_LIMIT — ma è quella che dà all'utente un
 * errore chiaro invece di una connessione tagliata.
 */
export function controllaDimensione(request: Request): void {
	const raw = request.headers.get('content-length');
	if (!raw) error(411, 'Content-Length mancante');
	const byte = Number(raw);
	if (!Number.isFinite(byte) || byte <= 0) error(400, 'Content-Length non valido');
	if (byte > MAX_BYTE) {
		error(413, `Foto troppo grande: massimo ${Math.floor(MAX_BYTE / 1024 / 1024)} MB`);
	}
}

/**
 * Legge il corpo come Buffer con un tetto rispettato DURANTE la lettura.
 *
 * Non basta fidarsi di controllaDimensione(): quello legge un header. Qui si conta
 * quanto arriva davvero e si interrompe appena supera, così un client che dichiara
 * 1 MB e ne manda 500 non riesce comunque a far crescere la memoria.
 */
export async function leggiCorpo(request: Request): Promise<Buffer> {
	if (!request.body) error(400, 'Corpo della richiesta vuoto');
	const pezzi: Uint8Array[] = [];
	let totale = 0;
	const reader = request.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		totale += value.length;
		if (totale > MAX_BYTE) {
			await reader.cancel();
			error(413, `Foto troppo grande: massimo ${Math.floor(MAX_BYTE / 1024 / 1024)} MB`);
		}
		pezzi.push(value);
	}
	if (totale === 0) error(400, 'Corpo della richiesta vuoto');
	return Buffer.concat(pezzi);
}

/**
 * Semaforo a UN posto.
 *
 * Un'immagine da 12 MP costa circa 110 MB di picco: due in parallelo sarebbero
 * 220 MB su una macchina da 4 GB che ospita già Postgres, e soprattutto
 * occuperebbero entrambe le vCPU lasciando l'app senza core per servire le pagine.
 *
 * Chi arriva mentre è occupato ASPETTA in coda, fino a ATTESA_MAX. Scaduta,
 * riceve 429: meglio un errore immediato che una richiesta appesa un minuto,
 * perché il browser dell'utente nel frattempo ritenta e peggiora la coda.
 *
 * LIMITE NOTO: la coda vive nel processo, come rate-limit.ts. Con una sola
 * istanza — che è il caso qui — è esatta. Con più repliche diventerebbe "una per
 * replica" e servirebbe un lock su Postgres.
 */
const ATTESA_MAX = 20_000;
const MAX_IN_CODA = 4;

let occupato = false;
const coda: Array<() => void> = [];

function rilascia(): void {
	const prossimo = coda.shift();
	if (prossimo) prossimo();
	else occupato = false;
}

export async function conSemaforo<T>(lavoro: () => Promise<T>): Promise<T> {
	if (occupato) {
		if (coda.length >= MAX_IN_CODA) {
			error(429, 'Troppe foto in elaborazione, riprova tra qualche secondo');
		}
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				const i = coda.indexOf(entra);
				if (i >= 0) coda.splice(i, 1);
				reject(
					error(429, 'Elaborazione occupata, riprova tra qualche secondo') as unknown as Error
				);
			}, ATTESA_MAX);
			const entra = () => {
				clearTimeout(timer);
				resolve();
			};
			coda.push(entra);
		});
	} else {
		occupato = true;
	}

	try {
		return await lavoro();
	} finally {
		// finally e non dopo il return: se l'elaborazione lancia, il posto deve
		// tornare libero comunque, altrimenti il primo errore blocca gli upload
		// per sempre.
		rilascia();
	}
}

/**
 * Limite giornaliero di upload per utente.
 *
 * Gli slot della galleria limitano quante foto sono CONSERVATE insieme, non quante
 * ne vengono caricate: cancellando e ricaricando si può restare per sempre dentro
 * la quota facendo lavorare la macchina a vuoto. Questo limite ferma quel giro.
 *
 * Sta su Postgres e non nella mappa in memoria di rate-limit.ts perché quella si
 * azzera a ogni deploy, e un limite giornaliero che si resetta con un
 * aggiornamento non è un limite giornaliero.
 */
export function maxUploadGiornalieri(): number {
	const parsed = Number(env.PHOTO_UPLOADS_PER_DAY ?? 10);
	if (!Number.isFinite(parsed) || parsed < 1) return 10;
	return Math.trunc(parsed);
}

/**
 * Conta gli upload delle ultime 24 ore e registra questo. Va chiamata DENTRO la
 * transazione dell'upload, così un upload che poi fallisce non lascia consumato un
 * gettone.
 */
export async function consumaGettoneUpload(
	tx: TransactionSql,
	tokenHash: string
): Promise<{ ok: true } | { ok: false; usati: number; limite: number }> {
	const limite = maxUploadGiornalieri();
	const [row] = await tx<{ n: number }[]>`
		select count(*)::int as n
		from photo_uploads
		where user_token_hash = ${tokenHash} and at > now() - interval '24 hours'
	`;
	if (row.n >= limite) return { ok: false, usati: row.n, limite };
	await tx`insert into photo_uploads (user_token_hash) values (${tokenHash})`;
	return { ok: true };
}
