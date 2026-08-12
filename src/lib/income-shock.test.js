import { describe, expect, it } from 'vitest';

import { FORECAST_SCENARIOS, MAX_FORECAST_MONTHS, forecastScenarios } from './forecast.js';
import {
	DEFAULT_INCOME_SHOCK,
	MAX_INCOME_SHOCK_DROP,
	compareIncomeShock,
	dropEndsAt,
	droppedContributionFactor,
	incomeShockAdjustment,
	incomeShockForecast,
	incomeShockImpact,
	incomeShockImpacts,
	normaliseIncomeShock,
	rampEndsAt
} from './income-shock.js';
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
 * @param {Partial<import('./income-shock.js').IncomeShock>} shock
 * @param {object} [input]
 * @param {import('./forecast.js').ForecastOptions} [options]
 */
function project(shock, input = {}, options = {}) {
	const position = {
		investments: [holding({ monthly_contribution: 1_000, fund_fee: 0 })],
		start: JAN_2026,
		months: 60,
		...input
	};
	return {
		baseline: forecastScenarios(position, options),
		shocked: incomeShockForecast(position, options, shock)
	};
}

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

describe('DEFAULT_INCOME_SHOCK', () => {
	it('carries the four dials, and nothing else', () => {
		expect(Object.keys(DEFAULT_INCOME_SHOCK).sort()).toEqual([
			'atMonth',
			'dropPct',
			'durationMonths',
			'rampMonths'
		]);
	});

	it('is already normalised', () => {
		expect(normaliseIncomeShock(DEFAULT_INCOME_SHOCK)).toEqual({ ...DEFAULT_INCOME_SHOCK });
	});

	it('is a full stop with no taper — a clean job loss, not an illness ramp', () => {
		expect(DEFAULT_INCOME_SHOCK.dropPct).toBe(100);
		expect(DEFAULT_INCOME_SHOCK.rampMonths).toBe(0);
	});
});

describe('normaliseIncomeShock', () => {
	it('fills an empty config with the defaults', () => {
		expect(normaliseIncomeShock()).toEqual({ ...DEFAULT_INCOME_SHOCK });
	});

	it('keeps a fully specified config', () => {
		const shock = { dropPct: 50, atMonth: 24, durationMonths: 9, rampMonths: 6 };
		expect(normaliseIncomeShock(shock)).toEqual(shock);
	});

	it('clamps the drop to 0…100 — contributions cannot fall by more than everything', () => {
		expect(normaliseIncomeShock({ dropPct: -10 }).dropPct).toBe(0);
		expect(normaliseIncomeShock({ dropPct: 250 }).dropPct).toBe(MAX_INCOME_SHOCK_DROP);
	});

	it('never dates the shock at the anchor itself, which every scenario shares', () => {
		expect(normaliseIncomeShock({ atMonth: 0 }).atMonth).toBe(1);
		expect(normaliseIncomeShock({ atMonth: -5 }).atMonth).toBe(1);
	});

	it('clamps timing, duration and ramp to the longest forecast this app will project', () => {
		expect(normaliseIncomeShock({ atMonth: 99_999 }).atMonth).toBe(MAX_FORECAST_MONTHS);
		expect(normaliseIncomeShock({ durationMonths: 99_999 }).durationMonths).toBe(
			MAX_FORECAST_MONTHS
		);
		expect(normaliseIncomeShock({ rampMonths: 99_999 }).rampMonths).toBe(MAX_FORECAST_MONTHS);
	});

	it('never lets duration or ramp go negative', () => {
		expect(normaliseIncomeShock({ durationMonths: -3 }).durationMonths).toBe(0);
		expect(normaliseIncomeShock({ rampMonths: -3 }).rampMonths).toBe(0);
	});

	it('truncates fractional months', () => {
		expect(normaliseIncomeShock({ atMonth: 6.9 }).atMonth).toBe(6);
		expect(normaliseIncomeShock({ durationMonths: 3.9 }).durationMonths).toBe(3);
	});

	it('falls back to the default on a non-numeric value', () => {
		expect(
			normaliseIncomeShock(
				/** @type {Partial<import('./income-shock.js').IncomeShock>} */ (
					/** @type {unknown} */ ({ dropPct: 'a lot' })
				)
			).dropPct
		).toBe(DEFAULT_INCOME_SHOCK.dropPct);
	});
});

describe('droppedContributionFactor', () => {
	it('is 0 at a full 100% drop', () => {
		expect(droppedContributionFactor(100)).toBe(0);
	});

	it('is 0.5 at a 50% drop', () => {
		expect(droppedContributionFactor(50)).toBe(0.5);
	});

	it('is 1 (no change) at a 0% drop', () => {
		expect(droppedContributionFactor(0)).toBe(1);
	});
});

describe('dropEndsAt / rampEndsAt', () => {
	it('dropEndsAt is atMonth + durationMonths', () => {
		expect(dropEndsAt({ atMonth: 12, durationMonths: 6, dropPct: 100, rampMonths: 0 })).toBe(18);
	});

	it('rampEndsAt adds the ramp on top of the drop', () => {
		expect(rampEndsAt({ atMonth: 12, durationMonths: 6, dropPct: 100, rampMonths: 3 })).toBe(21);
	});

	it('rampEndsAt equals dropEndsAt when there is no ramp', () => {
		const shock = { atMonth: 12, durationMonths: 6, dropPct: 100, rampMonths: 0 };
		expect(rampEndsAt(shock)).toBe(dropEndsAt(shock));
	});
});

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

describe('incomeShockAdjustment', () => {
	it('returns null every month at a 0% drop, whatever the duration or ramp', () => {
		const adjust = incomeShockAdjustment(
			normaliseIncomeShock({ dropPct: 0, atMonth: 1, durationMonths: 12, rampMonths: 6 })
		);
		for (let offset = 1; offset <= 24; offset += 1) {
			expect(adjust(offset)).toBeNull();
		}
	});

	it('scales the contribution for every month of the drop window, and nothing else', () => {
		const shock = normaliseIncomeShock({
			dropPct: 60,
			atMonth: 3,
			durationMonths: 2,
			rampMonths: 0
		});
		const adjust = incomeShockAdjustment(shock);

		expect(adjust(2)).toBeNull();
		expect(adjust(3)).toEqual({ contributionFactor: 0.4 });
		expect(adjust(4)).toEqual({ contributionFactor: 0.4 });
		expect(adjust(5)).toBeNull();
	});

	it('never touches growthRate or factor — only contributionFactor', () => {
		const adjust = incomeShockAdjustment(normaliseIncomeShock({ dropPct: 100, atMonth: 1 }));
		const adjustment = adjust(1);
		expect(adjustment).not.toHaveProperty('growthRate');
		expect(adjustment).not.toHaveProperty('factor');
	});

	it('ramps linearly from the dropped level back to normal, landing on 1 only after the ramp closes', () => {
		const shock = normaliseIncomeShock({
			dropPct: 100,
			atMonth: 1,
			durationMonths: 1,
			rampMonths: 3
		});
		const adjust = incomeShockAdjustment(shock);

		expect(adjust(1)?.contributionFactor).toBe(0);
		// dropEndsAt = 2, rampEndsAt = 5: months 2, 3, 4 ramp; 1/4, 2/4, 3/4 of the way back.
		expect(adjust(2)?.contributionFactor).toBeCloseTo(0.25, 6);
		expect(adjust(3)?.contributionFactor).toBeCloseTo(0.5, 6);
		expect(adjust(4)?.contributionFactor).toBeCloseTo(0.75, 6);
		expect(adjust(5)).toBeNull();
	});

	it('is a job loss with no taper when rampMonths is 0 — contributions resume in full the month after', () => {
		const shock = normaliseIncomeShock({
			dropPct: 100,
			atMonth: 1,
			durationMonths: 2,
			rampMonths: 0
		});
		const adjust = incomeShockAdjustment(shock);
		expect(adjust(2)?.contributionFactor).toBe(0);
		expect(adjust(3)).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* incomeShockForecast                                                        */
/* -------------------------------------------------------------------------- */

describe('incomeShockForecast', () => {
	it('is identical to the baseline at a 0% drop', () => {
		const { baseline, shocked } = project({ dropPct: 0 });
		for (const scenario of FORECAST_SCENARIOS) {
			expect(shocked.series[scenario]).toEqual(baseline.series[scenario]);
		}
	});

	it('carries the normalised config back as .shock', () => {
		const { shocked } = project({ dropPct: 40, atMonth: 6, durationMonths: 3, rampMonths: 2 });
		expect(shocked.shock).toEqual({ dropPct: 40, atMonth: 6, durationMonths: 3, rampMonths: 2 });
	});

	it('leaves months outside the shock window contributing in full', () => {
		const { baseline, shocked } = project({ dropPct: 100, atMonth: 6, durationMonths: 3 });
		expect(shocked.series.realistic[1].investments).toEqual(
			baseline.series.realistic[1].investments
		);
		expect(
			shocked.series.realistic[20].contributions - shocked.series.realistic[19].contributions
		).toBe(1_000);
	});

	it('pays nothing during a 100% drop window', () => {
		const { shocked } = project({ dropPct: 100, atMonth: 6, durationMonths: 3, rampMonths: 0 });
		const series = shocked.series.realistic;
		expect(series[6].contributions).toBe(series[5].contributions);
		expect(series[7].contributions).toBe(series[5].contributions);
		expect(series[8].contributions).toBe(series[5].contributions);
		expect(series[9].contributions).toBe(series[5].contributions + 1_000);
	});

	it('leaves growth untouched — every scenario compounds at exactly its own rate throughout', () => {
		const { baseline, shocked } = project(
			{ dropPct: 100, atMonth: 6, durationMonths: 3, rampMonths: 0 },
			{
				investments: [
					holding({ monthly_contribution: 1_000, fund_fee: 0, contribution_frequency: 'annually' })
				]
			},
			{ growthRate: 5 }
		);
		// No contribution is due around month 6 for an annual holding, so the shock has nothing to
		// scale there — the two projections must therefore be byte-identical at that point.
		expect(shocked.series.realistic[6]).toEqual(baseline.series.realistic[6]);
	});

	it('reaches every scenario, each still contributing the same amount when unaffected', () => {
		const { shocked } = project({ dropPct: 50, atMonth: 1, durationMonths: 1, rampMonths: 0 });
		for (const scenario of FORECAST_SCENARIOS) {
			expect(shocked.series[scenario][1].contributions).toBe(500);
		}
	});
});

/* -------------------------------------------------------------------------- */
/* Reading the damage                                                          */
/* -------------------------------------------------------------------------- */

describe('incomeShockImpact', () => {
	it('reports occurs: false when the shock is dated past the forecast horizon', () => {
		const { baseline, shocked } = project(
			{ dropPct: 100, atMonth: 200, durationMonths: 3 },
			{ months: 24 }
		);
		const impact = incomeShockImpact(baseline, shocked);
		expect(impact.occurs).toBe(false);
	});

	it('reports occurs: false at a 0% drop', () => {
		const { baseline, shocked } = project({ dropPct: 0 });
		expect(incomeShockImpact(baseline, shocked).occurs).toBe(false);
	});

	it('measures contributions forgone exactly, for a deterministic full stop', () => {
		const { baseline, shocked } = project({
			dropPct: 100,
			atMonth: 1,
			durationMonths: 3,
			rampMonths: 0
		});
		const impact = incomeShockImpact(baseline, shocked);
		expect(impact.occurs).toBe(true);
		expect(impact.contributionsForgone).toBe(3_000);
	});

	it('halves the forgone amount at a 50% drop', () => {
		const { baseline, shocked } = project({
			dropPct: 50,
			atMonth: 1,
			durationMonths: 3,
			rampMonths: 0
		});
		expect(incomeShockImpact(baseline, shocked).contributionsForgone).toBe(1_500);
	});

	it('the forgone total stops growing once the ramp has closed', () => {
		const { baseline, shocked } = project({
			dropPct: 100,
			atMonth: 1,
			durationMonths: 2,
			rampMonths: 2
		});
		const impact = incomeShockImpact(baseline, shocked);
		const atRampEnd = rampEndsAt(shocked.shock);
		const laterGap =
			(baseline.series.realistic.at(-1)?.contributions ?? 0) -
			(shocked.series.realistic.at(-1)?.contributions ?? 0);
		expect(laterGap).toBeCloseTo(impact.contributionsForgone, PENNY);
		expect(atRampEnd).toBeLessThan(baseline.series.realistic.length - 1);
	});

	it('shortfall is the gap in net worth at the horizon, and grows to more than the forgone contributions alone', () => {
		const { baseline, shocked } = project({
			dropPct: 100,
			atMonth: 1,
			durationMonths: 6,
			rampMonths: 0
		});
		const impact = incomeShockImpact(baseline, shocked);
		expect(impact.shortfall).toBeCloseTo(
			(baseline.series.realistic.at(-1)?.net_worth ?? 0) -
				(shocked.series.realistic.at(-1)?.net_worth ?? 0),
			PENNY
		);
		// Positive growth means the forgone pounds would themselves have compounded, so the shortfall
		// outgrows the bare contributions total.
		expect(impact.shortfall).toBeGreaterThan(impact.contributionsForgone);
		expect(impact.compoundingLoss).toBeGreaterThan(0);
	});

	it('reports dates for when the drop and the ramp end', () => {
		const { baseline, shocked } = project({
			dropPct: 100,
			atMonth: 1,
			durationMonths: 2,
			rampMonths: 3
		});
		const impact = incomeShockImpact(baseline, shocked);
		// atMonth 1 = Feb 2026; dropEndsAt = 1 + 2 = offset 3 = Apr 2026; rampEndsAt = 3 + 3 = offset 6 =
		// Jul 2026.
		expect(impact.date).toEqual({ month: 2, year: 2026 });
		expect(impact.dropEndsDate).toEqual({ month: 4, year: 2026 });
		expect(impact.rampEndsDate).toEqual({ month: 7, year: 2026 });
	});

	it('reports a null shortfallShare when the baseline ends at or below zero', () => {
		const { baseline, shocked } = project(
			{ dropPct: 100, atMonth: 1, durationMonths: 3 },
			{ investments: [], debts: [createDebt({ balance: 5_000 })] }
		);
		expect(incomeShockImpact(baseline, shocked).shortfallShare).toBeNull();
	});
});

describe('incomeShockImpacts', () => {
	it('returns one impact per scenario', () => {
		const { baseline, shocked } = project({ dropPct: 100, atMonth: 1, durationMonths: 3 });
		const impacts = incomeShockImpacts(baseline, shocked);
		expect(Object.keys(impacts).sort()).toEqual([...FORECAST_SCENARIOS].sort());
		for (const scenario of FORECAST_SCENARIOS) {
			expect(impacts[scenario].scenario).toBe(scenario);
			expect(impacts[scenario].occurs).toBe(true);
		}
	});
});

describe('compareIncomeShock', () => {
	it('rows before the shock starts are identical between the two projections', () => {
		const { baseline, shocked } = project(
			{ dropPct: 100, atMonth: 24, durationMonths: 6 },
			{ months: 60 }
		);
		const rows = compareIncomeShock(baseline, shocked, 'realistic', [1, 12]);
		for (const row of rows) {
			expect(row.gap).toBe(0);
		}
	});

	it('rows after the shock has started show a negative gap', () => {
		const { baseline, shocked } = project(
			{ dropPct: 100, atMonth: 1, durationMonths: 6 },
			{ months: 60 }
		);
		const rows = compareIncomeShock(baseline, shocked, 'realistic', [12, 36]);
		for (const row of rows) {
			expect(row.gap).toBeLessThan(0);
			expect(row.gapShare).toBeLessThan(0);
		}
	});

	it('defaults to the forecast summary offsets when none are given', () => {
		const { baseline, shocked } = project(
			{ dropPct: 100, atMonth: 1, durationMonths: 6 },
			{ months: 60 }
		);
		const rows = compareIncomeShock(baseline, shocked);
		expect(rows.map((row) => row.offset)).toEqual([12, 60]);
	});

	it('drops offsets past the horizon rather than returning holes', () => {
		const { baseline, shocked } = project({ dropPct: 100, atMonth: 1, durationMonths: 6 });
		const rows = compareIncomeShock(baseline, shocked, 'realistic', [12, 9_999]);
		expect(rows).toHaveLength(1);
	});
});
