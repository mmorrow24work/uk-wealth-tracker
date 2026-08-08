/**
 * Lifetime gifts, the 7-year countdown and taper relief — README.md → "Estate & IHT Planning
 * Suite": "Lifetime gifts with 7-year countdown and taper relief" (issue #139).
 *
 * `estate.js` (#138) works out the nil-rate bands and the 40% above them, and its comment names the
 * one seam this module plugs into: chargeable transfers in the seven years before death use the
 * nil-rate band **first**, and only what survives them reaches the estate. That is the whole of
 * this module's job — everything else here exists to get the amount right.
 *
 * The calculation, in the order it actually happens:
 *
 * ```text
 * every gift, oldest first
 *   less the exemptions the giver declared      spouse, charity, wedding cap, small gifts,
 *                                               normal expenditure out of income
 *   less the £3,000 annual exemption            current year first, then one year brought forward
 * = the chargeable value of each gift
 *   drop anything given 7+ years before death   it is out of account entirely
 *   cumulate the rest oldest first against
 *   the nil-rate band                           ← gifts get the band before the estate does
 * = the taxable value of each failed gift       × 40%
 *   less taper relief                           by how long the giver survived the gift
 * = tax on the gifts (payable by whoever received them)
 *
 * whatever nil-rate band is left  →  estate.js's inheritanceTax()
 * ```
 *
 * Seven conventions decide what the numbers here mean:
 *
 * 1. **Taper relief reduces the tax on a gift, never the value of the gift.** This is the single
 *    most commonly mis-stated rule in the whole of UK Inheritance Tax, and it changes answers by
 *    six figures. A £300,000 gift made six and a half years before death still uses £300,000 of the
 *    nil-rate band, leaving less for the estate; the 80% relief it qualifies for applies to a tax
 *    bill of nil and is therefore worth nothing. Taper relief is only ever worth anything on a gift
 *    that is itself above the available nil-rate band — see {@link GiftAssessment.taperRelief},
 *    which is `0` on every gift the band covers.
 * 2. **Gifts are cumulated oldest first, and take the nil-rate band before the estate.** The
 *    counterintuitive consequence, and the reason {@link lifetimeGiftLedger} reports the running
 *    total: the *oldest* failed gift — the one with the most taper relief — is the one the band
 *    shelters, and the *most recent* gift — the one with the least relief, possibly none — is the
 *    one left bearing tax at the full 40%. Ordering the other way round would understate a real
 *    bill.
 * 3. **The band the gifts are set against is the band at death, including anything transferred from
 *    a spouse**, not the band in force when the gift was made. {@link inheritanceTaxWithGifts}
 *    therefore takes the estate first, reads its nil-rate band off {@link estateAllowances} (so the
 *    transferred percentage is applied once, to the whole band), spends it on the gifts, and hands
 *    the remainder to {@link inheritanceTax}. The residence nil-rate band is untouched by gifts: it
 *    can only ever be set against a home passing on death.
 * 4. **Seven years means seven calendar years, and the boundary is inclusive.** A gift made exactly
 *    seven years before the death is exempt (IHTA 1984 s.3A(4) — "seven years or more"), one made a
 *    day later is not. Anniversaries are calendar anniversaries, not 365.25-day multiples;
 *    29 February falls back to 28 February in a non-leap year.
 * 5. **The annual exemption is applied automatically, in date order, because that is how it works.**
 *    It is not elective (IHTA 1984 s.19): it attaches to the earliest transfers of the tax year and
 *    is simply lost if nothing uses it. The other exemptions *are* declared per gift, because they
 *    turn on facts this app has no way to know — whether the recipient was a spouse, whether the
 *    money was a wedding present, whether the payments were habitual and out of income.
 * 6. **Everything is a parameter with a statutory default.** The bands come from `estate.js`
 *    (convention 6 there); the death date defaults to today, which makes the "if I died today"
 *    reading of this module (#140's view, and the "countdown" half of this issue's title) the same
 *    call with no arguments; and the annual exemption brought into the first recorded tax year is a
 *    caller-set option, because nothing in the data model records the year before the earliest gift.
 * 7. **Everything is pure and every money figure is rounded to whole pence**, matching `estate.js`,
 *    `tax.js` and the rest of `$lib`. Rates and reliefs are whole-number percents (`40` = 40%), per
 *    `types.js`'s convention.
 *
 * ## The statutory figures, and where each comes from
 *
 * Taper relief — IHTA 1984 s.7(4), which states the *proportion of the full rate* charged, and
 * HMRC's IHTM14611. `reliefPct` below is its complement, and `effectiveRatePct` is
 * {@link IHT_RATE} × the statutory proportion. gov.uk's "How Inheritance Tax works: thresholds,
 * rules and allowances" prints the same table in the effective-rate form the issue quotes:
 *
 * ```text
 * years between gift and death   s.7(4) proportion   taper relief   effective rate
 * not more than 3                100%                 0%             40%
 * more than 3, not more than 4    80%                20%             32%
 * more than 4, not more than 5    60%                40%             24%
 * more than 5, not more than 6    40%                60%             16%
 * more than 6, not more than 7    20%                80%              8%
 * 7 or more                        —                   —              0%   (exempt, s.3A(4))
 * ```
 *
 * The last row is not taper relief at all — it is the potentially exempt transfer becoming an
 * exempt one — but it is printed as part of the same table everywhere a user will have seen it, so
 * {@link TAPER_RELIEF_BANDS} carries it too, flagged as {@link TaperBand.exempt}.
 *
 * The exemptions: £3,000 a year with one year's carry-forward (s.19); £250 per recipient per year
 * for small gifts, all-or-nothing and not combinable with the annual exemption to the same person
 * (s.20); wedding gifts of £5,000 from a parent, £2,500 from a grandparent or great-grandparent —
 * or from one party of the marriage to the other — and £1,000 from anyone else (s.22); normal
 * expenditure out of income (s.21); spouse or civil partner (s.18); charity (s.23).
 *
 * ## Worked examples
 *
 * Each of these is a test in `lifetime-gifts.test.js`, and they are the examples this module was
 * written against rather than an illustration added afterwards. Every one uses the 2026/27
 * £325,000 nil-rate band with nothing transferred:
 *
 * ```text
 * £400,000 gifted 4½ years before death       75,000 over the band, 40% relief    → £18,000 gift tax
 * £300,000 gifted 6½ years before death       band covers it; 80% of nil is nil   → £0 gift tax,
 *                                                                                   and £25,000 of
 *                                                                                   band left for the
 *                                                                                   estate
 * £200,000 gifted 6y11m before death, then
 *   £200,000 gifted 1y11m before death        the old gift takes the band, the
 *                                             recent one pays at the full rate     → £30,000
 * £500,000 gifted 7 years to the day before   out of account entirely              → £0, band intact
 * £6,000 gifted in the first recorded year    £3,000 + £3,000 brought forward      → wholly exempt
 * £15,000 to a child on their wedding         £5,000 s.22 + £6,000 s.19            → £4,000 chargeable
 * ```
 *
 * ## What this deliberately does not model
 *
 * - **Chargeable lifetime transfers, and therefore the "14-year rule".** Gifts into most trusts are
 *   chargeable when made (20% above the band) and are re-cumulated at death, and a CLT made up to
 *   seven years *before* a failed gift reduces the band available to that gift — which is where the
 *   fourteen years come from. Nothing in this app's data model describes a trust, every gift here is
 *   a potentially exempt transfer to an individual, and half-implementing cumulation would quietly
 *   understate the bill on exactly the estates that are complicated enough to care.
 * - **Gifts with reservation of benefit** (giving the house away and going on living in it), which
 *   are not really gifts at all for IHT, and the **pre-owned assets** charge that can apply instead.
 *   A gift recorded here is assumed to be an outright one.
 * - **Business and Agricultural Property Relief on a lifetime gift**, including the clawback where
 *   the recipient no longer holds the property at the death; **fall in value relief**; and **the
 *   instalment option**. `estate.js` excludes the same reliefs on the estate side.
 * - **Who actually pays, and grossing up.** Tax on a failed gift is primarily the recipient's, not
 *   the estate's — {@link LifetimeGiftLedger.tax} and {@link EstateWithGifts.estate}'s own `tax` are
 *   kept apart for that reason — and this module always treats the gift as having been made net,
 *   never grossed up for tax the giver agreed to bear.
 * - **The 36% reduced charity rate**, for the same reason `estate.js` excludes it: the baseline
 *   amount it turns on could not be verified here.
 *
 * ## Sourcing
 *
 * As with `estate.js` and `budget-policy.js`, this session had **no network access**, so the
 * sections and figures cited above are stated from knowledge and were not re-verified against
 * legislation.gov.uk or HMRC's manuals at the time of writing. The taper percentages and the
 * seven-year period are the high-confidence core of this module and are the figures the issue asked
 * to have cited; the exemption amounts (£3,000, £250, £5,000/£2,500/£1,000) are long-standing and
 * equally confident, but anything relied on for real estate planning should be checked against
 * HMRC's "Inheritance Tax Manual" IHTM14000-series. README.md's standing disclaimer —
 * illustrative, not financial advice — applies here as much as it does to `estate.js`.
 */

import {
	IHT_RATE,
	IHT_TAX_YEAR,
	STATUTORY_NIL_RATE_BANDS,
	estateAllowances,
	inheritanceTax,
	normaliseEstate,
	transferableAllowances
} from './estate.js';
import { createId } from './model.js';

/*
 * As elsewhere in `$lib`: types from sibling modules are referenced inline as
 * `import('./estate.js').X` rather than re-declared as local `@typedef`s, because `index.js`
 * re-exports every module with `export *` and svelte-check reads two same-named top-level typedefs
 * as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* Statutory figures                                                           */
/* -------------------------------------------------------------------------- */

/** The tax year the exemption figures below belong to, matching `estate.js`'s `IHT_TAX_YEAR`. */
export const GIFT_TAX_YEAR = IHT_TAX_YEAR;

/**
 * Survive a gift by this many years and it drops out of the Inheritance Tax account entirely —
 * IHTA 1984 s.3A(4), "seven years or more". The boundary is inclusive: exactly seven years is
 * enough (convention 4).
 */
export const PET_SURVIVAL_YEARS = 7;

/**
 * The £3,000 a year that is exempt however it is given away — IHTA 1984 s.19.
 */
export const ANNUAL_EXEMPTION = 3_000;

/**
 * Unused {@link ANNUAL_EXEMPTION} can be carried forward this many tax years, and one only. The
 * current year's own exemption must be used before anything brought forward.
 */
export const ANNUAL_EXEMPTION_CARRY_FORWARD_YEARS = 1;

/**
 * The small gifts exemption — IHTA 1984 s.20. £250 per recipient per tax year, and strictly
 * all-or-nothing: it cannot cover the first £250 of a larger gift, and it cannot be claimed for
 * someone who has already had part of the {@link ANNUAL_EXEMPTION} in the same year.
 */
export const SMALL_GIFT_EXEMPTION = 250;

/**
 * Gifts in consideration of marriage or civil partnership — IHTA 1984 s.22, keyed by gov.uk's
 * recipient-side phrasing rather than the Act's giver-side one. £5,000 to a child, £2,500 to a
 * grandchild or great-grandchild (the Act's "remoter ancestor", and also the limit where one party
 * of the marriage gives to the other) and £1,000 to anyone else. Anything above the cap is an
 * ordinary potentially exempt transfer, and is still eligible for the annual exemption.
 *
 * @type {Readonly<Record<'wedding_child' | 'wedding_grandchild' | 'wedding_other', number>>}
 */
export const WEDDING_GIFT_EXEMPTIONS = Object.freeze({
	wedding_child: 5_000,
	wedding_grandchild: 2_500,
	wedding_other: 1_000
});

/**
 * One row of the taper table.
 *
 * @typedef {object} TaperBand
 * @property {number | null} maxYears The band covers a gift made more than the previous row's
 *   `maxYears` and not more than this many years before the death. `null` on the final row, which
 *   is unbounded.
 * @property {number} statutoryRatePct The proportion of the full rate charged, as IHTA 1984 s.7(4)
 *   itself states it (%). `0` on the exempt row, which s.7(4) does not cover.
 * @property {number} reliefPct Taper relief — `100 - statutoryRatePct` (%). This is the figure
 *   applied to the *tax*, per convention 1.
 * @property {number} effectiveRatePct {@link IHT_RATE} after the relief (%) — the form the issue
 *   and gov.uk both quote: 40, 32, 24, 16, 8, 0.
 * @property {boolean} exempt Whether the gift is out of account altogether rather than taxed at a
 *   reduced rate. True only on the final row, and it is s.3A(4) rather than taper relief.
 * @property {string} label How gov.uk names the band.
 */

/**
 * The taper table, oldest band last — the module comment above prints it with its sources.
 *
 * @type {readonly Readonly<TaperBand>[]}
 */
export const TAPER_RELIEF_BANDS = Object.freeze([
	Object.freeze({
		maxYears: 3,
		statutoryRatePct: 100,
		reliefPct: 0,
		effectiveRatePct: 40,
		exempt: false,
		label: 'Less than 3 years'
	}),
	Object.freeze({
		maxYears: 4,
		statutoryRatePct: 80,
		reliefPct: 20,
		effectiveRatePct: 32,
		exempt: false,
		label: '3 to 4 years'
	}),
	Object.freeze({
		maxYears: 5,
		statutoryRatePct: 60,
		reliefPct: 40,
		effectiveRatePct: 24,
		exempt: false,
		label: '4 to 5 years'
	}),
	Object.freeze({
		maxYears: 6,
		statutoryRatePct: 40,
		reliefPct: 60,
		effectiveRatePct: 16,
		exempt: false,
		label: '5 to 6 years'
	}),
	Object.freeze({
		maxYears: 7,
		statutoryRatePct: 20,
		reliefPct: 80,
		effectiveRatePct: 8,
		exempt: false,
		label: '6 to 7 years'
	}),
	Object.freeze({
		maxYears: null,
		statutoryRatePct: 0,
		reliefPct: 100,
		effectiveRatePct: 0,
		exempt: true,
		label: '7 or more years'
	})
]);

/**
 * The exemption a gift is declared under. `none` is the default and the common case — an outright
 * gift to an individual, i.e. a potentially exempt transfer — and is the only value the
 * {@link ANNUAL_EXEMPTION} is applied to (convention 5 explains why the rest are declared).
 *
 * @typedef {'none' | 'spouse' | 'charity' | 'small' | 'wedding_child' | 'wedding_grandchild'
 *   | 'wedding_other' | 'normal_expenditure'} GiftExemption
 */

/**
 * Every {@link GiftExemption}, in the order a dropdown should offer them.
 *
 * @type {readonly GiftExemption[]}
 */
export const GIFT_EXEMPTIONS = Object.freeze([
	'none',
	'spouse',
	'charity',
	'normal_expenditure',
	'small',
	'wedding_child',
	'wedding_grandchild',
	'wedding_other'
]);

/**
 * Human wording for each {@link GiftExemption}, kept beside the codes so UI copy can change without
 * a data migration — `enums.js`'s own `*_LABELS` convention.
 *
 * @type {Readonly<Record<GiftExemption, string>>}
 */
export const GIFT_EXEMPTION_LABELS = Object.freeze({
	none: 'No special exemption (a potentially exempt transfer)',
	spouse: 'Spouse or civil partner',
	charity: 'Charity or community amateur sports club',
	normal_expenditure: 'Normal expenditure out of income',
	small: 'Small gift (up to £250 per person per year)',
	wedding_child: 'Wedding gift to a child',
	wedding_grandchild: 'Wedding gift to a grandchild or great-grandchild',
	wedding_other: 'Wedding gift to anyone else'
});

/** The exemptions that cover a gift completely, whatever it is worth. */
const UNLIMITED_EXEMPTIONS = Object.freeze(['spouse', 'charity', 'normal_expenditure']);

/**
 * What became of one gift once the death date is known.
 *
 * @typedef {'failed' | 'survived' | 'exempt' | 'undated' | 'after_death'} GiftStatus
 */

/**
 * Every {@link GiftStatus}.
 *
 * @type {readonly GiftStatus[]}
 */
export const GIFT_STATUSES = Object.freeze([
	'failed',
	'survived',
	'exempt',
	'undated',
	'after_death'
]);

/**
 * Human wording for each {@link GiftStatus}.
 *
 * @type {Readonly<Record<GiftStatus, string>>}
 */
export const GIFT_STATUS_LABELS = Object.freeze({
	failed: 'Counts against the estate',
	survived: 'Out of account — 7 years survived',
	exempt: 'Exempt',
	undated: 'No date recorded',
	after_death: 'Dated after the death'
});

/* -------------------------------------------------------------------------- */
/* Coercion helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asNumber(value, fallback) {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/* -------------------------------------------------------------------------- */
/* Calendar arithmetic                                                         */
/* -------------------------------------------------------------------------- */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/**
 * A calendar date, taken apart. Nothing here goes through `Date` arithmetic: the seven years of
 * convention 4 are calendar anniversaries, and epoch milliseconds cannot express one.
 *
 * @typedef {{ year: number, month: number, day: number }} CalendarDate
 */

/**
 * @param {number} year
 * @param {number} month 1-based.
 * @returns {number} How many days that month has.
 */
function daysInMonth(year, month) {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * @param {unknown} value
 * @returns {CalendarDate | null} `null` unless `value` is a calendar-valid ISO `YYYY-MM-DD` string —
 *   `2026-02-30` is rejected, not rolled forward.
 */
function parseIsoDate(value) {
	if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return null;

	const year = Number(value.slice(0, 4));
	const month = Number(value.slice(5, 7));
	const day = Number(value.slice(8, 10));
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;

	return { year, month, day };
}

/**
 * @param {CalendarDate} date
 * @returns {string} ISO `YYYY-MM-DD`.
 */
function formatIsoDate(date) {
	const month = String(date.month).padStart(2, '0');
	const day = String(date.day).padStart(2, '0');
	return `${String(date.year).padStart(4, '0')}-${month}-${day}`;
}

/**
 * @param {CalendarDate} a
 * @param {CalendarDate} b
 * @returns {number} Negative if `a` is earlier, `0` if the same day, positive if later.
 */
function compareDates(a, b) {
	return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * The same day-of-year in another year, with 29 February falling back to 28 February where the
 * target year has no 29th (convention 4).
 *
 * @param {CalendarDate} from
 * @param {number} year
 * @returns {CalendarDate}
 */
function anniversaryOf(from, year) {
	return { year, month: from.month, day: Math.min(from.day, daysInMonth(year, from.month)) };
}

/**
 * @param {CalendarDate} date
 * @returns {number} Whole days since the epoch — used only for the countdown's "days to go", never
 *   for the seven years themselves.
 */
function toEpochDay(date) {
	return Date.UTC(date.year, date.month - 1, date.day) / MS_PER_DAY;
}

/**
 * How long one date is after another, in complete calendar years.
 *
 * `onAnniversary` is what makes the statutory bands land in the right place: s.7(4) draws its lines
 * at "not more than N years", so a gift made exactly N years before the death sits in the *N*th band
 * and one made a day later sits in the (N+1)th. Complete years alone cannot tell those apart.
 *
 * @param {string} fromIso The earlier date, ISO `YYYY-MM-DD`.
 * @param {string} toIso The later date, ISO `YYYY-MM-DD`.
 * @returns {{ years: number, onAnniversary: boolean, days: number } | null} `null` if either date is
 *   unparseable or `toIso` falls before `fromIso`.
 */
export function yearsBetween(fromIso, toIso) {
	const from = parseIsoDate(fromIso);
	const to = parseIsoDate(toIso);
	if (!from || !to || compareDates(to, from) < 0) return null;

	let years = to.year - from.year;
	if (compareDates(to, anniversaryOf(from, from.year + years)) < 0) years -= 1;

	return {
		years,
		onAnniversary: compareDates(to, anniversaryOf(from, from.year + years)) === 0,
		days: toEpochDay(to) - toEpochDay(from)
	};
}

/**
 * The date a gift stops counting: its seventh anniversary, which is itself early enough to be exempt
 * (convention 4).
 *
 * @param {string} giftDateIso ISO `YYYY-MM-DD`.
 * @returns {string | null} ISO `YYYY-MM-DD`, or `null` if the date is unparseable.
 */
export function giftExemptOn(giftDateIso) {
	const from = parseIsoDate(giftDateIso);
	return from ? formatIsoDate(anniversaryOf(from, from.year + PET_SURVIVAL_YEARS)) : null;
}

/**
 * The UK tax year a date falls in — they run 6 April to 5 April, so 5 April 2026 is 2025/26 and
 * 6 April 2026 is 2026/27. Matches `isa.js`'s `ISA_TAX_YEAR_START`/`_END` boundaries.
 *
 * @param {string} isoDate ISO `YYYY-MM-DD`.
 * @returns {string | null} `YYYY/YY`, or `null` if the date is unparseable.
 */
export function giftTaxYear(isoDate) {
	const date = parseIsoDate(isoDate);
	if (!date) return null;

	const startYear = taxYearStartYear(date);
	return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * @param {CalendarDate} date
 * @returns {number} The calendar year the date's UK tax year began in.
 */
function taxYearStartYear(date) {
	return date.month > 4 || (date.month === 4 && date.day >= 6) ? date.year : date.year - 1;
}

/**
 * The taper band a gift falls in, given how long the giver survived it.
 *
 * @param {number} years Complete years between the gift and the death.
 * @param {boolean} [onAnniversary] Whether the death fell exactly on an anniversary of the gift —
 *   the difference between "not more than N years" and "more than N", per {@link yearsBetween}.
 * @returns {TaperBand}
 */
export function taperReliefBand(years, onAnniversary = false) {
	if (years >= PET_SURVIVAL_YEARS) return TAPER_RELIEF_BANDS[TAPER_RELIEF_BANDS.length - 1];

	// The smallest whole number of years the gap is "not more than": 2y6m is not more than 3 years,
	// and so is exactly 3y — but 3y1d is not more than 4.
	const notMoreThan = Math.max(0, onAnniversary ? years : years + 1);
	return (
		TAPER_RELIEF_BANDS.find((band) => band.maxYears !== null && notMoreThan <= band.maxYears) ??
		TAPER_RELIEF_BANDS[TAPER_RELIEF_BANDS.length - 1]
	);
}

/* -------------------------------------------------------------------------- */
/* The gift                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One lifetime gift, as this module needs it stated.
 *
 * @typedef {object} Gift
 * @property {string} id Stable identity for list rendering and editing — see {@link createGift}.
 * @property {string | null} date When it was given, ISO `YYYY-MM-DD`. `null` is a gift nobody has
 *   dated yet; it is reported as {@link GIFT_STATUS_LABELS}'s `undated` rather than guessed at,
 *   because the whole calculation turns on this field.
 * @property {number} amount What was given away (£), `>= 0`. The *loss to the giver's estate*,
 *   which for anything this app tracks is simply what the thing was worth.
 * @property {string} recipient Who received it. Free text; it is also the key the £250 small gifts
 *   exemption is counted per, so two gifts to the same person need the same spelling.
 * @property {string} description What it was for. Free text, display only.
 * @property {GiftExemption} exemption Which exemption the giver is claiming, if any — convention 5.
 *   The {@link ANNUAL_EXEMPTION} is *not* declared here; it is applied automatically.
 */

/**
 * Defaults for a gift nobody has filled in yet — what {@link createGift} seeds a new row with, and
 * what {@link normaliseGift} falls back to for a field that cannot be parsed.
 *
 * @type {Readonly<Omit<Gift, 'id'>>}
 */
export const DEFAULT_GIFT = Object.freeze({
	date: null,
	amount: 0,
	recipient: '',
	description: '',
	exemption: /** @type {GiftExemption} */ ('none')
});

/**
 * A fresh gift for an "+ add a gift" control — the one place a new {@link Gift} gets its id,
 * matching `model.js`'s `createInvestment`/`createDebt` factory pattern.
 *
 * @param {Partial<Gift>} [overrides]
 * @returns {Gift}
 */
export function createGift(overrides = {}) {
	return { id: createId('gift'), ...DEFAULT_GIFT, ...overrides };
}

/**
 * Fill in and bound a partial gift, so a half-filled form or a hand-edited document both become
 * something this module can calculate from. An unrecognised exemption reads as `none` — the
 * chargeable reading, so a typo overstates the bill rather than quietly exempting a gift — and a
 * date that is not a calendar-valid ISO `YYYY-MM-DD` reads as `null` rather than being coerced.
 *
 * @param {Partial<Gift>} [gift]
 * @returns {Gift}
 */
export function normaliseGift(gift = {}) {
	const id = typeof gift.id === 'string' && gift.id !== '' ? gift.id : createId('gift');
	const exemption = /** @type {GiftExemption} */ (
		GIFT_EXEMPTIONS.includes(/** @type {GiftExemption} */ (gift.exemption))
			? gift.exemption
			: DEFAULT_GIFT.exemption
	);

	return {
		id,
		date: parseIsoDate(gift.date) ? /** @type {string} */ (gift.date) : DEFAULT_GIFT.date,
		amount: Math.max(0, asNumber(gift.amount, DEFAULT_GIFT.amount)),
		recipient: typeof gift.recipient === 'string' ? gift.recipient : DEFAULT_GIFT.recipient,
		description: typeof gift.description === 'string' ? gift.description : DEFAULT_GIFT.description,
		exemption
	};
}

/**
 * {@link normaliseGift} over a whole list. Anything that is not an array (including `undefined`)
 * normalises to an empty list: no gifts recorded yet, not an error.
 *
 * @param {readonly Partial<Gift>[] | undefined | null} gifts
 * @returns {Gift[]}
 */
export function normaliseGifts(gifts) {
	return Array.isArray(gifts) ? gifts.map((gift) => normaliseGift(gift)) : [];
}

/* -------------------------------------------------------------------------- */
/* The ledger                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How {@link lifetimeGiftLedger} and {@link inheritanceTaxWithGifts} should be run.
 *
 * @typedef {object} GiftLedgerOptions
 * @property {string} [deathDate] The death the gifts are assessed against, ISO `YYYY-MM-DD`.
 *   Defaults to today, which makes the no-argument call the "if I died today" countdown
 *   (convention 6).
 * @property {number} [nilRateBand] The band the gifts are set against (£). {@link lifetimeGiftLedger}
 *   defaults it to `estate.js`'s statutory £325,000 with nothing transferred;
 *   {@link inheritanceTaxWithGifts} always computes it from the estate instead (convention 3).
 * @property {boolean} [applyAnnualExemption] Whether to apply the £3,000 annual exemption
 *   automatically. `true` by default — set it `false` where the recorded amounts are already net of
 *   exemptions, which is how a user who has copied figures off an IHT403 will have them.
 * @property {number} [carriedForwardAnnualExemption] Unused annual exemption brought into the
 *   earliest recorded tax year (£), 0–{@link ANNUAL_EXEMPTION}. Defaults to the full
 *   {@link ANNUAL_EXEMPTION}: nothing in this app records the year before the first gift, and a
 *   giver who had used it would have recorded that gift too. Set it `0` to be conservative.
 * @property {number} [rate] The rate charged on a failed gift above the band (%). Defaults to
 *   `estate.js`'s {@link IHT_RATE}, and is a parameter for the same reason its bands are.
 */

/**
 * One gift, assessed.
 *
 * @typedef {object} GiftAssessment
 * @property {string} id
 * @property {number} index Where the gift sat in the list as supplied — the assessments come back in
 *   date order, which is rarely the order they were entered.
 * @property {string | null} date
 * @property {number} amount What was given (£).
 * @property {string} recipient
 * @property {string} description
 * @property {GiftExemption} exemption As declared.
 * @property {GiftExemption} exemptionApplied What was actually allowed. Differs from `exemption`
 *   only where a declared `small` gift did not qualify — over £250, or to someone who had already
 *   had annual exemption that year — in which case it falls back to `none` and the gift is treated
 *   as an ordinary potentially exempt transfer.
 * @property {string | null} taxYear The UK tax year the gift falls in, `YYYY/YY`.
 * @property {number} declaredExemption Taken off by the declared exemption (£).
 * @property {number} annualExemption Taken off by the £3,000 annual exemption, brought-forward
 *   included (£).
 * @property {number} exemptAmount The two added (£).
 * @property {number} chargeableValue What is left to count against the estate (£).
 * @property {GiftStatus} status
 * @property {number} yearsSurvived Complete calendar years between the gift and the death.
 * @property {boolean} onAnniversary Whether the death fell exactly on an anniversary of the gift.
 * @property {string | null} exemptOn The date the gift falls out of account, ISO `YYYY-MM-DD` —
 *   {@link giftExemptOn}.
 * @property {number} daysUntilExempt Days from the death date to `exemptOn`; `0` once survived. The
 *   countdown, when the ledger is run against today.
 * @property {TaperBand} taperBand The band `yearsSurvived` puts it in.
 * @property {number} taperReliefPct Relief on the tax (%) — `taperBand.reliefPct`, restated for
 *   convenience.
 * @property {number} effectiveRatePct The rate actually borne by the taxable part (%).
 * @property {number} nilRateBandUsed How much of the band this gift consumed (£) — `0` unless the
 *   gift failed.
 * @property {number} cumulativeChargeable Running total of chargeable failed gifts up to and
 *   including this one (£) — convention 2's oldest-first cumulation, made visible.
 * @property {number} taxableValue The part above the band (£).
 * @property {number} taxBeforeTaper `taxableValue` × the rate (£).
 * @property {number} taperRelief Knocked off by taper relief (£). `0` wherever `taxBeforeTaper` is,
 *   which is convention 1's whole point.
 * @property {number} tax Payable on this gift (£) — by whoever received it, not by the estate.
 */

/**
 * Every gift, assessed against one death, plus what it all costs.
 *
 * @typedef {object} LifetimeGiftLedger
 * @property {string} deathDate The date assessed against, ISO `YYYY-MM-DD`.
 * @property {number} rate The rate charged above the band (%).
 * @property {GiftAssessment[]} gifts Every supplied gift, oldest first.
 * @property {number} totalGifted Everything given away, whatever its status (£).
 * @property {number} totalExempt Covered by exemptions, declared and annual (£).
 * @property {number} annualExemptionUsed The part of that which was the £3,000 annual exemption (£).
 * @property {number} totalSurvived Chargeable value of gifts the giver survived by seven years (£) —
 *   out of account, and the number that makes the case for giving early.
 * @property {number} chargeableTransfers Chargeable value of the gifts that failed (£) — what eats
 *   the nil-rate band.
 * @property {number} nilRateBand The band the gifts were set against (£).
 * @property {number} nilRateBandUsed How much of it the gifts consumed (£).
 * @property {number} nilRateBandRemaining What is left for the estate (£) — the one number
 *   {@link inheritanceTaxWithGifts} carries across.
 * @property {number} taxableTransfers Chargeable value above the band (£).
 * @property {number} taxBeforeTaper Tax on the gifts before taper relief (£).
 * @property {number} taperRelief Total taper relief given (£).
 * @property {number} tax Tax on the gifts after taper relief (£).
 * @property {number} failedCount How many gifts failed.
 * @property {number} survivedCount How many were survived by seven years.
 * @property {string | null} nextToFallOut The date the earliest still-counting gift drops out of
 *   account, ISO `YYYY-MM-DD` — `null` when nothing is counting.
 * @property {number} daysToNextFallOut Days until that happens; `0` when nothing is counting.
 */

/**
 * @param {Date} now
 * @returns {string} `now` as an ISO `YYYY-MM-DD` calendar date, read in local time — a gift given
 *   "today" is today's date on the giver's calendar, not UTC's.
 */
function todayIso(now) {
	return formatIsoDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/**
 * Work out what every gift is worth after exemptions, then what the ones that failed cost.
 *
 * The two passes are separate on purpose and cannot be merged: exemptions are allocated in date
 * order across *every* gift, including ones given more than seven years ago (they use up the same
 * £3,000, which is why a long-ago gift can leave a recent one exposed), while the nil-rate band is
 * cumulated only over the gifts that actually failed.
 *
 * @param {readonly Partial<Gift>[] | undefined | null} gifts
 * @param {GiftLedgerOptions} [options]
 * @returns {LifetimeGiftLedger}
 */
export function lifetimeGiftLedger(gifts, options = {}) {
	const deathDate = parseIsoDate(options.deathDate)
		? /** @type {string} */ (options.deathDate)
		: todayIso(new Date());
	const rate = asNumber(options.rate, IHT_RATE);
	const nilRateBand = Math.max(0, asNumber(options.nilRateBand, STATUTORY_NIL_RATE_BANDS.nrb));

	const assessed = assessGifts(normaliseGifts(gifts), deathDate, options);

	let nilRateBandRemaining = nilRateBand;
	let cumulativeChargeable = 0;

	for (const gift of assessed) {
		if (gift.status !== 'failed') continue;

		cumulativeChargeable = roundMoney(cumulativeChargeable + gift.chargeableValue);
		gift.cumulativeChargeable = cumulativeChargeable;

		// Convention 2: oldest first, so the band shelters the gift with the most taper relief and
		// leaves the most recent one — with the least — bearing tax at the full rate.
		gift.nilRateBandUsed = roundMoney(Math.min(nilRateBandRemaining, gift.chargeableValue));
		nilRateBandRemaining = roundMoney(nilRateBandRemaining - gift.nilRateBandUsed);

		gift.taxableValue = roundMoney(gift.chargeableValue - gift.nilRateBandUsed);
		gift.taxBeforeTaper = roundMoney((gift.taxableValue * rate) / 100);
		// Convention 1: relief is a percentage of the tax, so a gift the band covers gets nothing.
		gift.taperRelief = roundMoney((gift.taxBeforeTaper * gift.taperReliefPct) / 100);
		gift.tax = roundMoney(gift.taxBeforeTaper - gift.taperRelief);
	}

	const counting = assessed.filter((gift) => gift.status === 'failed' && gift.exemptOn !== null);
	const nextToFallOut = counting.length > 0 ? counting[0].exemptOn : null;

	return {
		deathDate,
		rate,
		gifts: assessed,
		totalGifted: sum(assessed, (gift) => gift.amount),
		totalExempt: sum(assessed, (gift) => gift.exemptAmount),
		annualExemptionUsed: sum(assessed, (gift) => gift.annualExemption),
		totalSurvived: sum(
			assessed.filter((gift) => gift.status === 'survived'),
			(gift) => gift.chargeableValue
		),
		chargeableTransfers: cumulativeChargeable,
		nilRateBand: roundMoney(nilRateBand),
		nilRateBandUsed: roundMoney(nilRateBand - nilRateBandRemaining),
		nilRateBandRemaining,
		taxableTransfers: sum(assessed, (gift) => gift.taxableValue),
		taxBeforeTaper: sum(assessed, (gift) => gift.taxBeforeTaper),
		taperRelief: sum(assessed, (gift) => gift.taperRelief),
		tax: sum(assessed, (gift) => gift.tax),
		failedCount: assessed.filter((gift) => gift.status === 'failed').length,
		survivedCount: assessed.filter((gift) => gift.status === 'survived').length,
		nextToFallOut,
		daysToNextFallOut: counting.length > 0 ? counting[0].daysUntilExempt : 0
	};
}

/**
 * @template T
 * @param {readonly T[]} items
 * @param {(item: T) => number} of
 * @returns {number}
 */
function sum(items, of) {
	return roundMoney(items.reduce((total, item) => total + of(item), 0));
}

/**
 * Pass one: date every gift, apply the exemptions, and say what became of it. The nil-rate band is
 * not touched here — that is {@link lifetimeGiftLedger}'s second pass.
 *
 * @param {Gift[]} gifts
 * @param {string} deathDate
 * @param {GiftLedgerOptions} options
 * @returns {GiftAssessment[]}
 */
function assessGifts(gifts, deathDate, options) {
	const applyAnnual = options.applyAnnualExemption !== false;
	const carriedForward = clamp(
		asNumber(options.carriedForwardAnnualExemption, ANNUAL_EXEMPTION),
		0,
		ANNUAL_EXEMPTION
	);

	const assessments = gifts
		.map((gift, index) => ({ gift, index, date: parseIsoDate(gift.date) }))
		.sort((a, b) => {
			if (!a.date) return b.date ? 1 : a.index - b.index;
			if (!b.date) return -1;
			return compareDates(a.date, b.date) || a.index - b.index;
		})
		.map(({ gift, index, date }) => blankAssessment(gift, index, date, deathDate));

	/** Own (not brought-forward) annual exemption left in the last tax year seen. */
	let previousYear = /** @type {number | null} */ (null);
	let previousOwnLeft = carriedForward;
	let ownLeft = 0;
	let broughtForwardLeft = 0;
	let currentYear = /** @type {number | null} */ (null);

	/** Recipients who have had annual exemption this tax year — s.20 bars them from a small gift. */
	const annualExemptionRecipients = new Set();
	/** `${taxYear}|${recipient}` → small-gift exemption already claimed (£). */
	const smallGiftsClaimed = new Map();

	for (const assessment of assessments) {
		if (assessment.status === 'undated' || assessment.status === 'after_death') continue;

		const date = /** @type {CalendarDate} */ (parseIsoDate(assessment.date));
		const startYear = taxYearStartYear(date);

		if (startYear !== currentYear) {
			if (currentYear !== null) {
				previousYear = currentYear;
				previousOwnLeft = ownLeft;
			}
			// One year's carry-forward only, and a tax year with no gifts in it left its whole £3,000
			// unused — so a gap of two or more years always brings the full amount forward.
			broughtForwardLeft =
				previousYear === null || previousYear === startYear - 1
					? previousOwnLeft
					: ANNUAL_EXEMPTION;
			ownLeft = ANNUAL_EXEMPTION;
			currentYear = startYear;
			annualExemptionRecipients.clear();
		}

		const recipientKey = `${startYear}|${assessment.recipient.trim().toLowerCase()}`;

		let remaining = assessment.amount;
		if (UNLIMITED_EXEMPTIONS.includes(assessment.exemption)) {
			assessment.declaredExemption = roundMoney(remaining);
			remaining = 0;
		} else if (assessment.exemption === 'small') {
			const claimed = smallGiftsClaimed.get(recipientKey) ?? 0;
			// s.20 is all-or-nothing: it cannot cover the first £250 of a bigger gift, and it is barred
			// where the same person has already had annual exemption in the same tax year.
			const qualifies =
				remaining <= SMALL_GIFT_EXEMPTION &&
				claimed + remaining <= SMALL_GIFT_EXEMPTION &&
				!annualExemptionRecipients.has(recipientKey);

			if (qualifies) {
				smallGiftsClaimed.set(recipientKey, claimed + remaining);
				assessment.declaredExemption = roundMoney(remaining);
				remaining = 0;
			} else {
				assessment.exemptionApplied = 'none';
			}
		} else if (assessment.exemption in WEDDING_GIFT_EXEMPTIONS) {
			const cap =
				WEDDING_GIFT_EXEMPTIONS[
					/** @type {keyof typeof WEDDING_GIFT_EXEMPTIONS} */ (assessment.exemption)
				];
			assessment.declaredExemption = roundMoney(Math.min(cap, remaining));
			remaining = roundMoney(remaining - assessment.declaredExemption);
		}

		if (applyAnnual && remaining > 0) {
			// The current year's own £3,000 is used before anything brought forward — s.19(3).
			const fromOwn = Math.min(ownLeft, remaining);
			ownLeft = roundMoney(ownLeft - fromOwn);
			const fromBroughtForward = Math.min(broughtForwardLeft, roundMoney(remaining - fromOwn));
			broughtForwardLeft = roundMoney(broughtForwardLeft - fromBroughtForward);

			assessment.annualExemption = roundMoney(fromOwn + fromBroughtForward);
			remaining = roundMoney(remaining - assessment.annualExemption);
			if (assessment.annualExemption > 0) annualExemptionRecipients.add(recipientKey);
		}

		assessment.exemptAmount = roundMoney(assessment.declaredExemption + assessment.annualExemption);
		assessment.chargeableValue = roundMoney(remaining);

		if (assessment.status !== 'survived') {
			assessment.status = assessment.chargeableValue > 0 ? 'failed' : 'exempt';
		}
	}

	return assessments;
}

/**
 * A gift with its dates worked out and nothing charged yet.
 *
 * @param {Gift} gift
 * @param {number} index
 * @param {CalendarDate | null} date
 * @param {string} deathDate
 * @returns {GiftAssessment}
 */
function blankAssessment(gift, index, date, deathDate) {
	const survival = gift.date ? yearsBetween(gift.date, deathDate) : null;
	const exemptOn = gift.date ? giftExemptOn(gift.date) : null;
	const toExempt = exemptOn === null ? null : yearsBetween(deathDate, exemptOn);
	const daysToExempt = toExempt === null ? 0 : toExempt.days;

	/** @type {GiftStatus} */
	let status = 'failed';
	if (!date) status = 'undated';
	else if (!survival) status = 'after_death';
	else if (survival.years >= PET_SURVIVAL_YEARS) status = 'survived';

	const band = taperReliefBand(survival?.years ?? 0, survival?.onAnniversary ?? false);

	return {
		id: gift.id,
		index,
		date: gift.date,
		amount: roundMoney(gift.amount),
		recipient: gift.recipient,
		description: gift.description,
		exemption: gift.exemption,
		exemptionApplied: gift.exemption,
		taxYear: gift.date ? giftTaxYear(gift.date) : null,
		declaredExemption: 0,
		annualExemption: 0,
		exemptAmount: 0,
		chargeableValue: status === 'undated' || status === 'after_death' ? 0 : roundMoney(gift.amount),
		status,
		yearsSurvived: survival?.years ?? 0,
		onAnniversary: survival?.onAnniversary ?? false,
		exemptOn,
		daysUntilExempt: status === 'survived' ? 0 : Math.max(0, daysToExempt),
		taperBand: band,
		taperReliefPct: band.reliefPct,
		effectiveRatePct: band.effectiveRatePct,
		nilRateBandUsed: 0,
		cumulativeChargeable: 0,
		taxableValue: 0,
		taxBeforeTaper: 0,
		taperRelief: 0,
		tax: 0
	};
}

/**
 * The countdown on its own: every gift still inside its seven years, soonest to fall out first.
 *
 * This is the same assessment {@link lifetimeGiftLedger} produces — run against today unless told
 * otherwise — filtered to the rows a "gifts still counting" panel would show. Gifts that are already
 * exempt, already survived, undated or dated in the future are left out.
 *
 * @param {readonly Partial<Gift>[] | undefined | null} gifts
 * @param {GiftLedgerOptions} [options]
 * @returns {GiftAssessment[]}
 */
export function giftCountdown(gifts, options = {}) {
	return lifetimeGiftLedger(gifts, options).gifts.filter((gift) => gift.status === 'failed');
}

/* -------------------------------------------------------------------------- */
/* The estate, with gifts                                                      */
/* -------------------------------------------------------------------------- */

/**
 * An estate and the gifts made before it, assessed together.
 *
 * @typedef {object} EstateWithGifts
 * @property {string} taxYear The tax year the bands came from.
 * @property {string} deathDate The date assessed against, ISO `YYYY-MM-DD`.
 * @property {import('./estate.js').NilRateBandPair} bands The statutory bands before any transfer —
 *   carried so {@link transferableAllowancesAfterGifts} can measure against them.
 * @property {number} nilRateBand The estate's whole nil-rate band, transferred share included, before
 *   the gifts take any of it (£).
 * @property {LifetimeGiftLedger} ledger Every gift, assessed.
 * @property {import('./estate.js').IhtCalculation} estate The estate's own bill, worked out by
 *   `estate.js` against whatever nil-rate band the gifts left.
 * @property {number} nilRateBandUsedByGifts (£)
 * @property {number} nilRateBandUsedByEstate (£)
 * @property {number} giftTax Tax on the failed gifts, payable by the people who received them (£).
 * @property {number} estateTax Tax on the estate, payable out of the estate (£).
 * @property {number} totalTax The two added (£) — the whole cost of the death.
 * @property {number} taxIfGiftsSurvived What this same estate would pay if every gift had already
 *   dropped out of account (£) — i.e. the whole nil-rate band to the estate and nothing charged on
 *   the gifts. The "seven more years and you are clear" figure.
 * @property {number} costOfFailedGifts `totalTax - taxIfGiftsSurvived` (£) — what dying now rather
 *   than after the countdown costs. Never negative.
 * @property {number} taxIfNothingGifted What would have been paid had the money never been given
 *   away (£): the estate grown by everything gifted, with no gifts to charge. **Valued at what was
 *   given, with no growth on the money in the meantime** — the honest comparison for cash, and an
 *   understatement for anything that would have appreciated. Note this can also drag the estate back
 *   over the £2,000,000 residence-band taper, which is often the larger half of what gifting
 *   achieved.
 * @property {number} giftSaving `taxIfNothingGifted - totalTax` (£). Positive is the hoped-for case:
 *   the gifting saved that much. Negative means it has cost more so far than keeping the money
 *   would have, which is the normal position for a gift made recently.
 */

/**
 * The whole picture: gifts first, estate second, per convention 3.
 *
 * The nil-rate band is read off {@link estateAllowances} — so a transferred percentage is applied
 * once, to the whole band, before anything spends it — handed to {@link lifetimeGiftLedger}, and
 * what comes back unspent is given to `estate.js`'s {@link inheritanceTax} as that estate's band.
 * The residence nil-rate band is passed through untouched: it can only ever attach to a home passing
 * on death, so no lifetime gift can consume it.
 *
 * @param {import('./estate.js').EstateInput} [estate]
 * @param {readonly Partial<Gift>[] | undefined | null} [gifts]
 * @param {GiftLedgerOptions & { bands?: import('./estate.js').NilRateBandPair, taxYear?: string }}
 *   [options]
 * @returns {EstateWithGifts}
 */
export function inheritanceTaxWithGifts(estate = {}, gifts = [], options = {}) {
	const bands = options.bands ?? STATUTORY_NIL_RATE_BANDS;
	const taxYear = options.taxYear ?? GIFT_TAX_YEAR;
	const config = normaliseEstate(estate);

	// The band at death, transferred share included — convention 3.
	const nilRateBand = estateAllowances(config, bands).nrb;
	const ledger = lifetimeGiftLedger(gifts, { ...options, nilRateBand });

	// The transfer is already inside `nilRateBand`, so it must not be applied a second time to the
	// remainder: the estate is re-stated with nothing transferred and given the leftover band.
	const estateCalculation = inheritanceTax(
		{ ...config, transferredNilRateBandPct: 0 },
		{ nrb: ledger.nilRateBandRemaining, rnrb: bands.rnrb },
		taxYear
	);
	// Two counterfactuals, both stated because they answer different questions: "what happens if I
	// survive the countdown?" and "was giving it away worth it at all?".
	const ifGiftsSurvived = inheritanceTax(config, bands, taxYear);
	const ifNothingGifted = inheritanceTax(
		{ ...config, estateValue: roundMoney(config.estateValue + ledger.totalGifted) },
		bands,
		taxYear
	);
	const totalTax = roundMoney(ledger.tax + estateCalculation.tax);

	return {
		taxYear,
		deathDate: ledger.deathDate,
		bands: { nrb: bands.nrb, rnrb: bands.rnrb },
		nilRateBand,
		ledger,
		estate: estateCalculation,
		nilRateBandUsedByGifts: ledger.nilRateBandUsed,
		nilRateBandUsedByEstate: estateCalculation.nilRateBandUsed,
		giftTax: ledger.tax,
		estateTax: estateCalculation.tax,
		totalTax,
		taxIfGiftsSurvived: ifGiftsSurvived.tax,
		costOfFailedGifts: roundMoney(totalTax - ifGiftsSurvived.tax),
		taxIfNothingGifted: ifNothingGifted.tax,
		giftSaving: roundMoney(ifNothingGifted.tax - totalTax)
	};
}

/**
 * What a first death leaves to the survivor, once gifts have had their share of the band.
 *
 * `estate.js`'s {@link transferableAllowances} measures the unused percentage against the band the
 * estate was assessed on — which, after {@link inheritanceTaxWithGifts}, is already net of the
 * gifts. Handing it that reduced band would report a first estate as having more left over than it
 * does. This restates the calculation against the true statutory band with the gifts' share counted
 * as used, and then defers to `estate.js` for the arithmetic and the three readings it documents.
 *
 * @param {EstateWithGifts} result
 * @param {import('./estate.js').NilRateBandPair} [bands] The bands the survivor's own estate will be
 *   assessed against; defaults to `estate.js`'s statutory pair.
 * @returns {import('./estate.js').TransferableAllowances}
 */
export function transferableAllowancesAfterGifts(result, bands = STATUTORY_NIL_RATE_BANDS) {
	return transferableAllowances(
		{
			...result.estate,
			bands: result.bands,
			nilRateBandUsed: roundMoney(result.nilRateBandUsedByGifts + result.estate.nilRateBandUsed)
		},
		bands
	);
}
