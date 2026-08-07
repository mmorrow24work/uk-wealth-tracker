<script>
	/**
	 * The net worth chart — README.md → "Net Worth Tracking": "Net worth chart: tracked line +
	 * realistic/optimistic/pessimistic forecast lines with shaded confidence band" (issues #67 and
	 * #81).
	 *
	 * #67 built the tracked line: the months the user actually recorded, one hue, one spline. #81
	 * adds the forecast overlay in a second hue — the realistic scenario solid, the pessimistic and
	 * optimistic scenarios dashed, and the confidence band shaded between them — projected from the
	 * latest snapshot by `$lib/forecast.js` and reshaped for plotting by `$lib/net-worth.js`. That is
	 * why this composes LayerChart's primitives (`Chart` / `Svg` / `Axis` / `Area` / `Spline`) rather
	 * than the `LineChart` wrapper: five marks share one plot area, one pair of accessors and one
	 * pair of scales.
	 *
	 * #82 adds the static presentation layer on top: a `Circle` marker per recorded month — hollow for
	 * an auto-filled one, filled for a hand-recorded one, so the distinction is shape rather than
	 * colour — a caption under the chart naming that shape in words, and a `<details>` "Show as a
	 * table" fallback reading the same `points` array as text. All three read off `netWorthSeries(...)`
	 * alone; the forecast band gets no markers, since it is a projection rather than a set of recorded
	 * months.
	 *
	 * Still missing, and #85's rather than this component's: the hover tooltip, the crosshair/point
	 * highlight, and theming LayerChart's own chrome off this app's shadcn tokens (it ships a
	 * `layerchart/styles/shadcn-svelte.css` bridge). Nothing here imports that sheet; the axis rule,
	 * ticks and gridlines are given explicit token colours instead, and everything else inherits
	 * `currentColor` from the container. Until #85 lands the chart carries an `aria-label` summarising
	 * what the lines do — a summary rather than the data, which is what the table fallback below is
	 * for.
	 *
	 * All the arithmetic lives in `$lib/net-worth.js` and `$lib/forecast.js` — this component decides
	 * only how the series look. Note in particular that both date formatters below are pinned to
	 * `timeZone: 'UTC'`: the x values are UTC month starts, and formatting one back in local time
	 * renders a January snapshot as "Dec" for every user west of Greenwich.
	 */
	import { Area, Axis, Chart, Circle, Spline, Svg } from 'layerchart';

	import { DEFAULT_GROWTH_RATE } from '$lib/auto-invest.js';
	import { DEFAULT_SCENARIO_SPREAD, forecastFromEntries } from '$lib/forecast.js';
	import {
		autoFilledPointCount,
		forecastBandSeries,
		netWorthChartMonthTicks,
		netWorthChartXDomain,
		netWorthChartYExtent,
		netWorthSeries
	} from '$lib/net-worth.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 * 	monthlyEntries?: import('$lib/types.js').MonthlyEntry[],
	 * 	growthRate?: number,
	 * 	spread?: number,
	 * 	forecastYears?: number,
	 * 	showForecast?: boolean
	 * }}
	 */
	let {
		monthlyEntries = [],
		growthRate = DEFAULT_GROWTH_RATE,
		spread = DEFAULT_SCENARIO_SPREAD,
		forecastYears = 10,
		showForecast = true
	} = $props();

	/**
	 * Horizons the picker offers. Not spec — README.md gives the forecast no horizon list — but a
	 * fixed handful beats a free-text field here: this chart has to show a recorded history and a
	 * projection in one plot, and at 30 years a two-year history is four pixels wide. The forecast
	 * *tab* is where an arbitrary horizon belongs (`ForecastProjections` has the number field), so
	 * this is a zoom control rather than a second set of assumptions.
	 */
	const FORECAST_HORIZONS = Object.freeze([5, 10, 20, 30]);

	// Per-instance, because a hard-coded `id` would collide the moment a second chart appears on a
	// page — and a duplicated `id` silently re-points the first label at the wrong control.
	const uid = $props.id();

	// The props seed both controls once; from then on the user owns them, exactly as
	// `ForecastProjections` treats its own assumptions.
	// svelte-ignore state_referenced_locally
	let forecastOn = $state(showForecast);
	// svelte-ignore state_referenced_locally
	let horizon = $state(forecastYears);

	const points = $derived(netWorthSeries(monthlyEntries));
	const first = $derived(points[0]);
	const latest = $derived(points.at(-1));
	const autoFilledCount = $derived(autoFilledPointCount(points));

	/**
	 * The projection behind the overlay, or `null` when there is nothing to project from or the user
	 * has switched it off. `forecastFromEntries` anchors on the latest recorded month itself, so the
	 * forecast's first point is the tracked line's last point to the penny and the two join without a
	 * step — see `$lib/net-worth.js` → `forecastBandSeries`.
	 */
	const forecast = $derived.by(() => {
		if (!forecastOn || points.length === 0) return null;
		return forecastFromEntries(
			monthlyEntries,
			{ months: Math.round(Number(horizon) * 12), spread },
			{ growthRate }
		);
	});

	const band = $derived(forecastBandSeries(forecast));

	const xDomain = $derived(netWorthChartXDomain(points, band));
	const yDomain = $derived(netWorthChartYExtent(points, band));
	const xTicks = $derived(netWorthChartMonthTicks(points, band));

	// A spline needs two points to run between. One recorded month draws nothing on its own — but one
	// recorded month plus a forecast draws the whole overlay from it, which is the case #67 could not
	// plot and this issue can.
	const hasPlot = $derived(points.length >= 2 || band.length >= 2);

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/**
	 * Axis labels get the compact form (£120k) because a y axis has room for four characters, not
	 * ten. The exact latest figure is spelled out above the chart, so the precision the axis drops
	 * is never the only place a number appears.
	 */
	const axisCurrencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		notation: 'compact',
		maximumFractionDigits: 1
	});

	const monthFormatter = new Intl.DateTimeFormat('en-GB', {
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});

	const axisMonthFormatter = new Intl.DateTimeFormat('en-GB', {
		month: 'short',
		year: '2-digit',
		timeZone: 'UTC'
	});

	/** @param {number} amount @returns {string} */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} amount @returns {string} */
	function formatAxisMoney(amount) {
		return axisCurrencyFormatter.format(amount);
	}

	/** @param {{ month: number, year: number }} value @returns {string} */
	function formatMonth(value) {
		return monthFormatter.format(new Date(Date.UTC(value.year, value.month - 1, 1)));
	}

	/** @param {Date} value @returns {string} */
	function formatAxisMonth(value) {
		return axisMonthFormatter.format(value);
	}

	/** @param {number} rate @returns {string} A growth rate with its trailing `.0` dropped. */
	function formatRate(rate) {
		return `${Math.round(rate * 10) / 10}%`;
	}

	const bandEnd = $derived(band.at(-1) ?? null);

	/**
	 * What a screen reader gets instead of the lines. Deliberately the shape of the series — where
	 * they start, where they end, how wide the band gets — rather than a reading of every month,
	 * which is what #82's table fallback is for.
	 */
	const summary = $derived.by(() => {
		/** @type {string[]} */
		const sentences = [];

		if (first && latest && points.length >= 2) {
			const change = latest.net_worth - first.net_worth;
			const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'level';
			sentences.push(
				`Line chart of tracked net worth over ${points.length} recorded months: ` +
					`${formatMoney(first.net_worth)} in ${formatMonth(first)}, ` +
					`${formatMoney(latest.net_worth)} in ${formatMonth(latest)} — ${direction} ` +
					`${formatMoney(Math.abs(change))}.`
			);
		} else if (latest) {
			sentences.push(
				`Chart of net worth from one recorded month, ${formatMoney(latest.net_worth)} in ` +
					`${formatMonth(latest)}.`
			);
		} else {
			sentences.push('Chart of tracked net worth.');
		}

		if (forecast && bandEnd) {
			sentences.push(
				`Forecast to ${formatMonth(bandEnd)}: ${formatMoney(bandEnd.mid)} realistic at ` +
					`${formatRate(forecast.rates.realistic)} a year, in a confidence band from ` +
					`${formatMoney(bandEnd.low)} pessimistic to ${formatMoney(bandEnd.high)} optimistic.`
			);
		}

		return sentences.join(' ');
	});
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Net worth over time</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Every month you have recorded, holdings less debts, carried forward under three growth
		assumptions. Anything you have excluded from net worth — a mortgage already counted as property
		equity, say — is left out here too. Months you skipped stay empty rather than being guessed at;
		the auto-invest fill below is what closes a gap.
	</p>

	{#if points.length === 0}
		<p class="text-sm text-muted-foreground">
			No snapshots yet. Record a month's holdings and debts below and the line starts here.
		</p>
	{:else if latest && first}
		<p class="text-2xl font-semibold tabular-nums">{formatMoney(latest.net_worth)}</p>
		{#if points.length === 1}
			<p class="text-sm text-muted-foreground mb-2">
				{formatMonth(latest)} — your first snapshot.
				{#if hasPlot}
					The tracked line needs a second month to run between, so what you see plotted is the
					forecast from this one.
				{:else}
					A line needs two months to run between, so this chart fills in once you record another —
					or switch the forecast back on and it runs from this month.
				{/if}
			</p>
		{:else}
			<p class="text-sm text-muted-foreground mb-2">
				at {formatMonth(latest)} · {points.length} months recorded since {formatMonth(first)}
			</p>
		{/if}

		<!-- The overlay's two controls. Growth rate and scenario spread are deliberately *not* here:
		     they are assumptions, they belong to the forecast tab's sliders, and a second set of them
		     on the dashboard would be two places to change the same number.

		     The flex layout is inline as well as classed, for the reason given at the plot area below:
		     with Tailwind's utilities not currently reaching the page, `gap-4` renders as no gap at
		     all and the two controls read as one run-on label ("Show forecastHorizon"). -->
		<div
			class="flex flex-wrap items-center gap-4 mb-2"
			style="display:flex; flex-wrap:wrap; align-items:center; gap:1rem; margin-bottom:0.5rem"
		>
			<label class="flex items-center gap-1.5 text-sm" style="display:flex; gap:0.375rem">
				<input type="checkbox" bind:checked={forecastOn} />
				Show forecast
			</label>
			{#if forecastOn}
				<label
					class="flex items-center gap-1.5 text-sm"
					style="display:flex; align-items:center; gap:0.375rem"
					for="{uid}-horizon"
				>
					Horizon
					<select
						id="{uid}-horizon"
						bind:value={horizon}
						class="border border-input rounded-md px-2 py-1 text-sm"
					>
						{#each FORECAST_HORIZONS as years (years)}
							<option value={years}>{years} years</option>
						{/each}
					</select>
				</label>
			{/if}
		</div>

		{#if forecast}
			<p class="text-xs text-muted-foreground mb-2">
				Projected from your {formatMonth(latest)} snapshot at {formatRate(forecast.rates.realistic)} a
				year, give or take {forecast.spread} percentage points. Illustrative only — a long-run average
				held flat, not a prediction; the forecast tab is where you change the assumptions.
			</p>
		{/if}

		{#if hasPlot}
			<!-- Identity is never colour alone: each series is named here, and the forecast lines are
			     dashed as well as differently hued. Swatch sizes and the row's spacing are inline
			     rather than utility classes for the same reason the plot height below is — see the
			     comment there. A legend whose swatches have no size and whose entries have no gap
			     between them is not a legend. -->
			<div
				class="flex flex-wrap items-center gap-4 mb-2 text-xs text-muted-foreground"
				style="display:flex; flex-wrap:wrap; align-items:center; gap:1rem; margin-bottom:0.5rem"
			>
				<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
					<span
						style="display:inline-block; width:1.25rem; height:2px; background:hsl(var(--chart-1))"
					></span>
					Tracked
				</span>
				{#if forecast}
					<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
						<span
							style="display:inline-block; width:1.25rem; height:0; border-top:2px dashed hsl(var(--chart-2))"
						></span>
						Realistic ({formatRate(forecast.rates.realistic)})
					</span>
					<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
						<span
							style="display:inline-block; width:1.25rem; height:0.7rem; background:hsl(var(--chart-2) / 0.16); border-top:1px dashed hsl(var(--chart-2)); border-bottom:1px dashed hsl(var(--chart-2))"
						></span>
						Pessimistic–optimistic ({formatRate(forecast.rates.pessimistic)}–{formatRate(
							forecast.rates.optimistic
						)})
					</span>
				{/if}
			</div>

			<!-- `color` here is what LayerChart's axis chrome inherits: its tick marks and rule are
			     drawn at 50% of `currentColor`, its tick labels at full. The gridlines get an explicit
			     border token instead, since 10% of a mid-grey is all but invisible on white.

			     The height is inline rather than a `h-72` utility on purpose: a `<Chart>` measures this
			     element and draws nothing at all if it comes back zero-high, so the one declaration the
			     chart cannot render without is the one that must not depend on Tailwind emitting a
			     class. It currently does not — the app's `app.css` still uses v3's `@tailwind`
			     directives under Tailwind v4, so most utilities never reach the page. That is a
			     pre-existing, app-wide problem and its own issue; this component just declines to be
			     broken by it. -->
			<div
				class="w-full"
				style="height: 18rem; color: hsl(var(--muted-foreground))"
				role="img"
				aria-label={summary}
			>
				<Chart
					data={points}
					x={(/** @type {{ date: Date }} */ point) => point.date}
					y={(/** @type {import('$lib/net-worth.js').NetWorthPoint} */ point) => point.net_worth}
					{xDomain}
					{yDomain}
					padding={{ top: 8, right: 32, bottom: 24, left: 56 }}
				>
					<Svg>
						<Axis
							placement="left"
							format={formatAxisMoney}
							ticks={5}
							grid={{ stroke: 'hsl(var(--border))' }}
						/>
						<Axis placement="bottom" ticks={xTicks} format={formatAxisMonth} rule />

						<!-- Band first, so the four lines sit on top of the shading rather than under it.
						     The fill, the two dashed edges and the realistic line are all read off one
						     array (`band`) — the shading's edges and the outer scenario lines are the same
						     numbers by construction, not two series that happen to agree. -->
						{#if band.length >= 2}
							<Area
								data={band}
								y0={(/** @type {{ low: number }} */ point) => point.low}
								y1={(/** @type {{ high: number }} */ point) => point.high}
								fill="hsl(var(--chart-2) / 0.16)"
							/>
							<Spline
								data={band}
								y={(/** @type {{ low: number }} */ point) => point.low}
								stroke="hsl(var(--chart-2))"
								strokeWidth={1}
								stroke-dasharray="3 3"
								opacity={0.8}
							/>
							<Spline
								data={band}
								y={(/** @type {{ high: number }} */ point) => point.high}
								stroke="hsl(var(--chart-2))"
								strokeWidth={1}
								stroke-dasharray="3 3"
								opacity={0.8}
							/>
							<Spline
								data={band}
								y={(/** @type {{ mid: number }} */ point) => point.mid}
								stroke="hsl(var(--chart-2))"
								strokeWidth={2}
								stroke-dasharray="6 4"
							/>
						{/if}

						<Spline stroke="hsl(var(--chart-1))" strokeWidth={2} />

						<!-- One marker per recorded month, read off the same `points` array the line itself
						     draws from — the forecast is a projection, not a recorded month, so it gets no
						     markers. Identity is never colour alone (see the legend above): a recorded month is
						     a filled dot, an auto-filled one a hollow ring, and `fill` is given as a function so
						     both shapes come off one `Circle` in data mode rather than a second pass over the
						     points for the auto-filled subset. -->
						<Circle
							data={points}
							cx={(/** @type {import('$lib/net-worth.js').NetWorthPoint} */ point) => point.date}
							cy={(/** @type {import('$lib/net-worth.js').NetWorthPoint} */ point) =>
								point.net_worth}
							r={4}
							fill={(/** @type {import('$lib/net-worth.js').NetWorthPoint} */ point) =>
								point.auto_filled ? 'hsl(var(--card))' : 'hsl(var(--chart-1))'}
							stroke="hsl(var(--chart-1))"
							strokeWidth={2}
						/>
					</Svg>
				</Chart>
			</div>

			{#if autoFilledCount > 0}
				<p class="text-xs text-muted-foreground mt-1" style="margin-top: 0.25rem">
					{autoFilledCount} of the {points.length} month{points.length === 1 ? '' : 's'} shown
					{autoFilledCount === 1 ? 'was' : 'were'} auto-filled by the auto-invest projection below, rather
					than recorded by hand — shown as a hollow marker rather than a filled one.
				</p>
			{/if}
		{/if}

		<!-- The accessibility fallback for the SVG line above: the same `points` array as text, so a
		     screen reader or a printout gets every recorded month's figures rather than the `aria-label`
		     summary's shape-of-the-line sentence alone. Shown whenever there is a recorded month to list,
		     independent of `hasPlot` — a single recorded month with the forecast switched off draws no
		     line at all, but it is still one row this table can give a reader that the headline figure
		     above does not: which month it was auto-filled or not. -->
		{#if points.length > 0}
			<details class="text-sm mt-2" style="margin-top: 0.5rem">
				<summary class="cursor-pointer text-muted-foreground" style="cursor: pointer">
					Show as a table
				</summary>
				<div class="overflow-x-auto mt-2" style="overflow-x: auto; margin-top: 0.5rem">
					<table class="w-full text-sm tabular-nums" style="width: 100%; border-collapse: collapse">
						<thead>
							<tr>
								<th scope="col" style="text-align: left; padding: 0.25rem 0.5rem">Month</th>
								<th scope="col" style="text-align: right; padding: 0.25rem 0.5rem">Investments</th>
								<th scope="col" style="text-align: right; padding: 0.25rem 0.5rem">Debts</th>
								<th scope="col" style="text-align: right; padding: 0.25rem 0.5rem">Net worth</th>
								<th scope="col" style="text-align: left; padding: 0.25rem 0.5rem">Auto-filled</th>
							</tr>
						</thead>
						<tbody>
							{#each points as point (point.date.getTime())}
								<tr>
									<th
										scope="row"
										style="text-align: left; padding: 0.25rem 0.5rem; font-weight: normal"
									>
										{formatMonth(point)}
									</th>
									<td style="text-align: right; padding: 0.25rem 0.5rem"
										>{formatMoney(point.investments)}</td
									>
									<td style="text-align: right; padding: 0.25rem 0.5rem"
										>{formatMoney(point.debts)}</td
									>
									<td style="text-align: right; padding: 0.25rem 0.5rem"
										>{formatMoney(point.net_worth)}</td
									>
									<td style="text-align: left; padding: 0.25rem 0.5rem"
										>{point.auto_filled ? 'Yes' : 'No'}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		{/if}
	{/if}
</Card>
