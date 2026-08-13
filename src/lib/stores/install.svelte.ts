import { browser } from '$app/environment';

const DISMISSED_KEY = 'plantdaddy.installDismissed';

/** Come si installa l'app su questo browser. */
export type InstallRoute =
	| 'prompt' // beforeinstallprompt disponibile: un tap e parte il dialogo nativo
	| 'ios-safari' // Condividi -> Aggiungi a Home
	| 'ios-other' // su iOS solo Safari installa: va riaperta lì
	| 'android-manual' // menu del browser -> Installa app
	| 'chromium-manual' // Chrome/Edge desktop: icona nella barra o menu
	| 'firefox-desktop' // non supporta l'installazione
	| 'unsupported'; // nessuna via nota

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * Nessun browser installa una PWA senza un gesto dell'utente: "automatico" qui
 * significa un tap dove esiste l'API, e istruzioni giuste dove non esiste.
 * Su iOS l'API non esiste affatto, e solo Safari può aggiungere alla Home.
 */
class InstallStore {
	/** Già in esecuzione come app installata. */
	installed = $state(false);
	/** beforeinstallprompt catturato: si può aprire il dialogo nativo. */
	canPrompt = $state(false);
	/** L'utente ha chiuso il banner: la scelta sopravvive ai riavvii. */
	dismissed = $state(false);
	/** Esito dell'ultimo prompt nativo, per l'interfaccia. */
	lastOutcome = $state<'accepted' | 'dismissed' | null>(null);

	route = $state<InstallRoute>('unsupported');

	private deferred: BeforeInstallPromptEvent | null = null;
	private started = false;

	/** Il banner si mostra solo se serve davvero. */
	get shouldShowBanner(): boolean {
		return !this.installed && !this.dismissed;
	}

	/** iOS senza PWA installata: le push non sono possibili, va detto. */
	get isIosNotInstalled(): boolean {
		return isIos() && !this.installed;
	}

	init(): void {
		if (!browser || this.started) return;
		this.started = true;

		this.installed = isStandalone();
		this.dismissed = localStorage.getItem(DISMISSED_KEY) === '1';
		this.route = detectRoute();

		// preventDefault() impedisce al browser di mostrare la sua mini-infobar:
		// il prompt lo apriamo noi, dal bottone, quando l'utente lo chiede.
		window.addEventListener('beforeinstallprompt', (event) => {
			event.preventDefault();
			this.deferred = event as BeforeInstallPromptEvent;
			this.canPrompt = true;
			this.route = 'prompt';
		});

		// Chiude il banner nell'istante in cui l'installazione avviene, senza
		// aspettare un cambio di display-mode che in alcuni browser non arriva.
		window.addEventListener('appinstalled', () => {
			this.installed = true;
			this.canPrompt = false;
			this.deferred = null;
		});

		// Se l'app viene aperta dalla home screen mentre la scheda è già viva.
		window.matchMedia('(display-mode: standalone)').addEventListener('change', (event) => {
			if (event.matches) this.installed = true;
		});

		// beforeinstallprompt, quando arriva, arriva subito: dopo qualche secondo
		// si smette di aspettarlo e si ricade sul tutorial della piattaforma.
		setTimeout(() => {
			if (!this.canPrompt && this.route === 'unsupported') this.route = detectRoute();
		}, 3000);
	}

	async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
		if (!this.deferred) return 'unavailable';
		await this.deferred.prompt();
		const { outcome } = await this.deferred.userChoice;
		this.lastOutcome = outcome;
		// L'evento è consumabile una sola volta: il browser ne manderà un altro
		// se l'installazione non è avvenuta.
		this.deferred = null;
		this.canPrompt = false;
		return outcome;
	}

	dismiss(): void {
		this.dismissed = true;
		try {
			localStorage.setItem(DISMISSED_KEY, '1');
		} catch {
			// storage negato: il banner ricomparirà, meglio che perdere la sessione
		}
	}

	/** La voce in Impostazioni riapre il banner. */
	reopen(): void {
		this.dismissed = false;
		try {
			localStorage.removeItem(DISMISSED_KEY);
		} catch {
			// niente da fare
		}
	}
}

function isStandalone(): boolean {
	if (!browser) return false;
	return (
		window.matchMedia('(display-mode: standalone)').matches ||
		// iOS non implementa display-mode: standalone in modo affidabile e usa
		// questa proprietà non standard su Safari.
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

function isIos(): boolean {
	if (!browser) return false;
	const ua = navigator.userAgent;
	return (
		/iPad|iPhone|iPod/.test(ua) ||
		// iPadOS 13+ si presenta come Mac: lo si distingue dal touch.
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);
}

/**
 * Rilevamento da user agent. È una euristica, ma qui serve solo a scegliere
 * quale tutorial mostrare: sbagliarlo mostra istruzioni inutili, non rompe nulla.
 */
function detectRoute(): InstallRoute {
	if (!browser) return 'unsupported';
	const ua = navigator.userAgent;

	if (isIos()) {
		// Su iOS ogni browser usa WebKit, ma solo Safari ha "Aggiungi a Home".
		const isRealSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/.test(ua);
		return isRealSafari ? 'ios-safari' : 'ios-other';
	}

	if (/Firefox/.test(ua)) return 'firefox-desktop';
	if (/Android/.test(ua)) return 'android-manual';
	// Chrome ed Edge desktop installano, ma se beforeinstallprompt non arriva
	// (già installata, profilo senza permessi, o evento già consumato) la via
	// resta l'icona nella barra degli indirizzi: dire "non supportato" sarebbe
	// falso e lascerebbe l'utente senza strada.
	if (/Chrome|Chromium|Edg/.test(ua)) return 'chromium-manual';
	return 'unsupported';
}

export const install = new InstallStore();
