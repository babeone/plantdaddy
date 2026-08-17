import { session } from './stores/session.svelte';

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/**
 * Un 401 NON cancella mai la sessione.
 *
 * Il server distingue due casi che al client arrivano identici: "header
 * mancante" (la richiesta è partita senza token, quindi è un problema di ordine
 * nostro) e "sessione non valida" (il token c'è ma il server non lo conosce).
 * Solo il secondo è un rifiuto, e anche allora ci si limita a marcare la
 * sessione: il token resta nello storage e l'utente decide cosa farne.
 * Cancellarlo da soli, senza account, significa rendere i dati irraggiungibili.
 */
function handleUnauthorized(status: number, sentToken: string | null): void {
	if (status !== 401) return;
	if (sentToken && sentToken === session.token) session.markRejected();
}

/**
 * Unico punto da cui passano le chiamate al backend.
 *
 * Il token va SEMPRE nell'header X-Session-Token, mai in query string: una URL
 * finisce nei log del reverse proxy, nella cronologia e nel Referer. È anche la
 * ragione per cui l'app è immune a CSRF: un sito terzo non può impostare un
 * header custom cross-origin senza superare un preflight che non esiste.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	// Catturato PRIMA della fetch: dopo l'await `session.token` potrebbe essere
	// cambiato, e confrontare quello sbagliato è ciò che faceva cancellare
	// sessioni valide.
	const sentToken = session.token;
	if (sentToken) headers.set('X-Session-Token', sentToken);
	// Solo se il chiamante non l'ha già deciso: gli upload passano il tipo del file.
	if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

	const response = await fetch(`/api${path}`, { ...init, headers });

	if (!response.ok) {
		handleUnauthorized(response.status, sentToken);

		let message = `Errore ${response.status}`;
		try {
			const body = await response.json();
			if (typeof body?.message === 'string') message = body.message;
		} catch {
			// risposta senza corpo JSON (es. 503 dell'health): resta il messaggio generico
		}
		throw new ApiError(response.status, message);
	}

	if (response.status === 204) return undefined as T;
	return response.json() as Promise<T>;
}

export const api = {
	get: <T>(path: string) => request<T>(path),
	post: <T>(path: string, body?: unknown) =>
		request<T>(path, {
			method: 'POST',
			body: body === undefined ? undefined : JSON.stringify(body)
		}),
	patch: <T>(path: string, body: unknown) =>
		request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
	del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

	/**
	 * Carica un file come corpo GREZZO, non come multipart.
	 *
	 * C'è un solo file e nessun altro campo, quindi il multipart aggiungerebbe un
	 * livello di parsing sul server senza portare niente. `request` mette
	 * Content-Type: application/json quando trova un body, e qui non va bene:
	 * si passa il tipo del file, che il server usa solo per i log — il formato
	 * vero lo decide dai magic bytes.
	 */
	upload: <T>(path: string, file: File) =>
		request<T>(path, {
			method: 'POST',
			body: file,
			headers: { 'Content-Type': file.type || 'application/octet-stream' }
		}),

	/** Risposta grezza, per l'export che deve diventare un file. */
	raw: async (path: string) => {
		const headers = new Headers();
		const sentToken = session.token;
		if (sentToken) headers.set('X-Session-Token', sentToken);
		const response = await fetch(`/api${path}`, { headers });
		// Stessa regola delle altre chiamate: prima qui il 401 passava inosservato.
		handleUnauthorized(response.status, sentToken);
		return response;
	}
};
