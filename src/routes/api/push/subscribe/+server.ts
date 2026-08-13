import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { checkPushEndpoint } from '$lib/server/push-endpoints';
import { parseBody, pushSubscribeSchema } from '$lib/server/schemas';

export const POST: RequestHandler = async ({ request, locals }) => {
	const tokenHash = await requireUser(locals);
	const body = await parseBody(request, pushSubscribeSchema);

	// SSRF: l'endpoint è una URL scelta dal client e il cron poi ci fa una POST
	// dall'interno della rete Docker. Si valida QUI, prima di salvarlo, così nel
	// database non può esistere una riga che punti a un servizio interno.
	const check = checkPushEndpoint(body.endpoint);
	if (!check.ok) error(400, `Endpoint push rifiutato: ${check.reason}`);

	// Un endpoint può essere ri-registrato dallo stesso browser con chiavi nuove.
	const [row] = await sql<{ id: string }[]>`
		insert into push_subscriptions ${sql({
			user_token_hash: tokenHash,
			endpoint: body.endpoint,
			p256dh: body.keys.p256dh,
			auth: body.keys.auth
		})}
		on conflict (endpoint) do update set
			user_token_hash = excluded.user_token_hash,
			p256dh = excluded.p256dh,
			auth = excluded.auth
		returning id
	`;

	return json({ id: row.id }, { status: 201 });
};
