<script module>
	/**
	 * The words the hover tooltip says, and the formatters that produce them — issue #87.
	 *
	 * This lives in a `<script module>` block for two reasons. First, it is testable: a tooltip with
	 * no pointer over it renders as nothing at all under `svelte/server`, so there is no markup to
	 * assert and the only way to cover the reading is to lift it out as a pure function. Second, the
	 * `Intl` formatters below depend on no prop, so one per app beats one per mounted chart —
	 * constructing an `Intl.NumberFormat` is not free and the instance script runs once per instance.
	 *
	 * Both date formatters are pinned to `timeZone: 'UTC'`: the x values are UTC month starts
	 * (`$lib/net-worth.js` convention 4), and formatting one back in local time renders a January
	 * snapshot as "Dec" for every user west of Greenwich.
	 */

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

	/**
	 * One line of the hover tooltip.
	 *
	 * @typedef {object} NetWorthTooltipRow
	 * @property {string} label What the figure is.
	 * @property {string} value The figure, already formatted.
	 * @property {string} [color] A swatch colour, given only where the row corresponds to something
	 *   drawn on the chart — so the dot means "this is that line", not "this is a third series".
	 */

	/**
	 * What the tooltip reads out for one hovered month.
	 *
	 * @typedef {object} NetWorthTooltipReading
	 * @property {string} heading The month, and whether it was auto-filled.
	 * @property {NetWorthTooltipRow[]} rows Net worth first, then what it is made of.
	 */

	/**
	 * The hovered month, in words — issue #87's hover tooltip.
	 *
	 * Net worth leads because it is the figure the line plots; investments and debts follow because
	 * they are what it is made of. A reading that gave only the difference would make a £5,000 month
	 * look the same whether it is £5,000 of holdings or £305,000 against a £300,000 debt.
	 *
	 * The heading names an auto-filled month in words. #82 draws that distinction as a hollow marker,
	 * but a shape only means something to a reader who has already decoded the legend, and the
	 * tooltip is the one place the chart can spell it out at the moment it is being asked about.
	 *
	 * `null` out for anything that is not a recorded month — no point hovered, or (the failure this
	 * function is the last guard against) a datum from some other series that has no `net_worth` on
	 * it. A tooltip that says nothing is better than one that says `£NaN`; see the component's
	 * two-`<Chart>` split below for why such a datum should never reach here in the first place.
	 *
	 * @param {import('$lib/net-worth.js').NetWorthPoint | null | undefined} point
	 * @returns {NetWorthTooltipReading | null}
	 */
	export function netWorthTooltipReading(point) {
		if (!point || typeof point.net_worth !== 'number' || Number.isNaN(point.net_worth)) return null;

		return {
			heading: point.auto_filled ? `${formatMonth(point)} · auto-filled` : `${formatMonth(point)}`,
			rows: [
				{ label: 'Net worth', value: formatMoney(point.net_worth), color: 'hsl(var(--chart-1))' },
				{ label: 'Investments', value: formatMoney(point.investments) },
				{ label: 'Debts', value: formatMoney(point.debts) }
			]
		};
	}
</script>

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
	 * #85 mapped LayerChart's own chrome — axis rule, ticks, gridlines, crosshair, tooltip popover —
	 * onto this app's tokens in `src/app.css`, so everything the library draws that is not a series
	 * follows the light/`.dark` themes rather than its defaults. Nothing here imports the
	 * `layerchart/styles/shadcn-svelte.css` bridge; the axis rule, ticks and gridlines are given
	 * explicit token colours, and the hover layer below inherits the rest.
	 *
	 * #87 adds that hover layer: a `bisect-x` tooltip naming the hovered month, its net worth, and
	 * the investments and debts that net worth is made of, plus a `<Highlight>` crosshair and dot
	 * saying where the pointer is. The tooltip's words are `netWorthTooltipReading` in the module
	 * block above; the chart carries an `aria-label` summarising what the lines do, and the hover
	 * layer is a pointer affordance on top of that rather than a replacement for it — a screen reader
	 * gets the summary and the table fallback at the bottom of this file.
	 *
	 * **Why two `<Chart>` elements rather than one.** A chart hit-tests against `flatData`, which is
	 * its own `data` *plus the data of every mark given its own `data` prop*. Drawn as one chart,
	 * `bisect-x` would therefore search the tracked months followed by three copies of the forecast
	 * band — an array that is neither sorted nor of one shape — and hand the tooltip a band point,
	 * which has `low`/`mid`/`high` where the reading wants `net_worth`: `£NaN` in the tooltip and no
	 * crosshair dot at all, since a `y` accessor returning `undefined` gives it no coordinate to sit
	 * at. Naming the band marks as a series fixes `flatData`, but a chart that has *any* series makes
	 * `<Highlight points>` look for the hovered value on a series rather than on the hovered datum,
	 * and the forecast series has no value at a tracked month — so the dot stays missing.
	 *
	 * So the forecast band gets its own stacked chart, leaving the interactive one with a single
	 * sorted series and no marks carrying their own data — the shape both `bisect-x` and
	 * `<Highlight>` are built for. The two are absolutely positioned in one `position: relative`
	 * wrapper and handed the same frozen padding and the same domains, so they line up to the pixel.
	 *
	 * All the arithmetic lives in `$lib/net-worth.js` and `$lib/forecast.js` — this component decides
	 * only how the series look, and the formatters it decides them with are in the module block.
	 *
	 * #172 adds the Household / You / Partner lens toggle README.md's "Household / Partner Planning"
	 * describes, rendered above the headline figure since it decides what that figure means. It is a
	 * thin presentation layer on top of #143's `net-worth.js` engine — `lens` state feeds straight into
	 * `netWorthSeries(monthlyEntries, { lens })` and nothing here re-derives the ownership split.
	 * **The forecast overlay only ever runs under the `household` lens.** `forecast.js` has no concept
	 * of a lens — it always projects the household total from `growthRate` — so drawing it under a
	 * `you`/`partner` tracked line would plot two series computed at different scales and read as a
	 * personal projection nothing actually computed. Rather than teach `forecast.js` a lens of its own
	 * (out of scope here, and this component doesn't own that arithmetic), switching to `you` or
	 * `partner` disables the "Show forecast" control entirely and replaces it with a line explaining
	 * why, leaving `forecastOn`'s own state untouched so it resumes exactly where it was left the
	 * moment the user switches back to `household`.
	 *
	 * The toggle itself is local `$state` seeded from an `initialLens` prop, the same
	 * "prop seeds it once, the user owns it thereafter" shape `forecastOn`/`horizon` already use for
	 * `showForecast`/`forecastYears` below — added so a server-rendered test can assert what a
	 * `you`/`partner` lens renders without a pointer to click the toggle with. Every real caller leaves
	 * it unset.
	 *
	 * #260 adds a month selector above the headline figure: a `<select>` of every recorded month, most
	 * recent first, only rendered once there is more than one to choose between. It moves *only* the
	 * big headline net-worth figure onto the picked month — the month-on-month change line, the
	 * captions under it, and the accessible summary all stay reading `latest` in this issue, per its own
	 * "narrowed after this issue hit `error_max_turns`" scope note; following the selection is #288.
	 * `selectedMonthKey` is deliberately *not* seeded from `latest` at construction the way
	 * `forecastOn`/`horizon`/`lens` are seeded from their props: the dashboard route fills
	 * `monthlyEntries` in asynchronously after mount, so a selection captured eagerly at construction
	 * would freeze on the empty series it starts as and never see the real months once they load.
	 * Staying `null` ("follow the latest") sidesteps that race — `effectiveMonthKey` below re-resolves
	 * it against whatever `points` currently is on every render.
	 *
	 * #288 moves the rest of the summary block onto `selected` as well, now that #260 has landed it:
	 * the month-on-month change line, the "at {month} · N months recorded since {first}" caption (and
	 * its single-snapshot variant), and a sentence in the accessible summary naming the selected month
	 * when it differs from the latest. `monthOnMonthChange` keeps its one signature — comparing the
	 * last two points of whatever array it is handed — rather than learning to take an index; selecting
	 * March means handing it `points` truncated to end at March, not teaching it what "March" means.
	 * Two things stay pinned to the true latest recorded month regardless of the selection, per #260's
	 * own scope: `first`/`points.length` in the caption (a fact about the whole series, not about the
	 * selection) and the forecast overlay in its entirety, including the "Projected from your {latest}
	 * snapshot…" caption — `forecastFromEntries` keeps taking `monthlyEntries`, never a slice of it.
	 */
	import { Area, Axis, Chart, Circle, Highlight, Spline, Svg, Tooltip } from 'layerchart';

	import { DEFAULT_GROWTH_RATE } from '$lib/auto-invest.js';
	import { DEFAULT_SCENARIO_SPREAD, forecastFromEntries } from '$lib/forecast.js';
	import {
		autoFilledPointCount,
		DEFAULT_NET_WORTH_LENS,
		forecastBandSeries,
		monthOnMonthChange,
		monthStartDate,
		NET_WORTH_LENSES,
		netWorthChartMonthTicks,
		netWorthChartXDomain,
		netWorthChartYExtent,
		netWorthLensLabel,
		netWorthSeries
	} from '$lib/net-worth.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 * 	monthlyEntries?: import('$lib/types.js').MonthlyEntry[],
	 * 	partner?: import('$lib/types.js').Partner | null,
	 * 	growthRate?: number,
	 * 	spread?: number,
	 * 	forecastYears?: number,
	 * 	showForecast?: boolean,
	 * 	initialLens?: import('$lib/net-worth.js').NetWorthLens,
	 * 	initialSelectedMonth?: { month: number, year: number } | null
	 * }}
	 */
	let {
		monthlyEntries = [],
		partner = null,
		growthRate = DEFAULT_GROWTH_RATE,
		spread = DEFAULT_SCENARIO_SPREAD,
		forecastYears = 10,
		showForecast = true,
		initialLens = DEFAULT_NET_WORTH_LENS,
		initialSelectedMonth = null
	} = $props();

	/**
	 * Horizons the picker offers. Not spec — README.md gives the forecast no horizon list — but a
	 * fixed handful beats a free-text field here: this chart has to show a recorded history and a
	 * projection in one plot, and at 30 years a two-year history is four pixels wide. The forecast
	 * *tab* is where an arbitrary horizon belongs (`ForecastProjections` has the number field), so
	 * this is a zoom control rather than a second set of assumptions.
	 */
	const FORECAST_HORIZONS = Object.freeze([5, 10, 20, 30]);

	/**
	 * The plot area's inset, shared by both stacked charts — frozen, and one object rather than two
	 * literals, because the two charts only line up if they reserve exactly the same room for the
	 * axes. A second literal with the same numbers in it would line up today and drift the first time
	 * one of them was edited.
	 */
	const CHART_PADDING = Object.freeze({ top: 8, right: 32, bottom: 24, left: 56 });

	// Per-instance, because a hard-coded `id` would collide the moment a second chart appears on a
	// page — and a duplicated `id` silently re-points the first label at the wrong control.
	const uid = $props.id();

	// The props seed both controls once; from then on the user owns them, exactly as
	// `ForecastProjections` treats its own assumptions.
	// svelte-ignore state_referenced_locally
	let forecastOn = $state(showForecast);
	// svelte-ignore state_referenced_locally
	let horizon = $state(forecastYears);

	// Seeded from `initialLens` (defaulting to `household`, #143's own default) exactly as `forecastOn`
	// and `horizon` above are seeded from their props — from here on the user owns it via the toggle
	// below. `initialLens` exists mainly so a server-rendered test can assert what a `you`/`partner`
	// lens renders without a pointer to click the toggle with; every real caller leaves it unset, so
	// every existing screen and snapshot is unchanged until the user switches lenses by hand.
	// svelte-ignore state_referenced_locally
	let lens = $state(initialLens);

	const points = $derived(netWorthSeries(monthlyEntries, { lens }));
	const first = $derived(points[0]);
	const latest = $derived(points.at(-1));
	const autoFilledCount = $derived(autoFilledPointCount(points));

	/**
	 * #260's month selector. `null` means "follow the latest recorded month" — today's behaviour, and
	 * what every real caller gets, since `initialSelectedMonth` is unset. A concrete key is a month's
	 * UTC month-start timestamp, the same identity {@link monthStartDate} gives every
	 * {@link import('$lib/net-worth.js').NetWorthPoint} and the one the table fallback below already
	 * keys its rows on.
	 */
	// svelte-ignore state_referenced_locally
	let selectedMonthKey = $state(
		/** @type {number | null} */ (
			initialSelectedMonth ? monthStartDate(initialSelectedMonth).getTime() : null
		)
	);

	/** The key {@link selectedMonthKey} resolves to once "follow the latest" is accounted for. */
	const effectiveMonthKey = $derived(selectedMonthKey ?? latest?.date.getTime() ?? null);

	/** {@link effectiveMonthKey} resolved back to its point, falling back to `latest` if it names no
	 * recorded month — nothing in this app deletes a month out from under a mounted chart today, but a
	 * stale selection should still degrade to today's behaviour rather than to nothing plotted. */
	const selected = $derived.by(
		() =>
			/** @type {import('$lib/net-worth.js').NetWorthPoint} */ (
				points.find((point) => point.date.getTime() === effectiveMonthKey) ?? latest
			)
	);

	/**
	 * #288's month-on-month change: the selected month against the one before it, rather than always
	 * the latest two. Reuses {@link monthOnMonthChange} unchanged by handing it the prefix of `points`
	 * that ends at the selection, instead of teaching it a second, index-aware signature — picking
	 * March last year compares March to February, exactly as an untouched chart compares latest to
	 * previous. `points.indexOf` rather than a second `.find` by date: `selected` is always a member of
	 * `points` (or `undefined` before the first snapshot exists, when this block never renders).
	 */
	const monthChange = $derived.by(() => {
		const index = points.indexOf(selected);
		return index === -1 ? null : monthOnMonthChange(points.slice(0, index + 1));
	});

	/**
	 * The projection behind the overlay, or `null` when there is nothing to project from, the user has
	 * switched it off, or the lens is not `household` — see the header comment for why a `you`/
	 * `partner` lens never draws a forecast. `forecastFromEntries` anchors on the latest recorded month
	 * itself, so the forecast's first point is the tracked line's last point to the penny and the two
	 * join without a step — see `$lib/net-worth.js` → `forecastBandSeries`.
	 */
	const forecast = $derived.by(() => {
		if (lens !== 'household' || !forecastOn || points.length === 0) return null;
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

	const bandEnd = $derived(band.at(-1) ?? null);

	/**
	 * What a screen reader gets instead of the lines. Deliberately the shape of the series — where
	 * they start, where they end, how wide the band gets — rather than a reading of every month,
	 * which is what #82's table fallback is for.
	 */
	const summary = $derived.by(() => {
		/** @type {string[]} */
		const sentences = [];

		// Named up front, not folded into the sentences below: whichever lens is on screen, a reader
		// who cannot see the toggle must be told whose net worth the numbers that follow belong to.
		// `you` gets its own possessive ("Your") rather than the toggle's own label ("You") + "'s",
		// which would read as the ungrammatical "You's net worth".
		const whose =
			lens === 'household'
				? 'Household'
				: lens === 'you'
					? 'Your'
					: netWorthLensLabel(lens, partner?.name) + "'s";

		if (first && latest && points.length >= 2) {
			const change = latest.net_worth - first.net_worth;
			const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'level';
			sentences.push(
				`${whose} net worth. Line chart of tracked net worth over ${points.length} recorded months: ` +
					`${formatMoney(first.net_worth)} in ${formatMonth(first)}, ` +
					`${formatMoney(latest.net_worth)} in ${formatMonth(latest)} — ${direction} ` +
					`${formatMoney(Math.abs(change))}.`
			);
		} else if (latest) {
			sentences.push(
				`${whose} net worth. Chart of net worth from one recorded month, ${formatMoney(latest.net_worth)} in ` +
					`${formatMonth(latest)}.`
			);
		} else {
			sentences.push(`${whose} net worth. Chart of tracked net worth.`);
		}

		// #288: the figures above the chart (the headline, the month-on-month change) read off
		// `selected`, not `latest`, once the selector has been used — a sighted reader sees that from
		// the `<select>`'s own value, but nothing in the shape-of-the-line sentence above says so, so a
		// screen reader user would otherwise hear the latest month's shape and the selected month's
		// headline with no indication they are two different months.
		if (selected && latest && selected !== latest) {
			sentences.push(`Showing ${formatMonth(selected)}, not the latest recorded month.`);
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
		<!-- #172's lens toggle. It sits above the headline figure, not below it, because it decides
		     what that figure means — reading the total *then* discovering it was "You" all along is the
		     wrong order. A `role="radiogroup"` of three labelled radios, the same "input, then its own
		     label text" shape the forecast controls below use, rather than three separate buttons: only
		     one lens is ever on at once, which is exactly what radio semantics say. -->
		<div
			class="flex flex-wrap items-center gap-3 mb-2 text-sm"
			style="display:flex; flex-wrap:wrap; align-items:center; gap:0.75rem; margin-bottom:0.5rem"
			role="radiogroup"
			aria-label="Net worth lens"
		>
			{#each NET_WORTH_LENSES as lensOption (lensOption)}
				<label
					class="flex items-center gap-1.5"
					style="display:flex; align-items:center; gap:0.375rem"
				>
					<input type="radio" name="{uid}-lens" value={lensOption} bind:group={lens} />
					{netWorthLensLabel(lensOption, partner?.name)}
				</label>
			{/each}
		</div>

		{#if points.length > 1}
			<!-- #260's month selector. Most recent first, so the default (top) option is the same month
			     the headline already showed before this control existed. A `<select>` rather than
			     click-to-pin: the chart's pointer is already spoken for by #87's hover tooltip below, and
			     a second, different meaning for a click on the same plot area would fight it rather than
			     compose with it.

			     `value={effectiveMonthKey}` rather than `bind:value={selectedMonthKey}` on purpose: a
			     two-way binding would need `selectedMonthKey` itself to already equal the latest month's
			     key to render pre-selected, which is exactly the mount-time race `effectiveMonthKey`'s own
			     comment above exists to avoid. Svelte still marks the matching server-rendered `<option>`
			     `selected` for a plain one-way `value`, the same mechanism the horizon picker below relies
			     on `bind:value` for. `onchange` does the writing instead: selecting the option that is
			     already the latest month resets `selectedMonthKey` to `null` (follow-latest) rather than
			     pinning to that month's key, so a newly recorded month is picked up automatically without
			     the user having to re-select it. -->
			<div
				class="flex flex-wrap items-center gap-1.5 mb-2 text-sm"
				style="display:flex; align-items:center; gap:0.375rem; margin-bottom:0.5rem"
			>
				<label for="{uid}-month" class="text-muted-foreground">Show figures for</label>
				<select
					id="{uid}-month"
					value={effectiveMonthKey}
					onchange={(event) => {
						const key = Number(event.currentTarget.value);
						selectedMonthKey = key === latest?.date.getTime() ? null : key;
					}}
					class="border border-input rounded-md px-2 py-1 text-sm"
				>
					{#each [...points].reverse() as point (point.date.getTime())}
						<option value={point.date.getTime()}>{formatMonth(point)}</option>
					{/each}
				</select>
			</div>
		{/if}

		<p class="text-2xl font-semibold tabular-nums">{formatMoney(selected.net_worth)}</p>
		{#if monthChange}
			<p class="text-sm tabular-nums mb-2">
				{#if monthChange.absolute >= 0}
					<span class="text-green-600 dark:text-green-500">
						↑ {formatMoney(monthChange.absolute)}
					</span>
				{:else}
					<span class="text-red-600 dark:text-red-500">
						↓ {formatMoney(Math.abs(monthChange.absolute))}
					</span>
				{/if}
				{#if !Number.isNaN(monthChange.percentage)}
					<span class="text-muted-foreground">
						({#if monthChange.percentage >= 0}+{/if}{formatRate(monthChange.percentage)})
					</span>
				{/if}
				<span class="text-muted-foreground"> month-on-month</span>
			</p>
		{/if}
		{#if points.length === 1}
			<p class="text-sm text-muted-foreground mb-2">
				{formatMonth(selected)} — your first snapshot.
				{#if hasPlot}
					The tracked line needs a second month to run between, so what you see plotted is the
					forecast from this one.
				{:else if lens === 'household'}
					A line needs two months to run between, so this chart fills in once you record another —
					or switch the forecast back on and it runs from this month.
				{:else}
					A line needs two months to run between, so this chart fills in once you record another.
				{/if}
			</p>
		{:else}
			<p class="text-sm text-muted-foreground mb-2">
				at {formatMonth(selected)} · {points.length} months recorded since {formatMonth(first)}
			</p>
		{/if}

		{#if lens === 'household'}
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
		{:else}
			<!-- See the header comment for why: `forecast.js` always projects the household total, so a
			     `you`/`partner` lens gets no forecast control at all rather than a checkbox that would
			     silently draw a household-scale line under a person-scale total. `forecastOn`'s own state
			     is untouched here, so switching back to Household resumes wherever it was left. -->
			<p class="text-xs text-muted-foreground mb-2" style="margin-bottom: 0.5rem">
				The forecast always projects the household total, so it is only shown on the Household lens
				— switch back to see it.
			</p>
		{/if}

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
			     broken by it.

			     `position: relative` is the other declaration this element cannot do without: the two
			     charts inside it are absolutely positioned on top of each other, and without a
			     positioned ancestor they would escape to the nearest one and land somewhere else on
			     the page entirely. -->
			<div
				class="w-full"
				style="position: relative; height: 18rem; color: hsl(var(--muted-foreground))"
				role="img"
				aria-label={summary}
			>
				<!-- The lower chart: everything the pointer does not interact with. First in the DOM so
				     the grid and the shading paint *under* the tracked line, `tooltipContext={false}` so
				     it runs no hit-testing of its own, and `pointer-events: none` so the pointer falls
				     straight through to the interactive layer above. See the header comment for why the
				     band is down here at all rather than drawn alongside the tracked line. -->
				<div style="position: absolute; inset: 0; pointer-events: none">
					<Chart
						data={points}
						x={(/** @type {{ date: Date }} */ point) => point.date}
						y={(/** @type {import('$lib/net-worth.js').NetWorthPoint} */ point) => point.net_worth}
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
							<Axis placement="bottom" ticks={xTicks} format={formatAxisMonth} rule />

							<!-- The fill, the two dashed edges and the realistic line are all read off one
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
						</Svg>
					</Chart>
				</div>

				<!-- The upper chart: the tracked line and everything the pointer talks to. Last in the
				     DOM, so it is the layer the pointer lands on, and deliberately given nothing but
				     `points` to hit-test against — no mark down here carries its own `data`, including
				     the `Circle` below, which inherits the chart's rather than repeating every tracked
				     month into the `flatData` that `bisect-x` searches. -->
				<div style="position: absolute; inset: 0">
					<Chart
						data={points}
						x={(/** @type {{ date: Date }} */ point) => point.date}
						y={(/** @type {import('$lib/net-worth.js').NetWorthPoint} */ point) => point.net_worth}
						{xDomain}
						{yDomain}
						padding={CHART_PADDING}
						tooltipContext={{ mode: 'bisect-x' }}
					>
						<Svg>
							<Spline stroke="hsl(var(--chart-1))" strokeWidth={2} />

							<!-- One marker per recorded month, read off the same `points` array the line itself
							     draws from — the forecast is a projection, not a recorded month, so it gets no
							     markers. Identity is never colour alone (see the legend above): a recorded month is
							     a filled dot, an auto-filled one a hollow ring, and `fill` is given as a function so
							     both shapes come off one `Circle` in data mode rather than a second pass over the
							     points for the auto-filled subset. -->
							<Circle
								cx={(/** @type {import('$lib/net-worth.js').NetWorthPoint} */ point) => point.date}
								cy={(/** @type {import('$lib/net-worth.js').NetWorthPoint} */ point) =>
									point.net_worth}
								r={4}
								fill={(/** @type {import('$lib/net-worth.js').NetWorthPoint} */ point) =>
									point.auto_filled ? 'hsl(var(--card))' : 'hsl(var(--chart-1))'}
								stroke="hsl(var(--chart-1))"
								strokeWidth={2}
							/>

							<!-- Last inside the `<Svg>`, so the crosshair and its dot sit on top of every line
							     rather than under the one they are pointing at. Both are left in LayerChart's
							     own chrome colours — `--color-primary` for the dot, `--color-surface-content`
							     for the rule, the card surface for the dot's ring — which #85 mapped onto this
							     app's tokens in `app.css`. Giving them a series hue instead would read as a
							     third encoding of which series is which, when all they say is "the pointer is
							     here". -->
							<Highlight lines points />
						</Svg>

						<!-- A sibling of `<Svg>`, not a child: `Tooltip.Root` renders a `<div>`, and LayerChart
						     portals it to `<body>` so a chart inside an overflow-hidden card cannot clip it.
						     That portal is why #85 themes `.lc-tooltip-root` in its own top-level rule rather
						     than nesting it under `.lc-root-container`.

						     `x="data"` snaps the popover horizontally onto the month it describes rather than
						     letting it drift a few pixels off with the raw pointer; `y` stays on the pointer,
						     so a reading near the top of the plot does not cover the line it is about.

						     `aria-hidden`, because this is a pointer affordance inside a `role="img"`: it is
						     not a route to the data for anyone who cannot hover, and the `aria-label` summary
						     and the table fallback below are what serve that reader. -->
						<Tooltip.Root
							x="data"
							props={{ root: { 'aria-hidden': 'true' }, container: {}, content: {} }}
						>
							{#snippet children({ data })}
								{@const reading = netWorthTooltipReading(data)}
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
