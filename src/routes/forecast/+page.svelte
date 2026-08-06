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
	sliders below. The retirement marker, milestone pills, the age filter, the compounding-effect
	panel and the stress-test overlay land in later builds.
</p>

<div class="mt-6 flex max-w-3xl flex-col gap-6">
	<ForecastProjections {monthlyEntries} />
</div>
