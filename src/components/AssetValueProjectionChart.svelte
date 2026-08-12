<script module>
	/**
	 * Formatters + tooltip reading for the future value projection chart — issue #39's "Future value
	 * projection chart". Lifted into the module block for the same two reasons
	 * `PropertyEquityChart.svelte` gives: testable without a pointer to hover, and one `Intl`
	 * formatter per app rather than one per mounted chart.
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
	 * @typedef {object} AssetProjectionTooltipRow
	 * @property {string} label
	 * @property {string} value
	 * @property {string} [color]
	 */

	/**
	 * @typedef {object} AssetProjectionTooltipReading
	 * @property {string} heading
	 * @property {AssetProjectionTooltipRow[]} rows
	 */

	/**
	 * @param {import('$lib/assets.js').AssetValueProjectionPoint | null | undefined} point
	 * @returns {AssetProjectionTooltipReading | null}
	 */
	export function assetProjectionTooltipReading(point) {
		if (!point || typeof point.netValue !== 'number' || Number.isNaN(point.netValue)) return null;

		return {
			heading: formatYearHeading(point.year),
			rows: [
				{ label: 'Net position', value: formatMoney(point.netValue), color: 'hsl(var(--chart-1))' },
				{ label: 'Value', value: formatMoney(point.value), color: 'hsl(var(--chart-2))' },
				{
					label: 'Holding cost paid',
					value: formatMoney(point.cumulativeHoldingCost),
					color: 'hsl(var(--destructive))'
				}
			]
		};
	}
</script>

<script>
	/**
	 * The future value projection chart — README.md → "Physical Assets Tracker": "Future value
	 * projection chart" (issue #39, alongside gain/loss and CAGR in `AssetsTracker.svelte`).
	 *
	 * One asset in, one chart out: `$lib/assets.js`'s {@link assetValueProjection} does the
	 * arithmetic (`current_value` compounding at `expected_growth`, holding cost accruing forward
	 * from today), and this component only decides how the two resulting lines look — the same split
	 * `PropertyEquityChart.svelte` draws for its own three-line chart. Value is drawn thinner behind
	 * the net position line, so a reader can see how much of the difference is the holding cost
	 * eating into the raw value growth.
	 */
	import { Axis, Chart, Highlight, Spline, Svg, Tooltip } from 'layerchart';

	import { ASSET_PROJECTION_YEARS, assetValueProjection } from '$lib/assets.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 * 	asset?: import('$lib/types.js').Asset | null,
	 * 	years?: number
	 * }}
	 */
	let { asset = null, years = ASSET_PROJECTION_YEARS } = $props();

	/**
	 * The plot area's inset — same shape as `PropertyEquityChart.svelte`'s `CHART_PADDING`, sized for
	 * this chart's own axis labels.
	 */
	const CHART_PADDING = Object.freeze({ top: 8, right: 16, bottom: 24, left: 56 });

	const points = $derived(assetValueProjection(asset, years));
	const first = $derived(points[0] ?? null);
	const last = $derived(points.at(-1) ?? null);

	const xDomain = $derived(/** @type {[number, number]} */ ([0, Math.max(1, points.length - 1)]));

	/**
	 * The y domain has to cover both series, not just the one the chart is keyed on
	 * (`point.netValue`) — a value line that runs above the net position line would otherwise be
	 * clipped off the top of the plot.
	 */
	const yDomain = $derived.by(() => {
		/** @type {number[]} */
		const values = [0];
		for (const point of points) values.push(point.value, point.netValue);
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
		if (!asset || !first || !last || !hasPlot) return 'Chart of projected asset value.';

		const change = last.netValue - first.netValue;
		const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'level';
		return (
			`Line chart projecting ${asset.name || 'this asset'}'s value over ${last.year} years: ` +
			`${formatMoney(first.value)} today, ${formatMoney(last.value)} in year ${last.year}, ` +
			`net of holding costs ${direction} ${formatMoney(Math.abs(change))} to ${formatMoney(last.netValue)}.`
		);
	});
</script>

<Card className="p-4">
	<h3 class="text-base font-semibold mb-1">
		{asset?.name ? `${asset.name} — value projection` : 'Value projection'}
	</h3>
	<p class="text-sm text-muted-foreground mb-4">
		{years}-year projection: current value compounding at {asset?.expected_growth ?? 0}% a year,
		against holding costs of {asset?.holding_cost ? formatMoney(asset.holding_cost) : '£0'}/yr paid
		from today onward. Illustrative only — a long-run growth assumption held flat, not a prediction.
	</p>

	{#if !asset}
		<p class="text-sm text-muted-foreground">No asset selected.</p>
	{:else if hasPlot && first && last}
		<p class="text-2xl font-semibold tabular-nums">{formatMoney(last.netValue)}</p>
		<p class="text-sm text-muted-foreground mb-2">
			projected net position in year {last.year}, from {formatMoney(first.netValue)} today
		</p>

		<div
			class="flex flex-wrap items-center gap-4 mb-2 text-xs text-muted-foreground"
			style="display:flex; flex-wrap:wrap; align-items:center; gap:1rem; margin-bottom:0.5rem"
		>
			<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
				<span
					style="display:inline-block; width:1.25rem; height:2px; background:hsl(var(--chart-1))"
				></span>
				Net position
			</span>
			<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
				<span
					style="display:inline-block; width:1.25rem; height:2px; background:hsl(var(--chart-2))"
				></span>
				Value
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
				x={(/** @type {import('$lib/assets.js').AssetValueProjectionPoint} */ point) => point.year}
				y={(/** @type {import('$lib/assets.js').AssetValueProjectionPoint} */ point) =>
					point.netValue}
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
						y={(/** @type {import('$lib/assets.js').AssetValueProjectionPoint} */ point) =>
							point.value}
						stroke="hsl(var(--chart-2))"
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
						{@const reading = assetProjectionTooltipReading(data)}
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
								Holding cost paid
							</th>
							<th scope="col" style="text-align: right; padding: 0.25rem 0.5rem">Net position</th>
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
									>{formatMoney(point.cumulativeHoldingCost)}</td
								>
								<td style="text-align: right; padding: 0.25rem 0.5rem"
									>{formatMoney(point.netValue)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
</Card>
