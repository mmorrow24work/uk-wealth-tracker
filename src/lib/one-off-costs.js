/**
 * One-off large costs overlay — README.md → "Advanced Scenarios": "One-off large costs" (issue
 * #136).
 *
 * `stress-test.js` asks "what if the market falls off a cliff?", `income-shock.js` asks "what if I
 * stop being able to pay in?" and `mortgage-rate-rise.js` asks "what if my mortgage gets more
 * expensive?". This module asks a fourth, unrelated question: "what if I take a lump sum *out* —
 * a wedding, a car, a home renovation — on a stated date?" Exactly like its three siblings, it is
 * built as a `forecast.js` `adjustMonth` overlay rather than a second projector, so it is this
 * module's own arithmetic with a month's worth of value pulled out, not a walker that could drift
 * from the baseline.
 *
 * Three conventions decide what the numbers mean:
 *
 * 1. **The config is a list, not a slot.** The issue is explicit that real use is rarely just one
 *    cost, so unlike `IncomeShock`/`StressTest`/`MortgageRateRise` (each a single config object)
 *    this module's config is `OneOffCost[]` — any number of named costs, each with its own date and
 *    amount, that can land in the same month or different ones. Two costs sharing a month simply
 *    add together (a wedding and a car in the same year is one bigger withdrawal that month, not a
 *    conflict).
 * 2. **A cost is a withdrawal, not a contribution change or a market move**, so it needed its own
 *    hook: `ForecastMonthAdjustment.withdrawal` (a new field on `forecast.js`, added alongside
 *    `factor`/`contributionFactor` for this module). It takes a stated number of pounds out of the
 *    pot for the named month, pro rata across every holding by its opening value that month — the
 *    same "no per-holding beta" reasoning `stress-test.js`'s crash uses for its own market-wide
 *    `factor`: nothing in the data model says which account a wedding gets paid out of. A cost
 *    bigger than the whole pot drains it to zero rather than going negative or borrowing from a
 *    later month, matching `income-shock.js`'s and `mortgage-rate-rise.js`'s own "nothing is ever
 *    paid back" convention, applied here to an outflow instead of a missed inflow.
 * 3. **A costed forecast *is* a `Forecast`.** {@link oneOffCostsForecast} returns the same shape
 *    `forecastScenarios` does, with the normalised list it was built from attached as `costs` — so
 *    every reader of a `Forecast` (`forecastBand`, `summariseForecast`, `milestoneCrossings`,
 *    `compounding.js`) reads a costed projection unchanged, and a withdrawal is booked as negative
 *    growth (`forecast.js`'s own convention for `withdrawal`), so the contributions/growth split
 *    keeps reconciling.
 *
 * Everything here is pure: a position and a list of costs go in, new objects come out, nothing is
 * mutated.
 */

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
 * One named lump-sum cost.
 *
 * @typedef {object} OneOffCost
 * @property {string} id Stable identity for list rendering and editing — see {@link createOneOffCost}.
 * @property {string} name What the money is for ("Wedding", "New car"). Free text; `''` reads as
 *   not yet named rather than an error, the same tolerance `MortgageRateRise.propertyId` gives an
 *   unset `''`.
 * @property {number} atMonth Timing: whole months after the forecast anchor the cost falls due.
 *   `1` is the first projected month; `0` is not allowed — offset 0 is the anchor itself, matching
 *   every sibling scenario's own `atMonth`.
 * @property {number} amount The lump sum (£), `>= 0`. `0` is a cost nobody has priced yet, and has
 *   no effect on the projection.
 */

/**
 * Defaults for a cost nobody has configured yet — what {@link createOneOffCost} seeds a new list
 * row with, and what {@link normaliseOneOffCost} falls back to for a field that can't be parsed.
 *
 * README.md names the scenario ("wedding, car, home renovation") but gives no numbers, so these
 * are ours: unnamed, a year out (matching every sibling scenario's own default timing), and £5,000
 * — a plausible mid-sized figure for exactly the examples README.md gives (a deposit on a car, a
 * modest wedding contribution, a bathroom renovation) without reading as a house view of any one of
 * them.
 *
 * @type {Readonly<Omit<OneOffCost, 'id'>>}
 */
export const DEFAULT_ONE_OFF_COST = Object.freeze({
	name: '',
	atMonth: 12,
	amount: 5_000
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
 * A fresh, named cost for a "+ add a cost" control — the one place a new {@link OneOffCost} gets
 * its id, matching `model.js`'s `createInvestment`/`createDebt` factory pattern for every other
 * list of records in this codebase.
 *
 * @param {Partial<OneOffCost>} [overrides]
 * @returns {OneOffCost}
 */
export function createOneOffCost(overrides = {}) {
	return { id: createId('cost'), ...DEFAULT_ONE_OFF_COST, ...overrides };
}

/**
 * Fill in and bound a partial cost, so a hand-edited document or an empty object both become an
 * {@link OneOffCost} the engine can work from. Out-of-range values are clamped rather than
 * rejected, matching every sibling scenario's own `normalise*` function. An existing id survives
 * unchanged (identity matters for list editing); a missing one is minted fresh rather than left
 * empty, the same `asId` convention `model.js`'s own record normalisers use.
 *
 * @param {Partial<OneOffCost>} [cost]
 * @returns {OneOffCost}
 */
export function normaliseOneOffCost(cost = {}) {
	const id = typeof cost.id === 'string' && cost.id !== '' ? cost.id : createId('cost');
	const name = typeof cost.name === 'string' ? cost.name : DEFAULT_ONE_OFF_COST.name;
	const atMonth = clamp(
		Math.trunc(asNumber(cost.atMonth, DEFAULT_ONE_OFF_COST.atMonth)),
		1,
		MAX_FORECAST_MONTHS
	);
	const amount = Math.max(0, asNumber(cost.amount, DEFAULT_ONE_OFF_COST.amount));

	return { id, name, atMonth, amount };
}

/**
 * {@link normaliseOneOffCost} over a whole list — the config this module actually projects with.
 * Anything that isn't an array (including `undefined`) normalises to an empty list: no costs
 * configured yet, not an error.
 *
 * @param {readonly Partial<OneOffCost>[] | undefined} costs
 * @returns {OneOffCost[]}
 */
export function normaliseOneOffCosts(costs) {
	return Array.isArray(costs) ? costs.map((cost) => normaliseOneOffCost(cost)) : [];
}

/**
 * The combined total of every cost in the list, regardless of whether its date falls inside any
 * particular forecast's horizon — "how much have I priced in, in total".
 *
 * @param {readonly OneOffCost[]} costs
 * @returns {number} (£)
 */
export function totalOneOffCosts(costs) {
	return roundMoney(costs.reduce((total, cost) => total + cost.amount, 0));
}

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turn a list of costs into the per-month hook `forecast.js` projects through: every month with one
 * or more costs due returns a `withdrawal` of their combined amount (convention 1 — two costs
 * sharing a month simply add together); every other month returns `null` (project normally).
 *
 * An empty list, or a list where every `amount` is `0`, returns a hook that is `null` everywhere,
 * so the overlay lands exactly on the baseline rather than quietly touching a projection nothing
 * was actually configured against — the same guarantee `stress-test.js`'s `stressAdjustment` gives
 * at zero magnitude.
 *
 * @param {readonly OneOffCost[]} costs Already normalised — see {@link normaliseOneOffCosts}.
 * @returns {(offset: number) => import('./forecast.js').ForecastMonthAdjustment | null}
 */
export function oneOffCostsAdjustment(costs) {
	/** @type {Map<number, number>} */
	const byMonth = new Map();
	for (const cost of costs) {
		if (cost.amount <= 0) continue;
		byMonth.set(cost.atMonth, (byMonth.get(cost.atMonth) ?? 0) + cost.amount);
	}
	if (byMonth.size === 0) return () => null;

	return (offset) => {
		const withdrawal = byMonth.get(offset);
		return withdrawal ? { withdrawal } : null;
	};
}

/**
 * A forecast with the one-off costs in it.
 *
 * @typedef {import('./forecast.js').Forecast & { costs: OneOffCost[] }} OneOffCostsForecast
 */

/**
 * Project a position under all three scenarios *with* the configured one-off costs taken out —
 * the overlay line to the baseline `forecastScenarios` draws.
 *
 * Takes the same `input`/`options` as {@link import('./forecast.js').forecastScenarios} so the two
 * can be built from one set of assumptions: pass the baseline forecast's own `start`, `months` and
 * `spread` and the overlay shares its anchor, horizon and band width — exactly
 * `stress-test.js`'s `stressForecast` pattern.
 *
 * @param {object} [input]
 * @param {readonly import('./types.js').Investment[]} [input.investments]
 * @param {readonly import('./types.js').Debt[]} [input.debts]
 * @param {{ month: number, year: number }} [input.start]
 * @param {number} [input.months]
 * @param {number} [input.spread]
 * @param {import('./forecast.js').ForecastOptions} [options]
 * @param {readonly Partial<OneOffCost>[]} [costs]
 * @returns {OneOffCostsForecast}
 */
export function oneOffCostsForecast(input = {}, options = {}, costs = []) {
	const normalised = normaliseOneOffCosts(costs);
	const forecast = forecastScenarios(input, {
		...options,
		adjustMonth: oneOffCostsAdjustment(normalised)
	});

	return { ...forecast, costs: normalised };
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
 * One configured cost, dated against a particular forecast.
 *
 * @typedef {object} OneOffCostOccurrence
 * @property {string} id
 * @property {string} name
 * @property {number} atMonth
 * @property {number} amount
 * @property {boolean} occurs Whether `atMonth` falls inside this forecast's horizon at all — a cost
 *   dated past the end of the projection never gets taken out of it.
 * @property {{ month: number, year: number } | null} date Calendar month it falls due, or `null`
 *   when it doesn't occur.
 */

/**
 * Every configured cost, dated against one forecast and sorted soonest-first — the row-per-cost
 * table a panel shows underneath the aggregate figures {@link oneOffCostsImpact} reports.
 *
 * @param {readonly OneOffCost[]} costs Already normalised.
 * @param {import('./forecast.js').Forecast} forecast Read for its horizon/dates only — any
 *   `Forecast` sharing the same anchor and horizon as the one `costs` was projected against works,
 *   baseline or costed.
 * @returns {OneOffCostOccurrence[]}
 */
export function oneOffCostOccurrences(costs, forecast) {
	const series = forecast.series.realistic ?? [];
	return [...costs]
		.sort((a, b) => a.atMonth - b.atMonth)
		.map((cost) => {
			const point = series[cost.atMonth];
			return {
				id: cost.id,
				name: cost.name,
				atMonth: cost.atMonth,
				amount: cost.amount,
				occurs: cost.amount > 0 && Boolean(point),
				date: cost.amount > 0 ? dateOf(point) : null
			};
		});
}

/**
 * What the configured costs did to one scenario, in aggregate.
 *
 * @typedef {object} OneOffCostsImpact
 * @property {import('./forecast.js').ForecastScenario} scenario
 * @property {OneOffCostOccurrence[]} costs Every configured cost, dated and sorted soonest-first.
 * @property {number} totalConfigured Combined amount of every configured cost, regardless of
 *   whether it falls inside the horizon (£).
 * @property {number} totalOccurring Combined amount of costs that actually fall inside the horizon
 *   (£) — `<= totalConfigured`, and the two differ only when a cost is dated past the end of the
 *   projection.
 * @property {number} baselineFinal Net worth at the horizon without the costs (£).
 * @property {number} costedFinal Net worth at the horizon with them taken out (£).
 * @property {number} shortfall `baselineFinal - costedFinal` (£).
 * @property {number | null} shortfallShare `shortfall / baselineFinal`, or `null` when the baseline
 *   ends at or below zero.
 */

/**
 * Compare one scenario of a costed forecast against the same scenario of the baseline it was built
 * alongside.
 *
 * The two must share an anchor and a horizon — build them from one set of assumptions (see
 * {@link oneOffCostsForecast}) and they do.
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {OneOffCostsForecast} costed
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @returns {OneOffCostsImpact}
 */
export function oneOffCostsImpact(baseline, costed, scenario = 'realistic') {
	const costs = oneOffCostOccurrences(costed.costs, costed);

	const baselineSeries = baseline.series[scenario] ?? [];
	const costedSeries = costed.series[scenario] ?? [];

	const baselineFinal = baselineSeries.at(-1)?.net_worth ?? 0;
	const costedFinal = costedSeries.at(-1)?.net_worth ?? 0;
	const shortfall = roundMoney(baselineFinal - costedFinal);

	return {
		scenario,
		costs,
		totalConfigured: totalOneOffCosts(costed.costs),
		totalOccurring: roundMoney(
			costs.filter((cost) => cost.occurs).reduce((total, cost) => total + cost.amount, 0)
		),
		baselineFinal,
		costedFinal,
		shortfall,
		shortfallShare: baselineFinal > 0 ? shortfall / baselineFinal : null
	};
}

/**
 * {@link oneOffCostsImpact} for all three scenarios — the low/mid/high shape the rest of the tab
 * already reads (`forecastBand`, `milestoneCrossings`, `growthCrossovers`).
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {OneOffCostsForecast} costed
 * @returns {Record<import('./forecast.js').ForecastScenario, OneOffCostsImpact>}
 */
export function oneOffCostsImpacts(baseline, costed) {
	/** @type {Record<string, OneOffCostsImpact>} */
	const impacts = {};
	for (const scenario of FORECAST_SCENARIOS) {
		impacts[scenario] = oneOffCostsImpact(baseline, costed, scenario);
	}
	return /** @type {Record<import('./forecast.js').ForecastScenario, OneOffCostsImpact>} */ (
		impacts
	);
}

/**
 * One month of the overlay against the baseline.
 *
 * @typedef {object} OneOffCostsComparisonRow
 * @property {number} offset Months since the anchor.
 * @property {number} years
 * @property {number} month
 * @property {number} year
 * @property {number} baseline Net worth without the costs (£).
 * @property {number} costed Net worth with them taken out (£).
 * @property {number} gap `costed - baseline` (£) — negative once a cost has landed.
 * @property {number | null} gapShare `gap / baseline`, or `null` when the baseline is at or below
 *   zero.
 */

/**
 * Line the two projections up month by month at the offsets given — normally whichever rows the
 * forecast summary table is showing, matching `stress-test.js`'s `compareStressed` and
 * `income-shock.js`'s `compareIncomeShock`. Offsets past the horizon are dropped rather than
 * returned as holes.
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {OneOffCostsForecast} costed
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @param {readonly number[] | null} [offsets] Defaults to `summariseForecast`'s own horizons.
 * @returns {OneOffCostsComparisonRow[]}
 */
export function compareOneOffCosts(baseline, costed, scenario = 'realistic', offsets = null) {
	const wanted =
		offsets && offsets.length > 0 ? offsets : summariseForecast(baseline).map((row) => row.offset);

	/** @type {OneOffCostsComparisonRow[]} */
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
