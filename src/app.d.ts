// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			/**
			 * SHA-256 esadecimale del token letto dall'header X-Session-Token,
			 * calcolato una sola volta in hooks.server.ts. null se l'header manca.
			 * Non è la prova che la sessione esista: quella la dà requireUser().
			 */
			userTokenHash: string | null;
		}
	}
}

export {};
