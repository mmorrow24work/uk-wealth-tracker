import { describe, expect, it } from 'vitest';

import { monthlyGrowthRate, projectHoldingValue } from './auto-invest.js';
import {
	DEFAULT_FIRE_INPUT,
	DEFAULT_WITHDRAWAL_RATE,
	MAGIC_NUMBER_MULTIPLE,
	MAX_FIRE_MONTHS,
	coastCrossing,
	coastFireNumber,
	coastFireStatus,
	fireNumber,
	fireStartingPoint,
	fireSummary,
	investablePot,
	monthlyEquivalentContribution,
	monthlySavingFromHoldings,
	normaliseFireInput,
	portfolioRunway,
	projectAccumulation,
	projectDrawdown,
	realGrowthRate,
	sustainableIncome,
	timeToTarget,
	withdrawalMultiple
} from './fire.js';
import { createInvestment, createMonthlyEntry } from './model.js';

/** Values are money, so compare to the penny rather than to floating-point exactness. */
const PENNY = 0.005;

const JAN_2026 = { month: 1, year: 2026 };

/* -------------------------------------------------------------------------- */
/* The magic number                                                            */
/* -------------------------------------------------------------------------- */

describe('fireNumber / withdrawalMultiple', () => {
	it('is 25x target income at the default 4% withdrawal rate — README.md’s own figure', () => {
		expect(DEFAULT_WITHDRAWAL_RATE).toBe(4);
		expect(withdrawalMultiple(DEFAULT_WITHDRAWAL_RATE)).toBe(MAGIC_NUMBER_MULTIPLE);
		expect(MAGIC_NUMBER_MULTIPLE).toBe(25);
		expect(fireNumber(40_000)).toBe(1_000_000);
	});

	it('follows the withdrawal rate slider rather than a hard-coded 25', () => {
		expect(withdrawalMultiple(3)).toBeCloseTo(33.3333, 4);
		expect(withdrawalMultiple(5)).toBe(20);
		expect(fireNumber(40_000, 3)).toBeCloseTo(1_333_333.33, 2);
		expect(fireNumber(40_000, 5)).toBe(800_000);
	});

	it('clamps a withdrawal rate of zero rather than demanding an infinite pot', () => {
		expect(Number.isFinite(fireNumber(40_000, 0))).toBe(true);
		expect(fireNumber(40_000, 0)).toBe(fireNumber(40_000, 0.1));
		expect(fireNumber(40_000, 1000)).toBe(fireNumber(40_000, 100));
	});

	it('treats a negative or unparseable target as no target', () => {
		expect(fireNumber(-50_000)).toBe(0);
		expect(fireNumber(Number.NaN)).toBe(0);
	});

	it('round-trips through sustainableIncome', () => {
		expect(sustainableIncome(fireNumber(40_000), 4)).toBeCloseTo(40_000, 2);
		expect(sustainableIncome(fireNumber(28_000, 3.5), 3.5)).toBeCloseTo(28_000, 2);
		expect(sustainableIncome(500_000, 4)).toBe(20_000);
	});
});

/* -------------------------------------------------------------------------- */
/* Real terms                                                                  */
/* -------------------------------------------------------------------------- */

describe('realGrowthRate', () => {
	it('divides rather than subtracts — Fisher, not 5 minus 2.5', () => {
		expect(realGrowthRate(5, 2.5)).toBeCloseTo(2.439, 3);
		expect(realGrowthRate(5, 2.5)).not.toBeCloseTo(2.5, 3);
	});

	it('leaves the rate alone when inflation is zero', () => {
		expect(realGrowthRate(7, 0)).toBeCloseTo(7, 10);
		expect(realGrowthRate(-3, 0)).toBeCloseTo(-3, 10);
	});

	it('goes negative when inflation outruns growth', () => {
		expect(realGrowthRate(2, 4)).toBeLessThan(0);
	});

	it('stays inside the -100..100 band the rest of the app validates against', () => {
		expect(realGrowthRate(100, -100)).toBeLessThanOrEqual(100);
		expect(realGrowthRate(-100, 100)).toBeGreaterThanOrEqual(-100);
	});
});

/* -------------------------------------------------------------------------- */
/* Coast FIRE                                                                  */
/* -------------------------------------------------------------------------- */

describe('coastFireNumber', () => {
	it('is the pot that compounds to the target on its own, with no further saving', () => {
		const target = 1_000_000;
		const coast = coastFireNumber(target, 5, 20);

		// Left alone for 20 years at 5%, the coast number is exactly the target again — to within the
		// penny it was rounded to, which twenty years of compounding magnifies to about 3p.
		expect(coast * 1.05 ** 20).toBeCloseTo(target, 1);
		expect(coast).toBeLessThan(target);
	});

	it('is the target itself at zero years to go — there is no compounding left to do', () => {
		expect(coastFireNumber(1_000_000, 5, 0)).toBe(1_000_000);
		expect(coastFireNumber(1_000_000, 5, -4)).toBe(1_000_000);
	});

	it('is the full target when there is no growth to coast on', () => {
		expect(coastFireNumber(500_000, 0, 30)).toBe(500_000);
		expect(coastFireNumber(500_000, -100, 30)).toBe(500_000);
	});

	it('falls as the horizon lengthens', () => {
		expect(coastFireNumber(1_000_000, 5, 30)).toBeLessThan(coastFireNumber(1_000_000, 5, 10));
	});
});

describe('coastFireStatus', () => {
	it('reports the gap while short of the number', () => {
		const status = coastFireStatus(100_000, 1_000_000, 5, 20);

		expect(status.achieved).toBe(false);
		expect(status.gap).toBeCloseTo(status.number - 100_000, 2);
		expect(status.surplus).toBe(0);
		expect(status.share).toBeCloseTo(100_000 / status.number, 10);
	});

	it('reports a surplus once contributions could stop', () => {
		const status = coastFireStatus(500_000, 1_000_000, 5, 20);

		expect(status.achieved).toBe(true);
		expect(status.gap).toBe(0);
		expect(status.surplus).toBeCloseTo(500_000 - status.number, 2);
		expect(status.share).toBeGreaterThan(1);
	});

	it('treats a zero target as already coasting', () => {
		const status = coastFireStatus(0, 0, 5, 20);

		expect(status.number).toBe(0);
		expect(status.achieved).toBe(true);
		expect(status.share).toBe(1);
	});
});

/* -------------------------------------------------------------------------- */
/* Accumulation                                                                */
/* -------------------------------------------------------------------------- */

describe('projectAccumulation', () => {
	it('starts at the pot as it stands and runs months + 1 points', () => {
		const points = projectAccumulation({ pot: 10_000, months: 12, start: JAN_2026 });

		expect(points).toHaveLength(13);
		expect(points[0]).toMatchObject({ offset: 0, month: 1, year: 2026, value: 10_000 });
		expect(points.at(-1)).toMatchObject({ offset: 12, month: 1, year: 2027 });
	});

	it('compounds geometrically, so twelve months at 6% is exactly 6%', () => {
		const points = projectAccumulation({
			pot: 10_000,
			monthlySaving: 0,
			growthRate: 6,
			months: 12,
			start: JAN_2026
		});

		expect(points[12].value).toBeCloseTo(10_600, 1);
	});

	it('agrees with auto-invest.js month for month — the same arithmetic, not a second projector', () => {
		let holding = createInvestment({ value: 25_000, monthly_contribution: 400, fund_fee: 0 });
		const points = projectAccumulation({
			pot: 25_000,
			monthlySaving: 400,
			growthRate: 5,
			months: 24,
			start: JAN_2026
		});

		for (let offset = 1; offset <= 24; offset += 1) {
			const value = projectHoldingValue(holding, offset, { growthRate: 5, applyFundFees: false });
			holding = { ...holding, value };
			expect(points[offset].value).toBeCloseTo(value, 2);
		}
	});

	it('splits the change into contributions and growth that reconcile exactly', () => {
		const points = projectAccumulation({
			pot: 5_000,
			monthlySaving: 250,
			growthRate: 7,
			months: 60,
			start: JAN_2026
		});

		for (const point of points) {
			expect(point.contributions + point.growth).toBeCloseTo(point.value - 5_000, 2);
		}
		expect(points.at(-1)?.contributions).toBeCloseTo(250 * 60, PENNY);
		expect(points.at(-1)?.growth).toBeGreaterThan(0);
	});

	it('books negative growth when the real rate is negative', () => {
		const points = projectAccumulation({
			pot: 100_000,
			monthlySaving: 0,
			growthRate: -3,
			months: 12,
			start: JAN_2026
		});

		expect(points[12].value).toBeCloseTo(97_000, 0);
		expect(points[12].growth).toBeLessThan(0);
	});

	it('clamps the horizon rather than building an unbounded series', () => {
		expect(projectAccumulation({ months: 99_999 })).toHaveLength(MAX_FIRE_MONTHS + 1);
		expect(projectAccumulation({ months: -5 })).toHaveLength(1);
	});
});

describe('timeToTarget', () => {
	const points = projectAccumulation({
		pot: 100_000,
		monthlySaving: 1_000,
		growthRate: 5,
		months: 360,
		start: JAN_2026
	});

	it('finds the first month the pot reaches the number', () => {
		const timing = timeToTarget(points, 250_000);

		expect(timing.reached).toBe(true);
		expect(timing.alreadyThere).toBe(false);
		expect(timing.value).toBeGreaterThanOrEqual(250_000);
		// The month before must still be short, or this is not the *first* crossing.
		expect(points[/** @type {number} */ (timing.offset) - 1].value).toBeLessThan(250_000);
		expect(timing.years).toBeCloseTo(/** @type {number} */ (timing.offset) / 12, 10);
	});

	it('reports a target already covered as reached at offset 0', () => {
		const timing = timeToTarget(points, 50_000);

		expect(timing.reached).toBe(true);
		expect(timing.alreadyThere).toBe(true);
		expect(timing.offset).toBe(0);
	});

	it('reports what you get to instead when the number is never reached', () => {
		const timing = timeToTarget(points, 50_000_000);

		expect(timing.reached).toBe(false);
		expect(timing.offset).toBeNull();
		expect(timing.date).toBeNull();
		expect(timing.finalValue).toBeCloseTo(points[360].value, 2);
	});

	it('is later the higher the target', () => {
		const near = timeToTarget(points, 200_000);
		const far = timeToTarget(points, 400_000);

		expect(/** @type {number} */ (far.offset)).toBeGreaterThan(/** @type {number} */ (near.offset));
	});
});

describe('coastCrossing', () => {
	const target = fireNumber(30_000);
	const points = projectAccumulation({
		pot: 50_000,
		monthlySaving: 1_500,
		growthRate: 5,
		months: 600,
		start: JAN_2026
	});

	it('lands at or before the date the pot reaches the full magic number', () => {
		const coast = coastCrossing(points, { target, growthRate: 5, retirementOffset: 360 });
		const fire = timeToTarget(points, target);

		expect(coast.reached).toBe(true);
		expect(/** @type {number} */ (coast.offset)).toBeLessThanOrEqual(
			/** @type {number} */ (fire.offset)
		);
	});

	it('is the month the pot first covers the number for the time still left', () => {
		const coast = coastCrossing(points, { target, growthRate: 5, retirementOffset: 360 });
		const offset = /** @type {number} */ (coast.offset);

		expect(points[offset].value).toBeGreaterThanOrEqual(/** @type {number} */ (coast.number));
		// The month before was still short of its own (slightly lower) threshold.
		const before = coastFireNumber(target, 5, (360 - (offset - 1)) / 12);
		expect(points[offset - 1].value).toBeLessThan(before);
	});

	it('collapses onto the magic number when retirement is today', () => {
		// At zero years left the threshold is the target itself, so only a pot that already covers it
		// is coasting.
		const rich = projectAccumulation({ pot: target + 1, months: 12, start: JAN_2026 });

		expect(coastCrossing(rich, { target, growthRate: 5, retirementOffset: 0 })).toMatchObject({
			reached: true,
			offset: 0,
			number: target
		});
		expect(coastCrossing(points, { target, growthRate: 5, retirementOffset: 0 }).reached).toBe(
			false
		);
	});

	it('does not call a crossing that lands after retirement coasting', () => {
		// This plan reaches the number eventually, but not in time to stop saving beforehand.
		const late = projectAccumulation({
			pot: 1_000,
			monthlySaving: 400,
			growthRate: 5,
			months: 600,
			start: JAN_2026
		});
		const coast = coastCrossing(late, { target, growthRate: 5, retirementOffset: 60 });

		expect(timeToTarget(late, target).reached).toBe(true);
		expect(coast.reached).toBe(false);
		expect(coast.date).toBeNull();
	});

	it('reports a pot that is already coasting as such', () => {
		const rich = projectAccumulation({ pot: 400_000, months: 12, start: JAN_2026 });
		const coast = coastCrossing(rich, { target, growthRate: 5, retirementOffset: 240 });

		expect(coast.alreadyThere).toBe(true);
		expect(coast.offset).toBe(0);
	});

	it('reports never when saving never catches the threshold', () => {
		const thin = projectAccumulation({ pot: 0, monthlySaving: 1, months: 24, start: JAN_2026 });
		const coast = coastCrossing(thin, { target, growthRate: 5, retirementOffset: 24 });

		expect(coast.reached).toBe(false);
		expect(coast.number).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* Drawdown and runway                                                         */
/* -------------------------------------------------------------------------- */

describe('projectDrawdown', () => {
	it('takes the income after the month’s growth — an ordinary annuity, sign flipped', () => {
		const points = projectDrawdown({
			pot: 100_000,
			annualIncome: 12_000,
			growthRate: 6,
			months: 1,
			start: JAN_2026
		});

		const grown = 100_000 * (1 + monthlyGrowthRate(6));
		expect(points[1].value).toBeCloseTo(grown - 1_000, 1);
		expect(points[1].income).toBe(1_000);
	});

	it('runs a flat line with no growth and no income', () => {
		const points = projectDrawdown({
			pot: 50_000,
			annualIncome: 0,
			growthRate: 0,
			months: 24,
			start: JAN_2026
		});

		expect(points).toHaveLength(25);
		expect(points.at(-1)?.value).toBe(50_000);
		expect(points.at(-1)?.withdrawn).toBe(0);
	});

	it('stops the month the pot empties rather than trailing zeroes', () => {
		const points = projectDrawdown({
			pot: 100_000,
			annualIncome: 12_000,
			growthRate: 0,
			months: 480,
			start: JAN_2026
		});

		expect(points.at(-1)?.offset).toBe(100);
		expect(points.at(-1)?.value).toBe(0);
	});

	it('pays out only what is left in the final month', () => {
		const points = projectDrawdown({
			pot: 2_500,
			annualIncome: 12_000,
			growthRate: 0,
			months: 480,
			start: JAN_2026
		});

		expect(points.at(-1)?.income).toBe(500);
		expect(points.at(-1)?.value).toBe(0);
		expect(points.at(-1)?.withdrawn).toBe(2_500);
	});
});

describe('portfolioRunway', () => {
	it('answers "will my money last" in whole funded months', () => {
		const runway = portfolioRunway({
			pot: 100_000,
			annualIncome: 12_000,
			growthRate: 0,
			months: 480,
			start: JAN_2026
		});

		expect(runway.months).toBe(100);
		expect(runway.years).toBeCloseTo(100 / 12, 10);
		expect(runway.depleted).toBe(true);
		expect(runway.depletedDate).toEqual({ month: 5, year: 2034 });
		expect(runway.withdrawn).toBeCloseTo(100_000, 2);
	});

	it('counts only months funded in full — the month it runs out does not count', () => {
		const runway = portfolioRunway({
			pot: 2_500,
			annualIncome: 12_000,
			growthRate: 0,
			months: 480,
			start: JAN_2026
		});

		// Two full £1,000 months, then a £500 month that empties the pot.
		expect(runway.months).toBe(2);
		expect(runway.depleted).toBe(true);
	});

	it('never runs out when growth alone covers the income', () => {
		const runway = portfolioRunway({
			pot: 1_000_000,
			annualIncome: 20_000,
			growthRate: 5,
			months: 480,
			start: JAN_2026
		});

		expect(runway.sustainable).toBe(true);
		expect(runway.depleted).toBe(false);
		expect(runway.months).toBe(480);
		expect(runway.finalValue).toBeGreaterThan(1_000_000);
	});

	it('is not sustainable at 4% of a pot growing at 4% — monthly income leaves before it compounds', () => {
		const runway = portfolioRunway({
			pot: 1_000_000,
			annualIncome: 40_000,
			growthRate: 4,
			months: 480,
			start: JAN_2026
		});

		expect(runway.sustainable).toBe(false);
		// It still comfortably outlasts a 40-year retirement, just not forever.
		expect(runway.depleted).toBe(false);
		expect(runway.finalValue).toBeLessThan(1_000_000);
	});

	it('empties fast when the real rate is negative', () => {
		const flat = portfolioRunway({
			pot: 200_000,
			annualIncome: 24_000,
			growthRate: 0,
			months: 480,
			start: JAN_2026
		});
		const falling = portfolioRunway({
			pot: 200_000,
			annualIncome: 24_000,
			growthRate: -4,
			months: 480,
			start: JAN_2026
		});

		expect(falling.months).toBeLessThan(flat.months);
		expect(falling.depleted).toBe(true);
	});

	it('treats an income of nothing as a pot that lasts the horizon', () => {
		const runway = portfolioRunway({
			pot: 0,
			annualIncome: 0,
			growthRate: 5,
			months: 120,
			start: JAN_2026
		});

		expect(runway.depleted).toBe(false);
		expect(runway.months).toBe(120);
		expect(runway.sustainable).toBe(true);
	});

	it('has nothing to draw from an empty pot', () => {
		const runway = portfolioRunway({
			pot: 0,
			annualIncome: 20_000,
			growthRate: 5,
			months: 120,
			start: JAN_2026
		});

		expect(runway.months).toBe(0);
		expect(runway.depleted).toBe(true);
		expect(runway.withdrawn).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Reading a position                                                          */
/* -------------------------------------------------------------------------- */

describe('investablePot / monthlySavingFromHoldings', () => {
	const holdings = [
		createInvestment({ id: 'a', value: 30_000, monthly_contribution: 500 }),
		createInvestment({
			id: 'b',
			value: 12_000,
			monthly_contribution: 900,
			contribution_frequency: 'quarterly'
		}),
		createInvestment({
			id: 'c',
			value: 6_000,
			monthly_contribution: 1_200,
			contribution_frequency: 'annually'
		}),
		createInvestment({
			id: 'd',
			value: 5_000,
			monthly_contribution: 5_000,
			contribution_frequency: 'one_off'
		}),
		createInvestment({
			id: 'e',
			value: 250_000,
			monthly_contribution: 100,
			exclude_from_net_worth: true
		})
	];

	it('sums the holdings that count towards net worth, ignoring debts entirely', () => {
		expect(investablePot(holdings)).toBe(53_000);
		expect(investablePot([])).toBe(0);
	});

	it('restates every contribution schedule as a monthly amount', () => {
		expect(monthlyEquivalentContribution(holdings[0])).toBe(500);
		expect(monthlyEquivalentContribution(holdings[1])).toBe(300);
		expect(monthlyEquivalentContribution(holdings[2])).toBe(100);
		// A one-off was paid once already; it is not saving that continues.
		expect(monthlyEquivalentContribution(holdings[3])).toBe(0);
		expect(monthlySavingFromHoldings(holdings)).toBe(900);
	});
});

describe('fireStartingPoint', () => {
	it('reads the latest snapshot, matching what the forecast tab anchors on', () => {
		const entries = [
			createMonthlyEntry({
				month: 11,
				year: 2025,
				investments: [createInvestment({ value: 1_000, monthly_contribution: 10 })]
			}),
			createMonthlyEntry({
				month: 2,
				year: 2026,
				investments: [createInvestment({ value: 42_000, monthly_contribution: 750 })]
			})
		];

		expect(fireStartingPoint(entries)).toEqual({
			pot: 42_000,
			monthlySaving: 750,
			start: { month: 2, year: 2026 }
		});
	});

	it('is null with no history, so "nothing recorded" is not "an empty pot"', () => {
		expect(fireStartingPoint([])).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* The whole plan                                                              */
/* -------------------------------------------------------------------------- */

describe('normaliseFireInput', () => {
	it('defaults to a plan with nothing in it and no inflation adjustment', () => {
		const input = normaliseFireInput({ start: JAN_2026 });

		expect(input).toMatchObject({ ...DEFAULT_FIRE_INPUT, start: JAN_2026 });
		expect(input.inflationRate).toBe(0);
	});

	it('clamps money, rates and horizons rather than rejecting them', () => {
		const input = normaliseFireInput({
			pot: -5_000,
			monthlySaving: Number.NaN,
			targetIncome: -1,
			growthRate: 900,
			inflationRate: -900,
			withdrawalRate: 0,
			yearsToRetirement: -3,
			drawdownYears: 5_000,
			start: JAN_2026
		});

		expect(input.pot).toBe(0);
		expect(input.monthlySaving).toBe(0);
		expect(input.targetIncome).toBe(0);
		expect(input.growthRate).toBe(100);
		expect(input.inflationRate).toBe(-100);
		expect(input.withdrawalRate).toBe(0.1);
		expect(input.yearsToRetirement).toBe(0);
		expect(input.drawdownYears).toBe(MAX_FIRE_MONTHS / 12);
	});
});

describe('fireSummary', () => {
	/** @param {Partial<import('./fire.js').FireInput>} [overrides] */
	function plan(overrides = {}) {
		return fireSummary({
			pot: 120_000,
			monthlySaving: 1_500,
			targetIncome: 32_000,
			growthRate: 7,
			inflationRate: 2.5,
			withdrawalRate: 4,
			yearsToRetirement: 22,
			drawdownYears: 30,
			start: JAN_2026,
			...overrides
		});
	}

	it('states the magic number, today’s progress and the real rate behind them', () => {
		const summary = plan();

		expect(summary.number).toBe(800_000);
		expect(summary.gap).toBe(680_000);
		expect(summary.share).toBeCloseTo(0.15, 10);
		expect(summary.realRate).toBeCloseTo(realGrowthRate(7, 2.5), 10);
		expect(summary.multiple).toBe(25);
	});

	it('runs every projection at the same real rate off the same anchor', () => {
		const summary = plan();
		const independent = projectAccumulation({
			pot: 120_000,
			monthlySaving: 1_500,
			growthRate: summary.realRate,
			months: 22 * 12,
			start: JAN_2026
		});

		expect(summary.accumulation).toHaveLength(22 * 12 + 1);
		expect(summary.accumulation.at(-1)?.value).toBeCloseTo(
			/** @type {number} */ (independent.at(-1)?.value),
			2
		);
		expect(summary.potAtRetirement).toBe(summary.accumulation.at(-1)?.value);
		expect(summary.runway.points[0].value).toBe(summary.potAtRetirement);
	});

	it('starts drawdown the month saving stops', () => {
		const summary = plan();

		expect(summary.accumulation.at(-1)).toMatchObject({ month: 1, year: 2048 });
		expect(summary.runway.points[0]).toMatchObject({ month: 1, year: 2048 });
	});

	it('reports the income the projected pot actually supports, and the shortfall', () => {
		const summary = plan({ yearsToRetirement: 5 });

		expect(summary.onTrack).toBe(false);
		expect(summary.incomeAtRetirement).toBeCloseTo(
			sustainableIncome(summary.potAtRetirement, 4),
			2
		);
		expect(summary.incomeGap).toBeCloseTo(32_000 - summary.incomeAtRetirement, 2);
	});

	it('closes the income gap once the plan reaches the number', () => {
		const summary = plan({ yearsToRetirement: 40 });

		expect(summary.onTrack).toBe(true);
		expect(summary.incomeGap).toBe(0);
		expect(summary.runway.depleted).toBe(false);
	});

	it('dates coasting no later than FIRE itself', () => {
		const summary = plan();

		expect(summary.coastDate.reached).toBe(true);
		expect(summary.timing.reached).toBe(true);
		expect(/** @type {number} */ (summary.coastDate.offset)).toBeLessThanOrEqual(
			/** @type {number} */ (summary.timing.offset)
		);
		expect(summary.coast.achieved).toBe(summary.coastDate.alreadyThere);
	});

	it('answers "will my money last" from the retirement pot, not today’s', () => {
		const summary = plan({ yearsToRetirement: 3, drawdownYears: 30 });

		expect(summary.runway.depleted).toBe(true);
		expect(summary.runway.months).toBeLessThan(30 * 12);
		expect(summary.runway.monthlyIncome).toBeCloseTo(32_000 / 12, 1);
	});

	it('says nothing is happening when nothing is entered', () => {
		const summary = fireSummary({ start: JAN_2026 });

		expect(summary.number).toBe(0);
		expect(summary.share).toBe(1);
		expect(summary.potAtRetirement).toBe(0);
		expect(summary.timing.alreadyThere).toBe(true);
		expect(summary.runway.depleted).toBe(false);
	});

	it('is monotone in the sliders README.md names', () => {
		const base = plan();

		expect(plan({ targetIncome: 40_000 }).number).toBeGreaterThan(base.number);
		expect(plan({ monthlySaving: 2_500 }).potAtRetirement).toBeGreaterThan(base.potAtRetirement);
		expect(plan({ growthRate: 9 }).potAtRetirement).toBeGreaterThan(base.potAtRetirement);
		// A higher withdrawal rate needs a smaller pot, but empties it faster.
		expect(plan({ withdrawalRate: 5 }).number).toBeLessThan(base.number);
		expect(plan({ inflationRate: 5 }).potAtRetirement).toBeLessThan(base.potAtRetirement);
	});
});
