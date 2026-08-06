<script>
	/**
	 * Compounding effect panel — README.md → "Forecast": "Compounding effect panel: contributions vs
	 * growth split" (issue #20).
	 *
	 * Reads the split `$lib/compounding.js` derives from a `Forecast` and shows it three ways: the
	 * projected pot broken into starting position / contributions / growth, the month growth overtakes
	 * contributions, and how the split moves as the horizon lengthens. Nothing here computes any
	 * money — the projection owns the arithmetic (`forecast.js` records the split as it walks each
	 * month), so this component only formats and lays out what `compounding.js` returns.
	 *
	 * It takes a `Forecast` as a prop rather than deriving its own, so the growth/spread/horizon
	 * sliders and the fallback starting position in `ForecastProjections` drive this panel too and
	 * there is no second set of assumptions on the tab that could disagree with the first.
	 *
	 * `offsets` is likewise passed in rather than chosen here: the parent's summary table is already
	 * either at its default 1/5/10/20/30-year horizons or zoomed to an age range (#19), and a
	 * compounding table sitting directly beneath it that showed a different set of months would read
	 * as a contradiction. Omit it and the panel falls back to the same default horizons
	 * `summariseForecast` uses.
	 */
	import {
		compoundingByScenario,
		compoundingForOffsets,
		compoundingPointAt,
		growthCrossovers,
		summariseCompounding
	} from '$lib/compounding.js';
	import { FORECAST_SCENARIOS, FORECAST_SCENARIO_LABELS } from '$lib/forecast.js';
	import { ageAtPoint } from '$lib/milestones.js';

	/**
	 * @type {{
	 * 	forecast: import('$lib/forecast.js').Forecast,
	 * 	offsets?: number[] | null,
	 * 	dobYear?: number | null,
	 * 	dobMonth?: number | null
	 * }}
	 */
	let { forecast, offsets = null, dobYear = null, dobMonth = null } = $props();

	// The headline split is the realistic scenario's, the same one the milestone dates and the
	// summary table's middle column read — the other two scenarios are the comparison table below.
	const headline = $derived(compoundingPointAt(forecast, 'realistic'));
	const byScenario = $derived(compoundingByScenario(forecast));
	const crossings = $derived(growthCrossovers(forecast));
	const crossing = $derived(crossings.realistic);

	const rows = $derived(
		offsets && offsets.length > 0
			? compoundingForOffsets(forecast, 'realistic', offsets)
			: summariseCompounding(forecast)
	);

	/**
	 * A stacked bar needs three non-negative widths. Growth can be negative (a losing scenario), in
	 * which case there is no bar to draw and the panel says so in words instead.
	 *
	 * Segment colours are inline rather than Tailwind `bg-*` classes, unlike everything else in this
	 * repo: the bar is the panel's only graphic and a segment with no colour is not a smaller bar, it
	 * is no bar at all. Its width has to be an inline style anyway (it's a computed percentage), so
	 * the colour sits beside it rather than depending on the utility class pipeline being live.
	 */
	const barParts = $derived(
		headline && headline.investments > 0 && headline.growth >= 0 && headline.contributions >= 0
			? [
					{
						key: 'starting',
						label: 'Already invested',
						value: headline.starting,
						colour: '#94a3b8'
					},
					{
						key: 'contributions',
						label: 'Contributions',
						value: headline.contributions,
						colour: '#0ea5e9'
					},
					{ key: 'growth', label: 'Growth', value: headline.growth, colour: '#10b981' }
				].filter((part) => part.value > 0)
			: []
	);

	const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });
	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});
	const percentFormatter = new Intl.NumberFormat('en-GB', {
		style: 'percent',
		maximumFractionDigits: 0
	});

	/** @param {{ month: number, year: number }} value */
	function formatMonth({ month, year }) {
		return monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
	}

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number | null} share */
	function formatShare(share) {
		return share === null ? '—' : percentFormatter.format(share);
	}

	/** @param {number} offset @returns {string} e.g. "10 years", "18 months" */
	function formatHorizon(offset) {
		if (offset < 12) return `${offset} month${offset === 1 ? '' : 's'}`;
		const years = Math.round((offset / 12) * 10) / 10;
		return `${years} year${years === 1 ? '' : 's'}`;
	}

	/** @param {{ month: number, year: number }} point */
	function formatDate(point) {
		const age = dobYear !== null ? ` (age ${ageAtPoint(dobYear, dobMonth, point)})` : '';
		return `${formatMonth(point)}${age}`;
	}
</script>

<div class="mt-5 pt-4 border-t border-border">
	<h3 class="text-sm font-semibold mb-1">Compounding effect</h3>
	<p class="text-xs text-muted-foreground mb-3">
		How much of the realistic projection is money you pay in, and how much is money your money
		earns. Debts carry forward unchanged through a forecast, so this splits net worth growth just as
		well as it splits investment growth.
	</p>

	{#if !headline}
		<p class="text-sm text-muted-foreground">Nothing projected yet.</p>
	{:else if headline.gain === 0}
		<p class="text-sm text-muted-foreground">
			Nothing is paid in and nothing is earned over this horizon, so there is no growth to split.
		</p>
	{:else}
		{#if barParts.length > 0}
			<div
				class="flex h-6 w-full overflow-hidden rounded-md border border-border"
				style="display: flex; height: 1.5rem; overflow: hidden"
				role="img"
				aria-label={`Of ${formatMoney(headline.investments)} projected, ${formatMoney(
					headline.starting
				)} is already invested, ${formatMoney(headline.contributions)} is contributions and ${formatMoney(
					headline.growth
				)} is growth`}
			>
				{#each barParts as part (part.key)}
					<div
						style="width: {(part.value / headline.investments) *
							100}%; background-color: {part.colour}"
						title="{part.label}: {formatMoney(part.value)}"
					></div>
				{/each}
			</div>

			<div class="flex flex-wrap gap-4 mt-2 mb-4">
				{#each barParts as part (part.key)}
					<div class="flex items-center gap-1.5 text-xs">
						<span
							class="inline-block h-2.5 w-2.5 rounded-sm"
							style="display: inline-block; width: 0.625rem; height: 0.625rem; background-color: {part.colour}"
						></span>
						<span class="text-muted-foreground">{part.label}</span>
						<span class="font-medium tabular-nums">{formatMoney(part.value)}</span>
					</div>
				{/each}
			</div>
		{/if}

		<p class="text-sm mb-3">
			{#if headline.growthShare !== null && headline.growthShare >= 0}
				Of the {formatMoney(headline.gain)} this forecast adds over
				{formatHorizon(headline.offset)},
				<span class="font-medium">{formatShare(headline.growthShare)} is investment growth</span>
				and {formatShare(headline.contributionShare)} is contributions you still have to pay in.
			{:else}
				Over {formatHorizon(headline.offset)} you pay in
				{formatMoney(headline.contributions)}
				and lose {formatMoney(Math.abs(headline.growth))} to negative growth — at this rate the money
				is shrinking, not compounding.
			{/if}
		</p>

		<p class="text-sm text-muted-foreground mb-4">
			{#if headline.contributions === 0}
				Nothing is being paid in over this horizon, so every pound of the gain is growth.
			{:else if crossing}
				<span class="font-medium text-foreground">Growth overtakes contributions</span>
				in {formatDate(crossing)}
				{#if crossings.optimistic && crossings.pessimistic}
					<span>
						({formatMonth(crossings.optimistic)}–{formatMonth(crossings.pessimistic)})
					</span>
				{/if}
				— from then on your holdings earn more than you put in.
			{:else}
				Growth doesn't overtake contributions within {formatHorizon(forecast.months)} in the realistic
				scenario: you're still adding more than the market is.
			{/if}
		</p>

		{#if byScenario}
			<table class="w-full text-sm border-collapse mb-4">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Scenario</th>
						<th class="py-2 px-2 font-medium text-right">Contributions</th>
						<th class="py-2 px-2 font-medium text-right">Growth</th>
						<th class="py-2 px-2 font-medium text-right">Growth share</th>
						<th class="py-2 pl-2 font-medium text-right">Growth overtakes</th>
					</tr>
				</thead>
				<tbody>
					{#each FORECAST_SCENARIOS as scenario (scenario)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-2">
								<span class="font-medium">{FORECAST_SCENARIO_LABELS[scenario]}</span>
								<span class="text-xs text-muted-foreground ml-1">
									{forecast.rates[scenario]}% a year
								</span>
							</td>
							<td class="py-2 px-2 text-right tabular-nums">
								{formatMoney(byScenario[scenario].contributions)}
							</td>
							<td class="py-2 px-2 text-right tabular-nums">
								{formatMoney(byScenario[scenario].growth)}
							</td>
							<td class="py-2 px-2 text-right tabular-nums">
								{formatShare(byScenario[scenario].growthShare)}
							</td>
							<td class="py-2 pl-2 text-right">
								{#if byScenario[scenario].contributions === 0}
									<span class="text-muted-foreground">from the start</span>
								{:else if crossings[scenario]}
									{formatMonth(/** @type {{month: number, year: number}} */ (crossings[scenario]))}
								{:else}
									<span class="text-muted-foreground">never</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-muted-foreground mb-4">
				Contributions are a payment schedule, not a return, so all three scenarios pay in the same
				amount — only growth differs between them.
			</p>
		{/if}

		{#if rows.length > 0}
			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Horizon</th>
						<th class="py-2 px-2 font-medium text-right">Paid in</th>
						<th class="py-2 px-2 font-medium text-right">Growth</th>
						<th class="py-2 pl-2 font-medium text-right">Growth share</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.offset)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-2">
								<span class="font-medium">{formatHorizon(row.offset)}</span>
								<span class="text-xs text-muted-foreground ml-1">{formatDate(row)}</span>
							</td>
							<td class="py-2 px-2 text-right tabular-nums">{formatMoney(row.contributions)}</td>
							<td class="py-2 px-2 text-right tabular-nums">{formatMoney(row.growth)}</td>
							<td class="py-2 pl-2 text-right tabular-nums">{formatShare(row.growthShare)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-muted-foreground mt-3">
				Realistic scenario, at the same horizons as the table above.
				{#if headline.growth > 0}
					The growth share climbs as the horizon lengthens — that climb is the compounding.
				{:else if headline.growth < 0}
					Growth is negative throughout, so the share is too: the longer the horizon, the more of
					what you pay in the losses take back.
				{/if}
			</p>
		{/if}
	{/if}
</div>
