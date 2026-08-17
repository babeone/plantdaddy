<script lang="ts">
	/**
	 * Grafico a linea, SVG scritto a mano.
	 *
	 * NESSUNA LIBRERIA DI CHARTING, e non per parsimonia: il pannello admin ha
	 * `csr = false` e non consegna un byte di JavaScript al browser, quindi una
	 * libreria non potrebbe girare. Il grafico deve essere markup, e allora il
	 * markup lo si scrive. Il vincolo "nessuna dipendenza pesante nel bundle" è
	 * soddisfatto per costruzione.
	 *
	 * viewBox con coordinate fisse e `width: 100%` nel CSS: l'SVG si adatta alla
	 * larghezza senza che serva conoscerla, che è l'unica strada quando non c'è
	 * JavaScript per misurare il contenitore.
	 */
	let {
		punti,
		etichette = [],
		colore = 'var(--brand)',
		unita = '',
		altezza = 90
	}: {
		punti: number[];
		etichette?: string[];
		colore?: string;
		unita?: string;
		altezza?: number;
	} = $props();

	const W = 600;
	const H = $derived(altezza);
	const PAD = 4;

	// Il massimo si arrotonda verso l'alto e non è mai zero: con tutti i valori a
	// zero una divisione per il massimo darebbe NaN e l'SVG sparirebbe.
	const massimo = $derived(Math.max(1, ...punti));

	const x = (i: number) =>
		punti.length <= 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (punti.length - 1);
	const y = (v: number) => H - PAD - (v / massimo) * (H - PAD * 2);

	const linea = $derived(punti.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '));
	// L'area sotto la linea si chiude sul fondo: due punti in più, non un secondo path.
	const area = $derived(
		punti.length === 0
			? ''
			: `${PAD},${H - PAD} ${linea} ${x(punti.length - 1).toFixed(1)},${H - PAD}`
	);
</script>

{#if punti.length === 0}
	<p class="muted-text">Nessun dato nel periodo.</p>
{:else}
	<figure>
		<svg
			viewBox="0 0 {W} {H}"
			preserveAspectRatio="none"
			role="img"
			aria-label="Andamento: minimo {Math.min(
				...punti
			)}{unita}, massimo {massimo}{unita}, ultimo {punti[punti.length - 1]}{unita}"
		>
			<polygon points={area} fill={colore} opacity="0.14" />
			<polyline
				points={linea}
				fill="none"
				stroke={colore}
				stroke-width="2"
				stroke-linejoin="round"
				stroke-linecap="round"
				vector-effect="non-scaling-stroke"
			/>
		</svg>
		<figcaption>
			<span>max {massimo}{unita}</span>
			{#if etichette.length >= 2}
				<span class="estremi">{etichette[0]} → {etichette[etichette.length - 1]}</span>
			{/if}
			<span>ultimo {punti[punti.length - 1]}{unita}</span>
		</figcaption>
	</figure>
{/if}

<style>
	figure {
		margin: 0;
	}
	/* preserveAspectRatio="none" più height fissa: la linea si stira in orizzontale
	   e vector-effect tiene lo spessore del tratto costante, altrimenti lo
	   stiramento lo deformerebbe. */
	svg {
		display: block;
		width: 100%;
		height: 90px;
		overflow: visible;
	}
	figcaption {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-size: 11px;
		color: var(--text-mute);
		margin-top: 4px;
		font-variant-numeric: tabular-nums;
	}
	.estremi {
		color: var(--text-mute);
		opacity: 0.75;
	}
</style>
