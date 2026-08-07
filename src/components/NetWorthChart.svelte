<script>
	/**
	 * The tracked net worth line — README.md → "Net Worth Tracking": "Net worth chart: tracked line +
	 * realistic/optimistic/pessimistic forecast lines with shaded confidence band" (issue #67).
	 *
	 * This is the tracked half only: the months the user actually recorded, one hue, one line. Three
	 * pieces of the finished chart are deliberately not here, each with an issue of its own:
	 *
	 * - The forecast lines and their shaded confidence band are #81. That is why this composes
	 *   LayerChart's primitives (`Chart` / `Svg` / `Axis` / `Spline`) rather than the `LineChart`
	 *   wrapper: #81 drops three more `Spline`s and an `Area` into this same plot area, sharing one
	 *   pair of accessors and one pair of scales, which a wrapper that owns its own plot would not
	 *   allow without unpicking it first.
	 * - The hover tooltip, the point markers, the visible auto-filled/recorded distinction and the
	 *   accessible table fallback are #82. Until then the chart carries an `aria-label` summarising
	 *   what the line does, which is a summary rather than the data.
	 * - Theming LayerChart's own chrome off this app's shadcn tokens (it ships a
	 *   `layerchart/styles/shadcn-svelte.css` bridge) is also #82. Nothing here imports that sheet;
	 *   the axis rule, ticks and gridlines are given explicit token colours instead, and everything
	 *   else inherits `currentColor` from the container.
	 *
	 * All the arithmetic lives in `$lib/net-worth.js` — this component decides only how the series
	 * looks. Note in particular that both formatters below are pinned to `timeZone: 'UTC'`: the x
	 * values are UTC month starts, and formatting one back in local time renders a January snapshot
	 * as "Dec" for every user west of Greenwich.
	 */
	import { Axis, Chart, Spline, Svg } from 'layerchart';

	import {
		netWorthMonthTicks,
		netWorthSeries,
		netWorthXDomain,
		netWorthYExtent
	} from '$lib/net-worth.js';
	import Card from './ui/card.svelte';

	/** @type {{ monthlyEntries?: import('$lib/types.js').MonthlyEntry[] }} */
	let { monthlyEntries = [] } = $props();

	const points = $derived(netWorthSeries(monthlyEntries));
	const first = $derived(points[0]);
	const latest = $derived(points.at(-1));

	const xDomain = $derived(netWorthXDomain(points));
	const yDomain = $derived(netWorthYExtent(points));
	const xTicks = $derived(netWorthMonthTicks(points));

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

	/**
	 * What a screen reader gets instead of the line. Deliberately the shape of the series — where it
	 * starts, where it ends, which way it went — rather than a reading of every month, which is what
	 * #82's table fallback is for.
	 */
	const summary = $derived.by(() => {
		if (!first || !latest || points.length < 2) return 'Tracked net worth';

		const change = latest.net_worth - first.net_worth;
		const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'level';

		return (
			`Line chart of tracked net worth over ${points.length} recorded months: ` +
			`${formatMoney(first.net_worth)} in ${formatMonth(first)}, ` +
			`${formatMoney(latest.net_worth)} in ${formatMonth(latest)} — ${direction} ` +
			`${formatMoney(Math.abs(change))}.`
		);
	});
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Net worth over time</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Every month you have recorded, holdings less debts. Anything you have excluded from net worth —
		a mortgage already counted as property equity, say — is left out here too. Months you skipped
		stay empty rather than being guessed at; the auto-invest fill below is what closes a gap.
	</p>

	{#if points.length === 0}
		<p class="text-sm text-muted-foreground">
			No snapshots yet. Record a month's holdings and debts below and the line starts here.
		</p>
	{:else if points.length === 1 && latest}
		<p class="text-2xl font-semibold tabular-nums">{formatMoney(latest.net_worth)}</p>
		<p class="text-sm text-muted-foreground">
			{formatMonth(latest)} — your first snapshot. A line needs two months to run between, so this chart
			fills in once you record another.
		</p>
	{:else if latest && first}
		<p class="text-2xl font-semibold tabular-nums">{formatMoney(latest.net_worth)}</p>
		<p class="text-sm text-muted-foreground mb-2">
			at {formatMonth(latest)} · {points.length} months recorded since {formatMonth(first)}
		</p>

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
				x={(/** @type {import('$lib/net-worth.js').NetWorthPoint} */ point) => point.date}
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
					<Spline stroke="hsl(var(--chart-1))" strokeWidth={2} />
				</Svg>
			</Chart>
		</div>
	{/if}
</Card>
