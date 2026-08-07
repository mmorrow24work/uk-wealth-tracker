/**
 * The net worth chart's series — README.md → "Net Worth Tracking": "Net worth chart: tracked line +
 * realistic/optimistic/pessimistic forecast lines with shaded confidence band" (issues #67 and #81).
 *
 * The tracked half (issue #67) is what the user actually recorded. The forecast half (issue #81) is
 * `forecast.js`'s three scenarios, collapsed to one low/mid/high series per month and given the same
 * `date` the tracked points carry, so both halves plot against one pair of accessors and one pair of
 * scales. No projection maths lives here — {@link forecastBandSeries} reshapes what `forecast.js`
 * already computed and nothing more.
 *
 * Four conventions decide what the numbers mean:
 *
 * 1. **A point restates one recorded month, nothing more.** One {@link NetWorthPoint} per
 *    `MonthlyEntry`, in calendar order. Months the user skipped are *not* interpolated: filling a
 *    gap with compound growth is `auto-invest.js`'s job and a deliberate user action (README.md →
 *    "Auto-invest amounts per holding"), not something a chart does silently behind the user's back.
 *    A gap therefore stays a gap — see convention 3 for what that looks like on screen.
 * 2. **Net worth is what counts towards net worth.** Totals go through `debt.js`'s
 *    {@link sumInvestmentValues}/{@link sumDebtBalances}, so a holding or debt flagged
 *    `exclude_from_net_worth` — the mortgage toggle, above all — is dropped exactly as the D/I ratio
 *    and `forecast.js` already drop it, rather than this module inventing a second notion of what
 *    counts.
 * 3. **A point is shaped like a {@link import('./forecast.js').ForecastPoint}, plus a `Date`.** Same
 *    `month`/`year`/`investments`/`debts`/`net_worth` field names and the same whole-pence rounding,
 *    so the tracked and forecast series plot against one pair of accessors rather than being
 *    translated between two shapes at the chart boundary. The extra `date` is what makes a skipped
 *    month read as a gap: on a time scale an eighteen-month hole is eighteen months of chart width,
 *    where an index-based x would draw it as one step and quietly flatter the user's tracking record.
 * 4. **Every date is UTC midnight on the 1st.** `new Date(year, month - 1, 1)` is local midnight,
 *    which anywhere west of Greenwich is the *previous* month once formatted back in UTC — a
 *    January snapshot labelled December. {@link monthStartDate} builds the instant with `Date.UTC`,
 *    and anything formatting one back to a label must ask for `timeZone: 'UTC'` to match.
 *
 * Everything here is pure: entries go in, new arrays come out, nothing is mutated.
 */

import { addMonths, monthsBetween } from './auto-invest.js';
import { sumDebtBalances, sumInvestmentValues } from './debt.js';
import { forecastBand } from './forecast.js';
import { compareMonthlyEntries } from './model.js';

/*
 * As in `debt.js`/`forecast.js`: types are referenced inline as `import('./types.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *` and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	// `forecast.js` keeps its own copy of this private; the two must agree to the penny for #81 to
	// join a tracked line to a forecast line without a visible step at the seam, so it is repeated
	// here verbatim rather than either module exporting a rounding helper as public API.
	return Math.round(amount * 100) / 100 + 0;
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The instant a calendar month starts, as a `Date` — UTC midnight on the 1st (convention 4).
 *
 * Takes anything with `month`/`year`, so a `MonthlyEntry`, a `ForecastPoint` and a bare
 * `{ month, year }` all work: #81 needs the same x value for a forecast point that this module
 * needs for a recorded one.
 *
 * @param {{ month: number, year: number }} value Month 1–12, four-digit year.
 * @returns {Date}
 */
export function monthStartDate(value) {
	return new Date(Date.UTC(value.year, value.month - 1, 1));
}

/* -------------------------------------------------------------------------- */
/* The series                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One recorded month, ready to plot.
 *
 * @typedef {object} NetWorthPoint
 * @property {number} month Calendar month, 1–12.
 * @property {number} year Four-digit calendar year.
 * @property {Date} date Month start, UTC — the x value (convention 4).
 * @property {number} investments Total value of the holdings that count towards net worth (£).
 * @property {number} debts Total balance of the debts that count towards net worth (£).
 * @property {number} net_worth `investments - debts` (£) — the y value.
 * @property {boolean} auto_filled Whether the snapshot was generated by `auto-invest.js` rather
 *   than recorded by hand. Carried through because it is a property of the month and dropping it
 *   here would mean re-deriving it later; *drawing* the distinction (a dashed segment, a hollow
 *   marker) is issue #82's, not this module's.
 */

/**
 * Turn one recorded month into a plottable point.
 *
 * @param {import('./types.js').MonthlyEntry} entry
 * @returns {NetWorthPoint}
 */
export function netWorthPoint(entry) {
	const investments = roundMoney(sumInvestmentValues(entry.investments));
	const debts = roundMoney(sumDebtBalances(entry.debts));

	return {
		month: entry.month,
		year: entry.year,
		date: monthStartDate(entry),
		investments,
		debts,
		net_worth: roundMoney(investments - debts),
		auto_filled: entry.auto_filled === true
	};
}

/**
 * The tracked history: one point per recorded month, oldest first, gaps left as gaps (convention 1).
 *
 * Input order does not matter — entries are sorted by calendar month, the same ordering
 * `model.js`'s {@link compareMonthlyEntries} gives every other consumer of the history. Duplicate
 * months (which `validateAppData` flags separately) are plotted as they come rather than merged:
 * silently collapsing two snapshots of the same month would hide the data problem instead of
 * showing it.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {NetWorthPoint[]} Oldest first.
 */
export function netWorthSeries(entries) {
	return [...entries].sort(compareMonthlyEntries).map(netWorthPoint);
}

/**
 * How many of a plotted series' points were auto-filled rather than recorded by hand — issue #82's
 * caption under the chart, which names the hollow marker shape in words.
 *
 * Counted off the points array {@link netWorthSeries} already produced, not by re-walking
 * `monthly_entries` and re-checking `auto_filled` there: the caption must describe exactly the
 * points the chart went on to draw hollow, and the only way it cannot disagree with them is to read
 * the same array.
 *
 * @param {readonly NetWorthPoint[]} points
 * @returns {number}
 */
export function autoFilledPointCount(points) {
	return points.reduce((count, point) => count + (point.auto_filled ? 1 : 0), 0);
}

/**
 * Month-on-month change in net worth from the latest recorded month to the previous one.
 *
 * Returns `null` if fewer than two recorded months exist. The change is returned as both
 * absolute (£) and percentage of the previous month's net worth. A percentage of NaN is
 * returned when the previous month's net worth is zero (division by zero).
 *
 * @param {readonly NetWorthPoint[]} points Oldest first, as {@link netWorthSeries} returns.
 * @returns {{ absolute: number, percentage: number } | null}
 */
export function monthOnMonthChange(points) {
	if (points.length < 2) return null;

	const latest = points[points.length - 1];
	const previous = points[points.length - 2];

	const absolute = roundMoney(latest.net_worth - previous.net_worth);
	const percentage = previous.net_worth === 0 ? NaN : (latest.net_worth - previous.net_worth) / previous.net_worth * 100;

	return { absolute, percentage };
}

/* -------------------------------------------------------------------------- */
/* The forecast band                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One month of the forecast overlay — issue #81's "three scenario lines with a shaded confidence
 * band between the low/high lines".
 *
 * This is `forecast.js`'s {@link import('./forecast.js').ForecastBandPoint} with a `date` on it, and
 * that is the whole of the difference. The three scenario lines are `low`/`mid`/`high` rather than
 * three separate series because the shaded band's edges and the outer two lines must be the same
 * numbers: drawing the fill from one array and the lines from another is how a band ends up half a
 * pixel out of register with the line that is supposed to bound it.
 *
 * @typedef {object} ForecastBandSeriesPoint
 * @property {number} offset Whole months since the anchor. `0` is the anchor itself.
 * @property {number} month Calendar month, 1–12.
 * @property {number} year Four-digit calendar year.
 * @property {Date} date Month start, UTC — the x value, the same one a {@link NetWorthPoint} uses.
 * @property {number} low Lowest projected net worth across the scenarios, normally pessimistic (£).
 * @property {number} mid Realistic projected net worth (£).
 * @property {number} high Highest projected net worth, normally optimistic (£).
 */

/**
 * The forecast overlay's series: one low/mid/high point per projected month, oldest first.
 *
 * `null` in gives `[]` out, because "no forecast" is the ordinary state of this chart — a dashboard
 * with no snapshots yet has nothing to project from ({@link import('./forecast.js').forecastFromEntries}
 * returns `null` for it) and every helper below already treats an empty band as "tracked line only".
 *
 * Offset 0 is the anchor position, identical in all three scenarios (`forecast.js`'s convention 1),
 * so when the forecast was built from the recorded history its first point *is* the last tracked
 * point — same month, same net worth to the penny. That is what joins the tracked line to the
 * forecast lines without a visible step, and it is why nothing here re-derives an anchor of its own.
 *
 * @param {import('./forecast.js').Forecast | null} [forecast]
 * @returns {ForecastBandSeriesPoint[]} Oldest first.
 */
export function forecastBandSeries(forecast) {
	if (!forecast) return [];

	return forecastBand(forecast).map((point) => ({
		offset: point.offset,
		month: point.month,
		year: point.year,
		date: monthStartDate(point),
		low: point.low,
		mid: point.mid,
		high: point.high
	}));
}

/* -------------------------------------------------------------------------- */
/* Chart helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The first and last calendar month anything on the chart occupies.
 *
 * Both series are scanned at both ends rather than assuming the tracked line comes first and the
 * forecast last. It normally does — a forecast starts at the latest snapshot — but a forecast of
 * zero months, or one anchored somewhere other than the end of the history, would otherwise produce
 * a domain that clips a line the chart is still drawing.
 *
 * @param {readonly { month: number, year: number }[]} points
 * @param {readonly { month: number, year: number }[]} band
 * @returns {{ first: { month: number, year: number }, last: { month: number, year: number } } | null}
 */
function chartMonthBounds(points, band) {
	/** @type {{ month: number, year: number }[]} */
	const edges = [];
	for (const series of [points, band]) {
		const first = series[0];
		const last = series.at(-1);
		if (first) edges.push(first);
		if (last) edges.push(last);
	}
	if (edges.length === 0) return null;

	let first = edges[0];
	let last = edges[0];
	for (const edge of edges) {
		if (monthStartDate(edge).getTime() < monthStartDate(first).getTime()) first = edge;
		if (monthStartDate(edge).getTime() > monthStartDate(last).getTime()) last = edge;
	}
	return { first, last };
}

/**
 * The x domain covering the tracked history and the forecast overlay together — first month plotted
 * to last, as UTC month starts.
 *
 * `null` when there is nothing to plot, so a caller can tell "no history" from "a history that
 * happens to be flat". A single month would otherwise give a zero-width domain — a time scale with
 * an empty domain puts every value at the left edge — so it is widened to the month either side,
 * leaving the one point centred.
 *
 * @param {readonly NetWorthPoint[]} points Oldest first, as {@link netWorthSeries} returns.
 * @param {readonly ForecastBandSeriesPoint[]} [band] As {@link forecastBandSeries} returns.
 * @returns {[Date, Date] | null}
 */
export function netWorthChartXDomain(points, band = []) {
	const bounds = chartMonthBounds(points, band);
	if (!bounds) return null;

	const { first, last } = bounds;
	if (first.month === last.month && first.year === last.year) {
		return [monthStartDate(addMonths(first, -1)), monthStartDate(addMonths(last, 1))];
	}

	return [monthStartDate(first), monthStartDate(last)];
}

/**
 * The x domain of the tracked history alone — {@link netWorthChartXDomain} with no overlay.
 *
 * @param {readonly NetWorthPoint[]} points Oldest first.
 * @returns {[Date, Date] | null}
 */
export function netWorthXDomain(points) {
	return netWorthChartXDomain(points, []);
}

/**
 * Fraction of the plotted range left as breathing room above and below the line, so the highest and
 * lowest months don't sit flush against the frame.
 */
export const NET_WORTH_Y_PADDING = 0.05;

/**
 * `[low, high]` for a set of plotted values, with breathing room added at each end.
 *
 * @param {readonly number[]} values
 * @param {{ includeZero?: boolean, padding?: number }} [options]
 * @returns {[number, number] | null}
 */
function paddedExtent(values, options = {}) {
	if (values.length === 0) return null;

	const { includeZero = true, padding = NET_WORTH_Y_PADDING } = options;

	let low = Math.min(...values);
	let high = Math.max(...values);
	if (includeZero) {
		low = Math.min(low, 0);
		high = Math.max(high, 0);
	}

	const span = high - low;
	const pad = Math.abs(padding) * (span > 0 ? span : Math.max(Math.abs(high), 1));

	const lower = low === 0 ? 0 : low - pad;
	const upper = high === 0 ? 0 : high + pad;
	// Both ends pinned to zero — a history of nothing but zeroes. Give the scale a range to work
	// with rather than handing it a single point it would divide by.
	return lower === upper ? [lower, upper + pad] : [lower, upper];
}

/**
 * The y extent: `[low, high]` for the chart's y domain, covering the tracked line and the whole of
 * the forecast band — the band's `low` and `high` edges, not just its realistic middle, or the
 * shading would run off the top of the plot in the optimistic scenario.
 *
 * `includeZero` defaults to **true**, so the axis always spans the zero line. A net worth is an
 * absolute magnitude, not an index — with a zoomed axis a rise from £120,000 to £121,000 draws the
 * same dramatic climb as one from £0 to £121,000, and a net worth that has gone negative doesn't
 * visibly cross anything. The cost is that a long, steadily-growing history looks flatter than a
 * zoomed axis would make it look, which is the honest picture rather than the flattering one. A
 * caller that wants the zoomed view — a later month-on-month change view, say — passes
 * `includeZero: false`.
 *
 * Padding is never applied *through* zero: when zero is an end of the range it stays exactly zero,
 * so the baseline is a real gridline rather than an arbitrary line near the bottom.
 *
 * `null` when there is nothing to plot, matching {@link netWorthChartXDomain}.
 *
 * @param {readonly NetWorthPoint[]} points
 * @param {readonly ForecastBandSeriesPoint[]} [band]
 * @param {{ includeZero?: boolean, padding?: number }} [options]
 * @returns {[number, number] | null}
 */
export function netWorthChartYExtent(points, band = [], options = {}) {
	const values = points.map((point) => point.net_worth);
	for (const point of band) values.push(point.low, point.high);

	return paddedExtent(values, options);
}

/**
 * The y extent of the tracked history alone — {@link netWorthChartYExtent} with no overlay.
 *
 * @param {readonly NetWorthPoint[]} points
 * @param {{ includeZero?: boolean, padding?: number }} [options]
 * @returns {[number, number] | null}
 */
export function netWorthYExtent(points, options = {}) {
	return netWorthChartYExtent(points, [], options);
}

/** How many labels the month axis aims for before it starts thinning them out. */
export const MONTH_TICK_TARGET = 6;

/**
 * Month-start dates to label the x axis with, spanning the tracked history and the forecast overlay
 * together.
 *
 * Ticks step evenly through the *calendar*, not through the points, so an eighteen-month gap gets
 * eighteen months of labelled axis rather than one — the same reason the x value is a date at all
 * (convention 3). The first and last months plotted are always labelled: they are the two a reader
 * looks for, and an unlabelled final month makes "how far does this run?" unanswerable. A trailing
 * tick closer than half a step to the last month is replaced by it rather than crowding beside it.
 *
 * Supplying ticks explicitly also keeps the axis off d3's own time-tick generator, which would pick
 * boundaries in the *local* zone and, west of Greenwich, label them a month early (convention 4).
 *
 * @param {readonly NetWorthPoint[]} points Oldest first.
 * @param {readonly ForecastBandSeriesPoint[]} [band] Oldest first.
 * @param {{ max?: number }} [options] Most labels to place. Two or more; anything less is read as 2.
 * @returns {Date[]} Oldest first.
 */
export function netWorthChartMonthTicks(points, band = [], options = {}) {
	const bounds = chartMonthBounds(points, band);
	if (!bounds) return [];

	const { first, last } = bounds;
	const span = monthsBetween(first, last);
	if (span <= 0) return [monthStartDate(first)];

	const max = Math.max(2, Math.trunc(options.max ?? MONTH_TICK_TARGET));
	const step = Math.max(1, Math.ceil(span / (max - 1)));

	/** @type {number[]} */
	const offsets = [];
	for (let offset = 0; offset <= span; offset += step) offsets.push(offset);

	const trailing = offsets[offsets.length - 1];
	if (trailing !== span) {
		if (span - trailing < step / 2) offsets[offsets.length - 1] = span;
		else offsets.push(span);
	}

	return offsets.map((offset) => monthStartDate(addMonths(first, offset)));
}

/**
 * Axis labels for the tracked history alone — {@link netWorthChartMonthTicks} with no overlay.
 *
 * @param {readonly NetWorthPoint[]} points Oldest first.
 * @param {{ max?: number }} [options]
 * @returns {Date[]} Oldest first.
 */
export function netWorthMonthTicks(points, options = {}) {
	return netWorthChartMonthTicks(points, [], options);
}
