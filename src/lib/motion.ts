import { cubicOut, cubicIn } from 'svelte/easing';

/**
 * Unico posto dove vivono le durate del movimento.
 *
 * I valori sono gli stessi delle CSS variables in app.css (--dur-fast,
 * --dur-mid, --dur-slow): quelli servono alle transizioni CSS, questi alle
 * transizioni Svelte, che sono JavaScript e non possono leggere una variabile
 * CSS senza un getComputedStyle a ogni animazione.
 *
 * Se cambi il ritmo, vanno cambiati in due punti: qui e in :root.
 */
export const DUR = {
	fast: 130, // micro-interazioni: tap, toggle, badge
	mid: 220, // bottom sheet, card, transizioni di vista
	slow: 300 // entrate complesse, mai oltre 400ms
} as const;

/** Ritardo tra una card e la successiva nell'entrata in cascata. */
export const STAGGER = 38;

/** Le due curve riusate in tutta l'app, gemelle di --ease-out e --ease-in. */
export const EASE_OUT = cubicOut;
export const EASE_IN = cubicIn;

/**
 * prefers-reduced-motion letto UNA volta qui, non in ogni componente.
 * Chi soffre di motion sickness deve poter usare l'app: quando è attivo tutte
 * le durate diventano 0 e le transizioni degenerano in un cambio istantaneo.
 */
export function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Durata effettiva: 0 se l'utente ha chiesto meno movimento. */
export function dur(ms: number): number {
	return prefersReducedMotion() ? 0 : ms;
}

/** Delay dello stagger per l'elemento in posizione `index`. */
export function staggerDelay(index: number, cap = 10): number {
	if (prefersReducedMotion()) return 0;
	return Math.min(index, cap) * STAGGER;
}
