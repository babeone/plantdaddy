import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { clientIp, rateLimit } from '$lib/server/rate-limit';
import { adminUrl } from '$lib/server/admin/config';
import { requireAdminArea } from '$lib/server/admin/guard';
import { attemptLogin } from '$lib/server/admin/login';
import {
	audit,
	createAdminSession,
	purgeExpiredAdminSessions,
	readAdminSession
} from '$lib/server/admin/session';

/**
 * MESSAGGIO UNICO per tutti i fallimenti.
 *
 * Email inesistente, password sbagliata, account disabilitato: da fuori devono
 * essere indistinguibili, altrimenti il modulo di login diventa un modo per
 * scoprire quali indirizzi sono registrati su questa istanza. Il dettaglio vero
 * finisce in admin_audit, dove può leggerlo solo chi ha già accesso al database.
 */
const GENERIC = 'Credenziali non valide.';

export const load: PageServerLoad = async (event) => {
	requireAdminArea(event);

	// Già dentro: non ha senso mostrare il login. Se manca ancora il secondo
	// fattore si va lì, non alla panoramica.
	const session = await readAdminSession(event.cookies);
	if (session) redirect(303, session.mfa_done ? adminUrl('/panoramica') : adminUrl('/2fa'));

	return {};
};

export const actions: Actions = {
	default: async (event) => {
		requireAdminArea(event);

		// Freno per IP, che si somma al blocco per account di attemptLogin(). Il
		// primo protegge dal rumore di internet, il secondo sopravvive al riavvio
		// del processo — servono entrambi.
		const ip = clientIp(event);
		if (!rateLimit(`admin-login:${ip}`, 10, 15 * 60 * 1000)) {
			return fail(429, { error: 'Troppi tentativi. Riprova più tardi.', email: '' });
		}

		const form = await event.request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.slice(0, 254);
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { error: GENERIC, email });
		}

		const result = await attemptLogin(email, password);
		if (!result.ok) {
			await audit(event, result.locked ? 'login_bloccato' : 'login_fallito', { email });
			return fail(401, { error: GENERIC, email });
		}

		await purgeExpiredAdminSessions();
		// mfa_done = false: la sessione esiste ma non apre nessuna pagina con dati
		// finché il secondo fattore non passa.
		await createAdminSession(event, result.adminId, false);
		await audit(event, 'login_password_ok', { adminId: result.adminId, email: result.email });

		redirect(303, adminUrl('/2fa'));
	}
};
