/**
 * Salary sacrifice and the 60% personal allowance taper, 2026/27 — issue #27.
 *
 * Three kinds of test here. The first checks the conversion the whole module rests on: `tax.js`
 * stores band boundaries on income *after* allowances, and a sacrifice comes off *gross* pay, so
 * every boundary has to be converted back — including through the taper, where the two move at
 * different speeds. The second checks that the slice breakdown and the plain before-and-after
 * subtraction agree, at a spread of incomes and in both regions: they are the same quantity worked
 * out two different ways, and a breakdown that doesn't add up to the headline is worse than none.
 * The third pins the figures a user actually reads — 60% relief inside the taper (67.5% in
 * Scotland), 40p of take-home per £1 into the pension, and what it takes to clear the taper.
 */
import { describe, expect, it } from 'vitest';

import {
	cappedSacrifice,
	grossIncomeAtBandStart,
	marginalRateBreakpoints,
	PENSION_ANNUAL_ALLOWANCE,
	postSacrificeIncome,
	SALARY_SACRIFICE_TAX_YEAR,
	sacrificeFromPercent,
	sacrificePercentOfSalary,
	sacrificeSlices,
	sacrificeToClearTaper,
	sacrificeToReach,
	salarySacrificeSummary,
	taxSavedBySacrifice
} from './salary-sacrifice.js';
import {
	ALLOWANCE_EXHAUSTED_AT,
	ALLOWANCE_TAPER_THRESHOLD,
	incomeTax,
	PERSONAL_ALLOWANCE,
	TAX_YEAR
} from './tax.js';

describe('the 2026/27 figures', () => {
	it('is labelled with the same tax year as the income tax module', () => {
		expect(SALARY_SACRIFICE_TAX_YEAR).toBe('2026/27');
		expect(SALARY_SACRIFICE_TAX_YEAR).toBe(TAX_YEAR);
		expect(salarySacrificeSummary({ salary: 60_000, sacrifice: 5_000 }).taxYear).toBe('2026/27');
	});

	it('pins the pension annual allowance', () => {
		expect(PENSION_ANNUAL_ALLOWANCE).toBe(60_000);
	});
});

describe('sacrificing an amount', () => {
	it('cannot give up more pay than there is', () => {
		expect(cappedSacrifice(40_000, 50_000)).toBe(40_000);
		expect(postSacrificeIncome(40_000, 50_000)).toBe(0);
	});

	it('treats a negative or junk sacrifice as nothing given up', () => {
		expect(cappedSacrifice(40_000, -5_000)).toBe(0);
		expect(cappedSacrifice(40_000, Number.NaN)).toBe(0);
		expect(postSacrificeIncome(40_000, undefined)).toBe(40_000);
	});

	it('converts between a percentage of salary and an amount', () => {
		expect(sacrificeFromPercent(50_000, 8)).toBe(4_000);
		expect(sacrificePercentOfSalary(50_000, 4_000)).toBe(8);
	});

	it('reports 0% rather than NaN when there is no salary to be a percentage of', () => {
		expect(sacrificePercentOfSalary(0, 1_000)).toBe(0);
		expect(sacrificeFromPercent(0, 8)).toBe(0);
	});

	it('works out what it takes to reach a target income', () => {
		expect(sacrificeToReach(130_000, 100_000)).toBe(30_000);
		expect(sacrificeToReach(80_000, 100_000)).toBe(0);
	});

	it('works out what it takes to clear the taper', () => {
		expect(sacrificeToClearTaper(125_140)).toBe(25_140);
		expect(sacrificeToClearTaper(110_000)).toBe(10_000);
		expect(sacrificeToClearTaper(ALLOWANCE_TAPER_THRESHOLD)).toBe(0);
		expect(sacrificeToClearTaper(60_000)).toBe(0);
	});
});

describe('converting band boundaries back to gross income', () => {
	it('adds the whole allowance back below the taper', () => {
		expect(grossIncomeAtBandStart(0)).toBe(PERSONAL_ALLOWANCE);
		expect(grossIncomeAtBandStart(37_700)).toBe(50_270);
	});

	it('leaves boundaries above £125,140 alone, where there is no allowance left', () => {
		expect(grossIncomeAtBandStart(125_140)).toBe(ALLOWANCE_EXHAUSTED_AT);
		expect(grossIncomeAtBandStart(150_000)).toBe(150_000);
	});

	it('divides rather than shifts inside the taper, and agrees with the other two at each join', () => {
		// £87,430 of taxable income is £100,000 gross by either the below-taper or the in-taper rule.
		expect(grossIncomeAtBandStart(87_430)).toBe(ALLOWANCE_TAPER_THRESHOLD);
		// One pound further up, gross rises by only 67p, because the taper adds 1.5× taxable income.
		expect(grossIncomeAtBandStart(87_431)).toBeCloseTo(100_000.67, 2);
	});

	it('reproduces the published Scottish thresholds on gross income', () => {
		expect(grossIncomeAtBandStart(3_967)).toBe(16_537);
		expect(grossIncomeAtBandStart(16_956)).toBe(29_526);
		expect(grossIncomeAtBandStart(31_092)).toBe(43_662);
		expect(grossIncomeAtBandStart(62_430)).toBe(75_000);
	});

	it('lists every gross income where the marginal rate changes, per region', () => {
		expect(marginalRateBreakpoints('england_wales_ni')).toEqual([
			0, 12_570, 50_270, 100_000, 125_140
		]);
		expect(marginalRateBreakpoints('scotland')).toEqual([
			0, 12_570, 16_537, 29_526, 43_662, 75_000, 100_000, 125_140
		]);
	});

	it('falls back to England/Wales/NI for an unrecognised region, as tax.js does', () => {
		expect(marginalRateBreakpoints('narnia')).toEqual(marginalRateBreakpoints('england_wales_ni'));
	});
});

describe('slicing a sacrifice by the rate it displaces', () => {
	it('gives nothing back when nothing is sacrificed', () => {
		expect(sacrificeSlices(120_000, 0)).toEqual([]);
	});

	it('is one slice when the whole sacrifice sits inside a single band', () => {
		expect(sacrificeSlices(40_000, 4_000)).toEqual([
			{ from: 36_000, to: 40_000, rate: 20, amount: 4_000, taxSaved: 800, netCost: 3_200 }
		]);
	});

	it('comes off the top down, splitting at every rate change', () => {
		// £130,000 sacrificing £40,000: 45% down to £125,140, then the 60% taper, then 40%.
		expect(sacrificeSlices(130_000, 40_000)).toEqual([
			{ from: 125_140, to: 130_000, rate: 45, amount: 4_860, taxSaved: 2_187, netCost: 2_673 },
			{ from: 100_000, to: 125_140, rate: 60, amount: 25_140, taxSaved: 15_084, netCost: 10_056 },
			{ from: 90_000, to: 100_000, rate: 40, amount: 10_000, taxSaved: 4_000, netCost: 6_000 }
		]);
	});

	it('uses Scotland’s own rates, including 67.5% in the taper', () => {
		expect(sacrificeSlices(120_000, 10_000, 'scotland')).toEqual([
			{ from: 110_000, to: 120_000, rate: 67.5, amount: 10_000, taxSaved: 6_750, netCost: 3_250 }
		]);
	});

	it('shows the personal allowance as a 0% slice when a sacrifice eats past it', () => {
		const slices = sacrificeSlices(40_000, 50_000);

		expect(slices.at(-1)).toEqual({
			from: 0,
			to: PERSONAL_ALLOWANCE,
			rate: 0,
			amount: PERSONAL_ALLOWANCE,
			taxSaved: 0,
			netCost: PERSONAL_ALLOWANCE
		});
	});

	it.each([
		[40_000, 4_000, 'england_wales_ni'],
		[60_000, 15_000, 'england_wales_ni'],
		[110_000, 20_000, 'england_wales_ni'],
		[130_000, 40_000, 'england_wales_ni'],
		[200_000, 80_000, 'england_wales_ni'],
		[40_000, 50_000, 'england_wales_ni'],
		[60_000, 15_000, 'scotland'],
		[120_000, 10_000, 'scotland'],
		[150_000, 60_000, 'scotland']
	])(
		'adds up to the plain before-and-after subtraction: £%s salary, £%s sacrificed (%s)',
		(salary, sacrifice, region) => {
			const slices = sacrificeSlices(salary, sacrifice, region);
			const sliced = slices.reduce((total, slice) => total + slice.taxSaved, 0);
			const subtracted =
				incomeTax(salary, region) - incomeTax(postSacrificeIncome(salary, sacrifice), region);

			expect(sliced).toBeCloseTo(subtracted, 2);
			expect(slices.reduce((total, slice) => total + slice.amount, 0)).toBeCloseTo(
				cappedSacrifice(salary, sacrifice),
				2
			);
		}
	);
});

describe('salarySacrificeSummary', () => {
	it('leaves everything untouched when nothing is sacrificed', () => {
		const result = salarySacrificeSummary({ salary: 50_000 });

		expect(result.sacrifice).toBe(0);
		expect(result.adjustedNetIncome).toBe(50_000);
		expect(result.taxSaved).toBe(0);
		expect(result.netCost).toBe(0);
		expect(result.effectiveReliefRate).toBe(0);
		expect(result.costPerPound).toBe(0);
		expect(result.slices).toEqual([]);
		expect(result.after).toEqual(result.before);
	});

	it('relieves a basic-rate sacrifice at 20%, costing 80p per pound', () => {
		const result = salarySacrificeSummary({ salary: 40_000, sacrifice: 4_000 });

		expect(result.taxSaved).toBe(800);
		expect(result.netCost).toBe(3_200);
		expect(result.effectiveReliefRate).toBe(20);
		expect(result.costPerPound).toBe(0.8);
		expect(result.pensionGain).toBe(4_000);
		expect(result.sacrificePct).toBe(10);
	});

	it('relieves a sacrifice inside the taper at 60%, costing 40p per pound', () => {
		const result = salarySacrificeSummary({ salary: 120_000, sacrifice: 10_000 });

		expect(result.taxSaved).toBe(6_000);
		expect(result.netCost).toBe(4_000);
		expect(result.effectiveReliefRate).toBe(60);
		expect(result.costPerPound).toBe(0.4);
		expect(result.marginalRateBefore).toBe(60);
		expect(result.marginalRateAfter).toBe(60);
	});

	it('relieves the same sacrifice at 67.5% in Scotland', () => {
		const result = salarySacrificeSummary({
			salary: 120_000,
			sacrifice: 10_000,
			region: 'scotland'
		});

		expect(result.taxSaved).toBe(6_750);
		expect(result.netCost).toBe(3_250);
		expect(result.effectiveReliefRate).toBe(67.5);
		expect(result.region).toBe('scotland');
	});

	it('blends the rates when a sacrifice spans several of them', () => {
		const result = salarySacrificeSummary({ salary: 130_000, sacrifice: 40_000 });

		// 45% on £4,860, 60% on £25,140 and 40% on £10,000 — 53.18% overall, not any single band.
		expect(result.taxSaved).toBe(21_271);
		expect(result.effectiveReliefRate).toBeCloseTo(53.1775, 4);
		expect(result.marginalRateBefore).toBe(45);
		expect(result.marginalRateAfter).toBe(40);
	});

	it('takes both sides of the comparison from tax.js itself', () => {
		const result = salarySacrificeSummary({ salary: 120_000, sacrifice: 10_000 });

		expect(result.before.income).toBe(120_000);
		expect(result.after.income).toBe(110_000);
		expect(result.before.totalTax - result.after.totalTax).toBe(result.taxSaved);
		expect(result.before.takeHome - result.after.takeHome).toBe(result.netCost);
	});

	it('caps a sacrifice at the salary rather than reporting a negative income', () => {
		const result = salarySacrificeSummary({ salary: 40_000, sacrifice: 60_000 });

		expect(result.sacrifice).toBe(40_000);
		expect(result.adjustedNetIncome).toBe(0);
		expect(result.after.totalTax).toBe(0);
		expect(result.sacrificePct).toBe(100);
	});

	it('is tolerant of missing and junk input, like every other module here', () => {
		const result = salarySacrificeSummary();

		expect(result.salary).toBe(0);
		expect(result.sacrifice).toBe(0);
		expect(result.region).toBe('england_wales_ni');
		const nonsense = /** @type {any} */ ('narnia');
		expect(salarySacrificeSummary({ salary: 50_000, region: nonsense }).region).toBe(
			'england_wales_ni'
		);
	});
});

describe('what the sacrifice does to the taper', () => {
	it('reports nothing to clear below £100,000', () => {
		const { taper } = salarySacrificeSummary({ salary: 60_000, sacrifice: 6_000 });

		expect(taper.beforeInTaper).toBe(false);
		expect(taper.sacrificeToClear).toBe(0);
		expect(taper.clearsTaper).toBe(false);
		expect(taper.allowanceRestored).toBe(0);
	});

	it('buys back £1 of allowance for every £2 sacrificed inside the band', () => {
		const { taper } = salarySacrificeSummary({ salary: 120_000, sacrifice: 10_000 });

		expect(taper.beforeInTaper).toBe(true);
		expect(taper.allowanceBefore).toBe(2_570);
		expect(taper.allowanceAfter).toBe(7_570);
		expect(taper.allowanceRestored).toBe(5_000);
		expect(taper.clearsTaper).toBe(false);
		expect(taper.shortfallToClear).toBe(10_000);
	});

	it('restores the whole allowance once the sacrifice reaches £100,000 of income', () => {
		const result = salarySacrificeSummary({ salary: 125_140, sacrifice: 25_140 });
		const { taper } = result;

		expect(taper.allowanceBefore).toBe(0);
		expect(taper.allowanceAfter).toBe(PERSONAL_ALLOWANCE);
		expect(taper.allowanceRestored).toBe(PERSONAL_ALLOWANCE);
		expect(taper.clearsTaper).toBe(true);
		expect(taper.shortfallToClear).toBe(0);
		// £25,140 into the pension for £10,056 of take-home — 60% of it paid for by tax saved.
		expect(result.taxSaved).toBe(15_084);
		expect(result.netCost).toBe(10_056);
		expect(result.effectiveReliefRate).toBe(60);
	});

	it('still counts a sacrifice that only reaches into the band from above', () => {
		const { taper } = salarySacrificeSummary({ salary: 200_000, sacrifice: 80_000 });

		expect(taper.allowanceBefore).toBe(0);
		expect(taper.allowanceAfter).toBe(2_570);
		expect(taper.clearsTaper).toBe(false);
		expect(taper.shortfallToClear).toBe(20_000);
	});
});

describe('the pension annual allowance check', () => {
	it('reports the headroom left', () => {
		const result = salarySacrificeSummary({ salary: 120_000, sacrifice: 20_000 });

		expect(result.annualAllowanceUsed).toBe(20_000);
		expect(result.annualAllowanceHeadroom).toBe(40_000);
		expect(result.overAnnualAllowance).toBe(false);
	});

	it('flags a sacrifice past the allowance', () => {
		const result = salarySacrificeSummary({ salary: 200_000, sacrifice: 70_000 });

		expect(result.annualAllowanceHeadroom).toBe(0);
		expect(result.overAnnualAllowance).toBe(true);
	});

	it('counts other pension input towards it too', () => {
		const result = salarySacrificeSummary({
			salary: 200_000,
			sacrifice: 50_000,
			otherPensionInput: 15_000
		});

		expect(result.annualAllowanceUsed).toBe(65_000);
		expect(result.overAnnualAllowance).toBe(true);
	});

	it('does not flag exactly the allowance', () => {
		const result = salarySacrificeSummary({ salary: 200_000, sacrifice: 60_000 });

		expect(result.annualAllowanceHeadroom).toBe(0);
		expect(result.overAnnualAllowance).toBe(false);
	});
});

describe('taxSavedBySacrifice', () => {
	it.each([
		/** @type {const} */ ([125_140, 25_140, 'england_wales_ni']),
		/** @type {const} */ ([120_000, 10_000, 'scotland']),
		/** @type {const} */ ([40_000, 4_000, 'england_wales_ni'])
	])('is the same figure the full summary reports: £%s, £%s (%s)', (salary, sacrifice, region) => {
		expect(taxSavedBySacrifice(salary, sacrifice, region)).toBe(
			salarySacrificeSummary({ salary, sacrifice, region }).taxSaved
		);
	});

	it('is nothing when nothing is sacrificed', () => {
		expect(taxSavedBySacrifice(120_000, 0)).toBe(0);
	});
});
