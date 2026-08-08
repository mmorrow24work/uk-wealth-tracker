import { describe, expect, it } from 'vitest';

import {
	DEFAULT_CHILDCARE_COST,
	MAX_CHILDCARE_MONTHLY_COST,
	childcareCostAdjustment,
	childcareCostForecast,
	childcareCostImpact,
	childcareCostImpacts,
	childcareCostAt,
	compareChildcareCost,
	normaliseChildcareCost,
	primaryStageEndsAt,
	stepStageEndsAt
} from './childcare-cost.js';
import { FORECAST_SCENARIOS, MAX_FORECAST_MONTHS, forecastScenarios } from './forecast.js';
import { createDebt, createInvestment } from './model.js';

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
 * @param {Partial<import('./childcare-cost.js').ChildcareCost>} cost
 * @param {object} [input]
 * @param {import('./forecast.js').ForecastOptions} [options]
 */
function project(cost, input = {}, options = {}) {
	const position = {
		investments: [holding({ monthly_contribution: 1_500, fund_fee: 0 })],
		start: JAN_2026,
		months: 96,
		...input
	};
	return {
		baseline: forecastScenarios(position, options),
		costed: childcareCostForecast(position, options, cost)
	};
}

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

describe('DEFAULT_CHILDCARE_COST', () => {
	it('carries the five dials, and nothing else', () => {
		expect(Object.keys(DEFAULT_CHILDCARE_COST).sort()).toEqual([
			'atMonth',
			'durationMonths',
			'monthlyCost',
			'stepDurationMonths',
			'stepMonthlyCost'
		]);
	});

	it('is already normalised', () => {
		expect(normaliseChildcareCost(DEFAULT_CHILDCARE_COST)).toEqual({ ...DEFAULT_CHILDCARE_COST });
	});

	it('is a flat cost with no second stage by default', () => {
		expect(DEFAULT_CHILDCARE_COST.monthlyCost).toBeGreaterThan(0);
		expect(DEFAULT_CHILDCARE_COST.stepDurationMonths).toBe(0);
	});
});

describe('normaliseChildcareCost', () => {
	it('fills an empty config with the defaults', () => {
		expect(normaliseChildcareCost()).toEqual({ ...DEFAULT_CHILDCARE_COST });
	});

	it('keeps a fully specified config', () => {
		const cost = {
			monthlyCost: 1_100,
			atMonth: 9,
			durationMonths: 36,
			stepMonthlyCost: 350,
			stepDurationMonths: 84
		};
		expect(normaliseChildcareCost(cost)).toEqual(cost);
	});

	it('clamps costs to 0…MAX_CHILDCARE_MONTHLY_COST', () => {
		expect(normaliseChildcareCost({ monthlyCost: -10 }).monthlyCost).toBe(0);
		expect(normaliseChildcareCost({ monthlyCost: 99_999_999 }).monthlyCost).toBe(
			MAX_CHILDCARE_MONTHLY_COST
		);
		expect(normaliseChildcareCost({ stepMonthlyCost: -10 }).stepMonthlyCost).toBe(0);
		expect(normaliseChildcareCost({ stepMonthlyCost: 99_999_999 }).stepMonthlyCost).toBe(
			MAX_CHILDCARE_MONTHLY_COST
		);
	});

	it('never dates the cost at the anchor itself, which every scenario shares', () => {
		expect(normaliseChildcareCost({ atMonth: 0 }).atMonth).toBe(1);
		expect(normaliseChildcareCost({ atMonth: -5 }).atMonth).toBe(1);
	});

	it('clamps timing and both durations to the longest forecast this app will project', () => {
		expect(normaliseChildcareCost({ atMonth: 99_999 }).atMonth).toBe(MAX_FORECAST_MONTHS);
		expect(normaliseChildcareCost({ durationMonths: 99_999 }).durationMonths).toBe(
			MAX_FORECAST_MONTHS
		);
		expect(normaliseChildcareCost({ stepDurationMonths: 99_999 }).stepDurationMonths).toBe(
			MAX_FORECAST_MONTHS
		);
	});

	it('never lets either duration go negative', () => {
		expect(normaliseChildcareCost({ durationMonths: -3 }).durationMonths).toBe(0);
		expect(normaliseChildcareCost({ stepDurationMonths: -3 }).stepDurationMonths).toBe(0);
	});

	it('truncates fractional months', () => {
		expect(normaliseChildcareCost({ atMonth: 6.9 }).atMonth).toBe(6);
		expect(normaliseChildcareCost({ durationMonths: 3.9 }).durationMonths).toBe(3);
	});

	it('falls back to the default on a non-numeric value', () => {
		expect(
			normaliseChildcareCost(
				/** @type {Partial<import('./childcare-cost.js').ChildcareCost>} */ (
					/** @type {unknown} */ ({ monthlyCost: 'loads' })
				)
			).monthlyCost
		).toBe(DEFAULT_CHILDCARE_COST.monthlyCost);
	});
});

describe('primaryStageEndsAt / stepStageEndsAt', () => {
	it('primaryStageEndsAt is atMonth + durationMonths', () => {
		expect(
			primaryStageEndsAt({
				atMonth: 12,
				durationMonths: 36,
				monthlyCost: 1_000,
				stepMonthlyCost: 0,
				stepDurationMonths: 0
			})
		).toBe(48);
	});

	it('stepStageEndsAt adds the second stage on top of the first', () => {
		expect(
			stepStageEndsAt({
				atMonth: 12,
				durationMonths: 36,
				monthlyCost: 1_000,
				stepMonthlyCost: 300,
				stepDurationMonths: 60
			})
		).toBe(108);
	});

	it('stepStageEndsAt equals primaryStageEndsAt when there is no second stage', () => {
		const cost = {
			atMonth: 12,
			durationMonths: 36,
			monthlyCost: 1_000,
			stepMonthlyCost: 0,
			stepDurationMonths: 0
		};
		expect(stepStageEndsAt(cost)).toBe(primaryStageEndsAt(cost));
	});
});

describe('childcareCostAt', () => {
	const cost = normaliseChildcareCost({
		monthlyCost: 1_200,
		atMonth: 3,
		durationMonths: 2,
		stepMonthlyCost: 400,
		stepDurationMonths: 3
	});

	it('is 0 before the first stage starts', () => {
		expect(childcareCostAt(cost, 1)).toBe(0);
		expect(childcareCostAt(cost, 2)).toBe(0);
	});

	it('is the first-stage cost throughout the first stage', () => {
		expect(childcareCostAt(cost, 3)).toBe(1_200);
		expect(childcareCostAt(cost, 4)).toBe(1_200);
	});

	it('is the second-stage cost throughout the second stage', () => {
		expect(childcareCostAt(cost, 5)).toBe(400);
		expect(childcareCostAt(cost, 6)).toBe(400);
		expect(childcareCostAt(cost, 7)).toBe(400);
	});

	it('is 0 once the second stage ends', () => {
		expect(childcareCostAt(cost, 8)).toBe(0);
	});

	it('is 0 forever with no second stage once the first ends', () => {
		const flat = normaliseChildcareCost({
			monthlyCost: 1_200,
			atMonth: 3,
			durationMonths: 2,
			stepDurationMonths: 0
		});
		expect(childcareCostAt(flat, 5)).toBe(0);
		expect(childcareCostAt(flat, 50)).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

describe('childcareCostAdjustment', () => {
	it('returns null every month at a 0-cost config', () => {
		const adjust = childcareCostAdjustment(
			normaliseChildcareCost({
				monthlyCost: 0,
				stepMonthlyCost: 0,
				atMonth: 1,
				durationMonths: 12
			}),
			[holding({ monthly_contribution: 1_000 })]
		);
		for (let offset = 1; offset <= 24; offset += 1) {
			expect(adjust(offset)).toBeNull();
		}
	});

	it('scales the contribution down by the cost, for every month the cost is due', () => {
		const cost = normaliseChildcareCost({
			monthlyCost: 300,
			atMonth: 3,
			durationMonths: 2,
			stepDurationMonths: 0
		});
		const adjust = childcareCostAdjustment(cost, [holding({ monthly_contribution: 1_000 })]);

		expect(adjust(2)).toBeNull();
		// £1,000 scheduled, £300 due: 70% of the contribution survives.
		expect(adjust(3)).toEqual({ contributionFactor: 0.7 });
		expect(adjust(4)).toEqual({ contributionFactor: 0.7 });
		expect(adjust(5)).toBeNull();
	});

	it('clamps the factor to 0 rather than going negative when the cost exceeds what was scheduled', () => {
		const cost = normaliseChildcareCost({
			monthlyCost: 2_000,
			atMonth: 1,
			durationMonths: 1,
			stepDurationMonths: 0
		});
		const adjust = childcareCostAdjustment(cost, [holding({ monthly_contribution: 500 })]);
		expect(adjust(1)).toEqual({ contributionFactor: 0 });
	});

	it('leaves a month with nothing scheduled alone, even though the cost is due', () => {
		const cost = normaliseChildcareCost({
			monthlyCost: 300,
			atMonth: 1,
			durationMonths: 12,
			stepDurationMonths: 0
		});
		const adjust = childcareCostAdjustment(cost, [
			holding({ monthly_contribution: 1_000, contribution_frequency: 'annually' })
		]);
		// An annual holding only pays in month 12 of this window.
		expect(adjust(1)).toBeNull();
		expect(adjust(12)).toEqual({ contributionFactor: expect.any(Number) });
	});

	it('sums the cost across every holding, reducing each proportionally', () => {
		const cost = normaliseChildcareCost({
			monthlyCost: 600,
			atMonth: 1,
			durationMonths: 1,
			stepDurationMonths: 0
		});
		const adjust = childcareCostAdjustment(cost, [
			holding({ id: 'inv_a', monthly_contribution: 800 }),
			holding({ id: 'inv_b', monthly_contribution: 200 })
		]);
		// £1,000 scheduled combined, £600 due: 40% factor applies to both holdings equally.
		expect(adjust(1)).toEqual({ contributionFactor: 0.4 });
	});

	it('ignores holdings excluded from net worth', () => {
		const cost = normaliseChildcareCost({
			monthlyCost: 100,
			atMonth: 1,
			durationMonths: 1,
			stepDurationMonths: 0
		});
		const adjust = childcareCostAdjustment(cost, [
			holding({ monthly_contribution: 1_000, exclude_from_net_worth: true })
		]);
		expect(adjust(1)).toBeNull();
	});

	it('never touches growthRate or factor — only contributionFactor', () => {
		const cost = normaliseChildcareCost({ monthlyCost: 500, atMonth: 1, durationMonths: 1 });
		const adjust = childcareCostAdjustment(cost, [holding({ monthly_contribution: 1_000 })]);
		const adjustment = adjust(1);
		expect(adjustment).not.toHaveProperty('growthRate');
		expect(adjustment).not.toHaveProperty('factor');
	});
});

/* -------------------------------------------------------------------------- */
/* childcareCostForecast                                                      */
/* -------------------------------------------------------------------------- */

describe('childcareCostForecast', () => {
	it('is identical to the baseline at a 0-cost config', () => {
		const { baseline, costed } = project({ monthlyCost: 0, stepMonthlyCost: 0 });
		for (const scenario of FORECAST_SCENARIOS) {
			expect(costed.series[scenario]).toEqual(baseline.series[scenario]);
		}
	});

	it('carries the normalised config back as .childcare', () => {
		const { costed } = project({
			monthlyCost: 900,
			atMonth: 6,
			durationMonths: 3,
			stepMonthlyCost: 200,
			stepDurationMonths: 6
		});
		expect(costed.childcare).toEqual({
			monthlyCost: 900,
			atMonth: 6,
			durationMonths: 3,
			stepMonthlyCost: 200,
			stepDurationMonths: 6
		});
	});

	it('leaves months outside the cost window contributing in full', () => {
		const { baseline, costed } = project({
			monthlyCost: 1_500,
			atMonth: 6,
			durationMonths: 3,
			stepDurationMonths: 0
		});
		expect(costed.series.realistic[1].investments).toEqual(
			baseline.series.realistic[1].investments
		);
		expect(
			costed.series.realistic[20].contributions - costed.series.realistic[19].contributions
		).toBe(1_500);
	});

	it('reduces contributions to zero when the cost matches what was scheduled', () => {
		const { costed } = project({
			monthlyCost: 1_500,
			atMonth: 6,
			durationMonths: 3,
			stepDurationMonths: 0
		});
		const series = costed.series.realistic;
		expect(series[6].contributions).toBe(series[5].contributions);
		expect(series[7].contributions).toBe(series[5].contributions);
		expect(series[8].contributions).toBe(series[5].contributions);
		expect(series[9].contributions).toBe(series[5].contributions + 1_500);
	});

	it('steps to the second-stage cost once the first stage ends', () => {
		const { costed } = project({
			monthlyCost: 1_500,
			atMonth: 1,
			durationMonths: 2,
			stepMonthlyCost: 500,
			stepDurationMonths: 2
		});
		const series = costed.series.realistic;
		// £1,500 scheduled; stage one costs £1,500 (factor 0), stage two costs £500 (factor 2/3).
		expect(series[1].contributions - series[0].contributions).toBe(0);
		expect(series[2].contributions - series[1].contributions).toBe(0);
		expect(series[3].contributions - series[2].contributions).toBeCloseTo(1_000, 6);
		expect(series[4].contributions - series[3].contributions).toBeCloseTo(1_000, 6);
		expect(series[5].contributions - series[4].contributions).toBe(1_500);
	});

	it('leaves growth untouched — every scenario compounds at exactly its own rate throughout', () => {
		const { baseline, costed } = project(
			{ monthlyCost: 1_500, atMonth: 6, durationMonths: 3, stepDurationMonths: 0 },
			{
				investments: [
					holding({ monthly_contribution: 1_500, fund_fee: 0, contribution_frequency: 'annually' })
				]
			},
			{ growthRate: 5 }
		);
		// No contribution is due around month 6 for an annual holding, so the cost has nothing to
		// scale there — the two projections must therefore be byte-identical at that point.
		expect(costed.series.realistic[6]).toEqual(baseline.series.realistic[6]);
	});

	it('reaches every scenario, each still contributing the same reduced amount', () => {
		const { costed } = project({
			monthlyCost: 750,
			atMonth: 1,
			durationMonths: 1,
			stepDurationMonths: 0
		});
		for (const scenario of FORECAST_SCENARIOS) {
			expect(costed.series[scenario][1].contributions).toBe(750);
		}
	});
});

/* -------------------------------------------------------------------------- */
/* Reading the damage                                                          */
/* -------------------------------------------------------------------------- */

describe('childcareCostImpact', () => {
	it('reports occurs: false when the cost is dated past the forecast horizon', () => {
		const { baseline, costed } = project(
			{ monthlyCost: 1_000, atMonth: 200, durationMonths: 3 },
			{ months: 24 }
		);
		expect(childcareCostImpact(baseline, costed).occurs).toBe(false);
	});

	it('reports occurs: false at a 0-cost config', () => {
		const { baseline, costed } = project({ monthlyCost: 0, stepMonthlyCost: 0 });
		expect(childcareCostImpact(baseline, costed).occurs).toBe(false);
	});

	it('measures contributions forgone exactly, for a deterministic full-stop cost', () => {
		const { baseline, costed } = project({
			monthlyCost: 1_500,
			atMonth: 1,
			durationMonths: 3,
			stepDurationMonths: 0
		});
		const impact = childcareCostImpact(baseline, costed);
		expect(impact.occurs).toBe(true);
		expect(impact.contributionsForgone).toBe(4_500);
	});

	it('measures only the reduced portion when the cost is less than what was scheduled', () => {
		const { baseline, costed } = project({
			monthlyCost: 500,
			atMonth: 1,
			durationMonths: 3,
			stepDurationMonths: 0
		});
		expect(childcareCostImpact(baseline, costed).contributionsForgone).toBe(1_500);
	});

	it('the forgone total stops growing once the second stage has closed', () => {
		const { baseline, costed } = project({
			monthlyCost: 1_500,
			atMonth: 1,
			durationMonths: 2,
			stepMonthlyCost: 500,
			stepDurationMonths: 2
		});
		const impact = childcareCostImpact(baseline, costed);
		const atStepEnd = stepStageEndsAt(costed.childcare);
		const laterGap =
			(baseline.series.realistic.at(-1)?.contributions ?? 0) -
			(costed.series.realistic.at(-1)?.contributions ?? 0);
		expect(laterGap).toBeCloseTo(impact.contributionsForgone, PENNY);
		expect(atStepEnd).toBeLessThan(baseline.series.realistic.length - 1);
	});

	it('shortfall is the gap in net worth at the horizon, and grows to more than the forgone contributions alone', () => {
		const { baseline, costed } = project({
			monthlyCost: 1_500,
			atMonth: 1,
			durationMonths: 24,
			stepDurationMonths: 0
		});
		const impact = childcareCostImpact(baseline, costed);
		expect(impact.shortfall).toBeCloseTo(
			(baseline.series.realistic.at(-1)?.net_worth ?? 0) -
				(costed.series.realistic.at(-1)?.net_worth ?? 0),
			PENNY
		);
		// Positive growth means the forgone pounds would themselves have compounded, so the shortfall
		// outgrows the bare contributions total.
		expect(impact.shortfall).toBeGreaterThan(impact.contributionsForgone);
		expect(impact.compoundingLoss).toBeGreaterThan(0);
	});

	it('reports dates for when the first and second stages end', () => {
		const { baseline, costed } = project({
			monthlyCost: 1_500,
			atMonth: 1,
			durationMonths: 2,
			stepMonthlyCost: 500,
			stepDurationMonths: 3
		});
		const impact = childcareCostImpact(baseline, costed);
		// atMonth 1 = Feb 2026; primaryStageEndsAt = 1 + 2 = offset 3 = Apr 2026; stepStageEndsAt =
		// 3 + 3 = offset 6 = Jul 2026.
		expect(impact.date).toEqual({ month: 2, year: 2026 });
		expect(impact.primaryStageEndsDate).toEqual({ month: 4, year: 2026 });
		expect(impact.stepStageEndsDate).toEqual({ month: 7, year: 2026 });
	});

	it('reports a null shortfallShare when the baseline ends at or below zero', () => {
		const { baseline, costed } = project(
			{ monthlyCost: 1_500, atMonth: 1, durationMonths: 3 },
			{ investments: [], debts: [createDebt({ balance: 5_000 })] }
		);
		expect(childcareCostImpact(baseline, costed).shortfallShare).toBeNull();
	});
});

describe('childcareCostImpacts', () => {
	it('returns one impact per scenario', () => {
		const { baseline, costed } = project({ monthlyCost: 1_500, atMonth: 1, durationMonths: 3 });
		const impacts = childcareCostImpacts(baseline, costed);
		expect(Object.keys(impacts).sort()).toEqual([...FORECAST_SCENARIOS].sort());
		for (const scenario of FORECAST_SCENARIOS) {
			expect(impacts[scenario].scenario).toBe(scenario);
			expect(impacts[scenario].occurs).toBe(true);
		}
	});
});

describe('compareChildcareCost', () => {
	it('rows before the cost starts are identical between the two projections', () => {
		const { baseline, costed } = project(
			{ monthlyCost: 1_500, atMonth: 24, durationMonths: 6 },
			{ months: 60 }
		);
		const rows = compareChildcareCost(baseline, costed, 'realistic', [1, 12]);
		for (const row of rows) {
			expect(row.gap).toBe(0);
		}
	});

	it('rows after the cost has started show a negative gap', () => {
		const { baseline, costed } = project(
			{ monthlyCost: 1_500, atMonth: 1, durationMonths: 6 },
			{ months: 60 }
		);
		const rows = compareChildcareCost(baseline, costed, 'realistic', [12, 36]);
		for (const row of rows) {
			expect(row.gap).toBeLessThan(0);
			expect(row.gapShare).toBeLessThan(0);
		}
	});

	it('defaults to the forecast summary offsets when none are given', () => {
		const { baseline, costed } = project(
			{ monthlyCost: 1_500, atMonth: 1, durationMonths: 6 },
			{ months: 60 }
		);
		const rows = compareChildcareCost(baseline, costed);
		expect(rows.map((row) => row.offset)).toEqual([12, 60]);
	});

	it('drops offsets past the horizon rather than returning holes', () => {
		const { baseline, costed } = project({ monthlyCost: 1_500, atMonth: 1, durationMonths: 6 });
		const rows = compareChildcareCost(baseline, costed, 'realistic', [12, 9_999]);
		expect(rows).toHaveLength(1);
	});
});
