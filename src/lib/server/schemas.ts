import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { emojiAmmessa } from '$lib/emoji';
import { isRealDate } from './date';

/** Quote: allineate ai CHECK e al trigger di rotazione in db/migrations/001_init.sql. */
export const MAX_PLANTS_PER_USER = 100;
export const MAX_PAGE_LIMIT = 100;

const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, 'data nel formato YYYY-MM-DD')
	.refine(isRealDate, 'data inesistente nel calendario');

// Limiti allineati uno a uno ai CHECK del database: se il DB accetta 60
// caratteri, zod non ne fa passare 61 e l'utente riceve un 400 leggibile
// invece di un 500 con un errore Postgres.
const plantFields = {
	name: z.string().trim().min(1, 'nome obbligatorio').max(60),
	// L'emoji è validata contro la whitelist di $lib/emoji, non solo per lunghezza:
	// il campo finisce nel testo della pagina e accettare stringhe arbitrarie di 8
	// caratteri non ha nessun motivo di esistere. La lista è la stessa che alimenta
	// il picker, quindi il client non può offrire qualcosa che il server rifiuta.
	//
	// Vale per le scritture nuove: i valori già presenti in produzione non vengono
	// riscritti da nessuna migrazione (vedi 008).
	emoji: z.string().max(8).refine(emojiAmmessa, 'emoji non ammessa').nullish(),
	location: z.string().trim().max(60).nullish(),
	// La nota della PIANTA (scheda), da non confondere con careCreateSchema.note
	// che è la nota del singolo evento e sta a 280.
	notes: z.string().trim().max(2000).nullish(),
	watering_interval_days: z.number().int().min(1).max(365),
	fertilizing_interval_days: z.number().int().min(1).max(365).nullish()
};

export const plantCreateSchema = z.object(plantFields);

export const plantStateSchema = z.enum(['active', 'archived', 'dead']);

export const plantPatchSchema = z
	.object({
		name: plantFields.name.optional(),
		emoji: plantFields.emoji,
		location: plantFields.location,
		notes: plantFields.notes,
		watering_interval_days: plantFields.watering_interval_days.optional(),
		fertilizing_interval_days: plantFields.fertilizing_interval_days,
		state: plantStateSchema.optional(),
		/** Promemoria foto per questa singola pianta. Il globale sta in /api/settings. */
		photo_reminders: z.boolean().optional()
	})
	.refine((patch) => Object.keys(patch).length > 0, 'nessun campo da aggiornare');

/**
 * Emoji tollerante, SOLO per l'import.
 *
 * L'import legge file che l'utente ha esportato in passato, quando il campo emoji
 * era libero. Applicare la whitelist come nel create farebbe fallire l'intero
 * backup per un'emoji, cioè renderebbe irrecuperabili i dati di chi ha usato
 * l'app prima di questa versione. Un valore fuori lista diventa null: la pianta
 * torna all'emoji di default e tutto il resto si salva.
 */
const emojiImport = z
	.string()
	.max(8)
	.nullish()
	.transform((valore) => (valore && emojiAmmessa(valore) ? valore : null));

export const careTypeSchema = z.enum(['water', 'fertilize']);

export const careCreateSchema = z.object({
	type: careTypeSchema,
	/** Assente = tap immediato, quindi data odierna. Presente = inserimento retroattivo. */
	date: isoDate.optional(),
	note: z.string().trim().max(280).nullish()
});

export const snoozeSchema = z.object({
	type: careTypeSchema,
	days: z.number().int().min(1).max(365).default(1)
});

export const settingsSchema = z
	.object({
		notify_hour: z.number().int().min(0).max(23).optional(),
		winter_mode: z.boolean().optional(),
		winter_multiplier: z.number().min(1).max(3).optional(),
		/** Interruttore GLOBALE dei promemoria foto. Il per-pianta sta in plantPatchSchema. */
		photo_reminders: z.boolean().optional()
	})
	.refine((patch) => Object.keys(patch).length > 0, 'nessun campo da aggiornare');

export const sessionTokenSchema = z.object({
	token: z.string().trim().min(8).max(200)
});

/**
 * Creazione della sessione: il nome è OBBLIGATORIO.
 *
 * È l'unica cosa che l'app chiede prima di generare il token, e serve al
 * proprietario dell'istanza per sapere chi c'è nel pannello di controllo. Le
 * sessioni create prima di questa versione hanno display_name NULL, e la
 * colonna resta nullable per loro: vedi db/migrations/007_nome_utente.sql.
 *
 * .trim() prima di .min(1): senza, una stringa di soli spazi passerebbe la
 * lunghezza minima e finirebbe nel database come nome vuoto.
 */
export const sessionCreateSchema = z.object({
	display_name: z.string().trim().min(1, 'il nome è obbligatorio').max(60)
});

/** Forma esatta di PushSubscription.toJSON() del browser. */
export const pushSubscribeSchema = z.object({
	endpoint: z.string().min(1).max(1000),
	keys: z.object({
		p256dh: z.string().min(1).max(255),
		auth: z.string().min(1).max(255)
	})
});

export const pushUnsubscribeSchema = z.object({
	endpoint: z.string().min(1).max(1000)
});

/** Azione rapida dalla notifica: solo un action token monouso e l'azione. */
export const quickActionSchema = z.object({
	token: z.string().trim().min(8).max(200),
	action: z.enum(['water', 'snooze'])
});

/**
 * Import: le chiavi sconosciute vengono SCARTATE da zod, che è metà della
 * difesa. L'altra metà sta nella route: user_token_hash, id e plant_id non
 * vengono mai usati come valori da scrivere, gli id sono rigenerati dal DB e
 * ogni riga è legata al token della sessione chiamante. plant_id qui serve solo
 * come riferimento locale per ricollegare gli eventi alle piante del file.
 */
export const importSchema = z.object({
	version: z.union([z.number(), z.string()]),
	settings: z
		.object({
			notify_hour: z.number().int().min(0).max(23).optional(),
			winter_mode: z.boolean().optional(),
			winter_multiplier: z.union([z.number(), z.string()]).optional()
		})
		.nullish(),
	plants: z
		.array(
			z.object({
				id: z.string().max(64).nullish(),
				...plantFields,
				// Sovrascrive quella severa di plantFields: vedi emojiImport.
				emoji: emojiImport,
				water_snoozed_until: isoDate.nullish(),
				fertilize_snoozed_until: isoDate.nullish()
			})
		)
		.max(MAX_PLANTS_PER_USER, `massimo ${MAX_PLANTS_PER_USER} piante`),
	care_events: z
		.array(
			z.object({
				plant_id: z.string().max(64),
				type: careTypeSchema,
				event_date: isoDate,
				note: z.string().max(280).nullish()
			})
		)
		.max(50_000, 'troppi eventi in un solo file')
		.default([])
});

/**
 * Legge e valida il body JSON. Un body non parsabile o non conforme diventa un
 * 400 con il campo colpevole, non un 500.
 */
export async function parseBody<T extends z.ZodType>(
	request: Request,
	schema: T
): Promise<z.output<T>> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		error(400, 'Body JSON non valido');
	}

	const result = schema.safeParse(raw);
	if (!result.success) {
		const issue = result.error.issues[0];
		const path = issue.path.join('.');
		error(400, path ? `${path}: ${issue.message}` : issue.message);
	}
	return result.data;
}

/** limit/offset con tetto: senza il cap una sola richiesta legge tutto lo storico. */
export function parsePagination(url: URL): { limit: number; offset: number } {
	const rawLimit = Number(url.searchParams.get('limit') ?? 50);
	const rawOffset = Number(url.searchParams.get('offset') ?? 0);
	const limit = Number.isFinite(rawLimit)
		? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_PAGE_LIMIT)
		: 50;
	const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;
	return { limit, offset };
}
