import { describe, it, expect } from 'vitest';
import { calculateNetWorth, calculateMonthlyChange, findPreviousMonth } from './net-worth.js';
import { createDebt, createInvestment, createMonthlyEntry } from './model.js';

describe('calculateNetWorth', () => {
	it('sums investments and subtracts debts', () => {
		const entry = createMonthlyEntry({
			investments: [createInvestment({ value: 10000 }), createInvestment({ value: 5000 })],
			debts: [createDebt({ balance: 2000 })]
		});

		expect(calculateNetWorth(entry)).toBe(13000);
	});

	it('returns zero when no investments or debts', () => {
		const entry = createMonthlyEntry({
			investments: [],
			debts: []
		});

		expect(calculateNetWorth(entry)).toBe(0);
	});

	it('respects exclude_from_net_worth flag by default', () => {
		const entry = createMonthlyEntry({
			investments: [
				createInvestment({ value: 10000, exclude_from_net_worth: false }),
				createInvestment({ value: 5000, exclude_from_net_worth: true })
			],
			debts: [
				createDebt({ balance: 1000, exclude_from_net_worth: false }),
				createDebt({ balance: 2000, exclude_from_net_worth: true })
			]
		});

		expect(calculateNetWorth(entry)).toBe(9000);
	});

	it('includes excluded records when includeExcluded is true', () => {
		const entry = createMonthlyEntry({
			investments: [
				createInvestment({ value: 10000, exclude_from_net_worth: false }),
				createInvestment({ value: 5000, exclude_from_net_worth: true })
			],
			debts: [
				createDebt({ balance: 1000, exclude_from_net_worth: false }),
				createDebt({ balance: 2000, exclude_from_net_worth: true })
			]
		});

		expect(calculateNetWorth(entry, { includeExcluded: true })).toBe(12000);
	});

	it('handles negative net worth', () => {
		const entry = createMonthlyEntry({
			investments: [createInvestment({ value: 5000 })],
			debts: [createDebt({ balance: 10000 })]
		});

		expect(calculateNetWorth(entry)).toBe(-5000);
	});
});

describe('calculateMonthlyChange', () => {
	it('calculates change in pounds and percent', () => {
		const previous = createMonthlyEntry({
			investments: [createInvestment({ value: 10000 })],
			debts: []
		});
		const current = createMonthlyEntry({
			investments: [createInvestment({ value: 12000 })],
			debts: []
		});

		const change = calculateMonthlyChange(previous, current);
		expect(change.change_pounds).toBe(2000);
		expect(change.change_percent).toBeCloseTo(20);
	});

	it('returns null when no previous month', () => {
		const current = createMonthlyEntry({
			investments: [createInvestment({ value: 10000 })],
			debts: []
		});

		const change = calculateMonthlyChange(null, current);
		expect(change.change_pounds).toBeNull();
		expect(change.change_percent).toBeNull();
	});

	it('handles negative change', () => {
		const previous = createMonthlyEntry({
			investments: [createInvestment({ value: 10000 })],
			debts: []
		});
		const current = createMonthlyEntry({
			investments: [createInvestment({ value: 9000 })],
			debts: []
		});

		const change = calculateMonthlyChange(previous, current);
		expect(change.change_pounds).toBe(-1000);
		expect(change.change_percent).toBeCloseTo(-10);
	});

	it('returns null percent when previous net worth is zero and change is zero', () => {
		const previous = createMonthlyEntry({
			investments: [],
			debts: []
		});
		const current = createMonthlyEntry({
			investments: [],
			debts: []
		});

		const change = calculateMonthlyChange(previous, current);
		expect(change.change_pounds).toBe(0);
		expect(change.change_percent).toBeNull();
	});

	it('returns null percent when previous net worth is zero but current is not', () => {
		const previous = createMonthlyEntry({
			investments: [],
			debts: []
		});
		const current = createMonthlyEntry({
			investments: [createInvestment({ value: 5000 })],
			debts: []
		});

		const change = calculateMonthlyChange(previous, current);
		expect(change.change_pounds).toBe(5000);
		expect(change.change_percent).toBeNull();
	});

	it('includes excluded records in calculations', () => {
		const previous = createMonthlyEntry({
			investments: [createInvestment({ value: 10000, exclude_from_net_worth: true })],
			debts: []
		});
		const current = createMonthlyEntry({
			investments: [createInvestment({ value: 12000, exclude_from_net_worth: true })],
			debts: []
		});

		const change = calculateMonthlyChange(previous, current);
		expect(change.change_pounds).toBe(0);
		expect(change.change_percent).toBeNull();
	});

	it('accounts for investment and debt changes together', () => {
		const previous = createMonthlyEntry({
			investments: [createInvestment({ value: 10000 })],
			debts: [createDebt({ balance: 2000 })]
		});
		const current = createMonthlyEntry({
			investments: [createInvestment({ value: 12000 })],
			debts: [createDebt({ balance: 1000 })]
		});

		const change = calculateMonthlyChange(previous, current);
		expect(change.change_pounds).toBe(3000);
		expect(change.change_percent).toBeCloseTo(37.5);
	});
});

describe('findPreviousMonth', () => {
	it('finds the immediately preceding month', () => {
		const jan = createMonthlyEntry({ month: 1, year: 2026 });
		const feb = createMonthlyEntry({ month: 2, year: 2026 });
		const mar = createMonthlyEntry({ month: 3, year: 2026 });

		const entries = [jan, feb, mar];
		expect(findPreviousMonth(entries, mar)).toBe(feb);
	});

	it('returns null when given the earliest month', () => {
		const jan = createMonthlyEntry({ month: 1, year: 2026 });
		const feb = createMonthlyEntry({ month: 2, year: 2026 });

		const entries = [jan, feb];
		expect(findPreviousMonth(entries, jan)).toBeNull();
	});

	it('handles months across year boundaries', () => {
		const dec = createMonthlyEntry({ month: 12, year: 2025 });
		const jan = createMonthlyEntry({ month: 1, year: 2026 });

		const entries = [dec, jan];
		expect(findPreviousMonth(entries, jan)).toBe(dec);
	});

	it('works with unsorted entries', () => {
		const jan = createMonthlyEntry({ month: 1, year: 2026 });
		const mar = createMonthlyEntry({ month: 3, year: 2026 });
		const feb = createMonthlyEntry({ month: 2, year: 2026 });

		const entries = [mar, jan, feb];
		expect(findPreviousMonth(entries, mar)).toBe(feb);
	});

	it('skips gaps in the recording', () => {
		const jan = createMonthlyEntry({ month: 1, year: 2026 });
		const apr = createMonthlyEntry({ month: 4, year: 2026 });

		const entries = [jan, apr];
		expect(findPreviousMonth(entries, apr)).toBe(jan);
	});

	it('returns null when entries array is empty', () => {
		const mar = createMonthlyEntry({ month: 3, year: 2026 });
		expect(findPreviousMonth([], mar)).toBeNull();
	});

	it('handles target month not in the entries', () => {
		const jan = createMonthlyEntry({ month: 1, year: 2026 });
		const mar = createMonthlyEntry({ month: 3, year: 2026 });
		const feb = createMonthlyEntry({ month: 2, year: 2026 });

		const entries = [jan, mar];
		// Looking for previous month to Feb, even though Feb is not in the entries
		expect(findPreviousMonth(entries, feb)).toBe(jan);
	});

	it('correctly orders months with leading zeros', () => {
		const sep = createMonthlyEntry({ month: 9, year: 2026 });
		const oct = createMonthlyEntry({ month: 10, year: 2026 });
		const nov = createMonthlyEntry({ month: 11, year: 2026 });

		const entries = [sep, oct, nov];
		expect(findPreviousMonth(entries, nov)).toBe(oct);
		expect(findPreviousMonth(entries, oct)).toBe(sep);
	});
});
