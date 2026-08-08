/**
 * UK State Pension projection from National Insurance qualifying years — README.md → "Pension
 * Tracker": "UK State Pension projection from NI qualifying years (35 years for full £241.30/week
 * 2026/27)" — issue #31.
 *
 * The State Pension is the one pension in this app with no pot and no employer: what it pays is a
 * function of a single count, the number of National Insurance *qualifying* years on the member's
 * record. The new State Pension's rule, in full:
 *
 * ```text
 * fewer than 10 qualifying years  → nothing at all
 * 10 to 34 qualifying years       → £241.30 × years ÷ 35 a week
 * 35 or more qualifying years     → £241.30 a week, and no more for extra years
 * ```
 *
 * A qualifying year is a tax year in which enough National Insurance was paid or credited — it is
 * a yes/no per tax year, not a proportion, which is why every count here is a whole number. Credits
 * count the same as contributions: years on Child Benefit for a child under 12, on certain
 * benefits, or as a carer are qualifying years without a penny of NI being paid, which is why the
 * count on a member's HMRC record is routinely higher than the number of years they were employed.
 * The figure to enter is the one on the "Check your State Pension forecast" service, not a guess
 * from a CV.
 *
 * Seven conventions decide what the numbers here mean:
 *
 * 1. **Weekly is the canonical figure; annual is derived from it.** DWP quotes and uprates the
 *    State Pension per week, so {@link FULL_STATE_PENSION_WEEKLY} is the stated constant and the
 *    annual figure is the *rounded* weekly one × {@link WEEKS_PER_YEAR}. Rounding first is
 *    deliberate: it makes the annual figure the one a user gets by multiplying the weekly figure on
 *    screen, rather than one a penny or two off it for no visible reason.
 * 2. **Qualifying years are whole years, floored.** `12.7` years on a record is not a thing; a
 *    fractional input is a mistyped one, and flooring is the answer that never overstates.
 * 3. **Zero is a real answer, `null` means "not told yet".** This is `types.js`'s own rule rather
 *    than `defined-benefit.js`'s convention (2): a twenty-year-old with no NI record genuinely has
 *    0 qualifying years, and that is worth stating on screen, whereas 0 accrual on a DB scheme is
 *    always a blank box. So {@link asQualifyingYears} keeps a recorded `0` and only returns `null`
 *    for a blank, missing or unparseable input.
 * 4. **Counts are capped at {@link MAX_QUALIFYING_YEARS}**, the same 0–60 range `model.js`
 *    validates `ni_qualifying_years`/`ni_future_years` against, and the payable count is capped at
 *    {@link QUALIFYING_YEARS_FOR_FULL} on top of that — the 36th year buys nothing.
 * 5. **Today's money, at today's rate.** Every figure is in 2026/27 pounds with no uprating
 *    applied, so a projection for someone 30 years from State Pension age is what the pension would
 *    be worth *now* — the same nominal-vs-real convention `fire.js` and `defined-benefit.js`
 *    document. The triple lock has raised the State Pension by more than inflation in most recent
 *    years, so this is, if anything, the pessimistic reading.
 * 6. **One person, one State Pension.** `ni_qualifying_years` lives on `Pension` (README.md's data
 *    model outline puts it there), but National Insurance is a fact about the *person*, not about
 *    any one pot. So the app keeps a single `type: 'state'` record and {@link findStatePension}
 *    reads the first one; a second would be double-counting a pension nobody gets twice.
 * 7. **Everything is pure, and every money figure is rounded to whole pence**, matching `tax.js`,
 *    `salary-sacrifice.js` and `defined-benefit.js`.
 *
 * **What this deliberately does not model.** The largest omission by far is the transitional
 * "starting amount" for anyone with a National Insurance record from before 6 April 2016: their
 * pension is the *higher* of what the old basic-plus-additional (SERPS/S2P) rules give and what the
 * new 35ths rule gives, and where the old rules give more, the excess is kept as a protected
 * payment on top of the full rate. Someone contracted out of the additional State Pension into a
 * workplace scheme has a Contracted Out Pension Equivalent deduction pulling the other way, so
 * their starting amount can be *below* 35ths and they can need more than 35 years. Neither is
 * derivable from a single count of qualifying years, neither has a field in `Pension` to hold it,
 * and README.md specifies the 35ths rule — so 35ths is what this implements, and the forecast from
 * gov.uk is the figure that overrides it in real life. Also unmodelled: uprating (the triple lock);
 * deferral, which adds about 5.8% a year to the pension for each year it is not claimed; voluntary
 * Class 3 contributions, which can buy back missing years for a price this app does not carry a
 * constant for; the old basic State Pension for anyone who reached State Pension age before 6 April
 * 2016; and income tax, which the State Pension is liable to as earned income while being paid
 * without any deducted.
 *
 * The module imports from `enums.js`, `fire.js` and `milestones.js` and nothing goes the other way,
 * the same one-directional shape `defined-benefit.js` has with `fire.js`.
 */

import {
	DEFAULT_WITHDRAWAL_RATE,
	MAX_WITHDRAWAL_RATE,
	MIN_WITHDRAWAL_RATE,
	fireNumber
} from './fire.js';
import { ageAtPoint } from './milestones.js';

/*
 * As in `tax.js`/`defined-benefit.js`, model types are referenced inline as
 * `import('./types.js').X` rather than re-declared as local `@typedef`s, because `index.js`
 * re-exports every module with `export *` and svelte-check reads two same-named top-level typedefs
 * as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The 2026/27 figures                                                         */
/* -------------------------------------------------------------------------- */

/** The tax year every figure in this module belongs to, matching `$lib/tax.js`'s `TAX_YEAR`. */
export const STATE_PENSION_TAX_YEAR = '2026/27';

/** The full new State Pension (£/week, {@link STATE_PENSION_TAX_YEAR}) — README.md's figure. */
export const FULL_STATE_PENSION_WEEKLY = 241.3;

/**
 * Weeks the annual figure is built from — 52, which is how DWP itself annualises a weekly rate.
 * A calendar year is 52.18 weeks, so this is a touch under a literal year's worth; it is the
 * published convention and matching it keeps the figure here equal to the one on a forecast.
 */
export const WEEKS_PER_YEAR = 52;

/** Qualifying years for the full rate — README.md's 35. */
export const QUALIFYING_YEARS_FOR_FULL = 35;

/** Qualifying years below which the new State Pension pays nothing at all. */
export const MINIMUM_QUALIFYING_YEARS = 10;

/** The ceiling on a recorded count — the same 0–60 range `model.js` validates the `ni_*` fields to. */
export const MAX_QUALIFYING_YEARS = 60;

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/** The full rate as an annual figure (£/yr) — convention (1): the weekly rate × 52. */
export const FULL_STATE_PENSION_ANNUAL = roundMoney(FULL_STATE_PENSION_WEEKLY * WEEKS_PER_YEAR);

/**
 * What one qualifying year is worth (£/week) — a thirty-fifth of the full rate, and the figure
 * behind "one more year is worth £x a year to you". Zero once 35 years are already banked.
 */
export const QUALIFYING_YEAR_WEEKLY_VALUE = roundMoney(
	FULL_STATE_PENSION_WEEKLY / QUALIFYING_YEARS_FOR_FULL
);

/** The same, annualised (£/yr). */
export const QUALIFYING_YEAR_ANNUAL_VALUE = roundMoney(
	QUALIFYING_YEAR_WEEKLY_VALUE * WEEKS_PER_YEAR
);

/* -------------------------------------------------------------------------- */
/* Reading a count                                                             */
/* -------------------------------------------------------------------------- */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asFinite(value, fallback) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A count of qualifying years as this module reads it — convention (2) and (3). Whole years,
 * floored, clamped to `0`…{@link MAX_QUALIFYING_YEARS}; `null` only when nothing was recorded.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function asQualifyingYears(value) {
	if (value === null || value === undefined) return null;
	const parsed =
		typeof value === 'string' ? (value.trim() === '' ? Number.NaN : Number(value)) : value;
	const years = asFinite(parsed, Number.NaN);
	if (!Number.isFinite(years)) return null;

	return Math.min(Math.max(Math.floor(years), 0), MAX_QUALIFYING_YEARS);
}

/**
 * As {@link asQualifyingYears}, but "not recorded" reads as zero — for arithmetic.
 *
 * @param {unknown} value
 * @returns {number}
 */
function countedYears(value) {
	return asQualifyingYears(value) ?? 0;
}

/**
 * The weekly State Pension a given number of qualifying years buys (£/week) — the whole rule from
 * this module's header, in one function.
 *
 * @param {unknown} [qualifyingYears] Total qualifying years at State Pension age.
 * @returns {number} (£/week) `0` below {@link MINIMUM_QUALIFYING_YEARS}.
 */
export function weeklyStatePension(qualifyingYears = 0) {
	const years = countedYears(qualifyingYears);
	if (years < MINIMUM_QUALIFYING_YEARS) return 0;

	const payable = Math.min(years, QUALIFYING_YEARS_FOR_FULL);
	return roundMoney((FULL_STATE_PENSION_WEEKLY * payable) / QUALIFYING_YEARS_FOR_FULL);
}

/**
 * The same figure as an annual one (£/yr) — convention (1): the rounded weekly figure × 52.
 *
 * @param {unknown} [qualifyingYears]
 * @returns {number} (£/yr)
 */
export function annualStatePension(qualifyingYears = 0) {
	return roundMoney(weeklyStatePension(qualifyingYears) * WEEKS_PER_YEAR);
}

/* -------------------------------------------------------------------------- */
/* State Pension age                                                           */
/* -------------------------------------------------------------------------- */

/**
 * State Pension age by date of birth, under the timetable legislated as at
 * {@link STATE_PENSION_TAX_YEAR} — the Pensions Act 2014 for the rise to 67 and the Pensions Act
 * 2007 for the rise to 68.
 *
 * Each band gives the age for anyone born *before* `bornBefore` and on or after the previous band's
 * boundary. `bornBefore: null` is the open-ended last band.
 *
 * Two simplifications, both erring later rather than earlier (convention: never promise the pension
 * sooner than it might arrive). The rise from 66 to 67 is phased across birthdays from 6 April 1960
 * to 5 March 1961, giving those people a State Pension age somewhere between the two; this table
 * gives them 67. And `Profile` stores a birth month, not a birth date, so a birthday in a boundary
 * month is treated as falling on the later side of it.
 *
 * This timetable is reviewed by government roughly every six years and has been changed before, so
 * treat a date decades out as an assumption rather than a promise — which is why every entry point
 * here takes an explicit override.
 *
 * @type {readonly { bornBefore: { year: number, month: number } | null, age: number }[]}
 */
export const STATE_PENSION_AGE_BANDS = Object.freeze([
	{ bornBefore: Object.freeze({ year: 1960, month: 4 }), age: 66 },
	{ bornBefore: Object.freeze({ year: 1977, month: 4 }), age: 67 },
	{ bornBefore: null, age: 68 }
]);

/**
 * State Pension age for anyone not covered by a band above — and `model.js`'s own default
 * `retirement_age`, which is 67 for the same reason.
 */
export const DEFAULT_STATE_PENSION_AGE = 67;

/**
 * State Pension age for a given birth month and year, per {@link STATE_PENSION_AGE_BANDS}.
 *
 * @param {number | null} [dobYear] Four-digit birth year. `null` gives
 *   {@link DEFAULT_STATE_PENSION_AGE} — there is nothing to look up.
 * @param {number | null} [dobMonth] Birth month, 1–12. Unknown reads as December, so an unknown
 *   month lands on the later side of a boundary year.
 * @returns {number} Age in whole years.
 */
export function statePensionAge(dobYear = null, dobMonth = null) {
	const year = asFinite(dobYear, Number.NaN);
	if (!Number.isFinite(year)) return DEFAULT_STATE_PENSION_AGE;
	const month = Math.min(Math.max(Math.round(asFinite(dobMonth, 12)), 1), 12);

	for (const band of STATE_PENSION_AGE_BANDS) {
		if (band.bornBefore === null) return band.age;
		const { year: boundaryYear, month: boundaryMonth } = band.bornBefore;
		if (year < boundaryYear || (year === boundaryYear && month < boundaryMonth)) return band.age;
	}
	return DEFAULT_STATE_PENSION_AGE;
}

/**
 * The lowest and highest State Pension age this module will accept as an override — wide enough for
 * every age the timetable has ever specified or been proposed to, narrow enough that a typo lands
 * outside it and is ignored rather than silently believed.
 */
export const MIN_STATE_PENSION_AGE = 55;
export const MAX_STATE_PENSION_AGE = 80;

/**
 * An overridden State Pension age, or `null` for "not overridden" — which is what anything outside
 * {@link MIN_STATE_PENSION_AGE}…{@link MAX_STATE_PENSION_AGE} reads as, along with a blank or
 * unparseable input.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function asStatePensionAge(value) {
	if (value === null || value === undefined) return null;
	const parsed =
		typeof value === 'string' ? (value.trim() === '' ? Number.NaN : Number(value)) : value;
	const age = Math.round(asFinite(parsed, Number.NaN));
	if (!Number.isFinite(age) || age < MIN_STATE_PENSION_AGE || age > MAX_STATE_PENSION_AGE) {
		return null;
	}
	return age;
}

/**
 * When the State Pension starts, and how much more National Insurance there is time to build.
 *
 * @typedef {object} StatePensionTiming
 * @property {boolean} available `false` when `profile.dob_year` is not recorded — there is no age
 *   to count from, so every figure below is the default assumption rather than this user's.
 * @property {number} statePensionAge The age it starts (years).
 * @property {boolean} overridden Whether `statePensionAge` came from the caller rather than from
 *   {@link STATE_PENSION_AGE_BANDS}.
 * @property {number | null} currentAge Age now, in whole years, or `null` when unavailable.
 * @property {number | null} calendarYear The calendar year State Pension age is reached, or `null`.
 * @property {number} yearsRemaining Whole years between now and State Pension age, `0` once
 *   reached. Also the most further qualifying years there is time to earn — one per tax year.
 * @property {boolean} reached Whether State Pension age is already behind the user.
 */

/**
 * Work out when this user's State Pension starts.
 *
 * `yearsRemaining` is the number that matters to the projection: a further qualifying year takes a
 * tax year to earn, so it is also the ceiling on "further years expected" — anything beyond it is a
 * year the user has no time left to earn, which is worth saying out loud rather than quietly
 * projecting an income off.
 *
 * @param {Partial<import('./types.js').Profile> | null} [profile]
 * @param {object} [options]
 * @param {Date} [options.now] The clock, injectable for tests.
 * @param {number | null} [options.statePensionAge] Override the looked-up age — the user's gov.uk
 *   forecast beats any table, and the table's own later bands are a legislated plan, not a fact.
 *   Ignored outside {@link MIN_STATE_PENSION_AGE}…{@link MAX_STATE_PENSION_AGE}.
 * @returns {StatePensionTiming}
 */
export function statePensionTiming(profile = null, options = {}) {
	const now =
		options.now instanceof Date && !Number.isNaN(options.now.getTime()) ? options.now : new Date();
	const dobYear = asFinite(profile?.dob_year, Number.NaN);
	const dobMonth = profile?.dob_month ?? null;
	const available = Number.isFinite(dobYear);

	const override = asStatePensionAge(options.statePensionAge);
	const overridden = override !== null;
	const spa = overridden ? override : statePensionAge(available ? dobYear : null, dobMonth);

	if (!available) {
		return {
			available: false,
			statePensionAge: spa,
			overridden,
			currentAge: null,
			calendarYear: null,
			yearsRemaining: 0,
			reached: false
		};
	}

	const currentAge = ageAtPoint(dobYear, dobMonth, {
		year: now.getFullYear(),
		month: now.getMonth() + 1
	});

	return {
		available: true,
		statePensionAge: spa,
		overridden,
		currentAge,
		calendarYear: dobYear + spa,
		yearsRemaining: Math.max(0, spa - currentAge),
		reached: currentAge >= spa
	};
}

/* -------------------------------------------------------------------------- */
/* The projection                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What a National Insurance record is worth, now and at State Pension age.
 *
 * @typedef {object} StatePensionProjection
 * @property {boolean} recorded Whether a qualifying-year count was recorded at all. Everything
 *   below reads as zero years when it wasn't, which is a projection of nothing rather than a
 *   statement that the user has no record.
 * @property {number} qualifyingYears Years already earned, floored and clamped.
 * @property {number} futureYears Further years expected before State Pension age.
 * @property {number} totalYears The two added, clamped to {@link MAX_QUALIFYING_YEARS}.
 * @property {number} payableYears The part of `totalYears` that actually pays — capped at
 *   {@link QUALIFYING_YEARS_FOR_FULL}.
 * @property {number} wastedYears Years beyond 35 that buy nothing. Not an error: NI is due on
 *   earnings regardless, so these are usually unavoidable rather than a mistake to correct.
 * @property {number} weeklyIncome Projected State Pension (£/week).
 * @property {number} annualIncome The same (£/yr) — convention (1).
 * @property {number} monthlyIncome The same, a twelfth of the year at a time (£/mo).
 * @property {number} percentOfFull `payableYears` as a share of 35 (%).
 * @property {boolean} qualifies Whether the projected record reaches
 *   {@link MINIMUM_QUALIFYING_YEARS} — below it the pension is £0, not a small one.
 * @property {boolean} full Whether it reaches the full rate.
 * @property {number} shortfallYears Further qualifying years needed for the full rate, `0` once
 *   there.
 * @property {number} yearsToMinimum Further years needed before *anything* is payable, `0` once
 *   past it.
 * @property {number} currentWeeklyIncome What the years already earned would pay on their own
 *   (£/week) — "if I stopped paying National Insurance today".
 * @property {number} currentAnnualIncome The same (£/yr).
 * @property {number} futureUplift What the further years add (£/yr).
 * @property {number} nextYearValue What one more qualifying year would add (£/yr), `0` at the full
 *   rate. Below the 10-year cliff it is `0` too, right up until the year that actually crosses the
 *   cliff — which is worth the whole ten-year pension at once rather than a thirty-fifth of it.
 * @property {number} withdrawalRate The rate `capitalEquivalent` is priced at (%).
 * @property {number} capitalEquivalent The pot it would take to buy the same income at that rate
 *   (£) — the figure that makes a State Pension comparable with the rest of this app.
 */

/**
 * Project a State Pension from a National Insurance record.
 *
 * The two counts are kept apart on purpose. `qualifyingYears` is a fact off an HMRC record;
 * `futureYears` is a plan, and the difference between the income with and without it
 * (`futureUplift`) is the only part of the number the user still controls.
 *
 * `capitalEquivalent` is `fire.js`'s own `fireNumber` run on the projected income, exactly as
 * `defined-benefit.js` does it, so "what is my State Pension worth as a pot" and "what pot do I
 * need for this income" stay one piece of arithmetic. It flatters the State Pension slightly if
 * anything — a triple-locked income paid for life is worth more than a pot drawn at a flat rate.
 *
 * @param {object} [input]
 * @param {unknown} [input.qualifyingYears] Years already on the record.
 * @param {unknown} [input.futureYears] Further years expected before State Pension age.
 * @param {number} [input.withdrawalRate] Rate the capital equivalent is priced at (%).
 * @returns {StatePensionProjection}
 */
export function statePensionProjection(input = {}) {
	const recordedYears = asQualifyingYears(input.qualifyingYears);
	const qualifyingYears = recordedYears ?? 0;
	const futureYears = countedYears(input.futureYears);
	const totalYears = Math.min(qualifyingYears + futureYears, MAX_QUALIFYING_YEARS);
	const payableYears = Math.min(totalYears, QUALIFYING_YEARS_FOR_FULL);

	const weeklyIncome = weeklyStatePension(totalYears);
	const annualIncome = roundMoney(weeklyIncome * WEEKS_PER_YEAR);
	const currentAnnualIncome = annualStatePension(qualifyingYears);

	const withdrawalRate = Math.min(
		Math.max(asFinite(input.withdrawalRate, DEFAULT_WITHDRAWAL_RATE), MIN_WITHDRAWAL_RATE),
		MAX_WITHDRAWAL_RATE
	);

	return {
		recorded: recordedYears !== null,
		qualifyingYears,
		futureYears,
		totalYears,
		payableYears,
		wastedYears: totalYears - payableYears,
		weeklyIncome,
		annualIncome,
		monthlyIncome: roundMoney(annualIncome / 12),
		percentOfFull: roundMoney((payableYears / QUALIFYING_YEARS_FOR_FULL) * 100),
		qualifies: totalYears >= MINIMUM_QUALIFYING_YEARS,
		full: totalYears >= QUALIFYING_YEARS_FOR_FULL,
		shortfallYears: Math.max(0, QUALIFYING_YEARS_FOR_FULL - totalYears),
		yearsToMinimum: Math.max(0, MINIMUM_QUALIFYING_YEARS - totalYears),
		currentWeeklyIncome: weeklyStatePension(qualifyingYears),
		currentAnnualIncome,
		futureUplift: roundMoney(annualIncome - currentAnnualIncome),
		nextYearValue: roundMoney(annualStatePension(totalYears + 1) - annualIncome),
		withdrawalRate,
		capitalEquivalent: fireNumber(annualIncome, withdrawalRate)
	};
}

/* -------------------------------------------------------------------------- */
/* Reading it off the data model                                               */
/* -------------------------------------------------------------------------- */

/** The name the app gives the record it creates for the State Pension. */
export const STATE_PENSION_NAME = 'State Pension';

/**
 * Whether a pension record is *the* State Pension. Tolerant of anything, so a caller can hand it a
 * raw record.
 *
 * @param {unknown} pension
 * @returns {boolean}
 */
export function isStatePension(pension) {
	return /** @type {{ type?: unknown }} */ (pension ?? {}).type === 'state';
}

/**
 * The State Pension record in a `pensions` list, or `null` — convention (6): the first one wins,
 * because there is only ever one.
 *
 * @param {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @returns {Partial<import('./types.js').Pension> | null}
 */
export function findStatePension(pensions = []) {
	if (!Array.isArray(pensions)) return null;
	return pensions.find(isStatePension) ?? null;
}

/**
 * Everything the State Pension card needs: the record, what it projects to, when it starts, and
 * whether the plan fits in the time left.
 *
 * @typedef {object} StatePensionOutlook
 * @property {Partial<import('./types.js').Pension> | null} record The `type: 'state'` pension the
 *   figures came from, or `null` when there isn't one yet.
 * @property {StatePensionProjection} projection
 * @property {StatePensionTiming} timing
 * @property {number} unearnableYears Further years planned that there is no longer time to earn —
 *   `futureYears` beyond `timing.yearsRemaining`. Always `0` when the date of birth is unknown,
 *   since there is then nothing to check against.
 */

/**
 * Pull the National Insurance fields off the `pensions` list and project from them.
 *
 * @param {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @param {Partial<import('./types.js').Profile> | null} [profile]
 * @param {object} [options]
 * @param {Date} [options.now]
 * @param {number | null} [options.statePensionAge]
 * @param {number} [options.withdrawalRate]
 * @returns {StatePensionOutlook}
 */
export function statePensionOutlook(pensions = [], profile = null, options = {}) {
	const record = findStatePension(pensions);
	const projection = statePensionProjection({
		qualifyingYears: record?.ni_qualifying_years,
		futureYears: record?.ni_future_years,
		withdrawalRate: options.withdrawalRate
	});
	const timing = statePensionTiming(profile, options);

	return {
		record,
		projection,
		timing,
		unearnableYears: timing.available
			? Math.max(0, projection.futureYears - timing.yearsRemaining)
			: 0
	};
}
