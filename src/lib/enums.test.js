import { describe, expect, it } from 'vitest';

import {
	ASSET_CATEGORIES,
	ASSET_CATEGORY_LABELS,
	BILL_FREQUENCIES,
	BILL_FREQUENCY_LABELS,
	CASH_INVESTMENT_TYPES,
	CONTRIBUTION_FREQUENCIES,
	CONTRIBUTION_FREQUENCY_LABELS,
	DEBT_TYPES,
	DEBT_TYPE_LABELS,
	DEFINED_BENEFIT_PENSION_TYPES,
	DEFINED_CONTRIBUTION_PENSION_TYPES,
	DIVIDEND_STRATEGIES,
	DIVIDEND_STRATEGY_LABELS,
	INVESTMENT_TYPES,
	INVESTMENT_TYPE_LABELS,
	ISA_WRAPPERS,
	JOURNEY_STAGES,
	JOURNEY_STAGE_LABELS,
	MILESTONE_TYPES,
	MILESTONE_TYPE_LABELS,
	MORTGAGE_TYPES,
	MORTGAGE_TYPE_LABELS,
	PAYMENTS_PER_YEAR,
	PAYOUT_FREQUENCIES,
	PAYOUT_FREQUENCY_LABELS,
	PENSION_POT_TYPES,
	PENSION_TYPES,
	PENSION_TYPE_LABELS,
	PROPERTY_TYPES,
	PROPERTY_TYPE_LABELS,
	STANDARD_MILESTONE_TARGETS,
	TAX_REGIONS,
	TAX_REGION_LABELS,
	TAX_SHELTERED_WRAPPERS,
	WRAPPERS,
	WRAPPER_LABELS
} from './enums.js';

/** @type {[string, readonly string[], Record<string, string>][]} */
const ENUMS_WITH_LABELS = [
	['journey stage', JOURNEY_STAGES, JOURNEY_STAGE_LABELS],
	['tax region', TAX_REGIONS, TAX_REGION_LABELS],
	['investment type', INVESTMENT_TYPES, INVESTMENT_TYPE_LABELS],
	['wrapper', WRAPPERS, WRAPPER_LABELS],
	['debt type', DEBT_TYPES, DEBT_TYPE_LABELS],
	['contribution frequency', CONTRIBUTION_FREQUENCIES, CONTRIBUTION_FREQUENCY_LABELS],
	['payout frequency', PAYOUT_FREQUENCIES, PAYOUT_FREQUENCY_LABELS],
	['bill frequency', BILL_FREQUENCIES, BILL_FREQUENCY_LABELS],
	['pension type', PENSION_TYPES, PENSION_TYPE_LABELS],
	['property type', PROPERTY_TYPES, PROPERTY_TYPE_LABELS],
	['mortgage type', MORTGAGE_TYPES, MORTGAGE_TYPE_LABELS],
	['asset category', ASSET_CATEGORIES, ASSET_CATEGORY_LABELS],
	['dividend strategy', DIVIDEND_STRATEGIES, DIVIDEND_STRATEGY_LABELS],
	['milestone type', MILESTONE_TYPES, MILESTONE_TYPE_LABELS]
];

describe.each(ENUMS_WITH_LABELS)('%s', (_name, values, labels) => {
	it('has no duplicate codes', () => {
		expect(new Set(values).size).toBe(values.length);
	});

	it('uses snake_case codes', () => {
		for (const value of values) expect(value).toMatch(/^[a-z][a-z0-9_]*$/);
	});

	it('has exactly one label per code', () => {
		expect(Object.keys(labels).sort()).toEqual([...values].sort());
		for (const value of values) expect(labels[value]).toBeTruthy();
	});

	it('is frozen so a tab cannot mutate it', () => {
		expect(Object.isFrozen(values)).toBe(true);
		expect(Object.isFrozen(labels)).toBe(true);
	});
});

describe('enum subsets', () => {
	/** @type {[string, readonly string[], readonly string[]][]} */
	const subsets = [
		['ISA wrappers', ISA_WRAPPERS, WRAPPERS],
		['tax-sheltered wrappers', TAX_SHELTERED_WRAPPERS, WRAPPERS],
		['cash investment types', CASH_INVESTMENT_TYPES, INVESTMENT_TYPES],
		['defined benefit pension types', DEFINED_BENEFIT_PENSION_TYPES, PENSION_TYPES],
		['defined contribution pension types', DEFINED_CONTRIBUTION_PENSION_TYPES, PENSION_TYPES],
		['pension pot types', PENSION_POT_TYPES, PENSION_TYPES]
	];

	it.each(subsets)('%s are drawn from the parent enum', (_name, subset, parent) => {
		for (const value of subset) expect(parent).toContain(value);
	});

	it('excludes the State Pension from the pot tracker types', () => {
		expect(PENSION_POT_TYPES).not.toContain('state');
		expect(PENSION_POT_TYPES).toHaveLength(PENSION_TYPES.length - 1);
	});

	it('keeps the two pension flavours apart — a pot is not a promise', () => {
		for (const type of DEFINED_CONTRIBUTION_PENSION_TYPES) {
			expect(DEFINED_BENEFIT_PENSION_TYPES).not.toContain(type);
		}
		// A Lifetime ISA is a pot, but it is drawn tax-free after 60, so the income stream builder
		// treats it as an ISA withdrawal rather than as pension income.
		expect(DEFINED_CONTRIBUTION_PENSION_TYPES).not.toContain('lisa');
		expect(DEFINED_CONTRIBUTION_PENSION_TYPES).not.toContain('state');
	});

	it('lists all six UK ISA wrappers', () => {
		expect(ISA_WRAPPERS).toHaveLength(6);
	});

	it('treats every ISA wrapper as tax sheltered', () => {
		for (const wrapper of ISA_WRAPPERS) expect(TAX_SHELTERED_WRAPPERS).toContain(wrapper);
	});

	it('does not shelter a general investment account', () => {
		expect(TAX_SHELTERED_WRAPPERS).not.toContain('gia');
	});
});

describe('PAYMENTS_PER_YEAR', () => {
	it('covers every frequency code in use', () => {
		const frequencies = [...CONTRIBUTION_FREQUENCIES, ...PAYOUT_FREQUENCIES, ...BILL_FREQUENCIES];
		for (const frequency of frequencies) {
			expect(PAYMENTS_PER_YEAR).toHaveProperty(frequency);
		}
	});

	it('annualises the recurring frequencies correctly', () => {
		expect(PAYMENTS_PER_YEAR.weekly).toBe(52);
		expect(PAYMENTS_PER_YEAR.monthly).toBe(12);
		expect(PAYMENTS_PER_YEAR.quarterly).toBe(4);
		expect(PAYMENTS_PER_YEAR.semi_annually).toBe(2);
		expect(PAYMENTS_PER_YEAR.annually).toBe(1);
	});

	it('treats a one-off contribution as recurring zero times a year', () => {
		expect(PAYMENTS_PER_YEAR.one_off).toBe(0);
	});
});

describe('STANDARD_MILESTONE_TARGETS', () => {
	it('matches the milestones named in README.md', () => {
		expect([...STANDARD_MILESTONE_TARGETS]).toEqual([
			10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000
		]);
	});

	it('is ordered smallest first', () => {
		const sorted = [...STANDARD_MILESTONE_TARGETS].sort((a, b) => a - b);
		expect([...STANDARD_MILESTONE_TARGETS]).toEqual(sorted);
	});
});
