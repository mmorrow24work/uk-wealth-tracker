import { describe, expect, it } from 'vitest';

import { createProperty } from './model.js';
import {
	propertyCashflow,
	propertyEquity,
	propertyGrossYield,
	propertyPortfolioSummary
} from './property.js';

/* -------------------------------------------------------------------------- */
/* propertyEquity                                                             */
/* -------------------------------------------------------------------------- */

describe('propertyEquity', () => {
	it('is value minus mortgage balance', () => {
		expect(propertyEquity(createProperty({ value: 350_000, mortgage_balance: 200_000 }))).toBe(
			150_000
		);
	});

	it('is the full value when there is no mortgage', () => {
		expect(propertyEquity(createProperty({ value: 250_000, mortgage_balance: 0 }))).toBe(250_000);
	});

	it('can be negative — negative equity is a real state, not an error', () => {
		expect(propertyEquity(createProperty({ value: 180_000, mortgage_balance: 200_000 }))).toBe(
			-20_000
		);
	});

	it('is tolerant of a missing or malformed property rather than throwing', () => {
		expect(propertyEquity(undefined)).toBe(0);
		expect(propertyEquity(null)).toBe(0);
		expect(propertyEquity({})).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* propertyCashflow                                                           */
/* -------------------------------------------------------------------------- */

describe('propertyCashflow', () => {
	it('is rent minus running costs minus the mortgage payment', () => {
		const property = createProperty({
			rental_income: 1_500,
			running_costs: 200,
			monthly_payment: 900
		});
		expect(propertyCashflow(property)).toBe(400);
	});

	it('is negative when the mortgage and costs outweigh the rent', () => {
		const property = createProperty({
			rental_income: 900,
			running_costs: 150,
			monthly_payment: 1_200
		});
		expect(propertyCashflow(property)).toBe(-450);
	});

	it('is zero on a property with no rent and no outgoings', () => {
		expect(propertyCashflow(createProperty())).toBe(0);
	});

	it('is tolerant of a missing or malformed property rather than throwing', () => {
		expect(propertyCashflow(undefined)).toBe(0);
		expect(propertyCashflow(null)).toBe(0);
		expect(propertyCashflow({})).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* propertyGrossYield                                                        */
/* -------------------------------------------------------------------------- */

describe('propertyGrossYield', () => {
	it('is annualised rent as a percentage of value, before costs', () => {
		// £1,500/mo × 12 = £18,000/yr on £300,000 = 6%.
		const property = createProperty({ value: 300_000, rental_income: 1_500, running_costs: 1_000 });
		expect(propertyGrossYield(property)).toBe(6);
	});

	it('is null when value is zero or negative — nothing to divide by', () => {
		expect(propertyGrossYield(createProperty({ value: 0, rental_income: 1_000 }))).toBeNull();
	});

	it('is zero on a property with no rental income', () => {
		expect(propertyGrossYield(createProperty({ value: 300_000, rental_income: 0 }))).toBe(0);
	});

	it('is tolerant of a missing or malformed property rather than throwing', () => {
		expect(propertyGrossYield(undefined)).toBeNull();
		expect(propertyGrossYield(null)).toBeNull();
		expect(propertyGrossYield({})).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* propertyPortfolioSummary                                                   */
/* -------------------------------------------------------------------------- */

describe('propertyPortfolioSummary', () => {
	it('totals value, mortgage balance and equity across the whole list', () => {
		const summary = propertyPortfolioSummary([
			createProperty({ value: 300_000, mortgage_balance: 180_000 }),
			createProperty({ value: 200_000, mortgage_balance: 50_000 })
		]);

		expect(summary.count).toBe(2);
		expect(summary.totalValue).toBe(500_000);
		expect(summary.totalMortgageBalance).toBe(230_000);
		expect(summary.totalEquity).toBe(270_000);
	});

	it('splits the totals by the include_in_net_worth toggle', () => {
		const summary = propertyPortfolioSummary([
			createProperty({ value: 300_000, mortgage_balance: 180_000, include_in_net_worth: true }),
			createProperty({ value: 200_000, mortgage_balance: 0, include_in_net_worth: false })
		]);

		expect(summary.includedInNetWorth.count).toBe(1);
		expect(summary.includedInNetWorth.equity).toBe(120_000);
		expect(summary.excludedFromNetWorth.count).toBe(1);
		expect(summary.excludedFromNetWorth.equity).toBe(200_000);
	});

	it('treats every property as included when the list is empty', () => {
		const summary = propertyPortfolioSummary([]);
		expect(summary.count).toBe(0);
		expect(summary.totalEquity).toBe(0);
		expect(summary.includedInNetWorth).toEqual({
			count: 0,
			value: 0,
			mortgageBalance: 0,
			equity: 0
		});
	});

	it('is tolerant of a missing or malformed list rather than throwing', () => {
		expect(propertyPortfolioSummary(undefined).count).toBe(0);
		// @ts-expect-error — deliberately the wrong type.
		expect(propertyPortfolioSummary(null).count).toBe(0);
	});
});
