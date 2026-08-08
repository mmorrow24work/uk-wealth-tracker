import { describe, expect, it } from 'vitest';

import { createAsset } from './model.js';
import {
	ASSET_PROJECTION_YEARS,
	assetCagr,
	assetGainLoss,
	assetHoldingCostToDate,
	assetNetPosition,
	assetPortfolioSummary,
	assetValueProjection
} from './assets.js';

const now = new Date('2026-08-07T12:00:00.000Z');

/* -------------------------------------------------------------------------- */
/* assetGainLoss                                                              */
/* -------------------------------------------------------------------------- */

describe('assetGainLoss', () => {
	it('is current value minus purchase price', () => {
		expect(assetGainLoss(createAsset({ purchase_price: 5_000, current_value: 8_000 }))).toBe(3_000);
	});

	it('can be negative for a depreciating asset', () => {
		expect(assetGainLoss(createAsset({ purchase_price: 40_000, current_value: 25_000 }))).toBe(
			-15_000
		);
	});

	it('is tolerant of a missing or malformed asset rather than throwing', () => {
		expect(assetGainLoss(undefined)).toBe(0);
		expect(assetGainLoss(null)).toBe(0);
		expect(assetGainLoss({})).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* assetCagr                                                                  */
/* -------------------------------------------------------------------------- */

describe('assetCagr', () => {
	it('annualises growth over the years since purchase_date', () => {
		// £5,000 -> £10,000 over exactly 10 years is +7.18%/yr, to 2dp.
		const asset = createAsset({
			purchase_price: 5_000,
			current_value: 10_000,
			purchase_date: '2016-08-07'
		});
		expect(assetCagr(asset, now)).toBeCloseTo(7.18, 1);
	});

	it('is negative for an asset worth less than it was bought for', () => {
		const asset = createAsset({
			purchase_price: 20_000,
			current_value: 10_000,
			purchase_date: '2021-08-07'
		});
		const cagr = assetCagr(asset, now);
		expect(cagr).not.toBeNull();
		expect(cagr ?? 0).toBeLessThan(0);
	});

	it('is -100% when current value has fallen to zero', () => {
		const asset = createAsset({
			purchase_price: 10_000,
			current_value: 0,
			purchase_date: '2020-08-07'
		});
		expect(assetCagr(asset, now)).toBe(-100);
	});

	it('is null with no purchase date on record', () => {
		expect(
			assetCagr(createAsset({ purchase_price: 5_000, current_value: 8_000, purchase_date: null }))
		).toBeNull();
	});

	it('is null when the purchase date has not happened yet', () => {
		const asset = createAsset({
			purchase_price: 5_000,
			current_value: 8_000,
			purchase_date: '2027-01-01'
		});
		expect(assetCagr(asset, now)).toBeNull();
	});

	it('is null when the purchase price is zero or negative — nothing to divide by', () => {
		expect(
			assetCagr(
				createAsset({ purchase_price: 0, current_value: 8_000, purchase_date: '2020-01-01' })
			)
		).toBeNull();
	});

	it('is tolerant of a missing or malformed asset rather than throwing', () => {
		expect(assetCagr(undefined, now)).toBeNull();
		expect(assetCagr(null, now)).toBeNull();
		expect(assetCagr({}, now)).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* assetHoldingCostToDate / assetNetPosition                                  */
/* -------------------------------------------------------------------------- */

describe('assetHoldingCostToDate', () => {
	it('is holding_cost times the years owned', () => {
		const asset = createAsset({ holding_cost: 100, purchase_date: '2021-08-07' });
		expect(assetHoldingCostToDate(asset, now)).toBeCloseTo(500, 0);
	});

	it('is zero with no purchase date on record', () => {
		expect(
			assetHoldingCostToDate(createAsset({ holding_cost: 100, purchase_date: null }), now)
		).toBe(0);
	});

	it('is tolerant of a missing or malformed asset rather than throwing', () => {
		expect(assetHoldingCostToDate(undefined, now)).toBe(0);
		expect(assetHoldingCostToDate(null, now)).toBe(0);
	});
});

describe('assetNetPosition', () => {
	it('is gain/loss minus the holding costs paid to date', () => {
		const asset = createAsset({
			purchase_price: 5_000,
			current_value: 8_000,
			holding_cost: 100,
			purchase_date: '2021-08-07'
		});
		// £3,000 gain minus ~£500 of holding costs over 5 years.
		expect(assetNetPosition(asset, now)).toBeCloseTo(2_500, 0);
	});

	it('can be negative even when the asset itself is up in value', () => {
		const asset = createAsset({
			purchase_price: 5_000,
			current_value: 5_500,
			holding_cost: 1_000,
			purchase_date: '2020-08-07'
		});
		expect(assetNetPosition(asset, now)).toBeLessThan(0);
	});

	it('is tolerant of a missing or malformed asset rather than throwing', () => {
		expect(assetNetPosition(undefined, now)).toBe(0);
		expect(assetNetPosition(null, now)).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* assetPortfolioSummary                                                     */
/* -------------------------------------------------------------------------- */

describe('assetPortfolioSummary', () => {
	it('totals purchase price, current value and gain/loss across the whole list', () => {
		const summary = assetPortfolioSummary([
			createAsset({ purchase_price: 5_000, current_value: 8_000 }),
			createAsset({ purchase_price: 10_000, current_value: 9_000 })
		]);

		expect(summary.count).toBe(2);
		expect(summary.totalPurchasePrice).toBe(15_000);
		expect(summary.totalCurrentValue).toBe(17_000);
		expect(summary.totalGainLoss).toBe(2_000);
	});

	it('splits the totals by the include_in_net_worth toggle', () => {
		const summary = assetPortfolioSummary([
			createAsset({ current_value: 8_000, include_in_net_worth: true }),
			createAsset({ current_value: 4_000, include_in_net_worth: false })
		]);

		expect(summary.includedInNetWorth.count).toBe(1);
		expect(summary.includedInNetWorth.currentValue).toBe(8_000);
		expect(summary.excludedFromNetWorth.count).toBe(1);
		expect(summary.excludedFromNetWorth.currentValue).toBe(4_000);
	});

	it('is empty for an empty list', () => {
		const summary = assetPortfolioSummary([]);
		expect(summary.count).toBe(0);
		expect(summary.totalGainLoss).toBe(0);
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
/* assetValueProjection                                                      */
/* -------------------------------------------------------------------------- */

describe('assetValueProjection', () => {
	it('returns years + 1 points, starting at today’s current value', () => {
		const asset = createAsset({ current_value: 10_000, expected_growth: 5 });
		const points = assetValueProjection(asset, 10);

		expect(points).toHaveLength(11);
		expect(points[0]).toEqual({
			year: 0,
			value: 10_000,
			cumulativeHoldingCost: 0,
			netValue: 10_000
		});
	});

	it('compounds value at expected_growth, annually', () => {
		const asset = createAsset({ current_value: 10_000, expected_growth: 10 });
		const points = assetValueProjection(asset, 2);

		expect(points[1].value).toBe(11_000);
		expect(points[2].value).toBe(12_100);
	});

	it('depreciates when expected_growth is negative', () => {
		const asset = createAsset({ current_value: 10_000, expected_growth: -10 });
		const points = assetValueProjection(asset, 1);

		expect(points[1].value).toBe(9_000);
	});

	it('accrues holding cost forward from today, and nets it off the value', () => {
		const asset = createAsset({ current_value: 10_000, expected_growth: 0, holding_cost: 200 });
		const points = assetValueProjection(asset, 3);

		expect(points[3].cumulativeHoldingCost).toBe(600);
		expect(points[3].netValue).toBe(9_400);
	});

	it('defaults to a 20-year horizon', () => {
		const points = assetValueProjection(createAsset({ current_value: 10_000 }));
		expect(points).toHaveLength(ASSET_PROJECTION_YEARS + 1);
	});

	it('is tolerant of a missing or malformed asset rather than throwing', () => {
		expect(assetValueProjection(undefined, 5)).toHaveLength(6);
		expect(assetValueProjection(null, 5)).toHaveLength(6);
		expect(assetValueProjection({}, 5)[0]).toEqual({
			year: 0,
			value: 0,
			cumulativeHoldingCost: 0,
			netValue: 0
		});
	});

	it('clamps a negative or oversized horizon rather than throwing', () => {
		expect(assetValueProjection(createAsset({ current_value: 10_000 }), -5)).toHaveLength(1);
	});
});
