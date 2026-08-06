import { describe, it, expect } from 'vitest';
import { calculateNetWorth, transformNetWorthData } from './net-worth.js';

describe('calculateNetWorth', () => {
	it('returns 0 for empty entry', () => {
		/** @type {Partial<import('./types.js').MonthlyEntry>} */
		const entry = {};
		expect(calculateNetWorth(entry)).toBe(0);
	});

	it('returns 0 for null entry', () => {
		expect(calculateNetWorth(null)).toBe(0);
	});

	it('calculates net worth as investments minus debts', () => {
		/** @type {Partial<import('./types.js').MonthlyEntry>} */
		const entry = {
			investments: /** @type {any} */ ([{ value: 10000 }, { value: 5000 }]),
			debts: /** @type {any} */ ([{ balance: 2000 }])
		};
		expect(calculateNetWorth(entry)).toBe(13000);
	});

	it('handles missing investments array', () => {
		/** @type {Partial<import('./types.js').MonthlyEntry>} */
		const entry = { debts: /** @type {any} */ ([{ balance: 1000 }]) };
		expect(calculateNetWorth(entry)).toBe(-1000);
	});

	it('handles missing debts array', () => {
		/** @type {Partial<import('./types.js').MonthlyEntry>} */
		const entry = { investments: /** @type {any} */ ([{ value: 5000 }]) };
		expect(calculateNetWorth(entry)).toBe(5000);
	});

	it('handles null values in investments', () => {
		/** @type {Partial<import('./types.js').MonthlyEntry>} */
		const entry = {
			investments: /** @type {any} */ ([{ value: 1000 }, { value: null }]),
			debts: []
		};
		expect(calculateNetWorth(entry)).toBe(1000);
	});
});

describe('transformNetWorthData', () => {
	it('returns empty array for null entries', () => {
		expect(transformNetWorthData(null)).toEqual([]);
	});

	it('transforms monthly entries into chart data', () => {
		/** @type {import('./types.js').MonthlyEntry[]} */
		const entries = [
			{
				id: '1',
				month: 1,
				year: 2024,
				investments: [{ id: '1', name: 'Test', type: 'shares', wrapper: 'isa_stocks_shares', value: 10000, bought_for: null, year_purchased: null, monthly_contribution: 0, contribution_frequency: 'monthly', fund_fee: 0, notes: '', exclude_from_net_worth: false, ownership_pct: 100 }],
				debts: [{ id: '1', name: 'Test', type: 'credit_card', balance: 1000, notes: '', exclude_from_net_worth: false }],
				auto_filled: false
			},
			{
				id: '2',
				month: 2,
				year: 2024,
				investments: [{ id: '1', name: 'Test', type: 'shares', wrapper: 'isa_stocks_shares', value: 11000, bought_for: null, year_purchased: null, monthly_contribution: 0, contribution_frequency: 'monthly', fund_fee: 0, notes: '', exclude_from_net_worth: false, ownership_pct: 100 }],
				debts: [{ id: '1', name: 'Test', type: 'credit_card', balance: 900, notes: '', exclude_from_net_worth: false }],
				auto_filled: false
			}
		];

		const result = transformNetWorthData(entries);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			month: 1,
			year: 2024,
			netWorth: 9000
		});
		expect(result[0].date).toEqual(new Date(2024, 0, 1));
		expect(result[1]).toMatchObject({
			month: 2,
			year: 2024,
			netWorth: 10100
		});
		expect(result[1].date).toEqual(new Date(2024, 1, 1));
	});
});
