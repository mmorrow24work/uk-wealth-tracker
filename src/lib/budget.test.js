import { describe, expect, it } from 'vitest';

import {
	createBudgetBill,
	createBudgetCategory,
	createBudgetLineItem,
	createPartner,
	createProfile
} from './model.js';
import { postSacrificeIncome, sacrificeFromPercent } from './salary-sacrifice.js';
import { takeHomeBreakdown } from './tax.js';
import {
	ONS_CATEGORY_PRESETS,
	billMonthlyAmount,
	budgetMonthlySummary,
	householdCashFlow,
	onsBenchmarkSummary,
	personMonthlyIncome,
	totalLineItems,
	totalMonthlyBills,
	totalMonthlyCategories
} from './budget.js';

describe('billMonthlyAmount', () => {
	it('passes a monthly bill through unchanged', () => {
		expect(billMonthlyAmount(createBudgetBill({ amount: 45, frequency: 'monthly' }))).toBe(45);
	});

	it('divides a weekly bill by payments per year, over 12, rounded to the penny', () => {
		expect(billMonthlyAmount(createBudgetBill({ amount: 10, frequency: 'weekly' }))).toBeCloseTo(
			(10 * 52) / 12,
			2
		);
	});

	it('divides a quarterly bill down to a month', () => {
		expect(billMonthlyAmount(createBudgetBill({ amount: 300, frequency: 'quarterly' }))).toBe(100);
	});

	it('divides an annual bill down to a month', () => {
		expect(billMonthlyAmount(createBudgetBill({ amount: 1200, frequency: 'annually' }))).toBe(100);
	});
});

describe('totalMonthlyBills / totalMonthlyCategories / totalLineItems', () => {
	it('sums bills at their monthly-equivalent amount', () => {
		const bills = [
			createBudgetBill({ amount: 1200, frequency: 'annually' }), // 100/mo
			createBudgetBill({ amount: 50, frequency: 'monthly' }) // 50/mo
		];
		expect(totalMonthlyBills(bills)).toBe(150);
	});

	it('sums category monthly_amount directly', () => {
		const categories = [
			createBudgetCategory({ monthly_amount: 200 }),
			createBudgetCategory({ monthly_amount: 80 })
		];
		expect(totalMonthlyCategories(categories)).toBe(280);
	});

	it('sums line items as one-off amounts', () => {
		const items = [createBudgetLineItem({ amount: 40 }), createBudgetLineItem({ amount: 10 })];
		expect(totalLineItems(items)).toBe(50);
	});

	it('returns 0 for empty lists', () => {
		expect(totalMonthlyBills([])).toBe(0);
		expect(totalMonthlyCategories([])).toBe(0);
		expect(totalLineItems([])).toBe(0);
	});
});

describe('budgetMonthlySummary', () => {
	it('splits recurring spend from one-off line items and totals both', () => {
		const budget = {
			categories: [createBudgetCategory({ monthly_amount: 200 })],
			bills: [createBudgetBill({ amount: 1200, frequency: 'annually' })], // 100/mo
			line_items: [createBudgetLineItem({ amount: 50 })]
		};
		const summary = budgetMonthlySummary(budget);
		expect(summary.categoriesTotal).toBe(200);
		expect(summary.billsTotal).toBe(100);
		expect(summary.recurringTotal).toBe(300);
		expect(summary.lineItemsTotal).toBe(50);
		expect(summary.total).toBe(350);
	});

	it('defaults every collection to empty when the budget has none', () => {
		expect(budgetMonthlySummary({})).toEqual({
			categoriesTotal: 0,
			billsTotal: 0,
			recurringTotal: 0,
			lineItemsTotal: 0,
			total: 0
		});
	});
});

describe('onsBenchmarkSummary', () => {
	it('only includes categories with a recorded benchmark', () => {
		const categories = [
			createBudgetCategory({ name: 'Groceries', monthly_amount: 300, ons_benchmark: 280 }),
			createBudgetCategory({ name: 'Hobbies', monthly_amount: 60, ons_benchmark: null })
		];
		const summary = onsBenchmarkSummary(categories);
		expect(summary.categories).toHaveLength(1);
		expect(summary.categories[0].category.name).toBe('Groceries');
		expect(summary.totalBudgeted).toBe(300);
		expect(summary.totalBenchmark).toBe(280);
		expect(summary.diff).toBe(20);
		expect(summary.categories[0].aboveAverage).toBe(true);
	});

	it('flags spend below the benchmark as not above average', () => {
		const categories = [createBudgetCategory({ monthly_amount: 200, ons_benchmark: 280 })];
		const [row] = onsBenchmarkSummary(categories).categories;
		expect(row.diff).toBe(-80);
		expect(row.aboveAverage).toBe(false);
	});

	it('returns zeroed totals with no benchmarked categories', () => {
		const summary = onsBenchmarkSummary([createBudgetCategory({ ons_benchmark: null })]);
		expect(summary.categories).toEqual([]);
		expect(summary.totalBudgeted).toBe(0);
		expect(summary.totalBenchmark).toBe(0);
	});
});

describe('ONS_CATEGORY_PRESETS', () => {
	it('every preset has a name and a positive benchmark', () => {
		expect(ONS_CATEGORY_PRESETS.length).toBeGreaterThan(0);
		for (const preset of ONS_CATEGORY_PRESETS) {
			expect(preset.name).not.toBe('');
			expect(preset.ons_benchmark).toBeGreaterThan(0);
		}
	});
});

describe('personMonthlyIncome', () => {
	it('matches takeHomeBreakdown directly when there is no sacrifice', () => {
		const expected = takeHomeBreakdown({
			income: 30_000,
			region: 'england_wales_ni'
		}).monthlyTakeHome;
		expect(personMonthlyIncome({ gross_salary: 30_000, pension_pct: 0 }, 'england_wales_ni')).toBe(
			expected
		);
	});

	it('reads pension_pct as salary sacrifice before working out take-home pay', () => {
		const sacrifice = sacrificeFromPercent(40_000, 10);
		const adjusted = postSacrificeIncome(40_000, sacrifice);
		const expected = takeHomeBreakdown({ income: adjusted, region: 'scotland' }).monthlyTakeHome;
		expect(personMonthlyIncome({ gross_salary: 40_000, pension_pct: 10 }, 'scotland')).toBe(
			expected
		);
	});

	it('is 0 for a person with no salary', () => {
		expect(personMonthlyIncome({ gross_salary: 0, pension_pct: 0 })).toBe(0);
	});
});

describe('householdCashFlow', () => {
	const budget = {
		categories: [createBudgetCategory({ monthly_amount: 200 })],
		bills: [createBudgetBill({ amount: 1200, frequency: 'annually' })], // 100/mo
		line_items: [createBudgetLineItem({ amount: 50 })]
	};

	it('treats a missing partner as zero income, not an error', () => {
		const profile = createProfile({
			gross_salary: 30_000,
			pension_pct: 0,
			tax_region: 'england_wales_ni'
		});
		const result = householdCashFlow({ profile, partner: null, budget });

		expect(result.partner).toBe(0);
		expect(result.you).toBe(personMonthlyIncome(profile, 'england_wales_ni'));
		expect(result.income).toBe(result.you);
		expect(result.outgoings).toBe(350);
		expect(result.net).toBe(roundToPenny(result.income - 350));
	});

	it("adds the partner's income under the profile's tax region", () => {
		const profile = createProfile({ gross_salary: 30_000, pension_pct: 0, tax_region: 'scotland' });
		const partner = createPartner({ gross_salary: 25_000, pension_pct: 0 });
		const result = householdCashFlow({ profile, partner, budget });

		const expectedYou = personMonthlyIncome(profile, 'scotland');
		const expectedPartner = personMonthlyIncome(partner, 'scotland');
		expect(result.you).toBe(expectedYou);
		expect(result.partner).toBe(expectedPartner);
		expect(result.income).toBe(roundToPenny(expectedYou + expectedPartner));
	});

	it('reports a null savings rate rather than dividing by zero income', () => {
		const profile = createProfile({
			gross_salary: 0,
			pension_pct: 0,
			tax_region: 'england_wales_ni'
		});
		const result = householdCashFlow({ profile, partner: null, budget });

		expect(result.income).toBe(0);
		expect(result.savingsRatePct).toBeNull();
		expect(result.net).toBe(-350);
	});

	it('a positive net means income clears every outgoing, one-off items included', () => {
		const profile = createProfile({
			gross_salary: 60_000,
			pension_pct: 0,
			tax_region: 'england_wales_ni'
		});
		const result = householdCashFlow({ profile, partner: null, budget });

		expect(result.net).toBeGreaterThan(0);
		expect(result.savingsRatePct).toBeGreaterThan(0);
		expect(result.savingsRatePct).toBeLessThan(100);
	});
});

/** @param {number} value */
function roundToPenny(value) {
	return Math.round(value * 100) / 100;
}
