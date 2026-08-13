import QRCode from 'qrcode';
import jsQR from 'jsqr';

/** Disegna il QR del token su un canvas già presente nel DOM. */
export async function drawQr(canvas: HTMLCanvasElement, text: string): Promise<void> {
	await QRCode.toCanvas(canvas, text, {
		width: 320,
		margin: 2,
		errorCorrectionLevel: 'M',
		// Nero su bianco anche a tema scuro: un QR con poco contrasto non si legge.
		color: { dark: '#0f1a14ff', light: '#ffffffff' }
	});
}

/**
 * Scarica il QR come PNG. Passa da un blob e non da una data: URL, così la CSP
 * non deve consentire `data:` e il file arriva con un nome sensato.
 */
export function downloadQrPng(canvas: HTMLCanvasElement, filename: string): void {
	canvas.toBlob((blob) => {
		if (!blob) return;
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}, 'image/png');
}

/**
 * Decodifica un QR da un file immagine, interamente nel browser: l'immagine non
 * viene caricata su nessun server, e il token non lascia il dispositivo.
 */
export async function decodeQrFile(file: File): Promise<string | null> {
	const bitmap = await createImageBitmap(file);
	// Ridimensiona le foto grandi: jsQR su 12 megapixel è inutilmente lento.
	const maxSide = 1000;
	const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) return null;
	context.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();

	const { data } = context.getImageData(0, 0, width, height);
	const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
	return result?.data?.trim() ?? null;
}
