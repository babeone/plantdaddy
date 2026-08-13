/**
 * Messaggi brevi. La conferma di una cura NON passa da qui: quella è una
 * micro-animazione sull'icona, così non copre l'interfaccia mentre si registra
 * una pianta dopo l'altra. I toast servono per gli errori e per le operazioni
 * che non hanno un riscontro visivo proprio (backup, copia del codice).
 */
export type ToastKind = 'info' | 'error';

export type Toast = { id: number; message: string; kind: ToastKind };

class ToastStore {
	items = $state<Toast[]>([]);
	private nextId = 1;

	show(message: string, kind: ToastKind = 'info', ms = 2400): void {
		const id = this.nextId++;
		this.items = [...this.items, { id, message, kind }];
		setTimeout(() => this.dismiss(id), ms);
	}

	error(message: string): void {
		this.show(message, 'error', 3600);
	}

	dismiss(id: number): void {
		this.items = this.items.filter((item) => item.id !== id);
	}
}

export const toasts = new ToastStore();
