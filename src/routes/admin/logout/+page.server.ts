import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { adminUrl } from '$lib/server/admin/config';
import { requireAdminArea } from '$lib/server/admin/guard';
import { audit, destroyAdminSession, readAdminSession } from '$lib/server/admin/session';

/** Solo POST: aprendo l'indirizzo a mano si torna indietro senza fare nulla. */
export const load: PageServerLoad = async (event) => {
	requireAdminArea(event);
	redirect(303, adminUrl());
};

export const actions: Actions = {
	default: async (event) => {
		requireAdminArea(event);

		const session = await readAdminSession(event.cookies);
		// La riga viene cancellata dal database, non solo il cookie: una sessione
		// deve poter essere revocata anche se il cookie è già stato copiato altrove.
		await destroyAdminSession(event);
		if (session) {
			await audit(event, 'logout', { adminId: session.admin_id, email: session.email });
		}

		redirect(303, adminUrl());
	}
};
