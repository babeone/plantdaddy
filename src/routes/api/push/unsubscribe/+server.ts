import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { parseBody, pushUnsubscribeSchema } from '$lib/server/schemas';

export const POST: RequestHandler = async ({ request, locals }) => {
	const tokenHash = await requireUser(locals);
	const body = await parseBody(request, pushUnsubscribeSchema);

	// Il filtro sul token evita che si possa cancellare la subscription di altri
	// conoscendone l'endpoint. Cancellare qualcosa che non c'è non è un errore.
	const deleted = await sql`
		delete from push_subscriptions
		where endpoint = ${body.endpoint} and user_token_hash = ${tokenHash}
		returning id
	`;

	return json({ removed: deleted.length });
};
