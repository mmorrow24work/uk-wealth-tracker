import { describe, expect, it } from 'vitest';

import { FORECAST_SCENARIOS, MAX_FORECAST_MONTHS, forecastScenarios } from './forecast.js';
import { createDebt, createInvestment } from './model.js';
import {
	DEFAULT_ONE_OFF_COST,
	compareOneOffCosts,
	createOneOffCost,
	normaliseOneOffCost,
	normaliseOneOffCosts,
	oneOffCostOccurrences,
	oneOffCostsAdjustment,
	oneOffCostsForecast,
	oneOffCostsImpact,
	oneOffCostsImpacts,
	totalOneOffCosts
} from './one-off-costs.js';

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
 * @param {readonly Partial<import('./one-off-costs.js').OneOffCost>[]} costs
 * @param {object} [input]
 * @param {import('./forecast.js').ForecastOptions} [options]
 */
function project(costs, input = {}, options = {}) {
	const position = {
		investments: [holding({ monthly_contribution: 500, fund_fee: 0 })],
		start: JAN_2026,
		months: 60,
		...input
	};
	return {
		baseline: forecastScenarios(position, options),
		costed: oneOffCostsForecast(position, options, costs)
	};
}

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

describe('DEFAULT_ONE_OFF_COST', () => {
	it('carries the three configurable fields, no id', () => {
		expect(Object.keys(DEFAULT_ONE_OFF_COST).sort()).toEqual(['amount', 'atMonth', 'name']);
	});
});

describe('createOneOffCost', () => {
	it('seeds a new row with the defaults and a fresh id', () => {
		const cost = createOneOffCost();
		expect(cost.name).toBe(DEFAULT_ONE_OFF_COST.name);
		expect(cost.atMonth).toBe(DEFAULT_ONE_OFF_COST.atMonth);
		expect(cost.amount).toBe(DEFAULT_ONE_OFF_COST.amount);
		expect(typeof cost.id).toBe('string');
		expect(cost.id).not.toBe('');
	});

	it('gives two fresh costs different ids', () => {
		expect(createOneOffCost().id).not.toBe(createOneOffCost().id);
	});

	it('accepts overrides', () => {
		const cost = createOneOffCost({ name: 'Wedding', atMonth: 6, amount: 15_000 });
		expect(cost.name).toBe('Wedding');
		expect(cost.atMonth).toBe(6);
		expect(cost.amount).toBe(15_000);
	});
});

describe('normaliseOneOffCost', () => {
	it('fills an empty cost with the defaults and a fresh id', () => {
		const cost = normaliseOneOffCost();
		expect(cost.name).toBe(DEFAULT_ONE_OFF_COST.name);
		expect(cost.atMonth).toBe(DEFAULT_ONE_OFF_COST.atMonth);
		expect(cost.amount).toBe(DEFAULT_ONE_OFF_COST.amount);
		expect(typeof cost.id).toBe('string');
	});

	it('keeps a fully specified cost, id included', () => {
		const cost = { id: 'cost_1', name: 'New car', atMonth: 18, amount: 12_000 };
		expect(normaliseOneOffCost(cost)).toEqual(cost);
	});

	it('mints a fresh id when none is given, but keeps an existing one unchanged', () => {
		expect(normaliseOneOffCost({ id: 'cost_kept' }).id).toBe('cost_kept');
		expect(normaliseOneOffCost({ id: '' }).id).not.toBe('');
	});

	it('never dates a cost at the anchor itself, which every scenario shares', () => {
		expect(normaliseOneOffCost({ atMonth: 0 }).atMonth).toBe(1);
		expect(normaliseOneOffCost({ atMonth: -5 }).atMonth).toBe(1);
	});

	it('clamps timing to the longest forecast this app will project', () => {
		expect(normaliseOneOffCost({ atMonth: 99_999 }).atMonth).toBe(MAX_FORECAST_MONTHS);
	});

	it('truncates a fractional month', () => {
		expect(normaliseOneOffCost({ atMonth: 6.9 }).atMonth).toBe(6);
	});

	it('never lets the amount go negative', () => {
		expect(normaliseOneOffCost({ amount: -500 }).amount).toBe(0);
	});

	it('places no upper bound on the amount — a large renovation is still a valid cost', () => {
		expect(normaliseOneOffCost({ amount: 250_000 }).amount).toBe(250_000);
	});

	it('falls back to the default amount on a non-numeric value', () => {
		expect(
			normaliseOneOffCost(
				/** @type {Partial<import('./one-off-costs.js').OneOffCost>} */ (
					/** @type {unknown} */ ({ amount: 'lots' })
				)
			).amount
		).toBe(DEFAULT_ONE_OFF_COST.amount);
	});

	it('keeps a name as given, including an empty one', () => {
		expect(normaliseOneOffCost({ name: 'Home renovation' }).name).toBe('Home renovation');
		expect(normaliseOneOffCost({ name: '' }).name).toBe('');
	});
});

describe('normaliseOneOffCosts', () => {
	it('normalises every item in a list', () => {
		const costs = normaliseOneOffCosts([
			{ name: 'Wedding', atMonth: 6, amount: 15_000 },
			{ name: 'Car', atMonth: 24, amount: 8_000 }
		]);
		expect(costs).toHaveLength(2);
		expect(costs[0]).toMatchObject({ name: 'Wedding', atMonth: 6, amount: 15_000 });
		expect(costs[1]).toMatchObject({ name: 'Car', atMonth: 24, amount: 8_000 });
	});

	it('is an empty list, not an error, for undefined or non-array input', () => {
		expect(normaliseOneOffCosts(undefined)).toEqual([]);
		expect(
			normaliseOneOffCosts(
				/** @type {readonly Partial<import('./one-off-costs.js').OneOffCost>[]} */ (
					/** @type {unknown} */ ('not a list')
				)
			)
		).toEqual([]);
	});

	it('is an empty list for an empty array', () => {
		expect(normaliseOneOffCosts([])).toEqual([]);
	});
});

describe('totalOneOffCosts', () => {
	it('sums every cost regardless of date', () => {
		const costs = normaliseOneOffCosts([
			{ atMonth: 6, amount: 15_000 },
			{ atMonth: 500, amount: 8_000 }
		]);
		expect(totalOneOffCosts(costs)).toBe(23_000);
	});

	it('is 0 for an empty list', () => {
		expect(totalOneOffCosts([])).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

describe('oneOffCostsAdjustment', () => {
	it('returns null every month for an empty list', () => {
		const adjust = oneOffCostsAdjustment([]);
		for (let offset = 1; offset <= 24; offset += 1) {
			expect(adjust(offset)).toBeNull();
		}
	});

	it('returns null every month when every cost is zero', () => {
		const adjust = oneOffCostsAdjustment(normaliseOneOffCosts([{ atMonth: 6, amount: 0 }]));
		expect(adjust(6)).toBeNull();
	});

	it('withdraws a single cost on its own month, and nothing else', () => {
		const adjust = oneOffCostsAdjustment(normaliseOneOffCosts([{ atMonth: 6, amount: 5_000 }]));
		expect(adjust(5)).toBeNull();
		expect(adjust(6)).toEqual({ withdrawal: 5_000 });
		expect(adjust(7)).toBeNull();
	});

	it('adds two costs due in the same month together', () => {
		const adjust = oneOffCostsAdjustment(
			normaliseOneOffCosts([
				{ atMonth: 12, amount: 5_000 },
				{ atMonth: 12, amount: 3_000 }
			])
		);
		expect(adjust(12)).toEqual({ withdrawal: 8_000 });
	});

	it('keeps two costs due in different months apart', () => {
		const adjust = oneOffCostsAdjustment(
			normaliseOneOffCosts([
				{ atMonth: 6, amount: 5_000 },
				{ atMonth: 18, amount: 3_000 }
			])
		);
		expect(adjust(6)).toEqual({ withdrawal: 5_000 });
		expect(adjust(12)).toBeNull();
		expect(adjust(18)).toEqual({ withdrawal: 3_000 });
	});

	it('ignores a zero-amount cost sharing a month with a real one', () => {
		const adjust = oneOffCostsAdjustment(
			normaliseOneOffCosts([
				{ atMonth: 6, amount: 0 },
				{ atMonth: 6, amount: 4_000 }
			])
		);
		expect(adjust(6)).toEqual({ withdrawal: 4_000 });
	});

	it('never touches growthRate, factor or contributionFactor', () => {
		const adjust = oneOffCostsAdjustment(normaliseOneOffCosts([{ atMonth: 1, amount: 1_000 }]));
		const adjustment = adjust(1);
		expect(adjustment).not.toHaveProperty('growthRate');
		expect(adjustment).not.toHaveProperty('factor');
		expect(adjustment).not.toHaveProperty('contributionFactor');
	});
});

/* -------------------------------------------------------------------------- */
/* oneOffCostsForecast                                                        */
/* -------------------------------------------------------------------------- */

describe('oneOffCostsForecast', () => {
	it('is identical to the baseline for an empty list', () => {
		const { baseline, costed } = project([]);
		for (const scenario of FORECAST_SCENARIOS) {
			expect(costed.series[scenario]).toEqual(baseline.series[scenario]);
		}
	});

	it('is identical to the baseline when every cost is zero', () => {
		const { baseline, costed } = project([{ atMonth: 6, amount: 0 }]);
		for (const scenario of FORECAST_SCENARIOS) {
			expect(costed.series[scenario]).toEqual(baseline.series[scenario]);
		}
	});

	it('carries the normalised list back as .costs', () => {
		const { costed } = project([{ name: 'Wedding', atMonth: 6, amount: 15_000 }]);
		expect(costed.costs).toHaveLength(1);
		expect(costed.costs[0]).toMatchObject({ name: 'Wedding', atMonth: 6, amount: 15_000 });
	});

	it('leaves months before the cost identical to the baseline', () => {
		const { baseline, costed } = project([{ atMonth: 24, amount: 5_000 }]);
		expect(costed.series.realistic[10]).toEqual(baseline.series.realistic[10]);
	});

	it('takes the exact amount out of the named month', () => {
		const { baseline, costed } = project([{ atMonth: 12, amount: 5_000 }], { months: 24 }, {});
		expect(costed.series.realistic[12].investments).toBeCloseTo(
			baseline.series.realistic[12].investments - 5_000,
			PENNY
		);
	});

	it('applies two costs due the same month as one combined withdrawal', () => {
		const { baseline, costed } = project(
			[
				{ atMonth: 12, amount: 5_000 },
				{ atMonth: 12, amount: 3_000 }
			],
			{ months: 24 }
		);
		expect(costed.series.realistic[12].investments).toBeCloseTo(
			baseline.series.realistic[12].investments - 8_000,
			PENNY
		);
	});

	it('still pays the month contribution — the cost comes out after it', () => {
		const { baseline, costed } = project([{ atMonth: 6, amount: 1_000 }]);
		expect(costed.series.realistic[6].contributions).toBe(
			baseline.series.realistic[6].contributions
		);
	});

	it('reaches every scenario', () => {
		const { baseline, costed } = project([{ atMonth: 6, amount: 1_000 }]);
		for (const scenario of FORECAST_SCENARIOS) {
			expect(costed.series[scenario][6].investments).toBeCloseTo(
				baseline.series[scenario][6].investments - 1_000,
				PENNY
			);
		}
	});

	it('drains the pot to zero rather than going negative when a cost exceeds it', () => {
		const { costed } = project(
			[{ atMonth: 1, amount: 999_999 }],
			{ investments: [holding({ value: 200, monthly_contribution: 0, fund_fee: 0 })] },
			{ growthRate: 0 }
		);
		expect(costed.series.realistic[1].investments).toBe(0);
		expect(costed.series.realistic[1].net_worth).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Reading the damage                                                          */
/* -------------------------------------------------------------------------- */

describe('oneOffCostOccurrences', () => {
	it('sorts costs soonest-first, regardless of input order', () => {
		const { costed } = project([
			{ id: 'cost_late', name: 'Renovation', atMonth: 36, amount: 10_000 },
			{ id: 'cost_early', name: 'Car', atMonth: 6, amount: 4_000 }
		]);
		const occurrences = oneOffCostOccurrences(costed.costs, costed);
		expect(occurrences.map((occurrence) => occurrence.id)).toEqual(['cost_early', 'cost_late']);
	});

	it('reports occurs: true and a calendar date for a cost within the horizon', () => {
		const { costed } = project([{ atMonth: 6, amount: 4_000 }]);
		const [occurrence] = oneOffCostOccurrences(costed.costs, costed);
		expect(occurrence.occurs).toBe(true);
		expect(occurrence.date).toEqual({ month: 7, year: 2026 });
	});

	it('reports occurs: false and a null date for a cost dated past the horizon', () => {
		const { costed } = project([{ atMonth: 500, amount: 4_000 }], { months: 24 });
		const [occurrence] = oneOffCostOccurrences(costed.costs, costed);
		expect(occurrence.occurs).toBe(false);
		expect(occurrence.date).toBeNull();
	});

	it('reports occurs: false for a cost of 0', () => {
		const { costed } = project([{ atMonth: 6, amount: 0 }]);
		const [occurrence] = oneOffCostOccurrences(costed.costs, costed);
		expect(occurrence.occurs).toBe(false);
	});

	it('is an empty list for an empty config', () => {
		const { costed } = project([]);
		expect(oneOffCostOccurrences(costed.costs, costed)).toEqual([]);
	});
});

describe('oneOffCostsImpact', () => {
	it('reports the shortfall in net worth at the horizon', () => {
		const { baseline, costed } = project([{ atMonth: 1, amount: 5_000 }]);
		const impact = oneOffCostsImpact(baseline, costed);
		expect(impact.shortfall).toBeCloseTo(
			(baseline.series.realistic.at(-1)?.net_worth ?? 0) -
				(costed.series.realistic.at(-1)?.net_worth ?? 0),
			PENNY
		);
		// Positive growth means the withdrawn pounds would themselves have compounded, so the
		// shortfall at the horizon outgrows the bare cost.
		expect(impact.shortfall).toBeGreaterThan(5_000);
	});

	it('totalConfigured and totalOccurring agree when every cost falls inside the horizon', () => {
		const { baseline, costed } = project(
			[
				{ atMonth: 6, amount: 5_000 },
				{ atMonth: 24, amount: 3_000 }
			],
			{ months: 60 }
		);
		const impact = oneOffCostsImpact(baseline, costed);
		expect(impact.totalConfigured).toBe(8_000);
		expect(impact.totalOccurring).toBe(8_000);
	});

	it('totalOccurring excludes a cost dated past the horizon; totalConfigured still counts it', () => {
		const { baseline, costed } = project(
			[
				{ atMonth: 6, amount: 5_000 },
				{ atMonth: 500, amount: 3_000 }
			],
			{ months: 24 }
		);
		const impact = oneOffCostsImpact(baseline, costed);
		expect(impact.totalConfigured).toBe(8_000);
		expect(impact.totalOccurring).toBe(5_000);
	});

	it('is a zero-effect impact for an empty list', () => {
		const { baseline, costed } = project([]);
		const impact = oneOffCostsImpact(baseline, costed);
		expect(impact.totalConfigured).toBe(0);
		expect(impact.totalOccurring).toBe(0);
		expect(impact.shortfall).toBe(0);
		expect(impact.costs).toEqual([]);
	});

	it('carries the dated occurrences for the caller to list', () => {
		const { baseline, costed } = project([{ name: 'Wedding', atMonth: 6, amount: 5_000 }]);
		const impact = oneOffCostsImpact(baseline, costed);
		expect(impact.costs).toHaveLength(1);
		expect(impact.costs[0]).toMatchObject({ name: 'Wedding', occurs: true });
	});

	it('reports a null shortfallShare when the baseline ends at or below zero', () => {
		const { baseline, costed } = project([{ atMonth: 1, amount: 1_000 }], {
			investments: [],
			debts: [createDebt({ balance: 5_000 })]
		});
		expect(oneOffCostsImpact(baseline, costed).shortfallShare).toBeNull();
	});
});

describe('oneOffCostsImpacts', () => {
	it('returns one impact per scenario', () => {
		const { baseline, costed } = project([{ atMonth: 1, amount: 5_000 }]);
		const impacts = oneOffCostsImpacts(baseline, costed);
		expect(Object.keys(impacts).sort()).toEqual([...FORECAST_SCENARIOS].sort());
		for (const scenario of FORECAST_SCENARIOS) {
			expect(impacts[scenario].scenario).toBe(scenario);
			expect(impacts[scenario].totalOccurring).toBe(5_000);
		}
	});
});

describe('compareOneOffCosts', () => {
	it('rows before any cost lands are identical between the two projections', () => {
		const { baseline, costed } = project([{ atMonth: 24, amount: 5_000 }], { months: 60 });
		const rows = compareOneOffCosts(baseline, costed, 'realistic', [1, 12]);
		for (const row of rows) {
			expect(row.gap).toBe(0);
		}
	});

	it('rows after a cost has landed show a negative gap', () => {
		const { baseline, costed } = project([{ atMonth: 1, amount: 5_000 }], { months: 60 });
		const rows = compareOneOffCosts(baseline, costed, 'realistic', [12, 36]);
		for (const row of rows) {
			expect(row.gap).toBeLessThan(0);
			expect(row.gapShare).toBeLessThan(0);
		}
	});

	it('defaults to the forecast summary offsets when none are given', () => {
		const { baseline, costed } = project([{ atMonth: 1, amount: 5_000 }], { months: 60 });
		const rows = compareOneOffCosts(baseline, costed);
		expect(rows.map((row) => row.offset)).toEqual([12, 60]);
	});

	it('drops offsets past the horizon rather than returning holes', () => {
		const { baseline, costed } = project([{ atMonth: 1, amount: 5_000 }]);
		const rows = compareOneOffCosts(baseline, costed, 'realistic', [12, 9_999]);
		expect(rows).toHaveLength(1);
	});
});
