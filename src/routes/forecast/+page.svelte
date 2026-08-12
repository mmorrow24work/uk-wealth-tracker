<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import ForecastProjections from '../../components/ForecastProjections.svelte';
	import { appData, hydrateAppData } from '$lib/index.js';

	// The recorded history a forecast is anchored on. Snapshots are entered by #8's form and owned
	// by the store (#5) once it lands; until then this stays empty and the panel projects from the
	// starting position typed into it instead.
	/** @type {import('$lib/types.js').MonthlyEntry[]} */
	let monthlyEntries = $state([]);

	// Read-only against the store, for the mortgage rate rise overlay's property picker (#158) — this
	// tab never edits a property itself, same read-only hydrate-then-render pattern every other tab
	// that only reads the store already uses (e.g. `retirement/+page.svelte`).
	/** @type {import('$lib/types.js').Property[]} */
	let properties = $state([]);

	onMount(async () => {
		await hydrateAppData();
		properties = get(appData).properties;
	});
</script>

<h1>📈 Forecast</h1>
<p>
	Where your net worth lands under three growth assumptions, live as you drag the growth and spread
	sliders below, plus when you cross the £100k/£250k/£500k/£1M milestones and reach retirement age.
	Zoom the table to a specific age range once you've entered a birth year. The compounding-effect
	panel splits that projection into what you pay in versus what your money earns, and dates the
	month the second overtakes the first. The stress test at the bottom overlays a market crash —
	magnitude, timing, recovery rate and how long the recovery lasts — on the same projection, and
	says how long it takes to climb back out. The one-off large costs overlay lets you add any number
	of named lump sums — a wedding, a car, a home renovation — each on its own date, and shows what
	taking them out does to the same projection. Below that, the mortgage rate rise overlay applies a
	rate change to one of your recorded properties' mortgages, and shows what it does to that payment
	and to this projection. The childcare cost overlay lets you add any number of dated steps — a flat
	bill, or a stepped one as fees change over the years — and shows what taking each one out of your
	contributions does to the same projection.
</p>

<div class="mt-6 flex max-w-3xl flex-col gap-6">
	<ForecastProjections {monthlyEntries} {properties} />
</div>
