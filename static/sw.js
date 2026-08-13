/*
 * Service worker di PlantDaddy: push, click sulla notifica, azioni rapide.
 *
 * È un file statico registrato a mano e NON il service worker nativo di
 * SvelteKit (src/service-worker.ts), che è pensato per il precaching degli
 * asset con `$service-worker`. Qui serve solo la gestione delle push e un
 * handler `fetch` minimo, che è anche uno dei requisiti di installabilità
 * di Chrome: senza un listener `fetch` registrato, beforeinstallprompt non
 * scatta mai.
 *
 * NIENTE CACHE OFFLINE: l'app ha bisogno del database per essere utile, una
 * cache di pagine mostrerebbe solo dati vecchi facendoli passare per attuali.
 */

self.addEventListener('install', () => {
	// Nessun precaching: attiva subito la versione nuova.
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

/**
 * Handler fetch deliberatamente trasparente: passa tutto alla rete.
 * Esiste per soddisfare il criterio di installabilità, non per servire cache.
 */
self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	// Nessun respondWith: il browser procede normalmente. Registrare comunque il
	// listener è ciò che conta per l'installabilità.
});

/**
 * Push in arrivo dal cron.
 * Payload atteso:
 * { title, body, tag?, url?, actions?: [{ action, title, token }] }
 * dove `token` è un ACTION TOKEN monouso, valido solo per quella pianta e
 * quella azione, con scadenza 24 ore. Il token di SESSIONE non entra mai qui:
 * il payload resta memorizzato nell'oggetto notifica sul dispositivo, e una
 * credenziale permanente lì dentro sarebbe un regalo a chi mette le mani sul
 * telefono. Un action token scaduto o già usato non vale nulla.
 */
self.addEventListener('push', (event) => {
	let payload;
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		// Payload non JSON: si mostra comunque una notifica generica, perché una
		// push ricevuta e non mostrata fa revocare il permesso dal browser.
		payload = {};
	}

	const title = payload.title || 'PlantDaddy';
	const actions = Array.isArray(payload.actions) ? payload.actions : [];

	const options = {
		body: payload.body || 'Hai piante da curare.',
		icon: '/icons/icon-192.png',
		badge: '/icons/icon-192.png',
		tag: payload.tag || 'plantdaddy-daily',
		renotify: true,
		lang: 'it',
		data: {
			url: payload.url || '/',
			// I token restano nel data della notifica, non nel testo visibile.
			tokens: Object.fromEntries(actions.map((a) => [a.action, a.token]))
		},
		// Le azioni arrivano solo quando la pianta da curare è una sola: con tre
		// piante "Annaffiata" non saprebbe quale annaffiare.
		// iOS ignora questo campo e apre l'app: degrado accettabile.
		actions: actions.map((a) => ({ action: a.action, title: a.title }))
	};

	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	const action = event.action;
	const data = event.notification.data || {};
	const token = data.tokens ? data.tokens[action] : undefined;

	event.notification.close();

	// Azione rapida: si risolve senza aprire l'app.
	if ((action === 'water' || action === 'snooze') && token) {
		event.waitUntil(
			fetch('/api/quick-action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token, action })
			})
				.then((response) => {
					if (response.ok) return;
					// Token scaduto o già usato: si avvisa invece di fallire in silenzio.
					return self.registration.showNotification('PlantDaddy', {
						body:
							response.status === 410
								? 'Questa azione è già stata usata o è scaduta. Apri l’app.'
								: 'Non è stato possibile registrare l’azione. Apri l’app.',
						icon: '/icons/icon-192.png',
						tag: 'plantdaddy-quick-failed'
					});
				})
				.catch(() =>
					self.registration.showNotification('PlantDaddy', {
						body: 'Nessuna rete: l’azione non è stata registrata.',
						icon: '/icons/icon-192.png',
						tag: 'plantdaddy-quick-failed'
					})
				)
		);
		return;
	}

	// Tap sul corpo della notifica: porta sulla vista di oggi, riusando una
	// finestra già aperta se c'è.
	const target = new URL(data.url || '/', self.location.origin).href;
	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			for (const client of clients) {
				if (client.url.startsWith(self.location.origin) && 'focus' in client) {
					client.navigate?.(target);
					return client.focus();
				}
			}
			return self.clients.openWindow(target);
		})
	);
});
