/**
 * Monte Carlo retirement simulator — README.md → Phase 2, "Monte Carlo Retirement Simulator":
 * "5,000 simulated market paths", "Log-normal returns, sequence-of-returns risk", "UK tax modelled
 * per stream", "State Pension included", "Probability of pot lasting to target age" — issue #131.
 *
 * Every other projection in this app answers "what happens if the market returns 5% a year, every
 * year?". Nobody's market does that. This module answers the question that one cannot: *given the
 * same average return, how often does this plan actually work?* It does that by simulating thousands
 * of complete retirements — each one a different sequence of monthly returns drawn from the same
 * distribution — funding the same income out of the same pots under the same UK tax rules, and
 * counting how many of them still had money at the target age.
 *
 * The statistical approach, in full, because getting it wrong here would mislead someone about their
 * own retirement:
 *
 * 1. **A path is one possible history, walked month by month — the order of the returns is the
 *    point.** Two paths with identical *average* returns can end in completely different places once
 *    money is moving in or out: a 30% fall in the first year of drawdown is met by selling a larger
 *    share of the pot to fund the same income, so the pot that recovers has less left to recover
 *    with. That is sequence-of-returns risk, and it is not a modelling extra here — it falls out of
 *    walking each path forward in time rather than compounding an average. `forecast.js`'s three
 *    scenarios deliberately keep to a parallel shift of one average rate (its convention 3) and say
 *    so; this module is where the order of the years starts to matter.
 *
 * 2. **Returns are log-normal, parameterised by exact moment matching.** A gross annual return
 *    `1 + R` is `exp(X)` with `X ~ Normal(m, s²)`, which keeps every path strictly positive (a pot
 *    can approach zero but never go negative from market moves alone) and gives the right-skewed
 *    shape long-run equity returns actually have. The caller states an annual return and an annual
 *    volatility — the standard deviation of *simple* annual returns, which is how an assumption is
 *    normally quoted ("7% and 15%") — and {@link logNormalParameters} inverts the log-normal's
 *    moments to get `m` and `s` exactly, rather than assuming `s ≈ volatility`:
 *
 *    ```text
 *    E[1 + R]   = exp(m + s²/2)
 *    Var[1 + R] = exp(2m + s²)·(exp(s²) − 1)
 *    ```
 *
 *    With `L` the stated return level and `σ` the stated volatility (both as fractions), and
 *    `k = σ²/L²`:
 *
 *    ```text
 *    basis 'arithmetic' (L is the mean simple return):    s² = ln(1 + k),  m = ln(L) − s²/2
 *    basis 'compound'   (L is the median simple return):  s² = ln(u),      m = ln(L)
 *                                                         where u² − u = k, so u = (1 + √(1+4k))/2
 *    ```
 *
 *    Both are closed-form and both reproduce the stated volatility exactly — see
 *    {@link LogNormalParameters.impliedVolatility}, which is computed back out of `m` and `s` rather
 *    than copied from the input, so a test can hold the round trip to the penny.
 *
 * 3. **Monthly draws scale the annual distribution correctly: `m/12` and `s/√12`.** Twelve
 *    independent monthly log returns sum to a normal with mean `m` and variance `s²`, so twelve
 *    monthly draws compound to exactly the annual distribution that was specified. Dividing the
 *    *volatility* by twelve (the mistake that mirrors `annual/12` growth rates —
 *    `auto-invest.js`'s convention 1) would understate a year's dispersion by a factor of √12 ≈ 3.5
 *    and turn a realistic simulation into a nearly deterministic one.
 *
 * 4. **The growth rate the app already stores is a *compound* rate, so that is the default reading.**
 *    `Profile.growth_rate` is what `forecast.js` and `fire.js` compound deterministically, and under
 *    `returnBasis: 'compound'` the median simulated path is exactly the line those tabs already draw
 *    at the same rate — the two cannot disagree about the same assumption. The mean path is then
 *    *above* it, by the volatility drag `exp(s²/2)`: at 5% and 15% volatility the median return stays
 *    5% while the arithmetic mean is about 6%. A caller whose assumption is an arithmetic average
 *    instead (as published equity-premium figures usually are) passes `returnBasis: 'arithmetic'` and
 *    gets a median *below* the stated rate, by the same drag. Both readings are legitimate; silently
 *    picking one and calling it "5%" is what is not.
 *
 * 5. **A month of a path is `forecast.js`'s own `factor` month.** Growth is credited first and the
 *    month's cash flow lands at the month end, values are rounded to whole pence and the rounded
 *    value is carried forward — `roundMoney(value × factor + cashflow)`, character for character
 *    what {@link import('./forecast.js').ForecastMonthAdjustment}'s `factor` branch does. A Monte
 *    Carlo month is a forecast month whose factor was drawn rather than stated, and
 *    {@link forecastAdjustmentFromFactors} hands a drawn path straight to `projectScenario` so that
 *    claim is testable rather than merely asserted.
 *
 * 6. **Everything is in today's money.** Fees come off the growth assumption the way
 *    `auto-invest.js` takes them off (compounding against growth, not subtracting from it), and
 *    inflation is then deflated out Fisher-style. Deflating by a *deterministic* inflation rate
 *    subtracts `ln(1 + i)` from the drift and leaves the log volatility untouched, which is why the
 *    moment matching in (2) is done in nominal terms first and shifted afterwards. The median real
 *    growth rate that falls out equals `fire.js`'s own {@link realGrowthRate} exactly.
 *
 * 7. **Two pots, because tax needs at least two.** A Defined Contribution pension pot, whose
 *    withdrawals come back 25% tax-free and 75% taxable as earned income (`retirement-income.js`'s
 *    convention 5, UFPLS-style), and a tax-free pot — ISAs, plus a Lifetime ISA drawn after 60. Both
 *    ride the *same* market path: one market, one set of returns, and a per-pot volatility would be
 *    an asset-allocation model this app has no data for.
 *
 * 8. **A target income is a net income, so withdrawals are grossed up.** `retirement-income.js`'s
 *    convention 7 — you live on what arrives — so each retirement year works out the *gross*
 *    withdrawal whose after-tax value covers what the promised income streams did not
 *    ({@link grossWithdrawalForNet}). Tax is assessed annually, on the year's whole earned income
 *    against one personal allowance including its £100k taper, which is both what HMRC does and what
 *    makes the 25% tax-free share worth having. Within a year the plan is paid in twelve equal
 *    instalments; at the year end the tax is recomputed on what was *actually* withdrawn, so a pot
 *    that fell mid-year is not taxed on income it could not pay.
 *
 * 9. **Promised income arrives first, and each stream carries its own tax treatment.** The State
 *    Pension (`state-pension.js`, at its own State Pension age) and any Defined Benefit pension
 *    (`defined-benefit.js`) are {@link MonteCarloIncomeStream}s with a start age and a treatment,
 *    counted before the pots are touched — which is exactly why they lift the success probability so
 *    much: every pound of promised income is a pound the market cannot take away.
 *
 * 10. **Failure is a year the plan could not be funded, and the headline is the share of paths with
 *     no such year.** Not "the pot hit zero" — a pot can hit zero at 94 having funded everything
 *     asked of it, and a pot with £5,000 left that funded £3,000 of a £30,000 year has failed. Each
 *     path also records the *first* age it fell short, which is what {@link probabilityOfLastingTo}
 *     reads to answer "how likely is this to last to 90?" for any age, not just the target.
 *
 * 11. **Deterministic, seeded and pure.** The generator is a seeded mulberry32 feeding Box–Muller
 *     (see {@link createNormalSource}), so the same input always produces the same answer — a slider
 *     that moved by nothing must not move the probability, and a test needs a fixed answer to hold.
 *     Nothing here reads the clock except through an injectable `now`/`start`, and nothing is mutated
 *     that the caller handed in.
 *
 * **What this deliberately does not model.** Returns are independent month to month: no mean
 * reversion, no volatility clustering, no fat tails beyond what the log-normal gives, and no
 * correlation between the market and inflation — a real 2008 is worse than anything drawn here, and
 * a bootstrap of historical blocks (which would keep those features) needs a return history this app
 * does not carry. Also unmodelled: any asset allocation, glide path or rebalancing; annuitisation
 * part-way through; the pension tax relief on the contributions going in (`pension-relief.js` owns
 * that) and the Annual Allowance limiting them; National Insurance, which no pension income pays;
 * the 55/57 minimum pension age and a DB scheme's own normal pension age; dividend and capital gains
 * tax on an unwrapped pot, which is why an unwrapped holding is not one of the two pots; the triple
 * lock and any other uprating (convention 6 keeps everything real); care costs, and death before the
 * target age — which is the one modelling omission that makes every probability here *pessimistic*.
 *
 * The module imports from `auto-invest.js`, `enums.js`, `fire.js`, `forecast.js`, `tax.js`,
 * `defined-benefit.js`, `state-pension.js`, `retirement-income.js` and `pension-relief.js`, and
 * nothing goes the other way — the same one-directional shape `retirement-income.js` has with the
 * modules it composes.
 */

import { DEFAULT_GROWTH_RATE, netAnnualGrowthRate } from './auto-invest.js';
import { definedBenefitTotals } from './defined-benefit.js';
import { ISA_WRAPPERS } from './enums.js';
import { monthlyEquivalentContribution, realGrowthRate } from './fire.js';
import { currentCalendarMonth, positionFromEntries } from './forecast.js';
import { ownContribution } from './pension-relief.js';
import { PENSION_TAX_FREE_SHARE, definedContributionPots, isaPot } from './retirement-income.js';
import { statePensionOutlook } from './state-pension.js';
import {
	ALLOWANCE_EXHAUSTED_AT,
	ALLOWANCE_TAPER_DIVISOR,
	ALLOWANCE_TAPER_THRESHOLD,
	DEFAULT_TAX_REGION,
	bandsFor,
	normaliseTaxRegion,
	personalAllowance
} from './tax.js';

/*
 * As in `fire.js`/`retirement-income.js`, model types are referenced inline as
 * `import('./types.js').X` rather than re-declared as local `@typedef`s, because `index.js`
 * re-exports every module with `export *` and svelte-check reads two same-named top-level typedefs
 * as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** README.md's own figure: "5,000 simulated market paths". */
export const DEFAULT_SIMULATION_PATHS = 5000;

/**
 * Fewest and most paths a run will use. One path is a legitimate request (it is how you look at a
 * single history), and the ceiling is four times the spec's own count — enough headroom for anyone
 * who wants a tighter estimate, low enough that a hand-edited number cannot lock the tab up. The
 * standard error of a probability estimated from `n` paths is at most `0.5/√n`, so 5,000 paths pin
 * the headline figure to about ±0.7 percentage points and 20,000 to about ±0.35.
 */
export const MIN_SIMULATION_PATHS = 1;
export const MAX_SIMULATION_PATHS = 20_000;

/**
 * Default annual volatility (%) — the standard deviation of annual *simple* returns. Roughly what a
 * global developed-market equity index has delivered in sterling over the long run; a portfolio with
 * bonds or cash in it is lower, and this is a slider assumption rather than a measurement of anyone's
 * actual holdings.
 */
export const DEFAULT_VOLATILITY = 15;

/**
 * A volatility of zero is a legitimate request — it collapses every path onto the deterministic
 * projection, which is the honest way to check this module against `forecast.js`. The ceiling matches
 * the -100…100 band every other rate in the app lives in.
 */
export const MIN_VOLATILITY = 0;
export const MAX_VOLATILITY = 100;

/**
 * How the caller's growth rate is to be read — convention (4). `'compound'` means "the median path
 * grows at this rate", which is what `Profile.growth_rate` means everywhere else in this app;
 * `'arithmetic'` means "the mean annual return is this rate", which is how a published expected
 * return is usually quoted.
 *
 * @typedef {'compound' | 'arithmetic'} ReturnBasis
 */

/** @type {readonly ReturnBasis[]} */
export const RETURN_BASES = Object.freeze(['compound', 'arithmetic']);

/** @type {Record<ReturnBasis, string>} */
export const RETURN_BASIS_LABELS = Object.freeze({
	compound: 'Compound (median) return',
	arithmetic: 'Arithmetic mean return'
});

export const DEFAULT_RETURN_BASIS = 'compound';

/**
 * Which pot is drawn down first.
 *
 * @typedef {'pension_first' | 'isa_first' | 'proportional'} WithdrawalOrder
 */

/** @type {readonly WithdrawalOrder[]} */
export const WITHDRAWAL_ORDERS = Object.freeze(['pension_first', 'isa_first', 'proportional']);

/** @type {Record<WithdrawalOrder, string>} */
export const WITHDRAWAL_ORDER_LABELS = Object.freeze({
	pension_first: 'Pension pot first',
	isa_first: 'ISA first',
	proportional: 'Both together, in proportion'
});

/**
 * Pension first, by default. Two reasons, and the second is this app's own: a pension pot is the pot
 * whose withdrawals carry a tax-free quarter worth using while there is a personal allowance to use
 * it against, and from April 2027 an unused pension pot counts towards the estate for Inheritance Tax
 * (README.md → "Estate & IHT Calculator", the April 2027 toggle) while an ISA already does — so
 * spending the pension and leaving the ISA is the order this app's own estate assumptions imply.
 * It is a default, not advice; the other two orders exist because the right answer depends on facts
 * this module has no view of.
 */
export const DEFAULT_WITHDRAWAL_ORDER = 'pension_first';

/** The age a plan is asked to last to when the caller names none — README.md names no figure. */
export const DEFAULT_TARGET_AGE = 95;

/** Ages are whole years in the same 0…120 range `model.js` validates `retirement_age` against. */
export const MIN_AGE = 0;
export const MAX_AGE = 120;

/**
 * Longest run this module will simulate, in years. Matches `forecast.js`'s and `fire.js`'s own
 * 1,200-month cap: beyond a century the numbers are noise, and an unbounded horizon multiplied by
 * 5,000 paths would build something big enough to lock the tab up. Longer requests are clamped.
 */
export const MAX_SIMULATION_YEARS = 100;

/** Full annual series kept for illustration — enough to draw a few example histories under the fan. */
export const DEFAULT_SAMPLE_PATHS = 5;
export const MAX_SAMPLE_PATHS = 50;

/** The percentiles the fan chart bands are built from. */
export const MONTE_CARLO_PERCENTILES = Object.freeze([5, 10, 25, 50, 75, 90, 95]);

/**
 * The seed used when a caller names none. Any constant would do; what matters is that it *is* a
 * constant, so two runs of the same plan agree — convention (11).
 */
export const DEFAULT_SEED = 202_627;

/**
 * How far a year's net income may fall short of the target before the year counts as a failure (£).
 *
 * A year's plan is paid in twelve instalments and every pot value is rounded to whole pence each
 * month, so an exactly-funded year can land a few pence under its target for arithmetic reasons
 * alone. A pound is comfortably above that noise and far below any shortfall a retiree would notice,
 * which keeps the headline probability from being decided by rounding.
 */
export const SHORTFALL_TOLERANCE = 1;

/** The lowest return level the parameterisation will work from — see {@link logNormalParameters}. */
const MIN_RETURN_LEVEL = 1e-6;

/** Rates are whole-number percents; `validateAppData` accepts -100…100, so match it. */
const MIN_RATE_PCT = -100;
const MAX_RATE_PCT = 100;

/** Newton steps {@link grossWithdrawalForNet} takes before falling back to bisection. */
const MAX_NEWTON_STEPS = 12;

/** Bisection steps the fallback takes — 48 halvings of the initial bracket is far below a penny. */
const MAX_BISECTION_STEPS = 48;

/** Half a penny: the point at which a gross-up is solved. */
const SOLVER_TOLERANCE = 0.005;

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asFinite(value, fallback) {
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

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function clampRate(value, fallback = 0) {
	return clamp(asFinite(value, fallback), MIN_RATE_PCT, MAX_RATE_PCT);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number} A whole age inside {@link MIN_AGE}…{@link MAX_AGE}.
 */
function asAge(value, fallback) {
	return clamp(Math.round(asFinite(value, fallback)), MIN_AGE, MAX_AGE);
}

/**
 * @param {unknown} value
 * @returns {any[]}
 */
function asList(value) {
	return Array.isArray(value) ? [...value] : [];
}

/* -------------------------------------------------------------------------- */
/* Randomness                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A seeded uniform generator — mulberry32, which is 32 bits of state, four integer operations per
 * draw, and no dependency. Chosen because it is deterministic and reproducible from a single integer
 * seed (convention 11), passes the small-scale randomness batteries, and has a period of 2³² — a
 * default run draws about 2.4 million numbers, four thousand times less. It is emphatically *not*
 * cryptographic, which nothing here needs.
 *
 * @param {number} [seed] Any integer; the low 32 bits are what count.
 * @returns {() => number} Uniform draws in `[0, 1)`.
 */
export function createRandomSource(seed = DEFAULT_SEED) {
	let state = asFinite(seed, DEFAULT_SEED) >>> 0 || 1;

	return function uniform() {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/**
 * A seeded standard normal generator — Box–Muller over {@link createRandomSource}, which turns two
 * uniforms into two independent `Normal(0, 1)` draws and hands the second one out on the next call
 * rather than throwing it away.
 *
 * The first uniform is taken as `1 - u` so it lands in `(0, 1]` rather than `[0, 1)`: `log(0)` is
 * `-Infinity`, and a single zero draw would otherwise poison a whole path.
 *
 * @param {number} [seed]
 * @returns {() => number} Standard normal draws.
 */
export function createNormalSource(seed = DEFAULT_SEED) {
	const uniform = createRandomSource(seed);
	/** @type {number | null} */
	let spare = null;

	return function normal() {
		if (spare !== null) {
			const value = spare;
			spare = null;
			return value;
		}

		const radius = Math.sqrt(-2 * Math.log(1 - uniform()));
		const angle = 2 * Math.PI * uniform();
		spare = radius * Math.sin(angle);
		return radius * Math.cos(angle);
	};
}

/* -------------------------------------------------------------------------- */
/* The return distribution                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The log-normal return distribution a simulation draws from — convention (2), (3) and (6).
 *
 * @typedef {object} LogNormalParameters
 * @property {ReturnBasis} basis How `growthRate` was read.
 * @property {number} statedRate The annual growth assumption as given (%).
 * @property {number} feeRate Annual fund fee taken off it (%).
 * @property {number} inflationRate Annual inflation deflated out of it (%).
 * @property {number} volatility Annual volatility as given (%) — the standard deviation of simple
 *   annual returns.
 * @property {number} nominalRate The growth assumption net of fees, before inflation (%).
 * @property {number} realRate The same net of inflation (%) — `fire.js`'s own {@link realGrowthRate},
 *   and under the `'compound'` basis exactly the median annual return below.
 * @property {number} mu Mean of the annual log return, in real terms (`m` above).
 * @property {number} sigma Standard deviation of the annual log return (`s` above).
 * @property {number} monthlyMu `mu / 12` — convention (3).
 * @property {number} monthlySigma `sigma / √12` — convention (3).
 * @property {number} medianAnnualReturn `exp(mu) - 1`, as a percent — the middle path's rate.
 * @property {number} meanAnnualReturn `exp(mu + sigma²/2) - 1`, as a percent.
 * @property {number} volatilityDrag `meanAnnualReturn - medianAnnualReturn` (percentage points) —
 *   what dispersion costs the typical outcome relative to the average one.
 * @property {number} impliedVolatility The standard deviation of simple annual returns implied by
 *   `mu` and `sigma` (%), computed back out of them rather than copied from the input. Equals
 *   `volatility` deflated for inflation, which is what proves the moment matching.
 */

/**
 * Turn a growth assumption and a volatility into the log-normal parameters a path is drawn from.
 *
 * The order of operations is deliberate and documented in convention (6): the fund fee comes off the
 * growth rate first (compounding against it, `auto-invest.js`'s {@link netAnnualGrowthRate}), the
 * moment matching in convention (2) is then done in *nominal* terms, and inflation is deflated out
 * last by subtracting `ln(1 + i)` from the drift. Deflating by a deterministic inflation rate scales
 * every simple return by the same constant, so it moves the mean and leaves the log volatility
 * exactly where it was — doing it in this order is what keeps `sigma` the number the caller stated.
 *
 * @param {object} [input]
 * @param {number} [input.growthRate] Annual growth (%), read per `basis`.
 * @param {number} [input.volatility] Annual volatility (%) — standard deviation of simple returns.
 * @param {number} [input.inflationRate] Annual inflation (%). `0` works in nominal terms.
 * @param {number} [input.feeRate] Annual fund fee / OCF (%).
 * @param {ReturnBasis} [input.basis]
 * @returns {LogNormalParameters}
 */
export function logNormalParameters(input = {}) {
	const basis = /** @type {ReturnBasis} */ (
		RETURN_BASES.includes(/** @type {ReturnBasis} */ (input.basis))
			? input.basis
			: DEFAULT_RETURN_BASIS
	);
	const statedRate = clampRate(input.growthRate, DEFAULT_GROWTH_RATE);
	const feeRate = clamp(asFinite(input.feeRate, 0), 0, 100);
	const inflationRate = clampRate(input.inflationRate, 0);
	const volatility = clamp(
		asFinite(input.volatility, DEFAULT_VOLATILITY),
		MIN_VOLATILITY,
		MAX_VOLATILITY
	);

	const nominalRate = netAnnualGrowthRate(statedRate, feeRate);
	// A total loss has no log-normal parameterisation (`ln(0)`), so the level is floored rather than
	// allowed to produce `-Infinity` drift and `NaN` pots.
	const level = Math.max(MIN_RETURN_LEVEL, 1 + nominalRate / 100);
	const spread = volatility / 100;
	const k = (spread / level) ** 2;

	let variance;
	let nominalMu;
	if (basis === 'arithmetic') {
		// `level` is E[1 + R]: s² = ln(1 + σ²/L²), m = ln(L) − s²/2.
		variance = Math.log1p(k);
		nominalMu = Math.log(level) - variance / 2;
	} else {
		// `level` is the *median* 1 + R, so m = ln(L) directly and the variance solves
		// `u² − u = k` with `u = exp(s²)` — the positive root of a quadratic, in closed form.
		const u = (1 + Math.sqrt(1 + 4 * k)) / 2;
		variance = Math.log(u);
		nominalMu = Math.log(level);
	}

	const deflator = Math.max(MIN_RETURN_LEVEL, 1 + inflationRate / 100);
	const mu = nominalMu - Math.log(deflator);
	const sigma = Math.sqrt(Math.max(0, variance));

	const median = Math.exp(mu);
	const mean = Math.exp(mu + variance / 2);
	const impliedVolatility = mean * Math.sqrt(Math.max(0, Math.exp(variance) - 1));

	return {
		basis,
		statedRate,
		feeRate,
		inflationRate,
		volatility,
		nominalRate,
		realRate: realGrowthRate(nominalRate, inflationRate),
		mu,
		sigma,
		monthlyMu: mu / 12,
		monthlySigma: sigma / Math.sqrt(12),
		medianAnnualReturn: (median - 1) * 100,
		meanAnnualReturn: (mean - 1) * 100,
		volatilityDrag: (mean - median) * 100,
		impliedVolatility: impliedVolatility * 100
	};
}

/**
 * One month's gross return factor from one standard normal draw: `exp(mu/12 + (sigma/√12)·z)`.
 * `1.004` is a month up 0.4%; `0.9` is a month down 10%. Always positive — convention (2).
 *
 * @param {LogNormalParameters} distribution
 * @param {number} z A standard normal draw.
 * @returns {number}
 */
export function monthlyReturnFactor(distribution, z) {
	return Math.exp(distribution.monthlyMu + distribution.monthlySigma * z);
}

/**
 * A whole path's worth of monthly factors — the sequence whose *order* convention (1) is about.
 *
 * Exported separately from the walk itself so a caller can hold one path's returns still and vary
 * what happens to them: reordering this array leaves the set of returns and their average untouched
 * and changes the outcome of any plan with money moving in or out, which is sequence-of-returns risk
 * in one line.
 *
 * @param {LogNormalParameters} distribution
 * @param {number} months
 * @param {() => number} nextNormal
 * @returns {number[]}
 */
export function monthlyReturnFactors(distribution, months, nextNormal) {
	const count = Math.max(0, Math.trunc(asFinite(months, 0)));
	/** @type {number[]} */
	const factors = new Array(count);
	for (let index = 0; index < count; index += 1) {
		factors[index] = monthlyReturnFactor(distribution, nextNormal());
	}
	return factors;
}

/**
 * A drawn path expressed as `forecast.js`'s own per-month override — convention (5).
 *
 * `projectScenario(position, { adjustMonth: forecastAdjustmentFromFactors(factors) })` walks a
 * recorded position forward along a simulated path using the forecast module's own arithmetic, which
 * is how the claim "a Monte Carlo month is a forecast month with a drawn factor" is checked rather
 * than assumed. Months past the end of `factors` project normally, so a short array is a partial
 * override rather than an error.
 *
 * @param {readonly number[]} factors One per month, oldest first.
 * @returns {(offset: number) => import('./forecast.js').ForecastMonthAdjustment | null}
 */
export function forecastAdjustmentFromFactors(factors) {
	return (offset) => {
		const factor = factors[offset - 1];
		return typeof factor === 'number' ? { factor } : null;
	};
}

/* -------------------------------------------------------------------------- */
/* Tax on a retirement year                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `tax.js`'s own {@link import('./tax.js').incomeTax}, computed without building the band ladder.
 *
 * The simulator asks this question millions of times — every retirement year of every path, plus
 * several times inside each gross-up solve — and `sliceIntoBands` allocates an object per band per
 * call. The arithmetic here is the same arithmetic in the same order, rounding included (each band's
 * tax to whole pence, then the total), and `monte-carlo.test.js` holds it against `tax.js`'s own
 * answer across a sweep of incomes in both regions so the two cannot drift apart.
 *
 * @param {number} [income] Adjusted net income (£/yr).
 * @param {unknown} [region]
 * @returns {number} Income tax (£/yr).
 */
export function taxOnEarnedIncome(income = 0, region = DEFAULT_TAX_REGION) {
	return earnedTax(income, bandsFor(region));
}

/**
 * @param {number} income
 * @param {readonly { from: number, to: number | null, rate: number }[]} bands
 * @returns {number}
 */
function earnedTax(income, bands) {
	const gross = Math.max(0, asFinite(income, 0));
	const taxable = roundMoney(Math.max(0, gross - personalAllowance(gross)));
	if (taxable === 0) return 0;

	let total = 0;
	for (const band of bands) {
		const ceiling = band.to === null ? taxable : Math.min(taxable, band.to);
		const inBand = roundMoney(Math.max(0, ceiling - band.from));
		if (inBand === 0) continue;
		total += roundMoney((inBand * band.rate) / 100);
	}
	return roundMoney(total);
}

/**
 * `tax.js`'s own {@link import('./tax.js').marginalTaxRate}, computed without allocating — the
 * derivative {@link grossWithdrawalForNet}'s Newton step needs, and the same mirror-with-a-parity-test
 * arrangement {@link taxOnEarnedIncome} has.
 *
 * @param {number} [income] (£/yr)
 * @param {unknown} [region]
 * @returns {number} The rate the next pound is taxed at (%), taper included.
 */
export function marginalEarnedRate(income = 0, region = DEFAULT_TAX_REGION) {
	return marginalRate(income, bandsFor(region)) * 100;
}

/**
 * @param {number} income
 * @param {readonly { from: number, to: number | null, rate: number }[]} bands
 * @returns {number} Marginal rate as a decimal fraction.
 */
function marginalRate(income, bands) {
	const gross = Math.max(0, asFinite(income, 0));
	const allowance = personalAllowance(gross);
	if (gross < allowance) return 0;

	const taxable = gross - allowance;
	let rate = bands[bands.length - 1]?.rate ?? 0;
	for (const band of bands) {
		if (taxable >= band.from && (band.to === null || taxable < band.to)) {
			rate = band.rate;
			break;
		}
	}

	// Each tapered pound is taxed twice over — itself, and the 50p of allowance it destroys.
	const tapered = gross >= ALLOWANCE_TAPER_THRESHOLD && gross < ALLOWANCE_EXHAUSTED_AT;
	return (rate * (tapered ? 1 + 1 / ALLOWANCE_TAPER_DIVISOR : 1)) / 100;
}

/**
 * What a gross withdrawal is worth in the hand, given the earned income already being taxed
 * alongside it — convention (8).
 *
 * The withdrawal's own tax is the *extra* tax it causes, `tax(other + taxable) - tax(other)`, not the
 * tax on it in isolation: a £10,000 pension withdrawal on top of a full State Pension is taxed
 * differently from the same withdrawal on its own, and that difference is the whole reason the
 * personal allowance is worth planning around.
 *
 * @param {number} gross Withdrawn from the pot (£/yr).
 * @param {number} otherEarnedIncome Earned income already in the year (£/yr).
 * @param {number} taxFreeShare Share of the withdrawal that is tax-free (%) — 25 for a pension pot
 *   under convention (7), 100 for an ISA.
 * @param {unknown} [region]
 * @returns {number} Net received (£/yr).
 */
export function netFromWithdrawal(
	gross,
	otherEarnedIncome,
	taxFreeShare,
	region = DEFAULT_TAX_REGION
) {
	return netWithdrawal(
		Math.max(0, asFinite(gross, 0)),
		Math.max(0, asFinite(otherEarnedIncome, 0)),
		clamp(asFinite(taxFreeShare, 0), 0, 100),
		bandsFor(region)
	);
}

/**
 * @param {number} gross
 * @param {number} other
 * @param {number} taxFreeShare
 * @param {readonly { from: number, to: number | null, rate: number }[]} bands
 * @returns {number}
 */
function netWithdrawal(gross, other, taxFreeShare, bands) {
	const taxableShare = 1 - taxFreeShare / 100;
	if (taxableShare <= 0) return gross;
	return gross - (earnedTax(other + gross * taxableShare, bands) - earnedTax(other, bands));
}

/**
 * The result of grossing a net income need up through the tax system.
 *
 * @typedef {object} GrossWithdrawal
 * @property {number} gross What has to leave the pot (£/yr).
 * @property {number} net What that actually delivers (£/yr) — short of the need only when the pot
 *   could not cover the gross.
 * @property {number} tax The extra income tax the withdrawal causes (£/yr).
 * @property {number} shortfall Net still not covered (£/yr); `0` when the need is met.
 * @property {boolean} capped Whether `available` bound the answer.
 */

/**
 * The gross withdrawal that nets a wanted income — convention (8).
 *
 * `net(g) = g - (tax(other + τg) - tax(other))` is continuous, piecewise linear and strictly
 * increasing in `g` (its slope is `1 - τ·marginal`, and the steepest UK marginal rate is Scotland's
 * 67.5% taper band, so the slope never falls below about 0.33). That makes it exactly invertible, and
 * Newton's method on a piecewise-linear function lands on the answer in a handful of steps —
 * with a bisection fallback for the case where a step straddles a band boundary and oscillates,
 * because a solver that *usually* converges is not a solver.
 *
 * @param {object} [input]
 * @param {number} [input.netNeeded] Income wanted in the hand (£/yr).
 * @param {number} [input.otherEarnedIncome] Earned income already in the year (£/yr).
 * @param {number} [input.taxFreeShare] Share of the withdrawal that is tax-free (%).
 * @param {number} [input.available] Most the pot can pay (£). Unbounded when omitted.
 * @param {unknown} [input.region]
 * @returns {GrossWithdrawal}
 */
export function grossWithdrawalForNet(input = {}) {
	const bands = bandsFor(normaliseTaxRegion(input.region));
	const need = Math.max(0, asFinite(input.netNeeded, 0));
	const other = Math.max(0, asFinite(input.otherEarnedIncome, 0));
	const taxFreeShare = clamp(asFinite(input.taxFreeShare, 0), 0, 100);
	const available = Math.max(0, asFinite(input.available, Number.POSITIVE_INFINITY));

	const wanted = solveGross(need, other, taxFreeShare, bands);
	const gross = roundMoney(Math.min(wanted, available));
	const net = roundMoney(netWithdrawal(gross, other, taxFreeShare, bands));

	return {
		gross,
		net,
		// The extra tax *is* the gap between gross and net, so a wholly tax-free withdrawal reports
		// zero without needing to be special-cased.
		tax: roundMoney(gross - net),
		shortfall: roundMoney(Math.max(0, need - net)),
		capped: wanted > available
	};
}

/**
 * @param {number} need
 * @param {number} other
 * @param {number} taxFreeShare
 * @param {readonly { from: number, to: number | null, rate: number }[]} bands
 * @returns {number} Gross needed, unrounded and uncapped.
 */
function solveGross(need, other, taxFreeShare, bands) {
	const taxableShare = 1 - taxFreeShare / 100;
	if (need <= 0) return 0;
	// A wholly tax-free withdrawal needs no grossing up at all, which is most of the ISA case and
	// worth short-circuiting rather than solving for.
	if (taxableShare <= 0) return need;

	let gross = need;
	for (let step = 0; step < MAX_NEWTON_STEPS; step += 1) {
		const error = need - netWithdrawal(gross, other, taxFreeShare, bands);
		if (Math.abs(error) <= SOLVER_TOLERANCE) return gross;

		const slope = 1 - taxableShare * marginalRate(other + gross * taxableShare, bands);
		if (!(slope > 0)) break;
		gross = Math.max(need, gross + error / slope);
	}

	// Newton straddled a band boundary. `net(g) ≥ 0.32·g` for every UK ladder, so `need / 0.3` is a
	// safe upper bracket, and 48 halvings of it settle far below a penny.
	let low = need;
	let high = need / 0.3 + 1;
	for (let step = 0; step < MAX_BISECTION_STEPS; step += 1) {
		const middle = (low + high) / 2;
		if (netWithdrawal(middle, other, taxFreeShare, bands) < need) low = middle;
		else high = middle;
	}
	return high;
}

/* -------------------------------------------------------------------------- */
/* Promised income streams                                                     */
/* -------------------------------------------------------------------------- */

/**
 * An income that arrives whether or not the market cooperates — convention (9).
 *
 * @typedef {object} MonteCarloIncomeStream
 * @property {string} id
 * @property {string} label
 * @property {number} annualIncome (£/yr, today's money).
 * @property {number} startAge Age it begins, inclusive.
 * @property {number | null} endAge Age it stops, exclusive; `null` for "for life".
 * @property {'earned_income' | 'tax_free'} taxTreatment How HMRC treats it — the two treatments a
 *   retirement pot's own income already has, so a stream cannot introduce a third by accident.
 */

/**
 * Coerce whatever a caller assembled into a usable {@link MonteCarloIncomeStream}. Never throws.
 *
 * @param {Partial<MonteCarloIncomeStream>} [raw]
 * @returns {MonteCarloIncomeStream}
 */
export function normaliseIncomeStream(raw = {}) {
	const startAge = asAge(raw.startAge, 0);
	const endAge =
		raw.endAge === null || raw.endAge === undefined
			? null
			: Math.max(startAge, asAge(raw.endAge, MAX_AGE));

	return {
		id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : 'income',
		label: typeof raw.label === 'string' && raw.label !== '' ? raw.label : 'Other income',
		annualIncome: roundMoney(Math.max(0, asFinite(raw.annualIncome, 0))),
		startAge,
		endAge,
		taxTreatment: raw.taxTreatment === 'tax_free' ? 'tax_free' : 'earned_income'
	};
}

/**
 * What the promised streams pay at a given age, split by tax treatment.
 *
 * @param {readonly MonteCarloIncomeStream[]} streams
 * @param {number} age
 * @returns {{ earned: number, taxFree: number, total: number, active: MonteCarloIncomeStream[] }}
 */
export function streamIncomeAtAge(streams, age) {
	const active = asList(streams).filter(
		(stream) => age >= stream.startAge && (stream.endAge === null || age < stream.endAge)
	);

	const earned = roundMoney(
		active
			.filter((stream) => stream.taxTreatment === 'earned_income')
			.reduce((total, stream) => total + stream.annualIncome, 0)
	);
	const taxFree = roundMoney(
		active
			.filter((stream) => stream.taxTreatment === 'tax_free')
			.reduce((total, stream) => total + stream.annualIncome, 0)
	);

	return { earned, taxFree, total: roundMoney(earned + taxFree), active };
}

/**
 * The State Pension as a stream — `state-pension.js` owns the arithmetic, the National Insurance
 * record it reads and the age it starts at, and this only reshapes its answer.
 *
 * @param {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @param {Partial<import('./types.js').Profile> | null} [profile]
 * @param {object} [options]
 * @param {Date} [options.now] The clock State Pension age is dated against.
 * @param {number | null} [options.statePensionAge] Override the looked-up age.
 * @returns {MonteCarloIncomeStream}
 */
export function statePensionStream(pensions = [], profile = null, options = {}) {
	const outlook = statePensionOutlook(pensions, profile, options);

	return normaliseIncomeStream({
		id: 'state_pension',
		label: 'State Pension',
		annualIncome: outlook.projection.annualIncome,
		startAge: outlook.timing.statePensionAge,
		taxTreatment: 'earned_income'
	});
}

/**
 * Every Defined Benefit scheme as one stream — `defined-benefit.js` owns the accrual arithmetic.
 *
 * A DB pension's own normal pension age (and the reduction for drawing before it) is not modelled
 * here any more than it is in `retirement-income.js`, so the caller says when it starts; the sensible
 * default is the retirement age the rest of the plan uses.
 *
 * @param {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @param {object} [options]
 * @param {number} [options.startAge]
 * @returns {MonteCarloIncomeStream}
 */
export function definedBenefitStream(pensions = [], options = {}) {
	return normaliseIncomeStream({
		id: 'db',
		label: 'Defined Benefit pension',
		annualIncome: definedBenefitTotals(pensions).annualIncome,
		startAge: asAge(options.startAge, DEFAULT_TARGET_AGE),
		taxTreatment: 'earned_income'
	});
}

/* -------------------------------------------------------------------------- */
/* The plan                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Everything a simulation needs to know.
 *
 * @typedef {object} MonteCarloInput
 * @property {number} paths How many histories to simulate.
 * @property {number} seed Which histories — convention (11).
 * @property {number} currentAge Age today (whole years).
 * @property {number} retirementAge Age contributions stop and drawdown begins.
 * @property {number} targetAge Age the money has to last to — the age the headline probability is
 *   about.
 * @property {number} pensionPot Defined Contribution pot today (£).
 * @property {number} isaPot Tax-free pot today (£) — ISAs, and a Lifetime ISA drawn after 60.
 * @property {number} pensionContribution Paid into the pension pot each month until retirement (£).
 * @property {number} isaContribution Paid into the tax-free pot each month until retirement (£).
 * @property {number} targetIncome Income wanted in retirement, **after tax**, in today's money
 *   (£/yr) — convention (8).
 * @property {number} growthRate Annual growth assumption (%), read per `returnBasis`.
 * @property {number} volatility Annual volatility (%).
 * @property {number} inflationRate Annual inflation (%) deflated out of both — convention (6).
 * @property {number} feeRate Annual fund fee / OCF (%) taken off the growth.
 * @property {ReturnBasis} returnBasis — convention (4).
 * @property {WithdrawalOrder} withdrawalOrder Which pot is spent first.
 * @property {number} pensionTaxFreeShare Share of a pension withdrawal that is tax-free (%) —
 *   `retirement-income.js`'s own 25.
 * @property {import('./enums.js').TaxRegion} taxRegion Which band ladder the earned income meets.
 * @property {readonly MonteCarloIncomeStream[]} streams Promised incomes — convention (9).
 * @property {number} samplePaths Full annual series kept for illustration.
 * @property {{ month: number, year: number }} start The calendar month age 0 of the run sits in, so
 *   a chart can label the fan in calendar years as well as ages.
 */

/** @type {Omit<MonteCarloInput, 'start'>} */
export const DEFAULT_MONTE_CARLO_INPUT = Object.freeze({
	paths: DEFAULT_SIMULATION_PATHS,
	seed: DEFAULT_SEED,
	// Arbitrary, and only ever used by a caller that gave no date of birth — `model.js` stores
	// `dob_year` as nullable, so "no age recorded" is a normal state rather than an error.
	currentAge: 40,
	retirementAge: 67,
	targetAge: DEFAULT_TARGET_AGE,
	pensionPot: 0,
	isaPot: 0,
	pensionContribution: 0,
	isaContribution: 0,
	targetIncome: 0,
	growthRate: DEFAULT_GROWTH_RATE,
	volatility: DEFAULT_VOLATILITY,
	// 0, not `Profile.inflation_rate`'s 2.5, for `fire.js`'s own reason: a caller that says nothing
	// about inflation is telling us the rate it gave is the one it wants used.
	inflationRate: 0,
	feeRate: 0,
	returnBasis: DEFAULT_RETURN_BASIS,
	withdrawalOrder: DEFAULT_WITHDRAWAL_ORDER,
	pensionTaxFreeShare: PENSION_TAX_FREE_SHARE,
	taxRegion: DEFAULT_TAX_REGION,
	streams: Object.freeze([]),
	samplePaths: DEFAULT_SAMPLE_PATHS
});

/**
 * What a caller may hand in: any subset of {@link MonteCarloInput}, with streams allowed to be
 * half-filled — a control that knows an amount and a start age should not have to spell out a tax
 * treatment and an end age to be understood.
 *
 * @typedef {Partial<Omit<MonteCarloInput, 'streams'>> & { streams?: readonly Partial<MonteCarloIncomeStream>[] }} MonteCarloInputPatch
 */

/**
 * Coerce whatever the controls produced into a usable {@link MonteCarloInput}: money non-negative,
 * rates inside the app's bands, ages whole and ordered, horizon bounded. Never throws — a half-typed
 * form is a normal state, not an error.
 *
 * Ages are ordered rather than validated: a retirement age below today's age means "already
 * retired", and a target age below the retirement age is pulled up to it, so a slider dragged past
 * another slider produces a shorter run rather than a negative one.
 *
 * @param {MonteCarloInputPatch} [raw]
 * @returns {MonteCarloInput}
 */
export function normaliseMonteCarloInput(raw = {}) {
	const source = { ...DEFAULT_MONTE_CARLO_INPUT, ...raw };

	const currentAge = asAge(source.currentAge, DEFAULT_MONTE_CARLO_INPUT.currentAge);
	const retirementAge = Math.max(
		currentAge,
		asAge(source.retirementAge, DEFAULT_MONTE_CARLO_INPUT.retirementAge)
	);
	const targetAge = clamp(
		Math.max(retirementAge, asAge(source.targetAge, DEFAULT_TARGET_AGE)),
		currentAge,
		currentAge + MAX_SIMULATION_YEARS
	);

	return {
		paths: clamp(
			Math.trunc(asFinite(source.paths, DEFAULT_SIMULATION_PATHS)),
			MIN_SIMULATION_PATHS,
			MAX_SIMULATION_PATHS
		),
		seed: Math.trunc(asFinite(source.seed, DEFAULT_SEED)),
		currentAge,
		retirementAge,
		targetAge,
		pensionPot: Math.max(0, asFinite(source.pensionPot, 0)),
		isaPot: Math.max(0, asFinite(source.isaPot, 0)),
		pensionContribution: Math.max(0, asFinite(source.pensionContribution, 0)),
		isaContribution: Math.max(0, asFinite(source.isaContribution, 0)),
		targetIncome: Math.max(0, asFinite(source.targetIncome, 0)),
		growthRate: clampRate(source.growthRate, DEFAULT_GROWTH_RATE),
		volatility: clamp(
			asFinite(source.volatility, DEFAULT_VOLATILITY),
			MIN_VOLATILITY,
			MAX_VOLATILITY
		),
		inflationRate: clampRate(source.inflationRate, 0),
		feeRate: clamp(asFinite(source.feeRate, 0), 0, 100),
		returnBasis: /** @type {ReturnBasis} */ (
			RETURN_BASES.includes(/** @type {ReturnBasis} */ (source.returnBasis))
				? source.returnBasis
				: DEFAULT_RETURN_BASIS
		),
		withdrawalOrder: /** @type {WithdrawalOrder} */ (
			WITHDRAWAL_ORDERS.includes(/** @type {WithdrawalOrder} */ (source.withdrawalOrder))
				? source.withdrawalOrder
				: DEFAULT_WITHDRAWAL_ORDER
		),
		pensionTaxFreeShare: clamp(
			asFinite(source.pensionTaxFreeShare, PENSION_TAX_FREE_SHARE),
			0,
			100
		),
		taxRegion: /** @type {import('./enums.js').TaxRegion} */ (normaliseTaxRegion(source.taxRegion)),
		streams: asList(source.streams).map(normaliseIncomeStream),
		samplePaths: clamp(
			Math.trunc(asFinite(source.samplePaths, DEFAULT_SAMPLE_PATHS)),
			0,
			MAX_SAMPLE_PATHS
		),
		start: raw.start ?? currentCalendarMonth()
	};
}

/**
 * One year of the plan, as every path sees it. Everything here is deterministic — it depends on the
 * assumptions and the calendar, never on how the market behaved — which is what lets 5,000 paths
 * share one schedule instead of re-deriving it 5,000 times.
 *
 * @typedef {object} MonteCarloYear
 * @property {number} index Years from the start; `0` is the year beginning today.
 * @property {number} age Age during the year.
 * @property {number} calendarYear
 * @property {boolean} retired Whether this year draws income rather than paying it in.
 * @property {number} pensionContribution Into the pension pot each month (£).
 * @property {number} isaContribution Into the tax-free pot each month (£).
 * @property {number} guaranteedEarned Promised income taxed as earned income (£/yr).
 * @property {number} guaranteedTaxFree Promised income no tax is due on (£/yr).
 * @property {number} guaranteedTax Income tax due on `guaranteedEarned` alone (£/yr).
 * @property {number} guaranteedNet What the promised streams put in the hand (£/yr).
 * @property {number} netNeededFromPots What is left for the pots to fund (£/yr) — `0` when the
 *   promised income already covers the target.
 * @property {MonteCarloIncomeStream[]} streams The streams paying this year.
 */

/**
 * A prepared simulation: the normalised assumptions, the distribution drawn from, and the year-by-year
 * schedule every path walks.
 *
 * @typedef {object} MonteCarloPlan
 * @property {MonteCarloInput} input
 * @property {LogNormalParameters} distribution
 * @property {number} years Years simulated — `targetAge - currentAge`.
 * @property {number} retirementYear The index `retired` first becomes true at.
 * @property {MonteCarloYear[]} schedule One per year, oldest first.
 * @property {readonly { from: number, to: number | null, rate: number }[]} bands The tax ladder,
 *   resolved once.
 */

/**
 * Work out everything about a plan that does not depend on the market — convention (11)'s other
 * half: a run is a schedule plus a seed, and both are inspectable before a single path is walked.
 *
 * @param {MonteCarloInputPatch} [raw]
 * @returns {MonteCarloPlan}
 */
export function prepareSimulation(raw = {}) {
	const input = normaliseMonteCarloInput(raw);
	const distribution = logNormalParameters(input);
	const years = Math.max(0, input.targetAge - input.currentAge);
	const retirementYear = Math.max(0, input.retirementAge - input.currentAge);
	const bands = bandsFor(input.taxRegion);

	/** @type {MonteCarloYear[]} */
	const schedule = [];
	for (let index = 0; index < years; index += 1) {
		const age = input.currentAge + index;
		const retired = index >= retirementYear;
		// Promised income is only counted once drawdown starts: a stream arriving while its owner is
		// still working is spending money, not retirement funding, and counting it would credit the
		// pot with an income nobody was living off — see convention (9).
		const promised = retired
			? streamIncomeAtAge(input.streams, age)
			: { earned: 0, taxFree: 0, total: 0, active: [] };
		const guaranteedTax = earnedTax(promised.earned, bands);
		const guaranteedNet = roundMoney(promised.earned - guaranteedTax + promised.taxFree);

		schedule.push({
			index,
			age,
			calendarYear: input.start.year + index,
			retired,
			pensionContribution: retired ? 0 : input.pensionContribution,
			isaContribution: retired ? 0 : input.isaContribution,
			guaranteedEarned: promised.earned,
			guaranteedTaxFree: promised.taxFree,
			guaranteedTax,
			guaranteedNet,
			netNeededFromPots: retired ? roundMoney(Math.max(0, input.targetIncome - guaranteedNet)) : 0,
			streams: promised.active
		});
	}

	return { input, distribution, years, retirementYear, schedule, bands };
}

/* -------------------------------------------------------------------------- */
/* One path                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The pots, in the order a withdrawal touches them.
 *
 * `proportional` draws from both at once rather than in an order, so this is only its *residual*
 * order — the one a year-end true-up follows once one pot has been emptied, by which point there is
 * nothing proportional left to split.
 *
 * @param {WithdrawalOrder} withdrawalOrder
 * @returns {readonly ('pension' | 'isa')[]}
 */
function withdrawalPotOrder(withdrawalOrder) {
	return withdrawalOrder === 'isa_first' ? ['isa', 'pension'] : ['pension', 'isa'];
}

/**
 * The gross withdrawal each pot is asked for over one retirement year.
 *
 * @typedef {object} YearWithdrawalPlan
 * @property {number} pension (£/yr)
 * @property {number} isa (£/yr)
 * @property {number} shortfall Net income neither pot could fund (£/yr).
 */

/**
 * Decide the year's withdrawals from the balances standing at its start — convention (8).
 *
 * Pots are drawn in {@link MonteCarloInput.withdrawalOrder}, each one grossed up against the earned
 * income already committed that year (the promised streams, plus whatever an earlier pot in the order
 * has already added), so the tax on the second pot's withdrawal knows about the first's. A pot that
 * cannot cover what it was asked for hands the rest of the need to the next one, and whatever is
 * still unmet at the end is the year's shortfall.
 *
 * `proportional` is one solve rather than two: drawing `G` split by balance weights makes the taxable
 * fraction of `G` a constant, so the blended tax-free share is exact rather than an approximation.
 *
 * @param {MonteCarloPlan} plan
 * @param {MonteCarloYear} year
 * @param {number} pension Pension pot at the year start (£).
 * @param {number} isa Tax-free pot at the year start (£).
 * @returns {YearWithdrawalPlan}
 */
export function planYearWithdrawals(plan, year, pension, isa) {
	const { withdrawalOrder, pensionTaxFreeShare } = plan.input;
	const bands = plan.bands;
	let remaining = year.netNeededFromPots;
	let other = year.guaranteedEarned;

	/** @type {YearWithdrawalPlan} */
	const result = { pension: 0, isa: 0, shortfall: 0 };
	if (remaining <= SOLVER_TOLERANCE) return result;

	if (withdrawalOrder === 'proportional') {
		const total = Math.max(0, pension) + Math.max(0, isa);
		if (total > 0) {
			const pensionWeight = Math.max(0, pension) / total;
			const blendedShare = 100 - (100 - pensionTaxFreeShare) * pensionWeight;
			const gross = Math.min(solveGross(remaining, other, blendedShare, bands), total);
			result.pension = roundMoney(gross * pensionWeight);
			result.isa = roundMoney(gross - result.pension);
			const delivered =
				netWithdrawal(result.pension, other, pensionTaxFreeShare, bands) + result.isa;
			remaining = roundMoney(remaining - delivered);
		}
		result.shortfall = roundMoney(Math.max(0, remaining));
		return result;
	}

	for (const pot of withdrawalPotOrder(withdrawalOrder)) {
		if (remaining <= SOLVER_TOLERANCE) break;

		const available = Math.max(0, pot === 'pension' ? pension : isa);
		if (available <= 0) continue;

		const share = pot === 'pension' ? pensionTaxFreeShare : 100;
		const gross = roundMoney(Math.min(solveGross(remaining, other, share, bands), available));
		const delivered = netWithdrawal(gross, other, share, bands);

		if (pot === 'pension') result.pension = gross;
		else result.isa = gross;

		remaining = roundMoney(remaining - delivered);
		other = roundMoney(other + gross * (1 - share / 100));
	}

	result.shortfall = roundMoney(Math.max(0, remaining));
	return result;
}

/**
 * One simulated retirement.
 *
 * @typedef {object} MonteCarloPathResult
 * @property {boolean} success Whether every retirement year funded the full target income — the
 *   thing the headline probability counts, per convention (10).
 * @property {number | null} firstShortfallAge The age of the first year that did not, or `null`.
 * @property {number} shortfallYears How many years fell short.
 * @property {number} totalShortfall Net income never funded, added up over the run (£).
 * @property {number} terminalValue Both pots at the target age (£).
 * @property {number | null} depletedAge The age both pots first hit zero, or `null` if they never
 *   did. Kept separate from `firstShortfallAge` on purpose: a pot can empty in the final year having
 *   funded everything asked of it, and a plan can fall short years before the pot is empty.
 * @property {number[]} values Total pot at each year end, `years + 1` long — index 0 is today.
 */

/**
 * Walk one path: draw a monthly return, grow both pots by it, then pay the month's cash flow —
 * conventions (1) and (5).
 *
 * Contributions land at the month end during accumulation. In retirement the year's plan
 * ({@link planYearWithdrawals}) is decided once from the opening balances and paid in twelve
 * instalments, and then two things stop the annual planning from inventing failures the plan did not
 * actually have:
 *
 * - A month whose pot cannot cover its instalment pays what it can and **carries the rest forward**
 *   into later months of the same year, so a pot that dipped in March and recovered by June still
 *   delivers the year.
 * - What is still missing at the year end is **trued up out of whatever the other pots still hold**,
 *   in the same withdrawal order and grossed up against the income already taxed that year. Without
 *   this, the year a pension pot empties would be recorded as a shortfall even with an untouched ISA
 *   sitting beside it, because the year's allocation was fixed before the market moved.
 *
 * The year's tax is then computed on what actually came out. A year is a shortfall when the net
 * income it delivered — promised streams and pot withdrawals together, tax off, one shared personal
 * allowance — still misses the target by more than {@link SHORTFALL_TOLERANCE}.
 *
 * @param {MonteCarloPlan} plan
 * @param {() => number} nextNormal Standard normal draws — {@link createNormalSource}.
 * @returns {MonteCarloPathResult}
 */
export function simulatePath(plan, nextNormal) {
	const { input, distribution, bands, years, schedule } = plan;
	const { pensionTaxFreeShare, targetIncome } = input;
	const taxableShare = 1 - pensionTaxFreeShare / 100;
	const order = withdrawalPotOrder(input.withdrawalOrder);

	let pension = roundMoney(input.pensionPot);
	let isa = roundMoney(input.isaPot);

	/** @type {number[]} */
	const values = new Array(years + 1);
	values[0] = roundMoney(pension + isa);

	let success = true;
	/** @type {number | null} */
	let firstShortfallAge = null;
	/** @type {number | null} */
	let depletedAge = null;
	let shortfallYears = 0;
	let totalShortfall = 0;

	for (const year of schedule) {
		const withdrawals = year.retired ? planYearWithdrawals(plan, year, pension, isa) : null;
		const pensionInstalment = withdrawals ? withdrawals.pension / 12 : 0;
		const isaInstalment = withdrawals ? withdrawals.isa / 12 : 0;
		let drawnPension = 0;
		let drawnIsa = 0;
		// Instalments a pot could not pay when they fell due, carried into later months of the year.
		let owedPension = 0;
		let owedIsa = 0;

		for (let month = 0; month < 12; month += 1) {
			const factor = monthlyReturnFactor(distribution, nextNormal());

			if (year.retired) {
				const grownPension = roundMoney(pension * factor);
				owedPension += pensionInstalment;
				const paidPension = Math.min(owedPension, Math.max(0, grownPension));
				pension = roundMoney(grownPension - paidPension);
				owedPension -= paidPension;
				drawnPension += paidPension;

				const grownIsa = roundMoney(isa * factor);
				owedIsa += isaInstalment;
				const paidIsa = Math.min(owedIsa, Math.max(0, grownIsa));
				isa = roundMoney(grownIsa - paidIsa);
				owedIsa -= paidIsa;
				drawnIsa += paidIsa;
			} else {
				pension = roundMoney(pension * factor + year.pensionContribution);
				isa = roundMoney(isa * factor + year.isaContribution);
			}
		}

		if (year.retired) {
			// The year's tax, on what actually came out rather than on what was planned — convention (8).
			let earned = roundMoney(year.guaranteedEarned + drawnPension * taxableShare);
			const taxFree = roundMoney(
				year.guaranteedTaxFree + (drawnPension * pensionTaxFreeShare) / 100 + drawnIsa
			);
			let net = roundMoney(earned - earnedTax(earned, bands) + taxFree);
			let missed = targetIncome - net;

			// Anything the year's fixed allocation could not deliver is trued up out of whatever the
			// other pots still hold, in the same order and grossed up against the income already taxed.
			// The `drawn*` tallies have done their job by here; `earned` and `net` are what the rest of
			// the year's accounting runs on, which is why only those two are carried forward.
			for (const pot of order) {
				if (missed <= SHORTFALL_TOLERANCE) break;
				const available = pot === 'pension' ? pension : isa;
				if (available <= 0) continue;

				const share = pot === 'pension' ? pensionTaxFreeShare : 100;
				const gross = roundMoney(Math.min(solveGross(missed, earned, share, bands), available));
				const delivered = netWithdrawal(gross, earned, share, bands);

				if (pot === 'pension') pension = roundMoney(pension - gross);
				else isa = roundMoney(isa - gross);

				earned = roundMoney(earned + gross * (1 - share / 100));
				net = roundMoney(net + delivered);
				missed = targetIncome - net;
			}

			if (missed > SHORTFALL_TOLERANCE) {
				success = false;
				shortfallYears += 1;
				totalShortfall += missed;
				if (firstShortfallAge === null) firstShortfallAge = year.age;
			}
		}

		// Only ever in drawdown: a plan that starts with nothing and saves towards it has an empty pot
		// today, and reporting that as "depleted at 40" would be a fact about the start, not the end.
		if (depletedAge === null && year.retired && pension + isa <= 0) depletedAge = year.age;
		values[year.index + 1] = roundMoney(pension + isa);
	}

	return {
		success,
		firstShortfallAge,
		shortfallYears,
		totalShortfall: roundMoney(totalShortfall),
		terminalValue: values[years],
		depletedAge,
		values
	};
}

/* -------------------------------------------------------------------------- */
/* Reading a set of paths                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A percentile of an already-sorted sample, by linear interpolation between the two order statistics
 * either side of it (the "type 7" definition, R's and NumPy's default): position `p·(n−1)`, so the
 * 0th and 100th percentiles are the sample's own extremes rather than extrapolations beyond them.
 *
 * @param {ArrayLike<number>} sorted Ascending.
 * @param {number} percentile 0–100.
 * @returns {number}
 */
export function percentileOf(sorted, percentile) {
	const count = sorted.length;
	if (count === 0) return 0;
	if (count === 1) return sorted[0];

	const position = (clamp(asFinite(percentile, 0), 0, 100) / 100) * (count - 1);
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return sorted[lower];
	return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * The distribution of pot values at one moment — one rung of the fan chart.
 *
 * A percentile band is emphatically **not** a path: the pot that is 5th-percentile at 70 is a
 * different simulation from the one that is 5th-percentile at 90, so reading along the p5 line does
 * not describe any retirement anybody had. It describes the *spread* at each age, which is what a fan
 * chart is for — {@link MonteCarloSummary.samplePaths} is what to draw when an actual history is
 * wanted.
 *
 * @typedef {object} MonteCarloBandPoint
 * @property {number} year Years from the start; `0` is today.
 * @property {number} age
 * @property {number} month Calendar month, 1–12.
 * @property {number} calendarYear
 * @property {Record<string, number>} percentiles Keyed `p5`…`p95` — {@link MONTE_CARLO_PERCENTILES}.
 * @property {number} median The p50, named for the callers that only want the middle.
 * @property {number} mean Average pot across every path (£) — above the median, since the
 *   distribution is right-skewed.
 * @property {number} min
 * @property {number} max
 * @property {number} depletedPaths How many paths have nothing left at this point.
 * @property {number} depletedShare That, as a fraction of all paths.
 */

/**
 * The whole answer.
 *
 * @typedef {object} MonteCarloSummary
 * @property {MonteCarloInput} input The normalised assumptions everything below was computed from.
 * @property {LogNormalParameters} distribution What the returns were drawn from.
 * @property {MonteCarloYear[]} schedule The deterministic year-by-year plan every path walked.
 * @property {number} paths Paths actually simulated.
 * @property {number} years Years simulated.
 * @property {number} retirementYear Index of the first retirement year.
 * @property {number} successes Paths that funded every retirement year in full.
 * @property {number} failures The rest.
 * @property {number} successProbability `successes / paths` (0–1) — README.md's "probability of pot
 *   lasting to target age".
 * @property {number} successPercent The same as a percent.
 * @property {number} standardError Standard error of `successProbability`, `√(p(1−p)/n)` — how much
 *   of the headline figure is the plan and how much is the sample size.
 * @property {boolean} guaranteed Whether the promised income streams alone cover the target income in
 *   every retirement year, which makes a 100% success probability a statement about the streams
 *   rather than about the market.
 * @property {{ paths: number, probability: number, earliestAge: number | null, medianFirstAge: number | null, meanFirstAge: number | null, meanYears: number, medianTotal: number }} shortfall
 *   How the failures failed — when they first fell short, for how many years, and by how much.
 * @property {{ mean: number, median: number, percentiles: Record<string, number>, depletedShare: number }} terminal
 *   The pot left at the target age.
 * @property {MonteCarloBandPoint[]} band One point per year, `years + 1` long — the fan chart.
 * @property {{ age: number, year: number, probability: number }[]} survival The share of paths still
 *   funding the target income at each age — the whole curve behind the headline number.
 * @property {{ index: number, success: boolean, firstShortfallAge: number | null, depletedAge: number | null, terminalValue: number, values: number[] }[]} samplePaths
 *   A handful of complete annual series, for drawing actual histories under the fan.
 */

/**
 * Run the simulation — README.md's "5,000 simulated market paths", and this module's entry point.
 *
 * @param {MonteCarloInputPatch} [raw]
 * @param {object} [options]
 * @param {() => number} [options.normalSource] Standard normal draws, injectable so a test can hand
 *   in a known sequence — all zeros walks every path down the median, which is how this module is
 *   checked against `forecast.js`'s deterministic projection.
 * @returns {MonteCarloSummary}
 */
export function simulateRetirement(raw = {}, options = {}) {
	const plan = prepareSimulation(raw);
	const { input, distribution, years, retirementYear, schedule } = plan;
	const nextNormal = options.normalSource ?? createNormalSource(input.seed);
	const paths = input.paths;

	/** @type {MonteCarloPathResult[]} */
	const results = new Array(paths);
	// One column per year, so a percentile is a sort of `paths` numbers rather than a walk over
	// `paths` objects — 5,000 × 56 years is small, but the sort wants them contiguous.
	const columns = Array.from({ length: years + 1 }, () => new Float64Array(paths));

	let successes = 0;
	for (let index = 0; index < paths; index += 1) {
		const result = simulatePath(plan, nextNormal);
		results[index] = result;
		if (result.success) successes += 1;
		for (let year = 0; year <= years; year += 1) columns[year][index] = result.values[year];
	}

	const failures = paths - successes;
	const successProbability = paths === 0 ? 0 : successes / paths;

	/** @type {MonteCarloBandPoint[]} */
	const band = columns.map((column, year) => {
		const sorted = column.slice().sort((a, b) => a - b);
		let total = 0;
		let depleted = 0;
		for (const value of column) {
			total += value;
			if (value <= 0) depleted += 1;
		}

		/** @type {Record<string, number>} */
		const percentiles = {};
		for (const percentile of MONTE_CARLO_PERCENTILES) {
			percentiles[`p${percentile}`] = roundMoney(percentileOf(sorted, percentile));
		}

		return {
			year,
			age: input.currentAge + year,
			month: input.start.month,
			calendarYear: input.start.year + year,
			percentiles,
			median: roundMoney(percentileOf(sorted, 50)),
			mean: paths === 0 ? 0 : roundMoney(total / paths),
			min: roundMoney(sorted[0] ?? 0),
			max: roundMoney(sorted[sorted.length - 1] ?? 0),
			depletedPaths: depleted,
			depletedShare: paths === 0 ? 0 : depleted / paths
		};
	});

	/* --- how the failures failed --------------------------------------------- */

	const firstAges = /** @type {number[]} */ (
		results.map((result) => result.firstShortfallAge).filter((age) => age !== null)
	).sort((a, b) => a - b);
	const totals = results
		.filter((result) => !result.success)
		.map((result) => result.totalShortfall)
		.sort((a, b) => a - b);

	const shortfall = {
		paths: failures,
		probability: paths === 0 ? 0 : failures / paths,
		earliestAge: firstAges[0] ?? null,
		medianFirstAge: firstAges.length === 0 ? null : percentileOf(firstAges, 50),
		meanFirstAge:
			firstAges.length === 0
				? null
				: firstAges.reduce((sum, age) => sum + age, 0) / firstAges.length,
		meanYears:
			failures === 0
				? 0
				: results.reduce((sum, result) => sum + result.shortfallYears, 0) / failures,
		medianTotal: roundMoney(percentileOf(totals, 50))
	};

	/* --- the survival curve --------------------------------------------------- */

	// The share of paths that had not yet fallen short by each age — convention (10). Read straight
	// off each path's first shortfall age, so `probabilityOfLastingTo(summary, targetAge)` and the
	// headline figure are the same number by construction.
	const survival = schedule
		.filter((year) => year.retired)
		.map((year) => ({
			age: year.age,
			year: year.index,
			probability:
				paths === 0
					? 0
					: results.filter(
							(result) => result.firstShortfallAge === null || result.firstShortfallAge > year.age
						).length / paths
		}));

	const terminalColumn = columns[years].slice().sort((a, b) => a - b);
	/** @type {Record<string, number>} */
	const terminalPercentiles = {};
	for (const percentile of MONTE_CARLO_PERCENTILES) {
		terminalPercentiles[`p${percentile}`] = roundMoney(percentileOf(terminalColumn, percentile));
	}

	return {
		input,
		distribution,
		schedule,
		paths,
		years,
		retirementYear,
		successes,
		failures,
		successProbability,
		successPercent: successProbability * 100,
		standardError:
			paths === 0 ? 0 : Math.sqrt((successProbability * (1 - successProbability)) / paths),
		guaranteed: schedule.every((year) => !year.retired || year.netNeededFromPots <= 0),
		shortfall,
		terminal: {
			mean: band[years]?.mean ?? 0,
			median: band[years]?.median ?? 0,
			percentiles: terminalPercentiles,
			depletedShare: band[years]?.depletedShare ?? 0
		},
		band,
		survival,
		samplePaths: results.slice(0, input.samplePaths).map((result, index) => ({
			index,
			success: result.success,
			firstShortfallAge: result.firstShortfallAge,
			depletedAge: result.depletedAge,
			terminalValue: result.terminalValue,
			values: result.values
		}))
	};
}

/**
 * The probability a plan still funds its target income at a given age — the headline statistic read
 * at any age rather than only at the target one, which is what makes "and what about to 90?" a lookup
 * instead of a second run.
 *
 * Ages before drawdown begins return `1`: nothing is being funded yet, so nothing can have failed.
 * Ages past the target return the probability at the target, since the simulation stops there and
 * saying `0` would read as a certainty it never established.
 *
 * @param {MonteCarloSummary} summary
 * @param {number} age
 * @returns {number} 0–1.
 */
export function probabilityOfLastingTo(summary, age) {
	const wanted = asFinite(age, 0);
	if (summary.survival.length === 0) return 1;

	let probability = 1;
	for (const point of summary.survival) {
		if (point.age > wanted) break;
		probability = point.probability;
	}
	return probability;
}

/* -------------------------------------------------------------------------- */
/* Reading a plan off the stored data                                          */
/* -------------------------------------------------------------------------- */

/**
 * ISA wrappers a retirement draws on — every ISA except the Junior ISA, which is a child's money.
 * `retirement-income.js` makes the same exclusion for the same reason; derived from `ISA_WRAPPERS`
 * rather than typed out again.
 *
 * @type {readonly import('./enums.js').Wrapper[]}
 */
const RETIREMENT_ISA_WRAPPERS = Object.freeze(ISA_WRAPPERS.filter((wrapper) => wrapper !== 'jisa'));

/**
 * Build a whole plan out of the stored document — the entry point a tab uses, so the simulator starts
 * from the same position the rest of the app reports.
 *
 * Where the numbers come from, and why:
 *
 * - **The pots** follow `retirement-income.js`'s convention (2) exactly: the Defined Contribution pot
 *   is the Pensions tab's own DC pots, and the tax-free pot is the latest snapshot's ISA holdings
 *   plus any Lifetime ISA recorded as a pension. A SIPP recorded in both places is one pot of money,
 *   and the pension record is the one that counts — so this cannot disagree with the retirement
 *   income card about what is there.
 * - **The pension contribution** is each DC pot's own `contribution_pct` plus `employer_pct` applied
 *   to `profile.gross_salary` — `pension-relief.js`'s own {@link ownContribution} for the member's
 *   half. Basic-rate relief is *not* added on top: `pension-relief.js` owns that question, the answer
 *   depends on whether the scheme is relief-at-source or net-pay, and quietly grossing a
 *   salary-sacrifice contribution up by 25% would overstate the pot for the rest of the run.
 * - **The tax-free contribution** is the monthly-equivalent contribution on the snapshot's ISA
 *   holdings (`fire.js`'s own {@link monthlyEquivalentContribution}, so a quarterly £900 is £300 a
 *   month). Snapshot holdings in a pension wrapper are left out, since their *pot* was left out.
 * - **The streams** are the State Pension at its own State Pension age and the Defined Benefit total
 *   from the retirement age, per convention (9).
 * - **The assumptions** are the profile's: growth rate, inflation, tax region, retirement age and
 *   `retirement_target` as the net income to fund. `overrides` wins over all of it, which is how a
 *   slider works.
 *
 * @param {object} [data] The stored document, or any subset of it.
 * @param {Partial<import('./types.js').Profile>} [data.profile]
 * @param {readonly import('./types.js').MonthlyEntry[]} [data.monthly_entries]
 * @param {readonly Partial<import('./types.js').Pension>[]} [data.pensions]
 * @param {MonteCarloInputPatch} [overrides]
 * @param {object} [options]
 * @param {Date} [options.now] The clock State Pension age is dated against.
 * @param {number | null} [options.statePensionAge] Override the looked-up State Pension age.
 * @returns {MonteCarloInput}
 */
export function monteCarloInputFromAppData(data = {}, overrides = {}, options = {}) {
	const profile = data.profile ?? {};
	const pensions = asList(data.pensions);
	const entries = /** @type {import('./types.js').MonthlyEntry[]} */ (asList(data.monthly_entries));
	const holdings = positionFromEntries(entries)?.investments ?? [];
	const counted = holdings.filter((holding) => !holding.exclude_from_net_worth);

	const salary = Math.max(0, asFinite(profile.gross_salary, 0));
	const dcPots = definedContributionPots(pensions);
	const pensionPot = roundMoney(
		dcPots.reduce((total, pension) => total + Math.max(0, asFinite(pension.value, 0)), 0)
	);
	const pensionContribution = roundMoney(
		dcPots.reduce(
			(total, pension) =>
				total +
				ownContribution(pension, salary) +
				(salary * Math.max(0, asFinite(pension.employer_pct, 0))) / 100,
			0
		) / 12
	);

	const isa = isaPot(counted, pensions);
	const isaContribution = roundMoney(
		counted
			.filter((holding) =>
				RETIREMENT_ISA_WRAPPERS.includes(
					/** @type {import('./enums.js').Wrapper} */ (holding.wrapper)
				)
			)
			.reduce((total, holding) => total + monthlyEquivalentContribution(holding), 0)
	);

	const retirementAge = asAge(profile.retirement_age, DEFAULT_MONTE_CARLO_INPUT.retirementAge);
	const currentAge = currentAgeFromProfile(profile, options.now);

	return normaliseMonteCarloInput({
		currentAge,
		retirementAge,
		pensionPot,
		isaPot: isa.value,
		pensionContribution,
		isaContribution,
		targetIncome: Math.max(0, asFinite(profile.retirement_target, 0)),
		growthRate: clampRate(profile.growth_rate, DEFAULT_GROWTH_RATE),
		inflationRate: clampRate(profile.inflation_rate, 0),
		taxRegion: /** @type {import('./enums.js').TaxRegion} */ (
			normaliseTaxRegion(profile.tax_region)
		),
		streams: [
			statePensionStream(pensions, profile, options),
			definedBenefitStream(pensions, { startAge: retirementAge })
		].filter((stream) => stream.annualIncome > 0),
		...overrides
	});
}

/**
 * Age today from a recorded date of birth, or the default when there is none — `model.js` stores
 * `dob_year` as nullable, so "not recorded" is a normal state.
 *
 * @param {Partial<import('./types.js').Profile>} profile
 * @param {Date} [now]
 * @returns {number}
 */
function currentAgeFromProfile(profile, now) {
	const dobYear = asFinite(profile.dob_year, Number.NaN);
	if (!Number.isFinite(dobYear)) return DEFAULT_MONTE_CARLO_INPUT.currentAge;

	const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
	const month = clock.getMonth() + 1;
	const dobMonth = profile.dob_month ?? null;
	const age = clock.getFullYear() - dobYear - (dobMonth !== null && month < dobMonth ? 1 : 0);
	return asAge(age, DEFAULT_MONTE_CARLO_INPUT.currentAge);
}
