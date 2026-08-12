import { describe, expect, it } from 'vitest';

import {
	DEFAULT_CHILDCARE_COST_STEP,
	childcareCostAdjustment,
	childcareCostForOffset,
	childcareCostForecast,
	childcareCostImpact,
	childcareCostImpacts,
	childcareCostOccurrences,
	childcareCostStepEndsAt,
	compareChildcareCost,
	createChildcareCostStep,
	normaliseChildcareCostStep,
	normaliseChildcareCostSteps,
	totalChildcareCost
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
 * @param {readonly Partial<import('./childcare-cost.js').ChildcareCostStep>[]} steps
 * @param {object} [input]
 * @param {import('./forecast.js').ForecastOptions} [options]
 */
function project(steps, input = {}, options = {}) {
	const position = {
		investments: [holding({ monthly_contribution: 1_000, fund_fee: 0 })],
		start: JAN_2026,
		months: 60,
		...input
	};
	return {
		baseline: forecastScenarios(position, options),
		costed: childcareCostForecast(position, options, steps)
	};
}

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

describe('DEFAULT_CHILDCARE_COST_STEP', () => {
	it('carries the four configurable fields, no id', () => {
		expect(Object.keys(DEFAULT_CHILDCARE_COST_STEP).sort()).toEqual([
			'atMonth',
			'durationMonths',
			'monthlyCost',
			'name'
		]);
	});
});

describe('createChildcareCostStep', () => {
	it('seeds a new row with the defaults and a fresh id', () => {
		const step = createChildcareCostStep();
		expect(step.name).toBe(DEFAULT_CHILDCARE_COST_STEP.name);
		expect(step.monthlyCost).toBe(DEFAULT_CHILDCARE_COST_STEP.monthlyCost);
		expect(step.atMonth).toBe(DEFAULT_CHILDCARE_COST_STEP.atMonth);
		expect(step.durationMonths).toBe(DEFAULT_CHILDCARE_COST_STEP.durationMonths);
		expect(typeof step.id).toBe('string');
		expect(step.id).not.toBe('');
	});

	it('gives two fresh steps different ids', () => {
		expect(createChildcareCostStep().id).not.toBe(createChildcareCostStep().id);
	});

	it('accepts overrides', () => {
		const step = createChildcareCostStep({
			name: 'Nursery',
			monthlyCost: 1_200,
			atMonth: 6,
			durationMonths: 24
		});
		expect(step.name).toBe('Nursery');
		expect(step.monthlyCost).toBe(1_200);
		expect(step.atMonth).toBe(6);
		expect(step.durationMonths).toBe(24);
	});
});

describe('normaliseChildcareCostStep', () => {
	it('fills an empty step with the defaults and a fresh id', () => {
		const step = normaliseChildcareCostStep();
		expect(step.name).toBe(DEFAULT_CHILDCARE_COST_STEP.name);
		expect(step.monthlyCost).toBe(DEFAULT_CHILDCARE_COST_STEP.monthlyCost);
		expect(step.atMonth).toBe(DEFAULT_CHILDCARE_COST_STEP.atMonth);
		expect(step.durationMonths).toBe(DEFAULT_CHILDCARE_COST_STEP.durationMonths);
		expect(typeof step.id).toBe('string');
	});

	it('keeps a fully specified step, id included', () => {
		const step = {
			id: 'childcare_1',
			name: 'Childminder',
			monthlyCost: 700,
			atMonth: 18,
			durationMonths: 12
		};
		expect(normaliseChildcareCostStep(step)).toEqual(step);
	});

	it('mints a fresh id when none is given, but keeps an existing one unchanged', () => {
		expect(normaliseChildcareCostStep({ id: 'childcare_kept' }).id).toBe('childcare_kept');
		expect(normaliseChildcareCostStep({ id: '' }).id).not.toBe('');
	});

	it('never dates a step at the anchor itself, which every scenario shares', () => {
		expect(normaliseChildcareCostStep({ atMonth: 0 }).atMonth).toBe(1);
		expect(normaliseChildcareCostStep({ atMonth: -5 }).atMonth).toBe(1);
	});

	it('clamps timing to the longest forecast this app will project', () => {
		expect(normaliseChildcareCostStep({ atMonth: 99_999 }).atMonth).toBe(MAX_FORECAST_MONTHS);
	});

	it('truncates a fractional month', () => {
		expect(normaliseChildcareCostStep({ atMonth: 6.9 }).atMonth).toBe(6);
	});

	it('never lets the monthly cost go negative', () => {
		expect(normaliseChildcareCostStep({ monthlyCost: -500 }).monthlyCost).toBe(0);
	});

	it('places no upper bound on the monthly cost', () => {
		expect(normaliseChildcareCostStep({ monthlyCost: 5_000 }).monthlyCost).toBe(5_000);
	});

	it('falls back to the default monthly cost on a non-numeric value', () => {
		expect(
			normaliseChildcareCostStep(
				/** @type {Partial<import('./childcare-cost.js').ChildcareCostStep>} */ (
					/** @type {unknown} */ ({ monthlyCost: 'lots' })
				)
			).monthlyCost
		).toBe(DEFAULT_CHILDCARE_COST_STEP.monthlyCost);
	});

	it('never lets the duration go negative, and clamps it to the longest forecast', () => {
		expect(normaliseChildcareCostStep({ durationMonths: -5 }).durationMonths).toBe(0);
		expect(normaliseChildcareCostStep({ durationMonths: 99_999 }).durationMonths).toBe(
			MAX_FORECAST_MONTHS
		);
	});

	it('keeps a name as given, including an empty one', () => {
		expect(normaliseChildcareCostStep({ name: 'After-school club' }).name).toBe(
			'After-school club'
		);
		expect(normaliseChildcareCostStep({ name: '' }).name).toBe('');
	});
});

describe('normaliseChildcareCostSteps', () => {
	it('normalises every item in a list', () => {
		const steps = normaliseChildcareCostSteps([
			{ name: 'Nursery', monthlyCost: 1_200, atMonth: 1, durationMonths: 36 },
			{ name: 'After-school club', monthlyCost: 400, atMonth: 37, durationMonths: 24 }
		]);
		expect(steps).toHaveLength(2);
		expect(steps[0]).toMatchObject({ name: 'Nursery', monthlyCost: 1_200 });
		expect(steps[1]).toMatchObject({ name: 'After-school club', monthlyCost: 400 });
	});

	it('is an empty list, not an error, for undefined or non-array input', () => {
		expect(normaliseChildcareCostSteps(undefined)).toEqual([]);
		expect(
			normaliseChildcareCostSteps(
				/** @type {readonly Partial<import('./childcare-cost.js').ChildcareCostStep>[]} */ (
					/** @type {unknown} */ ('not a list')
				)
			)
		).toEqual([]);
	});

	it('is an empty list for an empty array', () => {
		expect(normaliseChildcareCostSteps([])).toEqual([]);
	});
});

describe('childcareCostStepEndsAt', () => {
	it('is atMonth + durationMonths', () => {
		const step = normaliseChildcareCostStep({ atMonth: 6, durationMonths: 24 });
		expect(childcareCostStepEndsAt(step)).toBe(30);
	});

	it('equals atMonth when durationMonths is 0', () => {
		const step = normaliseChildcareCostStep({ atMonth: 6, durationMonths: 0 });
		expect(childcareCostStepEndsAt(step)).toBe(6);
	});
});

describe('totalChildcareCost', () => {
	it('sums monthlyCost * durationMonths across every step, regardless of date', () => {
		const steps = normaliseChildcareCostSteps([
			{ monthlyCost: 1_000, atMonth: 1, durationMonths: 12 },
			{ monthlyCost: 500, atMonth: 500, durationMonths: 6 }
		]);
		expect(totalChildcareCost(steps)).toBe(15_000);
	});

	it('is 0 for an empty list', () => {
		expect(totalChildcareCost([])).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

describe('childcareCostForOffset', () => {
	it('is 0 for an empty list', () => {
		expect(childcareCostForOffset([], 6)).toBe(0);
	});

	it('is the monthly cost while a single step is active, and 0 outside it', () => {
		const steps = normaliseChildcareCostSteps([
			{ monthlyCost: 900, atMonth: 6, durationMonths: 12 }
		]);
		expect(childcareCostForOffset(steps, 5)).toBe(0);
		expect(childcareCostForOffset(steps, 6)).toBe(900);
		expect(childcareCostForOffset(steps, 17)).toBe(900);
		expect(childcareCostForOffset(steps, 18)).toBe(0);
	});

	it('adds two overlapping steps together', () => {
		const steps = normaliseChildcareCostSteps([
			{ monthlyCost: 900, atMonth: 1, durationMonths: 24 },
			{ monthlyCost: 400, atMonth: 12, durationMonths: 12 }
		]);
		expect(childcareCostForOffset(steps, 6)).toBe(900);
		expect(childcareCostForOffset(steps, 12)).toBe(1_300);
		expect(childcareCostForOffset(steps, 23)).toBe(1_300);
	});

	it('steps down at the boundary between two adjoining steps', () => {
		const steps = normaliseChildcareCostSteps([
			{ monthlyCost: 1_200, atMonth: 1, durationMonths: 36 },
			{ monthlyCost: 500, atMonth: 37, durationMonths: 24 }
		]);
		expect(childcareCostForOffset(steps, 36)).toBe(1_200);
		expect(childcareCostForOffset(steps, 37)).toBe(500);
	});

	it('ignores a zero-cost or zero-duration step', () => {
		const steps = normaliseChildcareCostSteps([
			{ monthlyCost: 0, atMonth: 1, durationMonths: 24 },
			{ monthlyCost: 500, atMonth: 1, durationMonths: 0 }
		]);
		expect(childcareCostForOffset(steps, 1)).toBe(0);
	});
});

describe('childcareCostAdjustment', () => {
	it('returns null every month for an empty list', () => {
		const adjust = childcareCostAdjustment([], [holding({ monthly_contribution: 1_000 })]);
		for (let offset = 1; offset <= 24; offset += 1) {
			expect(adjust(offset)).toBeNull();
		}
	});

	it('returns null every month when every step is zero-cost', () => {
		const adjust = childcareCostAdjustment(
			normaliseChildcareCostSteps([{ atMonth: 1, durationMonths: 24, monthlyCost: 0 }]),
			[holding({ monthly_contribution: 1_000 })]
		);
		expect(adjust(6)).toBeNull();
	});

	it('leaves months outside the range untouched', () => {
		const adjust = childcareCostAdjustment(
			normaliseChildcareCostSteps([{ monthlyCost: 900, atMonth: 6, durationMonths: 12 }]),
			[holding({ monthly_contribution: 1_000 })]
		);
		expect(adjust(5)).toBeNull();
		expect(adjust(18)).toBeNull();
	});

	it('scales the contribution by the bill’s share of the total while the step is active', () => {
		const adjust = childcareCostAdjustment(
			normaliseChildcareCostSteps([{ monthlyCost: 400, atMonth: 1, durationMonths: 12 }]),
			[holding({ monthly_contribution: 1_000 })]
		);
		expect(adjust(1)).toEqual({ contributionFactor: 0.6 });
		expect(adjust(1)).not.toHaveProperty('growthRate');
		expect(adjust(1)).not.toHaveProperty('factor');
		expect(adjust(1)).not.toHaveProperty('withdrawal');
	});

	it('floors the contribution factor at 0 rather than letting it go negative', () => {
		const adjust = childcareCostAdjustment(
			normaliseChildcareCostSteps([{ monthlyCost: 2_000, atMonth: 1, durationMonths: 12 }]),
			[holding({ monthly_contribution: 1_000 })]
		);
		expect(adjust(1)).toEqual({ contributionFactor: 0 });
	});

	it('has nothing to scale when no contribution is due that month', () => {
		const adjust = childcareCostAdjustment(
			normaliseChildcareCostSteps([{ monthlyCost: 900, atMonth: 1, durationMonths: 12 }]),
			[holding({ monthly_contribution: 1_000, contribution_frequency: 'annually' })]
		);
		// Offset 1 is not a multiple of 12, so the annual holding pays nothing that month.
		expect(adjust(1)).toEqual({ contributionFactor: 0 });
	});

	it('adds two overlapping steps into one combined factor', () => {
		const adjust = childcareCostAdjustment(
			normaliseChildcareCostSteps([
				{ monthlyCost: 400, atMonth: 1, durationMonths: 12 },
				{ monthlyCost: 200, atMonth: 1, durationMonths: 12 }
			]),
			[holding({ monthly_contribution: 1_000 })]
		);
		expect(adjust(1)).toEqual({ contributionFactor: 0.4 });
	});

	it('excludes a holding marked out of net worth from the total contribution', () => {
		const adjust = childcareCostAdjustment(
			normaliseChildcareCostSteps([{ monthlyCost: 500, atMonth: 1, durationMonths: 12 }]),
			[
				holding({ id: 'inv_a', monthly_contribution: 1_000 }),
				holding({ id: 'inv_b', monthly_contribution: 1_000, exclude_from_net_worth: true })
			]
		);
		expect(adjust(1)).toEqual({ contributionFactor: 0.5 });
	});
});

/* -------------------------------------------------------------------------- */
/* childcareCostForecast                                                      */
/* -------------------------------------------------------------------------- */

describe('childcareCostForecast', () => {
	it('is identical to the baseline for an empty list', () => {
		const { baseline, costed } = project([]);
		for (const scenario of FORECAST_SCENARIOS) {
			expect(costed.series[scenario]).toEqual(baseline.series[scenario]);
		}
	});

	it('is identical to the baseline when every step is zero-cost', () => {
		const { baseline, costed } = project([{ atMonth: 1, durationMonths: 24, monthlyCost: 0 }]);
		for (const scenario of FORECAST_SCENARIOS) {
			expect(costed.series[scenario]).toEqual(baseline.series[scenario]);
		}
	});

	it('carries the normalised list back as .childcare', () => {
		const { costed } = project([
			{ name: 'Nursery', monthlyCost: 900, atMonth: 1, durationMonths: 36 }
		]);
		expect(costed.childcare).toHaveLength(1);
		expect(costed.childcare[0]).toMatchObject({ name: 'Nursery', monthlyCost: 900 });
	});

	it('leaves months before a step starts identical to the baseline', () => {
		const { baseline, costed } = project([{ monthlyCost: 900, atMonth: 24, durationMonths: 12 }]);
		expect(costed.series.realistic[10]).toEqual(baseline.series.realistic[10]);
	});

	it('shrinks the paid-in contribution by the bill while a step is active', () => {
		const { baseline, costed } = project([{ monthlyCost: 400, atMonth: 1, durationMonths: 12 }]);
		expect(costed.series.realistic[1].contributions).toBeCloseTo(
			baseline.series.realistic[1].contributions * 0.6,
			PENNY
		);
	});

	it('leaves the month-on-month contribution unchanged again once the step has ended', () => {
		// `contributions` is cumulative since the anchor (module doc), so the gap it opened during
		// the step never closes — but the *rate* it grows at afterwards should match the baseline's
		// own, i.e. the difference between two post-step months should agree exactly.
		const { baseline, costed } = project([{ monthlyCost: 400, atMonth: 1, durationMonths: 12 }], {
			months: 24
		});
		const baselineDelta =
			baseline.series.realistic[24].contributions - baseline.series.realistic[13].contributions;
		const costedDelta =
			costed.series.realistic[24].contributions - costed.series.realistic[13].contributions;
		expect(costedDelta).toBeCloseTo(baselineDelta, PENNY);
	});

	it('reaches every scenario', () => {
		const { baseline, costed } = project([{ monthlyCost: 400, atMonth: 1, durationMonths: 12 }]);
		for (const scenario of FORECAST_SCENARIOS) {
			expect(costed.series[scenario][1].contributions).toBeCloseTo(
				baseline.series[scenario][1].contributions * 0.6,
				PENNY
			);
		}
	});

	it('never makes up a missed contribution once the step ends — the gap stays open', () => {
		const { baseline, costed } = project([{ monthlyCost: 1_000, atMonth: 1, durationMonths: 6 }], {
			months: 24
		});
		const baselineFinal = baseline.series.realistic.at(-1)?.net_worth ?? 0;
		const costedFinal = costed.series.realistic.at(-1)?.net_worth ?? 0;
		expect(costedFinal).toBeLessThan(baselineFinal);
	});
});

/* -------------------------------------------------------------------------- */
/* Reading the damage                                                          */
/* -------------------------------------------------------------------------- */

describe('childcareCostOccurrences', () => {
	it('sorts steps soonest-first, regardless of input order', () => {
		const { costed } = project([
			{
				id: 'childcare_late',
				name: 'After-school club',
				monthlyCost: 400,
				atMonth: 37,
				durationMonths: 24
			},
			{ id: 'childcare_early', name: 'Nursery', monthlyCost: 900, atMonth: 1, durationMonths: 36 }
		]);
		const occurrences = childcareCostOccurrences(costed.childcare, costed);
		expect(occurrences.map((occurrence) => occurrence.id)).toEqual([
			'childcare_early',
			'childcare_late'
		]);
	});

	it('reports occurs: true and calendar dates for a step within the horizon', () => {
		const { costed } = project([{ monthlyCost: 900, atMonth: 6, durationMonths: 12 }]);
		const [occurrence] = childcareCostOccurrences(costed.childcare, costed);
		expect(occurrence.occurs).toBe(true);
		expect(occurrence.date).toEqual({ month: 7, year: 2026 });
		expect(occurrence.endDate).toEqual({ month: 7, year: 2027 });
		expect(occurrence.monthsOccurring).toBe(12);
		expect(occurrence.totalCost).toBe(10_800);
	});

	it('reports occurs: false and null dates for a step dated past the horizon', () => {
		const { costed } = project([{ monthlyCost: 900, atMonth: 500, durationMonths: 12 }], {
			months: 24
		});
		const [occurrence] = childcareCostOccurrences(costed.childcare, costed);
		expect(occurrence.occurs).toBe(false);
		expect(occurrence.date).toBeNull();
		expect(occurrence.endDate).toBeNull();
		expect(occurrence.monthsOccurring).toBe(0);
		expect(occurrence.totalCost).toBe(0);
	});

	it('reports occurs: false for a zero-cost step', () => {
		const { costed } = project([{ monthlyCost: 0, atMonth: 6, durationMonths: 12 }]);
		const [occurrence] = childcareCostOccurrences(costed.childcare, costed);
		expect(occurrence.occurs).toBe(false);
	});

	it('clips monthsOccurring to the horizon for a step that runs past the end of the forecast', () => {
		const { costed } = project([{ monthlyCost: 900, atMonth: 50, durationMonths: 24 }], {
			months: 60
		});
		const [occurrence] = childcareCostOccurrences(costed.childcare, costed);
		expect(occurrence.occurs).toBe(true);
		expect(occurrence.monthsOccurring).toBe(11);
		expect(occurrence.totalCost).toBe(9_900);
	});

	it('is an empty list for an empty config', () => {
		const { costed } = project([]);
		expect(childcareCostOccurrences(costed.childcare, costed)).toEqual([]);
	});
});

describe('childcareCostImpact', () => {
	it('reports the shortfall in net worth at the horizon', () => {
		const { baseline, costed } = project([{ monthlyCost: 900, atMonth: 1, durationMonths: 36 }]);
		const impact = childcareCostImpact(baseline, costed);
		expect(impact.shortfall).toBeCloseTo(
			(baseline.series.realistic.at(-1)?.net_worth ?? 0) -
				(costed.series.realistic.at(-1)?.net_worth ?? 0),
			PENNY
		);
		expect(impact.shortfall).toBeGreaterThan(0);
	});

	it('totalConfigured and totalOccurring agree when the step falls entirely inside the horizon', () => {
		const { baseline, costed } = project([{ monthlyCost: 900, atMonth: 1, durationMonths: 36 }], {
			months: 60
		});
		const impact = childcareCostImpact(baseline, costed);
		expect(impact.totalConfigured).toBe(32_400);
		expect(impact.totalOccurring).toBe(32_400);
	});

	it('totalOccurring is smaller than totalConfigured when a step runs past the horizon', () => {
		const { baseline, costed } = project([{ monthlyCost: 900, atMonth: 1, durationMonths: 36 }], {
			months: 24
		});
		const impact = childcareCostImpact(baseline, costed);
		expect(impact.totalConfigured).toBe(32_400);
		expect(impact.totalOccurring).toBe(900 * 24);
	});

	it('is a zero-effect impact for an empty list', () => {
		const { baseline, costed } = project([]);
		const impact = childcareCostImpact(baseline, costed);
		expect(impact.totalConfigured).toBe(0);
		expect(impact.totalOccurring).toBe(0);
		expect(impact.shortfall).toBe(0);
		expect(impact.steps).toEqual([]);
	});

	it('carries the dated occurrences for the caller to list', () => {
		const { baseline, costed } = project([
			{ name: 'Nursery', monthlyCost: 900, atMonth: 1, durationMonths: 36 }
		]);
		const impact = childcareCostImpact(baseline, costed);
		expect(impact.steps).toHaveLength(1);
		expect(impact.steps[0]).toMatchObject({ name: 'Nursery', occurs: true });
	});

	it('reports a null shortfallShare when the baseline ends at or below zero', () => {
		const { baseline, costed } = project([{ monthlyCost: 100, atMonth: 1, durationMonths: 12 }], {
			investments: [],
			debts: [createDebt({ balance: 5_000 })]
		});
		expect(childcareCostImpact(baseline, costed).shortfallShare).toBeNull();
	});
});

describe('childcareCostImpacts', () => {
	it('returns one impact per scenario', () => {
		const { baseline, costed } = project([{ monthlyCost: 900, atMonth: 1, durationMonths: 36 }]);
		const impacts = childcareCostImpacts(baseline, costed);
		expect(Object.keys(impacts).sort()).toEqual([...FORECAST_SCENARIOS].sort());
		for (const scenario of FORECAST_SCENARIOS) {
			expect(impacts[scenario].scenario).toBe(scenario);
			expect(impacts[scenario].totalOccurring).toBe(32_400);
		}
	});
});

describe('compareChildcareCost', () => {
	it('rows before any step lands are identical between the two projections', () => {
		const { baseline, costed } = project([{ monthlyCost: 900, atMonth: 24, durationMonths: 12 }], {
			months: 60
		});
		const rows = compareChildcareCost(baseline, costed, 'realistic', [1, 12]);
		for (const row of rows) {
			expect(row.gap).toBe(0);
		}
	});

	it('rows after a step has landed show a negative gap', () => {
		const { baseline, costed } = project([{ monthlyCost: 900, atMonth: 1, durationMonths: 36 }], {
			months: 60
		});
		const rows = compareChildcareCost(baseline, costed, 'realistic', [12, 36]);
		for (const row of rows) {
			expect(row.gap).toBeLessThan(0);
			expect(row.gapShare).toBeLessThan(0);
		}
	});

	it('defaults to the forecast summary offsets when none are given', () => {
		const { baseline, costed } = project([{ monthlyCost: 900, atMonth: 1, durationMonths: 36 }], {
			months: 60
		});
		const rows = compareChildcareCost(baseline, costed);
		expect(rows.map((row) => row.offset)).toEqual([12, 60]);
	});

	it('drops offsets past the horizon rather than returning holes', () => {
		const { baseline, costed } = project([{ monthlyCost: 900, atMonth: 1, durationMonths: 36 }]);
		const rows = compareChildcareCost(baseline, costed, 'realistic', [12, 9_999]);
		expect(rows).toHaveLength(1);
	});
});
