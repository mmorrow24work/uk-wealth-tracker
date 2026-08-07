/**
 * UK new State Pension projected from National Insurance qualifying years — README.md → "Pension
 * Tracker": "UK State Pension projection from NI qualifying years (35 years for full £241.30/week
 * 2026/27)" — issue #31.
 *
 * The State Pension is the one "pension" in this app with no pot behind it. Nothing compounds, no
 * fund fee erodes it and no contribution percentage feeds it: entitlement is a count of *qualifying
 * years* on your National Insurance record, and the payment is a fraction of one nationally-set
 * weekly rate. So this module takes years in and gives pounds out, and shares no arithmetic with
 * `fire.js`/`forecast.js` at all.
 *
 * Four rules decide every figure here:
 *
 * 1. **35 qualifying years buys the full rate; fewer buys a proportional share of it.** The weekly
 *    payment is `full × years / 35` — README.md's own headline rule. Years beyond the 35th add
 *    nothing, so the count is capped before the fraction is taken.
 * 2. **Below 10 qualifying years the entitlement is zero, not a small number.** This is a genuine
 *    cliff rather than a taper: 9 years pays nothing at all, 10 years pays 10/35ths of the full
 *    rate in one step. {@link valueOfOneMoreYearWeekly} is therefore computed as the *difference
 *    between two projections* rather than as a flat 1/35th, so it reports that jump honestly.
 * 3. **The weekly rate is the quoted figure; annual and monthly are derived from it.** gov.uk
 *    states the State Pension per week, so {@link weeklyStatePension} rounds to the penny first and
 *    {@link annualStatePension} multiplies that rounded figure by 52. Deriving annual from the
 *    unrounded weekly instead would put every yearly total a few pence away from 52 payments of
 *    what the user was actually quoted. (The State Pension is really paid every four weeks, i.e.
 *    13 payments a year; 52 × weekly is still the conventional annual figure and the one every
 *    other module on this app's retirement side wants.)
 * 4. **Everything is in today's money, like the rest of the app.** The triple lock uprates the
 *    weekly rate every April; none of that is projected forward here, so a 2026/27 rate applied to
 *    a pension starting in 2059 is a real-terms estimate, not a nominal one — the same convention
 *    `fire.js` and `forecast.js` state for pot projections.
 *
 * **What this deliberately does not model.** Anyone with National Insurance years before April 2016
 * has a "starting amount" under the transitional rules — the higher of what the old basic-plus-
 * additional State Pension rules would have paid and what the new rules pay, the latter reduced by a
 * Contracted Out Pension Equivalent (COPE) deduction if they were ever contracted out of SERPS/S2P
 * through a workplace scheme. That can put a real entitlement either side of the straight 35ths
 * arithmetic below, and it cannot be derived from a year count alone — it needs the actual NI record.
 * The 35ths formula is exactly right for a record that starts in 2016/17 or later and a good
 * approximation otherwise, which is why every surface built on this module points the user at their
 * own forecast at gov.uk/check-state-pension rather than presenting these numbers as an entitlement.
 * Deferral (which uprates the new State Pension by 1% per 9 weeks deferred) and voluntary Class 3
 * contributions (which can buy missing years, at a cost this module has no rate for) are both
 * out of scope too.
 *
 * Money is rounded to whole pence, percentages are whole-number percents, and everything is pure.
 */

import { createPension } from './model.js';
import { PERSONAL_ALLOWANCE } from './tax.js';

/*
 * As in `student-loan.js`/`hicbc.js`, model types are referenced inline as `import('./types.js').X`
 * rather than re-declared as local `@typedef`s: `index.js` re-exports every module with `export *`,
 * and svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The tax year and its rates                                                  */
/* -------------------------------------------------------------------------- */

/** The tax year every figure in this module belongs to — matches `tax.js`'s `TAX_YEAR`. */
export const STATE_PENSION_TAX_YEAR = '2026/27';

/**
 * The full new State Pension, £ per week — README.md's stated 2026/27 figure. Quoted weekly because
 * that is how gov.uk quotes it; rule (3) makes everything else follow from this one number.
 */
export const FULL_STATE_PENSION_WEEKLY = 241.3;

/** Weeks the annual figure is built from — rule (3). */
export const WEEKS_PER_STATE_PENSION_YEAR = 52;

/** Qualifying years that buy the full rate — rule (1). */
export const QUALIFYING_YEARS_FOR_FULL = 35;

/** Qualifying years below which nothing at all is payable — rule (2). */
export const MINIMUM_QUALIFYING_YEARS = 10;

/**
 * Upper bound accepted for a year count. Matches `validateAppData`'s own 0–60 range for
 * `ni_qualifying_years`/`ni_future_years`: a working life longer than 60 NI years is a typo, and
 * anything past 35 is inert anyway.
 */
export const MAX_QUALIFYING_YEARS = 60;

/** The full new State Pension, £ per year — rule (3): the weekly rate × 52. */
export const FULL_STATE_PENSION_ANNUAL = round(
	FULL_STATE_PENSION_WEEKLY * WEEKS_PER_STATE_PENSION_YEAR
);

/* -------------------------------------------------------------------------- */
/* State Pension age                                                           */
/* -------------------------------------------------------------------------- */

/**
 * State Pension age by date of birth, as currently legislated (Pensions Act 2007/2014 timetable):
 * 66 for anyone born before 6 April 1960, 67 for 6 April 1960 to 5 April 1977, and 68 from 6 April
 * 1977 onwards.
 *
 * Two simplifications, both forced by the data model storing only a birth *month and year* (see
 * `Profile.dob_month`/`dob_year` — deliberately less personal data than a full date of birth):
 *
 * - The 6th-of-April boundary cannot be resolved from a month alone, so April is treated as falling
 *   on or after the 6th. Someone born in the first five days of April 1960 or April 1977 gets the
 *   later tier here and the earlier one in law.
 * - The rise from 66 to 67 was phased in monthly across births from 6 April 1960 to 5 March 1961
 *   (a birthday in that window gives a State Pension age between 66 and 67); this collapses that
 *   window to a flat 67.
 *
 * The 68 tier is legislated but has been repeatedly reviewed, so treat a projection that far out as
 * the most provisional number on the page.
 *
 * @param {number | null} [dobYear] Four-digit birth year, or null if not recorded.
 * @param {number | null} [dobMonth] Birth month, 1–12, or null.
 * @returns {number | null} State Pension age in whole years, or null when the birth year is unknown.
 */
export function statePensionAge(dobYear = null, dobMonth = null) {
	if (dobYear === null || !Number.isFinite(dobYear)) return null;
	const month = Number.isFinite(dobMonth) ? Number(dobMonth) : 1;
	// "On or after 6 April Y" ≈ month >= April, per the simplification above.
	const onOrAfterApril = month >= 4;
	/** @param {number} year @returns {boolean} Born on or after 6 April of `year`. */
	const reached = (year) => dobYear > year || (dobYear === year && onOrAfterApril);

	if (reached(1977)) return 68;
	if (reached(1960)) return 67;
	return 66;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function round(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * Coerce anything into a usable year count: finite, non-negative, no more than
 * {@link MAX_QUALIFYING_YEARS}. Fractional years survive — a partial year on an NI record is a real
 * thing, even though HMRC only ever credits whole ones.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function normaliseYears(value) {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) return 0;
	return Math.min(MAX_QUALIFYING_YEARS, Math.max(0, parsed));
}

/**
 * The years that actually count towards the payment — rule (1)'s cap at 35.
 *
 * @param {unknown} [years]
 * @returns {number}
 */
export function countingYears(years = 0) {
	return Math.min(QUALIFYING_YEARS_FOR_FULL, normaliseYears(years));
}

/**
 * Whether a year count clears rule (2)'s 10-year floor.
 *
 * @param {unknown} [years]
 * @returns {boolean}
 */
export function meetsMinimumYears(years = 0) {
	return normaliseYears(years) >= MINIMUM_QUALIFYING_YEARS;
}

/* -------------------------------------------------------------------------- */
/* The projection itself                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Weekly new State Pension for a given number of qualifying years (£/week) — rules (1) and (2)
 * together: zero below 10 years, `full × years / 35` from 10 to 35, flat at the full rate above.
 *
 * @param {unknown} [years]
 * @returns {number} (£/week)
 */
export function weeklyStatePension(years = 0) {
	if (!meetsMinimumYears(years)) return 0;
	return round((FULL_STATE_PENSION_WEEKLY * countingYears(years)) / QUALIFYING_YEARS_FOR_FULL);
}

/**
 * Annual new State Pension for a given number of qualifying years (£/yr) — rule (3): 52 × the
 * rounded weekly figure, not 52 × the exact one.
 *
 * @param {unknown} [years]
 * @returns {number} (£/yr)
 */
export function annualStatePension(years = 0) {
	return round(weeklyStatePension(years) * WEEKS_PER_STATE_PENSION_YEAR);
}

/**
 * Monthly new State Pension for a given number of qualifying years (£/month) — a twelfth of the
 * annual figure. Presentational only: the State Pension is actually paid every four weeks.
 *
 * @param {unknown} [years]
 * @returns {number} (£/month)
 */
export function monthlyStatePension(years = 0) {
	return round(annualStatePension(years) / 12);
}

/**
 * What one further qualifying year is worth on top of the years already held (£/week) — rule (2)'s
 * reason for computing this as a difference rather than as a flat 1/35th of the full rate. Below the
 * 10-year floor it is zero (a 6th year buys nothing); the year that *reaches* 10 is worth ten
 * thirty-fifths of the full rate in one step; past 35 it is zero again.
 *
 * @param {unknown} [years]
 * @returns {number} (£/week)
 */
export function valueOfOneMoreYearWeekly(years = 0) {
	return round(weeklyStatePension(normaliseYears(years) + 1) - weeklyStatePension(years));
}

/**
 * As {@link valueOfOneMoreYearWeekly}, annualised (£/yr).
 *
 * @param {unknown} [years]
 * @returns {number} (£/yr)
 */
export function valueOfOneMoreYearAnnual(years = 0) {
	return round(annualStatePension(normaliseYears(years) + 1) - annualStatePension(years));
}

/* -------------------------------------------------------------------------- */
/* The whole summary                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Everything the State Pension panel's controls describe.
 *
 * @typedef {object} StatePensionInput
 * @property {number} qualifyingYears NI years already earned, from the user's gov.uk record.
 * @property {number} futureYears Further qualifying years expected before State Pension age.
 * @property {number | null} dobYear Birth year, for the State Pension age figures. Optional.
 * @property {number | null} dobMonth Birth month, 1–12. Optional.
 * @property {Date} today Reference date for "how many years until then". Defaults to now; injected
 *   by tests so the age arithmetic is deterministic.
 */

/**
 * One row of the "what each year count pays" ladder — the projection at a single number of years.
 *
 * @typedef {object} StatePensionPoint
 * @property {number} years
 * @property {number} weekly (£/week)
 * @property {number} annual (£/yr)
 * @property {number} pctOfFull (%) — share of the full rate, 0–100.
 */

/**
 * A full State Pension projection — README.md's "UK State Pension projection from NI qualifying
 * years".
 *
 * @typedef {object} StatePensionProjection
 * @property {string} taxYear Always {@link STATE_PENSION_TAX_YEAR}.
 * @property {number} qualifyingYears Years already earned, as given (clamped to 0–60).
 * @property {number} futureYears Further years expected, as given (clamped to 0–60).
 * @property {number} totalYears The two summed, clamped to 0–60 — what the projection is worked on.
 * @property {number} countingYears The part of `totalYears` that actually pays, capped at 35.
 * @property {number} wastedYears Years past the 35th, which add nothing.
 * @property {boolean} meetsMinimum Whether `totalYears` clears the 10-year floor.
 * @property {boolean} reachesFull Whether `totalYears` reaches 35.
 * @property {number} yearsToMinimum Further years needed to be paid anything at all; `0` once clear.
 * @property {number} yearsToFull Further years needed for the full rate; `0` once there.
 * @property {number} weekly Projected payment (£/week) on `totalYears`.
 * @property {number} monthly Projected payment (£/month).
 * @property {number} annual Projected payment (£/yr).
 * @property {number} pctOfFull Share of the full rate the projection pays (%), 0–100.
 * @property {number} shortfallWeekly Full rate less the projection (£/week); `0` at 35 years.
 * @property {number} shortfallAnnual The same, annualised (£/yr).
 * @property {number} weeklyIfNoMoreYears What `qualifyingYears` alone pays (£/week) — the "if I
 *   stopped paying National Insurance today" figure.
 * @property {number} annualIfNoMoreYears The same, annualised (£/yr).
 * @property {number} valueOfOneMoreYearWeekly What a 1-year improvement on `totalYears` adds
 *   (£/week) — rule (2)'s step at the 10-year floor, `0` once at 35.
 * @property {number} valueOfOneMoreYearAnnual The same, annualised (£/yr).
 * @property {number} valueOfReachingMinimumWeekly What clearing the 10-year floor altogether would
 *   add (£/week) — the whole 10/35ths, since rule (2) pays nothing below it. `0` once clear. This is
 *   the honest headline for a thin record, where `valueOfOneMoreYearWeekly` is legitimately zero
 *   because a single year short of the floor still buys nothing.
 * @property {number} valueOfReachingMinimumAnnual The same, annualised (£/yr).
 * @property {number} fullWeekly {@link FULL_STATE_PENSION_WEEKLY}, for display alongside.
 * @property {number} fullAnnual {@link FULL_STATE_PENSION_ANNUAL}.
 * @property {number | null} statePensionAge Age the projection starts being paid, or null with no
 *   birth year recorded.
 * @property {number | null} statePensionYear Calendar year that age is reached, or null.
 * @property {number | null} currentAge Age at `today`, or null.
 * @property {number | null} yearsToStatePensionAge Whole-ish years until then (never negative), or
 *   null. Already past it reads `0`.
 * @property {number | null} maxFutureYears The most further qualifying years reachable before State
 *   Pension age — `yearsToStatePensionAge`, since NI years accrue one per year — or null without a
 *   birth year. The panel offers this as the "fill it in for me" figure.
 * @property {boolean} futureYearsExceedWorkingLife Whether `futureYears` claims more years than
 *   there is time left to earn them. Always false with no birth year to check against.
 * @property {number} personalAllowance `tax.js`'s allowance, for the taxability note (£/yr).
 * @property {number} allowanceHeadroom Allowance left over after the projected State Pension
 *   (£/yr); `0` once the pension alone exceeds it. The State Pension is taxable but paid gross, so
 *   this is how much other retirement income lands tax-free on top.
 * @property {boolean} exceedsPersonalAllowance Whether the projection alone uses up the allowance.
 * @property {StatePensionPoint[]} ladder The projection at today's years, at the projected total,
 *   at the 10-year floor and at the full 35 — the comparison table the panel renders. Deduplicated
 *   and ordered by year count.
 */

/**
 * The State Pension panel's single entry point: a count of qualifying years earned, a count expected
 * to come, and (optionally) a date of birth for the "from what age, in what year" figures — every
 * number the panel shows, out.
 *
 * @param {Partial<StatePensionInput>} [raw]
 * @returns {StatePensionProjection}
 */
export function statePensionProjection(raw = {}) {
	const qualifyingYears = normaliseYears(raw.qualifyingYears);
	const futureYears = normaliseYears(raw.futureYears);
	const totalYears = normaliseYears(qualifyingYears + futureYears);

	const counting = countingYears(totalYears);
	const weekly = weeklyStatePension(totalYears);
	const annual = annualStatePension(totalYears);

	const dobYear = asNullableYear(raw.dobYear);
	const dobMonth = asNullableYear(raw.dobMonth);
	const spa = statePensionAge(dobYear, dobMonth);
	const today =
		raw.today instanceof Date && !Number.isNaN(raw.today.getTime()) ? raw.today : new Date();
	const currentAge = dobYear === null ? null : ageAt(dobYear, dobMonth, today);
	const yearsToSpa =
		spa === null || currentAge === null ? null : Math.max(0, round(spa - currentAge));

	const allowanceHeadroom = round(Math.max(0, PERSONAL_ALLOWANCE - annual));

	return {
		taxYear: STATE_PENSION_TAX_YEAR,
		qualifyingYears,
		futureYears,
		totalYears,
		countingYears: counting,
		wastedYears: round(Math.max(0, totalYears - QUALIFYING_YEARS_FOR_FULL)),
		meetsMinimum: meetsMinimumYears(totalYears),
		reachesFull: totalYears >= QUALIFYING_YEARS_FOR_FULL,
		yearsToMinimum: round(Math.max(0, MINIMUM_QUALIFYING_YEARS - totalYears)),
		yearsToFull: round(Math.max(0, QUALIFYING_YEARS_FOR_FULL - totalYears)),
		weekly,
		monthly: monthlyStatePension(totalYears),
		annual,
		pctOfFull: round((weekly / FULL_STATE_PENSION_WEEKLY) * 100),
		shortfallWeekly: round(Math.max(0, FULL_STATE_PENSION_WEEKLY - weekly)),
		shortfallAnnual: round(Math.max(0, FULL_STATE_PENSION_ANNUAL - annual)),
		weeklyIfNoMoreYears: weeklyStatePension(qualifyingYears),
		annualIfNoMoreYears: annualStatePension(qualifyingYears),
		valueOfOneMoreYearWeekly: valueOfOneMoreYearWeekly(totalYears),
		valueOfOneMoreYearAnnual: valueOfOneMoreYearAnnual(totalYears),
		valueOfReachingMinimumWeekly: round(
			Math.max(0, weeklyStatePension(MINIMUM_QUALIFYING_YEARS) - weekly)
		),
		valueOfReachingMinimumAnnual: round(
			Math.max(0, annualStatePension(MINIMUM_QUALIFYING_YEARS) - annual)
		),
		fullWeekly: FULL_STATE_PENSION_WEEKLY,
		fullAnnual: FULL_STATE_PENSION_ANNUAL,
		statePensionAge: spa,
		statePensionYear: dobYear === null || spa === null ? null : dobYear + spa,
		currentAge,
		yearsToStatePensionAge: yearsToSpa,
		maxFutureYears: yearsToSpa,
		futureYearsExceedWorkingLife: yearsToSpa !== null && futureYears > yearsToSpa,
		personalAllowance: PERSONAL_ALLOWANCE,
		allowanceHeadroom,
		exceedsPersonalAllowance: annual > PERSONAL_ALLOWANCE,
		ladder: buildLadder(qualifyingYears, totalYears)
	};
}

/**
 * The comparison rows the panel shows under the headline: where the user is now, where they are
 * heading, the 10-year floor and the full 35. Duplicates collapse (someone already at 35 gets one
 * row for it, not two) and the rows come back in year order.
 *
 * @param {number} qualifyingYears
 * @param {number} totalYears
 * @returns {StatePensionPoint[]}
 */
function buildLadder(qualifyingYears, totalYears) {
	const years = [qualifyingYears, totalYears, MINIMUM_QUALIFYING_YEARS, QUALIFYING_YEARS_FOR_FULL];
	/** @type {number[]} */
	const unique = [];
	for (const year of years) {
		const value = normaliseYears(year);
		if (!unique.includes(value)) unique.push(value);
	}

	return unique
		.sort((a, b) => a - b)
		.map((year) => ({
			years: year,
			weekly: weeklyStatePension(year),
			annual: annualStatePension(year),
			pctOfFull: round((weeklyStatePension(year) / FULL_STATE_PENSION_WEEKLY) * 100)
		}));
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asNullableYear(value) {
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Age in whole years at a reference date, from a birth month and year. An unrecorded month is read
 * as January, which is the same "assume the earliest point in the year" reading `statePensionAge`
 * takes — it makes the age a touch generous rather than a touch short.
 *
 * @param {number} dobYear
 * @param {number | null} dobMonth
 * @param {Date} today
 * @returns {number}
 */
function ageAt(dobYear, dobMonth, today) {
	const month = dobMonth === null || !Number.isFinite(dobMonth) ? 1 : Number(dobMonth);
	const months = (today.getFullYear() - dobYear) * 12 + (today.getMonth() + 1 - month);
	return Math.max(0, Math.floor(months / 12));
}

/* -------------------------------------------------------------------------- */
/* The State Pension record inside `pensions[]`                                */
/* -------------------------------------------------------------------------- */

/**
 * The name a State Pension record is stored under. Unlike a private pot there is no provider to
 * name, but `Pension.name` is what every list in the app renders, so it gets a fixed one.
 */
export const STATE_PENSION_NAME = 'State Pension';

/**
 * Whether a pension record is the State Pension rather than a pot. `PensionTracker`'s pot list uses
 * the inverse of this to keep the State Pension out of a form built for pot values.
 *
 * @param {Pick<import('./types.js').Pension, 'type'>} pension
 * @returns {boolean}
 */
export function isStatePension(pension) {
	return pension?.type === 'state';
}

/**
 * The State Pension record in a `pensions[]` list, or null if the user has not entered NI years yet.
 * Only one can meaningfully exist — there is one National Insurance record per person — so the first
 * match wins and {@link setStatePensionYears} never adds a second.
 *
 * @param {readonly import('./types.js').Pension[]} [pensions]
 * @returns {import('./types.js').Pension | null}
 */
export function findStatePension(pensions = []) {
	return pensions.find(isStatePension) ?? null;
}

/**
 * Every pension record that is a pot rather than the State Pension, in the original order.
 *
 * @param {readonly import('./types.js').Pension[]} [pensions]
 * @returns {import('./types.js').Pension[]}
 */
export function potPensions(pensions = []) {
	return pensions.filter((pension) => !isStatePension(pension));
}

/**
 * Write NI year counts onto the State Pension record, creating it if this is the first time the user
 * has entered any. Returns a new array — the store's `appData.update` and Svelte's `$bindable`
 * props both want a fresh reference, and nothing in the app mutates a record in place.
 *
 * @param {readonly import('./types.js').Pension[]} [pensions]
 * @param {{ ni_qualifying_years?: number | null, ni_future_years?: number | null }} [patch]
 * @returns {import('./types.js').Pension[]}
 */
export function setStatePensionYears(pensions = [], patch = {}) {
	const existing = findStatePension(pensions);
	if (existing) {
		return pensions.map((pension) => (pension === existing ? { ...pension, ...patch } : pension));
	}

	return [
		...pensions,
		createPension({
			name: STATE_PENSION_NAME,
			type: 'state',
			ni_qualifying_years: 0,
			ni_future_years: 0,
			...patch
		})
	];
}

/**
 * Drop the State Pension record, leaving every pot untouched. The panel's "clear" action — the same
 * thing as never having entered NI years.
 *
 * @param {readonly import('./types.js').Pension[]} [pensions]
 * @returns {import('./types.js').Pension[]}
 */
export function removeStatePension(pensions = []) {
	return potPensions(pensions);
}

/**
 * Run {@link statePensionProjection} straight off stored data — the shape the pensions tab actually
 * has to hand. Missing NI fields read as zero, so a document with no State Pension record projects
 * a zero pension rather than throwing.
 *
 * @param {readonly import('./types.js').Pension[]} [pensions]
 * @param {Pick<import('./types.js').Profile, 'dob_month' | 'dob_year'> | null} [profile]
 * @param {Date} [today]
 * @returns {StatePensionProjection}
 */
export function statePensionFromData(pensions = [], profile = null, today = undefined) {
	const record = findStatePension(pensions);
	return statePensionProjection({
		qualifyingYears: record?.ni_qualifying_years ?? 0,
		futureYears: record?.ni_future_years ?? 0,
		dobYear: profile?.dob_year ?? null,
		dobMonth: profile?.dob_month ?? null,
		today
	});
}
