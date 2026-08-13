/**
 * Migrazioni versionate: legge db/migrations in ordine alfabetico, salta le
 * versioni già presenti in schema_migrations, esegue le altre una per una
 * dentro una transazione. Postgres ha DDL transazionale, quindi una migrazione
 * che fallisce a metà non lascia lo schema a pezzi.
 *
 *   npm run migrate
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL non impostata. Copia .env.example in .env e compilala.');
	process.exit(1);
}

// max: 1 — le migrazioni sono sequenziali per definizione, un pool non serve.
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
	// Creata qui e non come migrazione 000, altrimenti servirebbe una migrazione
	// per poter tracciare le migrazioni.
	await sql`
		create table if not exists schema_migrations (
			version    text primary key,
			applied_at timestamptz not null default now()
		)
	`;

	const applied = new Set(
		(await sql<{ version: string }[]>`select version from schema_migrations`).map((r) => r.version)
	);
	const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

	let count = 0;
	for (const file of files) {
		const version = file.replace(/\.sql$/, '');
		if (applied.has(version)) continue;

		const body = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
		await sql.begin(async (tx) => {
			// .simple() serve per eseguire più statement in un unico invio.
			await tx.unsafe(body).simple();
			await tx`insert into schema_migrations (version) values (${version})`;
		});
		console.log(`applicata  ${version}`);
		count += 1;
	}

	console.log(
		count > 0
			? `${count} migrazion${count === 1 ? 'e' : 'i'} applicat${count === 1 ? 'a' : 'e'}.`
			: `Schema già aggiornato (${files.length} migrazioni, nessuna nuova).`
	);
} catch (err) {
	console.error('Migrazione interrotta, transazione annullata:');
	console.error(err instanceof Error ? err.message : err);
	process.exitCode = 1;
} finally {
	await sql.end();
}
