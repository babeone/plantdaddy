/**
 * ALLOWLIST DEGLI ENDPOINT PUSH — la difesa SSRF più importante del progetto.
 *
 * POST /api/push/subscribe riceve una URL scelta dal client, e il cron delle
 * notifiche poi ci fa una POST DALL'INTERNO della rete Docker. Senza controlli
 * chiunque potrebbe registrare `http://postgres:5432/` o l'IP di un container
 * di un altro progetto e usare questo server come proxy per sondare o colpire
 * servizi interni, che dall'esterno non sono raggiungibili.
 *
 * Il confronto è su suffisso di dominio con il punto incluso, mai includes():
 * `fcm.googleapis.com.evil.tld` contiene la stringa giusta ma è un host
 * controllato dall'attaccante, e passerebbe qualunque controllo di sottostringa.
 */

/** Host validi esatti. */
const ALLOWED_HOSTS = new Set([
	'fcm.googleapis.com', // Chrome, Edge, Android
	'updates.push.services.mozilla.com', // Firefox
	'web.push.apple.com' // Safari, iOS/iPadOS
]);

/** Host validi come sottodominio: *.notify.windows.com (WNS usa wns2-xxx...). */
const ALLOWED_SUFFIXES = ['.notify.windows.com'];

export const MAX_ENDPOINT_LENGTH = 1000; // allineato al CHECK sulla colonna

export type EndpointCheck = { ok: true } | { ok: false; reason: string };

export function checkPushEndpoint(raw: string): EndpointCheck {
	if (raw.length > MAX_ENDPOINT_LENGTH) {
		return { ok: false, reason: 'endpoint troppo lungo' };
	}

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false, reason: 'endpoint non è una URL valida' };
	}

	// Solo https: esclude http verso la rete interna, ma anche file:, gopher:,
	// data: e gli altri schemi che si usano per aggirare i filtri.
	if (url.protocol !== 'https:') {
		return { ok: false, reason: 'schema non consentito, serve https' };
	}

	// Una porta esplicita servirebbe solo a puntare a un servizio interno:
	// i push service veri stanno tutti sulla 443 implicita.
	if (url.port !== '') {
		return { ok: false, reason: 'porta esplicita non consentita' };
	}

	if (url.username !== '' || url.password !== '') {
		return { ok: false, reason: 'credenziali nella URL non consentite' };
	}

	const host = url.hostname.toLowerCase();
	const allowed =
		ALLOWED_HOSTS.has(host) ||
		ALLOWED_SUFFIXES.some((suffix) => host.length > suffix.length && host.endsWith(suffix));

	if (!allowed) {
		return { ok: false, reason: 'host non presente nella allowlist dei push service' };
	}

	return { ok: true };
}
