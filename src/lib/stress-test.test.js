import { describe, expect, it } from 'vitest';

import { monthlyGrowthRate, netAnnualGrowthRate } from './auto-invest.js';
import { reconcileCompounding } from './compounding.js';
import { FORECAST_SCENARIOS, MAX_FORECAST_MONTHS, forecastScenarios } from './forecast.js';
import { createDebt, createInvestment } from './model.js';
import {
	DEFAULT_STRESS_TEST,
	MAX_STRESS_MAGNITUDE,
	compareStressed,
	crashFactor,
	normaliseStressTest,
	recoveryEndsAt,
	stressAdjustment,
	stressForecast,
	stressImpact,
	stressImpacts
} from './stress-test.js';

/** Values are money, so compare to the penny rather than to floating-point exactness. */
const PENNY = 0.005;

const JAN_2026 = { month: 1, year: 2026 };

/** @param {Partial<import('./types.js').Investment>} [overrides] */
function holding(overrides = {}) {
	return createInvestment({ id: 'inv_a', name: 'Global All Cap', value: 10_000, ...overrides });
}

/**
 * One position, projected twice off the same anchor — exactly how the panel builds its two lines.
 *
 * @param {Partial<import('./stress-test.js').StressTest>} stress
 * @param {object} [input]
 * @param {import('./forecast.js').ForecastOptions} [options]
 */
function project(stress, input = {}, options = {}) {
	const position = {
		investments: [holding()],
		start: JAN_2026,
		months: 120,
		...input
	};
	return {
		baseline: forecastScenarios(position, options),
		stressed: stressForecast(position, options, stress)
	};
}

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

describe('DEFAULT_STRESS_TEST', () => {
	it('carries the four dials README.md names, and nothing else', () => {
		expect(Object.keys(DEFAULT_STRESS_TEST).sort()).toEqual([
			'atMonth',
			'magnitude',
			'recoveryMonths',
			'recoveryRate'
		]);
	});

	it('is already normalised', () => {
		expect(normaliseStressTest(DEFAULT_STRESS_TEST)).toEqual({ ...DEFAULT_STRESS_TEST });
	});
});

describe('normaliseStressTest', () => {
	it('fills an empty config with the defaults', () => {
		expect(normaliseStressTest()).toEqual({ ...DEFAULT_STRESS_TEST });
	});

	it('keeps a fully specified config', () => {
		const stress = { magnitude: 20, atMonth: 36, recoveryRate: 6, recoveryMonths: 12 };
		expect(normaliseStressTest(stress)).toEqual(stress);
	});

	it('clamps the magnitude to 0…100 — a crash cannot take more than everything', () => {
		expect(normaliseStressTest({ magnitude: -10 }).magnitude).toBe(0);
		expect(normaliseStressTest({ magnitude: 250 }).magnitude).toBe(MAX_STRESS_MAGNITUDE);
	});

	it('never dates the crash at the anchor itself, which every scenario shares', () => {
		expect(normaliseStressTest({ atMonth: 0 }).atMonth).toBe(1);
		expect(normaliseStressTest({ atMonth: -5 }).atMonth).toBe(1);
	});

	it('clamps timing and duration to the longest forecast this app will project', () => {
		expect(normaliseStressTest({ atMonth: 99_999 }).atMonth).toBe(MAX_FORECAST_MONTHS);
		expect(normaliseStressTest({ recoveryMonths: 99_999 }).recoveryMonths).toBe(
			MAX_FORECAST_MONTHS
		);
		expect(normaliseStressTest({ recoveryMonths: -4 }).recoveryMonths).toBe(0);
	});

	it('clamps the recovery rate to the -100…100 range the data model accepts', () => {
		expect(normaliseStressTest({ recoveryRate: 400 }).recoveryRate).toBe(100);
		expect(normaliseStressTest({ recoveryRate: -400 }).recoveryRate).toBe(-100);
	});

	it('truncates fractional months and falls back on unusable values', () => {
		expect(normaliseStressTest({ atMonth: 12.9, recoveryMonths: 6.7 })).toMatchObject({
			atMonth: 12,
			recoveryMonths: 6
		});
		expect(normaliseStressTest({ magnitude: Number.NaN }).magnitude).toBe(
			DEFAULT_STRESS_TEST.magnitude
		);
		expect(
			normaliseStressTest(
				/** @type {Partial<import('./stress-test.js').StressTest>} */ (
					/** @type {unknown} */ ({ recoveryRate: 'not a number' })
				)
			).recoveryRate
		).toBe(DEFAULT_STRESS_TEST.recoveryRate);
	});

	it('reads a numeric string, as a bound input or a hand-edited document would supply', () => {
		expect(
			normaliseStressTest(
				/** @type {Partial<import('./stress-test.js').StressTest>} */ (
					/** @type {unknown} */ ({ magnitude: '40' })
				)
			).magnitude
		).toBe(40);
	});
});

describe('crashFactor / recoveryEndsAt', () => {
	it('turns a magnitude into the month move it means', () => {
		expect(crashFactor(35)).toBeCloseTo(0.65, 12);
		expect(crashFactor(0)).toBe(1);
		expect(crashFactor(100)).toBe(0);
	});

	it('closes the recovery window that many months after the crash', () => {
		expect(
			recoveryEndsAt({ magnitude: 30, atMonth: 12, recoveryRate: 8, recoveryMonths: 24 })
		).toBe(36);
		expect(recoveryEndsAt({ magnitude: 30, atMonth: 12, recoveryRate: 8, recoveryMonths: 0 })).toBe(
			12
		);
	});
});

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

describe('stressAdjustment', () => {
	const stress = normaliseStressTest({
		magnitude: 30,
		atMonth: 6,
		recoveryRate: 9,
		recoveryMonths: 3
	});
	const adjust = stressAdjustment(stress);

	it('leaves every month before the crash alone', () => {
		expect(adjust(1)).toBeNull();
		expect(adjust(5)).toBeNull();
	});

	it('states the crash month as a move, not a rate', () => {
		expect(adjust(6)).toEqual({ factor: 0.7 });
	});

	it('re-rates exactly the months of the recovery window', () => {
		expect(adjust(7)).toEqual({ growthRate: 9 });
		expect(adjust(9)).toEqual({ growthRate: 9 });
		expect(adjust(10)).toBeNull();
	});

	it('does nothing at all at zero magnitude — no crash means no recovery either', () => {
		const none = stressAdjustment(normaliseStressTest({ magnitude: 0, atMonth: 6 }));
		expect([1, 5, 6, 7, 30].map(none)).toEqual([null, null, null, null, null]);
	});
});

/* -------------------------------------------------------------------------- */
/* The overlay against the baseline                                            */
/* -------------------------------------------------------------------------- */

describe('stressForecast', () => {
	it('returns a Forecast, with the config it was built from attached', () => {
		const { baseline, stressed } = project({ magnitude: 30, atMonth: 12 });

		expect(stressed.start).toEqual(baseline.start);
		expect(stressed.months).toBe(baseline.months);
		expect(stressed.rates).toEqual(baseline.rates);
		expect(Object.keys(stressed.series).sort()).toEqual([...FORECAST_SCENARIOS].sort());
		expect(stressed.stress).toEqual(normaliseStressTest({ magnitude: 30, atMonth: 12 }));
	});

	it('is the baseline, point for point, when there is no crash to model', () => {
		const { baseline, stressed } = project({ magnitude: 0 });
		expect(stressed.series).toEqual(baseline.series);
	});

	it('leaves the anchor and every month before the crash untouched', () => {
		const { baseline, stressed } = project({ magnitude: 40, atMonth: 24 });

		for (let offset = 0; offset < 24; offset += 1) {
			expect(stressed.series.realistic[offset]).toEqual(baseline.series.realistic[offset]);
		}
	});

	it('falls by exactly the magnitude stated, in one month', () => {
		const { stressed } = project({ magnitude: 35, atMonth: 12 });
		const before = stressed.series.realistic[11].investments;
		const after = stressed.series.realistic[12].investments;

		expect(after).toBeCloseTo(before * 0.65, 2);
	});

	it('keeps paying the contributions in at post-crash prices', () => {
		const { stressed } = project(
			{ magnitude: 50, atMonth: 12 },
			{ investments: [holding({ monthly_contribution: 500 })] }
		);
		const before = stressed.series.realistic[11].investments;
		const after = stressed.series.realistic[12].investments;

		expect(after).toBeCloseTo(before * 0.5 + 500, 2);
	});

	it('changes the market, not the standing order', () => {
		const { baseline, stressed } = project(
			{ magnitude: 45, atMonth: 18, recoveryMonths: 12 },
			{ investments: [holding({ monthly_contribution: 250 })] }
		);

		for (let offset = 0; offset <= baseline.months; offset += 1) {
			expect(stressed.series.realistic[offset].contributions).toBe(
				baseline.series.realistic[offset].contributions
			);
		}
	});

	it('compounds at the recovery rate for the window, then at the ordinary rate again', () => {
		const { stressed } = project({
			magnitude: 30,
			atMonth: 6,
			recoveryRate: 12,
			recoveryMonths: 3
		});
		const series = stressed.series.realistic;

		const recoveryStep = 1 + monthlyGrowthRate(12);
		const ordinaryStep = 1 + monthlyGrowthRate(5);

		// Months 7, 8, 9 are the window; month 10 is ordinary life again. Compared to five decimal
		// places rather than exactly: every month is rounded to whole pence and the rounded value is
		// carried forward, so a month-on-month ratio carries that rounding with it.
		expect(series[7].investments / series[6].investments).toBeCloseTo(recoveryStep, 5);
		expect(series[9].investments / series[8].investments).toBeCloseTo(recoveryStep, 5);
		expect(series[10].investments / series[9].investments).toBeCloseTo(ordinaryStep, 5);
	});

	it('nets each holding fund fee off the recovery rate, as it does off any other', () => {
		const { stressed } = project(
			{ magnitude: 20, atMonth: 6, recoveryRate: 12, recoveryMonths: 6 },
			{ investments: [holding({ fund_fee: 0.75 })] }
		);
		const series = stressed.series.realistic;

		expect(series[8].investments / series[7].investments).toBeCloseTo(
			1 + monthlyGrowthRate(netAnnualGrowthRate(12, 0.75)),
			6
		);
	});

	it('keeps the three scenarios a band through the crash and the recovery', () => {
		const { stressed } = project({
			magnitude: 30,
			atMonth: 6,
			recoveryRate: 12,
			recoveryMonths: 6
		});

		// The spread still applies to the recovery rate, so the rebound differs by scenario...
		const step = (/** @type {import('./forecast.js').ForecastScenario} */ scenario) =>
			stressed.series[scenario][8].investments / stressed.series[scenario][7].investments;
		expect(step('pessimistic')).toBeCloseTo(1 + monthlyGrowthRate(10), 6);
		expect(step('optimistic')).toBeCloseTo(1 + monthlyGrowthRate(14), 6);

		// ...and the ordering holds at the horizon, as it does without a crash.
		const final = (/** @type {import('./forecast.js').ForecastScenario} */ scenario) =>
			stressed.series[scenario].at(-1)?.net_worth ?? 0;
		expect(final('pessimistic')).toBeLessThan(final('realistic'));
		expect(final('realistic')).toBeLessThan(final('optimistic'));
	});

	it('crashes every holding alike, per-holding growth overrides included', () => {
		const { stressed } = project(
			{ magnitude: 25, atMonth: 6, recoveryRate: 12, recoveryMonths: 6 },
			{
				investments: [
					holding({ id: 'inv_equities', value: 20_000 }),
					holding({ id: 'inv_cash', name: 'Cash', type: 'cash', value: 5_000 })
				]
			},
			{ holdingGrowthRates: { inv_cash: 1 } }
		);
		const series = stressed.series.realistic;

		// Both holdings fall 25%, and both rebound at the recovery rate rather than at their own
		// long-run assumption — a market-wide event, deliberately not modelled per holding. Each
		// holding is rounded to pence before the two are totalled, so the total is compared to the
		// penny rather than exactly.
		expect(series[6].investments).toBeCloseTo(series[5].investments * 0.75, 1);
		expect(series[8].investments / series[7].investments).toBeCloseTo(1 + monthlyGrowthRate(12), 5);
	});

	it('does not touch debts — a crash is a market event, not a debt jubilee', () => {
		const { baseline, stressed } = project(
			{ magnitude: 40, atMonth: 6 },
			{ debts: [createDebt({ id: 'debt_a', name: 'Loan', balance: 5_000 })] }
		);

		expect(stressed.series.realistic.every((point) => point.debts === 5_000)).toBe(true);
		expect(stressed.series.realistic[6].net_worth).toBeCloseTo(
			stressed.series.realistic[6].investments - 5_000,
			2
		);
		expect(baseline.series.realistic[6].debts).toBe(5_000);
	});

	it('leaves the projection alone when the crash falls past the horizon', () => {
		const { baseline, stressed } = project({ magnitude: 50, atMonth: 200 }, { months: 60 });
		expect(stressed.series).toEqual(baseline.series);
	});

	it('keeps the contributions/growth split reconciling — a crash is negative growth', () => {
		const { stressed } = project(
			{ magnitude: 35, atMonth: 14, recoveryRate: 11, recoveryMonths: 30 },
			{
				investments: [
					holding({ fund_fee: 0.22, monthly_contribution: 400 }),
					holding({
						id: 'inv_b',
						value: 4_000,
						monthly_contribution: 900,
						contribution_frequency: 'quarterly'
					}),
					holding({ id: 'inv_c', value: 2_500, exclude_from_net_worth: true })
				],
				debts: [createDebt({ id: 'debt_a', name: 'Mortgage', balance: 120_000 })],
				months: 360
			}
		);

		const reconciliation = reconcileCompounding(stressed);
		expect(reconciliation.consistent).toBe(true);
		expect(reconciliation.maxResidual).toBeLessThan(0.01);
		expect(reconciliation.checked).toBe(3 * 361);

		// The crash month's growth is the fall, not a gap in the accounting.
		const series = stressed.series.realistic;
		expect(series[14].growth - series[13].growth).toBeLessThan(0);
	});

	it('takes everything at 100% magnitude, and rebuilds only from contributions', () => {
		const { stressed } = project(
			{ magnitude: 100, atMonth: 6, recoveryMonths: 0 },
			{ investments: [holding({ monthly_contribution: 300 })] }
		);
		const series = stressed.series.realistic;

		expect(series[6].investments).toBeCloseTo(300, 2);
		expect(series[7].investments).toBeGreaterThan(300);
	});
});

/* -------------------------------------------------------------------------- */
/* Reading the damage                                                          */
/* -------------------------------------------------------------------------- */

describe('stressImpact', () => {
	it('measures the drawdown against the month before the crash', () => {
		const { baseline, stressed } = project({ magnitude: 35, atMonth: 12, recoveryMonths: 0 });
		const impact = stressImpact(baseline, stressed);

		expect(impact.occurs).toBe(true);
		expect(impact.atMonth).toBe(12);
		expect(impact.date).toEqual({ month: 1, year: 2027 });
		expect(impact.before).toBe(baseline.series.realistic[11].net_worth);
		expect(impact.after).toBe(stressed.series.realistic[12].net_worth);
		expect(impact.drop).toBeCloseTo(impact.before * 0.35, 1);
		expect(impact.dropShare).toBeCloseTo(0.35, 4);
	});

	it('dates the month the pot is back where it was, and how long that took', () => {
		const { baseline, stressed } = project({
			magnitude: 20,
			atMonth: 12,
			recoveryRate: 20,
			recoveryMonths: 24
		});
		const impact = stressImpact(baseline, stressed);

		expect(impact.recoveredAt).not.toBeNull();
		expect(impact.monthsToRecover).toBe(/** @type {number} */ (impact.recoveredAt) - 12);
		const recovery = stressed.series.realistic[/** @type {number} */ (impact.recoveredAt)];
		expect(recovery.net_worth).toBeGreaterThanOrEqual(impact.before);
		expect(
			stressed.series.realistic[/** @type {number} */ (impact.recoveredAt) - 1].net_worth
		).toBeLessThan(impact.before);
		expect(impact.recoveredDate).toEqual({ month: recovery.month, year: recovery.year });
	});

	it('reports never recovering rather than inventing a date past the horizon', () => {
		const { baseline, stressed } = project(
			{ magnitude: 60, atMonth: 100, recoveryRate: -5, recoveryMonths: 12 },
			{ months: 120 }
		);
		const impact = stressImpact(baseline, stressed);

		expect(impact.occurs).toBe(true);
		expect(impact.recoveredAt).toBeNull();
		expect(impact.monthsToRecover).toBeNull();
	});

	it('finds the true low point when the recovery rate is itself negative', () => {
		const { baseline, stressed } = project({
			magnitude: 20,
			atMonth: 12,
			recoveryRate: -20,
			recoveryMonths: 24
		});
		const impact = stressImpact(baseline, stressed);

		expect(impact.troughOffset).toBe(36);
		expect(impact.trough).toBeLessThan(impact.after);
		expect(impact.troughDate).toEqual({ month: 1, year: 2029 });
	});

	it('separates getting back to the pre-crash figure from catching the baseline up', () => {
		const { baseline, stressed } = project({
			magnitude: 25,
			atMonth: 12,
			recoveryRate: 8,
			recoveryMonths: 24
		});
		const impact = stressImpact(baseline, stressed);

		// The pot recovers; the forecast it would have had does not come back.
		expect(impact.recoveredAt).not.toBeNull();
		expect(impact.caughtUpAt).toBeNull();
		expect(impact.shortfall).toBeGreaterThan(0);
		expect(impact.shortfallShare).toBeCloseTo(impact.shortfall / impact.baselineFinal, 12);
	});

	it('does catch the baseline up when the rebound is strong enough for long enough', () => {
		const { baseline, stressed } = project({
			magnitude: 10,
			atMonth: 12,
			recoveryRate: 60,
			recoveryMonths: 36
		});
		const impact = stressImpact(baseline, stressed);

		expect(impact.caughtUpAt).not.toBeNull();
		expect(impact.shortfall).toBeLessThan(0);
	});

	it('says the crash never lands rather than reporting a £0 drawdown', () => {
		const { baseline, stressed } = project({ magnitude: 50, atMonth: 500 }, { months: 120 });
		const impact = stressImpact(baseline, stressed);

		expect(impact.occurs).toBe(false);
		expect(impact.drop).toBe(0);
		expect(impact.shortfall).toBe(0);
		expect(impact.date).toBeNull();
	});

	it('treats a zero-magnitude config as no crash at all', () => {
		const { baseline, stressed } = project({ magnitude: 0, atMonth: 12 });
		const impact = stressImpact(baseline, stressed);

		expect(impact.occurs).toBe(false);
		expect(impact.shortfall).toBe(0);
	});

	it('declines to express a drawdown as a share of a non-positive position', () => {
		const { baseline, stressed } = project(
			{ magnitude: 30, atMonth: 6 },
			{ debts: [createDebt({ id: 'debt_a', name: 'Mortgage', balance: 500_000 })] }
		);
		const impact = stressImpact(baseline, stressed);

		expect(impact.before).toBeLessThan(0);
		expect(impact.dropShare).toBeNull();
		expect(impact.shortfallShare).toBeNull();
		// The fall itself is still measured — it is the investments that crashed, not the debt.
		expect(impact.drop).toBeGreaterThan(0);
	});

	it('reads each scenario separately', () => {
		const { baseline, stressed } = project({ magnitude: 30, atMonth: 12 });
		const impacts = stressImpacts(baseline, stressed);

		expect(Object.keys(impacts).sort()).toEqual([...FORECAST_SCENARIOS].sort());
		for (const scenario of FORECAST_SCENARIOS) {
			expect(impacts[scenario].scenario).toBe(scenario);
			expect(impacts[scenario].atMonth).toBe(12);
			expect(impacts[scenario].dropShare).toBeCloseTo(0.3, 4);
		}
		// A bigger pot loses more pounds to the same percentage fall.
		expect(impacts.optimistic.drop).toBeGreaterThan(impacts.pessimistic.drop);
	});
});

describe('compareStressed', () => {
	it('lines the two projections up at the summary horizons by default', () => {
		const { baseline, stressed } = project({ magnitude: 30, atMonth: 12 }, { months: 360 });
		const rows = compareStressed(baseline, stressed);

		expect(rows.map((row) => row.years)).toEqual([1, 5, 10, 20, 30]);
		expect(rows[0].month).toBe(1);
		expect(rows[0].year).toBe(2027);
	});

	it('reports the gap as a signed difference and a share of the baseline', () => {
		const { baseline, stressed } = project({ magnitude: 30, atMonth: 12 }, { months: 120 });
		const rows = compareStressed(baseline, stressed, 'realistic', [24, 120]);

		for (const row of rows) {
			expect(row.gap).toBeCloseTo(row.stressed - row.baseline, PENNY);
			expect(row.gap).toBeLessThan(0);
			expect(row.gapShare).toBeCloseTo(row.gap / row.baseline, 12);
		}
	});

	it('follows the offsets it is given, in the order given', () => {
		const { baseline, stressed } = project({ magnitude: 30, atMonth: 12 }, { months: 120 });
		expect(
			compareStressed(baseline, stressed, 'realistic', [60, 12]).map((row) => row.offset)
		).toEqual([60, 12]);
	});

	it('drops offsets past the horizon rather than returning holes', () => {
		const { baseline, stressed } = project({ magnitude: 30, atMonth: 12 }, { months: 60 });
		expect(
			compareStressed(baseline, stressed, 'realistic', [12, 600]).map((row) => row.offset)
		).toEqual([12]);
	});

	it('shows no gap at all before the crash, in every scenario', () => {
		const { baseline, stressed } = project({ magnitude: 30, atMonth: 24 }, { months: 120 });

		for (const scenario of FORECAST_SCENARIOS) {
			const rows = compareStressed(baseline, stressed, scenario, [0, 12, 23]);
			expect(rows.every((row) => row.gap === 0)).toBe(true);
		}
	});
});
