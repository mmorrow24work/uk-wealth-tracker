/**
 * Compounding effect — README.md → "Forecast": "Compounding effect panel: contributions vs growth
 * split" (issue #20).
 *
 * The question the panel answers is "how much of this projection is money I pay in, and how much is
 * money my money earns?" — and, the part that makes it a *compounding* panel rather than a pie
 * chart, "when does the second overtake the first?".
 *
 * Four conventions decide what the numbers mean:
 *
 * 1. **The split is read off the projection, never recomputed.** `forecast.js` already records
 *    cumulative `contributions` and `growth` on every {@link import('./forecast.js').ForecastPoint},
 *    accumulated as "the part of the month's value change the contribution didn't explain" — the
 *    projection is the only place that knows the split, so recomputing it here from rates and
 *    frequencies would produce a second answer that drifts from the lines the rest of the tab draws.
 *    This module reads, divides and dates; it does no compounding arithmetic of its own.
 * 2. **The split reconciles exactly, and that is checked rather than asserted.** For every scenario
 *    and every month, `investments = starting + contributions + growth` to within a penny of
 *    rounding. {@link reconcileCompounding} is that identity as a function the tests run over whole
 *    forecasts — issue #20's "verify the split math is internally consistent with the forecast
 *    projections" made executable rather than eyeballed.
 * 3. **Contributions vs growth is a split of the *gain*; the pot has a third part.** A forecast's
 *    final value is `starting + contributions + growth`, and the starting position is neither
 *    contributed nor earned over the forecast period — it is where the user already is. So
 *    `contributionShare`/`growthShare` are shares of the gain (they sum to 1, matching the issue's
 *    "contributions vs growth split"), while `starting` is carried alongside for a panel that wants
 *    to show all three parts of the projected pot.
 * 4. **Only growth differs between scenarios.** Contributions are a payment schedule, not a return,
 *    so all three scenarios pay in the same amount at every month; the pessimistic/optimistic
 *    comparison is a comparison of growth alone. {@link reconcileCompounding} checks that too, since
 *    a panel that prints one contributions figure beside three growth figures is relying on it.
 *
 * Everything here is pure: a forecast goes in, new objects come out, nothing is mutated.
 */

import { DEFAULT_SUMMARY_YEARS, FORECAST_SCENARIOS, summariseForecast } from './forecast.js';

/*
 * As elsewhere in `$lib`, types are referenced inline as `import('./forecast.js').X` rather than
 * re-declared as local `@typedef`s — `index.js` re-exports every module with `export *`, and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/**
 * How far `starting + contributions + growth` may sit from the projected `investments` total before
 * the split counts as broken, in pounds.
 *
 * A penny, because that is the most rounding can cost: `forecast.js` rounds each of the two
 * accumulators to whole pence at every point (half a penny each, worst case) and the value series it
 * is reconciled against is built from values already rounded to pence. Anything larger is an
 * arithmetic bug, not rounding.
 */
export const COMPOUNDING_TOLERANCE = 0.01;

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * One month of one scenario, split into where the money came from.
 *
 * `starting + contributions + growth === investments` (convention 2), and
 * `contributionShare + growthShare === 1` whenever there is a gain to divide.
 *
 * @typedef {object} CompoundingPoint
 * @property {import('./forecast.js').ForecastScenario} scenario
 * @property {number} offset Whole months since the anchor. `0` is the anchor itself.
 * @property {number} month Calendar month, 1–12.
 * @property {number} year Four-digit calendar year.
 * @property {number} starting Invested at the anchor (£) — identical in every scenario.
 * @property {number} contributions Paid in since the anchor (£) — identical in every scenario.
 * @property {number} growth Earned since the anchor (£), net of fund fees. Negative under a
 *   scenario that loses money.
 * @property {number} gain `contributions + growth` (£): everything the forecast period added.
 * @property {number} investments Total invested value at this month (£).
 * @property {number} net_worth Net worth at this month (£) — investments less the debts carried
 *   forward. The *gain* is the same either way (debts are constant through a forecast), so the split
 *   below describes net worth growth just as well; only the base differs.
 * @property {number | null} contributionShare Contributions as a fraction of the gain (`0.4` = 40%),
 *   or `null` at a point with no gain to divide. Can exceed 1 when growth is negative.
 * @property {number | null} growthShare Growth as a fraction of the gain, or `null`. Negative when
 *   the scenario has lost money since the anchor.
 * @property {number} residual `investments - (starting + contributions + growth)` (£) — zero to
 *   within {@link COMPOUNDING_TOLERANCE} on any forecast this module was built for. Carried on every
 *   point so {@link reconcileCompounding} has nothing to recompute.
 */

/**
 * Split one month of one scenario, or `null` when the forecast does not run that far.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @param {number} [offset] Months since the anchor. Defaults to the forecast's final month.
 * @returns {CompoundingPoint | null}
 */
export function compoundingPointAt(forecast, scenario = 'realistic', offset = forecast.months) {
	const series = forecast.series[scenario];
	const point = series?.[offset];
	if (!point) return null;

	const starting = series[0]?.investments ?? 0;
	const { contributions, growth } = point;
	const gain = roundMoney(contributions + growth);

	return {
		scenario,
		offset: point.offset,
		month: point.month,
		year: point.year,
		starting,
		contributions,
		growth,
		gain,
		investments: point.investments,
		net_worth: point.net_worth,
		contributionShare: gain === 0 ? null : contributions / gain,
		growthShare: gain === 0 ? null : growth / gain,
		residual: point.investments - (starting + contributions + growth)
	};
}

/**
 * Split the months at `offsets`, in the order given. Offsets past the horizon are dropped rather
 * than returned as holes, so a caller can hand in the offsets of whatever rows it is already showing
 * — {@link import('./forecast.js').summariseForecast}'s or `age-filter.js`'s — and get a row per
 * horizon it can actually show.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @param {import('./forecast.js').ForecastScenario} scenario
 * @param {readonly number[]} offsets
 * @returns {CompoundingPoint[]}
 */
export function compoundingForOffsets(forecast, scenario, offsets) {
	/** @type {CompoundingPoint[]} */
	const points = [];
	for (const offset of offsets) {
		const point = compoundingPointAt(forecast, scenario, offset);
		if (point) points.push(point);
	}
	return points;
}

/**
 * Every month of one scenario, split — the series a chart of the widening contributions/growth gap
 * would plot, and what {@link growthCrossover} walks. Includes the anchor at offset 0, where the
 * split is empty by construction.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @returns {CompoundingPoint[]}
 */
export function compoundingSplit(forecast, scenario = 'realistic') {
	const series = forecast.series[scenario] ?? [];
	return compoundingForOffsets(
		forecast,
		scenario,
		series.map((point) => point.offset)
	);
}

/**
 * The split at a handful of horizons — the same 1/5/10/20/30-year rows
 * {@link import('./forecast.js').summariseForecast} picks, including its "always end where the
 * projection does" rule, because the two tables sit on the same screen and disagreeing about which
 * months are worth showing would be worse than either choice.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @param {readonly number[]} [years]
 * @returns {CompoundingPoint[]}
 */
export function summariseCompounding(
	forecast,
	scenario = 'realistic',
	years = DEFAULT_SUMMARY_YEARS
) {
	return compoundingForOffsets(
		forecast,
		scenario,
		summariseForecast(forecast, years).map((row) => row.offset)
	);
}

/**
 * The same month split under all three scenarios — the panel's per-scenario comparison. `null` when
 * the forecast does not reach `offset`.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @param {number} [offset] Defaults to the forecast's final month.
 * @returns {Record<import('./forecast.js').ForecastScenario, CompoundingPoint> | null}
 */
export function compoundingByScenario(forecast, offset = forecast.months) {
	/** @type {Record<string, CompoundingPoint>} */
	const split = {};
	for (const scenario of FORECAST_SCENARIOS) {
		const point = compoundingPointAt(forecast, scenario, offset);
		if (!point) return null;
		split[scenario] = point;
	}
	return /** @type {Record<import('./forecast.js').ForecastScenario, CompoundingPoint>} */ (split);
}

/**
 * The month growth overtakes contributions: the first point where the money earned since the anchor
 * is worth more than the money paid in since the anchor. The compounding panel's headline date, and
 * the one number here that is about the *shape* of the projection rather than its endpoint.
 *
 * `null` when it never happens inside the horizon — a short forecast, a heavy contribution schedule
 * or a losing scenario can all leave contributions ahead throughout, and "not within 30 years" is a
 * more useful answer than a date past the end of the projection.
 *
 * A holding with no contributions at all crosses at the first month with any growth, which is the
 * honest answer to the question as asked (nothing is being paid in, so growth leads immediately);
 * a caller that wants to say something different should check `contributions === 0` itself.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @returns {CompoundingPoint | null}
 */
export function growthCrossover(forecast, scenario = 'realistic') {
	const series = forecast.series[scenario] ?? [];
	const crossing = series.find((point) => point.growth > point.contributions);
	return crossing ? compoundingPointAt(forecast, scenario, crossing.offset) : null;
}

/**
 * Where growth overtakes contributions in each scenario — the low/mid/high shape
 * {@link import('./milestones.js').milestoneCrossing} uses, so the panel can print the realistic
 * date with the optimistic/pessimistic range beside it. Optimistic crosses earliest.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @returns {Record<import('./forecast.js').ForecastScenario, CompoundingPoint | null>}
 */
export function growthCrossovers(forecast) {
	/** @type {Record<string, CompoundingPoint | null>} */
	const crossings = {};
	for (const scenario of FORECAST_SCENARIOS) {
		crossings[scenario] = growthCrossover(forecast, scenario);
	}
	return /** @type {Record<import('./forecast.js').ForecastScenario, CompoundingPoint | null>} */ (
		crossings
	);
}

/**
 * The result of checking a whole forecast's split against the projection it came from.
 *
 * @typedef {object} CompoundingReconciliation
 * @property {boolean} consistent Both checks below passed.
 * @property {number} tolerance Pounds of slack allowed on the identity.
 * @property {number} checked Points examined, across every scenario.
 * @property {number} maxResidual Largest `|investments - (starting + contributions + growth)|` (£).
 * @property {{ scenario: import('./forecast.js').ForecastScenario, offset: number, residual: number } | null} worst
 *   The point that produced `maxResidual`, or `null` for an empty forecast.
 * @property {boolean} contributionsAgree Every scenario reports the same cumulative contributions at
 *   every offset — convention 4, which is what lets the panel print one contributions figure beside
 *   three growth figures.
 */

/**
 * Check that a forecast's contributions/growth split reconciles with its own projected values, at
 * every month of every scenario (issue #20's "verify the split math is internally consistent with
 * the forecast projections").
 *
 * Cheap enough to run over a full 1200-month forecast, and exported rather than kept private so the
 * check is the same one the tests run — a panel that ever needs to know whether it can trust its
 * numbers can call it too.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @param {{ tolerance?: number }} [options]
 * @returns {CompoundingReconciliation}
 */
export function reconcileCompounding(forecast, options = {}) {
	const tolerance = options.tolerance ?? COMPOUNDING_TOLERANCE;

	let checked = 0;
	let maxResidual = 0;
	/** @type {CompoundingReconciliation['worst']} */
	let worst = null;
	let contributionsAgree = true;

	const realistic = forecast.series.realistic ?? [];

	for (const scenario of FORECAST_SCENARIOS) {
		for (const point of compoundingSplit(forecast, scenario)) {
			checked += 1;

			const residual = Math.abs(point.residual);
			if (residual > maxResidual || worst === null) {
				maxResidual = residual;
				worst = { scenario, offset: point.offset, residual: point.residual };
			}

			const shared = realistic[point.offset];
			if (shared && shared.contributions !== point.contributions) contributionsAgree = false;
		}
	}

	return {
		consistent: maxResidual <= tolerance && contributionsAgree,
		tolerance,
		checked,
		maxResidual,
		worst,
		contributionsAgree
	};
}
