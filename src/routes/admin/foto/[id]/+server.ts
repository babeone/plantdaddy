import { error, type RequestHandler } from '@sveltejs/kit';
import { requireUuid } from '$lib/server/auth';
import { adminShowUserPhotos } from '$lib/server/admin/config';
import { requireAdmin } from '$lib/server/admin/guard';
import { serviFotoAdmin } from '$lib/server/photos/serve';

/**
 * Foto degli utenti servite al pannello di controllo.
 *
 * Sta sotto /admin e non sotto /api/photos per tre ragioni che valgono tutte
 * insieme:
 *
 *  - requireAdmin() pretende una sessione completa di secondo fattore, e se il
 *    pannello non è configurato o l'IP non è in allowlist la rotta è 404;
 *  - hooks.server.ts applica a tutto /admin gli header no-store, noindex e
 *    referrer-policy, quindi queste immagini non restano nella cache del browser
 *    di chi amministra né finiscono indicizzate;
 *  - il cookie pd_photo dell'utente ha Path=/api/photos e qui non arriva
 *    nemmeno: nessun rischio di confondere le due autorizzazioni.
 *
 * L'interruttore ADMIN_SHOW_USER_PHOTOS è un 404 e non un 403: con le foto
 * nascoste la rotta deve comportarsi come se non esistesse.
 */
export const GET: RequestHandler = async (event) => {
	await requireAdmin(event);
	if (!adminShowUserPhotos()) error(404, 'Non trovato');
	return serviFotoAdmin(requireUuid(event.params.id, 'Foto non trovata'), 'full');
};
