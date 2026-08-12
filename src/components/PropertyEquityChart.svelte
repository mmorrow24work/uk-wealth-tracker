<script module>
	/**
	 * Formatters + tooltip reading for the equity growth projection chart — issue #38's "Equity
	 * growth projection chart (30-year)". Lifted into the module block for the same two reasons
	 * `NetWorthChart.svelte` gives: testable without a pointer to hover, and one `Intl` formatter per
	 * app rather than one per mounted chart.
	 */

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	const axisCurrencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		notation: 'compact',
		maximumFractionDigits: 1
	});

	/** @param {number} amount @returns {string} */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} amount @returns {string} */
	function formatAxisMoney(amount) {
		return axisCurrencyFormatter.format(amount);
	}

	/** @param {number} year @returns {string} */
	function formatYearAxis(year) {
		return year === 0 ? 'Today' : `Yr ${year}`;
	}

	/** @param {number} year @returns {string} */
	function formatYearHeading(year) {
		return year === 0 ? 'Today' : `Year ${year}`;
	}

	/**
	 * One line of the hover tooltip.
	 *
	 * @typedef {object} PropertyProjectionTooltipRow
	 * @property {string} label
	 * @property {string} value
	 * @property {string} [color]
	 */

	/**
	 * @typedef {object} PropertyProjectionTooltipReading
	 * @property {string} heading
	 * @property {PropertyProjectionTooltipRow[]} rows
	 */

	/**
	 * @param {import('$lib/property.js').PropertyEquityProjectionPoint | null | undefined} point
	 * @returns {PropertyProjectionTooltipReading | null}
	 */
	export function propertyProjectionTooltipReading(point) {
		if (!point || typeof point.equity !== 'number' || Number.isNaN(point.equity)) return null;

		return {
			heading: formatYearHeading(point.year),
			rows: [
				{ label: 'Equity', value: formatMoney(point.equity), color: 'hsl(var(--chart-1))' },
				{ label: 'Value', value: formatMoney(point.value), color: 'hsl(var(--chart-2))' },
				{
					label: 'Mortgage balance',
					value: formatMoney(point.mortgageBalance),
					color: 'hsl(var(--destructive))'
				}
			]
		};
	}
</script>

<script>
	/**
	 * The equity growth projection chart — README.md → "Property Tracker": "Equity growth projection
	 * chart (30-year)" (issue #38, alongside the deal expiry reminder in `PropertyTracker.svelte`).
	 *
	 * One property in, one chart out: `$lib/property.js`'s {@link propertyEquityProjection} does the
	 * arithmetic (value compounding at `growth_rate`, the mortgage amortising off `interest_rate` and
	 * `monthly_payment`), and this component only decides how the three resulting lines look. Unlike
	 * `NetWorthChart.svelte`'s tracked-line-plus-forecast-band split, everything here is one series
	 * (`points`) with three accessors, so one `<Chart>` is enough — there is no second data array for
	 * `bisect-x`/`<Highlight>` to trip over the way the forecast band's `low`/`mid`/`high` points did
	 * there.
	 *
	 * Equity is drawn heaviest (the headline figure), value and the mortgage balance thinner beside
	 * it so a reader can see *why* equity moves the way it does — value pulling it up, the mortgage
	 * amortising pulling it up too, from the other side. The mortgage balance is coloured with
	 * `--destructive` rather than a third chart hue: a shrinking debt is the one series here that
	 * reads naturally as "the bad one going down is good news" in a warning colour. That was
	 * originally also a slot shortage — `app.css` defined only `--chart-1`/`--chart-2` — but the
	 * categorical palette runs to five slots since #240 and this line stays `--destructive`
	 * deliberately, because the reason is semantic rather than a lack of hues to spend.
	 */
	import { Axis, Chart, Highlight, Spline, Svg, Tooltip } from 'layerchart';

	import { PROPERTY_PROJECTION_YEARS, propertyEquityProjection } from '$lib/property.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 * 	property?: import('$lib/types.js').Property | null,
	 * 	years?: number
	 * }}
	 */
	let { property = null, years = PROPERTY_PROJECTION_YEARS } = $props();

	/**
	 * The plot area's inset — same shape as `NetWorthChart.svelte`'s `CHART_PADDING`, sized for this
	 * chart's own axis labels.
	 */
	const CHART_PADDING = Object.freeze({ top: 8, right: 16, bottom: 24, left: 56 });

	const points = $derived(propertyEquityProjection(property, years));
	const first = $derived(points[0] ?? null);
	const last = $derived(points.at(-1) ?? null);

	const xDomain = $derived(/** @type {[number, number]} */ ([0, Math.max(1, points.length - 1)]));

	/**
	 * The y domain has to cover all three series, not just the one the chart is keyed on
	 * (`point.equity`) — a mortgage balance that starts above the equity line would otherwise be
	 * clipped off the top of the plot.
	 */
	const yDomain = $derived.by(() => {
		/** @type {number[]} */
		const values = [0];
		for (const point of points) values.push(point.value, point.mortgageBalance, point.equity);
		const low = Math.min(...values);
		const high = Math.max(...values);
		const padding = Math.max(1, (high - low) * 0.05);
		return /** @type {[number, number]} */ ([low - padding, high + padding]);
	});

	const xTicks = $derived.by(() => {
		const span = points.length - 1;
		if (span <= 0) return [0];
		const step = Math.max(1, Math.ceil(span / 6));
		/** @type {number[]} */
		const ticks = [];
		for (let year = 0; year <= span; year += step) ticks.push(year);
		if (ticks.at(-1) !== span) ticks.push(span);
		return ticks;
	});

	const hasPlot = $derived(points.length >= 2);

	/** What a screen reader gets instead of the lines — the shape of the projection, in words. */
	const summary = $derived.by(() => {
		if (!property || !first || !last || !hasPlot) return 'Chart of projected property equity.';

		const change = last.equity - first.equity;
		const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'level';
		return (
			`Line chart projecting ${property.name || 'this property'}'s equity over ${last.year} years: ` +
			`${formatMoney(first.equity)} today, ${formatMoney(last.equity)} in year ${last.year} — ` +
			`${direction} ${formatMoney(Math.abs(change))}. Property value ${formatMoney(first.value)} to ` +
			`${formatMoney(last.value)}; mortgage balance ${formatMoney(first.mortgageBalance)} to ` +
			`${formatMoney(last.mortgageBalance)}.`
		);
	});
</script>

<Card className="p-4">
	<h3 class="text-base font-semibold mb-1">
		{property?.name ? `${property.name} — equity projection` : 'Equity projection'}
	</h3>
	<p class="text-sm text-muted-foreground mb-4">
		{years}-year projection: value compounding at {property?.growth_rate ?? 0}% a year against the
		mortgage amortising off its interest rate and monthly payment. Illustrative only — a long-run
		growth assumption held flat, not a prediction, and the mortgage line assumes today's rate and
		payment continue unchanged for the whole horizon.
	</p>

	{#if !property}
		<p class="text-sm text-muted-foreground">No property selected.</p>
	{:else if hasPlot && first && last}
		<p class="text-2xl font-semibold tabular-nums">{formatMoney(last.equity)}</p>
		<p class="text-sm text-muted-foreground mb-2">
			projected equity in year {last.year}, up from {formatMoney(first.equity)} today
		</p>

		<div
			class="flex flex-wrap items-center gap-4 mb-2 text-xs text-muted-foreground"
			style="display:flex; flex-wrap:wrap; align-items:center; gap:1rem; margin-bottom:0.5rem"
		>
			<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
				<span
					style="display:inline-block; width:1.25rem; height:2px; background:hsl(var(--chart-1))"
				></span>
				Equity
			</span>
			<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
				<span
					style="display:inline-block; width:1.25rem; height:2px; background:hsl(var(--chart-2))"
				></span>
				Value
			</span>
			<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
				<span
					style="display:inline-block; width:1.25rem; height:2px; background:hsl(var(--destructive))"
				></span>
				Mortgage balance
			</span>
		</div>

		<div
			class="w-full"
			style="height: 16rem; color: hsl(var(--muted-foreground))"
			role="img"
			aria-label={summary}
		>
			<Chart
				data={points}
				x={(/** @type {import('$lib/property.js').PropertyEquityProjectionPoint} */ point) =>
					point.year}
				y={(/** @type {import('$lib/property.js').PropertyEquityProjectionPoint} */ point) =>
					point.equity}
				{xDomain}
				{yDomain}
				padding={CHART_PADDING}
				tooltipContext={{ mode: 'bisect-x' }}
			>
				<Svg>
					<Axis
						placement="left"
						format={formatAxisMoney}
						ticks={5}
						grid={{ stroke: 'hsl(var(--border))' }}
					/>
					<Axis placement="bottom" ticks={xTicks} format={formatYearAxis} rule />

					<Spline
						y={(/** @type {import('$lib/property.js').PropertyEquityProjectionPoint} */ point) =>
							point.value}
						stroke="hsl(var(--chart-2))"
						strokeWidth={1.5}
						opacity={0.85}
					/>
					<Spline
						y={(/** @type {import('$lib/property.js').PropertyEquityProjectionPoint} */ point) =>
							point.mortgageBalance}
						stroke="hsl(var(--destructive))"
						strokeWidth={1.5}
						opacity={0.85}
					/>
					<Spline stroke="hsl(var(--chart-1))" strokeWidth={2.5} />

					<Highlight lines points />
				</Svg>

				<Tooltip.Root
					x="data"
					props={{ root: { 'aria-hidden': 'true' }, container: {}, content: {} }}
				>
					{#snippet children({ data })}
						{@const reading = propertyProjectionTooltipReading(data)}
						{#if reading}
							<Tooltip.Header>{reading.heading}</Tooltip.Header>
							<Tooltip.List>
								{#each reading.rows as row (row.label)}
									<Tooltip.Item
										label={row.label}
										value={row.value}
										color={row.color}
										valueAlign="right"
									/>
								{/each}
							</Tooltip.List>
						{/if}
					{/snippet}
				</Tooltip.Root>
			</Chart>
		</div>

		<details class="text-sm mt-2" style="margin-top: 0.5rem">
			<summary class="cursor-pointer text-muted-foreground" style="cursor: pointer">
				Show as a table
			</summary>
			<div class="overflow-x-auto mt-2" style="overflow-x: auto; margin-top: 0.5rem">
				<table class="w-full text-sm tabular-nums" style="width: 100%; border-collapse: collapse">
					<thead>
						<tr>
							<th scope="col" style="text-align: left; padding: 0.25rem 0.5rem">Year</th>
							<th scope="col" style="text-align: right; padding: 0.25rem 0.5rem">Value</th>
							<th scope="col" style="text-align: right; padding: 0.25rem 0.5rem">
								Mortgage balance
							</th>
							<th scope="col" style="text-align: right; padding: 0.25rem 0.5rem">Equity</th>
						</tr>
					</thead>
					<tbody>
						{#each points as point (point.year)}
							<tr>
								<th
									scope="row"
									style="text-align: left; padding: 0.25rem 0.5rem; font-weight: normal"
								>
									{formatYearHeading(point.year)}
								</th>
								<td style="text-align: right; padding: 0.25rem 0.5rem"
									>{formatMoney(point.value)}</td
								>
								<td style="text-align: right; padding: 0.25rem 0.5rem"
									>{formatMoney(point.mortgageBalance)}</td
								>
								<td style="text-align: right; padding: 0.25rem 0.5rem"
									>{formatMoney(point.equity)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
</Card>
