import { env } from '$env/dynamic/private';
import postgres from 'postgres';

/**
 * Client Postgres condiviso.
 *
 * Sta sotto src/lib/server/ perché SvelteKit vieta a compile-time di importare
 * questa cartella da codice client: la stringa di connessione non può finire
 * in un bundle del browser nemmeno per sbaglio.
 *
 * Il pool è agganciato a globalThis: in dev Vite ri-esegue il modulo a ogni
 * hot reload e senza questa cache ogni salvataggio aprirebbe un pool nuovo,
 * fino a esaurire le connessioni di Postgres.
 */
const globalForDb = globalThis as unknown as { __plantdaddySql?: postgres.Sql };

function createClient(): postgres.Sql {
	if (!env.DATABASE_URL) {
		throw new Error('DATABASE_URL non impostata: copia .env.example in .env');
	}
	return postgres(env.DATABASE_URL, {
		max: 10,
		idle_timeout: 30,
		connect_timeout: 10,
		// undefined nei parametri diventa NULL invece di far esplodere la query.
		transform: { undefined: null }
	});
}

function client(): postgres.Sql {
	return (globalForDb.__plantdaddySql ??= createClient());
}

/**
 * Il client nasce alla PRIMA query, non all'import del modulo.
 *
 * Motivo concreto, non teorico: `vite build` esegue un passo di analisi che
 * IMPORTA i moduli server per leggere le opzioni esportate dalle route. In quel
 * momento DATABASE_URL non esiste — le variabili di runtime non sono quelle di
 * build — e creare (o validare) la connessione a livello di modulo faceva
 * fallire il build in produzione con "DATABASE_URL non impostata", mentre in
 * locale passava soltanto perché Vite carica il file .env.
 *
 * Il Proxy tiene la stessa forma di `sql`: si usa come tagged template
 * (sql`select 1`), come funzione (sql(oggetto) negli INSERT) e con i suoi
 * metodi (sql.begin, sql.unsafe), senza toccare nessuna delle route.
 */
export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
	apply(_target, _thisArg, args: unknown[]) {
		const instance = client() as unknown as (...params: unknown[]) => unknown;
		return instance(...args);
	},
	get(_target, property: string | symbol) {
		const instance = client();
		const value = instance[property as keyof postgres.Sql];
		if (typeof value !== 'function') return value;
		// Il cast serve perché TypeScript non riesce a scegliere fra gli overload
		// di Function.bind sull'unione dei metodi di postgres.Sql.
		return (value as (...params: unknown[]) => unknown).bind(instance);
	}
}) as postgres.Sql;
