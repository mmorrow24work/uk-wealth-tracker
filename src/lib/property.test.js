import { describe, expect, it } from 'vitest';

import { createProperty } from './model.js';
import {
	dealExpiryStatus,
	DEAL_EXPIRY_WARNING_DAYS,
	propertyCashflow,
	propertyEquity,
	propertyEquityProjection,
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

/* -------------------------------------------------------------------------- */
/* dealExpiryStatus                                                           */
/* -------------------------------------------------------------------------- */

describe('dealExpiryStatus', () => {
	const now = new Date('2026-08-07T12:00:00.000Z');

	it('is "none" when there is no deal_expiry recorded', () => {
		expect(dealExpiryStatus(null, now)).toEqual({ status: 'none', daysRemaining: null });
		expect(dealExpiryStatus(undefined, now)).toEqual({ status: 'none', daysRemaining: null });
		expect(dealExpiryStatus('', now)).toEqual({ status: 'none', daysRemaining: null });
	});

	it('is "ok" comfortably outside the warning window', () => {
		const result = dealExpiryStatus('2027-06-30', now);
		expect(result.status).toBe('ok');
		expect(result.daysRemaining).toBeGreaterThan(DEAL_EXPIRY_WARNING_DAYS);
	});

	it('is "amber" exactly at the warning boundary', () => {
		// 90 days after 2026-08-07 is 2026-11-05.
		expect(dealExpiryStatus('2026-11-05', now)).toEqual({ status: 'amber', daysRemaining: 90 });
	});

	it('is "amber" inside the warning window', () => {
		const result = dealExpiryStatus('2026-09-01', now);
		expect(result.status).toBe('amber');
		expect(result.daysRemaining).toBe(25);
	});

	it('is "ok" one day outside the warning window', () => {
		// 91 days after 2026-08-07 is 2026-11-06.
		expect(dealExpiryStatus('2026-11-06', now)).toEqual({ status: 'ok', daysRemaining: 91 });
	});

	it('is "red" with a negative days-remaining once the deal has expired', () => {
		expect(dealExpiryStatus('2026-01-01', now)).toEqual({ status: 'red', daysRemaining: -218 });
	});

	it('is "red" on the day it expires only once the date has passed, and "amber" on the day itself', () => {
		expect(dealExpiryStatus('2026-08-07', now)).toEqual({ status: 'amber', daysRemaining: 0 });
	});

	it('is tolerant of a malformed date rather than throwing', () => {
		expect(dealExpiryStatus('not-a-date', now)).toEqual({ status: 'none', daysRemaining: null });
	});

	it('defaults "now" to the real clock when none is given', () => {
		const farFuture = dealExpiryStatus('2200-01-01');
		expect(farFuture.status).toBe('ok');
	});
});

/* -------------------------------------------------------------------------- */
/* propertyEquityProjection                                                   */
/* -------------------------------------------------------------------------- */

describe('propertyEquityProjection', () => {
	it('returns years + 1 points, starting at today’s equity', () => {
		const property = createProperty({ value: 300_000, mortgage_balance: 180_000 });
		const points = propertyEquityProjection(property, 30);

		expect(points).toHaveLength(31);
		expect(points[0]).toEqual({
			year: 0,
			value: 300_000,
			mortgageBalance: 180_000,
			equity: 120_000
		});
	});

	it('compounds value at growth_rate, annually', () => {
		const property = createProperty({ value: 100_000, mortgage_balance: 0, growth_rate: 3 });
		const points = propertyEquityProjection(property, 1);

		// (1.03/12 geometric monthly)^12 = 1.03 to within rounding.
		expect(points[1].value).toBeCloseTo(103_000, 0);
	});

	it('amortises the mortgage balance down when a monthly payment is recorded', () => {
		const property = createProperty({
			value: 300_000,
			mortgage_balance: 200_000,
			interest_rate: 4,
			monthly_payment: 1_500,
			growth_rate: 0
		});
		const points = propertyEquityProjection(property, 10);

		expect(points[10].mortgageBalance).toBeLessThan(200_000);
		expect(points[10].equity).toBeGreaterThan(points[0].equity);
	});

	it('floors the mortgage balance at zero rather than going negative', () => {
		const property = createProperty({
			value: 300_000,
			mortgage_balance: 5_000,
			interest_rate: 2,
			monthly_payment: 2_000,
			growth_rate: 0
		});
		const points = propertyEquityProjection(property, 2);

		expect(points[1].mortgageBalance).toBe(0);
		expect(points[2].mortgageBalance).toBe(0);
	});

	it('carries the mortgage balance forward unchanged when there is no monthly payment on record', () => {
		const property = createProperty({
			value: 300_000,
			mortgage_balance: 200_000,
			interest_rate: 4,
			monthly_payment: 0,
			growth_rate: 0
		});
		const points = propertyEquityProjection(property, 30);

		expect(points.every((point) => point.mortgageBalance === 200_000)).toBe(true);
	});

	it('grows the balance when the payment does not cover the interest — negative amortisation', () => {
		const property = createProperty({
			value: 300_000,
			mortgage_balance: 200_000,
			interest_rate: 10,
			monthly_payment: 100,
			growth_rate: 0
		});
		const points = propertyEquityProjection(property, 5);

		expect(points[5].mortgageBalance).toBeGreaterThan(200_000);
	});

	it('defaults to a 30-year horizon', () => {
		const points = propertyEquityProjection(createProperty({ value: 100_000 }));
		expect(points).toHaveLength(31);
	});

	it('is tolerant of a missing or malformed property rather than throwing', () => {
		expect(propertyEquityProjection(undefined, 5)).toHaveLength(6);
		expect(propertyEquityProjection(null, 5)).toHaveLength(6);
		expect(propertyEquityProjection({}, 5)[0]).toEqual({
			year: 0,
			value: 0,
			mortgageBalance: 0,
			equity: 0
		});
	});

	it('clamps a negative or oversized horizon rather than throwing', () => {
		expect(propertyEquityProjection(createProperty({ value: 100_000 }), -5)).toHaveLength(1);
	});
});
