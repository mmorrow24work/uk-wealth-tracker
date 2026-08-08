/**
 * Childcare cost overlay — README.md → "Advanced Scenarios": "Childcare cost modelling" (issue #135).
 *
 * `stress-test.js` (#21) answers "what if the market falls off a cliff?" and `income-shock.js` (#133)
 * answers "what if I stop being able to pay in for a while?". This module answers a third, related but
 * distinct question: "what if a recurring cost eats into what I can invest, for as long as my child
 * needs childcare?" — a monthly nursery or wraparound-care bill, for a stated date range, that reduces
 * how much is left over to contribute rather than a market event or an income interruption. Built as a
 * `forecast.js` `adjustMonth` overlay exactly like its two siblings, so a costed forecast is this
 * module's own arithmetic with a few years' worth of contributions reduced, not a walker that could
 * drift from the baseline.
 *
 * **Explicit non-goal**: this models a flat or stepped monthly £ figure the user types in, nothing
 * more. It does not model UK Tax-Free Childcare, 15/30 hours free entitlement, Universal Credit
 * childcare costs, or any other means-tested scheme — those are a real, independently complex area of
 * UK policy (income tapers, per-child cost caps, employer-scheme interactions) that would need its own
 * issue to do justice to. The number the user enters here is assumed to already be their own
 * out-of-pocket cost, net of whatever support they receive.
 *
 * Five conventions decide what the numbers mean, following `income-shock.js`'s own:
 *
 * 1. **A costed forecast *is* a `Forecast`.** {@link childcareCostForecast} returns the same shape
 *    `forecastScenarios` does, with the config it was built from attached as `.childcare` — so every
 *    reader of a `Forecast` (`forecastBand`, `summariseForecast`, `milestoneCrossings`, `compounding.js`)
 *    reads a costed projection unchanged.
 * 2. **Childcare changes the standing order, not the market**, same as `income-shock.js`'s convention 2:
 *    every holding still compounds at exactly the scenario's growth rate throughout, and the cost is
 *    expressed entirely through {@link import('./forecast.js').ForecastMonthAdjustment.contributionFactor}
 *    — the hook `income-shock.js` added to `forecast.js`, reused rather than duplicated.
 * 3. **The cost is a £ amount, not a percentage — so it has to be turned into a `contributionFactor`
 *    itself, unlike `income-shock.js`'s `dropPct`.** Each month, this module sums what every holding was
 *    actually going to contribute that month ({@link import('./auto-invest.js').contributionForOffset}),
 *    and asks for the fraction of that total left over once the childcare cost is paid:
 *    `(scheduled - cost) / scheduled`, clamped to 0–1. A £1,200 bill against £1,500 of scheduled
 *    contributions leaves a 20% `contributionFactor`; a £1,200 bill against £800 scheduled leaves 0% —
 *    contributions cannot go negative, because turning a shortfall into a withdrawal is a different,
 *    unmodelled kind of event. A month with nothing scheduled to contribute (an annual holding between
 *    its payment months, or no holdings at all) has nothing for the cost to reduce, so the overlay
 *    leaves it alone even though the bill is presumably still being paid out of income the model
 *    doesn't track.
 * 4. **The cost is a flat monthly figure for a stated range, with an optional second, lower-cost stage
 *    that follows on directly.** `monthlyCost` runs from `atMonth` for `durationMonths` — nursery years,
 *    say — then, if `stepDurationMonths` is positive, `stepMonthlyCost` runs for that many further
 *    months — before/after-school club once the child starts school, typically cheaper. A single flat
 *    cost (the issue's "simple ... a flat monthly cost" case) is just `stepDurationMonths: 0`, the
 *    default: no second stage, full stop once `durationMonths` closes.
 * 5. **Nothing is ever paid back**, same as `income-shock.js`'s convention 4: a contribution reduced to
 *    make room for a childcare bill is not made up once the bill stops — {@link childcareCostImpact}'s
 *    `contributionsForgone` measures that gap directly, and it stops widening once the cost's own
 *    window closes rather than converging back onto the baseline.
 *
 * Everything here is pure: a position and a config go in, new objects come out, nothing is mutated.
 */

import { contributionForOffset } from './auto-invest.js';
import {
	FORECAST_SCENARIOS,
	MAX_FORECAST_MONTHS,
	forecastScenarios,
	summariseForecast
} from './forecast.js';

/*
 * As elsewhere in `$lib`: types are referenced inline as `import('./forecast.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *` and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The five dials README.md's "childcare cost modelling" scenario needs.
 *
 * @typedef {object} ChildcareCost
 * @property {number} monthlyCost What the first stage costs per month (£) — e.g. full-time nursery.
 *   `0` means no cost in this stage at all.
 * @property {number} atMonth Timing: whole months after the forecast anchor the cost starts. `1` is
 *   the first projected month; `0` is not allowed, matching `income-shock.js`'s own `atMonth` — offset
 *   0 is the anchor itself, which every scenario shares unchanged.
 * @property {number} durationMonths How many months the first stage's cost runs for.
 * @property {number} stepMonthlyCost What the optional second stage costs per month (£) once the first
 *   stage ends — e.g. before/after-school wraparound care, typically cheaper than nursery.
 * @property {number} stepDurationMonths How many months the second stage runs for, immediately after
 *   the first. `0` means there is no second stage: the cost stops outright once `durationMonths` ends
 *   — a flat, single-rate cost for the whole stated range, the issue's simple case.
 */

/**
 * Defaults for a childcare cost nobody has configured yet.
 *
 * README.md names the scenario but gives no numbers, so these are ours: a flat £1,200/month — a
 * plausible full-time UK nursery bill — starting a year out and running five years, with no second
 * stage, since the issue frames a flat cost as the simple, un-configured case and a step as the extra
 * dial a user reaches for once they want to model fees dropping when a child starts school.
 *
 * @type {Readonly<ChildcareCost>}
 */
export const DEFAULT_CHILDCARE_COST = Object.freeze({
	monthlyCost: 1_200,
	atMonth: 12,
	durationMonths: 60,
	stepMonthlyCost: 400,
	stepDurationMonths: 0
});

/**
 * Backstop against a mistyped or slider-abused figure, not a modelled ceiling — no real UK childcare
 * bill approaches this. Matches `forecast.js`'s own reasoning for `MAX_FORECAST_MONTHS`: a number this
 * large is noise, not a scenario worth projecting.
 */
export const MAX_CHILDCARE_MONTHLY_COST = 50_000;

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
 * become a {@link ChildcareCost} the projector can walk. Out-of-range values are clamped rather than
 * rejected, matching `income-shock.js`'s `normaliseIncomeShock`.
 *
 * @param {Partial<ChildcareCost>} [cost]
 * @returns {ChildcareCost}
 */
export function normaliseChildcareCost(cost = {}) {
	const monthlyCost = clamp(
		asNumber(cost.monthlyCost, DEFAULT_CHILDCARE_COST.monthlyCost),
		0,
		MAX_CHILDCARE_MONTHLY_COST
	);
	const atMonth = clamp(
		Math.trunc(asNumber(cost.atMonth, DEFAULT_CHILDCARE_COST.atMonth)),
		1,
		MAX_FORECAST_MONTHS
	);
	const durationMonths = clamp(
		Math.trunc(asNumber(cost.durationMonths, DEFAULT_CHILDCARE_COST.durationMonths)),
		0,
		MAX_FORECAST_MONTHS
	);
	const stepMonthlyCost = clamp(
		asNumber(cost.stepMonthlyCost, DEFAULT_CHILDCARE_COST.stepMonthlyCost),
		0,
		MAX_CHILDCARE_MONTHLY_COST
	);
	const stepDurationMonths = clamp(
		Math.trunc(asNumber(cost.stepDurationMonths, DEFAULT_CHILDCARE_COST.stepDurationMonths)),
		0,
		MAX_FORECAST_MONTHS
	);

	return { monthlyCost, atMonth, durationMonths, stepMonthlyCost, stepDurationMonths };
}

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The first month the second stage's cost applies — an offset from the anchor. Equal to
 * `atMonth + durationMonths`, matching `income-shock.js`'s `dropEndsAt`.
 *
 * @param {ChildcareCost} cost
 * @returns {number}
 */
export function primaryStageEndsAt(cost) {
	return cost.atMonth + cost.durationMonths;
}

/**
 * The first month with no childcare cost at all — an offset from the anchor. Equal to
 * {@link primaryStageEndsAt} when there is no second stage.
 *
 * @param {ChildcareCost} cost
 * @returns {number}
 */
export function stepStageEndsAt(cost) {
	return primaryStageEndsAt(cost) + cost.stepDurationMonths;
}

/**
 * What the childcare bill costs in a given month: `monthlyCost` during the first stage,
 * `stepMonthlyCost` during the second (if any), `0` outside both.
 *
 * @param {ChildcareCost} cost
 * @param {number} offset
 * @returns {number} £ due that month.
 */
export function childcareCostAt(cost, offset) {
	if (offset >= cost.atMonth && offset < primaryStageEndsAt(cost)) return cost.monthlyCost;
	if (
		cost.stepDurationMonths > 0 &&
		offset >= primaryStageEndsAt(cost) &&
		offset < stepStageEndsAt(cost)
	) {
		return cost.stepMonthlyCost;
	}
	return 0;
}

/**
 * @param {readonly import('./types.js').Investment[]} holdings
 * @param {number} offset
 * @returns {number} Total £ every holding was scheduled to contribute this month, before any overlay.
 */
function totalScheduledContribution(holdings, offset) {
	return holdings.reduce(
		(total, investment) => total + contributionForOffset(investment, offset),
		0
	);
}

/**
 * Turn a config into the per-month hook `forecast.js` projects through: every month a childcare cost
 * is due, the holdings' combined scheduled contribution is reduced by that cost (never below zero) and
 * expressed as a `contributionFactor`; every other month returns `null` (pay in full).
 *
 * A zero-cost config, or a month with nothing scheduled to contribute, returns `null` — the overlay
 * lands exactly on the baseline rather than inventing a reduction with nothing to reduce, the same
 * guarantee `income-shock.js`'s `incomeShockAdjustment` gives at zero magnitude.
 *
 * @param {ChildcareCost} cost
 * @param {readonly import('./types.js').Investment[]} [investments] The same holdings the forecast
 *   this overlay is built alongside projects — needed here because, unlike `income-shock.js`'s
 *   percentage drop, an absolute £ cost has to be measured against what was actually going to be paid
 *   in to become a `contributionFactor` at all.
 * @returns {(offset: number) => import('./forecast.js').ForecastMonthAdjustment | null}
 */
export function childcareCostAdjustment(cost, investments = []) {
	const holdings = investments.filter((investment) => !investment.exclude_from_net_worth);

	return (offset) => {
		const due = childcareCostAt(cost, offset);
		if (due <= 0) return null;

		const scheduled = totalScheduledContribution(holdings, offset);
		if (scheduled <= 0) return null;

		return { contributionFactor: clamp((scheduled - due) / scheduled, 0, 1) };
	};
}

/**
 * A forecast with the childcare cost in it.
 *
 * @typedef {import('./forecast.js').Forecast & { childcare: ChildcareCost }} ChildcareCostedForecast
 */

/**
 * Project a position under all three scenarios *with* a childcare cost — the overlay line to the
 * baseline `forecastScenarios` draws.
 *
 * Takes the same `input`/`options` as {@link import('./forecast.js').forecastScenarios} so the two can
 * be built from one set of assumptions: pass the baseline forecast's own `start`, `months` and
 * `spread` and the overlay shares its anchor, horizon and band width rather than being a differently
 * shaped projection on the same chart — exactly `income-shock.js`'s `incomeShockForecast` pattern.
 *
 * @param {object} [input]
 * @param {readonly import('./types.js').Investment[]} [input.investments]
 * @param {readonly import('./types.js').Debt[]} [input.debts]
 * @param {{ month: number, year: number }} [input.start]
 * @param {number} [input.months]
 * @param {number} [input.spread]
 * @param {import('./forecast.js').ForecastOptions} [options]
 * @param {Partial<ChildcareCost>} [cost]
 * @returns {ChildcareCostedForecast}
 */
export function childcareCostForecast(input = {}, options = {}, cost = {}) {
	const config = normaliseChildcareCost(cost);
	const forecast = forecastScenarios(input, {
		...options,
		adjustMonth: childcareCostAdjustment(config, input.investments ?? [])
	});

	return { ...forecast, childcare: config };
}

/* -------------------------------------------------------------------------- */
/* Reading the damage                                                          */
/* -------------------------------------------------------------------------- */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * What the childcare cost did to one scenario.
 *
 * Every figure is net worth or contributions, not investment growth, since the cost's whole effect is
 * routed through the contribution schedule (convention 2 above) — the debts a forecast carries are
 * constant through it either way, so net worth is the line the rest of the tab already talks in.
 *
 * @typedef {object} ChildcareCostImpact
 * @property {import('./forecast.js').ForecastScenario} scenario
 * @property {boolean} occurs Whether a non-zero cost starts inside this forecast's horizon at all. A
 *   zero-cost config, or one dated past the end of the projection, leaves the overlay identical to the
 *   baseline.
 * @property {number} atMonth Offset the cost starts at.
 * @property {{ month: number, year: number } | null} date Calendar month the cost starts.
 * @property {number} primaryStageEndsAtOffset Offset the first stage's cost ends (the second stage, if
 *   any, starts here).
 * @property {{ month: number, year: number } | null} primaryStageEndsDate
 * @property {number} stepStageEndsAtOffset Offset there is no childcare cost left at all.
 * @property {{ month: number, year: number } | null} stepStageEndsDate
 * @property {number} contributionsForgone Total contributions missed by the time the cost stops (£) —
 *   the gap between the baseline's and the costed forecast's cumulative `contributions`, which stops
 *   widening once the childcare cost itself stops (convention 5).
 * @property {number} baselineFinal Net worth at the horizon without the cost (£).
 * @property {number} costedFinal Net worth at the horizon with it (£).
 * @property {number} shortfall `baselineFinal - costedFinal` (£).
 * @property {number | null} shortfallShare `shortfall / baselineFinal`, or `null` when the baseline
 *   ends at or below zero.
 * @property {number} compoundingLoss `shortfall - contributionsForgone` (£) — what the cost cost
 *   beyond the reduced pounds themselves, i.e. the growth those pounds would have earned had they been
 *   invested on schedule.
 */

/**
 * @param {import('./forecast.js').ForecastPoint | undefined} point
 * @returns {{ month: number, year: number } | null}
 */
function dateOf(point) {
	return point ? { month: point.month, year: point.year } : null;
}

/**
 * Compare one scenario of a costed forecast against the same scenario of the baseline it was built
 * alongside.
 *
 * The two must share an anchor and a horizon — build them from one set of assumptions (see
 * {@link childcareCostForecast}) and they do.
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {ChildcareCostedForecast} costed
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @returns {ChildcareCostImpact}
 */
export function childcareCostImpact(baseline, costed, scenario = 'realistic') {
	const costedSeries = costed.series[scenario] ?? [];
	const baselineSeries = baseline.series[scenario] ?? [];
	const { atMonth, monthlyCost, stepMonthlyCost, stepDurationMonths } = costed.childcare;
	const primaryEnd = primaryStageEndsAt(costed.childcare);
	const stepEnd = stepStageEndsAt(costed.childcare);

	const hasCost = monthlyCost > 0 || (stepDurationMonths > 0 && stepMonthlyCost > 0);
	const occurs = hasCost && Boolean(costedSeries[atMonth]) && Boolean(baselineSeries[atMonth]);

	const baselineFinal = baselineSeries.at(-1)?.net_worth ?? 0;
	const costedFinal = costedSeries.at(-1)?.net_worth ?? 0;
	const shortfall = roundMoney(baselineFinal - costedFinal);

	// The gap between cumulative contributions stops moving once the childcare cost itself stops, so
	// reading it there (or at the horizon, if that comes first) gives the same number any later offset
	// would.
	const lastOffset = Math.min(costedSeries.length, baselineSeries.length) - 1;
	const measureAt = Math.min(stepEnd, Math.max(lastOffset, 0));
	const contributionsForgone = occurs
		? roundMoney(
				(baselineSeries[measureAt]?.contributions ?? 0) -
					(costedSeries[measureAt]?.contributions ?? 0)
			)
		: 0;

	return {
		scenario,
		occurs,
		atMonth,
		date: dateOf(costedSeries[atMonth]),
		primaryStageEndsAtOffset: primaryEnd,
		primaryStageEndsDate: dateOf(costedSeries[primaryEnd]),
		stepStageEndsAtOffset: stepEnd,
		stepStageEndsDate: dateOf(costedSeries[stepEnd]),
		contributionsForgone,
		baselineFinal,
		costedFinal,
		shortfall,
		shortfallShare: baselineFinal > 0 ? shortfall / baselineFinal : null,
		compoundingLoss: roundMoney(shortfall - contributionsForgone)
	};
}

/**
 * {@link childcareCostImpact} for all three scenarios — the low/mid/high shape the rest of the tab
 * already reads (`forecastBand`, `milestoneCrossings`, `growthCrossovers`).
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {ChildcareCostedForecast} costed
 * @returns {Record<import('./forecast.js').ForecastScenario, ChildcareCostImpact>}
 */
export function childcareCostImpacts(baseline, costed) {
	/** @type {Record<string, ChildcareCostImpact>} */
	const impacts = {};
	for (const scenario of FORECAST_SCENARIOS) {
		impacts[scenario] = childcareCostImpact(baseline, costed, scenario);
	}
	return /** @type {Record<import('./forecast.js').ForecastScenario, ChildcareCostImpact>} */ (
		impacts
	);
}

/**
 * One month of the overlay against the baseline.
 *
 * @typedef {object} ChildcareCostComparisonRow
 * @property {number} offset Months since the anchor.
 * @property {number} years
 * @property {number} month
 * @property {number} year
 * @property {number} baseline Net worth without the cost (£).
 * @property {number} costed Net worth with it (£).
 * @property {number} gap `costed - baseline` (£) — negative once the cost has started biting.
 * @property {number | null} gapShare `gap / baseline`, or `null` when the baseline is at or below zero.
 */

/**
 * Line the two projections up month by month at the offsets given — normally whichever rows the
 * forecast summary table is showing, matching `income-shock.js`'s `compareIncomeShock`. Offsets past
 * the horizon are dropped rather than returned as holes.
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {ChildcareCostedForecast} costed
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @param {readonly number[] | null} [offsets] Defaults to `summariseForecast`'s own horizons.
 * @returns {ChildcareCostComparisonRow[]}
 */
export function compareChildcareCost(baseline, costed, scenario = 'realistic', offsets = null) {
	const wanted =
		offsets && offsets.length > 0 ? offsets : summariseForecast(baseline).map((row) => row.offset);

	/** @type {ChildcareCostComparisonRow[]} */
	const rows = [];
	for (const offset of wanted) {
		const basePoint = baseline.series[scenario]?.[offset];
		const costedPoint = costed.series[scenario]?.[offset];
		if (!basePoint || !costedPoint) continue;

		const gap = roundMoney(costedPoint.net_worth - basePoint.net_worth);
		rows.push({
			offset,
			years: offset / 12,
			month: basePoint.month,
			year: basePoint.year,
			baseline: basePoint.net_worth,
			costed: costedPoint.net_worth,
			gap,
			gapShare: basePoint.net_worth > 0 ? gap / basePoint.net_worth : null
		});
	}
	return rows;
}
