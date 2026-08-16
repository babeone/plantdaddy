<script lang="ts">
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	// Identificatore accorciato solo a schermo: è admin_ref, non il token_hash,
	// che non lascia mai il server.
	const short = (ref: string) => ref.slice(0, 8);
	const date = (value: string | Date) => new Date(value).toLocaleDateString('it-IT');
</script>

<div class="group-title">{data.total} utenti</div>

{#if data.users.length === 0}
	<div class="card"><p class="muted-text">Nessun utente registrato.</p></div>
{:else}
	<div class="group">
		{#each data.users as user (user.admin_ref)}
			<a class="item" href="{data.base}/utenti/{user.admin_ref}">
				<span class="facts">
					{#if user.display_name}
						<span class="nome">{user.display_name}</span>
					{:else}
						<!-- Sessione creata prima che il nome fosse obbligatorio: si mostra
						     admin_ref, che è anche la chiave con cui riempirlo a mano. -->
						<span class="nome anonimo">senza nome · {short(user.admin_ref)}</span>
					{/if}
					<small>{user.plants} piante · {user.events} eventi</small>
					<small>
						iscritto il {date(user.created_at)}
						{#if user.last_event}· ultimo evento {user.last_event}{/if}
					</small>
				</span>
				<span class="flags">
					{#if user.push > 0}<span class="tag" title="notifiche attive">🔔</span>{/if}
					{#if user.winter_mode}<span class="tag" title="modalità inverno">❄️</span>{/if}
					<span class="tag hour">{String(user.notify_hour).padStart(2, '0')}:00</span>
				</span>
			</a>
		{/each}
	</div>
{/if}

{#if data.pages > 1}
	<nav class="pager" aria-label="Pagine">
		{#if data.page > 1}
			<a class="btn btn-mini" href="{data.base}/utenti?page={data.page - 1}">← Precedente</a>
		{/if}
		<span class="muted-text">Pagina {data.page} di {data.pages}</span>
		{#if data.page < data.pages}
			<a class="btn btn-mini" href="{data.base}/utenti?page={data.page + 1}">Successiva →</a>
		{/if}
	</nav>
{/if}

<style>
	.nome {
		font-weight: 650;
		overflow-wrap: anywhere;
	}
	.nome.anonimo {
		font-weight: 500;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.facts {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 13.5px;
	}
	.facts small {
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.flags {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.tag.hour {
		font-variant-numeric: tabular-nums;
		font-size: 11px;
		color: var(--text-mute);
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-top: 14px;
	}
</style>
