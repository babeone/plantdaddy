import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { clientIp, rateLimit } from '$lib/server/rate-limit';
import { adminUrl } from '$lib/server/admin/config';
import { requireAdminArea } from '$lib/server/admin/guard';
import { commitTotpStep, saveTotpSecret } from '$lib/server/admin/login';
import { audit, promoteAdminSession, readAdminSession } from '$lib/server/admin/session';
import { formatSecret, generateSecret, verifyTotp } from '$lib/server/admin/totp';

/**
 * Secondo fattore, obbligatorio.
 *
 * Due situazioni nella stessa pagina:
 *  - primo accesso: l'admin non ha ancora un segreto, quindi lo si genera, lo si
 *    mostra come QR e in chiaro, e si chiede un codice per confermare che l'app
 *    lo abbia registrato davvero;
 *  - accessi successivi: si chiede soltanto il codice.
 *
 * In entrambi i casi si arriva qui con una sessione a mfa_done = false, che non
 * apre nessuna pagina con dati.
 */
export const load: PageServerLoad = async (event) => {
	requireAdminArea(event);

	const session = await readAdminSession(event.cookies);
	if (!session) redirect(303, adminUrl());
	if (session.mfa_done) redirect(303, adminUrl('/panoramica'));

	if (session.totp_secret) {
		return { enrolling: false, secret: null, base: adminUrl() };
	}

	// Il segreto viene salvato subito, non tenuto in memoria: così ricaricare la
	// pagina mostra sempre lo stesso QR invece di generarne uno nuovo e
	// invalidare quello che l'utente ha appena inquadrato. La UPDATE scrive solo
	// se il campo è ancora NULL, quindi due schede aperte non se lo sovrascrivono.
	const secret = generateSecret();
	await saveTotpSecret(session.admin_id, secret);

	// Rilettura: se un'altra scheda ha vinto la corsa, quello buono è il suo.
	const fresh = await readAdminSession(event.cookies);
	const effective = fresh?.totp_secret ?? secret;

	return { enrolling: true, secret: formatSecret(effective), base: adminUrl() };
};

export const actions: Actions = {
	default: async (event) => {
		requireAdminArea(event);

		const session = await readAdminSession(event.cookies);
		if (!session) redirect(303, adminUrl());
		if (session.mfa_done) redirect(303, adminUrl('/panoramica'));

		// Un codice a 6 cifre si indovina con probabilità 1 su un milione, ma
		// senza freno restano centinaia di tentativi al secondo.
		if (!rateLimit(`admin-totp:${clientIp(event)}`, 10, 15 * 60 * 1000)) {
			return fail(429, { error: 'Troppi tentativi. Riprova più tardi.' });
		}

		if (!session.totp_secret) redirect(303, adminUrl('/2fa'));

		const form = await event.request.formData();
		const code = String(form.get('code') ?? '');

		const result = verifyTotp(session.totp_secret, code, {
			lastStep: session.last_totp_step === null ? null : Number(session.last_totp_step)
		});

		if (!result.ok) {
			await audit(
				event,
				'totp_fallito',
				{ adminId: session.admin_id, email: session.email },
				{
					motivo: result.reason
				}
			);
			return fail(401, {
				error:
					result.reason === 'riuso'
						? 'Codice già usato. Aspetta che l’app ne mostri uno nuovo.'
						: 'Codice non valido.'
			});
		}

		// Anti-replay definitivo: la condizione sul passo è nella WHERE, quindi due
		// richieste simultanee con lo stesso codice non passano entrambe.
		if (!(await commitTotpStep(session.admin_id, result.step!))) {
			return fail(401, { error: 'Codice già usato. Aspetta il prossimo.' });
		}

		// Rotazione del token di sessione: chi fosse riuscito a far usare alla
		// vittima un token noto prima del login non se lo ritrova promosso.
		await promoteAdminSession(event, session.admin_id);
		await audit(event, 'login_completato', { adminId: session.admin_id, email: session.email });

		redirect(303, adminUrl('/panoramica'));
	}
};
