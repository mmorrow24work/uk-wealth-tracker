/**
 * UK State Pension projection from NI qualifying years (issue #31).
 *
 * Every rate and threshold README.md states is pinned here, so a tax-year update is a deliberate,
 * visible edit rather than a silent drift. The interesting cases are the two discontinuities — the
 * 10-year floor below which nothing is payable, and the 35-year cap above which nothing more is
 * earned — plus the rounding convention (weekly to the penny first, annual as 52 × that).
 */
import { describe, expect, it } from 'vitest';

import { createPension } from './model.js';
import { PERSONAL_ALLOWANCE } from './tax.js';
import {
	annualStatePension,
	countingYears,
	findStatePension,
	FULL_STATE_PENSION_ANNUAL,
	FULL_STATE_PENSION_WEEKLY,
	isStatePension,
	MAX_QUALIFYING_YEARS,
	meetsMinimumYears,
	MINIMUM_QUALIFYING_YEARS,
	monthlyStatePension,
	normaliseYears,
	potPensions,
	QUALIFYING_YEARS_FOR_FULL,
	removeStatePension,
	setStatePensionYears,
	STATE_PENSION_NAME,
	STATE_PENSION_TAX_YEAR,
	statePensionAge,
	statePensionFromData,
	statePensionProjection,
	valueOfOneMoreYearAnnual,
	valueOfOneMoreYearWeekly,
	WEEKS_PER_STATE_PENSION_YEAR,
	weeklyStatePension
} from './state-pension.js';

/** A fixed "now" so every age figure in these tests is deterministic. */
const TODAY = new Date('2026-08-07T00:00:00Z');

describe('the 2026/27 figures', () => {
	it('uses README.md’s stated full rate of £241.30 a week', () => {
		expect(FULL_STATE_PENSION_WEEKLY).toBe(241.3);
	});

	it('needs 35 qualifying years for the full rate', () => {
		expect(QUALIFYING_YEARS_FOR_FULL).toBe(35);
	});

	it('pays nothing below 10 qualifying years', () => {
		expect(MINIMUM_QUALIFYING_YEARS).toBe(10);
	});

	it('derives the annual rate as 52 weeks of the weekly one', () => {
		expect(WEEKS_PER_STATE_PENSION_YEAR).toBe(52);
		expect(FULL_STATE_PENSION_ANNUAL).toBe(12_547.6);
	});

	it('is stamped with the same tax year as tax.js', () => {
		expect(STATE_PENSION_TAX_YEAR).toBe('2026/27');
	});
});

describe('normaliseYears', () => {
	it('clamps to 0–60, matching validateAppData’s own range for the NI fields', () => {
		expect(MAX_QUALIFYING_YEARS).toBe(60);
		expect(normaliseYears(-4)).toBe(0);
		expect(normaliseYears(99)).toBe(60);
		expect(normaliseYears(22)).toBe(22);
	});

	it('accepts numeric strings, the way a number input hands them over', () => {
		expect(normaliseYears('18')).toBe(18);
	});

	it('reads anything unparseable as zero rather than NaN', () => {
		expect(normaliseYears(undefined)).toBe(0);
		expect(normaliseYears(null)).toBe(0);
		expect(normaliseYears('twenty')).toBe(0);
		expect(normaliseYears(Number.NaN)).toBe(0);
		expect(normaliseYears(Number.POSITIVE_INFINITY)).toBe(0);
	});

	it('keeps a fractional year rather than rounding it away', () => {
		expect(normaliseYears(17.5)).toBe(17.5);
	});
});

describe('countingYears', () => {
	it('caps at 35 — years past the 35th add nothing', () => {
		expect(countingYears(30)).toBe(30);
		expect(countingYears(35)).toBe(35);
		expect(countingYears(48)).toBe(35);
	});
});

describe('meetsMinimumYears', () => {
	it('is the 10-year floor exactly, inclusive', () => {
		expect(meetsMinimumYears(9)).toBe(false);
		expect(meetsMinimumYears(9.99)).toBe(false);
		expect(meetsMinimumYears(10)).toBe(true);
		expect(meetsMinimumYears(11)).toBe(true);
	});
});

describe('weeklyStatePension', () => {
	it('pays the full rate at 35 years', () => {
		expect(weeklyStatePension(35)).toBe(241.3);
	});

	it('pays nothing at all below the 10-year floor — a cliff, not a taper', () => {
		expect(weeklyStatePension(0)).toBe(0);
		expect(weeklyStatePension(5)).toBe(0);
		expect(weeklyStatePension(9)).toBe(0);
	});

	it('pays ten thirty-fifths of the full rate the moment the floor is reached', () => {
		// 241.30 × 10/35 = 68.942857…
		expect(weeklyStatePension(10)).toBe(68.94);
	});

	it('pro-rates between the floor and the cap', () => {
		// 241.30 × 20/35 = 137.885714…
		expect(weeklyStatePension(20)).toBe(137.89);
		// 241.30 × 30/35 = 206.828571…
		expect(weeklyStatePension(30)).toBe(206.83);
		// 241.30 × 34/35 = 234.405714…
		expect(weeklyStatePension(34)).toBe(234.41);
	});

	it('never pays more than the full rate, however many years are recorded', () => {
		expect(weeklyStatePension(40)).toBe(241.3);
		expect(weeklyStatePension(60)).toBe(241.3);
		expect(weeklyStatePension(500)).toBe(241.3);
	});

	it('treats a negative year count as zero', () => {
		expect(weeklyStatePension(-10)).toBe(0);
	});
});

describe('annualStatePension and monthlyStatePension', () => {
	it('annualises the *rounded* weekly figure, so 52 payments reconcile exactly', () => {
		expect(annualStatePension(35)).toBe(12_547.6);
		expect(annualStatePension(20)).toBe(7170.28);
		expect(annualStatePension(10)).toBe(3584.88);
	});

	it('splits the annual figure into twelfths for the monthly view', () => {
		expect(monthlyStatePension(35)).toBe(1045.63);
		expect(monthlyStatePension(5)).toBe(0);
	});
});

describe('valueOfOneMoreYear', () => {
	it('is worth nothing while still below the floor', () => {
		expect(valueOfOneMoreYearWeekly(3)).toBe(0);
		expect(valueOfOneMoreYearWeekly(8)).toBe(0);
	});

	it('is worth the whole 10/35ths on the year that reaches the floor', () => {
		expect(valueOfOneMoreYearWeekly(9)).toBe(68.94);
		expect(valueOfOneMoreYearAnnual(9)).toBe(3584.88);
	});

	it('is worth about a thirty-fifth of the full rate in the ordinary range', () => {
		// 241.30/35 = £6.894…/week, which lands on 6.89 either side of the rounding.
		expect(valueOfOneMoreYearWeekly(20)).toBeCloseTo(6.89, 2);
		expect(valueOfOneMoreYearWeekly(34)).toBe(6.89);
		expect(valueOfOneMoreYearAnnual(34)).toBeCloseTo(358.28, 2);
	});

	it('is worth nothing once the 35th year is reached', () => {
		expect(valueOfOneMoreYearWeekly(35)).toBe(0);
		expect(valueOfOneMoreYearWeekly(41)).toBe(0);
		expect(valueOfOneMoreYearAnnual(35)).toBe(0);
	});
});

describe('statePensionAge', () => {
	it('is null with no birth year recorded', () => {
		expect(statePensionAge(null, null)).toBeNull();
		expect(statePensionAge(undefined, 6)).toBeNull();
	});

	it('is 66 for anyone born before April 1960', () => {
		expect(statePensionAge(1955, 6)).toBe(66);
		expect(statePensionAge(1960, 3)).toBe(66);
	});

	it('is 67 from April 1960 to March 1977', () => {
		expect(statePensionAge(1960, 4)).toBe(67);
		expect(statePensionAge(1972, 11)).toBe(67);
		expect(statePensionAge(1977, 3)).toBe(67);
	});

	it('is 68 from April 1977 onwards, as currently legislated', () => {
		expect(statePensionAge(1977, 4)).toBe(68);
		expect(statePensionAge(1990, 1)).toBe(68);
	});

	it('reads a missing birth month as January, i.e. the earlier tier', () => {
		expect(statePensionAge(1960, null)).toBe(66);
		expect(statePensionAge(1977, null)).toBe(67);
	});
});

describe('statePensionProjection', () => {
	it('projects on qualifying years plus expected future years', () => {
		const result = statePensionProjection({ qualifyingYears: 20, futureYears: 10, today: TODAY });

		expect(result.totalYears).toBe(30);
		expect(result.weekly).toBe(206.83);
		expect(result.annual).toBe(10_755.16);
		expect(result.yearsToFull).toBe(5);
		expect(result.reachesFull).toBe(false);
	});

	it('reports what today’s years alone would pay, alongside the projection', () => {
		const result = statePensionProjection({ qualifyingYears: 20, futureYears: 10, today: TODAY });

		expect(result.weeklyIfNoMoreYears).toBe(137.89);
		expect(result.annualIfNoMoreYears).toBe(7170.28);
	});

	it('reports the shortfall against the full rate, and none once there', () => {
		const short = statePensionProjection({ qualifyingYears: 30, today: TODAY });
		expect(short.shortfallWeekly).toBeCloseTo(34.47, 2);
		expect(short.shortfallAnnual).toBeCloseTo(1792.44, 2);

		const full = statePensionProjection({ qualifyingYears: 35, today: TODAY });
		expect(full.shortfallWeekly).toBe(0);
		expect(full.shortfallAnnual).toBe(0);
		expect(full.reachesFull).toBe(true);
		expect(full.yearsToFull).toBe(0);
	});

	it('flags years recorded past the 35th as adding nothing', () => {
		const result = statePensionProjection({ qualifyingYears: 38, futureYears: 4, today: TODAY });

		expect(result.totalYears).toBe(42);
		expect(result.countingYears).toBe(35);
		expect(result.wastedYears).toBe(7);
		expect(result.weekly).toBe(241.3);
		expect(result.valueOfOneMoreYearWeekly).toBe(0);
	});

	it('reports how far short of the 10-year floor a thin record is', () => {
		const result = statePensionProjection({ qualifyingYears: 4, futureYears: 2, today: TODAY });

		expect(result.meetsMinimum).toBe(false);
		expect(result.yearsToMinimum).toBe(4);
		expect(result.weekly).toBe(0);
		expect(result.annual).toBe(0);
		expect(result.pctOfFull).toBe(0);
	});

	it('prices clearing the floor outright, since one more year alone is worth nothing there', () => {
		const thin = statePensionProjection({ qualifyingYears: 4, today: TODAY });

		// A 5th year buys nothing; reaching 10 buys the whole 10/35ths at once.
		expect(thin.valueOfOneMoreYearWeekly).toBe(0);
		expect(thin.valueOfReachingMinimumWeekly).toBe(68.94);
		expect(thin.valueOfReachingMinimumAnnual).toBe(3584.88);
	});

	it('has nothing left to gain from the floor once it is cleared', () => {
		const result = statePensionProjection({ qualifyingYears: 20, today: TODAY });

		expect(result.valueOfReachingMinimumWeekly).toBe(0);
		expect(result.valueOfReachingMinimumAnnual).toBe(0);
	});

	it('reports the share of the full rate the projection pays', () => {
		expect(statePensionProjection({ qualifyingYears: 35, today: TODAY }).pctOfFull).toBe(100);
		expect(statePensionProjection({ qualifyingYears: 20, today: TODAY }).pctOfFull).toBeCloseTo(
			57.14,
			1
		);
	});

	it('projects zero from an empty input rather than throwing', () => {
		const result = statePensionProjection();

		expect(result.totalYears).toBe(0);
		expect(result.weekly).toBe(0);
		expect(result.yearsToFull).toBe(35);
		expect(result.statePensionAge).toBeNull();
		expect(result.statePensionYear).toBeNull();
		expect(result.yearsToStatePensionAge).toBeNull();
		expect(result.maxFutureYears).toBeNull();
		expect(result.futureYearsExceedWorkingLife).toBe(false);
	});

	it('clamps the two year counts and their total to the stored 0–60 range', () => {
		const result = statePensionProjection({
			qualifyingYears: 55,
			futureYears: 40,
			today: TODAY
		});

		expect(result.qualifyingYears).toBe(55);
		expect(result.futureYears).toBe(40);
		expect(result.totalYears).toBe(60);
	});

	it('derives State Pension age, the calendar year it lands, and how long that is away', () => {
		const result = statePensionProjection({
			qualifyingYears: 18,
			dobYear: 1985,
			dobMonth: 6,
			today: TODAY
		});

		expect(result.statePensionAge).toBe(68);
		expect(result.statePensionYear).toBe(2053);
		expect(result.currentAge).toBe(41);
		expect(result.yearsToStatePensionAge).toBe(27);
		expect(result.maxFutureYears).toBe(27);
	});

	it('reads someone already past State Pension age as having no years left to earn', () => {
		const result = statePensionProjection({
			qualifyingYears: 35,
			dobYear: 1950,
			dobMonth: 1,
			today: TODAY
		});

		expect(result.statePensionAge).toBe(66);
		expect(result.currentAge).toBe(76);
		expect(result.yearsToStatePensionAge).toBe(0);
		expect(result.maxFutureYears).toBe(0);
	});

	it('flags future years that cannot be earned before State Pension age', () => {
		const plausible = statePensionProjection({
			qualifyingYears: 10,
			futureYears: 20,
			dobYear: 1985,
			dobMonth: 6,
			today: TODAY
		});
		expect(plausible.futureYearsExceedWorkingLife).toBe(false);

		const impossible = statePensionProjection({
			qualifyingYears: 10,
			futureYears: 40,
			dobYear: 1985,
			dobMonth: 6,
			today: TODAY
		});
		expect(impossible.futureYearsExceedWorkingLife).toBe(true);
	});

	it('never flags an impossible year count when there is no birth year to check against', () => {
		const result = statePensionProjection({ qualifyingYears: 10, futureYears: 50, today: TODAY });
		expect(result.futureYearsExceedWorkingLife).toBe(false);
	});

	it('shows how much other income still fits under the personal allowance', () => {
		const result = statePensionProjection({ qualifyingYears: 35, today: TODAY });

		expect(result.personalAllowance).toBe(PERSONAL_ALLOWANCE);
		// The full State Pension lands just under the 2026/27 allowance — £12,547.60 of £12,570.
		expect(result.exceedsPersonalAllowance).toBe(false);
		expect(result.allowanceHeadroom).toBeCloseTo(22.4, 2);
	});

	it('leaves the whole allowance free when nothing is payable', () => {
		const result = statePensionProjection({ qualifyingYears: 3, today: TODAY });
		expect(result.allowanceHeadroom).toBe(PERSONAL_ALLOWANCE);
	});

	it('builds a ladder covering today, the projection, the floor and the full rate', () => {
		const result = statePensionProjection({ qualifyingYears: 20, futureYears: 8, today: TODAY });

		expect(result.ladder.map((point) => point.years)).toEqual([10, 20, 28, 35]);
		expect(result.ladder.at(0)?.weekly).toBe(68.94);
		expect(result.ladder.at(-1)?.weekly).toBe(241.3);
		expect(result.ladder.at(-1)?.pctOfFull).toBe(100);
	});

	it('collapses ladder rows that land on the same year count', () => {
		const result = statePensionProjection({ qualifyingYears: 35, futureYears: 0, today: TODAY });

		expect(result.ladder.map((point) => point.years)).toEqual([10, 35]);
	});

	it('defaults its reference date to now when none is injected', () => {
		const result = statePensionProjection({ qualifyingYears: 20, dobYear: 1985, dobMonth: 6 });
		expect(result.currentAge).not.toBeNull();
		expect(result.statePensionAge).toBe(68);
	});
});

describe('the State Pension record inside pensions[]', () => {
	it('recognises the State Pension type and nothing else', () => {
		expect(isStatePension(createPension({ type: 'state' }))).toBe(true);
		expect(isStatePension(createPension({ type: 'sipp' }))).toBe(false);
		expect(isStatePension(createPension({ type: 'db_final_salary' }))).toBe(false);
	});

	it('finds the State Pension record among the pots, or reports none', () => {
		const pots = [createPension({ type: 'sipp' }), createPension({ type: 'dc_workplace' })];
		expect(findStatePension(pots)).toBeNull();
		expect(findStatePension()).toBeNull();

		const state = createPension({ type: 'state', ni_qualifying_years: 22 });
		expect(findStatePension([...pots, state])).toBe(state);
	});

	it('separates pots from the State Pension without reordering them', () => {
		const sipp = createPension({ name: 'SIPP', type: 'sipp' });
		const state = createPension({ type: 'state' });
		const workplace = createPension({ name: 'Aviva', type: 'dc_workplace' });

		expect(potPensions([sipp, state, workplace])).toEqual([sipp, workplace]);
	});

	it('creates the State Pension record the first time years are entered', () => {
		const sipp = createPension({ name: 'SIPP', type: 'sipp' });
		const after = setStatePensionYears([sipp], { ni_qualifying_years: 18 });

		expect(after).toHaveLength(2);
		expect(after[0]).toBe(sipp);
		const state = findStatePension(after);
		expect(state?.type).toBe('state');
		expect(state?.name).toBe(STATE_PENSION_NAME);
		expect(state?.ni_qualifying_years).toBe(18);
		expect(state?.ni_future_years).toBe(0);
	});

	it('updates the existing record instead of adding a second one', () => {
		const first = setStatePensionYears([], { ni_qualifying_years: 18 });
		const second = setStatePensionYears(first, { ni_future_years: 9 });

		expect(second).toHaveLength(1);
		expect(findStatePension(second)?.ni_qualifying_years).toBe(18);
		expect(findStatePension(second)?.ni_future_years).toBe(9);
		// The record's id survives an edit, so nothing downstream sees a delete-and-re-add.
		expect(findStatePension(second)?.id).toBe(findStatePension(first)?.id);
	});

	it('returns a new array and never mutates the one passed in', () => {
		const before = [createPension({ type: 'sipp' })];
		const after = setStatePensionYears(before, { ni_qualifying_years: 5 });

		expect(after).not.toBe(before);
		expect(before).toHaveLength(1);
	});

	it('removes the State Pension record and leaves every pot alone', () => {
		const sipp = createPension({ name: 'SIPP', type: 'sipp' });
		const withState = setStatePensionYears([sipp], { ni_qualifying_years: 30 });

		expect(removeStatePension(withState)).toEqual([sipp]);
		expect(removeStatePension([sipp])).toEqual([sipp]);
	});
});

describe('statePensionFromData', () => {
	it('projects straight off a stored pensions list and profile', () => {
		const pensions = setStatePensionYears([createPension({ type: 'sipp' })], {
			ni_qualifying_years: 22,
			ni_future_years: 13
		});
		const result = statePensionFromData(pensions, { dob_year: 1985, dob_month: 6 }, TODAY);

		expect(result.totalYears).toBe(35);
		expect(result.weekly).toBe(241.3);
		expect(result.statePensionAge).toBe(68);
	});

	it('projects zero when no State Pension record has been created yet', () => {
		const result = statePensionFromData([createPension({ type: 'sipp' })], null, TODAY);

		expect(result.qualifyingYears).toBe(0);
		expect(result.weekly).toBe(0);
		expect(result.statePensionAge).toBeNull();
	});

	it('tolerates null NI fields on an existing record', () => {
		const record = createPension({ type: 'state' });
		expect(record.ni_qualifying_years).toBeNull();

		const result = statePensionFromData([record], { dob_year: null, dob_month: null }, TODAY);
		expect(result.qualifyingYears).toBe(0);
		expect(result.futureYears).toBe(0);
	});

	it('survives being handed nothing at all', () => {
		expect(statePensionFromData().weekly).toBe(0);
	});
});
