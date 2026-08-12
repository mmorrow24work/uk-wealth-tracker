<script module>
	/**
	 * Formatters + tooltip reading for the combined "all properties" equity chart — issue #279,
	 * `PropertyTracker.svelte`'s "All properties" toggle alongside `PropertyEquityChart.svelte`'s
	 * existing single-property view. Lives in its own `<script module>` block for the same two
	 * reasons that file's does: testable without a pointer to hover, and one `Intl` formatter per app
	 * rather than one per mounted chart.
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
	 * One property's equity line, ready to plot and to name in the legend/tooltip/table.
	 *
	 * @typedef {object} PropertyEquitySeries
	 * @property {string} id `property.id` — the key {@link portfolioEquityRows} plots this series'
	 *   equity under in each row.
	 * @property {string} name `property.name`, or a fallback for an unnamed property.
	 * @property {string} color `chartSeriesColor(index)` for this property's position in the list —
	 *   see the instance script for why the colour is resolved there rather than in here.
	 * @property {import('$lib/property.js').PropertyEquityProjectionPoint[]} points
	 */

	/**
	 * One row per projected year, every series' equity keyed by property id — the shape LayerChart
	 * plots from and `bisect-x` hit-tests against. Built here rather than reading each series' own
	 * `points` array straight into its own `<Spline data={...}>` so every line can share one `data`
	 * array on `<Chart>`: a per-mark `data` prop is exactly what `NetWorthChart.svelte`'s header
	 * comment documents as breaking `bisect-x`'s `flatData` search and `<Highlight>`'s point lookup,
	 * for the same reason there — a hit test against several differently-shaped arrays rather than
	 * one sorted series.
	 *
	 * Every series is projected over the same `years` horizon (`PropertyTracker.svelte` passes one
	 * shared value), so every `points` array is the same length; a row is only ever missing a
	 * property's figure if that assumption is broken by a future caller, in which case the row
	 * simply omits the key rather than plotting a wrong number.
	 *
	 * @param {PropertyEquitySeries[]} series
	 * @returns {Array<{ year: number } & Record<string, number>>}
	 */
	function portfolioEquityRows(series) {
		const yearCount = Math.max(0, ...series.map((s) => s.points.length));

		/** @type {Array<{ year: number } & Record<string, number>>} */
		const rows = [];
		for (let index = 0; index < yearCount; index += 1) {
			/** @type {{ year: number } & Record<string, number>} */
			const row = { year: index };
			for (const s of series) {
				const point = s.points[index];
				if (point) row[s.id] = point.equity;
			}
			rows.push(row);
		}
		return rows;
	}

	/**
	 * One line of the hover tooltip — one row per property, in the same order as the legend.
	 *
	 * @typedef {object} PropertyPortfolioTooltipRow
	 * @property {string} label
	 * @property {string} value
	 * @property {string} color
	 */

	/**
	 * @typedef {object} PropertyPortfolioTooltipReading
	 * @property {string} heading
	 * @property {PropertyPortfolioTooltipRow[]} rows
	 */

	/**
	 * @param {({ year: number } & Record<string, number>) | null | undefined} row
	 * @param {PropertyEquitySeries[]} series
	 * @returns {PropertyPortfolioTooltipReading | null}
	 */
	export function propertyPortfolioTooltipReading(row, series) {
		if (!row || typeof row.year !== 'number' || Number.isNaN(row.year)) return null;

		const rows = series
			.filter((s) => typeof row[s.id] === 'number')
			.map((s) => ({ label: s.name, value: formatMoney(row[s.id]), color: s.color }));

		if (rows.length === 0) return null;

		return { heading: formatYearHeading(row.year), rows };
	}
</script>

<script>
	/**
	 * The combined "all properties" equity chart — issue #279. Additive alongside
	 * `PropertyEquityChart.svelte`'s existing single-property view, which `PropertyTracker.svelte`'s
	 * new toggle keeps rendering unchanged in "Single property" mode; this component is only ever
	 * mounted in "All properties" mode.
	 *
	 * One `<Spline>` per property, every one reading off the single shared `portfolioEquityRows(...)`
	 * array in the module block above rather than carrying its own `data` — see that function's own
	 * comment for why. `$lib/property.js`'s `propertyEquityProjection` is reused unchanged for the
	 * maths, exactly as the single-property chart uses it; this component only decides colour,
	 * layout and which of its three series to draw.
	 *
	 * Only `equity` is plotted, not `value`/`mortgageBalance` too: N properties already means N
	 * lines on this chart, and N properties times three would stop being legible past a handful of
	 * properties. A reader who wants a given property's value/mortgage breakdown has the
	 * single-property view the toggle switches back to.
	 *
	 * Colour comes from #240's `chartSeriesColor(index)`, cycling through the categorical
	 * `--chart-*` design tokens in list order — this chart is that helper's first caller, since it is
	 * the first chart in the app to draw one line per record rather than a fixed, named handful.
	 *
	 * `years` is a prop, not read off `PROPERTY_PROJECTION_YEARS` directly, so
	 * `PropertyTracker.svelte`'s "until age" control (#248/#274) drives this view and the
	 * single-property one identically — this component does not reimplement that control.
	 */
	import { Axis, Chart, Highlight, Spline, Svg, Tooltip } from 'layerchart';

	import { chartSeriesColor } from '$lib/palette.js';
	import { PROPERTY_PROJECTION_YEARS, propertyEquityProjection } from '$lib/property.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 * 	properties?: import('$lib/types.js').Property[],
	 * 	years?: number
	 * }}
	 */
	let { properties = [], years = PROPERTY_PROJECTION_YEARS } = $props();

	/** Same plot-area inset as `PropertyEquityChart.svelte`, sized for this chart's own axis labels. */
	const CHART_PADDING = Object.freeze({ top: 8, right: 16, bottom: 24, left: 56 });

	const series = $derived(
		properties.map((property, index) => ({
			id: property.id,
			name: property.name || 'Unnamed property',
			color: chartSeriesColor(index),
			points: propertyEquityProjection(property, years)
		}))
	);

	const rows = $derived(portfolioEquityRows(series));

	const xDomain = $derived(/** @type {[number, number]} */ ([0, Math.max(1, rows.length - 1)]));

	/** The y domain has to cover every property's equity, not just the first one drawn. */
	const yDomain = $derived.by(() => {
		/** @type {number[]} */
		const values = [0];
		for (const s of series) for (const point of s.points) values.push(point.equity);
		const low = Math.min(...values);
		const high = Math.max(...values);
		const padding = Math.max(1, (high - low) * 0.05);
		return /** @type {[number, number]} */ ([low - padding, high + padding]);
	});

	const xTicks = $derived.by(() => {
		const span = rows.length - 1;
		if (span <= 0) return [0];
		const step = Math.max(1, Math.ceil(span / 6));
		/** @type {number[]} */
		const ticks = [];
		for (let year = 0; year <= span; year += step) ticks.push(year);
		if (ticks.at(-1) !== span) ticks.push(span);
		return ticks;
	});

	// Mirrors `PropertyEquityChart.svelte`'s own `hasPlot`: a spline needs two points to run between,
	// and there is nothing to plot at all with no properties.
	const hasPlot = $derived(series.length > 0 && rows.length >= 2);

	/**
	 * The first series' equity is what `<Chart>`'s own `y` accessor reads — required by the
	 * component, but otherwise unused here: `yDomain` is given explicitly, and `<Highlight>` below
	 * only draws the crosshair rule (`lines`), not a value-scaled marker, so no single series needs to
	 * be singled out as "the" y value the way `PropertyEquityChart.svelte` singles out `equity`.
	 *
	 * @param {{ year: number } & Record<string, number>} row
	 * @returns {number}
	 */
	function primaryY(row) {
		const first = series[0];
		return first ? (row[first.id] ?? 0) : 0;
	}

	/** What a screen reader gets instead of the lines — one sentence per property. */
	const summary = $derived.by(() => {
		if (!hasPlot) return 'Chart comparing projected property equity.';

		/** @type {string[]} */
		const sentences = [];
		for (const s of series) {
			const first = s.points[0];
			const last = s.points.at(-1);
			if (!first || !last) continue;
			const change = last.equity - first.equity;
			const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'level';
			sentences.push(
				`${s.name}: ${formatMoney(first.equity)} today to ${formatMoney(last.equity)} in year ` +
					`${last.year} — ${direction} ${formatMoney(Math.abs(change))}`
			);
		}

		return (
			`Line chart comparing projected equity for ${series.length} propert${series.length === 1 ? 'y' : 'ies'} ` +
			`over ${rows.length - 1} years. ${sentences.join('. ')}.`
		);
	});
</script>

<Card className="p-4">
	<h3 class="text-base font-semibold mb-1">All properties — equity projection</h3>
	<p class="text-sm text-muted-foreground mb-4">
		{years}-year projection of each property's equity (value minus mortgage), one line per property
		— the same value-growth and mortgage-amortisation assumptions as the single-property view.
		Illustrative only, not a prediction.
	</p>

	{#if properties.length === 0}
		<p class="text-sm text-muted-foreground">No properties recorded.</p>
	{:else if hasPlot}
		<!-- Identity is never colour alone: each property is named here, in the same order and colour
		     `<Spline>`/the tooltip/the table below use. -->
		<div
			class="flex flex-wrap items-center gap-4 mb-2 text-xs text-muted-foreground"
			style="display:flex; flex-wrap:wrap; align-items:center; gap:1rem; margin-bottom:0.5rem"
		>
			{#each series as s (s.id)}
				<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
					<span style="display:inline-block; width:1.25rem; height:2px; background:{s.color}"
					></span>
					{s.name}
				</span>
			{/each}
		</div>

		<div
			class="w-full"
			style="height: 16rem; color: hsl(var(--muted-foreground))"
			role="img"
			aria-label={summary}
		>
			<Chart
				data={rows}
				x={(/** @type {{ year: number }} */ row) => row.year}
				y={primaryY}
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

					{#each series as s (s.id)}
						<Spline
							y={(/** @type {Record<string, number>} */ row) => row[s.id]}
							stroke={s.color}
							strokeWidth={2}
						/>
					{/each}

					<Highlight lines />
				</Svg>

				<Tooltip.Root
					x="data"
					props={{ root: { 'aria-hidden': 'true' }, container: {}, content: {} }}
				>
					{#snippet children({ data })}
						{@const reading = propertyPortfolioTooltipReading(data, series)}
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
							{#each series as s (s.id)}
								<th scope="col" style="text-align: right; padding: 0.25rem 0.5rem">{s.name}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each rows as row (row.year)}
							<tr>
								<th
									scope="row"
									style="text-align: left; padding: 0.25rem 0.5rem; font-weight: normal"
								>
									{formatYearHeading(row.year)}
								</th>
								{#each series as s (s.id)}
									<td style="text-align: right; padding: 0.25rem 0.5rem">
										{typeof row[s.id] === 'number' ? formatMoney(row[s.id]) : '—'}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
</Card>
