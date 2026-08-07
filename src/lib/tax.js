/**
 * UK income tax bands and take-home pay, 2026/27 — README.md → "UK Income Tax Calculator
 * (2026/27)": "England/Wales/NI and Scotland bands", "Take-home calculation band by band" and
 * "60% personal allowance taper (£100k–£125,140)" — issue #23.
 *
 * Five conventions decide what the numbers here mean:
 *
 * 1. **Bands are stated on *taxable* income, not gross.** HMRC publishes them as "income after
 *    allowances", and that is exactly how {@link INCOME_TAX_BANDS} stores them: a band's `from`/`to`
 *    are pounds of income *left after the personal allowance has been taken off*. Storing them on
 *    gross income instead would make every boundary move as the allowance tapers, which is the
 *    single easiest way to get the £100k–£125,140 region wrong.
 * 2. **Each band is a half-open slice `[from, to)`.** HMRC writes the England/Wales/NI basic rate as
 *    "up to £37,700" and the higher rate as "£37,701 to £125,140"; as slices that is `[0, 37700)`
 *    and `[37700, 125140)`, which gives the same answer at every whole pound and stays right for the
 *    pennies in between.
 * 3. **The personal allowance is part of the band arithmetic, not a separate step.** It tapers by £1
 *    for every £2 of income over £100,000 and is gone at £125,140 — which is *why* the additional
 *    and top rates start where they do. Modelling the bands without it would produce a wrong figure
 *    for every salary above £100,000, so {@link personalAllowance} lives here rather than waiting for
 *    #27. (Salary sacrifice, the other half of that issue, does not — see the notes below.)
 * 4. **"Take-home" here means gross income less *income tax*.** National Insurance, student loan
 *    repayments and pension contributions are not deducted: NI appears nowhere in README.md's
 *    functional spec and has no issue in the tax milestone, and student loans are #26. Every figure
 *    this module returns is labelled accordingly rather than presented as net pay.
 * 5. **One income figure goes in, and it is adjusted net income.** The taper is assessed on adjusted
 *    net income, so a caller that has already deducted salary sacrifice or relief-at-source pension
 *    contributions (#27) should pass the reduced figure and everything below follows automatically.
 *
 * Every figure is in pounds, rounded to whole pence. Rates are whole-number percents (`20` = 20%),
 * matching `types.js`'s convention. Everything is pure: an income and a region go in, plain objects
 * come out.
 *
 * Figures verified against HMRC's "Income Tax rates and allowances for current and previous tax
 * years" (gov.uk), 2026 to 2027 column, as updated 6 April 2026.
 */

import { TAX_REGIONS } from './enums.js';

/*
 * As in `forecast.js`/`fire.js`, model types are referenced inline as `import('./types.js').X`
 * rather than re-declared as local `@typedef`s, because `index.js` re-exports every module with
 * `export *` and svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The tax year                                                                */
/* -------------------------------------------------------------------------- */

/** The tax year every figure in this module belongs to. UK allowances change every April. */
export const TAX_YEAR = '2026/27';

/** The standard personal allowance, before any taper (£). Frozen at this figure since 2021/22. */
export const PERSONAL_ALLOWANCE = 12_570;

/** Adjusted net income above which the personal allowance starts to taper away (£). */
export const ALLOWANCE_TAPER_THRESHOLD = 100_000;

/** £1 of allowance is lost for every £2 of income over the threshold. */
export const ALLOWANCE_TAPER_DIVISOR = 2;

/**
 * The income at which the personal allowance reaches zero (£) —
 * `100,000 + 2 × 12,570`. README.md's "60% personal allowance taper (£100k–£125,140)" is this
 * range, and it is also where the additional (E/W/NI) and top (Scotland) rates begin, which is not
 * a coincidence: both thresholds were set to the point the allowance runs out.
 */
export const ALLOWANCE_EXHAUSTED_AT =
	ALLOWANCE_TAPER_THRESHOLD + ALLOWANCE_TAPER_DIVISOR * PERSONAL_ALLOWANCE;

/* -------------------------------------------------------------------------- */
/* Bands                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One statutory rate band, expressed on taxable income — convention (1).
 *
 * @typedef {object} TaxBand
 * @property {string} id Stable code, unique within its region's ladder.
 * @property {string} label HMRC's own name for the band.
 * @property {number} rate Tax rate (%), a whole-number percent.
 * @property {number} from Taxable income the band starts at (£), inclusive.
 * @property {number | null} to Taxable income the band ends at (£), exclusive; `null` = no ceiling.
 */

/**
 * England, Wales and Northern Ireland, 2026/27. HMRC: basic "up to £37,700", higher "£37,701 to
 * £125,140", additional "over £125,141" — as half-open slices on taxable income, per convention (2).
 *
 * @type {readonly TaxBand[]}
 */
export const ENGLAND_WALES_NI_BANDS = Object.freeze([
	Object.freeze({ id: 'basic', label: 'Basic rate', rate: 20, from: 0, to: 37_700 }),
	Object.freeze({ id: 'higher', label: 'Higher rate', rate: 40, from: 37_700, to: 125_140 }),
	Object.freeze({ id: 'additional', label: 'Additional rate', rate: 45, from: 125_140, to: null })
]);

/**
 * Scotland, 2026/27 — six bands rather than three, and the rates differ above the basic rate.
 *
 * A useful cross-check on the taxable-income figures below: adding the full £12,570 allowance to
 * each ceiling reproduces the thresholds the Scottish Government publishes on *gross* income —
 * £16,537 (starter), £29,526 (basic), £43,662 (the Scottish higher-rate threshold), £75,000 (the
 * advanced-rate threshold). The advanced band's £125,140 ceiling needs no such adjustment because
 * the allowance is already zero by then.
 *
 * @type {readonly TaxBand[]}
 */
export const SCOTLAND_BANDS = Object.freeze([
	Object.freeze({ id: 'starter', label: 'Starter rate', rate: 19, from: 0, to: 3_967 }),
	Object.freeze({ id: 'basic', label: 'Basic rate', rate: 20, from: 3_967, to: 16_956 }),
	Object.freeze({
		id: 'intermediate',
		label: 'Intermediate rate',
		rate: 21,
		from: 16_956,
		to: 31_092
	}),
	Object.freeze({ id: 'higher', label: 'Higher rate', rate: 42, from: 31_092, to: 62_430 }),
	Object.freeze({ id: 'advanced', label: 'Advanced rate', rate: 45, from: 62_430, to: 125_140 }),
	Object.freeze({ id: 'top', label: 'Top rate', rate: 48, from: 125_140, to: null })
]);

/**
 * The band ladder for each `TaxRegion`.
 *
 * @type {Record<import('./enums.js').TaxRegion, readonly TaxBand[]>}
 */
export const INCOME_TAX_BANDS = Object.freeze({
	england_wales_ni: ENGLAND_WALES_NI_BANDS,
	scotland: SCOTLAND_BANDS
});

/** The region used when a caller passes something that isn't a `TaxRegion` — matches `model.js`. */
export const DEFAULT_TAX_REGION = 'england_wales_ni';

/**
 * The band ladder for a region, falling back to England/Wales/NI for anything unrecognised — the
 * same tolerant reading `normaliseAppData` gives a bad `profile.tax_region`.
 *
 * @param {unknown} region
 * @returns {readonly TaxBand[]}
 */
export function bandsFor(region) {
	return INCOME_TAX_BANDS[normaliseTaxRegion(region)];
}

/**
 * Coerce anything into a `TaxRegion`, the same tolerant reading `normaliseAppData` gives
 * `profile.tax_region`.
 *
 * @param {unknown} region
 * @returns {import('./enums.js').TaxRegion}
 */
export function normaliseTaxRegion(region) {
	return TAX_REGIONS.includes(/** @type {import('./enums.js').TaxRegion} */ (region))
		? /** @type {import('./enums.js').TaxRegion} */ (region)
		: DEFAULT_TAX_REGION;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

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
/* The personal allowance                                                      */
/* -------------------------------------------------------------------------- */

/**
 * README.md's "60% personal allowance taper (£100k–£125,140)" — convention (3).
 *
 * The allowance falls by £1 for every £2 of adjusted net income over £100,000 and cannot go below
 * zero, so it is gone entirely at {@link ALLOWANCE_EXHAUSTED_AT}. The taper is what makes the
 * marginal rate in that band 60% in England/Wales/NI (40% on the pound, plus 40% on the 50p of
 * allowance it costs) and 67.5% in Scotland, where the surrounding rate is 45%.
 *
 * The allowance is a UK-wide figure: Scotland sets rates and bands, not allowances.
 *
 * @param {number} [adjustedNetIncome] (£/yr)
 * @returns {number} Personal allowance available (£).
 */
export function personalAllowance(adjustedNetIncome = 0) {
	const income = asMoney(adjustedNetIncome);
	if (income <= ALLOWANCE_TAPER_THRESHOLD) return PERSONAL_ALLOWANCE;
	const lost = (income - ALLOWANCE_TAPER_THRESHOLD) / ALLOWANCE_TAPER_DIVISOR;
	return roundMoney(Math.max(0, PERSONAL_ALLOWANCE - lost));
}

/**
 * How much of the standard allowance the taper has taken away (£). `0` below £100,000, the full
 * £12,570 at and above £125,140.
 *
 * @param {number} [adjustedNetIncome]
 * @returns {number}
 */
export function allowanceLostToTaper(adjustedNetIncome = 0) {
	return roundMoney(PERSONAL_ALLOWANCE - personalAllowance(adjustedNetIncome));
}

/**
 * Whether an income sits inside README.md's 60% band — the range over which each extra pound also
 * costs 50p of allowance. The lower edge is inclusive (the *next* pound above £100,000 is already
 * tapered) and the upper edge is not (at £125,140 there is no allowance left to lose).
 *
 * @param {number} [adjustedNetIncome]
 * @returns {boolean}
 */
export function inAllowanceTaper(adjustedNetIncome = 0) {
	const income = asMoney(adjustedNetIncome);
	return income >= ALLOWANCE_TAPER_THRESHOLD && income < ALLOWANCE_EXHAUSTED_AT;
}

/**
 * Income left to tax once the (possibly tapered) allowance has been taken off — what every band
 * boundary in this module is measured against.
 *
 * @param {number} [income] Adjusted net income (£/yr).
 * @returns {number} (£)
 */
export function taxableIncome(income = 0) {
	const gross = asMoney(income);
	return roundMoney(Math.max(0, gross - personalAllowance(gross)));
}

/* -------------------------------------------------------------------------- */
/* Band-by-band tax                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One row of README.md's "take-home calculation band by band".
 *
 * @typedef {object} TaxBandSlice
 * @property {string} id
 * @property {string} label
 * @property {number} rate Tax rate (%).
 * @property {number} from Taxable income the band starts at (£).
 * @property {number | null} to Taxable income the band ends at (£); `null` = no ceiling.
 * @property {number} amount Taxable income falling inside this band (£). `0` if not reached.
 * @property {number} tax Tax due on that amount (£).
 */

/**
 * Slice a taxable income across a region's bands. Every band in the ladder comes back, including
 * the ones the income never reaches (`amount: 0`), so a caller can render the whole ladder and show
 * where the income stops rather than only the part of it that was used.
 *
 * @param {number} [taxable] Income after allowances (£) — see convention (1).
 * @param {unknown} [region]
 * @returns {TaxBandSlice[]}
 */
export function sliceIntoBands(taxable = 0, region = DEFAULT_TAX_REGION) {
	const amount = asMoney(taxable);

	return bandsFor(region).map((band) => {
		const ceiling = band.to === null ? amount : Math.min(amount, band.to);
		const inBand = roundMoney(Math.max(0, ceiling - band.from));
		return {
			id: band.id,
			label: band.label,
			rate: band.rate,
			from: band.from,
			to: band.to,
			amount: inBand,
			tax: roundMoney((inBand * band.rate) / 100)
		};
	});
}

/**
 * Income tax due on an income, in one number.
 *
 * @param {number} [income] Adjusted net income (£/yr).
 * @param {unknown} [region]
 * @returns {number} Income tax (£/yr).
 */
export function incomeTax(income = 0, region = DEFAULT_TAX_REGION) {
	return roundMoney(
		sliceIntoBands(taxableIncome(income), region).reduce((total, slice) => total + slice.tax, 0)
	);
}

/**
 * Income less income tax — convention (4): this is *not* net pay, because National Insurance,
 * student loan repayments and pension contributions have not been deducted.
 *
 * @param {number} [income]
 * @param {unknown} [region]
 * @returns {number} (£/yr)
 */
export function takeHomePay(income = 0, region = DEFAULT_TAX_REGION) {
	return roundMoney(asMoney(income) - incomeTax(income, region));
}

/**
 * Tax paid as a share of total income (%). `0` on an income of nothing — a rate on no income is not
 * a meaningful figure, and dividing by zero here would put `NaN` on screen.
 *
 * @param {number} [income]
 * @param {unknown} [region]
 * @returns {number} (%)
 */
export function effectiveTaxRate(income = 0, region = DEFAULT_TAX_REGION) {
	const gross = asMoney(income);
	if (gross === 0) return 0;
	return (incomeTax(gross, region) / gross) * 100;
}

/**
 * The rate the *next* pound of income is taxed at (%), taper included — README.md's 60% band falls
 * straight out of this rather than being special-cased.
 *
 * Below the allowance the answer is 0%. Inside it the answer is the surrounding band's rate. Between
 * £100,000 and £125,140 each extra pound is taxed at that rate *and* costs 50p of allowance, which
 * is itself then taxed at the same rate — so the rate is multiplied by 1.5, giving 60% in
 * England/Wales/NI and 67.5% in Scotland.
 *
 * @param {number} [income]
 * @param {unknown} [region]
 * @returns {number} (%)
 */
export function marginalTaxRate(income = 0, region = DEFAULT_TAX_REGION) {
	const gross = asMoney(income);
	const allowance = personalAllowance(gross);
	if (gross < allowance) return 0;

	const taxable = gross - allowance;
	const band =
		bandsFor(region).find(
			(candidate) => taxable >= candidate.from && !isPast(taxable, candidate)
		) ?? bandsFor(region).at(-1);
	if (!band) return 0;

	// Each tapered pound is taxed twice over: once itself, once as the 50p of allowance it destroys.
	const taperFactor = inAllowanceTaper(gross) ? 1 + 1 / ALLOWANCE_TAPER_DIVISOR : 1;
	return band.rate * taperFactor;
}

/**
 * Whether a taxable income has passed a band's ceiling. Split out so the open-ended top band, whose
 * `to` is `null`, reads as "never past it" rather than needing a null check inline.
 *
 * @param {number} taxable
 * @param {TaxBand} band
 * @returns {boolean}
 */
function isPast(taxable, band) {
	return band.to !== null && taxable >= band.to;
}

/* -------------------------------------------------------------------------- */
/* The whole calculation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Everything the tax tab's income field and region selector describe.
 *
 * @typedef {object} TakeHomeInput
 * @property {number} income Adjusted net income for the year (£/yr) — see convention (5).
 * @property {import('./enums.js').TaxRegion} region
 */

/**
 * What the personal allowance did to this income.
 *
 * @typedef {object} AllowanceSummary
 * @property {number} standard The full allowance before any taper (£).
 * @property {number} available The allowance after tapering (£).
 * @property {number} used How much of it this income actually covered (£) — less than `available`
 *   on an income below the allowance, where the rest is simply unused.
 * @property {number} lost Taken away by the taper (£).
 * @property {boolean} tapered Whether any of it was lost.
 * @property {boolean} inTaperBand Whether this income sits inside the £100k–£125,140 range.
 */

/**
 * A full band-by-band take-home calculation — README.md's "Take-home calculation band by band".
 *
 * `allowance.used` plus every `bands[].amount` adds back up to `income` exactly, so the breakdown
 * accounts for every pound earned rather than only the taxed ones.
 *
 * @typedef {object} TakeHomeBreakdown
 * @property {string} taxYear Always {@link TAX_YEAR} — on the object so a stored or exported result
 *   carries the year its figures came from.
 * @property {import('./enums.js').TaxRegion} region The region actually used.
 * @property {number} income Adjusted net income (£/yr).
 * @property {AllowanceSummary} allowance
 * @property {number} taxableIncome Income after allowances (£/yr).
 * @property {TaxBandSlice[]} bands The whole ladder, in order, including bands not reached.
 * @property {number} totalTax Income tax due (£/yr).
 * @property {number} takeHome Income less income tax (£/yr) — see convention (4).
 * @property {number} monthlyTakeHome `takeHome / 12` (£).
 * @property {number} weeklyTakeHome `takeHome / 52` (£).
 * @property {number} monthlyTax `totalTax / 12` (£).
 * @property {number} effectiveRate Tax as a share of income (%).
 * @property {number} marginalRate Rate on the next pound (%), taper included.
 */

/**
 * The tax tab's single entry point: one income and one region in, every figure the tab shows out.
 *
 * Composing it here is what keeps one set of assumptions behind all of them — the allowance the
 * bands are measured against, the effective rate and the marginal rate are all derived from the same
 * income, so no two figures on the tab can disagree about what was typed.
 *
 * @param {Partial<TakeHomeInput>} [raw]
 * @returns {TakeHomeBreakdown}
 */
export function takeHomeBreakdown(raw = {}) {
	const income = asMoney(raw.income);
	const region = normaliseTaxRegion(raw.region);

	const available = personalAllowance(income);
	const taxable = roundMoney(Math.max(0, income - available));
	const bands = sliceIntoBands(taxable, region);
	const totalTax = roundMoney(bands.reduce((total, slice) => total + slice.tax, 0));
	const takeHome = roundMoney(income - totalTax);

	return {
		taxYear: TAX_YEAR,
		region,
		income,
		allowance: {
			standard: PERSONAL_ALLOWANCE,
			available,
			used: roundMoney(Math.min(income, available)),
			lost: roundMoney(PERSONAL_ALLOWANCE - available),
			tapered: available < PERSONAL_ALLOWANCE,
			inTaperBand: inAllowanceTaper(income)
		},
		taxableIncome: taxable,
		bands,
		totalTax,
		takeHome,
		monthlyTakeHome: roundMoney(takeHome / 12),
		weeklyTakeHome: roundMoney(takeHome / 52),
		monthlyTax: roundMoney(totalTax / 12),
		effectiveRate: income === 0 ? 0 : (totalTax / income) * 100,
		marginalRate: marginalTaxRate(income, region)
	};
}

/**
 * The same income under both regions, for the comparison README.md's "England/Wales/NI and Scotland
 * bands" implies — a Scottish taxpayer's most common question about their salary is what it would
 * be worth on the other side of the border.
 *
 * @param {number} [income]
 * @returns {{
 *   england_wales_ni: TakeHomeBreakdown,
 *   scotland: TakeHomeBreakdown,
 *   difference: number
 * }} `difference` is Scottish tax less English/Welsh/NI tax (£/yr): positive means Scotland costs
 *   more.
 */
export function compareRegions(income = 0) {
	const englandWalesNi = takeHomeBreakdown({ income, region: 'england_wales_ni' });
	const scotland = takeHomeBreakdown({ income, region: 'scotland' });

	return {
		england_wales_ni: englandWalesNi,
		scotland,
		difference: roundMoney(scotland.totalTax - englandWalesNi.totalTax)
	};
}
