/**
 * Mortgage rate rise overlay — README.md → "Advanced Scenarios": "Mortgage rate rise" (issue
 * #134). The panel and the forecast-tab wiring are #158; this is the engine only.
 *
 * `stress-test.js` asks "what if the market falls off a cliff?" and `income-shock.js` asks "what
 * if I stop being able to pay in?". This module asks a third, mortgage-specific question: "what if
 * the rate on an existing property's mortgage changes at a stated future month, and what does that
 * do to my monthly cashflow — and, through it, my investment contributions?" Unlike its two
 * siblings, this module first has to reconstruct arithmetic `property.js` already owns: a
 * `Property` has no `term` field, only `mortgage_balance`, `monthly_payment` and `interest_rate`,
 * so the remaining number of payments has to be solved for from those three before anything about
 * "a new rate" means anything.
 *
 * Six conventions decide what the numbers mean:
 *
 * 1. **The remaining term is derived, not stored**, by inverting the standard annuity formula
 *    ({@link remainingMortgageTermMonths}): `n = -ln(1 - r·B/P) / ln(1 + r)`. A payment that never
 *    clears the interest it accrues (`monthly_payment <= balance * monthlyRate` — an interest-only
 *    mortgage, an underwater one, or simply no payment on record) has no finite solution and returns
 *    `null` rather than `NaN`, honestly, everywhere a term is asked for.
 * 2. **"Interest-only" needs no `mortgage_type` special case, because this codebase's own
 *    `MortgageType` (`types.js`) has no `'interest_only'` value to check for — `fixed`, `tracker`,
 *    `svr` and `none` are the only four. What makes a mortgage interest-only is structural, not a
 *    label: its recorded `monthly_payment` is, by definition, exactly the interest on its balance —
 *    which is precisely the boundary condition convention 1 already treats as "never clears".
 *    Plugging one into {@link remainingMortgageTermMonths} therefore already returns `null` without
 *    this module reading `mortgage_type` at all (an underwater mortgage on any of the four recorded
 *    types hits the same boundary the same way), and every function that would otherwise need a
 *    term ({@link mortgageRateRiseTerms}'s `keepTerm` branch) falls back to quoting an
 *    interest-only-style payment at the new rate — `balance * newMonthlyRate` — instead of solving
 *    for a term that does not exist.
 * 3. **The config names one property, one new rate, when it lands, and what the borrower keeps.**
 *    `propertyId` picks the mortgage; `newRatePct` is the replacement rate (a whole-number percent,
 *    as everywhere else in `$lib`); `atMonth` is whole months after the forecast anchor, `>= 1`
 *    exactly as `stress-test.js`/`income-shock.js`'s own `atMonth` — offset 0 is the anchor every
 *    scenario shares. `keepTerm` is the choice a real remortgage makes: `true` keeps the number of
 *    payments left the same and lets the payment rise to match (the usual "my mortgage got more
 *    expensive" story); `false` keeps the payment the same and lets the term run longer instead.
 *    Unlike `IncomeShock`/`StressTest`, a rate change has no `durationMonths` — a mortgage rate,
 *    once it changes, stays changed until the next remortgage, which is out of this scenario's
 *    scope, so the overlay runs to the end of the forecast rather than for a stated spell.
 * 4. **The overlay is an `adjustMonth` hook, not a second projector.** A costlier mortgage is a
 *    cashflow change, not a market one, so {@link mortgageRateRiseAdjustment} expresses it through
 *    `forecast.js`'s `ForecastMonthAdjustment.contributionFactor` exactly as `income-shock.js` does,
 *    and {@link mortgageRateRiseForecast} returns the same `Forecast` shape `forecastScenarios`
 *    does, with the config attached as `rateRise` — so `forecastBand`, `summariseForecast`,
 *    `milestoneCrossings` and `compounding.js` all read a rate-risen projection unchanged. Because
 *    `keepTerm: false` leaves the monthly payment untouched, it produces no cashflow adjustment at
 *    all — the whole cost of that choice is the extra interest paid over a longer term, which
 *    `forecast.js` has no way to show (it carries every `Debt` — and every mortgage balance —
 *    forward unchanged, never amortising it), so {@link mortgageRateRiseImpact} reports it as its
 *    own figure instead of folding it into net worth.
 * 5. **A contribution factor cannot go below zero, and the remainder is not carried anywhere.** When
 *    the extra payment exceeds a month's total scheduled contribution, contributions for that month
 *    are floored at zero — the same "nothing is ever paid back" convention `income-shock.js`
 *    documents for a missed month — rather than borrowing against a future month or letting the
 *    factor go negative, which would read as contributions *reversing* rather than merely stopping.
 * 6. **A property that does not exist, or exists with no mortgage, is an honest empty answer, not a
 *    thrown error.** Every exported function here that takes a property is tolerant of `null`, of a
 *    property that does not appear in the caller's `properties[]`, and of `mortgage_balance <= 0` —
 *    all read as "no mortgage to change", so #158's panel can render one empty state rather than
 *    guarding the same condition at every call site.
 *
 * Everything here is pure: a position, a property and a config go in, new objects come out, nothing
 * is mutated.
 */

import { contributionForOffset } from './auto-invest.js';
import {
	FORECAST_SCENARIOS,
	MAX_FORECAST_MONTHS,
	forecastScenarios,
	summariseForecast
} from './forecast.js';
import { amortiseMortgageMonth } from './property.js';

/*
 * As elsewhere in `$lib`: types are referenced inline as `import('./forecast.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *` and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The four dials README.md's "mortgage rate rise" scenario needs.
 *
 * @typedef {object} MortgageRateRise
 * @property {string} propertyId `Property.id` the rate change applies to. `''` means no property
 *   is chosen yet.
 * @property {number} newRatePct The replacement mortgage rate, as a whole-number percent —
 *   `validateAppData`'s own range for `Property.interest_rate` (0–100).
 * @property {number} atMonth Timing: whole months after the forecast anchor the new rate takes
 *   effect. `1` is the first projected month; `0` is not allowed — offset 0 is the anchor itself.
 * @property {boolean} keepTerm `true`: the remaining number of payments stays the same and the
 *   payment rises to match. `false`: the payment stays the same and the term runs longer instead.
 */

/**
 * Defaults for a rate change nobody has configured yet.
 *
 * README.md names the scenario but gives no numbers, so these are ours: a year out (matching
 * `stress-test.js`/`income-shock.js`'s own default timing), a 6% rate as a plausible "renewed onto
 * something noticeably higher" figure against the low fixed rates much of the mortgage market
 * locked in during the 2020s, and `keepTerm: true` because "my payment went up" is the story most
 * people mean by "mortgage rate rise" — `keepTerm: false` is the option the panel turns on, not a
 * house view of how a remortgage normally goes. `propertyId` has no sensible default at all: an
 * empty string reads as "no property chosen", the state every function here already treats as
 * honestly empty (convention 6).
 *
 * @type {Readonly<MortgageRateRise>}
 */
export const DEFAULT_MORTGAGE_RATE_RISE = Object.freeze({
	propertyId: '',
	newRatePct: 6,
	atMonth: 12,
	keepTerm: true
});

/** Mortgage rates are whole-number percents; `validateAppData` accepts 0…100 for one, so match it. */
const MIN_RATE_PCT = 0;
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
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function asMoney(value, fallback = 0) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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
 * Fill in and bound a partial config, so a slider, a hand-edited document or an empty object all
 * become a {@link MortgageRateRise} the engine can work from. Out-of-range values are clamped
 * rather than rejected, matching `stress-test.js`'s `normaliseStressTest`.
 *
 * @param {Partial<MortgageRateRise>} [rateRise]
 * @returns {MortgageRateRise}
 */
export function normaliseMortgageRateRise(rateRise = {}) {
	const propertyId = typeof rateRise.propertyId === 'string' ? rateRise.propertyId : '';
	const newRatePct = clamp(
		asNumber(rateRise.newRatePct, DEFAULT_MORTGAGE_RATE_RISE.newRatePct),
		MIN_RATE_PCT,
		MAX_RATE_PCT
	);
	const atMonth = clamp(
		Math.trunc(asNumber(rateRise.atMonth, DEFAULT_MORTGAGE_RATE_RISE.atMonth)),
		1,
		MAX_FORECAST_MONTHS
	);
	const keepTerm =
		typeof rateRise.keepTerm === 'boolean'
			? rateRise.keepTerm
			: DEFAULT_MORTGAGE_RATE_RISE.keepTerm;

	return { propertyId, newRatePct, atMonth, keepTerm };
}

/**
 * Find the property a config names, in the `properties[]` list a caller holds — the one place that
 * lookup happens, so every other function here can be handed a `Property | null` directly instead
 * of repeating the search.
 *
 * @param {readonly import('./types.js').Property[] | undefined} properties
 * @param {string} propertyId
 * @returns {import('./types.js').Property | null}
 */
export function findRateRiseProperty(properties, propertyId) {
	if (!propertyId) return null;
	return (properties ?? []).find((property) => property.id === propertyId) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Mortgage arithmetic                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The number of monthly payments left to clear a balance, solved from the standard annuity
 * formula rather than stored — see the module doc, convention 1.
 *
 * `null` — not `NaN` — for every case with no finite answer: a zero or negative balance is handled
 * separately (it returns `0`, not `null` — there is nothing left to pay, which is a term, not an
 * absence of one); a zero or negative payment can never clear a positive balance; and a payment
 * that does not exceed the interest the balance accrues each month never clears it either — the
 * boundary this module leans on for an interest-only mortgage (convention 2).
 *
 * @param {{ mortgage_balance?: number, monthly_payment?: number, interest_rate?: number } | null} [property]
 * @returns {number | null} Whole months, rounded up (a part-month still needs a payment).
 */
export function remainingMortgageTermMonths(property) {
	const balance = asMoney(property?.mortgage_balance);
	if (balance <= 0) return 0;

	const payment = asMoney(property?.monthly_payment);
	if (payment <= 0) return null;

	const monthlyRate = asMoney(property?.interest_rate) / 100 / 12;
	if (monthlyRate <= 0) return Math.ceil(balance / payment);
	if (payment <= balance * monthlyRate) return null;

	const months = -Math.log(1 - (monthlyRate * balance) / payment) / Math.log(1 + monthlyRate);
	return Number.isFinite(months) && months > 0 ? Math.ceil(months) : null;
}

/**
 * The monthly payment a standard reducing-balance mortgage needs to clear `balance` over
 * `termMonths`, at `monthlyRate` — the inverse of {@link remainingMortgageTermMonths}: that solves
 * for the term given a payment, this solves for the payment given a term, both off the same
 * annuity formula.
 *
 * @param {number} balance (£)
 * @param {number} monthlyRate A fraction (e.g. `0.06 / 12`), not a percent.
 * @param {number | null} termMonths
 * @returns {number} (£/mo), `0` when there is nothing left to pay or no term to pay it over.
 */
export function annuityPayment(balance, monthlyRate, termMonths) {
	if (balance <= 0 || termMonths === null || !Number.isFinite(termMonths) || termMonths <= 0) {
		return 0;
	}
	if (monthlyRate <= 0) return roundMoney(balance / termMonths);

	const payment = (balance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));
	return roundMoney(payment);
}

/**
 * Walk a property's mortgage forward `months` months at its *own* recorded rate and payment —
 * `property.js`'s {@link import('./property.js').amortiseMortgageMonth}, called monthly rather than
 * sampled annually (module doc's opening paragraph, and that function's own doc comment) — to find
 * the balance still outstanding when a rate change lands at some point in the future. Carries the
 * balance forward unchanged when there is no payment on record, the same fallback
 * `propertyEquityProjection` uses.
 *
 * @param {{ mortgage_balance?: number, monthly_payment?: number, interest_rate?: number } | null} property
 * @param {number} months Whole months to walk forward. `<= 0` returns today's balance unchanged.
 * @returns {number} (£)
 */
export function projectMortgageBalance(property, months) {
	const horizon = Math.max(0, Math.trunc(months) || 0);
	const monthlyPayment = asMoney(property?.monthly_payment);
	const monthlyRate = asMoney(property?.interest_rate) / 100 / 12;
	const amortises = monthlyPayment > 0;

	let balance = asMoney(property?.mortgage_balance);
	for (let month = 0; month < horizon && amortises && balance > 0; month += 1) {
		balance = amortiseMortgageMonth(balance, monthlyRate, monthlyPayment);
	}

	return roundMoney(balance);
}

/* -------------------------------------------------------------------------- */
/* What the rate change does to the mortgage itself                           */
/* -------------------------------------------------------------------------- */

/**
 * What a rate change works out to on the mortgage itself, independent of any forecast — the
 * numbers {@link mortgageRateRiseImpact} reports and {@link mortgageRateRiseAdjustment} turns into
 * a monthly cashflow hit.
 *
 * @typedef {object} MortgageRateRiseTerms
 * @property {boolean} hasMortgage Whether there was a property with an outstanding mortgage to
 *   change at all — convention 6's empty state.
 * @property {number} balanceAtRateRise Outstanding balance when the new rate lands (£), projected
 *   forward from today at the mortgage's own current rate and payment.
 * @property {number} oldPayment `property.monthly_payment`, unchanged (£/mo).
 * @property {number} newPayment The payment under the new rate (£/mo) — equal to `oldPayment` when
 *   `keepTerm` is `false`.
 * @property {number} delta `newPayment - oldPayment` (£/mo). Positive for a costlier mortgage,
 *   negative for a cheaper one, always `0` when `keepTerm` is `false`.
 * @property {number | null} oldRemainingTermMonths Months left on the mortgage at `balanceAtRateRise`
 *   under the *old* rate — `null` when that has no finite answer (convention 1).
 * @property {number | null} newRemainingTermMonths Months left under the *new* rate/payment —
 *   equal to `oldRemainingTermMonths` when `keepTerm` is `true`.
 * @property {number | null} extraInterestOverRemainingTerm Total interest paid under the new terms
 *   minus total interest paid under the old ones (£) — `null` whenever either term is undefined,
 *   since there is then no finite "total interest" to compare.
 */

/**
 * @returns {MortgageRateRiseTerms} The empty answer convention 6 promises: no property, or a
 *   property with nothing left owed on it.
 */
function emptyMortgageRateRiseTerms() {
	return {
		hasMortgage: false,
		balanceAtRateRise: 0,
		oldPayment: 0,
		newPayment: 0,
		delta: 0,
		oldRemainingTermMonths: 0,
		newRemainingTermMonths: 0,
		extraInterestOverRemainingTerm: 0
	};
}

/**
 * Work out what a normalised rate-change config does to one property's mortgage.
 *
 * The general shape is the same either way: total interest paid is `payment × term - balance`, so
 * the *extra* interest a change costs is `(newPayment × newTerm) - (oldPayment × oldTerm)` — the
 * shared `balance` cancels out, which is why the same formula below covers both a `keepTerm` rise
 * (term fixed, payment solved for) and a `keepPayment` extension (payment fixed, term solved for)
 * without a separate branch for each.
 *
 * @param {import('./types.js').Property | null} property
 * @param {MortgageRateRise} config Already normalised — see {@link normaliseMortgageRateRise}.
 * @returns {MortgageRateRiseTerms}
 */
export function mortgageRateRiseTerms(property, config) {
	if (!property || asMoney(property.mortgage_balance) <= 0) return emptyMortgageRateRiseTerms();

	const balanceAtRateRise = projectMortgageBalance(property, config.atMonth - 1);
	const oldPayment = asMoney(property.monthly_payment);

	if (balanceAtRateRise <= 0) {
		// The mortgage clears before the new rate would even land — there is nothing left to change,
		// so the honest "new payment" is £0, whichever of `keepTerm`'s two stories was asked for.
		return {
			...emptyMortgageRateRiseTerms(),
			hasMortgage: true,
			oldPayment,
			delta: roundMoney(-oldPayment)
		};
	}

	const oldRemainingTermMonths = remainingMortgageTermMonths({
		mortgage_balance: balanceAtRateRise,
		interest_rate: property.interest_rate,
		monthly_payment: oldPayment
	});
	const newMonthlyRate = config.newRatePct / 100 / 12;

	let newPayment;
	let newRemainingTermMonths;
	if (config.keepTerm) {
		newRemainingTermMonths = oldRemainingTermMonths;
		newPayment =
			oldRemainingTermMonths === null
				? // No finite term to keep (convention 2) — the honest fallback is an interest-only
					// payment at the new rate, not a term this mortgage was never going to have.
					roundMoney(balanceAtRateRise * newMonthlyRate)
				: annuityPayment(balanceAtRateRise, newMonthlyRate, oldRemainingTermMonths);
	} else {
		newPayment = oldPayment;
		newRemainingTermMonths = remainingMortgageTermMonths({
			mortgage_balance: balanceAtRateRise,
			interest_rate: config.newRatePct,
			monthly_payment: oldPayment
		});
	}

	const extraInterestOverRemainingTerm =
		oldRemainingTermMonths === null || newRemainingTermMonths === null
			? null
			: roundMoney(newPayment * newRemainingTermMonths - oldPayment * oldRemainingTermMonths);

	return {
		hasMortgage: true,
		balanceAtRateRise,
		oldPayment,
		newPayment,
		delta: roundMoney(newPayment - oldPayment),
		oldRemainingTermMonths,
		newRemainingTermMonths,
		extraInterestOverRemainingTerm
	};
}

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turn a config and a property into the per-month hook `forecast.js` projects through: from
 * `atMonth` onward, every holding's contribution is scaled down (or, for a rate cut, up) by
 * whatever share of that month's total contribution the extra mortgage payment represents —
 * floored at `0` rather than let go negative (convention 5) — and every earlier month, or every
 * month once there is no mortgage to change, returns `null` (project normally).
 *
 * A config with no cashflow effect — no property, no mortgage, or `keepTerm: false` where the
 * payment never changes — returns a hook that is `null` everywhere, so the overlay lands exactly
 * on the baseline rather than quietly touching contributions a rate change never actually moved.
 *
 * @param {MortgageRateRise} config Already normalised.
 * @param {import('./types.js').Property | null} property
 * @param {readonly import('./types.js').Investment[]} [investments]
 * @returns {(offset: number) => import('./forecast.js').ForecastMonthAdjustment | null}
 */
export function mortgageRateRiseAdjustment(config, property, investments = []) {
	const terms = mortgageRateRiseTerms(property, config);
	if (!terms.hasMortgage || terms.delta === 0) return () => null;

	const countable = investments.filter((investment) => !investment.exclude_from_net_worth);

	return (offset) => {
		if (offset < config.atMonth) return null;

		const totalContribution = countable.reduce(
			(sum, investment) => sum + contributionForOffset(investment, offset),
			0
		);
		if (totalContribution <= 0) {
			// Nothing is scheduled to be paid in this month regardless, so a costlier mortgage has
			// nothing left to scale down — and a cheaper one has nothing to scale up either.
			return terms.delta > 0 ? { contributionFactor: 0 } : null;
		}

		return { contributionFactor: Math.max(0, 1 - terms.delta / totalContribution) };
	};
}

/**
 * A forecast with the rate change in it.
 *
 * @typedef {import('./forecast.js').Forecast & { rateRise: MortgageRateRise }} MortgageRateRiseForecast
 */

/**
 * Project a position under all three scenarios *with* a mortgage rate change — the overlay line to
 * the baseline `forecastScenarios` draws.
 *
 * Takes the same `input`/`options` as {@link import('./forecast.js').forecastScenarios} so the two
 * can be built from one set of assumptions: pass the baseline forecast's own `start`, `months` and
 * `spread` and the overlay shares its anchor, horizon and band width — exactly `stress-test.js`'s
 * `stressForecast` pattern.
 *
 * @param {object} [input]
 * @param {readonly import('./types.js').Investment[]} [input.investments]
 * @param {readonly import('./types.js').Debt[]} [input.debts]
 * @param {{ month: number, year: number }} [input.start]
 * @param {number} [input.months]
 * @param {number} [input.spread]
 * @param {import('./forecast.js').ForecastOptions} [options]
 * @param {Partial<MortgageRateRise>} [rateRise]
 * @param {readonly import('./types.js').Property[]} [properties]
 * @returns {MortgageRateRiseForecast}
 */
export function mortgageRateRiseForecast(input = {}, options = {}, rateRise = {}, properties = []) {
	const config = normaliseMortgageRateRise(rateRise);
	const property = findRateRiseProperty(properties, config.propertyId);
	const forecast = forecastScenarios(input, {
		...options,
		adjustMonth: mortgageRateRiseAdjustment(config, property, input.investments ?? [])
	});

	return { ...forecast, rateRise: config };
}

/* -------------------------------------------------------------------------- */
/* Reading the damage                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What the rate change did, on the mortgage and on the projection.
 *
 * @typedef {object} MortgageRateRiseImpact
 * @property {import('./forecast.js').ForecastScenario} scenario
 * @property {boolean} hasMortgage Convention 6's empty state.
 * @property {boolean} occurs Whether `atMonth` lands inside this forecast's horizon at all, given a
 *   property with a mortgage to change.
 * @property {number} atMonth Offset the new rate takes effect.
 * @property {{ month: number, year: number } | null} date Calendar month it takes effect.
 * @property {number} balanceAtRateRise (£)
 * @property {number} oldPayment (£/mo)
 * @property {number} newPayment (£/mo)
 * @property {number} delta `newPayment - oldPayment` (£/mo).
 * @property {number | null} oldRemainingTermMonths
 * @property {number | null} newRemainingTermMonths
 * @property {number | null} extraInterestOverRemainingTerm (£) — see {@link MortgageRateRiseTerms}.
 * @property {number} baselineFinal Net worth at the horizon without the rate change (£).
 * @property {number} risenFinal Net worth at the horizon with it (£).
 * @property {number} shortfall `baselineFinal - risenFinal` (£) — `0` whenever `delta` is `0`
 *   (a `keepTerm: false` config never touches a contribution, so it never touches this either;
 *   see the module doc, convention 4).
 * @property {number | null} shortfallShare `shortfall / baselineFinal`, or `null` when the
 *   baseline ends at or below zero.
 */

/**
 * @param {import('./forecast.js').ForecastPoint | undefined} point
 * @returns {{ month: number, year: number } | null}
 */
function dateOf(point) {
	return point ? { month: point.month, year: point.year } : null;
}

/**
 * Compare one scenario of a rate-risen forecast against the same scenario of the baseline it was
 * built alongside, and combine it with what the rate change did to the mortgage itself.
 *
 * The two forecasts must share an anchor and a horizon — build them from one set of assumptions
 * (see {@link mortgageRateRiseForecast}) and they do.
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {MortgageRateRiseForecast} risen
 * @param {import('./types.js').Property | null} property The property `risen.rateRise.propertyId`
 *   names — the caller's own lookup, so this does not repeat {@link findRateRiseProperty}.
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @returns {MortgageRateRiseImpact}
 */
export function mortgageRateRiseImpact(baseline, risen, property, scenario = 'realistic') {
	const config = risen.rateRise;
	const terms = mortgageRateRiseTerms(property, config);

	const risenSeries = risen.series[scenario] ?? [];
	const baselineSeries = baseline.series[scenario] ?? [];
	const occurs =
		terms.hasMortgage &&
		Boolean(risenSeries[config.atMonth]) &&
		Boolean(baselineSeries[config.atMonth]);

	const baselineFinal = baselineSeries.at(-1)?.net_worth ?? 0;
	const risenFinal = risenSeries.at(-1)?.net_worth ?? 0;
	const shortfall = roundMoney(baselineFinal - risenFinal);

	return {
		scenario,
		hasMortgage: terms.hasMortgage,
		occurs,
		atMonth: config.atMonth,
		date: dateOf(risenSeries[config.atMonth]),
		balanceAtRateRise: terms.balanceAtRateRise,
		oldPayment: terms.oldPayment,
		newPayment: terms.newPayment,
		delta: terms.delta,
		oldRemainingTermMonths: terms.oldRemainingTermMonths,
		newRemainingTermMonths: terms.newRemainingTermMonths,
		extraInterestOverRemainingTerm: terms.extraInterestOverRemainingTerm,
		baselineFinal,
		risenFinal,
		shortfall,
		shortfallShare: baselineFinal > 0 ? shortfall / baselineFinal : null
	};
}

/**
 * {@link mortgageRateRiseImpact} for all three scenarios — the low/mid/high shape the rest of the
 * tab already reads (`forecastBand`, `milestoneCrossings`, `growthCrossovers`).
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {MortgageRateRiseForecast} risen
 * @param {import('./types.js').Property | null} property
 * @returns {Record<import('./forecast.js').ForecastScenario, MortgageRateRiseImpact>}
 */
export function mortgageRateRiseImpacts(baseline, risen, property) {
	/** @type {Record<string, MortgageRateRiseImpact>} */
	const impacts = {};
	for (const scenario of FORECAST_SCENARIOS) {
		impacts[scenario] = mortgageRateRiseImpact(baseline, risen, property, scenario);
	}
	return /** @type {Record<import('./forecast.js').ForecastScenario, MortgageRateRiseImpact>} */ (
		impacts
	);
}

/**
 * One month of the overlay against the baseline.
 *
 * @typedef {object} MortgageRateRiseComparisonRow
 * @property {number} offset Months since the anchor.
 * @property {number} years
 * @property {number} month
 * @property {number} year
 * @property {number} baseline Net worth without the rate change (£).
 * @property {number} risen Net worth with it (£).
 * @property {number} gap `risen - baseline` (£) — negative once the change has started costing.
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
 * @param {MortgageRateRiseForecast} risen
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @param {readonly number[] | null} [offsets] Defaults to `summariseForecast`'s own horizons.
 * @returns {MortgageRateRiseComparisonRow[]}
 */
export function compareMortgageRateRise(baseline, risen, scenario = 'realistic', offsets = null) {
	const wanted =
		offsets && offsets.length > 0 ? offsets : summariseForecast(baseline).map((row) => row.offset);

	/** @type {MortgageRateRiseComparisonRow[]} */
	const rows = [];
	for (const offset of wanted) {
		const basePoint = baseline.series[scenario]?.[offset];
		const risenPoint = risen.series[scenario]?.[offset];
		if (!basePoint || !risenPoint) continue;

		const gap = roundMoney(risenPoint.net_worth - basePoint.net_worth);
		rows.push({
			offset,
			years: offset / 12,
			month: basePoint.month,
			year: basePoint.year,
			baseline: basePoint.net_worth,
			risen: risenPoint.net_worth,
			gap,
			gapShare: basePoint.net_worth > 0 ? gap / basePoint.net_worth : null
		});
	}
	return rows;
}
