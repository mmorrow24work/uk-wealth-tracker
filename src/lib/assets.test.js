import { describe, expect, it } from 'vitest';

import {
	assetCAGR,
	assetFutureValue,
	assetGainLoss,
	assetHoldingCostToDate,
	assetHoldingYears,
	assetNetPosition,
	assetPortfolioProjection,
	assetPortfolioSummary
} from './assets.js';
import { createAsset } from './model.js';

const NOW = new Date('2026-08-07T00:00:00Z');

/* -------------------------------------------------------------------------- */
/* assetGainLoss                                                              */
/* -------------------------------------------------------------------------- */

describe('assetGainLoss', () => {
	it('is current value minus purchase price', () => {
		expect(assetGainLoss(createAsset({ purchase_price: 5_000, current_value: 8_000 }))).toBe(3_000);
	});

	it('is negative for a depreciating asset', () => {
		expect(assetGainLoss(createAsset({ purchase_price: 30_000, current_value: 18_000 }))).toBe(
			-12_000
		);
	});

	it('is tolerant of a missing or malformed asset rather than throwing', () => {
		expect(assetGainLoss(undefined)).toBe(0);
		expect(assetGainLoss(null)).toBe(0);
		expect(assetGainLoss({})).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* assetHoldingYears                                                          */
/* -------------------------------------------------------------------------- */

describe('assetHoldingYears', () => {
	it('is the elapsed time between purchase_date and the reference date, in years', () => {
		const years = assetHoldingYears(createAsset({ purchase_date: '2021-08-07' }), NOW);
		expect(years).not.toBeNull();
		expect(years).toBeCloseTo(5, 1);
	});

	it('is null with no purchase_date recorded', () => {
		expect(assetHoldingYears(createAsset({ purchase_date: null }), NOW)).toBeNull();
	});

	it('is null when purchase_date has not happened yet', () => {
		expect(assetHoldingYears(createAsset({ purchase_date: '2027-01-01' }), NOW)).toBeNull();
	});

	it('is null on the purchase date itself — no elapsed time to annualise from', () => {
		expect(assetHoldingYears(createAsset({ purchase_date: '2026-08-07' }), NOW)).toBeNull();
	});

	it('is tolerant of a missing or malformed asset rather than throwing', () => {
		expect(assetHoldingYears(undefined, NOW)).toBeNull();
		expect(assetHoldingYears(null, NOW)).toBeNull();
		expect(assetHoldingYears({}, NOW)).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* assetCAGR                                                                  */
/* -------------------------------------------------------------------------- */

describe('assetCAGR', () => {
	it('is the annualised compound growth rate from purchase price to current value', () => {
		// £10,000 -> £16,105.10 over 10 years is 4.9% CAGR.
		const asset = createAsset({
			purchase_price: 10_000,
			current_value: 16_105.1,
			purchase_date: '2016-08-07'
		});
		expect(assetCAGR(asset, NOW)).toBeCloseTo(4.9, 1);
	});

	it('is negative for an asset worth less than it cost', () => {
		const asset = createAsset({
			purchase_price: 20_000,
			current_value: 10_000,
			purchase_date: '2021-08-07'
		});
		const cagr = assetCAGR(asset, NOW);
		expect(cagr).not.toBeNull();
		expect(cagr).toBeLessThan(0);
	});

	it('is null with no purchase_date recorded', () => {
		expect(
			assetCAGR(createAsset({ purchase_price: 10_000, current_value: 12_000 }), NOW)
		).toBeNull();
	});

	it('is null when purchase_price is zero — nothing to compound from', () => {
		const asset = createAsset({
			purchase_price: 0,
			current_value: 1_000,
			purchase_date: '2021-08-07'
		});
		expect(assetCAGR(asset, NOW)).toBeNull();
	});

	it('is -100% when the asset is now worthless', () => {
		const asset = createAsset({
			purchase_price: 5_000,
			current_value: 0,
			purchase_date: '2021-08-07'
		});
		expect(assetCAGR(asset, NOW)).toBe(-100);
	});

	it('is tolerant of a missing or malformed asset rather than throwing', () => {
		expect(assetCAGR(undefined, NOW)).toBeNull();
		expect(assetCAGR(null, NOW)).toBeNull();
		expect(assetCAGR({}, NOW)).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* assetHoldingCostToDate / assetNetPosition                                  */
/* -------------------------------------------------------------------------- */

describe('assetHoldingCostToDate', () => {
	it('is annual holding cost times years held', () => {
		const asset = createAsset({ holding_cost: 200, purchase_date: '2021-08-07' });
		expect(assetHoldingCostToDate(asset, NOW)).toBeCloseTo(1_000, 0);
	});

	it('is zero with no purchase_date recorded, regardless of holding_cost', () => {
		expect(assetHoldingCostToDate(createAsset({ holding_cost: 500 }), NOW)).toBe(0);
	});

	it('is tolerant of a missing or malformed asset rather than throwing', () => {
		expect(assetHoldingCostToDate(undefined, NOW)).toBe(0);
		expect(assetHoldingCostToDate(null, NOW)).toBe(0);
		expect(assetHoldingCostToDate({}, NOW)).toBe(0);
	});
});

describe('assetNetPosition', () => {
	it('is gain/loss minus holding costs incurred so far', () => {
		const asset = createAsset({
			purchase_price: 5_000,
			current_value: 8_000,
			holding_cost: 100,
			purchase_date: '2021-08-07'
		});
		// £3,000 gain minus ~£500 of holding costs over ~5 years.
		expect(assetNetPosition(asset, NOW)).toBeCloseTo(2_500, 0);
	});

	it('can be negative when holding costs outweigh the gain', () => {
		const asset = createAsset({
			purchase_price: 5_000,
			current_value: 5_200,
			holding_cost: 1_000,
			purchase_date: '2021-08-07'
		});
		expect(assetNetPosition(asset, NOW)).toBeLessThan(0);
	});

	it('equals gain/loss when there is no purchase_date to charge holding costs against', () => {
		const asset = createAsset({ purchase_price: 5_000, current_value: 8_000, holding_cost: 100 });
		expect(assetNetPosition(asset, NOW)).toBe(assetGainLoss(asset));
	});

	it('is tolerant of a missing or malformed asset rather than throwing', () => {
		expect(assetNetPosition(undefined, NOW)).toBe(0);
		expect(assetNetPosition(null, NOW)).toBe(0);
		expect(assetNetPosition({}, NOW)).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* assetFutureValue                                                           */
/* -------------------------------------------------------------------------- */

describe('assetFutureValue', () => {
	it('compounds current value forward at the expected growth rate', () => {
		const asset = createAsset({ current_value: 10_000, expected_growth: 5 });
		expect(assetFutureValue(asset, 10)).toBeCloseTo(16_288.95, 1);
	});

	it('is current value unchanged at zero years', () => {
		const asset = createAsset({ current_value: 10_000, expected_growth: 5 });
		expect(assetFutureValue(asset, 0)).toBe(10_000);
	});

	it('shrinks for a negative expected growth rate — a depreciating asset', () => {
		const asset = createAsset({ current_value: 10_000, expected_growth: -10 });
		expect(assetFutureValue(asset, 5)).toBeCloseTo(5_904.9, 0);
	});

	it('is tolerant of a missing or malformed asset rather than throwing', () => {
		// @ts-expect-error — deliberately the wrong type.
		expect(assetFutureValue(undefined, 10)).toBe(0);
		expect(assetFutureValue(null, 10)).toBe(0);
		expect(assetFutureValue({}, 10)).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* assetPortfolioSummary                                                      */
/* -------------------------------------------------------------------------- */

describe('assetPortfolioSummary', () => {
	it('totals purchase price, current value and gain/loss across the whole list', () => {
		const summary = assetPortfolioSummary([
			createAsset({ purchase_price: 5_000, current_value: 8_000 }),
			createAsset({ purchase_price: 20_000, current_value: 18_000 })
		]);

		expect(summary.count).toBe(2);
		expect(summary.totalPurchasePrice).toBe(25_000);
		expect(summary.totalCurrentValue).toBe(26_000);
		expect(summary.totalGainLoss).toBe(1_000);
	});

	it('splits the totals by the include_in_net_worth toggle', () => {
		const summary = assetPortfolioSummary([
			createAsset({ current_value: 8_000, include_in_net_worth: true }),
			createAsset({ current_value: 2_000, include_in_net_worth: false })
		]);

		expect(summary.includedInNetWorth.count).toBe(1);
		expect(summary.includedInNetWorth.currentValue).toBe(8_000);
		expect(summary.excludedFromNetWorth.count).toBe(1);
		expect(summary.excludedFromNetWorth.currentValue).toBe(2_000);
	});

	it('treats every asset as included when the list is empty', () => {
		const summary = assetPortfolioSummary([]);
		expect(summary.count).toBe(0);
		expect(summary.totalCurrentValue).toBe(0);
		expect(summary.includedInNetWorth).toEqual({
			count: 0,
			purchasePrice: 0,
			currentValue: 0,
			gainLoss: 0
		});
	});

	it('is tolerant of a missing or malformed list rather than throwing', () => {
		expect(assetPortfolioSummary(undefined).count).toBe(0);
		// @ts-expect-error — deliberately the wrong type.
		expect(assetPortfolioSummary(null).count).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* assetPortfolioProjection                                                   */
/* -------------------------------------------------------------------------- */

describe('assetPortfolioProjection', () => {
	it('starts at today’s combined current value', () => {
		const projection = assetPortfolioProjection(
			[createAsset({ current_value: 10_000, expected_growth: 5 })],
			{ years: 5 }
		);
		expect(projection.points[0]).toMatchObject({ offset: 0, totalValue: 10_000, netValue: 10_000 });
	});

	it('compounds each asset at its own expected growth rate and sums the portfolio', () => {
		const projection = assetPortfolioProjection(
			[
				createAsset({ current_value: 10_000, expected_growth: 5 }),
				createAsset({ current_value: 5_000, expected_growth: -10 })
			],
			{ years: 10 }
		);
		const last = projection.points.at(-1);
		expect(last?.offset).toBe(10);
		expect(last?.totalValue).toBeCloseTo(16_288.95 + 1_743.39, 0);
	});

	it('accumulates holding cost year over year and nets it off totalValue', () => {
		const projection = assetPortfolioProjection(
			[createAsset({ current_value: 10_000, expected_growth: 0, holding_cost: 100 })],
			{ years: 3 }
		);
		expect(projection.points.map((p) => p.totalHoldingCost)).toEqual([0, 100, 200, 300]);
		expect(projection.points.at(-1)?.netValue).toBe(9_700);
	});

	it('produces one point per year including both ends', () => {
		const projection = assetPortfolioProjection([createAsset({ current_value: 1_000 })], {
			years: 4
		});
		expect(projection.points).toHaveLength(5);
		expect(projection.points.map((p) => p.offset)).toEqual([0, 1, 2, 3, 4]);
	});

	it('clamps a negative or absurdly large horizon', () => {
		expect(assetPortfolioProjection([], { years: -5 }).years).toBe(0);
		expect(assetPortfolioProjection([], { years: 10_000 }).years).toBe(50);
	});

	it('is tolerant of a missing or malformed list rather than throwing', () => {
		expect(assetPortfolioProjection(undefined).points).toHaveLength(1);
		// @ts-expect-error — deliberately the wrong type.
		expect(assetPortfolioProjection(null).points).toHaveLength(1);
	});
});
