/**
 * UK Student Loan repayments — README.md → "UK Income Tax Calculator (2026/27)": "Student Loan
 * plans 1, 2, 4, 5, PG" — issue #26.
 *
 * A Student Loan repayment is not a tax and it is not means-tested against take-home pay: each plan
 * type (assigned by the Student Loans Company when the loan was taken out, not chosen freely) has
 * its own annual income threshold, and 9% of whatever income sits above it is repaid — 6% for a
 * Postgraduate Loan, on its own separate threshold. It borrows nothing from `tax.js`'s band
 * arithmetic beyond, optionally, the income tax marginal rate for the combined "what does a raise
 * really cost" figure — same one-directional relationship `hicbc.js` and `marriage-allowance.js`
 * have with it.
 *
 * Three conventions decide what the numbers here mean:
 *
 * 1. **One undergraduate plan, plus an independent Postgraduate Loan flag.** Plan 1, 2, 4 and 5 cover
 *    different cohorts by when and where someone started an undergraduate course, and nobody is on
 *    more than one of them for the same loan. A Postgraduate Loan is a separate loan for a separate
 *    (typically later) course and is genuinely common to hold *alongside* one of the four — a
 *    borrower on Plan 2 who later did a taught master's funded by a Postgraduate Loan repays both at
 *    once. `plan` (one of the four, or `'none'`) and `postgraduate` (a flag) are therefore two
 *    independent facts, not one choice of five.
 * 2. **Each active loan is repaid at its own rate against its own threshold, and the two are summed
 *    when both are active — the thresholds never merge.** A Plan 2 + Postgraduate Loan borrower pays
 *    9% of income above £28,470 *and* 6% of income above £21,000, not 15% above one combined figure.
 * 3. **Repayment is annualised, not run through a real payroll calendar.** The Student Loans Company
 *    actually calculates and rounds a borrower's deduction *per pay period*: a monthly payslip's
 *    figure is `floor(9% × (that month's pay − 1/12 of the annual threshold))`, not
 *    `floor(9% × (annual pay − annual threshold)) / 12`. For someone whose income is level across
 *    the year the two match to the pound; for someone whose pay varies between periods (a bonus
 *    month, a career break) they can differ by a few pounds over the year. This module works the
 *    second, annual way, matching every other figure `tax.js`/`hicbc.js`/`marriage-allowance.js`
 *    produce on this tab — a full payroll simulation is out of scope for a planning calculator.
 *
 * Repayment figures are rounded *down* to the nearest whole pound, matching how SLC actually rounds
 * a real deduction — not to the nearest penny, unlike every other module on this tab. Rates are
 * whole-number percents. Everything else (take-home figures borrowed from `tax.js`) keeps `tax.js`'s
 * own penny rounding. Everything here is pure.
 *
 * **Sourcing note.** README.md names the five plan types but states no thresholds or rates — the
 * spec's own list is *what* to model, not the figures to model it with. `WebFetch`/`WebSearch` were
 * both unavailable in the run that wrote this module (the same gap #24's journal entry recorded for
 * the Child Benefit rates), so the thresholds below are the last confirmed published figures
 * (2025/26), carried forward as the best available approximation for 2026/27 rather than left
 * unmodelled. Check them against gov.uk's "Repaying your student loan" guidance at the start of the
 * tax year — `student-loan.test.js` pins every one, so a correction is a deliberate, visible edit
 * rather than a silent one. See this issue's journal entry for the same disclosure in full.
 */

import { marginalTaxRate, normaliseTaxRegion, takeHomePay } from './tax.js';

/*
 * As in `hicbc.js`/`marriage-allowance.js`, model types are referenced inline as
 * `import('./types.js').X` rather than re-declared as local `@typedef`s, because `index.js`
 * re-exports every module with `export *` and svelte-check reads two same-named top-level typedefs
 * as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The tax year                                                                */
/* -------------------------------------------------------------------------- */

/** The tax year every figure in this module belongs to — matches `tax.js`'s `TAX_YEAR`. */
export const STUDENT_LOAN_TAX_YEAR = '2026/27';

/* -------------------------------------------------------------------------- */
/* Plan types                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Which undergraduate plan, if any, a borrower is on — convention (1). Postgraduate Loans are not a
 * member of this set; see {@link postgraduateLoanId} and `postgraduate` on {@link StudentLoanInput}.
 * @typedef {'plan_1' | 'plan_2' | 'plan_4' | 'plan_5' | 'none'} UndergraduatePlan
 */

/** @type {readonly UndergraduatePlan[]} */
export const UNDERGRADUATE_PLANS = Object.freeze(['plan_1', 'plan_2', 'plan_4', 'plan_5', 'none']);

/** @type {Record<UndergraduatePlan, string>} */
export const UNDERGRADUATE_PLAN_LABELS = Object.freeze({
	plan_1: 'Plan 1',
	plan_2: 'Plan 2',
	plan_4: 'Plan 4',
	plan_5: 'Plan 5',
	none: 'No undergraduate loan'
});

/**
 * The identifier used for a Postgraduate Loan alongside the four undergraduate plan ids — the
 * combined key space {@link repaymentForLoan} and {@link LOAN_DEFS} use.
 * @typedef {'postgraduate'} PostgraduateLoan
 */

/**
 * Any loan type this module knows a threshold and rate for — the four undergraduate plans plus
 * Postgraduate Loan.
 * @typedef {UndergraduatePlan | PostgraduateLoan} StudentLoanId
 */

/**
 * One loan type's repayment rule: an annual income threshold and the rate charged on income above
 * it.
 * @typedef {object} StudentLoanDef
 * @property {string} label
 * @property {number} threshold Annual income threshold (£/yr) above which repayment is due.
 * @property {number} rate Repayment rate (%), a whole-number percent.
 */

/**
 * Every plan's threshold and rate, 2025/26 figures carried forward as 2026/27's best estimate — see
 * this module's header sourcing note. Threshold order matches README.md's own list (1, 2, 4, 5, PG).
 * @type {Record<Exclude<StudentLoanId, 'none'>, StudentLoanDef>}
 */
export const LOAN_DEFS = Object.freeze({
	plan_1: Object.freeze({ label: 'Plan 1', threshold: 26_065, rate: 9 }),
	plan_2: Object.freeze({ label: 'Plan 2', threshold: 28_470, rate: 9 }),
	plan_4: Object.freeze({ label: 'Plan 4', threshold: 32_745, rate: 9 }),
	plan_5: Object.freeze({ label: 'Plan 5', threshold: 25_000, rate: 9 }),
	postgraduate: Object.freeze({ label: 'Postgraduate Loan', threshold: 21_000, rate: 6 })
});

/**
 * Every loan type's definition, in README.md's own order — for a reference table listing all five
 * regardless of which (if any) is selected, the way `tax.js`'s band ladder shows bands never reached.
 * @type {ReadonlyArray<StudentLoanDef & { id: Exclude<StudentLoanId, 'none'> }>}
 */
export const ALL_STUDENT_LOAN_TYPES = Object.freeze(
	/** @type {const} */ (['plan_1', 'plan_2', 'plan_4', 'plan_5', 'postgraduate']).map((id) =>
		Object.freeze({ id, ...LOAN_DEFS[id] })
	)
);

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * SLC rounds a repayment *down* to the nearest whole pound — convention (2)'s rounding rule, unlike
 * every other money figure on this tab.
 * @param {number} amount
 * @returns {number}
 */
function roundDownPound(amount) {
	return Math.floor(amount) + 0;
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

/**
 * Coerce anything into an {@link UndergraduatePlan}, the same tolerant reading `normaliseAppData`
 * gives an unrecognised enum value.
 * @param {unknown} plan
 * @returns {UndergraduatePlan}
 */
export function normaliseUndergraduatePlan(plan) {
	return UNDERGRADUATE_PLANS.includes(/** @type {UndergraduatePlan} */ (plan))
		? /** @type {UndergraduatePlan} */ (plan)
		: 'none';
}

/* -------------------------------------------------------------------------- */
/* Repayment on a single loan                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The annual threshold for a loan type (£), `0` for one this module doesn't know.
 * @param {unknown} loanId
 * @returns {number}
 */
export function thresholdFor(loanId) {
	return LOAN_DEFS[/** @type {keyof typeof LOAN_DEFS} */ (loanId)]?.threshold ?? 0;
}

/**
 * The repayment rate for a loan type (%), `0` for one this module doesn't know.
 * @param {unknown} loanId
 * @returns {number}
 */
export function rateFor(loanId) {
	return LOAN_DEFS[/** @type {keyof typeof LOAN_DEFS} */ (loanId)]?.rate ?? 0;
}

/**
 * The annual repayment due on a single loan type (£/yr) — convention (2)'s per-loan arithmetic:
 * `rate% × max(0, income − threshold)`, rounded down to the whole pound. `0` for an unrecognised
 * loan id, which covers `'none'`.
 *
 * @param {number} [income] (£/yr)
 * @param {unknown} [loanId]
 * @returns {number} (£/yr)
 */
export function repaymentForLoan(income = 0, loanId = 'none') {
	const def = LOAN_DEFS[/** @type {keyof typeof LOAN_DEFS} */ (loanId)];
	if (!def) return 0;
	const excess = Math.max(0, asMoney(income) - def.threshold);
	return roundDownPound((excess * def.rate) / 100);
}

/* -------------------------------------------------------------------------- */
/* The whole calculation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Everything the student loan panel's controls describe.
 *
 * @typedef {object} StudentLoanInput
 * @property {number} income Adjusted net (gross earned) income for the year (£/yr) — the same figure
 *   `tax.js`'s bands are worked on.
 * @property {UndergraduatePlan} plan Which undergraduate plan applies, if any.
 * @property {boolean} postgraduate Whether a Postgraduate Loan is also being repaid — convention (1).
 * @property {import('./enums.js').TaxRegion} region Only used for the combined marginal-rate figures.
 */

/**
 * One active loan's contribution to the total — convention (2).
 * @typedef {object} ActiveLoan
 * @property {StudentLoanId} id
 * @property {string} label
 * @property {number} threshold (£/yr)
 * @property {number} rate (%)
 * @property {boolean} overThreshold Whether income is actually above this loan's threshold.
 * @property {number} incomeOverThreshold (£/yr); `0` if not over.
 * @property {number} repayment (£/yr); `0` if not over.
 * @property {number} headroom How much more income before this loan's threshold is reached (£);
 *   `0` once over it.
 */

/**
 * A full Student Loan repayment calculation — README.md's "Student Loan plans 1, 2, 4, 5, PG".
 *
 * @typedef {object} StudentLoanBreakdown
 * @property {string} taxYear Always {@link STUDENT_LOAN_TAX_YEAR}.
 * @property {number} income (£/yr)
 * @property {UndergraduatePlan} plan
 * @property {boolean} postgraduate
 * @property {import('./enums.js').TaxRegion} region
 * @property {ActiveLoan[]} loans Only the loan(s) actually selected — `plan` (unless `'none'`) and/or
 *   Postgraduate Loan (if `postgraduate`). Empty when neither applies.
 * @property {boolean} hasAnyLoan Whether `loans` is non-empty.
 * @property {number} totalRepayment Every active loan's repayment, summed (£/yr).
 * @property {number} monthlyRepayment `totalRepayment / 12`, rounded down (£).
 * @property {number} weeklyRepayment `totalRepayment / 52`, rounded down (£).
 * @property {number} incomeTaxMarginalRate Rate on your next pound from `tax.js` alone (%).
 * @property {number} studentLoanMarginalRate What the active loan(s) add on top (%) — the sum of
 *   each active loan's rate once its threshold is passed; `0` below every active threshold.
 * @property {number} combinedMarginalRate The two together (%).
 * @property {number} takeHomePay Income less income tax alone (£/yr), `tax.js`'s own figure — before
 *   this module's repayments.
 * @property {number} takeHomeAfterStudentLoan Income less income tax less every active repayment
 *   (£/yr) — still before National Insurance and pension contributions.
 */

/**
 * The student loan panel's single entry point: an income, which plan (if any), whether there's also
 * a Postgraduate Loan, and a region for the combined marginal rate — every figure the panel shows,
 * out.
 *
 * @param {Partial<StudentLoanInput>} [raw]
 * @returns {StudentLoanBreakdown}
 */
export function studentLoanSummary(raw = {}) {
	const income = asMoney(raw.income);
	const plan = normaliseUndergraduatePlan(raw.plan);
	const postgraduate = raw.postgraduate === true;
	const region = normaliseTaxRegion(raw.region);

	/** @type {(keyof typeof LOAN_DEFS)[]} */
	const loanIds = [];
	if (plan !== 'none') loanIds.push(plan);
	if (postgraduate) loanIds.push('postgraduate');

	const loans = loanIds.map((id) => {
		const def = LOAN_DEFS[id];
		const overThreshold = income > def.threshold;
		const incomeOverThreshold = roundMoney(Math.max(0, income - def.threshold));
		return {
			id,
			label: def.label,
			threshold: def.threshold,
			rate: def.rate,
			overThreshold,
			incomeOverThreshold,
			repayment: repaymentForLoan(income, id),
			headroom: roundMoney(Math.max(0, def.threshold - income))
		};
	});

	const totalRepayment = loans.reduce((sum, loan) => sum + loan.repayment, 0);
	const studentLoanMarginalRate = loans.reduce(
		(sum, loan) => sum + (loan.overThreshold ? loan.rate : 0),
		0
	);
	const incomeTaxMarginalRate = marginalTaxRate(income, region);
	const grossTakeHome = takeHomePay(income, region);

	return {
		taxYear: STUDENT_LOAN_TAX_YEAR,
		income,
		plan,
		postgraduate,
		region,
		loans,
		hasAnyLoan: loans.length > 0,
		totalRepayment,
		monthlyRepayment: roundDownPound(totalRepayment / 12),
		weeklyRepayment: roundDownPound(totalRepayment / 52),
		incomeTaxMarginalRate,
		studentLoanMarginalRate,
		combinedMarginalRate: incomeTaxMarginalRate + studentLoanMarginalRate,
		takeHomePay: grossTakeHome,
		takeHomeAfterStudentLoan: roundMoney(grossTakeHome - totalRepayment)
	};
}
