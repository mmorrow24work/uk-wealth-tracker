import { describe, expect, it } from 'vitest';

import { createInvestment, createProfile } from './model.js';
import { forecastScenarios } from './forecast.js';
import {
	STANDARD_NET_WORTH_MILESTONES,
	ageAtPoint,
	formatMilestoneLabel,
	milestoneCrossing,
	milestoneCrossings,
	netWorthCrossing,
	retirementMarker
} from './milestones.js';

const JAN_2026 = { month: 1, year: 2026 };

/** @param {Partial<import('./types.js').Investment>} [overrides] */
function holding(overrides = {}) {
	return createInvestment({ id: 'inv_a', name: 'Global All Cap', value: 50_000, ...overrides });
}

/* -------------------------------------------------------------------------- */
/* formatMilestoneLabel                                                        */
/* -------------------------------------------------------------------------- */

describe('formatMilestoneLabel', () => {
	it('formats the standard amounts as README.md writes them', () => {
		expect(formatMilestoneLabel(100_000)).toBe('£100k');
		expect(formatMilestoneLabel(250_000)).toBe('£250k');
		expect(formatMilestoneLabel(500_000)).toBe('£500k');
		expect(formatMilestoneLabel(1_000_000)).toBe('£1M');
	});

	it('falls back to a full formatted amount for anything not a round thousand', () => {
		expect(formatMilestoneLabel(12_345)).toBe('£12,345');
	});

	it('does not treat zero as a round million or thousand', () => {
		expect(formatMilestoneLabel(0)).toBe('£0');
	});
});

/* -------------------------------------------------------------------------- */
/* netWorthCrossing                                                            */
/* -------------------------------------------------------------------------- */

describe('netWorthCrossing', () => {
	it('finds the first point a scenario reaches an amount', () => {
		const forecast = forecastScenarios(
			{
				investments: [holding({ value: 50_000, monthly_contribution: 500 })],
				start: JAN_2026,
				months: 240
			},
			{ growthRate: 5 }
		);

		const crossing = netWorthCrossing(forecast, 100_000, 'realistic');
		expect(crossing).not.toBeNull();
		expect(crossing?.net_worth).toBeGreaterThanOrEqual(100_000);

		// The point just before should not yet have reached it.
		const before = forecast.series.realistic[(crossing?.offset ?? 1) - 1];
		expect(before.net_worth).toBeLessThan(100_000);
	});

	it('returns the anchor when the amount is already reached', () => {
		const forecast = forecastScenarios(
			{ investments: [holding({ value: 200_000 })], start: JAN_2026, months: 12 },
			{ growthRate: 5 }
		);

		const crossing = netWorthCrossing(forecast, 100_000, 'realistic');
		expect(crossing?.offset).toBe(0);
	});

	it('returns null when a scenario never reaches the amount within the horizon', () => {
		const forecast = forecastScenarios(
			{
				investments: [holding({ value: 1_000, monthly_contribution: 0 })],
				start: JAN_2026,
				months: 12
			},
			{ growthRate: 5 }
		);

		expect(netWorthCrossing(forecast, 1_000_000, 'realistic')).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* milestoneCrossing / milestoneCrossings                                      */
/* -------------------------------------------------------------------------- */

describe('milestoneCrossing', () => {
	it('marks a milestone achieved off the shared anchor, regardless of scenario', () => {
		const forecast = forecastScenarios(
			{
				investments: [holding({ value: 150_000, monthly_contribution: 0 })],
				start: JAN_2026,
				months: 12
			},
			{ growthRate: 5 }
		);

		const crossing = milestoneCrossing(forecast, 100_000);
		expect(crossing.achieved).toBe(true);
		expect(crossing.pessimistic?.offset).toBe(0);
		expect(crossing.realistic?.offset).toBe(0);
		expect(crossing.optimistic?.offset).toBe(0);
	});

	it('is not achieved when the anchor sits below the amount', () => {
		const forecast = forecastScenarios(
			{
				investments: [holding({ value: 10_000, monthly_contribution: 500 })],
				start: JAN_2026,
				months: 240
			},
			{ growthRate: 5 }
		);

		const crossing = milestoneCrossing(forecast, 100_000);
		expect(crossing.achieved).toBe(false);
	});

	it('reaches an unmet milestone sooner under optimistic growth than pessimistic', () => {
		const forecast = forecastScenarios(
			{
				investments: [holding({ value: 10_000, monthly_contribution: 500 })],
				start: JAN_2026,
				months: 360,
				spread: 2
			},
			{ growthRate: 5 }
		);

		const crossing = milestoneCrossing(forecast, 250_000);
		expect(crossing.optimistic?.offset).toBeLessThan(crossing.realistic?.offset ?? Infinity);
		expect(crossing.realistic?.offset).toBeLessThan(crossing.pessimistic?.offset ?? Infinity);
	});

	it('labels the crossing with formatMilestoneLabel', () => {
		const forecast = forecastScenarios({ investments: [holding()], start: JAN_2026, months: 12 });
		expect(milestoneCrossing(forecast, 500_000).label).toBe('£500k');
	});
});

describe('milestoneCrossings', () => {
	it('returns one crossing per standard amount, in order', () => {
		const forecast = forecastScenarios({ investments: [holding()], start: JAN_2026, months: 12 });
		const crossings = milestoneCrossings(forecast);
		expect(crossings.map((c) => c.amount)).toEqual(STANDARD_NET_WORTH_MILESTONES);
	});

	it('accepts a custom amount list', () => {
		const forecast = forecastScenarios({ investments: [holding()], start: JAN_2026, months: 12 });
		const crossings = milestoneCrossings(forecast, [10_000, 25_000]);
		expect(crossings.map((c) => c.amount)).toEqual([10_000, 25_000]);
	});
});

/* -------------------------------------------------------------------------- */
/* ageAtPoint                                                                   */
/* -------------------------------------------------------------------------- */

describe('ageAtPoint', () => {
	it('is exact when the birth month is known and already passed this year', () => {
		expect(ageAtPoint(1990, 3, { year: 2026, month: 6 })).toBe(36);
	});

	it('subtracts a year when the birth month has not yet arrived this year', () => {
		expect(ageAtPoint(1990, 9, { year: 2026, month: 6 })).toBe(35);
	});

	it('counts the birth month itself as already turned', () => {
		expect(ageAtPoint(1990, 6, { year: 2026, month: 6 })).toBe(36);
	});

	it('falls back to a plain year difference when the birth month is unknown', () => {
		expect(ageAtPoint(1990, null, { year: 2026, month: 1 })).toBe(36);
	});
});

/* -------------------------------------------------------------------------- */
/* retirementMarker                                                            */
/* -------------------------------------------------------------------------- */

describe('retirementMarker', () => {
	it('is unavailable without a recorded birth year', () => {
		const forecast = forecastScenarios({ investments: [holding()], start: JAN_2026, months: 12 });
		const profile = createProfile({ dob_year: null, retirement_age: 67 });

		const marker = retirementMarker(forecast, profile);
		expect(marker.available).toBe(false);
		expect(marker.point).toBeNull();
		expect(marker.netWorth).toBeNull();
	});

	it('finds the calendar date retirement age is reached, independent of growth scenario', () => {
		const forecast = forecastScenarios(
			{
				investments: [holding({ value: 50_000, monthly_contribution: 500 })],
				start: JAN_2026,
				months: 372,
				spread: 2
			},
			{ growthRate: 5 }
		);
		const profile = createProfile({ dob_year: 1990, dob_month: 1, retirement_age: 67 });

		const marker = retirementMarker(forecast, profile);
		expect(marker.available).toBe(true);
		expect(marker.point?.year).toBe(2057);
		expect(marker.point?.month).toBe(1);

		// The date is the same regardless of scenario — only net worth at that date differs.
		expect(marker.netWorth?.pessimistic).toBeLessThan(marker.netWorth?.realistic ?? 0);
		expect(marker.netWorth?.realistic).toBeLessThan(marker.netWorth?.optimistic ?? 0);
	});

	it('reports already reached when the anchor age is at or past retirement age', () => {
		const forecast = forecastScenarios(
			{ investments: [holding()], start: JAN_2026, months: 12 },
			{ growthRate: 5 }
		);
		const profile = createProfile({ dob_year: 1955, dob_month: 1, retirement_age: 67 });

		const marker = retirementMarker(forecast, profile);
		expect(marker.alreadyReached).toBe(true);
		expect(marker.point?.offset).toBe(0);
	});

	it('returns a null point when retirement age falls beyond the forecast horizon', () => {
		const forecast = forecastScenarios(
			{ investments: [holding()], start: JAN_2026, months: 12 },
			{ growthRate: 5 }
		);
		const profile = createProfile({ dob_year: 2000, dob_month: 1, retirement_age: 67 });

		const marker = retirementMarker(forecast, profile);
		expect(marker.available).toBe(true);
		expect(marker.alreadyReached).toBe(false);
		expect(marker.point).toBeNull();
		expect(marker.netWorth).toBeNull();
	});
});
