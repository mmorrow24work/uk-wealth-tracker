import { describe, expect, it } from 'vitest';

import { monthlyGrowthRate } from './auto-invest.js';
import { createDebt, createInvestment } from './model.js';
import {
	DEFAULT_SUMMARY_YEARS,
	FORECAST_SCENARIOS,
	forecastScenarios,
	summariseForecast
} from './forecast.js';
import {
	COMPOUNDING_TOLERANCE,
	compoundingByScenario,
	compoundingForOffsets,
	compoundingPointAt,
	compoundingSplit,
	growthCrossover,
	growthCrossovers,
	reconcileCompounding,
	summariseCompounding
} from './compounding.js';

/** Values are money, so compare to the penny rather than to floating-point exactness. */
const PENNY = 0.005;

const JAN_2026 = { month: 1, year: 2026 };

/** @param {Partial<import('./types.js').Investment>} [overrides] */
function holding(overrides = {}) {
	return createInvestment({ id: 'inv_a', name: 'Global All Cap', value: 10_000, ...overrides });
}

/**
 * The standard test position: £10,000 invested, £500 a month paid in, projected at 5% ± 2pp with no
 * fund fee, so every expected number below can be derived by hand.
 *
 * @param {object} [input]
 * @param {object} [options]
 */
function forecast(input = {}, options = {}) {
	return forecastScenarios(
		{
			investments: [holding({ monthly_contribution: 500 })],
			start: JAN_2026,
			months: 120,
			...input
		},
		{ growthRate: 5, applyFundFees: false, ...options }
	);
}

/* -------------------------------------------------------------------------- */
/* compoundingPointAt                                                          */
/* -------------------------------------------------------------------------- */

describe('compoundingPointAt', () => {
	it('splits the anchor into nothing — no time has passed, so there is no gain to divide', () => {
		const point = compoundingPointAt(forecast(), 'realistic', 0);
		expect(point).toMatchObject({
			scenario: 'realistic',
			offset: 0,
			month: 1,
			year: 2026,
			starting: 10_000,
			contributions: 0,
			growth: 0,
			gain: 0,
			investments: 10_000,
			contributionShare: null,
			growthShare: null
		});
	});

	it('defaults to the realistic scenario at the final month', () => {
		const projection = forecast();
		expect(compoundingPointAt(projection)).toEqual(
			compoundingPointAt(projection, 'realistic', projection.months)
		);
	});

	it('reconciles: starting + contributions + growth is the projected value', () => {
		const point = compoundingPointAt(forecast(), 'realistic', 120);
		expect(point).not.toBeNull();
		if (!point) return;
		expect(point.starting + point.contributions + point.growth).toBeCloseTo(point.investments, 2);
		expect(Math.abs(point.residual)).toBeLessThanOrEqual(COMPOUNDING_TOLERANCE);
	});

	it('counts contributions as the payment schedule alone, not as a rate', () => {
		// £500 a month for ten years, paid from the first month after the anchor.
		const point = compoundingPointAt(forecast(), 'realistic', 120);
		expect(point?.contributions).toBe(60_000);
	});

	it('matches an independently calculated annuity — the split is the projection, not a re-derivation', () => {
		// value(n) = P(1+m)^n + c((1+m)^n - 1)/m, an ordinary annuity at the geometric monthly rate.
		const months = 60;
		const monthly = monthlyGrowthRate(5);
		const factor = (1 + monthly) ** months;
		const expectedValue = 10_000 * factor + (500 * (factor - 1)) / monthly;

		const point = compoundingPointAt(forecast({ months }), 'realistic', months);
		expect(point).not.toBeNull();
		if (!point) return;
		// Pence-rounding each month costs a few pence over five years; nothing larger.
		expect(point.investments).toBeCloseTo(expectedValue, 1);
		expect(point.contributions).toBe(500 * months);
		expect(point.growth).toBeCloseTo(expectedValue - 10_000 - 500 * months, 1);
	});

	it('splits the gain into two shares that sum to one', () => {
		const point = compoundingPointAt(forecast(), 'realistic', 120);
		expect(point?.contributionShare).toBeGreaterThan(0);
		expect(point?.growthShare).toBeGreaterThan(0);
		expect((point?.contributionShare ?? 0) + (point?.growthShare ?? 0)).toBeCloseTo(1, 10);
	});

	it('carries net worth, so the panel can relate the split to the headline figure', () => {
		const point = compoundingPointAt(
			forecast({ debts: [createDebt({ id: 'debt_a', name: 'Mortgage', balance: 6_000 })] }),
			'realistic',
			120
		);
		expect(point?.net_worth).toBeCloseTo((point?.investments ?? 0) - 6_000, 2);
		// Debts carry forward unchanged, so the gain describes net worth growth just as well.
		expect(point?.gain).toBeCloseTo((point?.net_worth ?? 0) - (10_000 - 6_000), 2);
	});

	it('reports a negative growth share when the scenario loses money', () => {
		const point = compoundingPointAt(forecast({}, { growthRate: -8 }), 'pessimistic', 120);
		expect(point?.growth).toBeLessThan(0);
		expect(point?.growthShare).toBeLessThan(0);
		expect(point?.contributionShare).toBeGreaterThan(1);
	});

	it('has no shares to report when nothing is paid in and nothing is earned', () => {
		const point = compoundingPointAt(
			forecast({ investments: [holding({ monthly_contribution: 0 })] }, { growthRate: 0 }),
			'realistic',
			120
		);
		expect(point).toMatchObject({ gain: 0, contributionShare: null, growthShare: null });
	});

	it('is null past the horizon', () => {
		expect(compoundingPointAt(forecast({ months: 12 }), 'realistic', 13)).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* compoundingForOffsets / compoundingSplit                                    */
/* -------------------------------------------------------------------------- */

describe('compoundingForOffsets', () => {
	it('returns one point per offset, in the order asked for', () => {
		const points = compoundingForOffsets(forecast(), 'realistic', [24, 12]);
		expect(points.map((point) => point.offset)).toEqual([24, 12]);
	});

	it('drops offsets the forecast does not reach rather than returning holes', () => {
		const points = compoundingForOffsets(forecast({ months: 12 }), 'realistic', [6, 999]);
		expect(points.map((point) => point.offset)).toEqual([6]);
	});
});

describe('compoundingSplit', () => {
	it('covers every month including the anchor', () => {
		const points = compoundingSplit(forecast({ months: 24 }));
		expect(points).toHaveLength(25);
		expect(points.map((point) => point.offset)).toEqual([...Array(25).keys()]);
	});

	it('grows contributions in a straight line and growth faster than linearly', () => {
		const points = compoundingSplit(forecast());
		expect(points[24].contributions).toBe(2 * points[12].contributions);
		expect(points[24].growth).toBeGreaterThan(2 * points[12].growth);
	});

	it('reconciles at every month, not just at the horizon', () => {
		for (const point of compoundingSplit(forecast())) {
			expect(Math.abs(point.residual)).toBeLessThanOrEqual(COMPOUNDING_TOLERANCE);
		}
	});
});

/* -------------------------------------------------------------------------- */
/* summariseCompounding                                                        */
/* -------------------------------------------------------------------------- */

describe('summariseCompounding', () => {
	it('picks the same horizons the scenario summary table does', () => {
		const projection = forecast({ months: 360 });
		expect(summariseCompounding(projection).map((point) => point.offset)).toEqual(
			summariseForecast(projection).map((row) => row.offset)
		);
	});

	it('reports the same contributions the summary row does', () => {
		const projection = forecast({ months: 360 });
		const split = summariseCompounding(projection);
		const rows = summariseForecast(projection);
		split.forEach((point, index) => {
			expect(point.contributions).toBe(rows[index].contributions);
		});
	});

	it('honours a custom set of horizons, dropping any past the end of the forecast', () => {
		const points = summariseCompounding(forecast({ months: 24 }), 'realistic', [1, 5]);
		// One year fits; five years does not, and the forecast's own final month is always included.
		expect(points.map((point) => point.offset)).toEqual([12, 24]);
	});

	it('defaults to the shared horizon list', () => {
		const projection = forecast({ months: 360 });
		expect(summariseCompounding(projection)).toEqual(
			summariseCompounding(projection, 'realistic', DEFAULT_SUMMARY_YEARS)
		);
	});

	it('shows growth taking over from contributions as the horizon lengthens', () => {
		const shares = summariseCompounding(forecast({ months: 360 })).map(
			(point) => point.growthShare ?? 0
		);
		for (let index = 1; index < shares.length; index += 1) {
			expect(shares[index]).toBeGreaterThan(shares[index - 1]);
		}
	});
});

/* -------------------------------------------------------------------------- */
/* compoundingByScenario                                                       */
/* -------------------------------------------------------------------------- */

describe('compoundingByScenario', () => {
	it('pays in the same amount in every scenario — only growth differs', () => {
		const split = compoundingByScenario(forecast());
		expect(split).not.toBeNull();
		if (!split) return;
		expect(split.pessimistic.contributions).toBe(split.realistic.contributions);
		expect(split.optimistic.contributions).toBe(split.realistic.contributions);
		expect(split.pessimistic.growth).toBeLessThan(split.realistic.growth);
		expect(split.optimistic.growth).toBeGreaterThan(split.realistic.growth);
	});

	it('starts every scenario from the same position', () => {
		const split = compoundingByScenario(forecast());
		for (const scenario of FORECAST_SCENARIOS) {
			expect(split?.[scenario].starting).toBe(10_000);
		}
	});

	it('defaults to the final month', () => {
		const projection = forecast();
		expect(compoundingByScenario(projection)).toEqual(
			compoundingByScenario(projection, projection.months)
		);
	});

	it('is null past the horizon rather than a partly-filled record', () => {
		expect(compoundingByScenario(forecast({ months: 12 }), 13)).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* growthCrossover                                                             */
/* -------------------------------------------------------------------------- */

describe('growthCrossover', () => {
	it('finds the first month growth is worth more than the money paid in', () => {
		const projection = forecast({ months: 360 });
		const crossing = growthCrossover(projection);
		expect(crossing).not.toBeNull();
		if (!crossing) return;

		expect(crossing.growth).toBeGreaterThan(crossing.contributions);
		const before = compoundingPointAt(projection, 'realistic', crossing.offset - 1);
		expect(before?.growth).toBeLessThanOrEqual(before?.contributions ?? 0);
	});

	it('crosses earlier the better the scenario', () => {
		// A bigger opening position than the standard one, so even the pessimistic 3% scenario's
		// growth catches its contributions inside the horizon.
		const crossings = growthCrossovers(
			forecast({
				investments: [holding({ value: 100_000, monthly_contribution: 500 })],
				months: 360
			})
		);
		expect(crossings.optimistic?.offset).toBeLessThan(crossings.realistic?.offset ?? 0);
		expect(crossings.pessimistic?.offset).toBeGreaterThan(crossings.realistic?.offset ?? 0);
	});

	it('is null when it never happens inside the horizon', () => {
		// Ten years of £500 a month against £10,000 of capital: contributions stay well ahead.
		expect(growthCrossover(forecast({ months: 120 }))).toBeNull();
		expect(growthCrossovers(forecast({ months: 120 })).pessimistic).toBeNull();
	});

	it('is null when the scenario never grows at all', () => {
		expect(growthCrossover(forecast({ months: 360 }, { growthRate: 0 }), 'realistic')).toBeNull();
	});

	it('crosses immediately when nothing is being paid in', () => {
		const projection = forecast({ investments: [holding({ monthly_contribution: 0 })] });
		expect(growthCrossover(projection)?.offset).toBe(1);
	});
});

/* -------------------------------------------------------------------------- */
/* reconcileCompounding                                                        */
/* -------------------------------------------------------------------------- */

describe('reconcileCompounding', () => {
	/** A deliberately awkward position: fees, mixed frequencies, debts and an excluded holding. */
	function messyForecast() {
		return forecastScenarios(
			{
				investments: [
					holding({ id: 'inv_a', value: 12_345.67, monthly_contribution: 333.33, fund_fee: 0.22 }),
					createInvestment({
						id: 'inv_b',
						name: 'SIPP',
						value: 87_654.32,
						monthly_contribution: 1_200,
						contribution_frequency: 'quarterly',
						fund_fee: 0.75
					}),
					createInvestment({
						id: 'inv_c',
						name: 'Workplace bonus',
						value: 4_321,
						monthly_contribution: 5_000,
						contribution_frequency: 'annually'
					}),
					createInvestment({
						id: 'inv_d',
						name: 'House (tracked on property tab)',
						value: 250_000,
						exclude_from_net_worth: true
					})
				],
				debts: [
					createDebt({ id: 'debt_a', name: 'Mortgage', balance: 180_000 }),
					createDebt({
						id: 'debt_b',
						name: 'Excluded mortgage',
						balance: 99_999,
						exclude_from_net_worth: true
					})
				],
				start: JAN_2026,
				months: 360
			},
			{ growthRate: 6.5, holdingGrowthRates: { inv_b: 7.25 } }
		);
	}

	it('reconciles every month of every scenario on an awkward position', () => {
		const report = reconcileCompounding(messyForecast());
		expect(report.consistent).toBe(true);
		expect(report.contributionsAgree).toBe(true);
		expect(report.checked).toBe(3 * 361);
		expect(report.maxResidual).toBeLessThanOrEqual(COMPOUNDING_TOLERANCE);
		expect(report.tolerance).toBe(COMPOUNDING_TOLERANCE);
	});

	it('reconciles a forecast with nothing in it', () => {
		const report = reconcileCompounding(forecastScenarios({ months: 0, start: JAN_2026 }));
		expect(report.consistent).toBe(true);
		expect(report.checked).toBe(3);
		expect(report.worst).toEqual({ scenario: 'pessimistic', offset: 0, residual: 0 });
	});

	it('holds to the penny, not merely to the pound', () => {
		expect(reconcileCompounding(messyForecast()).maxResidual).toBeLessThan(PENNY * 4);
	});

	it('catches a split that does not add up, and says where', () => {
		const projection = messyForecast();
		projection.series.optimistic[200].growth += 5;

		const report = reconcileCompounding(projection);
		expect(report.consistent).toBe(false);
		expect(report.worst).toMatchObject({ scenario: 'optimistic', offset: 200 });
		expect(report.maxResidual).toBeCloseTo(5, 2);
	});

	it('catches scenarios that disagree about what was paid in', () => {
		const projection = messyForecast();
		// Keep the identity intact so only the cross-scenario check can fail.
		projection.series.pessimistic[120].contributions += 100;
		projection.series.pessimistic[120].growth -= 100;

		const report = reconcileCompounding(projection);
		expect(report.contributionsAgree).toBe(false);
		expect(report.consistent).toBe(false);
	});

	it('accepts a caller-supplied tolerance', () => {
		const projection = messyForecast();
		projection.series.realistic[10].growth += 0.5;

		expect(reconcileCompounding(projection).consistent).toBe(false);
		expect(reconcileCompounding(projection, { tolerance: 1 }).consistent).toBe(true);
	});
});
