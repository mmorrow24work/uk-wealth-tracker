import { describe, it, expect } from 'vitest';
import {
	sumInvestmentValues,
	sumDebtBalances,
	calculateNetWorth,
	calculateMonthOnMonthChange,
	formatMonthOnMonthChange
} from './net-worth.js';
import { createInvestment, createDebt, createMonthlyEntry } from './model.js';

describe('net-worth', () => {
	describe('sumInvestmentValues', () => {
		it('sums investment values', () => {
			const investments = [
				createInvestment({ value: 1000 }),
				createInvestment({ value: 500 }),
				createInvestment({ value: 200 })
			];
			expect(sumInvestmentValues(investments)).toBe(1700);
		});

		it('uses full value regardless of ownership_pct (for D/I ratio purposes)', () => {
			const investments = [
				createInvestment({ value: 1000, ownership_pct: 100 }),
				createInvestment({ value: 1000, ownership_pct: 50 })
			];
			expect(sumInvestmentValues(investments)).toBe(2000);
		});

		it('excludes investments flagged exclude_from_net_worth by default', () => {
			const investments = [
				createInvestment({ value: 1000, exclude_from_net_worth: false }),
				createInvestment({ value: 500, exclude_from_net_worth: true })
			];
			expect(sumInvestmentValues(investments)).toBe(1000);
		});

		it('includes excluded investments when includeExcluded option is true', () => {
			const investments = [
				createInvestment({ value: 1000, exclude_from_net_worth: false }),
				createInvestment({ value: 500, exclude_from_net_worth: true })
			];
			expect(sumInvestmentValues(investments, { includeExcluded: true })).toBe(1500);
		});

		it('handles empty array', () => {
			expect(sumInvestmentValues([])).toBe(0);
		});

		it('handles all excluded investments', () => {
			const investments = [
				createInvestment({ value: 1000, exclude_from_net_worth: true }),
				createInvestment({ value: 500, exclude_from_net_worth: true })
			];
			expect(sumInvestmentValues(investments)).toBe(0);
		});

		it('ignores ownership_pct (D/I ratio uses full value)', () => {
			const investments = [createInvestment({ value: 1000, ownership_pct: 33.33 })];
			expect(sumInvestmentValues(investments)).toBe(1000);
		});
	});

	describe('sumDebtBalances', () => {
		it('sums debt balances', () => {
			const debts = [
				createDebt({ balance: 1000 }),
				createDebt({ balance: 500 }),
				createDebt({ balance: 200 })
			];
			expect(sumDebtBalances(debts)).toBe(1700);
		});

		it('excludes debts flagged exclude_from_net_worth by default', () => {
			const debts = [
				createDebt({ balance: 1000, exclude_from_net_worth: false }),
				createDebt({ balance: 500, exclude_from_net_worth: true })
			];
			expect(sumDebtBalances(debts)).toBe(1000);
		});

		it('includes excluded debts when includeExcluded option is true', () => {
			const debts = [
				createDebt({ balance: 1000, exclude_from_net_worth: false }),
				createDebt({ balance: 500, exclude_from_net_worth: true })
			];
			expect(sumDebtBalances(debts, { includeExcluded: true })).toBe(1500);
		});

		it('handles empty array', () => {
			expect(sumDebtBalances([])).toBe(0);
		});

		it('handles all excluded debts', () => {
			const debts = [
				createDebt({ balance: 1000, exclude_from_net_worth: true }),
				createDebt({ balance: 500, exclude_from_net_worth: true })
			];
			expect(sumDebtBalances(debts)).toBe(0);
		});
	});

	describe('calculateNetWorth', () => {
		it('calculates net worth as investments minus debts', () => {
			const entry = createMonthlyEntry({
				investments: [createInvestment({ value: 10000 }), createInvestment({ value: 5000 })],
				debts: [createDebt({ balance: 2000 })]
			});
			expect(calculateNetWorth(entry)).toBe(13000);
		});

		it('respects exclude_from_net_worth flags', () => {
			const entry = createMonthlyEntry({
				investments: [
					createInvestment({ value: 10000, exclude_from_net_worth: false }),
					createInvestment({ value: 5000, exclude_from_net_worth: true })
				],
				debts: [
					createDebt({ balance: 2000, exclude_from_net_worth: false }),
					createDebt({ balance: 1000, exclude_from_net_worth: true })
				]
			});
			expect(calculateNetWorth(entry)).toBe(8000);
		});

		it('handles negative net worth (debts > investments)', () => {
			const entry = createMonthlyEntry({
				investments: [createInvestment({ value: 5000 })],
				debts: [createDebt({ balance: 10000 })]
			});
			expect(calculateNetWorth(entry)).toBe(-5000);
		});

		it('handles zero net worth', () => {
			const entry = createMonthlyEntry({
				investments: [createInvestment({ value: 5000 })],
				debts: [createDebt({ balance: 5000 })]
			});
			expect(calculateNetWorth(entry)).toBe(0);
		});

		it('handles empty investments and debts', () => {
			const entry = createMonthlyEntry({
				investments: [],
				debts: []
			});
			expect(calculateNetWorth(entry)).toBe(0);
		});
	});

	describe('calculateMonthOnMonthChange', () => {
		const previousEntry = createMonthlyEntry({
			investments: [createInvestment({ value: 10000 })],
			debts: [createDebt({ balance: 2000 })]
		});

		it('returns null when no previous entry', () => {
			const currentEntry = createMonthlyEntry({
				investments: [createInvestment({ value: 12000 })],
				debts: [createDebt({ balance: 2000 })]
			});
			expect(calculateMonthOnMonthChange(currentEntry, undefined)).toBe(null);
		});

		it('calculates positive change in pounds and percent', () => {
			const currentEntry = createMonthlyEntry({
				investments: [createInvestment({ value: 12000 })],
				debts: [createDebt({ balance: 2000 })]
			});
			const change = calculateMonthOnMonthChange(currentEntry, previousEntry);
			expect(change).toEqual({
				currentNetWorth: 10000,
				previousNetWorth: 8000,
				changeInPounds: 2000,
				changePercent: 25
			});
		});

		it('calculates negative change in pounds and percent', () => {
			const currentEntry = createMonthlyEntry({
				investments: [createInvestment({ value: 8000 })],
				debts: [createDebt({ balance: 2000 })]
			});
			const change = calculateMonthOnMonthChange(currentEntry, previousEntry);
			expect(change).toEqual({
				currentNetWorth: 6000,
				previousNetWorth: 8000,
				changeInPounds: -2000,
				changePercent: -25
			});
		});

		it('calculates fractional percentage changes', () => {
			const currentEntry = createMonthlyEntry({
				investments: [createInvestment({ value: 10500 })],
				debts: [createDebt({ balance: 2000 })]
			});
			const change = calculateMonthOnMonthChange(currentEntry, previousEntry);
			expect(change?.changePercent).toBeCloseTo(6.25);
		});

		it('returns null percentage when previous net worth is zero', () => {
			const zeroEntry = createMonthlyEntry({
				investments: [createInvestment({ value: 0 })],
				debts: [createDebt({ balance: 0 })]
			});
			const currentEntry = createMonthlyEntry({
				investments: [createInvestment({ value: 1000 })],
				debts: []
			});
			const change = calculateMonthOnMonthChange(currentEntry, zeroEntry);
			expect(change).toEqual({
				currentNetWorth: 1000,
				previousNetWorth: 0,
				changeInPounds: 1000,
				changePercent: null
			});
		});

		it('handles transition from negative to positive net worth', () => {
			const negativeEntry = createMonthlyEntry({
				investments: [createInvestment({ value: 2000 })],
				debts: [createDebt({ balance: 5000 })]
			});
			const positiveEntry = createMonthlyEntry({
				investments: [createInvestment({ value: 8000 })],
				debts: [createDebt({ balance: 5000 })]
			});
			const change = calculateMonthOnMonthChange(positiveEntry, negativeEntry);
			expect(change?.currentNetWorth).toBe(3000);
			expect(change?.previousNetWorth).toBe(-3000);
			expect(change?.changeInPounds).toBe(6000);
			expect(change?.changePercent).toBe(200);
		});

		it('handles zero change', () => {
			const change = calculateMonthOnMonthChange(previousEntry, previousEntry);
			expect(change).toEqual({
				currentNetWorth: 8000,
				previousNetWorth: 8000,
				changeInPounds: 0,
				changePercent: 0
			});
		});
	});

	describe('formatMonthOnMonthChange', () => {
		it('formats positive change', () => {
			const change = {
				currentNetWorth: 10000,
				previousNetWorth: 8000,
				changeInPounds: 2000,
				changePercent: 25
			};
			expect(formatMonthOnMonthChange(change)).toBe('£+2,000 (+25.00%)');
		});

		it('formats negative change', () => {
			const change = {
				currentNetWorth: 6000,
				previousNetWorth: 8000,
				changeInPounds: -2000,
				changePercent: -25
			};
			expect(formatMonthOnMonthChange(change)).toBe('£-2,000 (-25.00%)');
		});

		it('formats zero change', () => {
			const change = {
				currentNetWorth: 8000,
				previousNetWorth: 8000,
				changeInPounds: 0,
				changePercent: 0
			};
			expect(formatMonthOnMonthChange(change)).toBe('£+0 (+0.00%)');
		});

		it('formats fractional percentages', () => {
			const change = {
				currentNetWorth: 8500,
				previousNetWorth: 8000,
				changeInPounds: 500,
				changePercent: 6.25
			};
			expect(formatMonthOnMonthChange(change)).toBe('£+500 (+6.25%)');
		});

		it('formats change with 1 decimal place', () => {
			const change = {
				currentNetWorth: 8500,
				previousNetWorth: 8000,
				changeInPounds: 500,
				changePercent: 6.25
			};
			expect(formatMonthOnMonthChange(change, { decimalPlaces: 1 })).toBe('£+500 (+6.3%)');
		});

		it('formats change with 3 decimal places', () => {
			const change = {
				currentNetWorth: 8003.33,
				previousNetWorth: 8000,
				changeInPounds: 3.33,
				changePercent: 0.041625
			};
			expect(formatMonthOnMonthChange(change, { decimalPlaces: 3 })).toBe('£+3.33 (+0.042%)');
		});

		it('formats with null percentage', () => {
			const change = {
				currentNetWorth: 1000,
				previousNetWorth: 0,
				changeInPounds: 1000,
				changePercent: null
			};
			expect(formatMonthOnMonthChange(change)).toBe('£+1,000 (no previous data)');
		});

		it('returns null for null input', () => {
			expect(formatMonthOnMonthChange(null)).toBe(null);
		});

		it('respects custom currency symbol', () => {
			const change = {
				currentNetWorth: 10000,
				previousNetWorth: 8000,
				changeInPounds: 2000,
				changePercent: 25
			};
			expect(formatMonthOnMonthChange(change, { currencySymbol: '$' })).toBe('$+2,000 (+25.00%)');
		});

		it('handles large numbers with thousand separators', () => {
			const change = {
				currentNetWorth: 1000000,
				previousNetWorth: 900000,
				changeInPounds: 100000,
				changePercent: 11.111111
			};
			expect(formatMonthOnMonthChange(change)).toBe('£+100,000 (+11.11%)');
		});

		it('handles positive percentage increase in magnitude with negative change', () => {
			const change = {
				currentNetWorth: -5000,
				previousNetWorth: -3000,
				changeInPounds: -2000,
				changePercent: 66.666667
			};
			expect(formatMonthOnMonthChange(change)).toBe('£-2,000 (+66.67%)');
		});
	});

	describe('issue #13 — Month-on-month change display', () => {
		it('calculates month-on-month change correctly for simple case', () => {
			const sept = createMonthlyEntry({
				month: 9,
				year: 2026,
				investments: [createInvestment({ value: 50000 })],
				debts: [createDebt({ balance: 10000 })]
			});
			const oct = createMonthlyEntry({
				month: 10,
				year: 2026,
				investments: [createInvestment({ value: 52000 })],
				debts: [createDebt({ balance: 10000 })]
			});

			const change = calculateMonthOnMonthChange(oct, sept);
			expect(change?.changeInPounds).toBe(2000);
			expect(change?.changePercent).toBeCloseTo(5);
		});

		it('formats display as £+1,234 (+5.2%)', () => {
			const change = {
				currentNetWorth: 26234,
				previousNetWorth: 25000,
				changeInPounds: 1234,
				changePercent: 4.936
			};
			const formatted = formatMonthOnMonthChange(change, { decimalPlaces: 1 });
			expect(formatted).toBe('£+1,234 (+4.9%)');
		});
	});
});
