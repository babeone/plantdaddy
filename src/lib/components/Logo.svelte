<script lang="ts">
	/**
	 * Logo PlantDaddy. Stessi path di logo.svg, colori dalle CSS variables così
	 * segue la palette. Nessuna immagine esterna: è markup, quindi la CSP non
	 * deve consentire nessuna origine per le immagini.
	 */
	let { size = 44, class: className = '' }: { size?: number; class?: string } = $props();
</script>

<svg
	viewBox="0 0 64 64"
	width={size}
	height={size}
	class={className}
	aria-hidden="true"
	focusable="false"
>
	<!-- foglie: laterali tonde, centrale turgida -->
	<ellipse
		cx="23.4"
		cy="30.9"
		rx="6.5"
		ry="3.8"
		transform="rotate(45 23.4 30.9)"
		fill="var(--leaf-2)"
	/>
	<ellipse
		cx="40.6"
		cy="30.9"
		rx="6.5"
		ry="3.8"
		transform="rotate(-45 40.6 30.9)"
		fill="var(--brand)"
	/>
	<path d="M32 41c6.4-8 6.4-21 0-33-6.4 12-6.4 25 0 33Z" fill="var(--leaf-3)" />
	<!-- vaso -->
	<path d="M17 41h30l-3.6 19.2A3 3 0 0 1 40.4 63H23.6a3 3 0 0 1-3-2.8L17 41Z" fill="var(--pot)" />
	<rect x="13.5" y="35" width="37" height="9.5" rx="4" fill="var(--pot-rim)" />
	<!-- occhiali da sole -->
	<g fill="var(--ink)">
		<rect x="19" y="44.6" width="11.8" height="8.2" rx="3.4" />
		<rect x="33.2" y="44.6" width="11.8" height="8.2" rx="3.4" />
		<rect x="30.4" y="47.2" width="3.2" height="2.2" rx="1.1" />
	</g>
	<!-- baffo -->
	<path d="M32 54c-1.85-2.55-5.65-2.9-7.6.35 2.05 2.3 5.75 1.5 7.6-.35Z" fill="var(--stache)" />
	<path d="M32 54c1.85-2.55 5.65-2.9 7.6.35-2.05 2.3-5.75 1.5-7.6-.35Z" fill="var(--stache)" />
	<!-- catenina -->
	<path
		d="M22.5 57.2Q32 62 41.5 57.2"
		stroke="var(--gold)"
		stroke-width="1.5"
		stroke-linecap="round"
		fill="none"
	/>
	<circle cx="32" cy="61" r="2" fill="var(--gold)" />
</svg>

<style>
	svg {
		flex: none;
		display: block;
	}
</style>
