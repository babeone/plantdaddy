/**
 * Crea l'hash di una password admin, e opzionalmente inserisce l'amministratore.
 *
 *   npm run admin:hash                # stampa hash e INSERT da incollare
 *   npm run admin:hash -- --insert    # scrive direttamente sul database
 *
 * La password NON compare a schermo mentre la digiti e non finisce negli
 * argomenti del comando: un argomento sarebbe visibile a chiunque lanci `ps` e
 * resterebbe nella cronologia della shell per sempre.
 *
 * Gira anche dentro il container, la cartella scripts/ è nell'immagine:
 *   docker exec -it <container> npm run admin:hash -- --insert
 *
 * Legge process.env e non $env/dynamic/private come il resto del progetto:
 * qui non c'è SvelteKit, è un normale processo Node, esattamente come
 * scripts/migrate.ts.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import postgres from 'postgres';
import {
	hashPassword,
	MIN_PASSWORD_LENGTH,
	passwordProblem
} from '../src/lib/server/admin/password.ts';

const doInsert = process.argv.includes('--insert');

/**
 * Due modi di leggere, scelti in base a com'è collegato lo standard input.
 *
 * Su terminale (il caso normale, `docker exec -it` compreso) si usa readline con
 * l'eco spenta, così la password non resta visibile sullo schermo né nello
 * scrollback. Con l'input rediretto da una pipe o da un file l'eco non esiste e
 * readline non sa gestire uno stream già chiuso: si legge tutto in una volta e si
 * consumano le righe. Senza questa seconda strada il comando resta appeso per
 * sempre invece di dire cosa non va.
 */
const interactive = Boolean(stdin.isTTY);
const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;

let piped: string[] = [];
if (!interactive) {
	const chunks: Buffer[] = [];
	for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
	piped = Buffer.concat(chunks).toString('utf8').split('\n');
}

async function ask(question: string, hidden: boolean): Promise<string> {
	if (!rl) {
		const line = piped.shift();
		if (line === undefined) {
			console.error(`\nInput esaurito mentre chiedevo: ${question.trim()}`);
			process.exit(1);
		}
		return line.replace(/\r$/, '');
	}

	const onData = (chunk: Buffer | string) => {
		// L'invio deve comunque andare a capo, altrimenti la domanda successiva
		// viene stampata sopra a quella appena risposta.
		if (String(chunk).includes('\n')) stdout.write('\n');
	};

	if (hidden) {
		// @ts-expect-error _writeToOutput non è nei tipi ma è il punto di aggancio
		// con cui si silenzia readline: sostituendolo, i caratteri digitati non
		// vengono più ricopiati a schermo.
		rl._writeToOutput = () => {};
		stdin.on('data', onData);
	}
	try {
		return await rl.question(question);
	} finally {
		if (hidden) {
			// Ripristinato SEMPRE, anche se qualcosa va storto: lasciare un
			// terminale muto sarebbe una pessima eredità.
			// @ts-expect-error si rimette il comportamento originale.
			rl._writeToOutput = (text: string) => stdout.write(text);
			stdin.off('data', onData);
		}
	}
}

try {
	const email = (await ask('Email amministratore: ', false)).trim();
	if (!email.includes('@') || email.length < 3 || email.length > 254) {
		console.error('Email non valida.');
		process.exit(1);
	}

	const password = await ask(`Password (almeno ${MIN_PASSWORD_LENGTH} caratteri): `, true);
	const problem = passwordProblem(password);
	if (problem) {
		console.error(problem);
		process.exit(1);
	}

	const again = await ask('Ripeti la password: ', true);
	if (again !== password) {
		console.error('Le due password non coincidono.');
		process.exit(1);
	}

	const hash = await hashPassword(password);

	if (!doInsert) {
		console.log('\nHash scrypt:\n');
		console.log(hash);
		console.log('\nINSERT da eseguire (TablePlus, psql, quello che preferisci):\n');
		// Gli apici singoli nell'email vengono raddoppiati: è l'unico modo in cui
		// una stringa può rompere questa SQL, e succede con cognomi come O'Brien.
		console.log(
			`insert into admins (email, password_hash)\nvalues ('${email.replace(/'/g, "''")}', '${hash}');`
		);
		console.log(
			'\nIl secondo fattore non si imposta qui: viene chiesto al primo accesso al pannello.'
		);
	} else {
		const url = process.env.DATABASE_URL;
		if (!url) {
			console.error('DATABASE_URL non impostata: senza non posso scrivere sul database.');
			process.exit(1);
		}
		const sql = postgres(url, { max: 1, onnotice: () => {} });
		try {
			// Parametrizzata, non concatenata: vale anche per uno script locale.
			await sql`insert into admins (email, password_hash) values (${email}, ${hash})`;
			console.log(`\nAmministratore ${email} creato.`);
			console.log('Il secondo fattore viene chiesto al primo accesso al pannello.');
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(
				message.includes('admins_email_key')
					? `Esiste già un amministratore con l'email ${email}.`
					: message
			);
			process.exitCode = 1;
		} finally {
			await sql.end();
		}
	}
} finally {
	rl?.close();
}
