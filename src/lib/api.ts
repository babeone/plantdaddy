import { session } from './stores/session.svelte';

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
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
	if (session.token) headers.set('X-Session-Token', session.token);
	if (init.body) headers.set('Content-Type', 'application/json');

	const response = await fetch(`/api${path}`, { ...init, headers });

	if (!response.ok) {
		/*
		 * 401 = il server non conosce questo token: sessione cancellata, database
		 * ripristinato, o codice incollato sbagliato. Senza questo la copia locale
		 * resta e ogni vista ritenta all'infinito con errori non gestiti in
		 * console. Svuotando la sessione, la guardia del layout porta al benvenuto.
		 */
		if (response.status === 401 && session.token) session.clear();

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

	/** Risposta grezza, per l'export che deve diventare un file. */
	raw: (path: string) => {
		const headers = new Headers();
		if (session.token) headers.set('X-Session-Token', session.token);
		return fetch(`/api${path}`, { headers });
	}
};
