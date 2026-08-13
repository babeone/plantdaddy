<script lang="ts">
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { DUR, EASE_OUT, dur, staggerDelay } from '$lib/motion';
	import { formatRelative, formatShort } from '$lib/date';
	import type { CareEvent } from '$lib/types';

	let { events, ondelete }: { events: CareEvent[]; ondelete: (event: CareEvent) => void } =
		$props();

	/**
	 * Long-press per eliminare: su mobile è il gesto che non si innesca per
	 * sbaglio scorrendo la lista. Il bottone resta comunque raggiungibile con un
	 * tap normale, perché un long-press non è annunciato da nessun lettore di
	 * schermo.
	 */
	let pressing = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function startPress(event: CareEvent) {
		pressing = event.id;
		timer = setTimeout(() => {
			pressing = null;
			ondelete(event);
		}, 550);
	}

	function cancelPress() {
		if (timer) clearTimeout(timer);
		timer = null;
		pressing = null;
	}
</script>

<div class="tl-scroll">
	<div class="timeline">
		{#each events as event, index (event.id)}
			<div
				class="tl-item"
				class:pressing={pressing === event.id}
				animate:flip={{ duration: dur(DUR.mid) }}
				in:fly={{ x: -10, duration: dur(DUR.mid), delay: staggerDelay(index, 8), easing: EASE_OUT }}
				out:fly={{ y: -8, duration: dur(DUR.fast), easing: EASE_OUT }}
			>
				<span class="tl-dot {event.type === 'water' ? 'water' : 'fert'}"></span>
				<div class="txt">
					<b>{event.type === 'water' ? '💧 Annaffiata' : '🌾 Concimata'}</b>
					<!-- Testo semplice: la nota è contenuto dell'utente e Svelte la
					     escapa. Nessun {@html} da nessuna parte nell'app. -->
					<small>
						{formatShort(event.event_date)} · {formatRelative(event.event_date)}{event.note
							? ` · ${event.note}`
							: ''}
					</small>
				</div>
				<button
					class="tl-del"
					aria-label="Elimina evento del {formatShort(event.event_date)}"
					onclick={() => ondelete(event)}
					onpointerdown={() => startPress(event)}
					onpointerup={cancelPress}
					onpointerleave={cancelPress}
					oncontextmenu={(e) => e.preventDefault()}
				>
					<svg viewBox="0 0 24 24" width="17" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
					</svg>
				</button>
			</div>
		{/each}
	</div>
</div>

<style>
	/* Lo storico scrolla dentro di sé: con 300 eventi il resto della pagina
	   (statistiche, elimina pianta) resta raggiungibile con un dito.
	   Lo scroll sta sul WRAPPER, non su .timeline: la linea verticale è un
	   ::before con top/bottom e in un contenitore scrollabile si fermerebbe
	   all'altezza visibile invece di seguire tutti gli eventi. */
	.tl-scroll {
		max-height: 340px;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		margin: 0 -2px;
		padding: 0 2px;
	}
	.timeline {
		position: relative;
		padding-left: 26px;
		margin-top: 6px;
	}
	.timeline::before {
		content: '';
		position: absolute;
		left: 8px;
		top: 6px;
		bottom: 6px;
		width: 2px;
		background: var(--line);
		border-radius: 1px;
	}
	.tl-item {
		position: relative;
		padding: 10px 0;
		display: flex;
		align-items: center;
		gap: 10px;
		transition: transform var(--dur-fast) var(--ease-out);
	}
	/* Il long-press si vede: la riga rientra mentre il dito è premuto. */
	.tl-item.pressing {
		transform: scale(0.97);
	}
	.tl-dot {
		position: absolute;
		left: -22px;
		top: 16px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid var(--surface);
	}
	.tl-dot.water {
		background: var(--water);
	}
	.tl-dot.fert {
		background: var(--fert);
	}
	.txt {
		flex: 1;
	}
	.txt b {
		font-size: 14.5px;
		font-weight: 650;
	}
	.txt small {
		display: block;
		color: var(--text-mute);
		font-size: 12.5px;
	}
	.tl-del {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: var(--text-mute);
		flex: none;
		transition: transform var(--dur-fast) var(--ease-out);
	}
	.tl-del:active {
		transform: scale(0.85);
	}
</style>
