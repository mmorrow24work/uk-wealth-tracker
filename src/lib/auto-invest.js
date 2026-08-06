/**
 * Auto-invest fill for missing months — README.md → "Net Worth Tracking": "Auto-invest amounts per
 * holding (fills missing months with compound growth)" (issue #15).
 *
 * A user who forgets to log February leaves a hole in the net worth series: every downstream
 * feature that walks `monthly_entries` (the chart, month-on-month change, the forecast's starting
 * point) either draws a straight line across the hole or silently treats March as the month after
 * January. This module closes the hole by *projecting forward* from the last recorded month —
 * growing each holding at a compound monthly rate and adding its contributions — and marking every
 * snapshot it invents with `auto_filled: true` so it stays visibly distinct from data the user
 * actually recorded.
 *
 * Three conventions decide the arithmetic, and every number this module produces follows them:
 *
 * 1. **The monthly rate is geometric, not `annual / 12`.** A 5% annual assumption becomes
 *    `1.05^(1/12) - 1` ≈ 0.4074%/month, so twelve filled months compound to exactly 5% — not the
 *    5.116% that dividing by twelve would produce. Over a decade of forecasts that difference is
 *    thousands of pounds, and this is the series every projection in the app builds on.
 * 2. **Growth first, then the contribution.** A month's contribution lands at the month end and so
 *    earns no growth in the month it is paid (an ordinary annuity):
 *    `value(n) = value(n-1) × (1 + r) + contribution`. Assuming the opposite — paying in at the
 *    start of the month — would quietly inflate every filled month.
 * 3. **Filled months are projected, never interpolated.** A gap between two real snapshots is
 *    filled from the *earlier* one, so the later real snapshot still says exactly what the user
 *    recorded, and the step onto it absorbs whatever the market actually did. Interpolating between
 *    the two endpoints would look smoother but would invent month-by-month attributions for a
 *    return we only know the total of.
 *
 * Everything here is pure: entries go in, a new array comes out, nothing is mutated.
 */

import { PAYMENTS_PER_YEAR } from './enums.js';
import { compareMonthlyEntries, createMonthlyEntry } from './model.js';

/*
 * Not re-declared as local `@typedef`s (same reasoning as `debt.js`/`activity-log.js`): `index.js`
 * re-exports every module with `export *`, and svelte-check flags two same-named top-level typedefs
 * across re-exported modules as an ambiguous export even though only `model.js`'s is meant to be
 * the public one. Referenced inline below as `import('./types.js').X`.
 */

/**
 * Annual growth assumption used when a caller supplies none. Matches `Profile.growth_rate`'s own
 * default, so filling with no options produces the same series the profile would.
 */
export const DEFAULT_GROWTH_RATE = 5;

/**
 * Months between payments for each contribution frequency — the inverse of
 * {@link PAYMENTS_PER_YEAR}, in the unit gap filling counts in.
 *
 * `one_off` is `Infinity` rather than a number: a lump sum was paid once, at some point this module
 * has no record of, so it is never repeated into a filled month.
 *
 * @type {Record<import('./enums.js').ContributionFrequency, number>}
 */
export const CONTRIBUTION_PERIOD_MONTHS = Object.freeze({
	monthly: 12 / PAYMENTS_PER_YEAR.monthly,
	quarterly: 12 / PAYMENTS_PER_YEAR.quarterly,
	annually: 12 / PAYMENTS_PER_YEAR.annually,
	one_off: Number.POSITIVE_INFINITY
});

/**
 * Longest gap this module will fill, in months. A hand-edited Gist holding a 1900 snapshot and a
 * 2200 one would otherwise expand into thousands of invented snapshots on load; a gap that large is
 * a data error, so it is left as a gap for the user to see rather than papered over.
 */
export const MAX_FILL_MONTHS = 1200;

/* -------------------------------------------------------------------------- */
/* Calendar arithmetic                                                         */
/* -------------------------------------------------------------------------- */

/** @typedef {{ month: number, year: number }} CalendarMonth */

/**
 * Months since year 0, so month arithmetic is plain integer arithmetic. Tolerates an out-of-range
 * month (a hand-edited `month: 0` or `13`) by rolling it into the neighbouring year, which is what
 * every consumer here wants — the alternative is throwing over data `normaliseAppData` accepted.
 *
 * @param {CalendarMonth} value
 * @returns {number}
 */
function toMonthIndex({ month, year }) {
	return year * 12 + (month - 1);
}

/**
 * @param {number} index
 * @returns {CalendarMonth}
 */
function fromMonthIndex(index) {
	return { month: (index % 12) + 1, year: Math.floor(index / 12) };
}

/**
 * Shift a calendar month by a whole number of months, rolling the year over as needed.
 *
 * @param {CalendarMonth} value
 * @param {number} count Months to add. Negative goes backwards.
 * @returns {CalendarMonth}
 */
export function addMonths(value, count) {
	return fromMonthIndex(toMonthIndex(value) + Math.trunc(count));
}

/**
 * Whole months from `from` to `to`. Positive when `to` is later; `1` for consecutive months, `0`
 * for the same month.
 *
 * @param {CalendarMonth} from
 * @param {CalendarMonth} to
 * @returns {number}
 */
export function monthsBetween(from, to) {
	return toMonthIndex(to) - toMonthIndex(from);
}

/**
 * Calendar months with no snapshot, between the earliest and latest entry given. Any entry counts
 * as present, auto-filled or not — pass {@link stripAutoFilledEntries}'s output to ask the other
 * question ("which months *would* a fill invent?").
 *
 * Duplicate months (which {@link import('./model.js').validateAppData} flags separately) and
 * unsorted input are both tolerated.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries
 * @returns {CalendarMonth[]} Oldest first.
 */
export function findMissingMonths(entries) {
	if (entries.length < 2) return [];

	const present = new Set(entries.map(toMonthIndex));
	const indexes = [...present];
	const first = Math.min(...indexes);
	const last = Math.max(...indexes);

	/** @type {CalendarMonth[]} */
	const missing = [];
	for (let index = first + 1; index < last; index += 1) {
		if (!present.has(index)) missing.push(fromMonthIndex(index));
	}
	return missing;
}

/* -------------------------------------------------------------------------- */
/* Compounding                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The monthly rate that compounds to `annualRatePct` over twelve months: `(1 + r)^(1/12) - 1`.
 *
 * Not `annualRatePct / 12` — see this module's convention (1). A total loss (-100% or worse) short
 * circuits to `-1` rather than producing `NaN` from a fractional power of a non-positive base.
 *
 * @param {number} annualRatePct Annual growth as a whole-number percent (`5` = 5%). May be negative.
 * @returns {number} Monthly rate as a decimal fraction (`0.004074` = 0.4074%/month).
 */
export function monthlyGrowthRate(annualRatePct) {
	const annualFactor = 1 + annualRatePct / 100;
	if (annualFactor <= 0) return -1;
	return annualFactor ** (1 / 12) - 1;
}

/**
 * Growth actually credited to a holding once its annual fund fee (OCF) is taken off. Fees are
 * charged on the fund value, so they compound against growth rather than subtracting from it:
 * `(1 + g)(1 - f) - 1`, not `g - f`. At 5% growth and a 0.22% OCF that is 4.7689%, not 4.78%.
 *
 * A holding's `fund_fee` is the only per-holding rate the data model records, so it is what makes
 * one holding compound differently from another under a single growth assumption.
 *
 * @param {number} annualRatePct Gross annual growth (%).
 * @param {number} fundFeePct Annual fund fee / OCF (%).
 * @returns {number} Net annual growth (%).
 */
export function netAnnualGrowthRate(annualRatePct, fundFeePct) {
	return ((1 + annualRatePct / 100) * (1 - fundFeePct / 100) - 1) * 100;
}

/**
 * What a holding pays in during the `offset`-th month after the snapshot a fill is projected from.
 *
 * `monthly_contribution` is the amount paid per `contribution_frequency` period (README.md's own
 * naming, see `types.js`), so a quarterly £900 is £900 every third month — not £900 monthly and not
 * £300 monthly. Payments are counted from the last recorded snapshot, the only anchor available:
 * with a January snapshot and a quarterly holding, April is the filled month that pays.
 *
 * @param {import('./types.js').Investment} investment
 * @param {number} offset Whole months since the anchor snapshot (1 = the first filled month).
 * @returns {number} Amount paid in that month (£).
 */
export function contributionForOffset(investment, offset) {
	const period = CONTRIBUTION_PERIOD_MONTHS[investment.contribution_frequency];
	return offset > 0 && offset % period === 0 ? investment.monthly_contribution : 0;
}

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * One month of compounding for a single holding: grow the opening value, then add any contribution
 * due that month.
 *
 * Rounds to whole pence and carries the *rounded* value into the next month, so a stored series is
 * exactly reproducible from its own numbers rather than only from hidden full-precision state.
 *
 * @param {import('./types.js').Investment} investment Holding as at the previous month end.
 * @param {number} offset Whole months since the anchor snapshot (1 = the first filled month).
 * @param {{ growthRate?: number, applyFundFees?: boolean }} [options]
 * @returns {number} Value at this month end (£).
 */
export function projectHoldingValue(investment, offset, options = {}) {
	const { growthRate = DEFAULT_GROWTH_RATE, applyFundFees = true } = options;
	const annualRate = applyFundFees
		? netAnnualGrowthRate(growthRate, investment.fund_fee)
		: growthRate;
	const grown = investment.value * (1 + monthlyGrowthRate(annualRate));
	return roundMoney(grown + contributionForOffset(investment, offset));
}

/* -------------------------------------------------------------------------- */
/* Filling                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every snapshot the user actually recorded — auto-filled ones dropped.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries
 * @returns {import('./types.js').MonthlyEntry[]}
 */
export function stripAutoFilledEntries(entries) {
	return entries.filter((entry) => !entry.auto_filled);
}

/** @param {readonly import('./types.js').MonthlyEntry[]} entries @returns {import('./types.js').MonthlyEntry[]} */
export function autoFilledEntries(entries) {
	return entries.filter((entry) => entry.auto_filled);
}

/**
 * Project `count` consecutive months forward from `anchor`.
 *
 * @param {import('./types.js').MonthlyEntry} anchor
 * @param {number} count
 * @param {{ growthRate?: number, applyFundFees?: boolean }} options
 * @returns {import('./types.js').MonthlyEntry[]}
 */
function projectMonths(anchor, count, options) {
	/** @type {import('./types.js').MonthlyEntry[]} */
	const filled = [];
	let holdings = anchor.investments;

	for (let offset = 1; offset <= count; offset += 1) {
		holdings = holdings.map((investment) => ({
			...investment,
			value: projectHoldingValue(investment, offset, options)
		}));

		filled.push(
			createMonthlyEntry({
				...addMonths(anchor, offset),
				investments: holdings,
				// Debts carry forward untouched: nothing in the data model says how a balance
				// amortises month to month (interest rate and monthly payment live on `Property`,
				// not `Debt`), and inventing a repayment schedule would be a different feature.
				debts: anchor.debts.map((debt) => ({ ...debt })),
				auto_filled: true
			})
		);
	}

	return filled;
}

/**
 * Fill the calendar months that have no snapshot, so the history the charts and month-on-month
 * diffs walk is continuous.
 *
 * Each gap is projected forward from the recorded snapshot before it: every holding compounds at
 * the monthly equivalent of `growthRate` (net of its own `fund_fee` unless `applyFundFees` is
 * false) and receives its contributions on schedule; debts carry forward unchanged. The recorded
 * snapshot that closes a gap is never altered.
 *
 * Idempotent: any entry already marked `auto_filled` is discarded and recomputed, so filling twice
 * gives the same answer as filling once, and a snapshot the user later records *inside* a filled
 * gap wins over the months this invented around it.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Recorded snapshots, any order.
 * @param {{ growthRate?: number, applyFundFees?: boolean, through?: CalendarMonth | null }} [options]
 *   `growthRate` — annual growth assumption (%), normally `profile.growth_rate`.
 *   `applyFundFees` — deduct each holding's OCF from that growth (default `true`).
 *   `through` — also project past the last recorded snapshot up to and including this month, for
 *   "I haven't logged since March". Off by default: months after the last real snapshot are a
 *   forecast, and forecasting is issue #16's job, not history keeping.
 * @returns {import('./types.js').MonthlyEntry[]} Recorded and filled snapshots, oldest first.
 */
export function fillMissingMonths(entries, options = {}) {
	const { through = null } = options;
	const recorded = stripAutoFilledEntries(entries).slice().sort(compareMonthlyEntries);
	if (recorded.length === 0) return [];

	/** @type {import('./types.js').MonthlyEntry[]} */
	const result = [];

	recorded.forEach((entry, index) => {
		result.push(entry);

		const next = recorded[index + 1];
		const boundary = next ?? through;
		if (!boundary) return;

		// Months strictly between this snapshot and the next one — or, for the trailing `through`
		// case, up to and including `through` itself, since no snapshot occupies that month yet.
		const gap = monthsBetween(entry, boundary) - (next ? 1 : 0);
		if (gap <= 0 || gap > MAX_FILL_MONTHS) return;

		result.push(...projectMonths(entry, gap, options));
	});

	return result;
}
