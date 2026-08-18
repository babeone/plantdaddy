import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireUuid } from '$lib/server/auth';
import { adminShowUserPhotos, adminShowUserText, adminUrl } from '$lib/server/admin/config';
import { requireAdmin } from '$lib/server/admin/guard';
import { getUser, listUserEvents, listUserPlants } from '$lib/server/admin/queries';
import { audit } from '$lib/server/admin/session';

const MAX_EVENTS = 200;

export const load: PageServerLoad = async (event) => {
	const session = await requireAdmin(event);

	// Stesso trattamento degli id nelle API utente: un valore non-UUID
	// farebbe fallire Postgres con un errore di sintassi, cioè un 500. Qui
	// diventa un 404, che è anche la risposta corretta.
	const ref = requireUuid(event.params.ref, 'Utente non trovato');

	const user = await getUser(ref);
	if (!user) error(404, 'Utente non trovato');

	const [plants, events] = await Promise.all([
		listUserPlants(ref),
		listUserEvents(ref, MAX_EVENTS)
	]);

	// Guardare i dati di una persona lascia una traccia: se un domani questa
	// istanza avesse più di un amministratore, si sa chi ha aperto cosa.
	await audit(event, 'utente_visto', { adminId: session.admin_id, email: session.email }, { ref });

	return {
		user,
		plants,
		events,
		showText: adminShowUserText(),
		showPhotos: adminShowUserPhotos(),
		maxEvents: MAX_EVENTS,
		base: adminUrl()
	};
};
