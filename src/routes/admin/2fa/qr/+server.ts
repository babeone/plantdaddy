import { error, type RequestHandler } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { requireAdminArea } from '$lib/server/admin/guard';
import { readAdminSession } from '$lib/server/admin/session';
import { otpauthUri } from '$lib/server/admin/totp';

/**
 * Il QR dell'arruolamento, servito come immagine.
 *
 * Perché un endpoint e non un data: URL o un SVG inline: la CSP dell'app ha
 * img-src 'self' blob: (senza data:) e nel progetto {@html} non si usa mai. Un
 * <img> verso la stessa origine passa senza allentare niente, e la pagina resta
 * senza JavaScript. `qrcode` è già una dipendenza di produzione — la usa la
 * schermata del codice sessione — e su Node espone toBuffer.
 *
 * Il contenuto è un segreto: si serve solo a chi ha già superato la password,
 * non ha ancora completato il secondo fattore e non ne ha mai confermato uno.
 */
export const GET: RequestHandler = async (event) => {
	requireAdminArea(event);

	const session = await readAdminSession(event.cookies);
	// 404 e non 401: la risposta è identica a quella di un indirizzo inesistente,
	// che è ciò che un'immagine chiesta senza titolo merita.
	if (!session || session.mfa_done || !session.totp_secret) error(404, 'Non trovato');

	const png = await QRCode.toBuffer(otpauthUri(session.email, session.totp_secret), {
		width: 400,
		margin: 2,
		errorCorrectionLevel: 'M'
	});

	return new Response(new Uint8Array(png), {
		headers: {
			'content-type': 'image/png',
			// Un segreto non va nella cache del browser né in quella di un proxy.
			'cache-control': 'no-store, no-cache, must-revalidate',
			'x-robots-tag': 'noindex, nofollow'
		}
	});
};
