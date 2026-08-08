import { describe, expect, it } from 'vitest';

import { fireNumber } from './fire.js';
import { createPension, createProfile } from './model.js';
import {
	DEFAULT_STATE_PENSION_AGE,
	FULL_STATE_PENSION_ANNUAL,
	FULL_STATE_PENSION_WEEKLY,
	MAX_QUALIFYING_YEARS,
	MAX_STATE_PENSION_AGE,
	MINIMUM_QUALIFYING_YEARS,
	MIN_STATE_PENSION_AGE,
	QUALIFYING_YEARS_FOR_FULL,
	QUALIFYING_YEAR_ANNUAL_VALUE,
	QUALIFYING_YEAR_WEEKLY_VALUE,
	STATE_PENSION_NAME,
	WEEKS_PER_YEAR,
	annualStatePension,
	asQualifyingYears,
	findStatePension,
	isStatePension,
	statePensionAge,
	statePensionOutlook,
	statePensionProjection,
	statePensionTiming,
	weeklyStatePension
} from './state-pension.js';

/**
 * A State Pension record with a National Insurance count on it.
 *
 * @param {Partial<import('./types.js').Pension>} [overrides]
 * @returns {import('./types.js').Pension}
 */
function statePension(overrides = {}) {
	return createPension({
		name: STATE_PENSION_NAME,
		type: 'state',
		ni_qualifying_years: 20,
		ni_future_years: 10,
		...overrides
	});
}

describe('the 2026/27 figures', () => {
	it('carries README.md’s stated rate and thresholds', () => {
		expect(FULL_STATE_PENSION_WEEKLY).toBe(241.3);
		expect(QUALIFYING_YEARS_FOR_FULL).toBe(35);
		expect(MINIMUM_QUALIFYING_YEARS).toBe(10);
	});

	it('annualises the weekly rate at 52 weeks, DWP’s own convention', () => {
		expect(WEEKS_PER_YEAR).toBe(52);
		expect(FULL_STATE_PENSION_ANNUAL).toBe(12_547.6);
	});

	it('prices one qualifying year at a thirty-fifth of the full rate', () => {
		expect(QUALIFYING_YEAR_WEEKLY_VALUE).toBe(6.89);
		expect(QUALIFYING_YEAR_ANNUAL_VALUE).toBe(358.28);
	});
});

describe('asQualifyingYears', () => {
	it('keeps a recorded zero and only reads a blank as not recorded — convention (3)', () => {
		expect(asQualifyingYears(0)).toBe(0);
		expect(asQualifyingYears('0')).toBe(0);
		expect(asQualifyingYears(null)).toBeNull();
		expect(asQualifyingYears(undefined)).toBeNull();
		expect(asQualifyingYears('')).toBeNull();
		expect(asQualifyingYears('   ')).toBeNull();
		expect(asQualifyingYears('not a number')).toBeNull();
		expect(asQualifyingYears(Number.NaN)).toBeNull();
		expect(asQualifyingYears(Number.POSITIVE_INFINITY)).toBeNull();
	});

	it('floors a fractional count — a qualifying year is yes or no, convention (2)', () => {
		expect(asQualifyingYears(12.7)).toBe(12);
		expect(asQualifyingYears('34.999')).toBe(34);
	});

	it('clamps to the 0–60 range model.js validates the ni_* fields against', () => {
		expect(asQualifyingYears(-5)).toBe(0);
		expect(asQualifyingYears(MAX_QUALIFYING_YEARS + 10)).toBe(MAX_QUALIFYING_YEARS);
	});
});

describe('weeklyStatePension', () => {
	it('pays nothing below ten qualifying years — a cliff, not a taper', () => {
		expect(weeklyStatePension(0)).toBe(0);
		expect(weeklyStatePension(9)).toBe(0);
		expect(weeklyStatePension(MINIMUM_QUALIFYING_YEARS)).toBeGreaterThan(0);
	});

	it('pays thirty-fifths between ten and thirty-five years', () => {
		expect(weeklyStatePension(10)).toBe(68.94);
		expect(weeklyStatePension(20)).toBe(137.89);
		expect(weeklyStatePension(34)).toBe(234.41);
	});

	it('pays the full rate at thirty-five years and not a penny more after it', () => {
		expect(weeklyStatePension(QUALIFYING_YEARS_FOR_FULL)).toBe(FULL_STATE_PENSION_WEEKLY);
		expect(weeklyStatePension(40)).toBe(FULL_STATE_PENSION_WEEKLY);
		expect(weeklyStatePension(60)).toBe(FULL_STATE_PENSION_WEEKLY);
	});

	it('reads a missing or nonsense count as no years rather than throwing', () => {
		expect(weeklyStatePension()).toBe(0);
		expect(weeklyStatePension(null)).toBe(0);
		expect(weeklyStatePension('rubbish')).toBe(0);
	});
});

describe('annualStatePension', () => {
	it('is the rounded weekly figure × 52 — convention (1)', () => {
		expect(annualStatePension(QUALIFYING_YEARS_FOR_FULL)).toBe(FULL_STATE_PENSION_ANNUAL);
		expect(annualStatePension(20)).toBe(7_170.28);
		expect(annualStatePension(20)).toBeCloseTo(weeklyStatePension(20) * WEEKS_PER_YEAR, 10);
	});

	it('is zero under the ten-year minimum', () => {
		expect(annualStatePension(9)).toBe(0);
	});
});

describe('statePensionAge', () => {
	it('gives 66 to anyone born before April 1960', () => {
		expect(statePensionAge(1955, 6)).toBe(66);
		expect(statePensionAge(1960, 3)).toBe(66);
	});

	it('gives 67 across the phase-in and the band that follows it', () => {
		expect(statePensionAge(1960, 4)).toBe(67);
		expect(statePensionAge(1961, 1)).toBe(67);
		expect(statePensionAge(1977, 3)).toBe(67);
	});

	it('gives 68 from April 1977, per the Pensions Act 2007 timetable', () => {
		expect(statePensionAge(1977, 4)).toBe(68);
		expect(statePensionAge(1990, 1)).toBe(68);
	});

	it('reads an unknown month as December, landing on the later side of a boundary', () => {
		expect(statePensionAge(1960, null)).toBe(67);
		expect(statePensionAge(1977, null)).toBe(68);
		expect(statePensionAge(1959, null)).toBe(66);
	});

	it('falls back to the default when there is no birth year to look up', () => {
		expect(statePensionAge(null, 4)).toBe(DEFAULT_STATE_PENSION_AGE);
		expect(statePensionAge()).toBe(DEFAULT_STATE_PENSION_AGE);
	});
});

describe('statePensionTiming', () => {
	const now = new Date('2026-08-07T00:00:00Z');

	it('counts the years left to State Pension age off the profile', () => {
		const timing = statePensionTiming(createProfile({ dob_year: 1985, dob_month: 3 }), { now });

		expect(timing.available).toBe(true);
		expect(timing.statePensionAge).toBe(68);
		expect(timing.currentAge).toBe(41);
		expect(timing.calendarYear).toBe(2053);
		expect(timing.yearsRemaining).toBe(27);
		expect(timing.reached).toBe(false);
	});

	it('knocks a year off when this year’s birthday has not arrived yet', () => {
		const before = statePensionTiming(createProfile({ dob_year: 1985, dob_month: 12 }), { now });
		expect(before.currentAge).toBe(40);
		expect(before.yearsRemaining).toBe(28);
	});

	it('stops at zero years remaining once State Pension age is behind the user', () => {
		const timing = statePensionTiming(createProfile({ dob_year: 1950, dob_month: 1 }), { now });

		expect(timing.statePensionAge).toBe(66);
		expect(timing.reached).toBe(true);
		expect(timing.yearsRemaining).toBe(0);
	});

	it('reports itself unavailable, not wrong, when no birth year is recorded', () => {
		const timing = statePensionTiming(createProfile(), { now });

		expect(timing.available).toBe(false);
		expect(timing.currentAge).toBeNull();
		expect(timing.calendarYear).toBeNull();
		expect(timing.yearsRemaining).toBe(0);
		expect(timing.statePensionAge).toBe(DEFAULT_STATE_PENSION_AGE);
	});

	it('takes an override, since the timetable is a plan rather than a fact', () => {
		const profile = createProfile({ dob_year: 1985, dob_month: 3 });
		const timing = statePensionTiming(profile, { now, statePensionAge: 70 });

		expect(timing.overridden).toBe(true);
		expect(timing.statePensionAge).toBe(70);
		expect(timing.yearsRemaining).toBe(29);
	});

	it('ignores an override outside the plausible range, and a missing one', () => {
		const profile = createProfile({ dob_year: 1985, dob_month: 3 });

		expect(statePensionTiming(profile, { now, statePensionAge: 12 }).statePensionAge).toBe(68);
		expect(
			statePensionTiming(profile, { now, statePensionAge: MAX_STATE_PENSION_AGE + 1 })
				.statePensionAge
		).toBe(68);
		expect(statePensionTiming(profile, { now, statePensionAge: null }).overridden).toBe(false);
		expect(
			statePensionTiming(profile, { now, statePensionAge: MIN_STATE_PENSION_AGE }).statePensionAge
		).toBe(MIN_STATE_PENSION_AGE);
	});

	it('falls back to the real clock when handed an unusable one', () => {
		const timing = statePensionTiming(createProfile({ dob_year: 1985 }), {
			now: new Date('nonsense')
		});

		expect(timing.available).toBe(true);
		expect(timing.currentAge).toBeGreaterThan(0);
	});
});

describe('statePensionProjection', () => {
	it('adds the years already earned to the years still expected', () => {
		const projection = statePensionProjection({ qualifyingYears: 20, futureYears: 10 });

		expect(projection.recorded).toBe(true);
		expect(projection.qualifyingYears).toBe(20);
		expect(projection.futureYears).toBe(10);
		expect(projection.totalYears).toBe(30);
		expect(projection.payableYears).toBe(30);
		expect(projection.weeklyIncome).toBe(206.83);
		expect(projection.annualIncome).toBe(10_755.16);
		expect(projection.monthlyIncome).toBe(896.26);
		expect(projection.percentOfFull).toBeCloseTo(85.71, 2);
	});

	it('separates what is already banked from what the plan adds', () => {
		const projection = statePensionProjection({ qualifyingYears: 20, futureYears: 15 });

		expect(projection.currentWeeklyIncome).toBe(137.89);
		expect(projection.currentAnnualIncome).toBe(7_170.28);
		expect(projection.futureUplift).toBe(Number((FULL_STATE_PENSION_ANNUAL - 7_170.28).toFixed(2)));
		expect(projection.full).toBe(true);
		expect(projection.shortfallYears).toBe(0);
	});

	it('names the shortfall to the full rate, and what closing one year of it is worth', () => {
		const projection = statePensionProjection({ qualifyingYears: 25, futureYears: 0 });

		expect(projection.full).toBe(false);
		expect(projection.shortfallYears).toBe(10);
		expect(projection.nextYearValue).toBe(358.28);
	});

	it('buys nothing with a thirty-sixth year, and says so as wasted years', () => {
		const projection = statePensionProjection({ qualifyingYears: 40, futureYears: 5 });

		expect(projection.totalYears).toBe(45);
		expect(projection.payableYears).toBe(QUALIFYING_YEARS_FOR_FULL);
		expect(projection.wastedYears).toBe(10);
		expect(projection.annualIncome).toBe(FULL_STATE_PENSION_ANNUAL);
		expect(projection.nextYearValue).toBe(0);
	});

	it('pays nothing under ten years, and prices the year that crosses the cliff at the lot', () => {
		const projection = statePensionProjection({ qualifyingYears: 9, futureYears: 0 });

		expect(projection.qualifies).toBe(false);
		expect(projection.annualIncome).toBe(0);
		expect(projection.yearsToMinimum).toBe(1);
		expect(projection.nextYearValue).toBe(annualStatePension(MINIMUM_QUALIFYING_YEARS));
	});

	it('values a further year at nothing while the cliff is still more than one year away', () => {
		const projection = statePensionProjection({ qualifyingYears: 8 });

		expect(projection.yearsToMinimum).toBe(2);
		expect(projection.nextYearValue).toBe(0);
	});

	it('clamps the total to the 0–60 range rather than projecting a 70-year record', () => {
		const projection = statePensionProjection({ qualifyingYears: 55, futureYears: 20 });

		expect(projection.totalYears).toBe(MAX_QUALIFYING_YEARS);
		expect(projection.annualIncome).toBe(FULL_STATE_PENSION_ANNUAL);
	});

	it('distinguishes a recorded zero from nothing recorded at all', () => {
		expect(statePensionProjection({ qualifyingYears: 0 }).recorded).toBe(true);
		expect(statePensionProjection({}).recorded).toBe(false);
		expect(statePensionProjection().qualifyingYears).toBe(0);
	});

	it('prices the income as a pot the same way fire.js and defined-benefit.js do', () => {
		const projection = statePensionProjection({ qualifyingYears: 35, withdrawalRate: 3.5 });

		expect(projection.withdrawalRate).toBe(3.5);
		expect(projection.capitalEquivalent).toBe(fireNumber(FULL_STATE_PENSION_ANNUAL, 3.5));
	});

	it('defaults and clamps the withdrawal rate to the range fire.js accepts', () => {
		expect(statePensionProjection({ qualifyingYears: 35 }).withdrawalRate).toBe(4);
		expect(statePensionProjection({ qualifyingYears: 35, withdrawalRate: 0 }).withdrawalRate).toBe(
			0.1
		);
		expect(
			statePensionProjection({ qualifyingYears: 35, withdrawalRate: 500 }).withdrawalRate
		).toBe(100);
	});

	it('takes the numeric strings a form control hands over', () => {
		const projection = statePensionProjection({ qualifyingYears: '20', futureYears: '10' });

		expect(projection.totalYears).toBe(30);
	});
});

describe('isStatePension / findStatePension', () => {
	it('picks the state-type record out of a mixed list', () => {
		const sipp = createPension({ name: 'Vanguard SIPP', type: 'sipp', value: 90_000 });
		const state = statePension();

		expect(isStatePension(state)).toBe(true);
		expect(isStatePension(sipp)).toBe(false);
		expect(isStatePension(null)).toBe(false);
		expect(findStatePension([sipp, state])?.id).toBe(state.id);
	});

	it('returns null when there is no State Pension recorded yet', () => {
		expect(findStatePension([])).toBeNull();
		expect(findStatePension()).toBeNull();
		expect(findStatePension(/** @type {never} */ ('not a list'))).toBeNull();
	});

	it('takes the first of two, since nobody gets two State Pensions — convention (6)', () => {
		const first = statePension({ ni_qualifying_years: 20 });
		const second = statePension({ ni_qualifying_years: 30 });

		expect(findStatePension([first, second])?.id).toBe(first.id);
	});
});

describe('statePensionOutlook', () => {
	const now = new Date('2026-08-07T00:00:00Z');
	const profile = createProfile({ dob_year: 1985, dob_month: 3 });

	it('projects off the state-type record and dates it off the profile', () => {
		const outlook = statePensionOutlook([statePension()], profile, { now });

		expect(outlook.record?.type).toBe('state');
		expect(outlook.projection.totalYears).toBe(30);
		expect(outlook.timing.statePensionAge).toBe(68);
		expect(outlook.unearnableYears).toBe(0);
	});

	it('flags future years there is no longer time to earn', () => {
		const outlook = statePensionOutlook(
			[statePension({ ni_qualifying_years: 30, ni_future_years: 35 })],
			profile,
			{ now }
		);

		// 27 years to State Pension age, 35 planned — eight of them cannot be earned.
		expect(outlook.timing.yearsRemaining).toBe(27);
		expect(outlook.unearnableYears).toBe(8);
	});

	it('does not flag anything when there is no date of birth to check against', () => {
		const outlook = statePensionOutlook([statePension({ ni_future_years: 40 })], createProfile(), {
			now
		});

		expect(outlook.timing.available).toBe(false);
		expect(outlook.unearnableYears).toBe(0);
	});

	it('projects nothing, without throwing, when no State Pension is recorded', () => {
		const outlook = statePensionOutlook([], profile, { now });

		expect(outlook.record).toBeNull();
		expect(outlook.projection.recorded).toBe(false);
		expect(outlook.projection.annualIncome).toBe(0);
	});

	it('passes the withdrawal rate through to the capital equivalent', () => {
		const outlook = statePensionOutlook([statePension({ ni_future_years: 15 })], profile, {
			now,
			withdrawalRate: 3
		});

		expect(outlook.projection.capitalEquivalent).toBe(fireNumber(FULL_STATE_PENSION_ANNUAL, 3));
	});
});
