<script>
	import ForecastProjections from '../../components/ForecastProjections.svelte';

	// The recorded history a forecast is anchored on. Snapshots are entered by #8's form and owned
	// by the store (#5) once it lands; until then this stays empty and the panel projects from the
	// starting position typed into it instead.
	/** @type {import('$lib/types.js').MonthlyEntry[]} */
	let monthlyEntries = $state([]);
</script>

<h1>Forecast</h1>
<p>
	Where your net worth lands under three growth assumptions, live as you drag the growth and spread
	sliders below, plus when you cross the £100k/£250k/£500k/£1M milestones and reach retirement age.
	Zoom the table to a specific age range once you've entered a birth year. The compounding-effect
	panel splits that projection into what you pay in versus what your money earns, and dates the
	month the second overtakes the first. The stress test at the bottom overlays a market crash —
	magnitude, timing, recovery rate and how long the recovery lasts — on the same projection, and
	says how long it takes to climb back out.
</p>

<div class="mt-6 flex max-w-3xl flex-col gap-6">
	<ForecastProjections {monthlyEntries} />
</div>
