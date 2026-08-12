import { describe, expect, it } from 'vitest';

import { monthlyGrowthRate } from './auto-invest.js';
import {
	DEFAULT_INCOME_PHASE_MONTHS,
	annualDividendIncome,
	dividendIncomePhase,
	dividendIncomePlan,
	dividendPortfolioSummary,
	monthlyDividendIncome,
	projectDividendPortfolio
} from './dividends.js';
import { createDividend } from './model.js';

const JAN_2026 = { month: 1, year: 2026 };

/* -------------------------------------------------------------------------- */
/* Today's position — no projection                                           */
/* -------------------------------------------------------------------------- */

describe('annualDividendIncome / monthlyDividendIncome', () => {
	it('is value times yield — a £20,000 holding at 4% pays £800/yr, £66.67/mo', () => {
		const holding = createDividend({ value: 20_000, yield_pct: 4 });
		expect(annualDividendIncome(holding)).toBe(800);
		expect(monthlyDividendIncome(holding)).toBe(66.67);
	});

	it('is zero on a zero value or a zero yield', () => {
		expect(annualDividendIncome(createDividend({ value: 0, yield_pct: 4 }))).toBe(0);
		expect(annualDividendIncome(createDividend({ value: 20_000, yield_pct: 0 }))).toBe(0);
	});

	it('is tolerant of a missing or malformed holding rather than throwing', () => {
		expect(annualDividendIncome(undefined)).toBe(0);
		expect(annualDividendIncome(null)).toBe(0);
		expect(annualDividendIncome({})).toBe(0);
	});
});

describe('dividendPortfolioSummary', () => {
	it('totals value, income and contributions across the whole list', () => {
		const summary = dividendPortfolioSummary([
			createDividend({ value: 10_000, yield_pct: 4, monthly_contribution: 100 }),
			createDividend({ value: 30_000, yield_pct: 2, monthly_contribution: 50 })
		]);

		expect(summary.count).toBe(2);
		expect(summary.totalValue).toBe(40_000);
		expect(summary.totalMonthlyContribution).toBe(150);
		expect(summary.annualIncome).toBe(1_000); // 400 + 600
		expect(summary.monthlyIncome).toBe(83.33);
	});

	it('weights the average yield by value, not a flat average', () => {
		const summary = dividendPortfolioSummary([
			createDividend({ value: 10_000, yield_pct: 8 }),
			createDividend({ value: 90_000, yield_pct: 2 })
		]);
		// (10,000×8 + 90,000×2) / 100,000 = 2.6%, not the flat average of 5%.
		expect(summary.weightedYield).toBe(2.6);
	});

	it('is zero yield on an empty or all-zero-value portfolio, not NaN or Infinity', () => {
		expect(dividendPortfolioSummary([]).weightedYield).toBe(0);
		expect(
			dividendPortfolioSummary([createDividend({ value: 0, yield_pct: 5 })]).weightedYield
		).toBe(0);
	});

	it('splits by strategy — drip vs income', () => {
		const summary = dividendPortfolioSummary([
			createDividend({ value: 10_000, yield_pct: 4, strategy: 'drip' }),
			createDividend({ value: 5_000, yield_pct: 4, strategy: 'drip' }),
			createDividend({ value: 20_000, yield_pct: 5, strategy: 'income' })
		]);

		expect(summary.drip).toEqual({ count: 2, value: 15_000, annualIncome: 600 });
		expect(summary.income).toEqual({ count: 1, value: 20_000, annualIncome: 1_000 });
	});

	it('splits by wrapper — sheltered (ISA/SIPP) vs unsheltered (GIA/unwrapped) — issue #35’s handle', () => {
		const summary = dividendPortfolioSummary([
			createDividend({ value: 10_000, yield_pct: 4, wrapper: 'isa_stocks_shares' }),
			createDividend({ value: 5_000, yield_pct: 4, wrapper: 'sipp' }),
			createDividend({ value: 20_000, yield_pct: 5, wrapper: 'gia' })
		]);

		expect(summary.sheltered).toEqual({ count: 2, value: 15_000, annualIncome: 600 });
		expect(summary.unsheltered).toEqual({ count: 1, value: 20_000, annualIncome: 1_000 });
	});

	it('is all zero on an empty list', () => {
		const summary = dividendPortfolioSummary([]);
		expect(summary.count).toBe(0);
		expect(summary.totalValue).toBe(0);
		expect(summary.annualIncome).toBe(0);
		expect(summary.drip).toEqual({ count: 0, value: 0, annualIncome: 0 });
	});

	it('is tolerant of a missing or non-array list', () => {
		expect(dividendPortfolioSummary(undefined).count).toBe(0);
		// @ts-expect-error — deliberately the wrong type.
		expect(dividendPortfolioSummary(null).count).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Building phase                                                              */
/* -------------------------------------------------------------------------- */

describe('projectDividendPortfolio', () => {
	it('starts at the anchor with offset 0 and the holdings’ own opening values', () => {
		const { points } = projectDividendPortfolio([createDividend({ value: 10_000, yield_pct: 4 })], {
			start: JAN_2026,
			months: 0
		});
		expect(points).toHaveLength(1);
		expect(points[0].offset).toBe(0);
		expect(points[0].month).toBe(1);
		expect(points[0].year).toBe(2026);
		expect(points[0].value).toBe(10_000);
		expect(points[0].contributions).toBe(0);
		expect(points[0].reinvestedGrowth).toBe(0);
	});

	it('reinvests a DRIP holding’s dividend into its own value — a full year lands back on the annual rate', () => {
		const { points } = projectDividendPortfolio(
			[createDividend({ value: 10_000, yield_pct: 6, strategy: 'drip', monthly_contribution: 0 })],
			{ start: JAN_2026, months: 12 }
		);
		const finalPoint = points.at(-1);
		// Twelve months at the geometric monthly equivalent of 6%/yr compounds back to exactly 6%
		// over exactly a year, by construction — the same identity `auto-invest.js`'s own
		// `monthlyGrowthRate` doc comment relies on.
		expect(finalPoint?.value).toBeCloseTo(10_000 * 1.06, 1);
		expect(finalPoint?.reinvestedGrowth).toBeCloseTo(600, 1);
		expect(finalPoint?.incomeTaken).toBe(0);
	});

	it('pays an income-strategy holding’s dividend out rather than compounding it', () => {
		const { points } = projectDividendPortfolio(
			[
				createDividend({
					value: 10_000,
					yield_pct: 6,
					strategy: 'income',
					monthly_contribution: 0
				})
			],
			{ start: JAN_2026, months: 12 }
		);
		const finalPoint = points.at(-1);
		// No reinvestment and no contribution, so the holding's own value never moves.
		expect(finalPoint?.value).toBe(10_000);
		expect(finalPoint?.reinvestedGrowth).toBe(0);
		expect(finalPoint?.incomeTaken).toBeGreaterThan(0);
		// Twelve identical monthly coupons off a value that never grows add up to *less* than the
		// £600 a DRIP holding ends the year worth more by — paying the dividend out instead of
		// reinvesting it is exactly what gives up the difference.
		expect(finalPoint?.incomeTaken).toBeLessThan(600);
		expect(finalPoint?.incomeTaken).toBeGreaterThan(550);
	});

	it('still grows an income-strategy holding’s value from its own contributions', () => {
		const { points } = projectDividendPortfolio(
			[createDividend({ value: 0, yield_pct: 0, strategy: 'income', monthly_contribution: 100 })],
			{ start: JAN_2026, months: 6 }
		);
		expect(points.at(-1)?.value).toBe(600);
		expect(points.at(-1)?.contributions).toBe(600);
	});

	it('sums independent holdings at the portfolio level', () => {
		const { points } = projectDividendPortfolio(
			[
				createDividend({ value: 10_000, yield_pct: 4, strategy: 'drip', monthly_contribution: 50 }),
				createDividend({
					value: 20_000,
					yield_pct: 5,
					strategy: 'income',
					monthly_contribution: 25
				})
			],
			{ start: JAN_2026, months: 3 }
		);
		const finalPoint = /** @type {import('./dividends.js').DividendProjectionPoint} */ (
			points.at(-1)
		);
		expect(finalPoint.holdings).toHaveLength(2);
		expect(finalPoint.value).toBeCloseTo(
			finalPoint.holdings[0].value + finalPoint.holdings[1].value,
			2
		);
		expect(finalPoint.contributions).toBe(150 + 75);
	});

	it('matches monthlyGrowthRate’s own conversion for a contribution-free DRIP holding’s first month', () => {
		const { points } = projectDividendPortfolio(
			[createDividend({ value: 10_000, yield_pct: 6, strategy: 'drip', monthly_contribution: 0 })],
			{ start: JAN_2026, months: 1 }
		);
		const expected = Math.round(10_000 * (1 + monthlyGrowthRate(6)) * 100) / 100;
		expect(points[1].value).toBe(expected);
	});

	it('clamps a negative or absurdly large months to a sane range', () => {
		expect(projectDividendPortfolio([], { months: -5 }).months).toBe(0);
		expect(projectDividendPortfolio([], { months: 10_000 }).months).toBeLessThanOrEqual(1200);
	});

	it('is tolerant of an empty or missing dividends list', () => {
		expect(projectDividendPortfolio([], { months: 12 }).points).toHaveLength(13);
		expect(projectDividendPortfolio(undefined, { months: 12 }).points[0].value).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Income phase                                                                */
/* -------------------------------------------------------------------------- */

describe('dividendIncomePhase', () => {
	it('pays every holding’s yield as income, whatever its original strategy was', () => {
		const result = dividendIncomePhase(
			[
				{ value: 100_000, yield_pct: 4 },
				{ value: 50_000, yield_pct: 6 }
			],
			{ start: JAN_2026, months: 12 }
		);
		expect(result.annualIncome).toBe(7_000); // 4,000 + 3,000
		expect(result.monthlyIncome).toBe(583.33);
	});

	it('holds the cumulative income at zero on the switch month itself, then accumulates monthly', () => {
		const result = dividendIncomePhase([{ value: 12_000, yield_pct: 6 }], {
			start: JAN_2026,
			months: 3
		});
		expect(result.points[0].cumulativeIncome).toBe(0);
		expect(result.points[3].cumulativeIncome).toBeCloseTo(result.monthlyIncome * 3, 2);
	});

	it('never depletes — capital is preserved, only yield is drawn', () => {
		const result = dividendIncomePhase([{ value: 100_000, yield_pct: 4 }], {
			start: JAN_2026,
			months: 240
		});
		expect(result.points.at(-1)?.cumulativeIncome).toBeGreaterThan(0);
		expect(result.annualIncome).toBe(4_000);
	});

	it('is zero income on an empty holdings list', () => {
		const result = dividendIncomePhase([], { months: 12 });
		expect(result.annualIncome).toBe(0);
		expect(result.monthlyIncome).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Both phases together                                                        */
/* -------------------------------------------------------------------------- */

describe('dividendIncomePlan', () => {
	it('projects the building phase up to the switch age, then the income phase from there', () => {
		const plan = dividendIncomePlan(
			[
				createDividend({
					value: 100_000,
					yield_pct: 4,
					strategy: 'drip',
					monthly_contribution: 500
				})
			],
			{ currentAge: 40, switchAge: 45, start: JAN_2026 }
		);

		expect(plan.monthsToSwitch).toBe(60);
		expect(plan.building.points).toHaveLength(61);
		expect(plan.atSwitch.offset).toBe(60);
		// Five years of reinvested growth plus £500/mo contributions leaves the pot well above where
		// it started.
		expect(plan.atSwitch.value).toBeGreaterThan(100_000 + 500 * 60);
		// The income phase's income is worked out off the grown pot, not the original £100,000.
		expect(plan.income.annualIncome).toBeCloseTo((plan.atSwitch.value * 4) / 100, 0);
	});

	it('switches immediately when the switch age has already been reached', () => {
		const plan = dividendIncomePlan([createDividend({ value: 50_000, yield_pct: 5 })], {
			currentAge: 60,
			switchAge: 55,
			start: JAN_2026
		});
		expect(plan.monthsToSwitch).toBe(0);
		expect(plan.atSwitch.value).toBe(50_000);
		expect(plan.income.annualIncome).toBe(2_500);
	});

	it('defaults the income phase span to DEFAULT_INCOME_PHASE_MONTHS', () => {
		const plan = dividendIncomePlan([createDividend({ value: 10_000, yield_pct: 4 })], {
			currentAge: 50,
			switchAge: 50,
			start: JAN_2026
		});
		expect(plan.income.months).toBe(DEFAULT_INCOME_PHASE_MONTHS);
	});

	it('is tolerant of an empty dividends list', () => {
		const plan = dividendIncomePlan([], { currentAge: 30, switchAge: 60, start: JAN_2026 });
		expect(plan.atSwitch.value).toBe(0);
		expect(plan.income.annualIncome).toBe(0);
	});
});
