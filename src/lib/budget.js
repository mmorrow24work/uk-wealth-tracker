/**
 * Household budget totals and household cash flow — README.md → "Budget & Bills" ("Monthly spend
 * categories", "Recurring bills and line items", "ONS UK household average benchmarks") and
 * "Household / Partner Planning" ("Household budget and cash flow") — issue #145.
 *
 * `types.js`'s `Budget` (categories/bills/line_items) has existed since the core data model, but
 * nothing has ever totalled it — the `/budget` route was a placeholder. This module is that
 * arithmetic, plus the household half of the issue: turning `profile`/`partner` gross salaries into
 * take-home income and setting it against the budget's outgoings.
 *
 * Four conventions decide what the numbers mean:
 *
 * 1. **Every recurring figure is normalised to £/month.** `BudgetCategory.monthly_amount` already
 *    is one; `BudgetBill.amount` is per `BudgetBill.frequency` and is annualised via
 *    `enums.js`'s {@link PAYMENTS_PER_YEAR} (the same table `fire.js`/`auto-invest.js` already use
 *    for contribution frequency) before being divided back down to a month, so a weekly bill and an
 *    annual one land on the same footing as a monthly category.
 * 2. **Line items are one-off, not recurring, and are kept out of the monthly total.**
 *    `BudgetLineItem` has no date or frequency — it is an ad hoc entry, not a recurring
 *    commitment — so {@link budgetMonthlySummary} reports it as its own figure
 *    (`lineItemsTotal`) alongside `recurringTotal` (categories + bills) rather than folding it into
 *    a single "monthly spend" that would overstate every month by whatever one-off items happen to
 *    be sitting in the list. `total` is the sum of both, for a caller that wants one number anyway.
 * 3. **Income is take-home pay, not gross, and is the same "income tax only" figure the Tax tab
 *    uses.** {@link personMonthlyIncome} treats `pension_pct` as salary sacrifice — exactly the
 *    reading `TaxCalculator.svelte` already gives `profile.pension_pct` — and runs the sacrificed
 *    salary through `tax.js`'s `takeHomeBreakdown`. That means National Insurance, Student Loan
 *    repayments and any other deduction are not subtracted here either, for the same reason
 *    `tax.js`'s own header gives: none of them are modelled anywhere in this app. A cash flow
 *    figure built from this is therefore a ceiling on real take-home pay, not a promise of it.
 * 4. **The partner is optional, and the household figure degrades gracefully without one.**
 *    `AppData.partner` is `null` for the common case — no partner recorded, or #170's entry form not
 *    yet used — so {@link householdCashFlow} treats a missing partner as zero income rather than
 *    throwing or guessing. The region used for both incomes is always `profile.tax_region`, per
 *    `Partner`'s own doc comment in `types.js`: tax region is a household-wide assumption the
 *    partner record does not carry its own copy of.
 *
 * ONS benchmark comparison ({@link onsBenchmarkSummary}) only ever compares categories the user has
 * given a benchmark to (`ons_benchmark !== null`) — `types.js` already leaves it nullable for
 * exactly this reason, so a category nobody has benchmarked is simply left out of the comparison
 * rather than compared against an invented figure.
 *
 * {@link ONS_CATEGORY_PRESETS} is a small "quick add" starter list for that field, not a claim about
 * this app's own data: this session had no network access, so the figures are illustrative,
 * round-numbered monthly averages from general knowledge of the shape of ONS's "Family Spending in
 * the UK" release rather than anything checked against ons.gov.uk. They exist so a user has
 * somewhere to start typing rather than a blank benchmark field, and every preset says so in its own
 * `notes`. Treat them the way README.md's standing disclaimer asks — illustrative, not financial
 * advice — and replace them with the current release's real figures if precision matters.
 *
 * Every figure is in pounds, rounded to whole pence. Everything is pure: a budget/profile/partner go
 * in, plain objects come out, nothing is mutated.
 */

import { PAYMENTS_PER_YEAR } from './enums.js';
import { DEFAULT_TAX_REGION, takeHomeBreakdown } from './tax.js';
import { postSacrificeIncome, sacrificeFromPercent } from './salary-sacrifice.js';

/**
 * @param {unknown} value
 * @returns {number}
 */
function asMoney(value) {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * @param {number} value
 * @returns {number}
 */
function roundMoney(value) {
	return Math.round(value * 100) / 100;
}

/**
 * A recurring bill's amount, restated to £/month regardless of `frequency` — convention (1). An
 * unrecognised frequency (only possible from a hand-edited or pre-`BILL_FREQUENCIES` document) is
 * treated as monthly, the same fallback `model.js`'s `normaliseBudgetBill` already applies.
 *
 * @param {import('./types.js').BudgetBill} bill
 * @returns {number} (£/month)
 */
export function billMonthlyAmount(bill) {
	const perYear = PAYMENTS_PER_YEAR[bill?.frequency] ?? PAYMENTS_PER_YEAR.monthly;
	return roundMoney((asMoney(bill?.amount) * perYear) / 12);
}

/**
 * @param {import('./types.js').BudgetBill[]} [bills]
 * @returns {number} (£/month)
 */
export function totalMonthlyBills(bills = []) {
	return roundMoney(bills.reduce((total, bill) => total + billMonthlyAmount(bill), 0));
}

/**
 * @param {import('./types.js').BudgetCategory[]} [categories]
 * @returns {number} (£/month)
 */
export function totalMonthlyCategories(categories = []) {
	return roundMoney(
		categories.reduce((total, category) => total + asMoney(category.monthly_amount), 0)
	);
}

/**
 * @param {import('./types.js').BudgetLineItem[]} [lineItems]
 * @returns {number} (£, one-off — see convention (2))
 */
export function totalLineItems(lineItems = []) {
	return roundMoney(lineItems.reduce((total, item) => total + asMoney(item.amount), 0));
}

/**
 * @typedef {object} BudgetMonthlySummary
 * @property {number} categoriesTotal (£/month)
 * @property {number} billsTotal (£/month)
 * @property {number} recurringTotal `categoriesTotal + billsTotal` (£/month) — convention (2).
 * @property {number} lineItemsTotal One-off items, not annualised (£) — convention (2).
 * @property {number} total `recurringTotal + lineItemsTotal` (£).
 */

/**
 * The whole budget, totalled — convention (1) and (2).
 *
 * @param {Partial<import('./types.js').Budget>} [budget]
 * @returns {BudgetMonthlySummary}
 */
export function budgetMonthlySummary(budget = {}) {
	const categoriesTotal = totalMonthlyCategories(budget.categories ?? []);
	const billsTotal = totalMonthlyBills(budget.bills ?? []);
	const lineItemsTotal = totalLineItems(budget.line_items ?? []);
	const recurringTotal = roundMoney(categoriesTotal + billsTotal);
	return {
		categoriesTotal,
		billsTotal,
		recurringTotal,
		lineItemsTotal,
		total: roundMoney(recurringTotal + lineItemsTotal)
	};
}

/**
 * @typedef {object} OnsCategoryComparison
 * @property {import('./types.js').BudgetCategory} category
 * @property {number} benchmark (£/month) — never null; only categories with one are included.
 * @property {number} diff `category.monthly_amount - benchmark` (£/month). Positive means budgeted
 *   above the UK household average.
 * @property {boolean} aboveAverage `diff > 0`.
 */

/**
 * @typedef {object} OnsBenchmarkSummary
 * @property {number} totalBudgeted Sum of `monthly_amount` across benchmarked categories only (£).
 * @property {number} totalBenchmark Sum of their benchmarks (£).
 * @property {number} diff `totalBudgeted - totalBenchmark` (£).
 * @property {OnsCategoryComparison[]} categories One row per benchmarked category, in list order.
 */

/**
 * How the budget compares to the ONS UK household averages the user has recorded — only over
 * categories that carry a benchmark (`ons_benchmark !== null`); everything else is silently left
 * out rather than compared against a figure nobody entered.
 *
 * @param {import('./types.js').BudgetCategory[]} [categories]
 * @returns {OnsBenchmarkSummary}
 */
export function onsBenchmarkSummary(categories = []) {
	const rows = categories
		.filter((category) => category.ons_benchmark !== null && category.ons_benchmark !== undefined)
		.map((category) => {
			const benchmark = asMoney(category.ons_benchmark);
			const diff = roundMoney(asMoney(category.monthly_amount) - benchmark);
			return { category, benchmark, diff, aboveAverage: diff > 0 };
		});

	return {
		totalBudgeted: roundMoney(rows.reduce((total, row) => total + row.category.monthly_amount, 0)),
		totalBenchmark: roundMoney(rows.reduce((total, row) => total + row.benchmark, 0)),
		diff: roundMoney(rows.reduce((total, row) => total + row.diff, 0)),
		categories: rows
	};
}

/**
 * Illustrative starter categories for the ONS benchmark field — see the module header's sourcing
 * note. `monthly_amount` is left at `0` (a starting point for the user's own figure); only
 * `ons_benchmark` is pre-filled.
 *
 * @type {readonly { name: string, ons_benchmark: number, notes: string }[]}
 */
export const ONS_CATEGORY_PRESETS = Object.freeze([
	{
		name: 'Housing & fuel',
		ons_benchmark: 550,
		notes: 'Illustrative ONS-shaped average, not verified against ons.gov.uk this session.'
	},
	{
		name: 'Groceries',
		ons_benchmark: 280,
		notes: 'Illustrative ONS-shaped average, not verified against ons.gov.uk this session.'
	},
	{
		name: 'Transport',
		ons_benchmark: 260,
		notes: 'Illustrative ONS-shaped average, not verified against ons.gov.uk this session.'
	},
	{
		name: 'Recreation & culture',
		ons_benchmark: 220,
		notes: 'Illustrative ONS-shaped average, not verified against ons.gov.uk this session.'
	},
	{
		name: 'Restaurants & hotels',
		ons_benchmark: 190,
		notes: 'Illustrative ONS-shaped average, not verified against ons.gov.uk this session.'
	},
	{
		name: 'Household goods & services',
		ons_benchmark: 150,
		notes: 'Illustrative ONS-shaped average, not verified against ons.gov.uk this session.'
	},
	{
		name: 'Communication',
		ons_benchmark: 80,
		notes: 'Illustrative ONS-shaped average, not verified against ons.gov.uk this session.'
	},
	{
		name: 'Clothing & footwear',
		ons_benchmark: 70,
		notes: 'Illustrative ONS-shaped average, not verified against ons.gov.uk this session.'
	}
]);

/**
 * One person's monthly take-home pay from their gross salary — convention (3). `pension_pct` is
 * read as salary sacrifice, the same reading `TaxCalculator.svelte` gives `profile.pension_pct`.
 *
 * @param {{ gross_salary?: number, pension_pct?: number }} [person] A `Profile` or `Partner` —
 *   only these two fields are read, so either shape works.
 * @param {import('./enums.js').TaxRegion} [region]
 * @returns {number} (£/month)
 */
export function personMonthlyIncome(person = {}, region = DEFAULT_TAX_REGION) {
	const salary = asMoney(person.gross_salary);
	const sacrifice = sacrificeFromPercent(salary, asMoney(person.pension_pct));
	const adjustedNetIncome = postSacrificeIncome(salary, sacrifice);
	return takeHomeBreakdown({ income: adjustedNetIncome, region }).monthlyTakeHome;
}

/**
 * @typedef {object} HouseholdCashFlow
 * @property {number} you Your monthly take-home income (£).
 * @property {number} partner Partner's monthly take-home income (£) — `0` with no partner recorded,
 *   convention (4).
 * @property {number} income `you + partner` (£/month).
 * @property {BudgetMonthlySummary} budget The totalled budget — see {@link budgetMonthlySummary}.
 * @property {number} outgoings `budget.total` (£/month), surfaced at the top level so a caller
 *   doesn't have to reach into `budget` for the one figure income is set against.
 * @property {number} net `income - outgoings` (£/month). Negative means the household is
 *   projected to spend more than it takes home.
 * @property {number | null} savingsRatePct `net / income` as a percentage, `null` when `income` is
 *   zero (a rate has no meaning against no income, rather than reporting a misleading `-Infinity`
 *   or `0`).
 */

/**
 * The household cash flow: both partners' take-home income against the shared budget — the whole
 * point of the issue this module exists for.
 *
 * @param {{
 *   profile?: { gross_salary?: number, pension_pct?: number, tax_region?: import('./enums.js').TaxRegion },
 *   partner?: { gross_salary?: number, pension_pct?: number } | null,
 *   budget?: Partial<import('./types.js').Budget>
 * }} [data] `profile`/`partner` only need the fields {@link personMonthlyIncome} reads, so a full
 *   `Profile`/`Partner` works but so does a plain object with just these three fields — the shape a
 *   caller not already holding the whole record would otherwise have to fake.
 * @returns {HouseholdCashFlow}
 */
export function householdCashFlow({ profile = {}, partner = null, budget = {} } = {}) {
	const region = /** @type {import('./enums.js').TaxRegion} */ (
		profile.tax_region ?? DEFAULT_TAX_REGION
	);
	const you = personMonthlyIncome(profile, region);
	const partnerIncome = partner ? personMonthlyIncome(partner, region) : 0;
	const income = roundMoney(you + partnerIncome);
	const summary = budgetMonthlySummary(budget);
	const net = roundMoney(income - summary.total);

	return {
		you,
		partner: partnerIncome,
		income,
		budget: summary,
		outgoings: summary.total,
		net,
		savingsRatePct: income > 0 ? roundMoney((net / income) * 100) : null
	};
}
