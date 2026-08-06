import { describe, expect, it } from 'vitest';

import { createDebt, createInvestment } from './model.js';
import {
	DEBT_TO_INVESTMENT_STATUS_LABELS,
	DEBT_TO_INVESTMENT_THRESHOLDS,
	debtToInvestmentRatio,
	debtToInvestmentStatus,
	sumDebtBalances,
	sumInvestmentValues
} from './debt.js';

describe('sumDebtBalances', () => {
	it('adds up every debt balance', () => {
		const debts = [createDebt({ balance: 1000 }), createDebt({ balance: 2500 })];
		expect(sumDebtBalances(debts)).toBe(3500);
	});

	it('returns 0 for an empty list', () => {
		expect(sumDebtBalances([])).toBe(0);
	});

	it('excludes a debt flagged exclude_from_net_worth by default', () => {
		const debts = [
			createDebt({ balance: 200_000, type: 'mortgage', exclude_from_net_worth: true }),
			createDebt({ balance: 1000, type: 'credit_card' })
		];
		expect(sumDebtBalances(debts)).toBe(1000);
	});

	it('includes excluded debts when includeExcluded is set', () => {
		const debts = [createDebt({ balance: 200_000, exclude_from_net_worth: true })];
		expect(sumDebtBalances(debts, { includeExcluded: true })).toBe(200_000);
	});
});

describe('sumInvestmentValues', () => {
	it('adds up every holding value', () => {
		const investments = [createInvestment({ value: 10_000 }), createInvestment({ value: 5_000 })];
		expect(sumInvestmentValues(investments)).toBe(15_000);
	});

	it('returns 0 for an empty list', () => {
		expect(sumInvestmentValues([])).toBe(0);
	});

	it('excludes a holding flagged exclude_from_net_worth by default', () => {
		const investments = [
			createInvestment({ value: 300_000, exclude_from_net_worth: true }),
			createInvestment({ value: 5_000 })
		];
		expect(sumInvestmentValues(investments)).toBe(5_000);
	});

	it('includes excluded holdings when includeExcluded is set', () => {
		const investments = [createInvestment({ value: 300_000, exclude_from_net_worth: true })];
		expect(sumInvestmentValues(investments, { includeExcluded: true })).toBe(300_000);
	});
});

describe('debtToInvestmentRatio', () => {
	it('is a percentage of debt over investments', () => {
		const investments = [createInvestment({ value: 10_000 })];
		const debts = [createDebt({ balance: 1_400 })];
		expect(debtToInvestmentRatio(investments, debts)).toBeCloseTo(14, 10);
	});

	it('is 0 when there is no debt at all', () => {
		const investments = [createInvestment({ value: 10_000 })];
		expect(debtToInvestmentRatio(investments, [])).toBe(0);
	});

	it('is null when there are no investments to divide by', () => {
		const debts = [createDebt({ balance: 1_000 })];
		expect(debtToInvestmentRatio([], debts)).toBeNull();
	});

	it('is null when tracked investment value is zero even with holdings present', () => {
		const investments = [createInvestment({ value: 0 })];
		const debts = [createDebt({ balance: 1_000 })];
		expect(debtToInvestmentRatio(investments, debts)).toBeNull();
	});

	it('is null when total investment value is zero because everything is excluded', () => {
		const investments = [createInvestment({ value: 10_000, exclude_from_net_worth: true })];
		const debts = [createDebt({ balance: 500 })];
		expect(debtToInvestmentRatio(investments, debts)).toBeNull();
	});

	it('leaves a mortgage already excluded from net worth out of the ratio', () => {
		const investments = [createInvestment({ value: 50_000 })];
		const debts = [
			createDebt({ balance: 250_000, type: 'mortgage', exclude_from_net_worth: true }),
			createDebt({ balance: 5_000, type: 'credit_card' })
		];
		expect(debtToInvestmentRatio(investments, debts)).toBeCloseTo(10, 10);
	});

	it('can exceed 100% when debt outweighs investments', () => {
		const investments = [createInvestment({ value: 1_000 })];
		const debts = [createDebt({ balance: 5_000 })];
		expect(debtToInvestmentRatio(investments, debts)).toBeCloseTo(500, 10);
	});
});

describe('debtToInvestmentStatus', () => {
	it('is healthy below the healthy threshold', () => {
		expect(debtToInvestmentStatus(0)).toBe('healthy');
		expect(debtToInvestmentStatus(13.99)).toBe('healthy');
	});

	it('is moderate at and between the two thresholds', () => {
		expect(debtToInvestmentStatus(DEBT_TO_INVESTMENT_THRESHOLDS.healthy)).toBe('moderate');
		expect(debtToInvestmentStatus(16)).toBe('moderate');
		expect(debtToInvestmentStatus(DEBT_TO_INVESTMENT_THRESHOLDS.concern)).toBe('moderate');
	});

	it('is a concern above the concern threshold', () => {
		expect(debtToInvestmentStatus(18.01)).toBe('concern');
		expect(debtToInvestmentStatus(500)).toBe('concern');
	});

	it('is unknown for a null ratio', () => {
		expect(debtToInvestmentStatus(null)).toBe('unknown');
	});

	it('is unknown for a non-finite ratio', () => {
		expect(debtToInvestmentStatus(Number.POSITIVE_INFINITY)).toBe('unknown');
		expect(debtToInvestmentStatus(Number.NaN)).toBe('unknown');
	});

	it('has a label for every status it can return, plus unknown', () => {
		expect(Object.keys(DEBT_TO_INVESTMENT_STATUS_LABELS).sort()).toEqual([
			'concern',
			'healthy',
			'moderate',
			'unknown'
		]);
		for (const label of Object.values(DEBT_TO_INVESTMENT_STATUS_LABELS)) {
			expect(label).toBeTruthy();
		}
	});
});

describe('DEBT_TO_INVESTMENT_THRESHOLDS', () => {
	it('matches README.md verbatim (<14% healthy, >18% concern)', () => {
		expect(DEBT_TO_INVESTMENT_THRESHOLDS).toEqual({ healthy: 14, concern: 18 });
	});

	it('is frozen so a tab cannot mutate the shared thresholds', () => {
		expect(Object.isFrozen(DEBT_TO_INVESTMENT_THRESHOLDS)).toBe(true);
	});
});
