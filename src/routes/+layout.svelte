<script lang="ts">
	import '../app.css';
	import { goto, onNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { DUR, EASE_OUT, dur, prefersReducedMotion } from '$lib/motion';
	import InstallBanner from '$lib/components/InstallBanner.svelte';
	import InstallGuide from '$lib/components/InstallGuide.svelte';
	import PullToRefresh from '$lib/components/PullToRefresh.svelte';
	import SessionRecovery from '$lib/components/SessionRecovery.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { plants } from '$lib/stores/plants.svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	import { install } from '$lib/stores/install.svelte';
	import { push } from '$lib/stores/push.svelte';
	import { ADMIN_INTERNAL_BASE } from '$lib/admin-path';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	let showGuide = $state(false);

	/**
	 * Il pannello admin è un'altra applicazione dentro la stessa origine: niente
	 * shell #app, niente barra in basso, niente banner di installazione, e
	 * soprattutto nessuno degli effetti di bootstrap qui sotto, che leggono il
	 * token dell'utente.
	 *
	 * Si guarda route.id e non url.pathname: reroute() cambia la rotta scelta ma
	 * lascia intatta l'URL, quindi nella barra degli indirizzi resta /superman
	 * mentre la rotta è /admin. route.id è l'unico dei due che dice la verità.
	 */
	const isAdmin = $derived(page.route.id?.startsWith(ADMIN_INTERNAL_BASE) === true);

	/** Rotte raggiungibili senza sessione. */
	const PUBLIC_ROUTES = ['/benvenuto', '/ripristina'];

	const isPublic = $derived(PUBLIC_ROUTES.includes(page.url.pathname));
	const showNav = $derived(session.isAuthenticated && !isPublic && !isAdmin);

	// Ordine delle tab, usato anche per capire se si sta andando "avanti" o
	// "indietro" e scegliere il verso della transizione di vista.
	const TABS = [
		{ href: '/', label: 'Home' },
		{ href: '/piante', label: 'Piante' },
		{ href: '/impostazioni', label: 'Impostazioni' }
	];

	$effect(() => {
		if (isAdmin) return;
		session.load();
		install.init();
		// Il service worker si registra subito: serve alle push, e un handler
		// fetch registrato è uno dei requisiti perché Chrome consideri l'app
		// installabile. Il PERMESSO delle notifiche invece non viene mai chiesto
		// qui: parte solo dal bottone in Impostazioni.
		void push.register();
		// Il token viene confermato col server PRIMA di qualunque richiesta
		// autenticata: così un 401 non può più nascere da una richiesta partita
		// troppo presto, e resta un segnale univoco di sessione rifiutata.
		void session.verify();
	});

	// Guardia: senza token si finisce sulla schermata di benvenuto.
	$effect(() => {
		if (isAdmin || !session.ready) return;
		if (!session.isAuthenticated && !isPublic) {
			void goto(resolve('/benvenuto'), { replaceState: true });
		}
	});

	// Primo caricamento dati solo a sessione confermata.
	$effect(() => {
		if (session.verified && !plants.loaded && !plants.loading) {
			void plants.load();
			void plants.loadSettings();
			// Cookie di sola lettura per le immagini: un <img> non può mandare
			// l'header, quindi senza questo le foto restano rotte.
			void session.enablePhotos();
		}
	});

	/** Trascinamento dall'alto: rilegge i dati senza far ripartire l'app. */
	async function refreshData() {
		if (!session.verified) return;
		await plants.load();
		await plants.loadSettings();
	}

	/**
	 * Transizione tra viste con la View Transitions API.
	 * La guardia serve per Firefox e Safari più vecchi: dove non esiste,
	 * la navigazione avviene senza animazione, senza errori e senza polyfill.
	 */
	onNavigate((navigation) => {
		if (!document.startViewTransition || prefersReducedMotion()) return;

		const fromIndex = TABS.findIndex((tab) => tab.href === navigation.from?.url.pathname);
		const toIndex = TABS.findIndex((tab) => tab.href === navigation.to?.url.pathname);
		const goingBack =
			(fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex) ||
			navigation.to?.url.pathname === '/piante';
		document.documentElement.dataset.nav = goingBack ? 'back' : 'fwd';

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	const activeHref = $derived(
		page.url.pathname.startsWith('/piante')
			? '/piante'
			: page.url.pathname.startsWith('/impostazioni')
				? '/impostazioni'
				: '/'
	);
</script>

{#if isAdmin}
	{@render children()}
{:else}
	<div id="app">
		{@render children()}

		{#if showNav}
			<nav class="tabbar" aria-label="Navigazione principale">
				<a href={resolve('/')} aria-current={activeHref === '/' ? 'page' : undefined}>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path
							d="M3 12l2-2m0 0 7-7 7 7M5 10v10a1 1 0 0 0 1 1h3m10-11 2 2m-2-2v10a1 1 0 0 1-1 1h-3m-6 0a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1m-6 0h6"
						/>
					</svg>
					<span>Home</span>
					<i class="dot"></i>
				</a>
				<a href={resolve('/piante')} aria-current={activeHref === '/piante' ? 'page' : undefined}>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M12 21v-8m0 0c0-4 3-7 7-7 0 4-3 7-7 7Zm0 0c0-3.5-2.5-6-6-6 0 3.5 2.5 6 6 6Z" />
					</svg>
					<span>Piante</span>
					<i class="dot"></i>
				</a>
				<a
					href={resolve('/impostazioni')}
					aria-current={activeHref === '/impostazioni' ? 'page' : undefined}
				>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="12" cy="12" r="3" />
						<path
							d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4 13.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z"
						/>
					</svg>
					<span>Impostazioni</span>
					<i class="dot"></i>
				</a>
			</nav>
		{/if}
	</div>
{/if}

<!-- Con la sessione rifiutata l'utente ha un solo problema da risolvere:
     banner di installazione e trascina-per-aggiornare sarebbero rumore. -->
{#if showNav && !session.rejected}
	<InstallBanner onguide={() => (showGuide = true)} />
	<PullToRefresh onrefresh={refreshData} />
{/if}

{#if showGuide}
	<InstallGuide onclose={() => (showGuide = false)} />
{/if}

{#if session.rejected && !isAdmin}
	<SessionRecovery />
{/if}

<div id="toast-layer">
	{#each toasts.items as toast (toast.id)}
		<div
			class="toast"
			class:error={toast.kind === 'error'}
			role="status"
			transition:fly={{ y: 18, duration: dur(DUR.mid), easing: EASE_OUT }}
		>
			{toast.message}
		</div>
	{/each}
</div>

<style>
	#toast-layer {
		position: fixed;
		left: 50%;
		bottom: calc(90px + var(--safe-b));
		z-index: 60;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 8px;
		align-items: center;
		pointer-events: none;
		width: min(430px, 100%);
		padding: 0 20px;
	}
	.toast.error {
		background: var(--late);
		color: #fff;
	}
</style>
