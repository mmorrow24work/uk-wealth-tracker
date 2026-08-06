/**
 * Stress test overlay — README.md → "Forecast": "Stress test overlay: crash magnitude, timing,
 * recovery rate, recovery duration" (issue #21).
 *
 * The three-scenario forecast (`forecast.js`) answers "what if the long-run average were higher or
 * lower than I think?". This module answers a different question: "what if the market falls off a
 * cliff, and how long does that set me back?". Pessimistic is not a crash — it is a permanently
 * duller average — so a crash needs its own path: a stated fall on a stated date, a recovery that
 * runs at its own rate for a stated length of time, and then ordinary life again.
 *
 * Five conventions decide what the numbers mean:
 *
 * 1. **A stressed forecast *is* a `Forecast`.** {@link stressForecast} returns the same shape
 *    `forecastScenarios` does, with the config it was built from attached as `stress`. So
 *    `forecastBand`, `summariseForecast`, `milestoneCrossings`, `age-filter.js` and
 *    `compounding.js` all read a stressed projection unchanged — an overlay is a second line on the
 *    same axes, not a second kind of object.
 * 2. **It is the same arithmetic, with two months' worth of assumptions swapped.** The crash and the
 *    recovery window are expressed through `forecast.js`'s own
 *    {@link import('./forecast.js').ForecastMonthAdjustment} hook, so the stressed series is
 *    produced by the projector that draws the baseline rather than by a second walker that could
 *    drift from it. With {@link StressTest.magnitude} at zero the hook never fires and the overlay
 *    is the baseline, point for point — a property the tests assert by deep equality.
 * 3. **The crash is one month, and it is exactly the size stated.** A 35% crash multiplies the
 *    portfolio by 0.65 in its month: no rate, no compounding, no fund fee, so the headline figure
 *    and the drawdown the user sees are the same number. Whether a real crash takes three weeks or
 *    fourteen months is a shape this module deliberately does not model (see the trade-offs below);
 *    what it models is the hole and how long it takes to climb out.
 * 4. **Recovery is a window, not a promise.** For {@link StressTest.recoveryMonths} months after the
 *    crash the portfolio compounds at {@link StressTest.recoveryRate} instead of the scenario's own
 *    rate; when the window closes the ordinary rate resumes. Nothing forces the stressed line back
 *    onto the baseline — if the rebound was too weak or too short, the gap is permanent, and
 *    {@link stressImpact} reports it rather than hiding it. The scenario spread still applies on top
 *    of the recovery rate, so all three scenarios stay a band through the crash instead of
 *    collapsing onto one line.
 * 5. **A crash changes the market, not the standing order.** Contributions are paid on exactly the
 *    same schedule as the baseline, which is what makes buying through the fall visible: the same
 *    money buys more units at post-crash prices. `stressed.series[s][n].contributions` equals the
 *    baseline's at every month, and the tests pin that.
 *
 * Everything here is pure: a position and a config go in, new objects come out, nothing is mutated.
 */

import {
	FORECAST_SCENARIOS,
	MAX_FORECAST_MONTHS,
	forecastScenarios,
	summariseForecast
} from './forecast.js';

/*
 * As elsewhere in `$lib`, types are referenced inline as `import('./forecast.js').X` rather than
 * re-declared as local `@typedef`s — `index.js` re-exports every module with `export *`, and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The four dials README.md names, and nothing else.
 *
 * @typedef {object} StressTest
 * @property {number} magnitude How far the portfolio falls in the crash month, as a whole-number
 *   percent of its value (`35` = a 35% fall). `0` means no crash at all — and therefore no recovery
 *   window either, since there is nothing to recover from.
 * @property {number} atMonth Timing: whole months after the forecast anchor that the crash lands.
 *   `1` is the first projected month; `0` is not allowed, because offset 0 is the anchor itself and
 *   `forecast.js`'s convention 1 requires every scenario — stressed or not — to start from the
 *   position the user is actually in.
 * @property {number} recoveryRate Annual growth (%) while the recovery window is open. The
 *   scenario's own ±spread still applies on top, and each holding's fund fee is still netted off.
 * @property {number} recoveryMonths How long the recovery window stays open, in months after the
 *   crash month. `0` means no rebound: the ordinary rate resumes the month after the crash.
 */

/**
 * Defaults for a stress test nobody has configured yet.
 *
 * README.md names the four dials but gives no numbers, so these are ours, chosen to be recognisable
 * rather than extreme: a 35% fall is roughly what a global equity portfolio did in 2020 and rather
 * less than 2007–09; a year out is far enough away to be interesting and near enough to matter; and
 * a 10% rebound held for two years is a brisk-but-real recovery against the app's 5% default
 * long-run assumption. They are starting points the sliders overwrite, not a house view.
 *
 * @type {Readonly<StressTest>}
 */
export const DEFAULT_STRESS_TEST = Object.freeze({
	magnitude: 35,
	atMonth: 12,
	recoveryRate: 10,
	recoveryMonths: 24
});

/** A crash cannot take more than everything. */
export const MAX_STRESS_MAGNITUDE = 100;

/** Recovery rates are whole-number percents, matching `validateAppData`'s own range. */
const MIN_RATE_PCT = -100;
const MAX_RATE_PCT = 100;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asNumber(value, fallback) {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

/**
 * Fill in and bound a partial config, so a slider, a hand-edited document or an empty object all
 * become a {@link StressTest} the projector can walk. Out-of-range values are clamped rather than
 * rejected — the same choice `forecast.js` makes for horizons and rates.
 *
 * @param {Partial<StressTest>} [stress]
 * @returns {StressTest}
 */
export function normaliseStressTest(stress = {}) {
	const magnitude = clamp(
		asNumber(stress.magnitude, DEFAULT_STRESS_TEST.magnitude),
		0,
		MAX_STRESS_MAGNITUDE
	);
	const atMonth = clamp(
		Math.trunc(asNumber(stress.atMonth, DEFAULT_STRESS_TEST.atMonth)),
		1,
		MAX_FORECAST_MONTHS
	);
	const recoveryRate = clamp(
		asNumber(stress.recoveryRate, DEFAULT_STRESS_TEST.recoveryRate),
		MIN_RATE_PCT,
		MAX_RATE_PCT
	);
	const recoveryMonths = clamp(
		Math.trunc(asNumber(stress.recoveryMonths, DEFAULT_STRESS_TEST.recoveryMonths)),
		0,
		MAX_FORECAST_MONTHS
	);

	return { magnitude, atMonth, recoveryRate, recoveryMonths };
}

/**
 * The multiplicative move the crash month makes: `0.65` for a 35% fall.
 *
 * @param {number} magnitudePct
 * @returns {number}
 */
export function crashFactor(magnitudePct) {
	return 1 - clamp(magnitudePct, 0, MAX_STRESS_MAGNITUDE) / 100;
}

/**
 * The last month of the recovery window, as an offset from the anchor. Equal to `atMonth` when
 * there is no recovery window at all.
 *
 * @param {StressTest} stress
 * @returns {number}
 */
export function recoveryEndsAt(stress) {
	return stress.atMonth + stress.recoveryMonths;
}

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turn a config into the per-month hook `forecast.js` projects through: the crash month returns the
 * fall as a stated move, each month of the recovery window returns the recovery rate, and every
 * other month returns `null` (project normally).
 *
 * A zero-magnitude config returns a hook that is `null` everywhere — "no crash" means no recovery
 * window either, so the overlay lands exactly on the baseline rather than quietly re-rating the year
 * after a crash that never happened.
 *
 * @param {StressTest} stress
 * @returns {(offset: number) => import('./forecast.js').ForecastMonthAdjustment | null}
 */
export function stressAdjustment(stress) {
	const factor = crashFactor(stress.magnitude);
	const recoveryEnd = recoveryEndsAt(stress);

	return (offset) => {
		if (stress.magnitude <= 0) return null;
		if (offset === stress.atMonth) return { factor };
		if (offset > stress.atMonth && offset <= recoveryEnd)
			return { growthRate: stress.recoveryRate };
		return null;
	};
}

/**
 * A forecast with the crash in it.
 *
 * @typedef {import('./forecast.js').Forecast & { stress: StressTest }} StressedForecast
 */

/**
 * Project a position under all three scenarios *with* a crash — the overlay line to the baseline
 * `forecastScenarios` draws.
 *
 * Takes the same `input`/`options` as {@link import('./forecast.js').forecastScenarios} so the two
 * can be built from one set of assumptions: pass the baseline forecast's own `start`, `months` and
 * `spread` (they are on the object it returned) and the overlay is guaranteed to share its anchor,
 * horizon and band width rather than being a differently-shaped projection drawn on the same chart.
 *
 * @param {object} [input]
 * @param {readonly import('./types.js').Investment[]} [input.investments]
 * @param {readonly import('./types.js').Debt[]} [input.debts]
 * @param {{ month: number, year: number }} [input.start]
 * @param {number} [input.months]
 * @param {number} [input.spread]
 * @param {import('./forecast.js').ForecastOptions} [options]
 * @param {Partial<StressTest>} [stress]
 * @returns {StressedForecast}
 */
export function stressForecast(input = {}, options = {}, stress = {}) {
	const config = normaliseStressTest(stress);
	const forecast = forecastScenarios(input, {
		...options,
		adjustMonth: stressAdjustment(config)
	});

	return { ...forecast, stress: config };
}

/* -------------------------------------------------------------------------- */
/* Reading the damage                                                          */
/* -------------------------------------------------------------------------- */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * What the crash did to one scenario.
 *
 * Every figure is net worth, not invested value: the debts a forecast carries are constant through
 * it, so the *gap* between stressed and baseline is identical either way, and net worth is the line
 * the rest of the tab talks in.
 *
 * @typedef {object} StressImpact
 * @property {import('./forecast.js').ForecastScenario} scenario
 * @property {boolean} occurs Whether the crash lands inside this forecast's horizon at all. A crash
 *   dated past the end of the projection leaves the overlay identical to the baseline, which is a
 *   fact worth saying out loud rather than showing as a £0 drawdown.
 * @property {number} atMonth Offset of the crash month.
 * @property {{ month: number, year: number } | null} date Calendar month the crash lands in.
 * @property {number} before Net worth the month before the crash (£) — the same in both projections,
 *   since nothing has diverged yet.
 * @property {number} after Net worth in the crash month (£).
 * @property {number} drop `before - after` (£), positive for a fall.
 * @property {number | null} dropShare `drop / before`, or `null` when there was nothing to lose.
 * @property {number} trough Lowest net worth from the crash month onward (£) — the same as `after`
 *   unless the recovery rate is negative or contributions are outweighed by continued losses.
 * @property {number} troughOffset Offset of that low point.
 * @property {{ month: number, year: number } | null} troughDate
 * @property {number | null} recoveredAt Offset of the first month back at or above the pre-crash
 *   figure, or `null` if that never happens inside the horizon.
 * @property {{ month: number, year: number } | null} recoveredDate
 * @property {number | null} monthsToRecover Months from the crash to that recovery.
 * @property {number | null} caughtUpAt Offset of the first month the stressed line is back level
 *   with the *baseline* line — a stricter question than getting back to the pre-crash figure, and
 *   normally `null`: a crash you recover from still costs you the growth the lost pounds would have
 *   earned.
 * @property {number} baselineFinal Net worth at the horizon without the crash (£).
 * @property {number} stressedFinal Net worth at the horizon with it (£).
 * @property {number} shortfall `baselineFinal - stressedFinal` (£).
 * @property {number | null} shortfallShare `shortfall / baselineFinal`, or `null` when the baseline
 *   ends at or below zero.
 */

/**
 * @param {import('./forecast.js').ForecastPoint | undefined} point
 * @returns {{ month: number, year: number } | null}
 */
function dateOf(point) {
	return point ? { month: point.month, year: point.year } : null;
}

/**
 * Compare one scenario of a stressed forecast against the same scenario of the baseline it was
 * built alongside.
 *
 * The two must share an anchor and a horizon — build them from one set of assumptions (see
 * {@link stressForecast}) and they do.
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {StressedForecast} stressed
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @returns {StressImpact}
 */
export function stressImpact(baseline, stressed, scenario = 'realistic') {
	const stressedSeries = stressed.series[scenario] ?? [];
	const baselineSeries = baseline.series[scenario] ?? [];
	const { atMonth, magnitude } = stressed.stress;

	const crash = stressedSeries[atMonth];
	const priorPoint = stressedSeries[atMonth - 1];
	const occurs = magnitude > 0 && Boolean(crash) && Boolean(priorPoint);

	const baselineFinal = baselineSeries.at(-1)?.net_worth ?? 0;
	const stressedFinal = stressedSeries.at(-1)?.net_worth ?? 0;
	const shortfall = roundMoney(baselineFinal - stressedFinal);

	/** @type {StressImpact} */
	const impact = {
		scenario,
		occurs,
		atMonth,
		date: dateOf(crash),
		before: priorPoint?.net_worth ?? 0,
		after: crash?.net_worth ?? priorPoint?.net_worth ?? 0,
		drop: 0,
		dropShare: null,
		trough: crash?.net_worth ?? 0,
		troughOffset: atMonth,
		troughDate: dateOf(crash),
		recoveredAt: null,
		recoveredDate: null,
		monthsToRecover: null,
		caughtUpAt: null,
		baselineFinal,
		stressedFinal,
		shortfall,
		shortfallShare: baselineFinal > 0 ? shortfall / baselineFinal : null
	};

	if (!occurs) return impact;

	impact.drop = roundMoney(impact.before - impact.after);
	impact.dropShare = impact.before > 0 ? impact.drop / impact.before : null;

	for (let offset = atMonth; offset < stressedSeries.length; offset += 1) {
		const point = stressedSeries[offset];

		if (point.net_worth < impact.trough) {
			impact.trough = point.net_worth;
			impact.troughOffset = offset;
			impact.troughDate = dateOf(point);
		}

		if (impact.recoveredAt === null && point.net_worth >= impact.before && offset > atMonth) {
			impact.recoveredAt = offset;
			impact.recoveredDate = dateOf(point);
			impact.monthsToRecover = offset - atMonth;
		}

		if (impact.caughtUpAt === null && point.net_worth >= (baselineSeries[offset]?.net_worth ?? 0)) {
			impact.caughtUpAt = offset;
		}
	}

	return impact;
}

/**
 * {@link stressImpact} for all three scenarios — the low/mid/high shape the rest of the tab already
 * reads (`forecastBand`, `milestoneCrossings`, `growthCrossovers`).
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {StressedForecast} stressed
 * @returns {Record<import('./forecast.js').ForecastScenario, StressImpact>}
 */
export function stressImpacts(baseline, stressed) {
	/** @type {Record<string, StressImpact>} */
	const impacts = {};
	for (const scenario of FORECAST_SCENARIOS) {
		impacts[scenario] = stressImpact(baseline, stressed, scenario);
	}
	return /** @type {Record<import('./forecast.js').ForecastScenario, StressImpact>} */ (impacts);
}

/**
 * One month of the overlay against the baseline.
 *
 * @typedef {object} StressComparisonRow
 * @property {number} offset Months since the anchor.
 * @property {number} years
 * @property {number} month
 * @property {number} year
 * @property {number} baseline Net worth without the crash (£).
 * @property {number} stressed Net worth with it (£).
 * @property {number} gap `stressed - baseline` (£) — negative while the crash is still costing.
 * @property {number | null} gapShare `gap / baseline`, or `null` when the baseline is at or below
 *   zero and a percentage would be meaningless.
 */

/**
 * Line the two projections up month by month at the offsets given — normally whichever rows the
 * forecast summary table is showing, so the overlay follows the age zoom (#19) instead of sitting
 * beneath a table showing different months. Offsets past the horizon are dropped rather than
 * returned as holes, matching `compounding.js`'s `compoundingForOffsets`.
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {StressedForecast} stressed
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @param {readonly number[] | null} [offsets] Defaults to `summariseForecast`'s own horizons.
 * @returns {StressComparisonRow[]}
 */
export function compareStressed(baseline, stressed, scenario = 'realistic', offsets = null) {
	const wanted =
		offsets && offsets.length > 0 ? offsets : summariseForecast(baseline).map((row) => row.offset);

	/** @type {StressComparisonRow[]} */
	const rows = [];
	for (const offset of wanted) {
		const basePoint = baseline.series[scenario]?.[offset];
		const stressedPoint = stressed.series[scenario]?.[offset];
		if (!basePoint || !stressedPoint) continue;

		const gap = roundMoney(stressedPoint.net_worth - basePoint.net_worth);
		rows.push({
			offset,
			years: offset / 12,
			month: basePoint.month,
			year: basePoint.year,
			baseline: basePoint.net_worth,
			stressed: stressedPoint.net_worth,
			gap,
			gapShare: basePoint.net_worth > 0 ? gap / basePoint.net_worth : null
		});
	}
	return rows;
}
