import { describe, expect, it } from 'vitest';

import {
	COMMON_ACCRUAL_DENOMINATORS,
	DEFINED_BENEFIT_INPUTS,
	DEFINED_BENEFIT_INPUT_LABELS,
	MAX_PENSIONABLE_YEARS,
	accrualDenominatorFromRate,
	accrualFractionLabel,
	accrualRateFromDenominator,
	accruedIncome,
	asRecordedInput,
	definedBenefitBreakdown,
	definedBenefitIncome,
	definedBenefitTotals,
	isDefinedBenefit,
	projectDefinedBenefit
} from './defined-benefit.js';
import { DEFINED_BENEFIT_PENSION_TYPES } from './enums.js';
import { createPension } from './model.js';
import { fireNumber } from './fire.js';

/**
 * A Defined Benefit pot with the accrual route filled in — 1/60th, 25 years, £45,000, which is
 * £18,750 a year. Overrides let each test disturb exactly one thing.
 *
 * @param {Partial<import('./types.js').Pension>} [overrides]
 * @returns {import('./types.js').Pension}
 */
function dbPension(overrides = {}) {
	return createPension({
		name: 'Legacy final salary scheme',
		type: 'db_final_salary',
		db_accrual_rate: accrualRateFromDenominator(60),
		db_years: 25,
		db_salary: 45_000,
		...overrides
	});
}

describe('asRecordedInput', () => {
	it('reads a positive number as recorded', () => {
		expect(asRecordedInput(45_000)).toBe(45_000);
		expect(asRecordedInput(0.5)).toBe(0.5);
	});

	it('reads null, zero and negatives alike as not recorded — convention (2)', () => {
		expect(asRecordedInput(null)).toBeNull();
		expect(asRecordedInput(undefined)).toBeNull();
		expect(asRecordedInput(0)).toBeNull();
		expect(asRecordedInput(-1)).toBeNull();
	});

	it('accepts the numeric strings a form control hands over, and rejects the rest', () => {
		expect(asRecordedInput('25')).toBe(25);
		expect(asRecordedInput('')).toBeNull();
		expect(asRecordedInput('   ')).toBeNull();
		expect(asRecordedInput('not a number')).toBeNull();
		expect(asRecordedInput(Number.NaN)).toBeNull();
		expect(asRecordedInput(Number.POSITIVE_INFINITY)).toBeNull();
	});
});

describe('accrual rates', () => {
	it('converts a 1/n scheme to a percentage per year of service', () => {
		expect(accrualRateFromDenominator(80)).toBe(1.25);
		expect(accrualRateFromDenominator(50)).toBe(2);
		expect(accrualRateFromDenominator(60)).toBeCloseTo(1.666_666_7, 6);
	});

	it('round-trips every denominator the form offers', () => {
		for (const denominator of COMMON_ACCRUAL_DENOMINATORS) {
			const rate = accrualRateFromDenominator(denominator);
			expect(accrualDenominatorFromRate(rate)).toBeCloseTo(denominator, 9);
			expect(accrualFractionLabel(rate)).toBe(`1/${denominator}th`);
		}
	});

	it('labels a rate rounded to two decimals as the fraction it came from', () => {
		// What a user typing "1.67" rather than picking 1/60th off the select would store.
		expect(accrualFractionLabel(1.67)).toBe('1/60th');
		expect(accrualFractionLabel(1.25)).toBe('1/80th');
	});

	it('uses the right ordinal suffix', () => {
		expect(accrualFractionLabel(accrualRateFromDenominator(41))).toBe('1/41st');
		expect(accrualFractionLabel(accrualRateFromDenominator(42))).toBe('1/42nd');
		expect(accrualFractionLabel(accrualRateFromDenominator(43))).toBe('1/43rd');
		expect(accrualFractionLabel(accrualRateFromDenominator(13))).toBe('1/13th');
		expect(accrualFractionLabel(accrualRateFromDenominator(111))).toBe('1/111th');
	});

	it('gives no fraction for a rate that is not one', () => {
		expect(accrualFractionLabel(1.9)).toBe('');
		expect(accrualFractionLabel(0)).toBe('');
		expect(accrualFractionLabel(null)).toBe('');
		expect(accrualFractionLabel(150)).toBe('');
	});

	it('reports no denominator for a rate that is not recorded', () => {
		expect(accrualDenominatorFromRate(0)).toBeNull();
		expect(accrualDenominatorFromRate(-2)).toBeNull();
		expect(accrualRateFromDenominator(0)).toBe(0);
	});
});

describe('accruedIncome', () => {
	it('is accrual rate × salary × years — README.md’s DB formula', () => {
		// 1/60th of £45,000 is £750 a year for each of 25 years.
		expect(accruedIncome(accrualRateFromDenominator(60), 25, 45_000)).toBe(18_750);
		// 1/80th of £60,000 over 40 years is half pay.
		expect(accruedIncome(accrualRateFromDenominator(80), 40, 60_000)).toBe(30_000);
	});

	it('rounds to whole pence', () => {
		const income = /** @type {number} */ (
			accruedIncome(accrualRateFromDenominator(57), 13, 41_333)
		);
		expect(income).toBe(Math.round(income * 100) / 100);
		expect(income).toBeCloseTo((100 / 57 / 100) * 41_333 * 13, 2);
	});

	it('scales linearly in each of its three inputs', () => {
		const base = /** @type {number} */ (accruedIncome(2, 10, 50_000));
		expect(accruedIncome(4, 10, 50_000)).toBe(base * 2);
		expect(accruedIncome(2, 20, 50_000)).toBe(base * 2);
		expect(accruedIncome(2, 10, 100_000)).toBe(base * 2);
	});

	it('is null — not zero — when any input is missing', () => {
		expect(accruedIncome(null, 25, 45_000)).toBeNull();
		expect(accruedIncome(1.25, null, 45_000)).toBeNull();
		expect(accruedIncome(1.25, 25, null)).toBeNull();
		expect(accruedIncome(1.25, 25, 0)).toBeNull();
	});

	it('caps service at MAX_PENSIONABLE_YEARS', () => {
		expect(accruedIncome(1, MAX_PENSIONABLE_YEARS + 500, 50_000)).toBe(
			accruedIncome(1, MAX_PENSIONABLE_YEARS, 50_000)
		);
	});
});

describe('isDefinedBenefit', () => {
	it('is true for both Defined Benefit types and nothing else', () => {
		for (const type of DEFINED_BENEFIT_PENSION_TYPES) {
			expect(isDefinedBenefit({ type })).toBe(true);
		}
		for (const type of ['dc_workplace', 'sipp', 'lisa', 'state']) {
			expect(isDefinedBenefit({ type })).toBe(false);
		}
	});

	it('does not throw on rubbish', () => {
		expect(isDefinedBenefit(null)).toBe(false);
		expect(isDefinedBenefit(undefined)).toBe(false);
		expect(isDefinedBenefit({})).toBe(false);
		expect(isDefinedBenefit('db_care')).toBe(false);
	});
});

describe('definedBenefitIncome', () => {
	it('runs the formula when only the accrual route is recorded', () => {
		expect(definedBenefitIncome(dbPension())).toBe(18_750);
	});

	it('lets a stated income win over the formula — convention (3)', () => {
		expect(definedBenefitIncome(dbPension({ db_annual_income: 21_400 }))).toBe(21_400);
	});

	it('reads a stated income of zero as not recorded, and falls through to the formula', () => {
		// Convention (2): otherwise a typed zero silently zeroes a complete set of accrual inputs.
		expect(definedBenefitIncome(dbPension({ db_annual_income: 0 }))).toBe(18_750);
	});

	it('works from a stated income alone, with no accrual inputs at all', () => {
		const statement = createPension({
			type: 'db_care',
			db_accrual_rate: null,
			db_years: null,
			db_salary: null,
			db_annual_income: 9_320
		});
		expect(definedBenefitIncome(statement)).toBe(9_320);
	});

	it('is zero when neither route has enough', () => {
		expect(definedBenefitIncome(createPension({ type: 'db_care' }))).toBe(0);
		expect(definedBenefitIncome(dbPension({ db_salary: null }))).toBe(0);
	});

	it('is zero for a pot whose income does not come from these fields', () => {
		const dc = createPension({ type: 'dc_workplace', value: 250_000, db_annual_income: 12_000 });
		expect(definedBenefitIncome(dc)).toBe(0);
		expect(definedBenefitIncome(null)).toBe(0);
	});
});

describe('definedBenefitBreakdown', () => {
	it('reports the accrual route in full', () => {
		const result = definedBenefitBreakdown(dbPension());

		expect(result.source).toBe('accrual');
		expect(result.accrualFraction).toBe('1/60th');
		expect(result.years).toBe(25);
		expect(result.salary).toBe(45_000);
		expect(result.accruedIncome).toBe(18_750);
		expect(result.statedIncome).toBeNull();
		expect(result.annualIncome).toBe(18_750);
		expect(result.monthlyIncome).toBe(1562.5);
		expect(result.complete).toBe(true);
		expect(result.missingInputs).toEqual([]);
		expect(result.routeDifference).toBeNull();
	});

	it('reports the replacement rate against pensionable salary', () => {
		// 25 years of 1/60ths is 25/60 of salary — a shade under 42%.
		expect(definedBenefitBreakdown(dbPension()).replacementRate).toBeCloseTo((25 / 60) * 100, 9);
	});

	it('has no replacement rate to report without a salary', () => {
		const result = definedBenefitBreakdown(
			dbPension({ db_salary: null, db_annual_income: 20_000 })
		);
		expect(result.replacementRate).toBeNull();
	});

	it('keeps the formula figure alongside a stated income, and the gap between them', () => {
		const result = definedBenefitBreakdown(dbPension({ db_annual_income: 20_000 }));

		expect(result.source).toBe('stated');
		expect(result.statedIncome).toBe(20_000);
		expect(result.accruedIncome).toBe(18_750);
		expect(result.annualIncome).toBe(20_000);
		expect(result.routeDifference).toBe(1_250);
	});

	it('names every missing accrual input, in field order', () => {
		const result = definedBenefitBreakdown(
			createPension({ type: 'db_care', db_years: 12, db_accrual_rate: null, db_salary: null })
		);

		expect(result.source).toBe('none');
		expect(result.complete).toBe(false);
		expect(result.annualIncome).toBe(0);
		expect(result.missingInputs).toEqual(['db_accrual_rate', 'db_salary']);
	});

	it('asks for nothing more once a stated income covers it', () => {
		const statement = createPension({ type: 'db_final_salary', db_annual_income: 14_000 });
		expect(definedBenefitBreakdown(statement).missingInputs).toEqual([]);
	});

	it('labels every field it can name as missing', () => {
		for (const field of DEFINED_BENEFIT_INPUTS) {
			expect(DEFINED_BENEFIT_INPUT_LABELS[field]).toBeTruthy();
		}
	});

	it('zeroes a pot that is not Defined Benefit rather than reading its db_ fields', () => {
		const result = definedBenefitBreakdown(
			createPension({ type: 'sipp', value: 120_000, db_annual_income: 30_000 })
		);

		expect(result.isDefinedBenefit).toBe(false);
		expect(result.annualIncome).toBe(0);
		expect(result.statedIncome).toBeNull();
		expect(result.source).toBe('none');
	});

	it('survives a null, an empty object and a hand-mangled record', () => {
		expect(definedBenefitBreakdown(null).annualIncome).toBe(0);
		expect(definedBenefitBreakdown({}).id).toBe('');
		// A hand-edited Gist can hold anything; `normaliseAppData` would fix this, a raw fetch may not.
		const mangled = /** @type {Partial<import('./types.js').Pension>} */ (
			/** @type {unknown} */ ({
				type: 'db_care',
				db_accrual_rate: 'one sixtieth',
				db_years: '25',
				db_salary: '45000'
			})
		);
		expect(definedBenefitBreakdown(mangled).missingInputs).toEqual(['db_accrual_rate']);
	});
});

describe('projectDefinedBenefit', () => {
	it('adds further years of service at the recorded salary', () => {
		const result = projectDefinedBenefit(dbPension({ db_years: 12 }), { extraYears: 13 });

		expect(result.basis).toBe('accrual');
		expect(result.years).toBe(25);
		expect(result.salary).toBe(45_000);
		expect(result.annualIncome).toBe(18_750);
		expect(result.uplift).toBe(18_750 - 9_000);
	});

	it('grows the salary over the extra years as well', () => {
		const result = projectDefinedBenefit(dbPension({ db_years: 20 }), {
			extraYears: 5,
			salaryGrowthRate: 3
		});

		const salary = 45_000 * 1.03 ** 5;
		expect(result.salary).toBeCloseTo(salary, 2);
		expect(result.annualIncome).toBeCloseTo((1 / 60) * salary * 25, 1);
	});

	it('changes nothing when there is nothing extra to add', () => {
		const base = definedBenefitBreakdown(dbPension());
		const result = projectDefinedBenefit(dbPension(), {});

		expect(result.annualIncome).toBe(base.annualIncome);
		expect(result.uplift).toBe(0);
	});

	it('reads negative extra years as none, and caps total service', () => {
		expect(projectDefinedBenefit(dbPension(), { extraYears: -10 }).years).toBe(25);
		expect(projectDefinedBenefit(dbPension(), { extraYears: 500 }).years).toBe(
			MAX_PENSIONABLE_YEARS
		);
	});

	it('returns a stated income untouched — there is nothing to project it from', () => {
		const result = projectDefinedBenefit(dbPension({ db_annual_income: 20_000 }), {
			extraYears: 10,
			salaryGrowthRate: 5
		});

		expect(result.basis).toBe('stated');
		expect(result.annualIncome).toBe(20_000);
		expect(result.years).toBeNull();
		expect(result.uplift).toBe(0);
	});

	it('has nothing to project when the scheme has no inputs', () => {
		const result = projectDefinedBenefit(createPension({ type: 'db_care' }), { extraYears: 10 });

		expect(result.basis).toBe('none');
		expect(result.annualIncome).toBe(0);
	});
});

describe('definedBenefitTotals', () => {
	/** @type {import('./types.js').Pension[]} */
	const pensions = [
		createPension({ name: 'Workplace DC', type: 'dc_workplace', value: 80_000 }),
		dbPension({ name: 'Final salary' }),
		createPension({ name: 'NHS 2015', type: 'db_care', db_annual_income: 6_250 }),
		createPension({ name: 'Old scheme', type: 'db_final_salary', db_years: 4 })
	];

	it('counts only the Defined Benefit pots, in input order', () => {
		const totals = definedBenefitTotals(pensions);

		expect(totals.count).toBe(3);
		expect(totals.schemes.map((scheme) => scheme.name)).toEqual([
			'Final salary',
			'NHS 2015',
			'Old scheme'
		]);
	});

	it('adds every scheme’s income together', () => {
		const totals = definedBenefitTotals(pensions);

		expect(totals.annualIncome).toBe(18_750 + 6_250);
		expect(totals.monthlyIncome).toBe(roundTo2((18_750 + 6_250) / 12));
	});

	it('separates the schemes that produce an income from the ones still missing an input', () => {
		const totals = definedBenefitTotals(pensions);

		expect(totals.completeCount).toBe(2);
		expect(totals.incompleteCount).toBe(1);
	});

	it('prices the income as the pot it would take to buy it, using fire.js', () => {
		const totals = definedBenefitTotals(pensions);

		expect(totals.withdrawalRate).toBe(4);
		expect(totals.capitalEquivalent).toBe(fireNumber(25_000, 4));
		expect(totals.capitalEquivalent).toBe(25_000 * 25);
	});

	it('honours a different withdrawal rate', () => {
		const totals = definedBenefitTotals(pensions, 3);

		expect(totals.withdrawalRate).toBe(3);
		expect(totals.capitalEquivalent).toBe(fireNumber(25_000, 3));
	});

	it('clamps an impossible withdrawal rate rather than dividing by zero', () => {
		expect(definedBenefitTotals(pensions, 0).capitalEquivalent).toBeGreaterThan(0);
		expect(Number.isFinite(definedBenefitTotals(pensions, 0).capitalEquivalent)).toBe(true);
	});

	it('is an empty, zeroed result for no pensions at all', () => {
		const totals = definedBenefitTotals();

		expect(totals.schemes).toEqual([]);
		expect(totals.count).toBe(0);
		expect(totals.annualIncome).toBe(0);
		expect(totals.capitalEquivalent).toBe(0);
	});

	it('does not throw on a non-array', () => {
		// @ts-expect-error — deliberately the wrong type.
		expect(definedBenefitTotals(null).count).toBe(0);
	});
});

/** @param {number} value @returns {number} */
function roundTo2(value) {
	return Math.round(value * 100) / 100;
}
