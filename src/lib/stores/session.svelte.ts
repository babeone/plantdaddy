import { browser } from '$app/environment';

const STORAGE_KEY = 'plantdaddy.token';
const COOKIE_NAME = 'pd_token';
const COOKIE_DAYS = 400; // massimo che i browser accettano per un cookie

/**
 * Sessione senza account.
 *
 * PERSISTENZA A DUE VIE: il token sta sia in localStorage sia in un cookie.
 * Safari può evictare lo storage di un sito dopo settimane di inattività e su
 * Android un "cancella dati" azzera tutto: se sopravvive uno dei due, la
 * sessione si recupera. La lettura prova localStorage e ricade sul cookie,
 * riallineando quello che manca.
 *
 * IL COOKIE NON È UNA CREDENZIALE: è solo storage che questo JavaScript
 * rilegge. Il server autentica esclusivamente dall'header X-Session-Token
 * (vedi hooks.server.ts). Per questo è volutamente NON HttpOnly — deve essere
 * leggibile dal JS — e per questo il server non deve mai fidarsene: se lo
 * facesse, il browser lo allegherebbe da solo a richieste partite da siti
 * terzi e ogni endpoint diventerebbe attaccabile via CSRF.
 */
class SessionStore {
	token = $state<string | null>(null);
	storagePersisted = $state<boolean | null>(null); // null = non ancora verificato
	ready = $state(false);

	/**
	 * Il server ha risposto che questo token non esiste.
	 *
	 * NON cancella niente: il token resta in localStorage e nel cookie, e l'app
	 * mostra una schermata di recupero. Senza account quel token è l'unica chiave
	 * dei dati, e un 401 può arrivare anche per motivi transitori — un proxy che
	 * perde l'header, un database ripristinato, una richiesta partita troppo
	 * presto. Buttarlo via da soli renderebbe i dati irraggiungibili per sempre.
	 */
	rejected = $state(false);

	/** Verificato col server almeno una volta in questa sessione di pagina. */
	verified = $state(false);

	private loaded = false;

	get isAuthenticated(): boolean {
		return this.token !== null;
	}

	/** Da chiamare all'avvio, lato client. Idempotente. */
	load(): void {
		if (!browser || this.loaded) return;
		this.loaded = true;

		const fromLocal = safeLocalGet();
		const fromCookie = readCookie(COOKIE_NAME);
		const token = fromLocal ?? fromCookie;

		if (token) {
			// Riallinea la copia mancante: la prossima eviction non deve azzerare tutto.
			if (!fromLocal) safeLocalSet(token);
			if (!fromCookie) writeCookie(COOKIE_NAME, token, COOKIE_DAYS);
			this.token = token;
		}

		this.ready = true;
		void this.refreshPersistedFlag();
	}

	/**
	 * Chiede al server se il token è ancora valido, una volta sola all'avvio.
	 *
	 * Serve a togliere di mezzo una dipendenza implicita: senza questo, la prima
	 * richiesta autenticata poteva partire prima che la sessione fosse letta
	 * dallo storage, e il 401 che ne seguiva era indistinguibile da un rifiuto
	 * vero. Qui invece nessuna richiesta autenticata parte prima della conferma.
	 */
	async verify(): Promise<boolean> {
		if (!browser || !this.token) return false;
		try {
			const response = await fetch('/api/session/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: this.token })
			});
			if (!response.ok) return this.verified; // problema di rete: non cambia nulla
			const data = (await response.json()) as { valid: boolean };
			this.verified = data.valid;
			this.rejected = !data.valid;
			return data.valid;
		} catch {
			// Offline o server irraggiungibile: non è un rifiuto della sessione.
			return this.verified;
		}
	}

	markRejected(): void {
		this.rejected = true;
		this.verified = false;
	}

	clearRejected(): void {
		this.rejected = false;
	}

	/** Salva il token nelle due sedi e chiede al browser storage persistente. */
	async adopt(token: string): Promise<void> {
		this.token = token;
		this.rejected = false;
		this.verified = true; // adottato dopo una verifica o una creazione riuscita
		safeLocalSet(token);
		writeCookie(COOKIE_NAME, token, COOKIE_DAYS);
		await this.requestPersistence();
	}

	/**
	 * Cancella davvero la sessione dal dispositivo.
	 *
	 * Da invocare SOLO su gesto esplicito dell'utente (ripristino con un altro
	 * codice). Nessuna risposta del server deve poter arrivare qui da sola.
	 */
	clear(): void {
		this.token = null;
		this.rejected = false;
		this.verified = false;
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			// storage negato: resta il cookie, che cancelliamo qui sotto
		}
		writeCookie(COOKIE_NAME, '', -1);
	}

	/**
	 * navigator.storage.persist() chiede di NON evictare i dati del sito.
	 * Va chiamata dopo un gesto dell'utente (creazione o ripristino sessione),
	 * altrimenti i browser la rifiutano. Se resta negata, l'app lo dice e
	 * insiste sul backup: è l'unica rete di sicurezza che rimane.
	 */
	async requestPersistence(): Promise<boolean> {
		if (!browser || !navigator.storage?.persist) {
			this.storagePersisted = null;
			return false;
		}
		try {
			const granted = await navigator.storage.persist();
			this.storagePersisted = granted;
			return granted;
		} catch {
			this.storagePersisted = null;
			return false;
		}
	}

	async refreshPersistedFlag(): Promise<void> {
		if (!browser || !navigator.storage?.persisted) {
			this.storagePersisted = null;
			return;
		}
		try {
			this.storagePersisted = await navigator.storage.persisted();
		} catch {
			this.storagePersisted = null;
		}
	}
}

function safeLocalGet(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		// Safari in navigazione privata può lanciare: il cookie fa da riserva.
		return null;
	}
}

function safeLocalSet(value: string): void {
	try {
		localStorage.setItem(STORAGE_KEY, value);
	} catch {
		// ignorato di proposito: il cookie resta
	}
}

function readCookie(name: string): string | null {
	const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
	return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, days: number): void {
	const maxAge = days * 24 * 60 * 60;
	// Secure viene omesso su http://localhost, altrimenti il browser scarta il
	// cookie in sviluppo. In produzione (https) è sempre presente.
	const secure = location.protocol === 'https:' ? '; Secure' : '';
	// SameSite=Lax e non Strict: con Strict il cookie non viene inviato quando
	// si apre l'app da un link esterno, e al primo avvio da lì sembrerebbe una
	// sessione persa. Non è una credenziale, quindi Lax non apre buchi CSRF.
	document.cookie =
		`${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax` + secure;
}

export const session = new SessionStore();
