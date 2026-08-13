import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { api } from '$lib/api';
import { install } from './install.svelte';

/**
 * La chiave VAPID pubblica arriva da PUBLIC_VAPID_PUBLIC_KEY: in SvelteKit solo
 * le variabili con quel prefisso finiscono nel bundle client, la privata resta
 * sul server.
 */
const VAPID_PUBLIC_KEY = env.PUBLIC_VAPID_PUBLIC_KEY ?? '';

export type PushState =
	| 'unsupported' // niente service worker o niente Push API
	| 'ios-needs-install' // su iOS le push esistono solo dentro la PWA installata
	| 'denied' // permesso negato: solo l'utente può riaprirlo dalle impostazioni del browser
	| 'off' // supportato, permesso non ancora chiesto o subscription assente
	| 'on'; // iscritto

class PushStore {
	state = $state<PushState>('off');
	busy = $state(false);
	error = $state<string | null>(null);
	registration = $state<ServiceWorkerRegistration | null>(null);

	get supported(): boolean {
		return browser && 'serviceWorker' in navigator && 'PushManager' in window;
	}

	/**
	 * Registra il service worker. Il file è statico (static/sw.js) e non quello
	 * generato da SvelteKit, perché qui serve solo push + un handler fetch.
	 */
	async register(): Promise<void> {
		if (!this.supported) {
			this.state = 'unsupported';
			return;
		}
		try {
			const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
			this.registration = registration;
			await this.refresh();
		} catch (err) {
			this.state = 'unsupported';
			this.error = err instanceof Error ? err.message : 'Service worker non registrato';
		}
	}

	async refresh(): Promise<void> {
		if (!this.supported) {
			this.state = 'unsupported';
			return;
		}
		// Su iOS Notification.requestPermission() fuori dalla PWA installata non
		// funziona: meglio dirlo che lasciare un bottone che non fa niente.
		if (install.isIosNotInstalled) {
			this.state = 'ios-needs-install';
			return;
		}
		if (Notification.permission === 'denied') {
			this.state = 'denied';
			return;
		}
		const registration = this.registration ?? (await navigator.serviceWorker.getRegistration('/'));
		const subscription = await registration?.pushManager.getSubscription();
		this.state = subscription ? 'on' : 'off';
	}

	/** Parte SOLO da un tap esplicito in Impostazioni, mai all'avvio. */
	async enable(): Promise<void> {
		this.error = null;
		if (!this.supported) {
			this.state = 'unsupported';
			return;
		}
		if (install.isIosNotInstalled) {
			this.state = 'ios-needs-install';
			return;
		}
		if (!VAPID_PUBLIC_KEY) {
			this.error = 'Chiave VAPID pubblica non configurata sul server';
			return;
		}

		this.busy = true;
		try {
			const permission = await Notification.requestPermission();
			if (permission !== 'granted') {
				this.state = permission === 'denied' ? 'denied' : 'off';
				return;
			}

			const registration =
				this.registration ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
			this.registration = registration;
			await navigator.serviceWorker.ready;

			const subscription = await registration.pushManager.subscribe({
				// Le push silenziose non sono ammesse dai browser: ogni messaggio
				// mostra una notifica.
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
			});

			const json = subscription.toJSON() as {
				endpoint: string;
				keys: { p256dh: string; auth: string };
			};
			await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
			this.state = 'on';
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Attivazione non riuscita';
			await this.refresh();
		} finally {
			this.busy = false;
		}
	}

	async disable(): Promise<void> {
		this.error = null;
		this.busy = true;
		try {
			const registration =
				this.registration ?? (await navigator.serviceWorker.getRegistration('/'));
			const subscription = await registration?.pushManager.getSubscription();
			if (subscription) {
				await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
				await subscription.unsubscribe();
			}
			this.state = 'off';
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Disattivazione non riuscita';
		} finally {
			this.busy = false;
		}
	}
}

/**
 * La chiave VAPID viaggia in base64url; PushManager vuole un Uint8Array di byte
 * grezzi. Senza il ripristino del padding e la sostituzione di - e _ la
 * subscribe fallisce con un errore che non spiega niente.
 */
export function urlBase64ToUint8Array(base64UrlString: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (base64UrlString.length % 4)) % 4);
	const base64 = (base64UrlString + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	// Uint8Array costruito su un ArrayBuffer esplicito: applicationServerKey
	// pretende un BufferSource su ArrayBuffer, non su ArrayBufferLike.
	const output = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
	return output;
}

export const push = new PushStore();
