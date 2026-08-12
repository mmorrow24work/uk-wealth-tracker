/**
 * Capital Gains Tax on a residential property disposal, 2026/27 — README.md → "Capital Gains Tax
 * on Property (2026/27)": the £3,000 annual exempt amount, the 18%/24% residential rates, and
 * Private Residence Relief time-apportioned over the whole ownership period plus the last nine
 * months (issue #245).
 *
 * `$lib/model.js` already owns the three fields this reads — `purchase_price`, `purchase_date` and
 * `let_from` were added to `Property` in the previous issue in this milestone (#244) specifically
 * for this engine. This module is the calculation only; the Tax tab's panel over it is the next
 * issue.
 *
 * Eight conventions decide what the numbers here mean:
 *
 * 1. **This is a scenario tool, not a record of a sale.** The caller supplies a hypothetical
 *    `salePrice` and `saleDate` — "what would I pay if I sold on date X for price Y" — and nothing
 *    here is written back to the property. Nothing assumes the sale date is in the future either: a
 *    past date is a perfectly good question to ask.
 * 2. **The gain is `salePrice - purchase_price`, and nothing else is deducted.** Allowable costs —
 *    the stamp duty paid on the purchase, legal and agent fees at both ends, and capital
 *    improvements — are genuinely deductible in real life and are *not* modelled here (see "what
 *    this deliberately does not model"). Every figure this module returns is therefore the
 *    pessimistic end of the range: a real disposal with costs to deduct pays this much tax or less.
 * 3. **Private Residence Relief is time-apportioned across the *whole* ownership period.** The
 *    exempt fraction is `days the property was (or is deemed to have been) the main residence ÷
 *    days owned`, measured from `purchase_date` to the hypothetical sale date. It is a fraction of
 *    the *gain*, not of the price, and it is applied before the annual exempt amount.
 * 4. **The last {@link PRR_FINAL_PERIOD_MONTHS} months of ownership are deemed occupation** —
 *    whatever the property was actually used for in that window, including being let — *provided*
 *    it was the main residence at some point during ownership. A property that was never a main
 *    residence gets neither PRR nor the final period: see {@link privateResidenceReliefPeriod}.
 * 5. **`let_from` decides the occupied period, and `type` only decides what `let_from: null`
 *    means** — the reading `Property.let_from`'s own doc comment states. A date means "lived in as
 *    the main residence from purchase until that date, let from then on". `null` means "lived in
 *    throughout" for a primary/rented residence and "let throughout, never a main residence" for a
 *    buy-to-let or holiday home.
 * 6. **The annual exempt amount comes off the relieved gain, and does not use up band space.**
 *    Unlike `dividend-tax.js`'s £500 dividend allowance (a nil-*rate band*, which does use band
 *    space), the CGT annual exempt amount is an exemption: the pounds it covers are removed from
 *    the calculation entirely before the gain is stacked on top of income.
 * 7. **The rate depends on where the taxable gain sits against the seller's *other* income, and
 *    those bands are UK-wide.** The gain is the top slice: taxable income is worked out first, with
 *    `tax.js`'s own personal allowance and taper, and the gain stacked on top of it decides how
 *    much is charged at 18% and how much at 24%. `profile.tax_region` deliberately has no effect —
 *    Scotland sets rates and bands for non-savings, non-dividend *income* only, so a Scottish
 *    taxpayer's gains are measured against the same £37,700 basic rate limit as everybody else's.
 *    This is the same "the region selector correctly does nothing here" case `dividend-tax.js`'s
 *    convention (2) documents.
 * 8. **A loss is £0 of tax, not negative tax, and creates nothing.** A sale price below the
 *    purchase price is reported as a negative `gain` with `isLoss: true` and no tax — but no
 *    carry-forward loss is produced, because nothing in this app tracks losses to carry it forward
 *    into, and inventing one would imply relief this app cannot follow through on.
 *
 * ## Worked example
 *
 * Bought 1 January 2010 for £200,000, lived in as the main residence, let out from 1 January 2018,
 * sold 1 January 2026 for £500,000, by a seller with £60,000 of other income. It is a test in
 * `capital-gains.test.js`, and it is the example this module was written against:
 *
 * ```text
 * gain                          500,000 - 200,000                    = £300,000
 * owned                         2010-01-01 → 2026-01-01              = 5,844 days
 * lived in                      2010-01-01 → 2018-01-01              = 2,922 days
 * final 9 months (deemed)       2025-04-01 → 2026-01-01              =   275 days
 * relieved fraction             (2,922 + 275) / 5,844                = 54.7057%
 * Private Residence Relief      300,000 × 3,197 / 5,844              = £164,117.04
 * gain after relief                                                  = £135,882.96
 * less annual exempt amount     3,000                                = £132,882.96
 * other taxable income          60,000 - 12,570 = 47,430 → no basic rate band left
 * tax                           132,882.96 × 24%                     = £31,891.91
 * ```
 *
 * ## What this deliberately does not model
 *
 * - **Allowable costs** — convention (2). Purchase stamp duty, conveyancing, survey and estate
 *   agent fees and capital improvements all reduce a real gain, and none of them has a field on
 *   `Property` to read. Adding them is a data-model change, so this first pass states the omission
 *   rather than quietly assuming zero costs is the truth: every figure here is a ceiling.
 * - **Letting Relief.** Abolished for disposals from 6 April 2020 except where the owner *shared*
 *   occupancy of the dwelling with the tenant — a narrow case this app records nothing about (a
 *   lodger and a let-out flat look identical in `Property`). Applying it on the strength of
 *   `let_from` alone would hand most users a relief they are not entitled to and understate a real
 *   bill, so it is not applied at all.
 * - **Joint ownership and spousal transfers.** The whole gain, the whole annual exempt amount and
 *   one set of bands belong to one person here. A jointly owned property is really two disposals of
 *   a share each, with an annual exempt amount and a band position per owner — `Property` has no
 *   ownership-share field, and `Investment.ownership_pct`'s household lens does not extend to it.
 * - **Loss carry-forward** — convention (8).
 * - **Other disposals in the same tax year.** The annual exempt amount is assumed to be wholly
 *   available to this one disposal; in real life it is shared across every gain in the year, so a
 *   seller who has already used it elsewhere pays up to `24% × £3,000 = £720` more than this says.
 * - **Deemed occupation for absences** — job-related absences (up to 3 years for any reason, 4
 *   years working elsewhere in the UK, unlimited working overseas), which can count as occupation
 *   where the owner returns afterwards. `Property` records no absence history to work them out
 *   from.
 * - **The 36-month final period** available to a disabled person or someone moving into a care
 *   home, in place of the nine months everyone else gets. There is no field recording either.
 * - **Restrictions on PRR itself** — grounds over half a hectare, part of the dwelling used
 *   exclusively for business, a second home nominated as the main residence, or a period of
 *   ownership before 31 March 1982.
 * - **Non-residential rates, trusts, companies, non-residents, and the carried-interest rate.**
 *   Everything here is one UK-resident individual disposing of UK residential property.
 * - **The 60-day reporting and payment deadline** for UK residential property disposals. That is a
 *   deadline, not an amount, and belongs to the panel this engine feeds rather than to the
 *   arithmetic.
 * - **Any tax year other than 2026/27.** Every rate and threshold below is a frozen constant.
 *
 * Every figure is in pounds, rounded to whole pence. Rates are whole-number percents (`24` = 24%),
 * matching `tax.js` and `types.js`. Everything is pure: a property, a price and a date go in, plain
 * objects come out, and nothing reads the clock — a sale date is always the caller's to state, the
 * same repeatability `property.js`'s `dealExpiryStatus` gets from taking `now` explicitly.
 *
 * **Sourcing note.** README.md's "Capital Gains Tax on Property (2026/27)" section states these
 * same figures and carries the same caveat: this session had no network access, so gov.uk could not
 * be re-read to confirm them (the constraint `estate.js` and `budget-policy.js` already record for
 * their own figures). Each figure below is stated with what it rests on, and the two that are
 * least certain — see {@link CGT_ANNUAL_EXEMPT_AMOUNT} and {@link RESIDENTIAL_CGT_HIGHER_RATE} —
 * say so in their own doc comments rather than being presented as settled fact. They are stated
 * once here and imported everywhere else, so correcting one is a one-line change.
 */

import { PROPERTY_TYPES } from './enums.js';
import { ENGLAND_WALES_NI_BANDS, taxableIncome } from './tax.js';

/*
 * As elsewhere in `$lib`: model types are referenced inline as `import('./types.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *` and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asFinite(value, fallback) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** @param {unknown} value @returns {number} A non-negative, finite amount of money. */
function asMoney(value) {
	return Math.max(0, asFinite(value, 0));
}

/* -------------------------------------------------------------------------- */
/* The tax year and its statutory figures                                      */
/* -------------------------------------------------------------------------- */

/** The tax year every figure in this module belongs to — matches `tax.js`'s own `TAX_YEAR`. */
export const CGT_TAX_YEAR = '2026/27';

/**
 * The capital gains annual exempt amount for an individual (£/yr).
 *
 * £3,000 since 6 April 2024, when it fell from £6,000 (and £12,300 the year before that) — the
 * "changed significantly in recent Budgets" this issue warns about, which is exactly why it is
 * stated here rather than assumed. **Confidence: good, not verified.** It has been £3,000 for two
 * tax years and was not announced as changing for 2026/27 as far as this session could establish,
 * but with no network access gov.uk could not be re-read to confirm it (see the sourcing note in
 * the module header). If it has moved, this constant and README.md's CGT section are the only two
 * places to change.
 */
export const CGT_ANNUAL_EXEMPT_AMOUNT = 3_000;

/**
 * The residential-property CGT rate where the gain falls inside the basic rate band (%).
 *
 * Residential property has its own rates, distinct from the "other assets" rates for most of this
 * decade — though the two have coincided since 30 October 2024, when the other-asset rates were
 * raised to match this pair rather than the other way round. **Confidence: good, not verified** —
 * as above.
 */
export const RESIDENTIAL_CGT_BASIC_RATE = 18;

/**
 * The residential-property CGT rate above the basic rate band (%).
 *
 * 24% since 6 April 2024, when the higher residential rate was cut from 28%. It applies to
 * higher-rate *and* additional-rate taxpayers alike: unlike income tax and dividend tax, CGT has no
 * third rate above £125,140, so this module's ladder stops at two rungs. **Confidence: good, not
 * verified** — the same caveat as {@link CGT_ANNUAL_EXEMPT_AMOUNT}, and the figure most worth
 * re-checking against gov.uk before anyone relies on a number this module produces, since it is the
 * rate almost every property disposal large enough to be taxable ends up paying.
 */
export const RESIDENTIAL_CGT_HIGHER_RATE = 24;

/**
 * The final period of ownership that counts as deemed occupation, in months — convention (4).
 *
 * Nine months for disposals from 6 April 2020, down from 18 months before that (and 36 before
 * 2014). **Confidence: good, not verified** — as above. The 36-month version still available to a
 * disabled person or a care home resident is not modelled; see the module header.
 */
export const PRR_FINAL_PERIOD_MONTHS = 9;

/**
 * The UK basic rate limit (£ of taxable income) — where the 18% rate gives way to 24%.
 *
 * Taken from `tax.js`'s England/Wales/NI ladder rather than restated, per this issue: there is one
 * statement of £37,700 in the codebase and this reads it. Deriving it from the *England/Wales/NI*
 * ladder specifically, and never from `bandsFor(profile.tax_region)`, is convention (7) — CGT is
 * charged against UK-wide bands, and Scotland's ladder has no £37,700 boundary at all, so asking it
 * for one would be wrong for exactly the region that most needs this to be right.
 *
 * The `?? 37_700` fallback is unreachable (the ladder always has a `basic` band, and its `to` is
 * never `null`); it exists so the exported constant is a plain `number` rather than
 * `number | null | undefined`, and it states the figure the ladder is expected to carry.
 */
export const CGT_BASIC_RATE_LIMIT =
	ENGLAND_WALES_NI_BANDS.find((band) => band.id === 'basic')?.to ?? 37_700;

/**
 * One CGT rate band, expressed on taxable income the same way `tax.js`'s `TaxBand` is (convention
 * (1) there): `from`/`to` are pounds of income *after* the personal allowance, and each band is a
 * half-open slice `[from, to)`.
 *
 * @typedef {object} CgtBand
 * @property {string} id Stable code.
 * @property {string} label HMRC's own name for the rate.
 * @property {number} rate CGT rate (%).
 * @property {number} from Taxable income the band starts at (£), inclusive.
 * @property {number | null} to Taxable income the band ends at (£), exclusive; `null` = no ceiling.
 */

/**
 * The two residential-property CGT rates, 2026/27, UK-wide — convention (7). Two rungs, not three:
 * there is no additional-rate CGT band, so a gain sitting above £125,140 of income is charged at
 * the same 24% as one just above £37,700.
 *
 * @type {readonly CgtBand[]}
 */
export const RESIDENTIAL_CGT_BANDS = Object.freeze([
	Object.freeze({
		id: 'basic',
		label: 'Basic rate',
		rate: RESIDENTIAL_CGT_BASIC_RATE,
		from: 0,
		to: CGT_BASIC_RATE_LIMIT
	}),
	Object.freeze({
		id: 'higher',
		label: 'Higher rate',
		rate: RESIDENTIAL_CGT_HIGHER_RATE,
		from: CGT_BASIC_RATE_LIMIT,
		to: null
	})
]);

/**
 * Property types whose `let_from: null` means "lived in as the main residence throughout" rather
 * than "let throughout" — convention (5), and `Property.let_from`'s own doc comment.
 *
 * `rented_residence` is in this list because that doc comment puts it there. It is the odd one:
 * the label is "Rented (I'm the tenant)", so the user does not own it and no disposal can arise in
 * the first place. Treating it as fully relieved answers £0, which is the same answer as "this
 * question does not apply to you" — the reading that cannot overstate a bill.
 *
 * @type {readonly import('./enums.js').PropertyType[]}
 */
export const MAIN_RESIDENCE_PROPERTY_TYPES = Object.freeze([
	'primary_residence',
	'rented_residence'
]);

/* -------------------------------------------------------------------------- */
/* Warnings                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The things this engine can only say in words, exported so the panel over it shows the same
 * sentence this module means rather than paraphrasing it. Each appears in
 * {@link CapitalGainsBreakdown.warnings} when the input calls for it.
 */
export const CGT_WARNINGS = Object.freeze({
	noPurchaseDate:
		'No purchase date recorded for this property, so the ownership period — and therefore Private Residence Relief — cannot be worked out.',
	noSaleDate: 'No valid sale date given, so there is no ownership period to apportion relief over.',
	saleBeforePurchase:
		'The sale date is before the purchase date, so there is nothing to calculate.',
	noPurchasePrice:
		'No purchase price recorded, so the whole sale price is being treated as the gain. Record what you paid to get a meaningful figure.',
	unknownPropertyType:
		'This property has no recognised type, so it has been treated as never having been your main residence — no Private Residence Relief has been applied.',
	costsNotDeducted:
		'Buying and selling costs and capital improvements are not deducted, so the real tax would be lower.'
});

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

/** Milliseconds in a day. Every date here is UTC midnight, so this division is exact. */
const MS_PER_DAY = 86_400_000;

/**
 * Parse an ISO `YYYY-MM-DD` date as UTC midnight — the same convention `property.js`'s
 * `dealExpiryStatus` and `assets.js`'s `yearsOwned` use, so a period measured here is the same
 * length whatever timezone the browser is in.
 *
 * Strict about the format and round-trips the result, exactly as `model.js`'s own `isIsoDate` does
 * and for the same reason: `Date` silently rolls `2026-02-30` forward to 2 March, and a relief
 * period apportioned from a date the user never wrote is worse than one that reports itself as
 * unavailable. `model.js` normalises `purchase_date`/`let_from` through that same check, so a
 * stored property can only ever reach here with dates this accepts.
 *
 * @param {unknown} value
 * @returns {Date | null} `null` for anything that is not a usable date.
 */
function parseIsoDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const date = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString().slice(0, 10) === value ? date : null;
}

/**
 * @param {Date} from
 * @param {Date} to
 * @returns {number} Whole days from `from` to `to`; negative if `to` is the earlier of the two.
 */
function daysBetween(from, to) {
	return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * The same day-of-month `months` months earlier, clamped to the target month's length so that
 * "nine months before 31 March" is 30 June rather than spilling forward into 1 July. Calendar
 * months, not 30-day approximations: HMRC's final period is stated in months, and a period measured
 * in days from a month-based boundary is exact, whereas `9 × 30` would be short by a few days for
 * most sale dates.
 *
 * @param {Date} date UTC midnight.
 * @param {number} months
 * @returns {Date} UTC midnight.
 */
function monthsBefore(date, months) {
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth();
	const day = date.getUTCDate();
	// Day 0 of the month after the target month is the last day of the target month.
	const daysInTargetMonth = new Date(Date.UTC(year, month - months + 1, 0)).getUTCDate();
	return new Date(Date.UTC(year, month - months, Math.min(day, daysInTargetMonth)));
}

/* -------------------------------------------------------------------------- */
/* Private Residence Relief: the time apportionment                            */
/* -------------------------------------------------------------------------- */

/**
 * How the ownership period splits between occupied, deemed-occupied and let — conventions (3), (4)
 * and (5). Every day count is a whole number of days; `reliefFraction` is left unrounded for the
 * caller to apply to a gain.
 *
 * @typedef {object} PrivateResidenceReliefPeriod
 * @property {boolean} known Whether there was enough on the record to work any of this out — a
 *   `purchase_date`, a sale date, and the sale not before the purchase. Everything below is `0` or
 *   `false` when this is `false`, the same explicit "unavailable" shape `milestones.js`'s
 *   `retirementMarker` uses rather than a guess.
 * @property {string | null} ownershipStart `purchase_date`, ISO `YYYY-MM-DD`.
 * @property {string | null} ownershipEnd The hypothetical sale date, ISO `YYYY-MM-DD`.
 * @property {number} totalDays Days owned, purchase to sale. `0` for a same-day sale.
 * @property {number} occupiedDays Days actually lived in as the main residence — always the opening
 *   stretch of ownership, per convention (5).
 * @property {number} finalPeriodDays Days of deemed occupation at the end of ownership
 *   ({@link PRR_FINAL_PERIOD_MONTHS} months, capped at the ownership period, `0` where the property
 *   was never a main residence).
 * @property {number} reliefDays `occupiedDays + finalPeriodDays`, capped at `totalDays` — the two
 *   can overlap on a short ownership, and a day cannot be relieved twice.
 * @property {number} reliefFraction `reliefDays / totalDays`, `0`…`1`. Unrounded.
 * @property {boolean} everMainResidence Whether the property was the main residence at any point —
 *   what the final-period exemption is conditional on.
 * @property {string | null} letFrom The date letting started, ISO `YYYY-MM-DD`, or `null` where the
 *   record carries none (which does *not* mean it was never let — see convention (5)).
 */

/** @type {PrivateResidenceReliefPeriod} */
const UNKNOWN_PERIOD = Object.freeze({
	known: false,
	ownershipStart: null,
	ownershipEnd: null,
	totalDays: 0,
	occupiedDays: 0,
	finalPeriodDays: 0,
	reliefDays: 0,
	reliefFraction: 0,
	everMainResidence: false,
	letFrom: null
});

/**
 * Split an ownership period into the part Private Residence Relief covers and the part it does not.
 *
 * The occupied period is always a prefix of ownership (`purchase_date` → `let_from`) and the final
 * period is always a suffix (the last {@link PRR_FINAL_PERIOD_MONTHS} months), so the relieved days
 * are the union of the two: their sum, capped at the ownership period where a short ownership makes
 * them overlap. That cap is what stops a property lived in for its whole three-month ownership from
 * claiming 12 months of relief out of 3.
 *
 * A `let_from` outside the ownership window is clamped into it rather than rejected: a date before
 * the purchase reads as "let from the day it was bought" (no occupied period at all), and one after
 * the sale as "still not let when it was sold" (occupied throughout).
 *
 * @param {Partial<import('./types.js').Property> | null} [property]
 * @param {string | null} [saleDate] ISO `YYYY-MM-DD`.
 * @returns {PrivateResidenceReliefPeriod}
 */
export function privateResidenceReliefPeriod(property, saleDate) {
	const start = parseIsoDate(property?.purchase_date);
	const end = parseIsoDate(saleDate);
	if (!start || !end) return { ...UNKNOWN_PERIOD };

	const totalDays = daysBetween(start, end);
	if (totalDays < 0) return { ...UNKNOWN_PERIOD };

	const letFrom = parseIsoDate(property?.let_from);
	const livedInThroughout = MAIN_RESIDENCE_PROPERTY_TYPES.includes(
		/** @type {import('./enums.js').PropertyType} */ (property?.type)
	);

	// Convention (5): a `let_from` date states the split directly; without one, `type` decides
	// whether the whole period was occupied or none of it was.
	const occupiedDays = letFrom
		? Math.min(totalDays, Math.max(0, daysBetween(start, letFrom)))
		: livedInThroughout
			? totalDays
			: 0;

	// `occupiedDays > 0` would answer "no" for a same-day sale of a home lived in throughout, so the
	// question is asked of the record rather than of the day count.
	const everMainResidence = letFrom ? daysBetween(start, letFrom) > 0 : livedInThroughout;

	// Convention (4): the final period is deemed occupation only for a property that was a main
	// residence at some point — a buy-to-let let for its whole life gets nothing.
	const finalPeriodStart = monthsBefore(end, PRR_FINAL_PERIOD_MONTHS);
	const finalPeriodDays = everMainResidence
		? Math.min(totalDays, Math.max(0, daysBetween(finalPeriodStart, end)))
		: 0;

	const reliefDays = Math.min(totalDays, occupiedDays + finalPeriodDays);

	return {
		known: true,
		ownershipStart: /** @type {string} */ (property?.purchase_date),
		ownershipEnd: /** @type {string} */ (saleDate),
		totalDays,
		occupiedDays,
		finalPeriodDays,
		reliefDays,
		// A same-day sale has no period to apportion over: relief is all or nothing, decided by
		// whether it was ever the main residence, rather than a division by zero.
		reliefFraction: totalDays > 0 ? reliefDays / totalDays : everMainResidence ? 1 : 0,
		everMainResidence,
		letFrom: typeof property?.let_from === 'string' ? property.let_from : null
	};
}

/* -------------------------------------------------------------------------- */
/* The whole calculation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The hypothetical disposal a caller is asking about — convention (1).
 *
 * @typedef {object} CapitalGainsInput
 * @property {Partial<import('./types.js').Property> | null} property The property being sold;
 *   `purchase_price`, `purchase_date`, `let_from` and `type` are the fields read.
 * @property {number} salePrice What it would sell for (£).
 * @property {string | null} saleDate When, ISO `YYYY-MM-DD`.
 * @property {number} otherIncome The seller's other income for the same tax year (£/yr) — gross
 *   adjusted net income, exactly what `tax.js`'s `takeHomeBreakdown` takes, not income after tax
 *   and not income after the personal allowance. Convention (7).
 */

/**
 * One row of the CGT rate ladder, as it applies to this disposal.
 *
 * @typedef {object} CgtBandSlice
 * @property {string} id
 * @property {string} label
 * @property {number} rate CGT rate (%).
 * @property {number} from Taxable income the band starts at (£).
 * @property {number | null} to Taxable income the band ends at (£); `null` = no ceiling.
 * @property {number} amount Taxable gain falling inside this band (£). `0` if not reached.
 * @property {number} tax Tax due on that amount (£).
 */

/**
 * Everything the Tax tab's CGT panel needs from one hypothetical disposal.
 *
 * `privateResidenceRelief` + `annualExemptAmountUsed` + every `bands[].amount` adds back up to
 * `gain` exactly whenever the gain is positive, so the breakdown accounts for every pound of gain
 * rather than only the taxed ones — the same property `tax.js`'s `TakeHomeBreakdown` and
 * `dividend-tax.js`'s `DividendTaxBreakdown` have.
 *
 * @typedef {object} CapitalGainsBreakdown
 * @property {string} taxYear Always {@link CGT_TAX_YEAR}.
 * @property {boolean} applicable Whether the disposal could be modelled at all — `false` when the
 *   property has no `purchase_date`, the sale date is missing or unparseable, or the sale falls
 *   before the purchase. Every money figure is `0` when it is `false`, and `warnings` says why:
 *   nothing here guesses at a bill it cannot work out.
 * @property {number} salePrice (£)
 * @property {number} purchasePrice (£) — `Property.purchase_price`.
 * @property {number} gain `salePrice - purchasePrice` (£). Negative on a loss.
 * @property {boolean} isLoss Whether `gain` is below zero — convention (8).
 * @property {number} chargeableGain The gain before any relief (£): `gain`, or `0` on a loss.
 * @property {PrivateResidenceReliefPeriod} period The time apportionment behind the relief.
 * @property {number} privateResidenceRelief (£) — `chargeableGain × period.reliefFraction`.
 * @property {number} gainAfterRelief (£)
 * @property {number} annualExemptAmount Always {@link CGT_ANNUAL_EXEMPT_AMOUNT} (£).
 * @property {number} annualExemptAmountUsed How much of it this gain used (£).
 * @property {number} annualExemptAmountRemaining Unused exemption (£) — headroom for another gain
 *   this tax year, subject to the "other disposals" caveat in the module header.
 * @property {number} taxableGain The gain actually charged (£), after relief and exemption.
 * @property {number} otherIncome As given (£/yr).
 * @property {number} taxableOtherIncome After the personal allowance and its taper (£/yr) — the
 *   figure the gain is stacked on top of.
 * @property {number} basicRateBandAvailable How much of the £37,700 basic rate band the seller's
 *   other income leaves for the gain (£).
 * @property {CgtBandSlice[]} bands Both rungs, in order, including one the gain never reaches.
 * @property {number} totalTax CGT due (£).
 * @property {number} gainAfterTax `gain - totalTax` (£) — what the disposal actually leaves,
 *   negative on a loss.
 * @property {number} effectiveRate Tax as a share of `chargeableGain` — the whole gain before any
 *   relief, or `0` on a loss (%). `0` where there is no gain to divide by, the same "a rate on
 *   nothing is not a meaningful figure" convention `tax.js`'s `effectiveTaxRate` uses. Lower than
 *   18%/24% wherever relief or the exemption bit, which is the comparison that makes them visible.
 * @property {string[]} warnings Data-dependent notes — see {@link CGT_WARNINGS}. Always includes
 *   {@link CGT_WARNINGS.costsNotDeducted} for a taxable gain, per convention (2).
 */

/**
 * @param {Partial<CapitalGainsInput>} [raw]
 * @returns {CapitalGainsBreakdown}
 */
export function capitalGainsTaxOnPropertySale(raw = {}) {
	const property = raw?.property ?? null;
	const salePrice = asMoney(raw?.salePrice);
	const purchasePrice = asMoney(property?.purchase_price);
	const saleDate = typeof raw?.saleDate === 'string' ? raw.saleDate : null;
	const otherIncome = asMoney(raw?.otherIncome);

	const period = privateResidenceReliefPeriod(property, saleDate);
	const taxableOtherIncome = taxableIncome(otherIncome);
	const basicRateBandAvailable = roundMoney(Math.max(0, CGT_BASIC_RATE_LIMIT - taxableOtherIncome));

	/** @type {string[]} */
	const warnings = [];

	if (!period.known) {
		if (!parseIsoDate(property?.purchase_date)) warnings.push(CGT_WARNINGS.noPurchaseDate);
		else if (!parseIsoDate(saleDate)) warnings.push(CGT_WARNINGS.noSaleDate);
		else warnings.push(CGT_WARNINGS.saleBeforePurchase);

		return {
			taxYear: CGT_TAX_YEAR,
			applicable: false,
			salePrice,
			purchasePrice,
			gain: 0,
			isLoss: false,
			chargeableGain: 0,
			period,
			privateResidenceRelief: 0,
			gainAfterRelief: 0,
			annualExemptAmount: CGT_ANNUAL_EXEMPT_AMOUNT,
			annualExemptAmountUsed: 0,
			annualExemptAmountRemaining: CGT_ANNUAL_EXEMPT_AMOUNT,
			taxableGain: 0,
			otherIncome,
			taxableOtherIncome,
			basicRateBandAvailable,
			bands: sliceGainIntoBands(0, taxableOtherIncome),
			totalTax: 0,
			gainAfterTax: 0,
			effectiveRate: 0,
			warnings
		};
	}

	const gain = roundMoney(salePrice - purchasePrice);
	const isLoss = gain < 0;
	// Convention (8): a loss is not a negative gain to relieve, it is simply nothing to charge.
	const chargeableGain = isLoss ? 0 : gain;

	// Convention (3): relief is a fraction of the gain, applied before the exemption.
	const privateResidenceRelief = roundMoney(chargeableGain * period.reliefFraction);
	const gainAfterRelief = roundMoney(chargeableGain - privateResidenceRelief);

	// Convention (6): an exemption, not a nil-rate band — these pounds leave the calculation rather
	// than using up band space on the way past.
	const annualExemptAmountUsed = roundMoney(Math.min(CGT_ANNUAL_EXEMPT_AMOUNT, gainAfterRelief));
	const taxableGain = roundMoney(gainAfterRelief - annualExemptAmountUsed);

	const bands = sliceGainIntoBands(taxableGain, taxableOtherIncome);
	const totalTax = roundMoney(bands.reduce((total, band) => total + band.tax, 0));

	if (purchasePrice === 0) warnings.push(CGT_WARNINGS.noPurchasePrice);
	if (
		!period.everMainResidence &&
		!parseIsoDate(property?.let_from) &&
		!PROPERTY_TYPES.includes(/** @type {import('./enums.js').PropertyType} */ (property?.type))
	) {
		warnings.push(CGT_WARNINGS.unknownPropertyType);
	}
	if (taxableGain > 0) warnings.push(CGT_WARNINGS.costsNotDeducted);

	return {
		taxYear: CGT_TAX_YEAR,
		applicable: true,
		salePrice,
		purchasePrice,
		gain,
		isLoss,
		chargeableGain,
		period,
		privateResidenceRelief,
		gainAfterRelief,
		annualExemptAmount: CGT_ANNUAL_EXEMPT_AMOUNT,
		annualExemptAmountUsed,
		annualExemptAmountRemaining: roundMoney(CGT_ANNUAL_EXEMPT_AMOUNT - annualExemptAmountUsed),
		taxableGain,
		otherIncome,
		taxableOtherIncome,
		basicRateBandAvailable,
		bands,
		totalTax,
		gainAfterTax: roundMoney(gain - totalTax),
		effectiveRate: chargeableGain === 0 ? 0 : (totalTax / chargeableGain) * 100,
		warnings
	};
}

/**
 * Stack a taxable gain on top of taxable income and slice it across the two CGT rates — convention
 * (7). Both rungs always come back, including one the gain never reaches (`amount: 0`), so a panel
 * can render the whole ladder and show where the gain stops, the same shape `tax.js`'s
 * `sliceIntoBands` returns.
 *
 * @param {number} taxableGain (£)
 * @param {number} taxableOtherIncome Income after the personal allowance (£/yr).
 * @returns {CgtBandSlice[]}
 */
function sliceGainIntoBands(taxableGain, taxableOtherIncome) {
	const from = Math.max(0, taxableOtherIncome);
	const to = from + Math.max(0, taxableGain);

	return RESIDENTIAL_CGT_BANDS.map((band) => {
		const ceiling = band.to === null ? to : Math.min(to, band.to);
		const floor = Math.max(from, band.from);
		const amount = roundMoney(Math.max(0, ceiling - floor));
		return {
			id: band.id,
			label: band.label,
			rate: band.rate,
			from: band.from,
			to: band.to,
			amount,
			tax: roundMoney((amount * band.rate) / 100)
		};
	});
}

/**
 * Capital Gains Tax due on a hypothetical disposal, in one number — the same shorthand
 * `dividend-tax.js` offers over its own breakdown.
 *
 * @param {Partial<CapitalGainsInput>} [raw]
 * @returns {number} (£)
 */
export function capitalGainsTax(raw = {}) {
	return capitalGainsTaxOnPropertySale(raw).totalTax;
}

/*
 * Deliberately no `marginalCapitalGainsRate` here, unlike `dividend-tax.js`'s
 * `marginalDividendRate`. "The rate on the next pound" has no single honest answer for a partly
 * relieved disposal: an extra pound of *sale price* is an extra pound of gain, of which
 * `reliefFraction` is exempt, so the rate that pound actually costs is `18%`/`24%` scaled by the
 * unrelieved share — a different number from the statutory rate, and one nothing in this milestone
 * asks for. `CapitalGainsBreakdown.effectiveRate` already gives a panel the "what is this disposal
 * really costing me" figure, so a second, easily-misread rate is left out rather than shipped with
 * a caveat attached.
 */
