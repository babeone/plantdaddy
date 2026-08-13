import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),

			/**
			 * CSP stretta.
			 *
			 * Con SvelteKit 2.70 e vite-plugin-svelte 7 non esiste più
			 * svelte.config.js: le opzioni di kit, csp compresa, si passano qui al
			 * plugin, che le separa da quelle di vite-plugin-svelte.
			 *
			 * Perché serve: il token di sessione vive in localStorage, quindi un XSS
			 * equivale a furto dell'account. La CSP è la seconda linea: anche se un
			 * giorno si introducesse un'iniezione, senza `unsafe-inline` lo script
			 * non partirebbe e senza origini esterne non potrebbe esfiltrare nulla.
			 *
			 * mode 'nonce': SvelteKit aggiunge da sé il nonce agli script inline che
			 * genera (i dati di hydration), quindi non serve elencarli.
			 */
			csp: {
				mode: 'nonce',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					/**
					 * Fogli di stile: solo dalla stessa origine. È qui che vive il
					 * rischio vero, perché un <style> iniettato può ridisegnare la
					 * pagina e mascherare una UI falsa.
					 */
					'style-src': ['self'],
					'style-src-elem': ['self'],
					/**
					 * Gli attributi style inline restano permessi per un motivo
					 * concreto: SvelteKit inietta di suo un div announcer per i lettori
					 * di schermo con lo style di clipping inline, e non è configurabile.
					 * Con style-src 'self' secco quel div veniva bloccato e il testo
					 * degli annunci di navigazione diventava visibile a schermo.
					 * Il rischio residuo è minimo: un attributo style non esegue codice,
					 * e ogni URL esterna resta bloccata da default-src/img-src 'self'.
					 */
					'style-src-attr': ['unsafe-inline'],
					'img-src': ['self', 'blob:'],
					// Il QR viene disegnato su canvas e scaricato come blob.
					'font-src': ['self'],
					'connect-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'frame-ancestors': ['none'],
					'form-action': ['self'],
					'worker-src': ['self'],
					'manifest-src': ['self']
				}
			}
		})
	]
});
