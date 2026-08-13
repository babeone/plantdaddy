<script lang="ts">
	import BottomSheet from './BottomSheet.svelte';

	/** Conferma per le azioni non recuperabili: eliminazioni e import replace. */
	let {
		title,
		message,
		confirmLabel = 'Conferma',
		danger = false,
		onconfirm,
		oncancel
	}: {
		title: string;
		message: string;
		confirmLabel?: string;
		danger?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();
</script>

<BottomSheet {title} onclose={oncancel}>
	<p class="message">{message}</p>
	<button class="btn btn-primary" class:danger onclick={onconfirm}>{confirmLabel}</button>
	<button class="btn btn-secondary cancel" onclick={oncancel}>Annulla</button>
</BottomSheet>

<style>
	.message {
		font-size: 14.5px;
		color: var(--text-dim);
		margin-bottom: 16px;
		line-height: 1.45;
	}
	.danger {
		background: var(--late);
		color: #fff;
	}
	.cancel {
		margin-top: 8px;
		border: 0;
	}
</style>
