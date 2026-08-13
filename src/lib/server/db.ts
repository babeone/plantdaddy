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

export const sql: postgres.Sql = (globalForDb.__plantdaddySql ??= createClient());
