/**
 * Childcare cost overlay — README.md → "Advanced Scenarios": "Childcare cost modelling" (issue
 * #135).
 *
 * `income-shock.js` asks "what if I stop being able to pay in?" and `mortgage-rate-rise.js` asks
 * "what if my mortgage gets more expensive?". This module asks a related but distinct question:
 * "what does a recurring monthly bill, running for a stated stretch of years, do to how much I can
 * invest?" — nursery fees, a childminder, a holiday club, for as long as childcare years last.
 *
 * Four conventions decide what the numbers mean:
 *
 * 1. **The config is a list, not a slot** — the same choice `one-off-costs.js` makes, and for the
 *    same reason: real childcare spend is rarely one flat number for the whole stretch. A toddler
 *    in full-time nursery, then part-time wraparound care once free hours or school start, is two
 *    `ChildcareCostStep`s with different `monthlyCost`s and adjoining date ranges, not one — which
 *    is what README.md's "flat or stepped monthly cost" means here: one step in the list is a flat
 *    cost, several sequential steps are a stepped one. Two steps whose ranges overlap (two children
 *    in care at once) simply add together, exactly `one-off-costs.js`'s convention 1 for a shared
 *    month, generalised from a single month to a range.
 * 2. **A childcare bill competes with contributions, not the market or the pot.** Unlike
 *    `one-off-costs.js`'s lump sum (a `withdrawal` taken out of the pot after growth),
 *    childcare is money that never reaches an investment account in the first place — the same
 *    "changes the standing order, not the market" story `income-shock.js` and
 *    `mortgage-rate-rise.js` tell, so this module reuses their `ForecastMonthAdjustment
 *    .contributionFactor` seam rather than `withdrawal`. Unlike `income-shock.js`'s drop, which is
 *    stated as a percentage of whatever the contribution happens to be, a childcare bill is a flat
 *    number of pounds — exactly `mortgage-rate-rise.js`'s own "extra payment's share of the total"
 *    conversion, reused unchanged here: `contributionFactor = 1 - cost / totalContribution`,
 *    floored at `0`. A month with nothing scheduled to invest has nothing left to shrink, so a live
 *    bill against no contribution reads as `contributionFactor: 0`, matching
 *    `mortgage-rate-rise.js`'s own empty-contribution branch — not a debt the projection carries
 *    forward or borrows from a later month (convention 4 below).
 * 3. **A costed forecast *is* a `Forecast`.** {@link childcareCostForecast} returns the same shape
 *    `forecastScenarios` does, with the normalised list it was built from attached as `childcare` —
 *    so every reader of a `Forecast` (`forecastBand`, `summariseForecast`, `milestoneCrossings`,
 *    `compounding.js`) reads a costed projection unchanged.
 * 4. **Nothing is ever paid back.** Exactly `income-shock.js`'s convention 4: a month's contribution
 *    that childcare ate into is simply smaller, permanently — there is no catch-up month once a
 *    step's date range ends, because nothing in the data model records an intention to make one up.
 *
 * **Explicit non-goal:** this module has no idea what Tax-Free Childcare, the 15/30 free hours
 * scheme, or Universal Credit's childcare element are worth — `monthlyCost` is whatever the user
 * types, net of anything they already claim. Modelling the schemes themselves (eligibility tapers,
 * the £100k income cliff-edge, term-time-only free hours) is real UK policy machinery with its own
 * complexity, and out of scope here; README.md's own wording ("flat or stepped monthly cost") asks
 * for the bill a parent actually pays, not a means test.
 *
 * Nothing about the configured steps is persisted — there is still no slot on `AppData` for a
 * planning scenario, matching every sibling scenario module's own trade-off (`income-shock.js`,
 * `mortgage-rate-rise.js`, `one-off-costs.js`): the panel built on top of this module keeps the list
 * as page-session component state, not a store.
 *
 * Everything here is pure: a position and a list of steps go in, new objects come out, nothing is
 * mutated.
 */

import { contributionForOffset } from './auto-invest.js';
import {
	FORECAST_SCENARIOS,
	MAX_FORECAST_MONTHS,
	forecastScenarios,
	summariseForecast
} from './forecast.js';
import { createId } from './model.js';

/*
 * As elsewhere in `$lib`: types are referenced inline as `import('./forecast.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *` and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One step of childcare cost — a flat monthly bill running for a stated stretch. A "stepped" bill
 * (nursery, then a cheaper after-school club) is two or more of these with adjoining ranges.
 *
 * @typedef {object} ChildcareCostStep
 * @property {string} id Stable identity for list rendering and editing — see
 *   {@link createChildcareCostStep}.
 * @property {string} name What the bill is for ("Nursery", "Childminder"). Free text; `''` reads as
 *   not yet named rather than an error, the same tolerance `OneOffCost.name` gives an unset `''`.
 * @property {number} monthlyCost The bill (£/month), `>= 0`. `0` is a step nobody has priced yet,
 *   and has no effect on the projection.
 * @property {number} atMonth Timing: whole months after the forecast anchor the bill starts. `1` is
 *   the first projected month; `0` is not allowed — offset 0 is the anchor itself, matching every
 *   sibling scenario's own `atMonth`.
 * @property {number} durationMonths How many months the bill runs for, from `atMonth`. `0` is a step
 *   nobody has given a length yet, and — like `monthlyCost: 0` — has no effect on the projection.
 */

/**
 * Defaults for a step nobody has configured yet — what {@link createChildcareCostStep} seeds a new
 * list row with, and what {@link normaliseChildcareCostStep} falls back to for a field that can't be
 * parsed.
 *
 * README.md names the scenario ("childcare years") but gives no numbers, so these are ours: unnamed,
 * starting from the forecast's own anchor rather than a year out like the sibling shock/rate-rise
 * scenarios — unlike a hypothetical future job loss or remortgage, childcare for a child already born
 * is a bill that starts now, not something the panel is asking the user to imagine happening later —
 * running for 3 years (a plausible full-time pre-school stretch before free hours or school cut the
 * bill down), at £900/month, a mid-range full-time nursery fee.
 *
 * @type {Readonly<Omit<ChildcareCostStep, 'id'>>}
 */
export const DEFAULT_CHILDCARE_COST_STEP = Object.freeze({
	name: '',
	monthlyCost: 900,
	atMonth: 1,
	durationMonths: 36
});

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

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * A fresh, named step for a "+ add a step" control — the one place a new {@link ChildcareCostStep}
 * gets its id, matching `model.js`'s `createInvestment`/`createDebt` factory pattern for every other
 * list of records in this codebase.
 *
 * @param {Partial<ChildcareCostStep>} [overrides]
 * @returns {ChildcareCostStep}
 */
export function createChildcareCostStep(overrides = {}) {
	return { id: createId('childcare'), ...DEFAULT_CHILDCARE_COST_STEP, ...overrides };
}

/**
 * Fill in and bound a partial step, so a hand-edited document or an empty object both become a
 * {@link ChildcareCostStep} the engine can work from. Out-of-range values are clamped rather than
 * rejected, matching every sibling scenario's own `normalise*` function. An existing id survives
 * unchanged (identity matters for list editing); a missing one is minted fresh rather than left
 * empty, the same `asId` convention `model.js`'s own record normalisers use.
 *
 * @param {Partial<ChildcareCostStep>} [step]
 * @returns {ChildcareCostStep}
 */
export function normaliseChildcareCostStep(step = {}) {
	const id = typeof step.id === 'string' && step.id !== '' ? step.id : createId('childcare');
	const name = typeof step.name === 'string' ? step.name : DEFAULT_CHILDCARE_COST_STEP.name;
	const monthlyCost = Math.max(
		0,
		asNumber(step.monthlyCost, DEFAULT_CHILDCARE_COST_STEP.monthlyCost)
	);
	const atMonth = clamp(
		Math.trunc(asNumber(step.atMonth, DEFAULT_CHILDCARE_COST_STEP.atMonth)),
		1,
		MAX_FORECAST_MONTHS
	);
	const durationMonths = clamp(
		Math.trunc(asNumber(step.durationMonths, DEFAULT_CHILDCARE_COST_STEP.durationMonths)),
		0,
		MAX_FORECAST_MONTHS
	);

	return { id, name, monthlyCost, atMonth, durationMonths };
}

/**
 * {@link normaliseChildcareCostStep} over a whole list — the config this module actually projects
 * with. Anything that isn't an array (including `undefined`) normalises to an empty list: no
 * childcare configured yet, not an error.
 *
 * @param {readonly Partial<ChildcareCostStep>[] | undefined} steps
 * @returns {ChildcareCostStep[]}
 */
export function normaliseChildcareCostSteps(steps) {
	return Array.isArray(steps) ? steps.map((step) => normaliseChildcareCostStep(step)) : [];
}

/**
 * The first offset a step's bill has stopped — an offset from the anchor, exclusive. Equal to
 * `atMonth` when `durationMonths` is 0 (a step with no length yet costs nothing, ever).
 *
 * @param {ChildcareCostStep} step
 * @returns {number}
 */
export function childcareCostStepEndsAt(step) {
	return step.atMonth + step.durationMonths;
}

/**
 * The combined total of every step in the list, for its full stated length, regardless of whether
 * any of it falls inside any particular forecast's horizon — "how much have I priced in, in total".
 *
 * @param {readonly ChildcareCostStep[]} steps
 * @returns {number} (£)
 */
export function totalChildcareCost(steps) {
	return roundMoney(
		steps.reduce((total, step) => total + step.monthlyCost * step.durationMonths, 0)
	);
}

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The combined childcare bill due in one offset month — every active step's `monthlyCost` summed
 * together, convention 1's "two bills sharing a month simply add together" generalised from a single
 * month to a range.
 *
 * @param {readonly ChildcareCostStep[]} steps Already normalised.
 * @param {number} offset
 * @returns {number} (£)
 */
export function childcareCostForOffset(steps, offset) {
	let total = 0;
	for (const step of steps) {
		if (step.monthlyCost <= 0 || step.durationMonths <= 0) continue;
		if (offset >= step.atMonth && offset < childcareCostStepEndsAt(step)) {
			total += step.monthlyCost;
		}
	}
	return total;
}

/**
 * Turn a list of steps into the per-month hook `forecast.js` projects through: every month with a
 * combined bill due scales every holding's contribution down by that bill's share of the month's
 * total contribution — floored at `0` rather than let go negative (convention 2, borrowed from
 * `mortgage-rate-rise.js`'s own conversion) — and every other month returns `null` (project
 * normally).
 *
 * An empty list, or a list where every step is zero-cost or zero-length, returns a hook that is
 * `null` everywhere, so the overlay lands exactly on the baseline rather than quietly touching a
 * projection nothing was actually configured against — the same guarantee every sibling scenario's
 * own zero-magnitude case gives.
 *
 * @param {readonly ChildcareCostStep[]} steps Already normalised — see
 *   {@link normaliseChildcareCostSteps}.
 * @param {readonly import('./types.js').Investment[]} [investments]
 * @returns {(offset: number) => import('./forecast.js').ForecastMonthAdjustment | null}
 */
export function childcareCostAdjustment(steps, investments = []) {
	const active = steps.filter((step) => step.monthlyCost > 0 && step.durationMonths > 0);
	if (active.length === 0) return () => null;

	const countable = investments.filter((investment) => !investment.exclude_from_net_worth);

	return (offset) => {
		const cost = childcareCostForOffset(active, offset);
		if (cost <= 0) return null;

		const totalContribution = countable.reduce(
			(sum, investment) => sum + contributionForOffset(investment, offset),
			0
		);
		if (totalContribution <= 0) {
			// Nothing is scheduled to be paid in this month regardless, so a live bill has nothing
			// left to shrink — the same "nothing scheduled" branch `mortgage-rate-rise.js` takes.
			return { contributionFactor: 0 };
		}

		return { contributionFactor: Math.max(0, 1 - cost / totalContribution) };
	};
}

/**
 * A forecast with the childcare cost in it.
 *
 * @typedef {import('./forecast.js').Forecast & { childcare: ChildcareCostStep[] }} ChildcareCostForecast
 */

/**
 * Project a position under all three scenarios *with* the configured childcare cost taken out of
 * contribution capacity — the overlay line to the baseline `forecastScenarios` draws.
 *
 * Takes the same `input`/`options` as {@link import('./forecast.js').forecastScenarios} so the two
 * can be built from one set of assumptions: pass the baseline forecast's own `start`, `months` and
 * `spread` and the overlay shares its anchor, horizon and band width — exactly
 * `one-off-costs.js`'s `oneOffCostsForecast` pattern.
 *
 * @param {object} [input]
 * @param {readonly import('./types.js').Investment[]} [input.investments]
 * @param {readonly import('./types.js').Debt[]} [input.debts]
 * @param {{ month: number, year: number }} [input.start]
 * @param {number} [input.months]
 * @param {number} [input.spread]
 * @param {import('./forecast.js').ForecastOptions} [options]
 * @param {readonly Partial<ChildcareCostStep>[]} [steps]
 * @returns {ChildcareCostForecast}
 */
export function childcareCostForecast(input = {}, options = {}, steps = []) {
	const normalised = normaliseChildcareCostSteps(steps);
	const forecast = forecastScenarios(input, {
		...options,
		adjustMonth: childcareCostAdjustment(normalised, input.investments ?? [])
	});

	return { ...forecast, childcare: normalised };
}

/* -------------------------------------------------------------------------- */
/* Reading the damage                                                         */
/* -------------------------------------------------------------------------- */

/**
 * @param {import('./forecast.js').ForecastPoint | undefined} point
 * @returns {{ month: number, year: number } | null}
 */
function dateOf(point) {
	return point ? { month: point.month, year: point.year } : null;
}

/**
 * One configured step, dated against a particular forecast.
 *
 * @typedef {object} ChildcareCostOccurrence
 * @property {string} id
 * @property {string} name
 * @property {number} monthlyCost
 * @property {number} atMonth
 * @property {number} durationMonths
 * @property {boolean} occurs Whether any part of the step's date range falls inside this forecast's
 *   horizon at all — a step dated entirely past the end of the projection never touches it.
 * @property {{ month: number, year: number } | null} date Calendar month the step starts, or `null`
 *   when it doesn't occur.
 * @property {{ month: number, year: number } | null} endDate Calendar month the step's bill has
 *   stopped (the first month back to whatever comes next), or `null` when it doesn't occur.
 * @property {number} monthsOccurring How many of the step's months actually fall inside this
 *   forecast's horizon — `<= durationMonths`, less only when the step runs past the horizon's end.
 * @property {number} totalCost `monthlyCost * monthsOccurring` (£) — what this step actually takes
 *   out of this forecast, as opposed to what it's priced at in total (see {@link totalChildcareCost}).
 */

/**
 * Every configured step, dated against one forecast and sorted soonest-first — the row-per-step
 * table a panel shows underneath the aggregate figures {@link childcareCostImpact} reports.
 *
 * @param {readonly ChildcareCostStep[]} steps Already normalised.
 * @param {import('./forecast.js').Forecast} forecast Read for its horizon/dates only — any
 *   `Forecast` sharing the same anchor and horizon as the one `steps` was projected against works,
 *   baseline or costed.
 * @returns {ChildcareCostOccurrence[]}
 */
export function childcareCostOccurrences(steps, forecast) {
	const series = forecast.series.realistic ?? [];
	const horizon = forecast.months;

	return [...steps]
		.sort((a, b) => a.atMonth - b.atMonth)
		.map((step) => {
			const endsAtOffset = childcareCostStepEndsAt(step);
			const lastOffset = Math.min(endsAtOffset - 1, horizon);
			const monthsOccurring = step.monthlyCost > 0 ? Math.max(0, lastOffset - step.atMonth + 1) : 0;
			const occurs = monthsOccurring > 0;

			return {
				id: step.id,
				name: step.name,
				monthlyCost: step.monthlyCost,
				atMonth: step.atMonth,
				durationMonths: step.durationMonths,
				occurs,
				date: occurs ? dateOf(series[step.atMonth]) : null,
				endDate: occurs ? dateOf(series[endsAtOffset]) : null,
				monthsOccurring,
				totalCost: roundMoney(step.monthlyCost * monthsOccurring)
			};
		});
}

/**
 * What the configured childcare cost did to one scenario, in aggregate.
 *
 * @typedef {object} ChildcareCostImpact
 * @property {import('./forecast.js').ForecastScenario} scenario
 * @property {ChildcareCostOccurrence[]} steps Every configured step, dated and sorted soonest-first.
 * @property {number} totalConfigured Combined cost of every configured step over its full stated
 *   length, regardless of whether it falls inside the horizon (£).
 * @property {number} totalOccurring Combined cost of the months that actually fall inside the
 *   horizon (£) — `<= totalConfigured`, and the two differ only when a step runs past the end of the
 *   projection.
 * @property {number} baselineFinal Net worth at the horizon without the childcare cost (£).
 * @property {number} costedFinal Net worth at the horizon with it taken out of contributions (£).
 * @property {number} shortfall `baselineFinal - costedFinal` (£).
 * @property {number | null} shortfallShare `shortfall / baselineFinal`, or `null` when the baseline
 *   ends at or below zero.
 */

/**
 * Compare one scenario of a costed forecast against the same scenario of the baseline it was built
 * alongside.
 *
 * The two must share an anchor and a horizon — build them from one set of assumptions (see
 * {@link childcareCostForecast}) and they do.
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {ChildcareCostForecast} costed
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @returns {ChildcareCostImpact}
 */
export function childcareCostImpact(baseline, costed, scenario = 'realistic') {
	const steps = childcareCostOccurrences(costed.childcare, costed);

	const baselineSeries = baseline.series[scenario] ?? [];
	const costedSeries = costed.series[scenario] ?? [];

	const baselineFinal = baselineSeries.at(-1)?.net_worth ?? 0;
	const costedFinal = costedSeries.at(-1)?.net_worth ?? 0;
	const shortfall = roundMoney(baselineFinal - costedFinal);

	return {
		scenario,
		steps,
		totalConfigured: totalChildcareCost(costed.childcare),
		totalOccurring: roundMoney(
			steps.filter((step) => step.occurs).reduce((total, step) => total + step.totalCost, 0)
		),
		baselineFinal,
		costedFinal,
		shortfall,
		shortfallShare: baselineFinal > 0 ? shortfall / baselineFinal : null
	};
}

/**
 * {@link childcareCostImpact} for all three scenarios — the low/mid/high shape the rest of the tab
 * already reads (`forecastBand`, `milestoneCrossings`, `growthCrossovers`).
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {ChildcareCostForecast} costed
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
 * @property {number} baseline Net worth without the childcare cost (£).
 * @property {number} costed Net worth with it taken out of contributions (£).
 * @property {number} gap `costed - baseline` (£) — negative once a bill has started landing.
 * @property {number | null} gapShare `gap / baseline`, or `null` when the baseline is at or below
 *   zero.
 */

/**
 * Line the two projections up month by month at the offsets given — normally whichever rows the
 * forecast summary table is showing, matching `stress-test.js`'s `compareStressed` and every sibling
 * scenario's own `compare*`. Offsets past the horizon are dropped rather than returned as holes.
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {ChildcareCostForecast} costed
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
