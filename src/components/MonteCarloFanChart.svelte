<script module>
	/**
	 * The series, domains, ticks and wording behind the Monte Carlo fan chart — issue #153.
	 *
	 * All of it lives in this `<script module>` block for the reason the other charted components
	 * here give: a `<Chart>` measures its container via `ResizeObserver` before it draws anything,
	 * there is no container to measure under `svelte/server`, and so a rendered test can assert no
	 * `<Area>` or `<Spline>` path at all. Lifting the maths out as pure functions is what makes the
	 * shape of the fan testable rather than only its caption. The `Intl` formatters are up here for
	 * the second reason `NetWorthChart.svelte` gives too — they depend on no prop, so one per app
	 * beats one per mounted chart.
	 *
	 * **A percentile line is not a path.** `MonteCarloBandPoint`'s own docs in `$lib/monte-carlo.js`
	 * spell this out: the pot that is 5th-percentile at 70 is a different simulation from the one
	 * that is 5th-percentile at 90, so reading along the p5 edge does not describe anybody's
	 * retirement. Everything named in this file therefore talks about the *spread at each age* —
	 * `fanChartSummaryText` says "the worst 5% of paths", never "the worst path" — and the median is
	 * drawn as a line only because a distribution needs a middle, not because a simulation walked it.
	 */

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/**
	 * Axis labels get the compact form (£120k) for the reason `NetWorthChart.svelte` gives: an axis
	 * has room for four characters, not ten, and every figure the axis rounds off is spelled out in
	 * full in the table fallback below.
	 */
	const axisCurrencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		notation: 'compact',
		maximumFractionDigits: 1
	});

	/** @param {number} amount @returns {string} */
	export function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} amount @returns {string} */
	function formatAxisMoney(amount) {
		return axisCurrencyFormatter.format(amount);
	}

	/** @param {number} age @returns {string} */
	function formatAxisAge(age) {
		return String(Math.round(age));
	}

	/**
	 * The rungs of the fan, in the five percentiles this chart actually draws.
	 *
	 * `MonteCarloSummary.band` carries all seven of `MONTE_CARLO_PERCENTILES` (p5, p10, p25, p50,
	 * p75, p90, p95); p10 and p90 are deliberately dropped rather than drawn as a third nested band,
	 * because three fills of one hue stop reading as "wider is less likely" and start reading as
	 * three separate things.
	 *
	 * @typedef {object} FanChartPoint
	 * @property {number} year Years from the start of the run; `0` is today.
	 * @property {number} age
	 * @property {number} calendarYear
	 * @property {number} p5 Pot at the 5th percentile of paths at this age (£).
	 * @property {number} p25
	 * @property {number} median The p50.
	 * @property {number} p75
	 * @property {number} p95
	 */

	/**
	 * @param {unknown} value
	 * @returns {number} `value` if it is a usable number, `0` otherwise — a `NaN` reaching a scale
	 *   produces a path with `NaN` in its `d` attribute, which browsers drop silently, so one bad
	 *   figure would blank the whole fan rather than one rung of it.
	 */
	function asMoney(value) {
		return typeof value === 'number' && Number.isFinite(value) ? value : 0;
	}

	/**
	 * The band, reshaped for plotting: one object per year carrying the five percentiles as plain
	 * properties, since `<Area>`/`<Spline>` accessors want `point.p5` rather than
	 * `point.percentiles.p5`.
	 *
	 * The `Math.max` chain is defensive rather than corrective. `percentileOf` is monotonic in its
	 * percentile and `roundMoney` is monotonic in its input, so a band out of `simulateRetirement()`
	 * is always ordered — but an `<Area>` handed `y0 > y1` renders inside out, turning a hand-built
	 * or half-migrated summary into a chart that is wrong rather than one that is missing.
	 *
	 * @param {import('$lib/monte-carlo.js').MonteCarloSummary | null | undefined} summary
	 * @returns {FanChartPoint[]}
	 */
	export function fanChartSeries(summary) {
		if (!summary || !Array.isArray(summary.band)) return [];

		return summary.band.map((point) => {
			const percentiles = point?.percentiles ?? {};
			const p5 = asMoney(percentiles.p5);
			const p25 = Math.max(p5, asMoney(percentiles.p25));
			const median = Math.max(p25, asMoney(point?.median ?? percentiles.p50));
			const p75 = Math.max(median, asMoney(percentiles.p75));
			const p95 = Math.max(p75, asMoney(percentiles.p95));

			return {
				year: asMoney(point?.year),
				age: asMoney(point?.age),
				calendarYear: asMoney(point?.calendarYear),
				p5,
				p25,
				median,
				p75,
				p95
			};
		});
	}

	/**
	 * Which of the four things this component can show.
	 *
	 * `no_summary` and `no_plot` are about having nothing to draw; `all_zero` is about having
	 * something to draw that would say nothing — a fan whose every percentile at every age is £0,
	 * which is what a plan with no pots, no contributions and nothing but promised income produces.
	 * Drawn, it is a flat line along the axis under an empty y scale; said in words, it is the one
	 * fact a reader needs.
	 *
	 * @typedef {'no_summary' | 'no_plot' | 'all_zero' | 'ready'} FanChartState
	 */

	/**
	 * @param {import('$lib/monte-carlo.js').MonteCarloSummary | null | undefined} summary
	 * @param {FanChartPoint[]} series Already built by {@link fanChartSeries} from that `summary`, so
	 *   this reads what will actually be plotted rather than re-deriving it a second way.
	 * @returns {FanChartState}
	 */
	export function fanChartState(summary, series) {
		if (!summary || !Array.isArray(summary.band)) return 'no_summary';
		// An area and a spline both need two points to run between; one rung is not a fan.
		if (series.length < 2) return 'no_plot';
		if (series.every((point) => point.p95 <= 0)) return 'all_zero';
		return 'ready';
	}

	/**
	 * The x domain, in ages — the first and last rung of the band, with no padding either side. The
	 * fan starts at today's pot, a single known figure every path shares, so an inset there would
	 * only put whitespace where the one certain point is.
	 *
	 * @param {FanChartPoint[]} series
	 * @returns {[number, number]}
	 */
	export function fanChartXDomain(series) {
		if (series.length === 0) return [0, 1];
		const first = series[0].age;
		const last = series[series.length - 1].age;
		return last > first ? [first, last] : [first, first + 1];
	}

	/**
	 * The y domain, in pounds, anchored at £0 rather than at the lowest percentile.
	 *
	 * Zero is not an arbitrary floor on this chart — it is depletion, the thing the whole simulation
	 * is about. A domain starting at the p5 minimum would put a pot that runs dry partway up the
	 * plot and make the failures invisible, which is exactly backwards for a chart drawn under a
	 * probability-of-success headline.
	 *
	 * @param {FanChartPoint[]} series
	 * @returns {[number, number]}
	 */
	export function fanChartYDomain(series) {
		let high = 0;
		for (const point of series) high = Math.max(high, point.p95, point.median);
		// A non-zero top even for an all-zero band: `fanChartState` keeps that case away from the
		// plot, but a domain of `[0, 0]` is a broken scale rather than a flat chart, and this
		// function should not be the one that depends on its caller having checked.
		if (high <= 0) return [0, 1];
		return [0, high * 1.05];
	}

	/**
	 * Ages to label along the bottom.
	 *
	 * Three ages are labelled whatever else happens — today, the target age, and the retirement age
	 * the marker is drawn at — because those are the three a reader actually looks for. The rest are
	 * an even fill between them, and any of that fill landing within half a step of an anchor is
	 * dropped rather than printed on top of it. The browser drive for this issue found both cases
	 * for real on a 40–95 run: an even tick at 58 two years short of retirement at 60, and one at 94
	 * a year short of the target age of 95.
	 *
	 * @param {FanChartPoint[]} series
	 * @param {number | null} retirementAge As returned by {@link fanChartRetirementMarker} — `null`
	 *   when retirement falls outside the plotted ages, in which case only the two ends are anchors.
	 * @param {number} [target] Roughly how many ticks to aim for.
	 * @returns {number[]}
	 */
	export function fanChartAgeTicks(series, retirementAge, target = 7) {
		if (series.length === 0) return [];

		const first = series[0].age;
		const last = series[series.length - 1].age;
		if (last <= first) return [first];

		const step = Math.max(1, Math.round((last - first) / Math.max(1, target - 1)));

		const anchors = [first, last];
		if (retirementAge !== null && retirementAge > first && retirementAge < last) {
			anchors.push(retirementAge);
		}

		const ticks = [...anchors];
		for (let age = first + step; age < last; age += step) {
			if (anchors.every((anchor) => Math.abs(age - anchor) >= step / 2)) ticks.push(age);
		}

		return ticks.sort((a, b) => a - b);
	}

	/**
	 * The age to draw the retirement marker at, or `null` when there is nothing useful to mark.
	 *
	 * Only ever inside the plotted range, never on an edge: a rule drawn on top of the y axis or the
	 * right-hand border is indistinguishable from the chart's own frame, and says nothing a reader
	 * could not already see. Somebody already retired (retirement age at or before today's age) and
	 * somebody whose run stops before they retire both get no marker and no legend entry for one.
	 *
	 * @param {import('$lib/monte-carlo.js').MonteCarloSummary | null | undefined} summary
	 * @param {FanChartPoint[]} series
	 * @returns {number | null}
	 */
	export function fanChartRetirementMarker(summary, series) {
		const age = summary?.input?.retirementAge;
		if (typeof age !== 'number' || !Number.isFinite(age)) return null;
		if (series.length < 2) return null;

		const first = series[0].age;
		const last = series[series.length - 1].age;
		return age > first && age < last ? age : null;
	}

	/**
	 * The rows of the table fallback: p5, median and p95 at five-yearly ages.
	 *
	 * Five-yearly *on the age*, not on the index — an age of 40 lists 40, 45, 50 rather than 40, 45,
	 * 50 counted from wherever the run happened to start, so two people's tables line up on the same
	 * birthdays. Today's age and the target age are always included whether or not they land on a
	 * multiple of five: the first is the pot the reader actually has, and the last is the age the
	 * headline probability above is about.
	 *
	 * @param {FanChartPoint[]} series
	 * @param {number} [step]
	 * @returns {FanChartPoint[]}
	 */
	export function fanChartTableRows(series, step = 5) {
		if (series.length === 0) return [];

		const first = series[0];
		const last = series[series.length - 1];
		const every = Math.max(1, Math.round(step));

		return series.filter(
			(point) => point === first || point === last || Math.round(point.age) % every === 0
		);
	}

	/**
	 * What a screen reader gets instead of the fan — the shape of the distribution in words.
	 *
	 * Deliberately the spread at three moments (today, retirement, the target age) rather than a
	 * reading of every year, which is what the table fallback is for. Every sentence names a *share
	 * of paths* rather than a path, for the reason at the top of this block.
	 *
	 * @param {import('$lib/monte-carlo.js').MonteCarloSummary | null | undefined} summary
	 * @param {FanChartPoint[]} series
	 * @returns {string}
	 */
	export function fanChartSummaryText(summary, series) {
		if (!summary || series.length < 2) {
			return 'Fan chart of the simulated pension and ISA pot. Nothing simulated yet.';
		}

		const first = series[0];
		const last = series[series.length - 1];
		const retirementAge = summary.input?.retirementAge;
		const atRetirement = series.find((point) => point.age === retirementAge);

		/** @type {string[]} */
		const sentences = [
			`Fan chart of the simulated pension and ISA pot across ${summary.paths.toLocaleString('en-GB')} paths, ` +
				`from age ${Math.round(first.age)} in ${first.calendarYear} to age ${Math.round(last.age)} in ` +
				`${last.calendarYear}. Shaded bands show the middle 50% and the middle 90% of paths at each age, ` +
				`with the median through them. Starting pot ${formatMoney(first.median)}.`
		];

		if (atRetirement && retirementAge !== first.age && retirementAge !== last.age) {
			sentences.push(
				`At retirement, age ${Math.round(retirementAge)}: median ${formatMoney(atRetirement.median)}, ` +
					`with 9 paths in 10 between ${formatMoney(atRetirement.p5)} and ${formatMoney(atRetirement.p95)}.`
			);
		}

		sentences.push(
			`At age ${Math.round(last.age)}: median ${formatMoney(last.median)}, with 9 paths in 10 between ` +
				`${formatMoney(last.p5)} and ${formatMoney(last.p95)}.`
		);

		return sentences.join(' ');
	}
</script>

<script>
	/**
	 * The Monte Carlo fan chart — README.md → Phase 2, "Monte Carlo Retirement Simulator" (issue
	 * #153), the picture behind #132's probability-of-success headline.
	 *
	 * #132 says what share of 5,000 simulated paths still had money left at the target age. That is
	 * one number standing in for a whole distribution, and a reader given only the number cannot see
	 * whether the failures fail narrowly or catastrophically, or how wide the good outcomes run. This
	 * draws the distribution those numbers summarise: `summary.band`, one rung per year, as two
	 * nested shaded bands (the middle 90% of paths, and the middle 50% inside it) with the median
	 * through the middle.
	 *
	 * It composes LayerChart's primitives (`Chart` / `Svg` / `Axis` / `Area` / `Spline` / `Rule`)
	 * directly, the established pattern in `NetWorthChart.svelte`, rather than the simplified
	 * `LineChart` wrapper: four marks share one plot area, one pair of accessors and one pair of
	 * scales, and the `LineChart` wrapper has no way to express a band at all.
	 *
	 * **One hue, three alphas.** `app.css`'s own note on the `--chart-*` tokens explains why the
	 * three forecast scenarios on the net worth chart share `--chart-2` rather than spending three
	 * categorical slots: they are one projection under three assumptions, not three unrelated
	 * series. The same reasoning applies with more force here — the two bands and the median are one
	 * distribution read at five percentiles, so they are one hue at three opacities, and the reader
	 * is told "wider is less likely" rather than "these are different things". The two alphas (0.18
	 * outer, 0.38 inner) were settled by looking at the rendered chart in both themes rather than
	 * picked on paper: alpha over a near-black surface buys much less apparent contrast than the same
	 * alpha over white, and the first pair tried (0.14/0.3) left the outer band barely separable from
	 * the card behind it in dark mode.
	 *
	 * **Out of scope, deliberately** (the whole point of splitting this off #132): no hover tooltip
	 * or crosshair, no sample-path overlay from `summary.samplePaths`, and no survival curve from
	 * `summary.survival`. `tooltipContext={false}` below is what says so to LayerChart — with no
	 * `<Tooltip.Root>` and no `<Highlight>` there is nothing to hit-test for, and a chart that
	 * silently runs a bisect on every pointer move for nobody is just a cost.
	 *
	 * Everything computable is in the `<script module>` block above and unit-tested there; this half
	 * only decides what the marks look like.
	 */
	import { Area, Axis, Chart, Rule, Spline, Svg } from 'layerchart';

	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 *   summary?: import('$lib/monte-carlo.js').MonteCarloSummary | null
	 * }}
	 */
	let { summary = null } = $props();

	/**
	 * The plot area's inset. Sized like `NetWorthChart.svelte`'s: enough on the left for a compact
	 * currency label (`£1.2m`), enough at the bottom for a two-digit age, and a little on the right
	 * so the last rung of the fan is not clipped by the frame.
	 */
	const CHART_PADDING = Object.freeze({ top: 8, right: 16, bottom: 24, left: 56 });

	const series = $derived(fanChartSeries(summary));
	const state = $derived(fanChartState(summary, series));
	const retirementMarker = $derived(fanChartRetirementMarker(summary, series));
	const xDomain = $derived(fanChartXDomain(series));
	const yDomain = $derived(fanChartYDomain(series));
	const ageTicks = $derived(fanChartAgeTicks(series, retirementMarker));
	const tableRows = $derived(fanChartTableRows(series));
	const summaryText = $derived(fanChartSummaryText(summary, series));

	const first = $derived(series[0] ?? null);
	const last = $derived(series[series.length - 1] ?? null);
</script>

<Card className="p-4">
	<h3 class="text-base font-semibold mb-1">The spread of simulated pots</h3>
	<p class="text-sm text-muted-foreground mb-4">
		Every simulated path, read as a distribution at each age rather than one at a time: the darker
		band is the middle half of paths, the lighter band the middle 90%, and the line through them the
		median. The bands are the spread at each age, <span class="font-medium"
			>not anybody's retirement</span
		> — the path that is among the worst at 70 is a different path from the one that is among the worst
		at 90, so following an edge along does not trace a history that happened.
	</p>

	{#if state === 'no_summary'}
		<p class="text-sm text-muted-foreground">
			Nothing simulated yet — the fan appears once there is a plan to run.
		</p>
	{:else if state === 'no_plot'}
		<p class="text-sm text-muted-foreground">
			The simulation covers a single year, so there is no fan to draw yet — a band needs a run of
			ages to open out over.
		</p>
	{:else if state === 'all_zero'}
		<p class="text-sm text-muted-foreground">
			Every simulated path sits at {formatMoney(0)} from age {Math.round(first?.age ?? 0)} onward: there
			is no pension pot or ISA pot recorded and nothing being paid into one, so there is no balance to
			plot. The probability above is about your promised income alone.
		</p>
	{:else if first && last}
		<!-- Identity is never colour alone: each band is named here as a share of paths, and the
		     retirement marker is a dashed rule rather than a fourth tint of the series hue. The swatch
		     sizes and the row's spacing are inline rather than utility classes for the reason the plot
		     height below is — see the comment there. -->
		<div
			class="flex flex-wrap items-center gap-4 mb-2 text-xs text-muted-foreground"
			style="display:flex; flex-wrap:wrap; align-items:center; gap:1rem; margin-bottom:0.5rem"
		>
			<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
				<span
					style="display:inline-block; width:1.25rem; height:2px; background:hsl(var(--chart-2))"
				></span>
				Median
			</span>
			<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
				<span
					style="display:inline-block; width:1.25rem; height:0.7rem; background:hsl(var(--chart-2) / 0.38)"
				></span>
				Middle 50% of paths
			</span>
			<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
				<span
					style="display:inline-block; width:1.25rem; height:0.7rem; background:hsl(var(--chart-2) / 0.18)"
				></span>
				Middle 90% of paths
			</span>
			{#if retirementMarker !== null}
				<span class="inline-flex items-center gap-1.5" style="display:inline-flex; gap:0.375rem">
					<span
						style="display:inline-block; width:1.25rem; height:0; border-top:2px dashed hsl(var(--muted-foreground))"
					></span>
					Retirement at {Math.round(retirementMarker)}
				</span>
			{/if}
		</div>

		<!-- `color` here is what LayerChart's axis chrome inherits: its tick marks and rule are drawn
		     at 50% of `currentColor`, its tick labels at full. The gridlines get an explicit border
		     token instead, since 10% of a mid-grey is all but invisible on white.

		     The height is inline rather than an `h-72` utility on purpose: a `<Chart>` measures this
		     element and draws nothing at all if it comes back zero-high, so the one declaration the
		     chart cannot render without is the one that must not depend on Tailwind emitting a class.
		     It currently does not — see the same comment in `NetWorthChart.svelte`. -->
		<div
			class="w-full"
			style="height: 18rem; color: hsl(var(--muted-foreground))"
			role="img"
			aria-label={summaryText}
		>
			<Chart
				data={series}
				x={(/** @type {FanChartPoint} */ point) => point.age}
				y={(/** @type {FanChartPoint} */ point) => point.median}
				{xDomain}
				{yDomain}
				padding={CHART_PADDING}
				tooltipContext={false}
			>
				<Svg>
					<Axis
						placement="left"
						format={formatAxisMoney}
						ticks={5}
						grid={{ stroke: 'hsl(var(--border))' }}
					/>
					<Axis placement="bottom" ticks={ageTicks} format={formatAxisAge} rule />

					<!-- Outer first, then inner, then the median: painted in that order so the darker
					     middle sits on top of the lighter outside rather than being washed out by it.
					     Neither `<Area>` carries its own `data` — both read the chart's `series`, so the
					     two bands and the median line are the same five columns of one table by
					     construction rather than three arrays that happen to agree. -->
					<Area
						y0={(/** @type {FanChartPoint} */ point) => point.p5}
						y1={(/** @type {FanChartPoint} */ point) => point.p95}
						fill="hsl(var(--chart-2) / 0.18)"
					/>
					<Area
						y0={(/** @type {FanChartPoint} */ point) => point.p25}
						y1={(/** @type {FanChartPoint} */ point) => point.p75}
						fill="hsl(var(--chart-2) / 0.38)"
					/>

					<!-- The age contributions stop and drawdown begins, which is where the fan changes
					     shape. Drawn in the muted chrome colour rather than a series hue, because it is an
					     annotation about the x axis and not a fourth thing plotted against the y one.

					     `dashArray`, not the `stroke-dasharray` attribute `NetWorthChart.svelte` gives its
					     `<Spline>`s: a `<Rule>` renders through LayerChart's `<Line>`, which writes its own
					     `stroke-dasharray` *after* spreading the rest of its props, so a raw attribute is
					     silently overwritten with `undefined` and the rule comes out solid. Caught in the
					     browser drive, where it rendered as a solid line the legend called dashed. -->
					{#if retirementMarker !== null}
						<Rule
							x={retirementMarker}
							stroke="hsl(var(--muted-foreground))"
							dashArray="4 4"
							opacity={0.7}
						/>
					{/if}

					<Spline stroke="hsl(var(--chart-2))" strokeWidth={2.5} />
				</Svg>
			</Chart>
		</div>

		<p class="text-xs text-muted-foreground mt-1" style="margin-top: 0.25rem">
			Ages {Math.round(first.age)}–{Math.round(last.age)} ({first.calendarYear}–{last.calendarYear}).
			{#if retirementMarker !== null}
				The dashed line is age {Math.round(retirementMarker)}, where contributions stop and drawdown
				begins.
			{/if}
		</p>

		<!-- The accessibility fallback for the SVG above, in the `NetWorthChart.svelte` style: the same
		     numbers as text, at five-yearly ages rather than every year, so a screen reader or a
		     printout gets figures rather than the `aria-label`'s shape-of-the-fan sentence alone. Every
		     column heading names a share of paths, never a path. -->
		<details class="text-sm mt-2" style="margin-top: 0.5rem">
			<summary class="cursor-pointer text-muted-foreground" style="cursor: pointer">
				Show as a table
			</summary>
			<div class="overflow-x-auto mt-2" style="overflow-x: auto; margin-top: 0.5rem">
				<table class="w-full text-sm tabular-nums" style="width: 100%; border-collapse: collapse">
					<caption class="text-xs text-muted-foreground" style="text-align: left">
						The pot at each age across all {summary?.paths.toLocaleString('en-GB')} paths. Each column
						is a percentile of the paths at that age, not a single path followed down the table.
					</caption>
					<thead>
						<tr>
							<th scope="col" style="text-align: left; padding: 0.25rem 0.5rem">Age</th>
							<th scope="col" style="text-align: right; padding: 0.25rem 0.5rem">
								Worst 5% below
							</th>
							<th scope="col" style="text-align: right; padding: 0.25rem 0.5rem">Median</th>
							<th scope="col" style="text-align: right; padding: 0.25rem 0.5rem">Best 5% above</th>
						</tr>
					</thead>
					<tbody>
						{#each tableRows as point (point.year)}
							<tr>
								<th
									scope="row"
									style="text-align: left; padding: 0.25rem 0.5rem; font-weight: normal"
								>
									{Math.round(point.age)}
									<span class="text-muted-foreground">· {point.calendarYear}</span>
								</th>
								<td style="text-align: right; padding: 0.25rem 0.5rem">{formatMoney(point.p5)}</td>
								<td style="text-align: right; padding: 0.25rem 0.5rem"
									>{formatMoney(point.median)}</td
								>
								<td style="text-align: right; padding: 0.25rem 0.5rem">{formatMoney(point.p95)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
</Card>
