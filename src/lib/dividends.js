/**
 * Dividend income planner — README.md → "Dividend Income Planner": "Per-holding: fund/stock name,
 * wrapper, value, annual yield %, monthly contribution, frequency, strategy (DRIP / income)" and
 * "Building phase (reinvest) vs income phase with age slider" (issue #34's exact scope).
 *
 * `$lib/model.js` already owns the `Dividend` record itself (issue #2's data model); this module
 * is the maths that turns a list of them into a plan. Three things it answers:
 *
 * 1. **What does the portfolio pay today?** {@link dividendPortfolioSummary} — no projection, just
 *    today's value × yield, split by strategy and by wrapper.
 * 2. **What happens between now and the age the user plans to start living off it?**
 *    {@link projectDividendPortfolio} walks the portfolio forward month by month, each holding
 *    compounding under its own `strategy`: a DRIP holding reinvests its dividend back into its own
 *    value; an "income" holding pays its dividend out and only grows from further contributions.
 *    This is the "building phase" — issue #34's own name for it, and the "DRIP compounding
 *    projection" README.md's fuller Dividend Income Planner section asks for.
 * 3. **What income does that portfolio support once the user switches?**
 *    {@link dividendIncomePhase} takes the holdings as they stand at the switch date and asks what
 *    every one of them would pay if it took its dividend as income from that point on, regardless
 *    of the strategy it was recorded with — the "income phase" side of the age slider, and
 *    README.md's "income-taken chart".
 *
 * {@link dividendIncomePlan} wires 2 and 3 together around a single age slider, the same shape
 * `fire.js`'s `fireSummary` gives the FIRE tab's own accumulation/drawdown split around a
 * retirement age slider — building this feature as that pattern's dividend-specific twin is
 * deliberate, not incidental: both answer "what happens before this age, and what does it leave me
 * with after it".
 *
 * **What this deliberately does not model** — left to issue #35 ("UK dividend allowance + GIA tax
 * rates"), a separate, later build in this same milestone: the £500/yr tax-free dividend
 * allowance, the 10.75%/35.75% GIA tax rates, and ISA/SIPP shelter. Every figure here is gross —
 * `dividendPortfolioSummary`'s `sheltered`/`unsheltered` split exists only so #35 has something to
 * key its tax calculation off, not because this module applies any tax itself. Capital growth is
 * also not modelled: a holding's value moves only from its own yield (reinvested or not) and its
 * contribution schedule, never from an assumed price return — `forecast.js` already owns
 * price-growth projection for the net worth dashboard, and folding a second, disagreeing growth
 * assumption into the dividend planner would leave the two tabs telling different stories about
 * the same holding.
 *
 * Everything here is pure: dividends go in, new arrays/objects come out, nothing is mutated.
 */

import { addMonths, monthlyGrowthRate } from './auto-invest.js';
import { currentCalendarMonth } from './forecast.js';
import { TAX_SHELTERED_WRAPPERS } from './enums.js';

/*
 * As elsewhere in `$lib`: types are referenced inline as `import('./types.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *` and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function asMoney(value, fallback = 0) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Longest projection this module will walk — 100 years, generous enough never to bite in practice. */
export const MAX_PROJECTION_MONTHS = 1200;

/* -------------------------------------------------------------------------- */
/* Today's position — no projection                                           */
/* -------------------------------------------------------------------------- */

/**
 * What one holding pays a year at today's value and yield, before any tax (see module doc — tax is
 * issue #35's job, not this function's).
 *
 * @param {Partial<import('./types.js').Dividend> | null} [dividend]
 * @returns {number} (£/yr)
 */
export function annualDividendIncome(dividend) {
	const value = asMoney(dividend?.value);
	const yieldPct = asMoney(dividend?.yield_pct);
	return roundMoney((value * yieldPct) / 100);
}

/**
 * As {@link annualDividendIncome}, per month — a straight twelfth, not a compounded monthly rate,
 * since this is "what today's yield works out to per month", not a projection.
 *
 * @param {Partial<import('./types.js').Dividend> | null} [dividend]
 * @returns {number} (£/mo)
 */
export function monthlyDividendIncome(dividend) {
	return roundMoney(annualDividendIncome(dividend) / 12);
}

/**
 * One strategy or wrapper slice of the portfolio: how many holdings, how much value, how much
 * income.
 *
 * @typedef {object} DividendSlice
 * @property {number} count
 * @property {number} value (£)
 * @property {number} annualIncome (£/yr)
 */

/**
 * @param {readonly import('./types.js').Dividend[]} holdings
 * @returns {DividendSlice}
 */
function slice(holdings) {
	return {
		count: holdings.length,
		value: roundMoney(holdings.reduce((total, d) => total + asMoney(d.value), 0)),
		annualIncome: roundMoney(holdings.reduce((total, d) => total + annualDividendIncome(d), 0))
	};
}

/**
 * The whole `dividends[]` list, today, with no projection.
 *
 * @typedef {object} DividendPortfolioSummary
 * @property {number} count
 * @property {number} totalValue (£)
 * @property {number} totalMonthlyContribution (£/mo), summed across every holding regardless of
 *   strategy.
 * @property {number} weightedYield Value-weighted average yield (%), `0` on an empty or
 *   zero-value portfolio.
 * @property {number} annualIncome Total (£/yr), before tax.
 * @property {number} monthlyIncome Total (£/mo), before tax.
 * @property {DividendSlice} drip Holdings whose dividend is currently reinvested.
 * @property {DividendSlice} income Holdings whose dividend is currently taken as income.
 * @property {DividendSlice} sheltered Holdings in an ISA/SIPP wrapper — outside the scope of the
 *   £500/yr dividend allowance and GIA tax rates (issue #35).
 * @property {DividendSlice} unsheltered Holdings not in a tax-sheltered wrapper — a General
 *   Investment Account, or an unwrapped holding — the slice #35's tax calculation will apply to.
 */

/**
 * @param {readonly Partial<import('./types.js').Dividend>[]} [dividends]
 * @returns {DividendPortfolioSummary}
 */
export function dividendPortfolioSummary(dividends) {
	const list = /** @type {import('./types.js').Dividend[]} */ (
		Array.isArray(dividends) ? dividends : []
	);

	const totalValue = roundMoney(list.reduce((total, d) => total + asMoney(d.value), 0));
	const totalMonthlyContribution = roundMoney(
		list.reduce((total, d) => total + asMoney(d.monthly_contribution), 0)
	);
	const annualIncome = roundMoney(list.reduce((total, d) => total + annualDividendIncome(d), 0));
	const weightedYield =
		totalValue === 0
			? 0
			: roundMoney(
					(list.reduce((total, d) => total + asMoney(d.value) * asMoney(d.yield_pct), 0) /
						totalValue) *
						100
				) / 100;

	return {
		count: list.length,
		totalValue,
		totalMonthlyContribution,
		weightedYield,
		annualIncome,
		monthlyIncome: roundMoney(annualIncome / 12),
		drip: slice(list.filter((d) => d.strategy === 'drip')),
		income: slice(list.filter((d) => d.strategy === 'income')),
		sheltered: slice(list.filter((d) => TAX_SHELTERED_WRAPPERS.includes(d.wrapper))),
		unsheltered: slice(list.filter((d) => !TAX_SHELTERED_WRAPPERS.includes(d.wrapper)))
	};
}

/* -------------------------------------------------------------------------- */
/* Building phase — projecting each holding under its own strategy            */
/* -------------------------------------------------------------------------- */

/**
 * One holding's running state partway through a projection.
 *
 * @typedef {object} DividendHoldingState
 * @property {string} id
 * @property {string} name
 * @property {number} yield_pct Carried through unchanged — the projection assumes a constant yield.
 * @property {import('./enums.js').DividendStrategy} strategy Carried through unchanged: a
 *   holding's strategy does not switch mid-projection — only the age-slider boundary in
 *   {@link dividendIncomePlan} does that, deliberately, all at once.
 * @property {number} value (£) at this point in the projection.
 * @property {number} contributions Cumulative `monthly_contribution` paid in since the anchor (£).
 * @property {number} reinvested Cumulative dividend reinvested since the anchor (£) — `0` unless
 *   `strategy` is `'drip'`.
 * @property {number} incomeTaken Cumulative dividend paid out since the anchor (£) — `0` unless
 *   `strategy` is `'income'`.
 */

/**
 * @param {import('./types.js').Dividend} dividend
 * @returns {DividendHoldingState}
 */
function initialHoldingState(dividend) {
	return {
		id: dividend.id,
		name: dividend.name,
		yield_pct: asMoney(dividend.yield_pct),
		strategy: dividend.strategy,
		value: asMoney(dividend.value),
		contributions: 0,
		reinvested: 0,
		incomeTaken: 0
	};
}

/**
 * Advance every holding by one month: grow each one's value at the monthly equivalent of its own
 * yield (`auto-invest.js`'s `monthlyGrowthRate`, the same geometric conversion the rest of the app
 * uses to turn an annual rate into a monthly one), then either reinvest that amount or record it as
 * income taken, and add the month's contribution either way. `monthly_contribution` is not carried
 * on `DividendHoldingState` itself (only fields that change need to be), so it is re-read from
 * `source` here instead.
 *
 * @param {DividendHoldingState[]} states
 * @param {readonly import('./types.js').Dividend[]} source Original holdings, same order, for the
 *   fields that do not change (`monthly_contribution`).
 * @returns {DividendHoldingState[]}
 */
function stepHoldings(states, source) {
	return states.map((state, index) => {
		const monthlyContribution = asMoney(source[index]?.monthly_contribution);
		const dividendThisMonth = roundMoney(state.value * monthlyGrowthRate(state.yield_pct));

		if (state.strategy === 'drip') {
			return {
				...state,
				value: roundMoney(state.value + dividendThisMonth + monthlyContribution),
				contributions: roundMoney(state.contributions + monthlyContribution),
				reinvested: roundMoney(state.reinvested + dividendThisMonth)
			};
		}

		return {
			...state,
			value: roundMoney(state.value + monthlyContribution),
			contributions: roundMoney(state.contributions + monthlyContribution),
			incomeTaken: roundMoney(state.incomeTaken + dividendThisMonth)
		};
	});
}

/**
 * One month of a portfolio-level projection — the aggregate of every holding's own state, plus the
 * per-holding detail {@link dividendIncomePhase} needs to pick up from where this leaves off.
 *
 * @typedef {object} DividendProjectionPoint
 * @property {number} offset Whole months since the anchor. `0` is the anchor itself.
 * @property {number} month Calendar month, 1–12.
 * @property {number} year Four-digit calendar year.
 * @property {number} value Total portfolio value (£).
 * @property {number} contributions Cumulative contributions since the anchor, every holding (£).
 * @property {number} reinvestedGrowth Cumulative dividend reinvested since the anchor, DRIP
 *   holdings only (£).
 * @property {number} incomeTaken Cumulative dividend paid out since the anchor, income-strategy
 *   holdings only (£).
 * @property {DividendHoldingState[]} holdings Per-holding state at this point.
 */

/**
 * @param {DividendHoldingState[]} holdings
 * @param {number} offset
 * @param {{ month: number, year: number }} calendarMonth
 * @returns {DividendProjectionPoint}
 */
function aggregatePoint(holdings, offset, calendarMonth) {
	return {
		offset,
		month: calendarMonth.month,
		year: calendarMonth.year,
		value: roundMoney(holdings.reduce((total, h) => total + h.value, 0)),
		contributions: roundMoney(holdings.reduce((total, h) => total + h.contributions, 0)),
		reinvestedGrowth: roundMoney(holdings.reduce((total, h) => total + h.reinvested, 0)),
		incomeTaken: roundMoney(holdings.reduce((total, h) => total + h.incomeTaken, 0)),
		holdings
	};
}

/**
 * The building phase: walk `dividends[]` forward month by month, each holding compounding under
 * its own recorded `strategy` — README.md's "DRIP compounding projection".
 *
 * @param {readonly Partial<import('./types.js').Dividend>[]} [dividends]
 * @param {{ months?: number, start?: { month: number, year: number } }} [options]
 * @returns {{ start: { month: number, year: number }, months: number, points: DividendProjectionPoint[] }}
 */
export function projectDividendPortfolio(dividends, options = {}) {
	const list = /** @type {import('./types.js').Dividend[]} */ (
		Array.isArray(dividends) ? dividends : []
	);
	const { start = currentCalendarMonth(), months = 0 } = options;
	const horizon = Math.min(MAX_PROJECTION_MONTHS, Math.max(0, Math.trunc(months)));

	let holdings = list.map(initialHoldingState);
	const points = [aggregatePoint(holdings, 0, start)];

	for (let offset = 1; offset <= horizon; offset += 1) {
		holdings = stepHoldings(holdings, list);
		points.push(aggregatePoint(holdings, offset, addMonths(start, offset)));
	}

	return { start, months: horizon, points };
}

/* -------------------------------------------------------------------------- */
/* Income phase — every holding taking its dividend as income from here on    */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} DividendIncomePoint
 * @property {number} offset Whole months since the switch date. `0` is the switch itself.
 * @property {number} month
 * @property {number} year
 * @property {number} cumulativeIncome Total income drawn since the switch (£).
 */

/**
 * The income phase: every holding handed in takes its own dividend as income from here on,
 * whatever its recorded `strategy` was — README.md's "income phase" side of the age slider.
 * Capital is never drawn down, only the yield, so — per the module doc's "what this does not
 * model" — the portfolio value stays flat for the whole phase and the income drawn never runs out;
 * there is no runway calculation to make here the way `fire.js`'s `portfolioRunway` has to for a
 * pot that is actually being spent down.
 *
 * @param {readonly Pick<DividendHoldingState, 'value' | 'yield_pct'>[]} holdings Holdings as they
 *   stand at the switch date — typically the last point of a {@link projectDividendPortfolio} run.
 * @param {{ months?: number, start?: { month: number, year: number } }} [options]
 * @returns {{
 *   start: { month: number, year: number },
 *   months: number,
 *   annualIncome: number,
 *   monthlyIncome: number,
 *   points: DividendIncomePoint[]
 * }}
 */
export function dividendIncomePhase(holdings, options = {}) {
	const list = Array.isArray(holdings) ? holdings : [];
	const { start = currentCalendarMonth(), months = 0 } = options;
	const horizon = Math.min(MAX_PROJECTION_MONTHS, Math.max(0, Math.trunc(months)));

	const annualIncome = roundMoney(
		list.reduce((total, h) => total + (asMoney(h.value) * asMoney(h.yield_pct)) / 100, 0)
	);
	const monthlyIncome = roundMoney(annualIncome / 12);

	/** @type {DividendIncomePoint[]} */
	const points = [];
	let cumulative = 0;
	for (let offset = 0; offset <= horizon; offset += 1) {
		if (offset > 0) cumulative = roundMoney(cumulative + monthlyIncome);
		const calendarMonth = addMonths(start, offset);
		points.push({
			offset,
			month: calendarMonth.month,
			year: calendarMonth.year,
			cumulativeIncome: cumulative
		});
	}

	return { start, months: horizon, annualIncome, monthlyIncome, points };
}

/* -------------------------------------------------------------------------- */
/* Both phases together, around one age slider                                */
/* -------------------------------------------------------------------------- */

/** Default span shown past the switch date — 30 years, `fire.js`'s own `DEFAULT_DRAWDOWN_MONTHS`. */
export const DEFAULT_INCOME_PHASE_MONTHS = 360;

/**
 * `switchAge` and `currentAge`, converted to a whole number of months from now — clamped at zero so
 * an age already reached (or a switch age typed as lower than the current one) means "switch
 * immediately", the same tolerance `FireCalculator`'s own `alreadyRetired` gives a retirement age
 * that has already passed.
 *
 * @param {number} currentAge
 * @param {number} switchAge
 * @returns {number}
 */
function monthsToSwitch(currentAge, switchAge) {
	if (!Number.isFinite(currentAge) || !Number.isFinite(switchAge)) return 0;
	return Math.max(0, Math.round((switchAge - currentAge) * 12));
}

/**
 * The whole plan: project the portfolio (building phase) from now to `switchAge`, then work out
 * what it would pay if every holding switched to taking its dividend as income from that date
 * (income phase). The single age slider issue #34 asks for.
 *
 * @param {readonly Partial<import('./types.js').Dividend>[]} [dividends]
 * @param {{
 *   currentAge?: number,
 *   switchAge?: number,
 *   incomePhaseMonths?: number,
 *   start?: { month: number, year: number }
 * }} [options]
 * @returns {{
 *   monthsToSwitch: number,
 *   building: ReturnType<typeof projectDividendPortfolio>,
 *   atSwitch: DividendProjectionPoint,
 *   income: ReturnType<typeof dividendIncomePhase>
 * }}
 */
export function dividendIncomePlan(dividends, options = {}) {
	const {
		currentAge = 0,
		switchAge = 0,
		incomePhaseMonths = DEFAULT_INCOME_PHASE_MONTHS,
		start = currentCalendarMonth()
	} = options;

	const switchMonths = monthsToSwitch(currentAge, switchAge);
	const building = projectDividendPortfolio(dividends, { months: switchMonths, start });
	const atSwitch = /** @type {DividendProjectionPoint} */ (building.points.at(-1));
	const income = dividendIncomePhase(atSwitch.holdings, {
		months: incomePhaseMonths,
		start: addMonths(start, switchMonths)
	});

	return { monthsToSwitch: switchMonths, building, atSwitch, income };
}
