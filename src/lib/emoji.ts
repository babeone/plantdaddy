/**
 * Emoji ammesse come avatar di una pianta.
 *
 * Sta fuori da $lib/server perché serve a due posti: al picker nel form (client) e
 * alla validazione nell'API (server). Una lista sola, quindi non possono divergere
 * — un picker che offre un'emoji rifiutata dal server è il tipo di bug che si
 * scopre dall'utente.
 *
 * La validazione lato server contro questa lista è il punto: senza, il campo
 * accetta qualunque stringa di 8 caratteri, e il posto dove finisce è un attributo
 * di testo dentro la pagina di tutti.
 *
 * IMPORTANTE PER I DATI ESISTENTI: la lista vale per le scritture NUOVE. Nel
 * progetto il campo è stato libero da sempre, quindi in produzione possono esserci
 * valori fuori lista; nessuna migrazione li riscrive, continuano a mostrarsi, e
 * vengono sostituiti solo se l'utente rientra nel form. Vedi la migrazione 008.
 */
export const EMOJI_PIANTE = [
	'🪴',
	'🌿',
	'🌱',
	'🍀',
	'🌵',
	'🌴',
	'🎍',
	'🌾',
	'🍃',
	'☘️',
	'🌳',
	'🌲',
	'🌷',
	'🌹',
	'🌻',
	'🌼',
	'🌸',
	'💐',
	'🏵️',
	'🥀',
	'🍁',
	'🍂',
	'🪻',
	'🪷',
	'🌺',
	'🍄',
	'🫧',
	'🧑‍🌾'
] as const;

export const EMOJI_DEFAULT = '🪴';

const AMMESSE = new Set<string>(EMOJI_PIANTE);

export function emojiAmmessa(valore: string): boolean {
	return AMMESSE.has(valore);
}
