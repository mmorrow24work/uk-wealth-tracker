/**
 * Three-scenario net worth projections — README.md → "Forecast": "Three-scenario projections:
 * pessimistic / realistic / optimistic", built "based on current holdings, contributions, and
 * growth-rate assumptions per holding" (issue #16).
 *
 * A forecast takes the latest position — every holding with its own value, contribution schedule
 * and fund fee, plus the debts owed against them — and walks it forward month by month under three
 * growth assumptions, producing one point per month per scenario. The realistic scenario is the
 * user's own growth assumption (`Profile.growth_rate`); the other two are that assumption shifted
 * down and up by a fixed spread in percentage points.
 *
 * Four conventions decide what the numbers mean:
 *
 * 1. **A forecast continues the history, it does not restate it.** Offset 0 of every scenario is
 *    the anchor position itself, identical across all three, so a chart can join the tracked line
 *    to the forecast lines without a step at the join.
 * 2. **The arithmetic is `auto-invest.js`'s, exactly.** Geometric monthly rate, growth credited
 *    before the month's contribution, each holding's fund fee netted off its growth, values rounded
 *    to whole pence each month and the rounded value carried forward. A forecast month is the same
 *    number {@link import('./auto-invest.js').fillMissingMonths} would have produced for that month
 *    — the two must agree, because the forecast is what happens after the history runs out.
 * 3. **Scenarios differ only by a parallel shift of the growth rate.** Pessimistic is not a crash
 *    and optimistic is not a boom: both are "what if the long-run average were this instead". A
 *    crash with a magnitude, a date and a recovery is the stress test overlay (README.md →
 *    "Forecast", issue #21) — which builds its path out of {@link ForecastOptions.adjustMonth}
 *    rather than out of a second projector — and path-dependent return sequences are the Monte
 *    Carlo simulator (README.md → Phase 2). Keeping this module's own scenarios to a parallel shift
 *    is what makes its output a smooth confidence band rather than three unrelated stories.
 * 4. **Net worth is what counts towards net worth.** Holdings and debts flagged
 *    `exclude_from_net_worth` are dropped before projecting, matching `debt.js`'s totals, so the
 *    forecast never quietly re-includes a mortgage the user excluded because the property tab
 *    already tracks its equity.
 *
 * Everything here is pure: positions go in, new arrays come out, nothing is mutated.
 */

import {
	DEFAULT_GROWTH_RATE,
	addMonths,
	contributionForOffset,
	netAnnualGrowthRate,
	projectHoldingValue
} from './auto-invest.js';
import { compareMonthlyEntries } from './model.js';

/*
 * As in `debt.js`/`auto-invest.js`: types are referenced inline as `import('./types.js').X` rather
 * than re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *`
 * and svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The three scenarios, ordered worst to best — the order a chart legend and a summary table both
 * want, and the order {@link forecastBand}'s low/mid/high follows.
 *
 * @typedef {'pessimistic' | 'realistic' | 'optimistic'} ForecastScenario
 */

/** @type {readonly ForecastScenario[]} */
export const FORECAST_SCENARIOS = Object.freeze(['pessimistic', 'realistic', 'optimistic']);

/** @type {Record<ForecastScenario, string>} */
export const FORECAST_SCENARIO_LABELS = Object.freeze({
	pessimistic: 'Pessimistic',
	realistic: 'Realistic',
	optimistic: 'Optimistic'
});

/**
 * How far the outer scenarios sit from the realistic one, in **percentage points** of annual
 * growth. At the default 5% assumption that is 3% / 5% / 7%.
 *
 * README.md names the three scenarios but gives no numbers, so this is ours. ±2pp is wide enough
 * that the band is worth drawing — over 30 years it separates the outer scenarios by roughly a
 * factor of three — and narrow enough that the pessimistic case stays a plausible long-run
 * *average* rather than a disaster. A permanently negative growth rate is not a pessimistic plan,
 * it is a different exercise (see convention 3 above).
 */
export const DEFAULT_SCENARIO_SPREAD = 2;

/** Default projection horizon in months (30 years) when a caller names none. */
export const DEFAULT_FORECAST_MONTHS = 360;

/**
 * Longest horizon this module will project. Beyond a century the numbers are noise, and an
 * unbounded `months` from a slider or a hand-edited document would otherwise build a series big
 * enough to lock the tab up. Longer requests are clamped, not rejected.
 */
export const MAX_FORECAST_MONTHS = 1200;

/** Growth rates are whole-number percents; `validateAppData` accepts -100…100, so match it. */
const MIN_RATE_PCT = -100;
const MAX_RATE_PCT = 100;

/**
 * @param {number} value
 * @returns {number}
 */
function clampRate(value) {
	return Math.min(MAX_RATE_PCT, Math.max(MIN_RATE_PCT, value));
}

/**
 * The annual growth rate each scenario assumes: the realistic rate, and that rate shifted down and
 * up by `spread` percentage points. A negative `spread` is read as its magnitude, so the returned
 * rates are always ordered pessimistic ≤ realistic ≤ optimistic.
 *
 * @param {number} [realisticRatePct] Annual growth the user believes in (%), normally
 *   `Profile.growth_rate`.
 * @param {number} [spreadPct] Distance to each outer scenario, in percentage points.
 * @returns {Record<ForecastScenario, number>}
 */
export function scenarioGrowthRates(
	realisticRatePct = DEFAULT_GROWTH_RATE,
	spreadPct = DEFAULT_SCENARIO_SPREAD
) {
	const spread = Math.abs(spreadPct);
	return {
		pessimistic: clampRate(realisticRatePct - spread),
		realistic: clampRate(realisticRatePct),
		optimistic: clampRate(realisticRatePct + spread)
	};
}

/**
 * The shift applied to the growth assumption for one scenario, in percentage points.
 *
 * @param {ForecastScenario} scenario
 * @param {number} spreadPct
 * @returns {number}
 */
export function scenarioRateDelta(scenario, spreadPct = DEFAULT_SCENARIO_SPREAD) {
	const spread = Math.abs(spreadPct);
	if (scenario === 'pessimistic') return -spread;
	if (scenario === 'optimistic') return spread;
	return 0;
}

/* -------------------------------------------------------------------------- */
/* Per-holding rates                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What one month does differently from the rest of the projection — the seam the stress test overlay
 * (`stress-test.js`, issue #21) builds a crash and its recovery out of, the income shock overlay
 * (`income-shock.js`, issue #133) builds a contribution drop out of, and the one-off large costs
 * overlay (`one-off-costs.js`, issue #136) builds a lump-sum withdrawal out of, so each is this
 * module's own arithmetic with a month's worth of assumptions swapped rather than a second projector
 * that could drift from it.
 *
 * `growthRate`/`factor`, `contributionFactor` and `withdrawal` are independent — a month can carry
 * any combination of them, because a market crash, an income shock and a one-off cost are different
 * events that happen to share the same hook. Between the growth fields, `factor` wins if both are
 * given:
 *
 * - `growthRate` replaces the *base* annual assumption for that month, for every holding. The
 *   scenario shift and each holding's fund fee still apply on top, so a recovery window keeps the
 *   three-scenario band rather than collapsing it to one line. Per-holding overrides
 *   ({@link ForecastOptions.holdingGrowthRates}) are deliberately ignored while an override is in
 *   force: a crash and its rebound are market-wide events, and a per-holding long-run assumption
 *   ("cash earns 1%") does not describe either.
 * - `factor` replaces the month's growth outright: the holding's opening value is multiplied by it
 *   and the month's contribution added, with no rate, no compounding and no fund fee involved. That
 *   is what makes "a 35% crash" mean the pot falls exactly 35% rather than 35% plus or minus a
 *   month of ordinary growth.
 * - `contributionFactor` scales every holding's contribution for that month instead of its growth —
 *   `0` stops contributions outright (job loss), `0.5` halves them (reduced income). The market still
 *   moves normally (or per `growthRate`/`factor`, if both are in force the same month) — an income
 *   shock changes the standing order, not the market, which is the mirror image of convention 5 in
 *   `stress-test.js`'s module doc ("a crash changes the market, not the standing order").
 * - `withdrawal` takes a stated number of pounds *out* of the pot for that month, after growth and
 *   the contribution are applied — a wedding, a car, a home renovation. Spread pro rata across every
 *   holding by its opening value that month (the same "no per-holding beta" reasoning
 *   `stress-test.js`'s crash uses for its own market-wide `factor`: nothing in the data model says
 *   which holding a lump sum comes out of), and capped at what the pot actually holds that month — a
 *   cost bigger than the whole pot drains it to zero rather than going negative, and the shortfall is
 *   dropped rather than carried into a later month, matching `income-shock.js`'s and
 *   `mortgage-rate-rise.js`'s own "nothing is ever paid back" convention.
 *
 * Either way the month's contribution is still paid on schedule (scaled by `contributionFactor` when
 * given), and the change in value is still booked to `growth` — a crash is negative growth, a smaller
 * contribution is simply less of it, and a withdrawal is negative growth too, so
 * {@link ForecastPoint}'s split keeps reconciling (`compounding.js` → `reconcileCompounding`).
 *
 * @typedef {object} ForecastMonthAdjustment
 * @property {number} [growthRate] Annual growth (%) replacing the base assumption for this month.
 * @property {number} [factor] Multiplicative move for this month — `0.65` for a 35% fall.
 * @property {number} [contributionFactor] Multiplier on every holding's contribution for this month
 *   — `0` skips it entirely, `1` (the default when omitted) pays it in full.
 * @property {number} [withdrawal] Pounds taken out of the pot this month, pro rata across holdings —
 *   `0` (the default when omitted) takes nothing out.
 */

/**
 * Options shared by every projection entry point here.
 *
 * @typedef {object} ForecastOptions
 * @property {number} [growthRate] Annual growth assumption applied to every holding without an
 *   override (%). Defaults to `auto-invest.js`'s `DEFAULT_GROWTH_RATE` (5%).
 * @property {Record<string, number>} [holdingGrowthRates] Per-holding annual growth (%), keyed by
 *   `Investment.id`. This is issue #16's "growth-rate assumptions per holding": `Investment` has no
 *   `growth_rate` field of its own (README.md's data model doesn't give it one, and #2 transcribed
 *   that outline deliberately), so a caller that wants cash to grow at 1% while equities grow at 7%
 *   passes the difference in here rather than through the persisted document.
 * @property {boolean} [applyFundFees] Net each holding's annual fund fee (OCF) off its growth
 *   before compounding. Default `true`.
 * @property {number} [growthRateDelta] Percentage points added to every rate above — how a scenario
 *   is expressed. Normally set by {@link forecastScenarios}, not by a caller.
 * @property {((offset: number) => ForecastMonthAdjustment | null) | null} [adjustMonth] Called once
 *   per projected month with its offset (1 = the first month after the anchor). Return `null` — as
 *   an absent hook does — to project that month normally. See {@link ForecastMonthAdjustment}.
 */

/**
 * The annual rate one holding actually compounds at: its own override if it has one, otherwise the
 * single assumption; shifted by the scenario delta; then netted against its fund fee.
 *
 * Order matters. The scenario shift lands on the gross rate, so a 0.22% OCF costs the same in every
 * scenario, and the fee compounds against growth rather than subtracting from it — `auto-invest.js`
 * → {@link netAnnualGrowthRate}.
 *
 * @param {import('./types.js').Investment} investment
 * @param {ForecastOptions} [options]
 * @returns {number} Net annual growth (%) for this holding.
 */
export function resolveHoldingGrowthRate(investment, options = {}) {
	const {
		growthRate = DEFAULT_GROWTH_RATE,
		holdingGrowthRates = {},
		applyFundFees = true,
		growthRateDelta = 0
	} = options;

	const override = holdingGrowthRates[investment.id];
	const base = clampRate((typeof override === 'number' ? override : growthRate) + growthRateDelta);
	return applyFundFees ? netAnnualGrowthRate(base, investment.fund_fee) : base;
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One month of one scenario.
 *
 * `contributions` and `growth` are cumulative since the anchor and always add up to the change in
 * `investments` since offset 0 — the split README.md's compounding effect panel (issue #20) needs,
 * recorded here because the projection is the only place that knows it.
 *
 * @typedef {object} ForecastPoint
 * @property {number} offset Whole months since the anchor. `0` is the anchor itself.
 * @property {number} month Calendar month, 1–12.
 * @property {number} year Four-digit calendar year.
 * @property {number} investments Total value of the projected holdings (£).
 * @property {number} debts Total debt balance carried at this month (£).
 * @property {number} net_worth `investments - debts` (£).
 * @property {number} contributions Cumulative contributions paid in since the anchor (£).
 * @property {number} growth Cumulative growth earned since the anchor (£), net of fund fees.
 */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * Holdings that count towards net worth — convention 4.
 *
 * @param {readonly import('./types.js').Investment[]} investments
 * @returns {import('./types.js').Investment[]}
 */
function countableHoldings(investments) {
	return investments.filter((investment) => !investment.exclude_from_net_worth);
}

/**
 * @param {readonly import('./types.js').Debt[]} debts
 * @returns {import('./types.js').Debt[]}
 */
function countableDebts(debts) {
	return debts.filter((debt) => !debt.exclude_from_net_worth);
}

/**
 * @param {readonly { value: number }[]} holdings
 * @returns {number}
 */
function totalValue(holdings) {
	return roundMoney(holdings.reduce((total, holding) => total + holding.value, 0));
}

/**
 * The calendar month a forecast starts from when the caller names none — today's, so a projection
 * built from nothing but assumptions is still dated sensibly.
 *
 * @returns {{ month: number, year: number }}
 */
export function currentCalendarMonth() {
	const now = new Date();
	return { month: now.getMonth() + 1, year: now.getFullYear() };
}

/**
 * Walk one position forward under one growth assumption.
 *
 * Each month every holding grows at the monthly equivalent of its own rate
 * ({@link resolveHoldingGrowthRate}) and then receives whatever contribution its
 * `contribution_frequency` puts in that month, counted from the anchor — a January anchor and a
 * quarterly holding pays in April. Debts are carried forward unchanged: nothing in the data model
 * says how a balance amortises (interest rate and monthly payment live on `Property`, not `Debt`),
 * so inventing a repayment schedule would make the net worth line depend on a number nobody
 * entered. A user who expects their mortgage to fall can see that on the property tab instead.
 *
 * `options.adjustMonth` overrides individual months — see {@link ForecastMonthAdjustment}.
 *
 * @param {object} input
 * @param {readonly import('./types.js').Investment[]} [input.investments] Holdings at the anchor.
 * @param {readonly import('./types.js').Debt[]} [input.debts] Debts at the anchor.
 * @param {{ month: number, year: number }} [input.start] Anchor month. Defaults to the current one.
 * @param {number} [input.months] Months to project. Clamped to 0…{@link MAX_FORECAST_MONTHS}.
 * @param {ForecastOptions} [options]
 * @returns {ForecastPoint[]} Oldest first, `months + 1` long — offset 0 is the anchor.
 */
export function projectScenario(input = {}, options = {}) {
	const {
		investments = [],
		debts = [],
		start = currentCalendarMonth(),
		months = DEFAULT_FORECAST_MONTHS
	} = input;

	const horizon = Math.min(MAX_FORECAST_MONTHS, Math.max(0, Math.trunc(months)));
	let holdings = countableHoldings(investments);
	const debtTotal = roundMoney(
		countableDebts(debts).reduce((total, debt) => total + debt.balance, 0)
	);

	let contributions = 0;
	let growth = 0;

	/** @type {ForecastPoint[]} */
	const points = [
		{
			offset: 0,
			...start,
			investments: totalValue(holdings),
			debts: debtTotal,
			net_worth: roundMoney(totalValue(holdings) - debtTotal),
			contributions: 0,
			growth: 0
		}
	];

	for (let offset = 1; offset <= horizon; offset += 1) {
		// A month the caller wants projected differently — a crash, a month inside a recovery window,
		// or a month an income shock has scaled the contribution for. Resolved once per month rather
		// than per holding: the adjustment is market-wide by construction, so asking for it once is
		// both cheaper and the honest expression of that.
		const adjustment = options.adjustMonth?.(offset) ?? null;
		const factor = typeof adjustment?.factor === 'number' ? adjustment.factor : null;
		const contributionFactor =
			typeof adjustment?.contributionFactor === 'number' ? adjustment.contributionFactor : 1;
		const monthOptions =
			typeof adjustment?.growthRate === 'number'
				? { ...options, growthRate: adjustment.growthRate, holdingGrowthRates: {} }
				: options;

		// Weighted by each holding's *opening* value this month, the same value `factor` itself is
		// applied to — one pass over `holdings` rather than a second one to re-derive the weights
		// after growth has already moved them. Capped at what the pot held before this month's
		// changes, so a withdrawal larger than the whole pot drains it to zero instead of going
		// negative (see the module doc, `ForecastMonthAdjustment.withdrawal`).
		const withdrawal =
			typeof adjustment?.withdrawal === 'number' ? Math.max(0, adjustment.withdrawal) : 0;
		const potBeforeWithdrawal = withdrawal > 0 ? totalValue(holdings) : 0;
		const appliedWithdrawal = Math.min(withdrawal, potBeforeWithdrawal);

		holdings = holdings.map((investment) => {
			const paid = contributionForOffset(investment, offset) * contributionFactor;
			const grown =
				factor === null
					? // The fee is already folded into the resolved rate, so the primitive must not apply
						// it a second time — hence `applyFundFees: false` here regardless of the caller's
						// choice.
						projectHoldingValue(investment, offset, {
							growthRate: resolveHoldingGrowthRate(investment, monthOptions),
							applyFundFees: false,
							contributionFactor
						})
					: // A stated move, applied to the opening value with the month's (possibly scaled)
						// contribution added on top — same shape and same rounding as `projectHoldingValue`,
						// minus the rate.
						roundMoney(investment.value * factor + paid);

			const share =
				appliedWithdrawal > 0
					? roundMoney((investment.value / potBeforeWithdrawal) * appliedWithdrawal)
					: 0;
			const value = roundMoney(Math.max(0, grown - share));

			contributions += paid;
			// Growth is what the month's value change was *not* explained by the contribution, so
			// the two always reconcile to the value change exactly, rounding included. A crash is
			// therefore booked as negative growth, a skipped contribution is simply less of it, and a
			// withdrawal is negative growth too — there is no fourth bucket for it to sit in.
			growth += value - investment.value - paid;

			return { ...investment, value };
		});

		const investmentTotal = totalValue(holdings);
		points.push({
			offset,
			...addMonths(start, offset),
			investments: investmentTotal,
			debts: debtTotal,
			net_worth: roundMoney(investmentTotal - debtTotal),
			contributions: roundMoney(contributions),
			growth: roundMoney(growth)
		});
	}

	return points;
}

/**
 * A whole forecast: the same position projected under all three scenarios.
 *
 * @typedef {object} Forecast
 * @property {{ month: number, year: number }} start Anchor month, shared by every scenario.
 * @property {number} months Horizon actually projected, after clamping.
 * @property {number} spread Percentage-point distance to each outer scenario.
 * @property {Record<ForecastScenario, number>} rates Headline annual growth per scenario (%),
 *   before per-holding overrides and fund fees.
 * @property {Record<ForecastScenario, ForecastPoint[]>} series One point per month per scenario.
 */

/**
 * Project the three scenarios from one position.
 *
 * @param {object} input As {@link projectScenario}'s, plus:
 * @param {readonly import('./types.js').Investment[]} [input.investments]
 * @param {readonly import('./types.js').Debt[]} [input.debts]
 * @param {{ month: number, year: number }} [input.start]
 * @param {number} [input.months]
 * @param {number} [input.spread] Percentage points to each outer scenario. Defaults to
 *   {@link DEFAULT_SCENARIO_SPREAD}.
 * @param {ForecastOptions} [options] `growthRate` here is the *realistic* assumption; the outer two
 *   scenarios are derived from it. Any `growthRateDelta` passed in is ignored — the scenario owns it.
 * @returns {Forecast}
 */
export function forecastScenarios(input = {}, options = {}) {
	const { spread = DEFAULT_SCENARIO_SPREAD, ...position } = input;
	const { growthRate = DEFAULT_GROWTH_RATE } = options;

	// Resolved once, not per scenario: three separate `currentCalendarMonth()` calls could straddle
	// midnight on the 1st and anchor the same forecast in two different months.
	const start = position.start ?? currentCalendarMonth();
	const months = Math.min(
		MAX_FORECAST_MONTHS,
		Math.max(0, Math.trunc(position.months ?? DEFAULT_FORECAST_MONTHS))
	);

	/** @type {Record<ForecastScenario, ForecastPoint[]>} */
	const series = /** @type {Record<ForecastScenario, ForecastPoint[]>} */ ({});
	for (const scenario of FORECAST_SCENARIOS) {
		series[scenario] = projectScenario(
			{ ...position, start, months },
			{ ...options, growthRateDelta: scenarioRateDelta(scenario, spread) }
		);
	}

	return {
		start,
		months,
		spread: Math.abs(spread),
		rates: scenarioGrowthRates(growthRate, spread),
		series
	};
}

/**
 * The position a forecast built from a recorded history starts from: the latest entry's holdings,
 * debts and month.
 *
 * The anchor is the latest entry, auto-filled or recorded — a forecast should start from the most
 * recent position known, and `auto-invest.js`'s filled months are that position for anyone who
 * skipped a month. `null` when there is no history to anchor on, so a caller can tell "nothing to
 * forecast yet" from "a forecast that happens to be flat".
 *
 * Exported separately from {@link forecastFromEntries} because a caller that wants to project the
 * *same* position twice under different assumptions — the stress test overlay projecting a crash
 * alongside the unstressed baseline (issue #21) — must not re-derive the anchor itself and risk
 * anchoring the two projections differently.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {{ investments: import('./types.js').Investment[], debts: import('./types.js').Debt[], start: { month: number, year: number } } | null}
 */
export function positionFromEntries(entries) {
	if (entries.length === 0) return null;

	const latest = [...entries].sort(compareMonthlyEntries).at(-1);
	if (!latest) return null;

	return {
		investments: latest.investments,
		debts: latest.debts,
		start: { month: latest.month, year: latest.year }
	};
}

/**
 * Project forward from a recorded history — the normal entry point once monthly snapshots exist.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @param {{ months?: number, spread?: number }} [input]
 * @param {ForecastOptions} [options]
 * @returns {Forecast | null}
 */
export function forecastFromEntries(entries, input = {}, options = {}) {
	const position = positionFromEntries(entries);
	if (!position) return null;

	return forecastScenarios({ ...input, ...position }, options);
}

/* -------------------------------------------------------------------------- */
/* Reading a forecast                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One month of the shaded confidence band README.md → "Net Worth Tracking" asks the net worth chart
 * to draw ("tracked line + realistic/optimistic/pessimistic forecast lines with shaded confidence
 * band", issue #12).
 *
 * `low`/`high` are the extremes across the three scenarios rather than pessimistic/optimistic by
 * name — with an ordered set of rates those are the same thing, but taking the extremes means a
 * band is still a band if a caller ever hands in rates that aren't ordered.
 *
 * @typedef {object} ForecastBandPoint
 * @property {number} offset
 * @property {number} month
 * @property {number} year
 * @property {number} low Lowest net worth across the scenarios at this month (£).
 * @property {number} mid Realistic net worth (£).
 * @property {number} high Highest net worth across the scenarios (£).
 */

/**
 * Collapse a forecast into one series of low/mid/high net worth per month.
 *
 * @param {Forecast} forecast
 * @returns {ForecastBandPoint[]}
 */
export function forecastBand(forecast) {
	return forecast.series.realistic.map((point, index) => {
		const values = FORECAST_SCENARIOS.map(
			(scenario) => forecast.series[scenario][index]?.net_worth ?? point.net_worth
		);
		return {
			offset: point.offset,
			month: point.month,
			year: point.year,
			low: Math.min(...values),
			mid: point.net_worth,
			high: Math.max(...values)
		};
	});
}

/**
 * The point `years` years into a scenario, or `null` if the forecast does not run that far.
 *
 * @param {Forecast} forecast
 * @param {ForecastScenario} scenario
 * @param {number} years
 * @returns {ForecastPoint | null}
 */
export function forecastPointAtYear(forecast, scenario, years) {
	const offset = Math.round(years * 12);
	return forecast.series[scenario][offset] ?? null;
}

/** Horizons a summary table shows by default, in years. */
export const DEFAULT_SUMMARY_YEARS = Object.freeze([1, 5, 10, 20, 30]);

/**
 * One row of a scenario comparison table.
 *
 * @typedef {object} ForecastSummaryRow
 * @property {number} years Years from the anchor — fractional on the final row when the horizon is
 *   not a whole number of years.
 * @property {number} offset Months from the anchor.
 * @property {number} month
 * @property {number} year
 * @property {Record<ForecastScenario, number>} net_worth Net worth per scenario at this month (£).
 * @property {number} contributions Cumulative contributions by this month (£) — identical across
 *   scenarios, since only growth differs between them.
 */

/**
 * One {@link ForecastSummaryRow} for a single realistic-scenario point, reading the matching
 * pessimistic/optimistic values off the same offset. The one place that shape is assembled, so
 * {@link summariseForecast} and `age-filter.js`'s {@link import('./age-filter.js').summariseForecastByAge}
 * — which picks a different set of offsets but wants identically-shaped rows — agree by construction
 * rather than by two hand-written object literals staying in sync.
 *
 * @param {Forecast} forecast
 * @param {ForecastPoint} point A point from `forecast.series.realistic`.
 * @returns {ForecastSummaryRow}
 */
export function forecastSummaryRow(forecast, point) {
	return {
		years: point.offset / 12,
		offset: point.offset,
		month: point.month,
		year: point.year,
		net_worth: {
			pessimistic: forecast.series.pessimistic[point.offset]?.net_worth ?? point.net_worth,
			realistic: point.net_worth,
			optimistic: forecast.series.optimistic[point.offset]?.net_worth ?? point.net_worth
		},
		contributions: point.contributions
	};
}

/**
 * Summarise a forecast at a handful of horizons. Horizons past the end of the forecast are dropped,
 * and the forecast's own final month is always included (once), so the table always ends where the
 * projection does rather than at whichever round number happened to fit.
 *
 * @param {Forecast} forecast
 * @param {readonly number[]} [years]
 * @returns {ForecastSummaryRow[]}
 */
export function summariseForecast(forecast, years = DEFAULT_SUMMARY_YEARS) {
	const horizonYears = forecast.months / 12;
	const wanted = [...years.filter((value) => value > 0 && value <= horizonYears), horizonYears]
		.map((value) => Math.round(value * 12))
		.filter((offset) => offset > 0 && offset <= forecast.months);

	/** @type {ForecastSummaryRow[]} */
	const rows = [];
	for (const offset of [...new Set(wanted)].sort((a, b) => a - b)) {
		const point = forecast.series.realistic[offset];
		if (!point) continue;
		rows.push(forecastSummaryRow(forecast, point));
	}
	return rows;
}
