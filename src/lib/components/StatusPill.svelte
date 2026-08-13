<script lang="ts">
	import { nextDueDays, plantState } from '$lib/stores/plants.svelte';
	import { daysFromToday } from '$lib/date';
	import type { Plant } from '$lib/types';

	let { plant }: { plant: Plant } = $props();

	const state = $derived(plantState(plant));
	const label = $derived.by(() => {
		const due = nextDueDays(plant);
		switch (state) {
			case 'snoozed': {
				const snoozeDate = plant.water_snoozed_until ?? plant.fertilize_snoozed_until;
				const days = snoozeDate ? daysFromToday(snoozeDate) : 1;
				return days === 1 ? 'Rimandata a domani' : `Rimandata di ${days} giorni`;
			}
			case 'late':
				return `In ritardo di ${Math.abs(due ?? 0)} ${Math.abs(due ?? 0) === 1 ? 'giorno' : 'giorni'}`;
			case 'today':
				return due === null ? 'Mai curata' : 'Da fare oggi';
			case 'soon':
				return `Tra ${due} ${due === 1 ? 'giorno' : 'giorni'}`;
			default:
				return `Tra ${due} giorni`;
		}
	});
</script>

<span class="pill {state}">{label}</span>
