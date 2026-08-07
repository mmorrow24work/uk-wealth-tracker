/**
 * Salary sacrifice, and what it is worth against the 60% personal allowance taper — README.md →
 * "UK Income Tax Calculator (2026/27)": "Salary sacrifice" and "60% personal allowance taper
 * (£100k–£125,140)" — issue #27.
 *
 * Salary sacrifice is a contractual reduction in gross pay in exchange for a non-cash benefit,
 * almost always an employer pension contribution. The sacrificed pounds are never the employee's
 * income at all, so the reduced salary — not the original one — is the figure income tax, the
 * personal allowance taper, the High Income Child Benefit Charge and Student Loan repayments are
 * all assessed on. That single fact is the whole feature: `tax.js` already knows what an income
 * owes (#23), and this module works out what *lowering* that income is worth.
 *
 * The taper is why the two halves of this issue belong together. `tax.js` models the taper itself —
 * £1 of allowance lost for every £2 over £100,000, gone at £125,140, a 60% marginal rate in
 * England/Wales/NI and 67.5% in Scotland. What #23 could not do was model the standard response to
 * being in that band, which is to sacrifice your way back out of it: every pound sacrificed between
 * £125,140 and £100,000 costs a higher-rate taxpayer only 40p of take-home pay while putting a
 * whole pound in the pension, because the other 60p was going to HMRC either way. This module makes
 * that arithmetic rather than advice.
 *
 * Four conventions decide what the numbers here mean:
 *
 * 1. **Sacrifice comes off the top of the salary, and is sliced by the marginal rate it displaces.**
 *    A £40,000 sacrifice from £130,000 does not get one relief rate: the first £4,860 comes out of
 *    the 45% additional band, the next £25,140 out of the 60% taper, and the last £9,860 out of the
 *    40% higher band. {@link sacrificeSlices} returns exactly that breakdown, top slice first, and
 *    it sums to the same figure as `tax.js`'s own before-and-after difference.
 * 2. **The relief is income tax only.** National Insurance is not modelled anywhere in this app (it
 *    appears nowhere in README.md's feature list and has no issue in the tax milestone), and salary
 *    sacrifice is precisely the case where that omission bites hardest: the real-world saving also
 *    includes the employee's own NI on the sacrificed pay, and the employer's NI saving, which many
 *    employers pass back into the pot. Every "saved" figure here is therefore an *understatement*
 *    of the true benefit, deliberately and consistently, rather than a guess at the missing part.
 * 3. **The sacrificed amount lands in the pension in full.** There is no tax at entry, and no
 *    further relief to claim through Self Assessment — that is what distinguishes sacrifice from a
 *    relief-at-source personal contribution, where the pot is grossed up by 20% and higher-rate
 *    relief has to be reclaimed separately. So "what the pot gains" is simply the sacrifice, and
 *    the interesting figure is the *cost*: what your take-home actually fell by to put it there.
 * 4. **One income figure goes in: gross salary before any sacrifice.** Everything downstream —
 *    {@link postSacrificeIncome}, and therefore the whole `tax.js` calculation — is derived. This
 *    is the reverse of #23's convention (5), which asked callers to pass an income already net of
 *    sacrifice; that instruction is what this module replaces with arithmetic.
 *
 * Every figure is in pounds, rounded to whole pence, matching `tax.js`. Rates are whole-number
 * percents. Everything is pure. The module imports from `tax.js` and nothing goes the other way —
 * the same one-directional shape `hicbc.js`, `marriage-allowance.js` and `student-loan.js` have.
 */

import {
	ALLOWANCE_EXHAUSTED_AT,
	ALLOWANCE_TAPER_DIVISOR,
	ALLOWANCE_TAPER_THRESHOLD,
	bandsFor,
	incomeTax,
	inAllowanceTaper,
	marginalTaxRate,
	normaliseTaxRegion,
	personalAllowance,
	PERSONAL_ALLOWANCE,
	takeHomeBreakdown
} from './tax.js';

/*
 * As in `tax.js`/`hicbc.js`/`student-loan.js`, model types are referenced inline as
 * `import('./types.js').X` rather than re-declared as local `@typedef`s, because `index.js`
 * re-exports every module with `export *` and svelte-check reads two same-named top-level typedefs
 * as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The tax year                                                                */
/* -------------------------------------------------------------------------- */

/** The tax year every figure in this module belongs to — matches `tax.js`'s `TAX_YEAR`. */
export const SALARY_SACRIFICE_TAX_YEAR = '2026/27';

/**
 * The pension annual allowance (£/yr) — the most that can go into pensions in a year (employee,
 * employer and salary sacrifice combined) before an annual allowance charge claws the relief back.
 *
 * README.md does not state this figure; it is included because a tool that will happily tell you to
 * sacrifice £40,000 should say when that would breach the cap. £60,000 has been the standard
 * allowance since 2023/24 and is not one of the annually-uprated figures, but check it at the start
 * of a tax year like everything else here. What is *not* modelled: the allowance itself tapers down
 * to £10,000 for very high earners (threshold income over £200,000 and adjusted income over
 * £260,000), unused allowance can be carried forward from the previous three years, and a pension
 * already in drawdown is subject to the much smaller money purchase annual allowance instead. So
 * {@link SalarySacrificeBreakdown.overAnnualAllowance} is a prompt to check, not a verdict.
 */
export const PENSION_ANNUAL_ALLOWANCE = 60_000;

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

/** @param {unknown} value @returns {number} A non-negative, finite amount of money. */
function asMoney(value) {
	return Math.max(0, asFinite(value, 0));
}

/* -------------------------------------------------------------------------- */
/* Sacrificing an amount                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The most that can be sacrificed out of a salary. Nobody can give up pay they do not have, so the
 * cap is the salary itself.
 *
 * The *real* cap is lower and this module cannot know it: a sacrifice may not take pay below the
 * National Minimum Wage, and most schemes also refuse to take it below the NI lower earnings limit
 * (which would break the employee's State Pension qualifying year). Neither figure is modelled —
 * see the note on {@link salarySacrificeSummary} — so this clamp is arithmetic sanity, not a legal
 * limit.
 *
 * @param {number} [salary] (£/yr)
 * @param {number} [sacrifice] (£/yr)
 * @returns {number} (£/yr)
 */
export function cappedSacrifice(salary = 0, sacrifice = 0) {
	return roundMoney(Math.min(asMoney(salary), asMoney(sacrifice)));
}

/**
 * What is left of a salary after sacrificing part of it — the figure every other calculation on the
 * tax tab should be run against, per convention (4).
 *
 * @param {number} [salary] (£/yr)
 * @param {number} [sacrifice] (£/yr)
 * @returns {number} (£/yr)
 */
export function postSacrificeIncome(salary = 0, sacrifice = 0) {
	return roundMoney(asMoney(salary) - cappedSacrifice(salary, sacrifice));
}

/**
 * A percentage of salary as an amount (£) — schemes are usually agreed as "10% of pay", not as a
 * number of pounds.
 *
 * @param {number} [salary] (£/yr)
 * @param {number} [percent] (%)
 * @returns {number} (£/yr)
 */
export function sacrificeFromPercent(salary = 0, percent = 0) {
	return roundMoney((asMoney(salary) * asMoney(percent)) / 100);
}

/**
 * An amount as a percentage of salary (%), the inverse of {@link sacrificeFromPercent}. `0` on a
 * salary of nothing, where a percentage is not a meaningful figure.
 *
 * @param {number} [salary] (£/yr)
 * @param {number} [sacrifice] (£/yr)
 * @returns {number} (%)
 */
export function sacrificePercentOfSalary(salary = 0, sacrifice = 0) {
	const gross = asMoney(salary);
	if (gross === 0) return 0;
	return (cappedSacrifice(gross, sacrifice) / gross) * 100;
}

/**
 * How much would have to be sacrificed to bring a salary down to a target income — the shape of
 * every "how do I get under £X" question this tab raises. `0` when the salary is already at or
 * below the target.
 *
 * @param {number} [salary] (£/yr)
 * @param {number} [targetIncome] (£/yr)
 * @returns {number} (£/yr)
 */
export function sacrificeToReach(salary = 0, targetIncome = 0) {
	return roundMoney(Math.max(0, asMoney(salary) - asMoney(targetIncome)));
}

/**
 * How much would have to be sacrificed to escape the 60% band entirely — down to £100,000, where
 * the full personal allowance is restored. `0` for a salary already below the threshold.
 *
 * This is the question the taper actually prompts, and the answer is unusually satisfying: on
 * £125,140 it takes £25,140 of sacrifice, of which £15,084 would have gone in tax anyway, so the
 * real cost of putting £25,140 into a pension is £10,056.
 *
 * @param {number} [salary] (£/yr)
 * @returns {number} (£/yr)
 */
export function sacrificeToClearTaper(salary = 0) {
	return sacrificeToReach(salary, ALLOWANCE_TAPER_THRESHOLD);
}

/* -------------------------------------------------------------------------- */
/* Marginal rate slices                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The *gross* income at which a band starts, given the taxable-income figure `tax.js` stores it as.
 *
 * `tax.js` measures every band boundary on income after allowances (its convention 1), which is
 * right for computing tax but wrong for answering "which pound of my salary does this band start
 * at" — the question a sacrifice, which comes off gross pay, has to answer. Converting back is
 * three cases, because the personal allowance is not constant:
 *
 * - below the taper, the whole £12,570 is available, so gross = taxable + £12,570;
 * - above £125,140 there is no allowance left, so gross = taxable;
 * - inside the taper each extra gross pound only adds £1.50 of taxable income, so the conversion
 *   divides by 1.5 rather than shifting by a constant.
 *
 * The three agree at both joins: £87,430 of taxable income maps to exactly £100,000 of gross by
 * either of the first and third rules, and £125,140 maps to itself by either the second or third.
 *
 * @param {number} [taxableFrom] Band start on taxable income (£).
 * @returns {number} The same boundary as gross income (£).
 */
export function grossIncomeAtBandStart(taxableFrom = 0) {
	const from = asMoney(taxableFrom);
	if (from + PERSONAL_ALLOWANCE <= ALLOWANCE_TAPER_THRESHOLD) return from + PERSONAL_ALLOWANCE;
	if (from >= ALLOWANCE_EXHAUSTED_AT) return from;

	const taperSlope = 1 + 1 / ALLOWANCE_TAPER_DIVISOR;
	return roundMoney(
		(from + PERSONAL_ALLOWANCE + ALLOWANCE_TAPER_THRESHOLD / ALLOWANCE_TAPER_DIVISOR) / taperSlope
	);
}

/**
 * Every gross income at which the marginal rate changes, ascending, starting at `0` — each band's
 * own start plus the two edges of the taper, which is not a band but does change the rate.
 *
 * @param {unknown} [region]
 * @returns {number[]} (£/yr)
 */
export function marginalRateBreakpoints(region) {
	const points = new Set([0, ALLOWANCE_TAPER_THRESHOLD, ALLOWANCE_EXHAUSTED_AT]);
	for (const band of bandsFor(region)) points.add(grossIncomeAtBandStart(band.from));
	return [...points].sort((a, b) => a - b);
}

/**
 * One stretch of gross income over which the marginal rate is a single number.
 *
 * @typedef {object} MarginalRateSlice
 * @property {number} from Gross income the slice starts at (£), inclusive.
 * @property {number} to Gross income the slice ends at (£), exclusive.
 * @property {number} rate Marginal rate over the slice (%), taper included — 60% in the taper band
 *   in England/Wales/NI, 67.5% in Scotland.
 * @property {number} amount Pounds of the sacrifice falling inside this slice (£).
 * @property {number} taxSaved Income tax the sacrifice avoids here (£) — `amount × rate`.
 * @property {number} netCost What the slice actually costs in take-home pay (£) — `amount − taxSaved`.
 */

/**
 * Slice a sacrifice by the marginal rate each pound of it displaces — convention (1). Returned top
 * slice first, because that is the order the money comes off: the last pound earned is the first
 * pound given up, and it is the one relieved at the highest rate.
 *
 * The slices sum to the sacrifice, and their `taxSaved` sums to the difference between `tax.js`'s
 * tax on the salary and on the reduced income — the two are the same calculation, done once as an
 * integral of the marginal rate and once as a subtraction. Both are asserted in the tests, because
 * a breakdown that does not add up to the headline is worse than no breakdown at all.
 *
 * @param {number} [salary] Gross salary before sacrifice (£/yr).
 * @param {number} [sacrifice] (£/yr)
 * @param {unknown} [region]
 * @returns {MarginalRateSlice[]} Empty when nothing is sacrificed.
 */
export function sacrificeSlices(salary = 0, sacrifice = 0, region = undefined) {
	const gross = asMoney(salary);
	const given = cappedSacrifice(gross, sacrifice);
	if (given === 0) return [];

	const floor = roundMoney(gross - given);
	const breakpoints = marginalRateBreakpoints(region);
	const edges = [...new Set([floor, gross, ...breakpoints.filter((p) => p > floor && p < gross)])]
		.filter((edge) => edge >= floor && edge <= gross)
		.sort((a, b) => a - b);

	/** @type {MarginalRateSlice[]} */
	const slices = [];
	for (let i = 0; i < edges.length - 1; i += 1) {
		const from = edges[i];
		const to = edges[i + 1];
		const amount = roundMoney(to - from);
		if (amount === 0) continue;

		// The rate is constant across the whole slice, so any interior point reports it — `tax.js`'s
		// own `marginalTaxRate` stays the single source of truth for what that rate is.
		const rate = marginalTaxRate((from + to) / 2, region);
		const taxSaved = roundMoney((amount * rate) / 100);
		slices.push({ from, to, rate, amount, taxSaved, netCost: roundMoney(amount - taxSaved) });
	}

	return slices.reverse();
}

/* -------------------------------------------------------------------------- */
/* The whole calculation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Everything the salary sacrifice panel's controls describe.
 *
 * @typedef {object} SalarySacrificeInput
 * @property {number} salary Gross salary before any sacrifice (£/yr) — convention (4).
 * @property {number} sacrifice How much of it is given up (£/yr).
 * @property {import('./enums.js').TaxRegion} region
 * @property {number} otherPensionInput Anything else going into a pension this year (£/yr) —
 *   employer contributions outside the sacrifice, a personal SIPP payment — so the annual allowance
 *   check counts the whole year's input rather than this scheme alone. Not a control on the panel;
 *   the same kind of override `hicbc.js` gives `annualBenefit`.
 */

/**
 * What the personal allowance taper did, before and after — the second half of README.md's
 * "60% personal allowance taper (£100k–£125,140)".
 *
 * @typedef {object} TaperEffect
 * @property {boolean} beforeInTaper Whether the original salary sat inside £100k–£125,140.
 * @property {boolean} afterInTaper Whether the reduced income still does.
 * @property {number} allowanceBefore Personal allowance on the original salary (£).
 * @property {number} allowanceAfter Personal allowance on the reduced income (£).
 * @property {number} allowanceRestored How much allowance the sacrifice bought back (£).
 * @property {boolean} clearsTaper Whether the sacrifice takes income to £100,000 or below, so the
 *   full allowance is restored.
 * @property {number} sacrificeToClear What it would take to get there (£) — `0` if already below.
 * @property {number} shortfallToClear How much *more* sacrifice would be needed (£); `0` once the
 *   taper is cleared.
 */

/**
 * A full salary sacrifice calculation.
 *
 * @typedef {object} SalarySacrificeBreakdown
 * @property {string} taxYear Always {@link SALARY_SACRIFICE_TAX_YEAR}.
 * @property {import('./enums.js').TaxRegion} region
 * @property {number} salary Gross salary before sacrifice (£/yr).
 * @property {number} sacrifice The sacrifice actually applied (£/yr), capped at the salary.
 * @property {number} sacrificePct The same as a share of salary (%).
 * @property {number} adjustedNetIncome Salary less sacrifice (£/yr) — what `tax.js` is run on.
 * @property {import('./tax.js').TakeHomeBreakdown} before The whole tax position without the
 *   sacrifice.
 * @property {import('./tax.js').TakeHomeBreakdown} after The whole tax position with it.
 * @property {number} taxSaved Income tax avoided (£/yr).
 * @property {number} netCost What take-home pay actually falls by (£/yr) — `sacrifice − taxSaved`.
 * @property {number} pensionGain What lands in the pot (£/yr) — the sacrifice in full, convention (3).
 * @property {number} effectiveReliefRate Share of the sacrifice funded by tax saved (%) — 60% for a
 *   sacrifice wholly inside the taper band in England/Wales/NI. `0` when nothing is sacrificed.
 * @property {number} costPerPound Take-home given up per £1 into the pension (£).
 * @property {number} marginalRateBefore Rate on the next pound before sacrificing (%).
 * @property {number} marginalRateAfter Rate on the next pound after (%).
 * @property {MarginalRateSlice[]} slices The sacrifice broken down by the rate it displaced, top
 *   slice first — convention (1).
 * @property {TaperEffect} taper
 * @property {number} annualAllowance {@link PENSION_ANNUAL_ALLOWANCE} (£/yr).
 * @property {number} annualAllowanceUsed Sacrifice plus `otherPensionInput` (£/yr).
 * @property {number} annualAllowanceHeadroom What is left of the allowance (£/yr); `0` once over.
 * @property {boolean} overAnnualAllowance Whether the year's input exceeds the allowance — a prompt
 *   to check carry-forward and the tapered allowance, not a verdict. See
 *   {@link PENSION_ANNUAL_ALLOWANCE}.
 */

/**
 * The salary sacrifice panel's single entry point: a gross salary, how much of it is given up and a
 * region in; every figure the panel shows out.
 *
 * Both sides of the comparison come from one call to `tax.js`'s `takeHomeBreakdown` each, so the
 * "before" figures here and the band table on the tab above cannot disagree about the same salary.
 *
 * **What this deliberately does not model**, beyond convention (2)'s missing National Insurance: the
 * National Minimum Wage floor a real scheme has to respect, the effect on anything else pegged to
 * "salary" (death-in-service cover, mortgage affordability, statutory maternity pay), and the fact
 * that the pension is taxed on the way out. The last one matters most: sacrifice defers income tax,
 * it does not cancel it — 25% of the pot is normally tax-free and the rest is taxed as income at
 * whatever rate applies in retirement, which is the comparison that decides whether any of this was
 * worth doing.
 *
 * @param {Partial<SalarySacrificeInput>} [raw]
 * @returns {SalarySacrificeBreakdown}
 */
export function salarySacrificeSummary(raw = {}) {
	const salary = asMoney(raw.salary);
	const sacrifice = cappedSacrifice(salary, raw.sacrifice);
	const region = normaliseTaxRegion(raw.region);
	const adjustedNetIncome = roundMoney(salary - sacrifice);

	const before = takeHomeBreakdown({ income: salary, region });
	const after = takeHomeBreakdown({ income: adjustedNetIncome, region });

	const taxSaved = roundMoney(before.totalTax - after.totalTax);
	const netCost = roundMoney(sacrifice - taxSaved);

	const sacrificeToClear = sacrificeToClearTaper(salary);
	const allowanceRestored = roundMoney(after.allowance.available - before.allowance.available);

	const annualAllowanceUsed = roundMoney(sacrifice + asMoney(raw.otherPensionInput));

	return {
		taxYear: SALARY_SACRIFICE_TAX_YEAR,
		region,
		salary,
		sacrifice,
		sacrificePct: sacrificePercentOfSalary(salary, sacrifice),
		adjustedNetIncome,
		before,
		after,
		taxSaved,
		netCost,
		pensionGain: sacrifice,
		effectiveReliefRate: sacrifice === 0 ? 0 : (taxSaved / sacrifice) * 100,
		costPerPound: sacrifice === 0 ? 0 : roundMoney(netCost / sacrifice),
		marginalRateBefore: before.marginalRate,
		marginalRateAfter: after.marginalRate,
		slices: sacrificeSlices(salary, sacrifice, region),
		taper: {
			beforeInTaper: inAllowanceTaper(salary),
			afterInTaper: inAllowanceTaper(adjustedNetIncome),
			allowanceBefore: personalAllowance(salary),
			allowanceAfter: personalAllowance(adjustedNetIncome),
			allowanceRestored,
			clearsTaper: sacrificeToClear > 0 && sacrifice >= sacrificeToClear,
			sacrificeToClear,
			shortfallToClear: roundMoney(Math.max(0, sacrificeToClear - sacrifice))
		},
		annualAllowance: PENSION_ANNUAL_ALLOWANCE,
		annualAllowanceUsed,
		annualAllowanceHeadroom: roundMoney(
			Math.max(0, PENSION_ANNUAL_ALLOWANCE - annualAllowanceUsed)
		),
		overAnnualAllowance: annualAllowanceUsed > PENSION_ANNUAL_ALLOWANCE
	};
}

/**
 * The income tax saved by a sacrifice, in one number — the same figure
 * {@link salarySacrificeSummary} reports as `taxSaved`, for a caller that wants only that.
 *
 * @param {number} [salary] (£/yr)
 * @param {number} [sacrifice] (£/yr)
 * @param {unknown} [region]
 * @returns {number} (£/yr)
 */
export function taxSavedBySacrifice(salary = 0, sacrifice = 0, region = undefined) {
	const gross = asMoney(salary);
	return roundMoney(
		incomeTax(gross, region) - incomeTax(postSacrificeIncome(gross, sacrifice), region)
	);
}
