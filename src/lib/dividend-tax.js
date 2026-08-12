/**
 * UK dividend tax, 2026/27 — README.md → "Dividend Income Planner": "UK dividend allowance:
 * £500/yr tax-free (2026/27); ISA/SIPP fully sheltered" and "GIA tax rates: 10.75% basic, 35.75%
 * higher rate" (issue #35).
 *
 * `dividends.js` (issue #34) projects what a dividend portfolio pays and says so explicitly in its
 * own header: every figure it returns is gross, and the `sheltered`/`unsheltered` split it exposes
 * exists so this module has a slice to key its calculation off. This is that module — the only
 * place in the app that turns a gross dividend figure into a net one.
 *
 * Six conventions decide what the numbers here mean:
 *
 * 1. **Dividends are the top slice of income.** HMRC taxes dividend income after everything else,
 *    so which dividend rate applies depends on how much of the basic/higher rate bands the
 *    taxpayer's *other* income already used up. Every entry point therefore takes an `otherIncome`
 *    alongside the dividend figure; passing dividends on their own is the same calculation with
 *    `otherIncome: 0`, not a different one.
 * 2. **Dividend rates and thresholds are UK-wide — `profile.tax_region` deliberately does not
 *    change them.** Scotland sets rates and bands for non-savings, non-dividend income only; a
 *    Scottish taxpayer's dividends are charged at the same 10.75%/35.75%/39.35% against the same
 *    £37,700/£125,140 limits as everybody else's. This is the one place in the app where the
 *    region selector on the Tax tab has no effect, and it is correct that it doesn't — see
 *    {@link DIVIDEND_TAX_BANDS}.
 * 3. **The £500 dividend allowance is a nil-rate band, not an exemption.** The first £500 of
 *    chargeable dividend income is taxed at 0%, but it still *uses up* basic/higher rate band
 *    space, so it can push the pounds above it into a higher rate. Modelling it as "ignore the
 *    first £500" instead would understate the tax of anyone sitting near a band boundary.
 * 4. **The personal allowance covers other income first, then dividends.** Where other income is
 *    below the personal allowance, the unused remainder shelters dividends before the £500 nil
 *    rate is reached at all — so a portfolio held by someone with no other income pays nothing on
 *    the first £13,070. Allocating the allowance the other way round is legal but never better for
 *    the taxpayer, and defaulting to the better one matches what any UK tax calculator shows.
 * 5. **The allowance taper is assessed on total income, dividends included.** Dividend income is
 *    part of adjusted net income, so `tax.js`'s {@link personalAllowance} is called on other income
 *    *plus* dividends. Above £100,000 that shrinks the allowance and pushes dividends up the band
 *    ladder, which is a real effect this module does model; the extra tax the lost allowance causes
 *    on the *other* income is `tax.js`'s to report, not this module's (see "not modelled" below).
 * 6. **Wrapper decides whether a holding is in scope at all.** `enums.js`'s
 *    `TAX_SHELTERED_WRAPPERS` (every ISA, SIPP, workplace pension) pays no dividend tax whatsoever
 *    and never touches the allowance; a `gia` or unwrapped (`none`) holding is the taxable slice.
 *    README.md's "ISA/SIPP fully sheltered" is exactly this line.
 *
 * **What this deliberately does not model**: National Insurance (dividends attract none, which is
 * why they are taxed at their own lower rates in the first place); the extra income tax an income
 * above £100,000 causes on *non*-dividend income as the personal allowance tapers away — the Tax
 * tab's own `takeHomeBreakdown` owns that number and duplicating it here would put two different
 * totals for the same salary on two tabs; dividends paid inside a company or to a trust; the
 * accrued-income/stock-dividend edge cases; and any tax year other than 2026/27 — the allowance and
 * all three rates are frozen constants, and UK dividend rates changed as recently as April 2026.
 *
 * Every figure is in pounds, rounded to whole pence. Rates are percents (`10.75` = 10.75%), matching
 * `tax.js`. Everything is pure. The module imports from `enums.js`, `tax.js` and `dividends.js`, and
 * nothing goes the other way — the same one-directional shape `pension-relief.js` has over `tax.js`.
 *
 * Figures verified against HMRC's "Tax on dividends" and "Income Tax rates and allowances"
 * (gov.uk), 2026 to 2027, following the April 2026 increase to the ordinary and upper rates.
 */

import { TAX_SHELTERED_WRAPPERS } from './enums.js';
import { annualDividendIncome } from './dividends.js';
import { PERSONAL_ALLOWANCE, personalAllowance } from './tax.js';

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
/* The tax year                                                                */
/* -------------------------------------------------------------------------- */

/** The tax year every figure in this module belongs to — matches `tax.js`'s own `TAX_YEAR`. */
export const DIVIDEND_TAX_YEAR = '2026/27';

/**
 * The dividend allowance (£/yr) — README.md's "£500/yr tax-free (2026/27)". A nil-rate band, not an
 * exemption: see convention (3).
 */
export const DIVIDEND_ALLOWANCE = 500;

/* -------------------------------------------------------------------------- */
/* Rates and bands                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The UK basic rate limit (£ of taxable income) — where the ordinary dividend rate gives way to the
 * upper rate. The same £37,700 `tax.js`'s England/Wales/NI basic band ends at, but stated here in
 * its own right rather than imported from that ladder: per convention (2) this limit applies to a
 * Scottish taxpayer's dividends too, where `tax.js`'s Scottish ladder has no £37,700 boundary at
 * all, so deriving it from a region's bands would be wrong for exactly the region that most needs
 * it to be right.
 */
export const DIVIDEND_BASIC_RATE_LIMIT = 37_700;

/**
 * The additional rate threshold (£ of taxable income), UK-wide. Equal to `tax.js`'s
 * `ALLOWANCE_EXHAUSTED_AT` by construction — both were set to the income at which the personal
 * allowance runs out — but, as above, restated rather than imported.
 */
export const DIVIDEND_ADDITIONAL_RATE_THRESHOLD = 125_140;

/** The ordinary (basic) dividend rate (%) — README.md's "10.75% basic". */
export const DIVIDEND_ORDINARY_RATE = 10.75;

/** The upper (higher) dividend rate (%) — README.md's "35.75% higher rate". */
export const DIVIDEND_UPPER_RATE = 35.75;

/**
 * The additional dividend rate (%). README.md names only the basic and higher rates, because those
 * are the two that changed in April 2026; the additional rate exists all the same and was left at
 * 39.35%. Omitting it would silently tax a £150,000 income at the upper rate, so it is carried here
 * with this note rather than left out for matching the spec more literally.
 */
export const DIVIDEND_ADDITIONAL_RATE = 39.35;

/**
 * One dividend rate band, expressed on taxable income the same way `tax.js`'s `TaxBand` is
 * (convention (1) there): `from`/`to` are pounds of income *after* the personal allowance, and each
 * band is a half-open slice `[from, to)`.
 *
 * @typedef {object} DividendBand
 * @property {string} id Stable code.
 * @property {string} label HMRC's own name for the rate.
 * @property {number} rate Dividend tax rate (%).
 * @property {number} from Taxable income the band starts at (£), inclusive.
 * @property {number | null} to Taxable income the band ends at (£), exclusive; `null` = no ceiling.
 */

/**
 * The three dividend rates, 2026/27, UK-wide — convention (2).
 *
 * @type {readonly DividendBand[]}
 */
export const DIVIDEND_TAX_BANDS = Object.freeze([
	Object.freeze({
		id: 'ordinary',
		label: 'Ordinary rate',
		rate: DIVIDEND_ORDINARY_RATE,
		from: 0,
		to: DIVIDEND_BASIC_RATE_LIMIT
	}),
	Object.freeze({
		id: 'upper',
		label: 'Upper rate',
		rate: DIVIDEND_UPPER_RATE,
		from: DIVIDEND_BASIC_RATE_LIMIT,
		to: DIVIDEND_ADDITIONAL_RATE_THRESHOLD
	}),
	Object.freeze({
		id: 'additional',
		label: 'Additional rate',
		rate: DIVIDEND_ADDITIONAL_RATE,
		from: DIVIDEND_ADDITIONAL_RATE_THRESHOLD,
		to: null
	})
]);

/* -------------------------------------------------------------------------- */
/* Wrappers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Whether a wrapper shelters dividends from UK tax entirely — convention (6), README.md's
 * "ISA/SIPP fully sheltered".
 *
 * @param {unknown} wrapper
 * @returns {boolean}
 */
export function isShelteredWrapper(wrapper) {
	return TAX_SHELTERED_WRAPPERS.includes(/** @type {import('./enums.js').Wrapper} */ (wrapper));
}

/**
 * Whether a holding's dividends are in scope for this module at all — a General Investment Account
 * or an unwrapped holding, i.e. anything not sheltered.
 *
 * @param {Partial<import('./types.js').Dividend> | null} [dividend]
 * @returns {boolean}
 */
export function isTaxableHolding(dividend) {
	return !isShelteredWrapper(dividend?.wrapper);
}

/**
 * Gross dividend income (£/yr) from the holdings that are actually taxable — the figure every
 * calculation below is keyed off, and the only part of a portfolio the allowance and the rates ever
 * see.
 *
 * @param {readonly Partial<import('./types.js').Dividend>[]} [dividends]
 * @returns {number} (£/yr)
 */
export function taxableDividendIncome(dividends) {
	const list = Array.isArray(dividends) ? dividends : [];
	return roundMoney(
		list.filter(isTaxableHolding).reduce((total, d) => total + annualDividendIncome(d), 0)
	);
}

/**
 * Gross dividend income (£/yr) from ISA/SIPP/workplace-pension holdings — never taxed, and never
 * counted against the allowance either.
 *
 * @param {readonly Partial<import('./types.js').Dividend>[]} [dividends]
 * @returns {number} (£/yr)
 */
export function shelteredDividendIncome(dividends) {
	const list = Array.isArray(dividends) ? dividends : [];
	return roundMoney(
		list
			.filter((d) => isShelteredWrapper(d?.wrapper))
			.reduce((total, d) => total + annualDividendIncome(d), 0)
	);
}

/* -------------------------------------------------------------------------- */
/* The calculation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One row of the dividend rate ladder, as it applies to this taxpayer.
 *
 * @typedef {object} DividendBandSlice
 * @property {string} id
 * @property {string} label
 * @property {number} rate Dividend tax rate (%).
 * @property {number} from Taxable income the band starts at (£).
 * @property {number | null} to Taxable income the band ends at (£); `null` = no ceiling.
 * @property {number} amount Dividend income taxed in this band (£/yr) — excludes anything covered
 *   by the personal allowance or the £500 nil rate, both of which are reported separately.
 * @property {number} tax Tax due on that amount (£/yr).
 */

/**
 * How the personal allowance was shared between other income and dividends — convention (4).
 *
 * @typedef {object} DividendAllowanceUse
 * @property {number} available Personal allowance for this total income (£), after any taper.
 * @property {number} usedByOtherIncome (£)
 * @property {number} usedByDividends (£) — the part of the dividend income the personal allowance
 *   covers, before the £500 nil rate is reached.
 * @property {boolean} tapered Whether the taper took any of the standard allowance away.
 */

/**
 * A full dividend tax calculation.
 *
 * `personalAllowance.usedByDividends` + `dividendAllowanceUsed` + every `bands[].amount` adds back
 * up to `dividendIncome` exactly, so the breakdown accounts for every pound of dividend rather than
 * only the taxed ones — the same property `tax.js`'s `TakeHomeBreakdown` has.
 *
 * @typedef {object} DividendTaxBreakdown
 * @property {string} taxYear Always {@link DIVIDEND_TAX_YEAR}.
 * @property {number} dividendIncome Gross taxable-wrapper dividend income (£/yr).
 * @property {number} otherIncome Everything else taxable, dividends aside (£/yr) — convention (1).
 * @property {number} totalIncome `otherIncome + dividendIncome` (£/yr).
 * @property {DividendAllowanceUse} personalAllowance
 * @property {number} dividendAllowance Always {@link DIVIDEND_ALLOWANCE} (£).
 * @property {number} dividendAllowanceUsed How much of it this income actually used (£) — less than
 *   the full £500 on a small portfolio, and `0` where the personal allowance already covered
 *   everything.
 * @property {number} dividendAllowanceRemaining Unused allowance (£) — headroom to add dividends
 *   without paying tax.
 * @property {number} taxableDividendIncome Dividend income left after both allowances (£/yr).
 * @property {DividendBandSlice[]} bands The whole ladder, in order, including bands not reached.
 * @property {number} totalTax Dividend tax due (£/yr).
 * @property {number} netIncome `dividendIncome - totalTax` (£/yr).
 * @property {number} monthlyNetIncome `netIncome / 12` (£).
 * @property {number} effectiveRate Tax as a share of gross dividend income (%). `0` on no dividends.
 * @property {number} marginalRate The rate the *next* pound of dividend would be taxed at (%) —
 *   `0` while the personal allowance or the £500 nil rate still has room. See "not modelled" in the
 *   module header: this is the statutory dividend rate only, and does not include the knock-on cost
 *   of the personal allowance taper above £100,000.
 */

/**
 * @param {{ dividendIncome?: number, otherIncome?: number }} [raw]
 * @returns {DividendTaxBreakdown}
 */
export function dividendTaxBreakdown(raw = {}) {
	const dividendIncome = asMoney(raw?.dividendIncome);
	const otherIncome = asMoney(raw?.otherIncome);
	const totalIncome = roundMoney(otherIncome + dividendIncome);

	// Convention (5): the taper is assessed on total income, dividends included.
	const available = personalAllowance(totalIncome);
	// Convention (4): other income takes the allowance first, dividends get whatever is left.
	const usedByOtherIncome = roundMoney(Math.min(otherIncome, available));
	const usedByDividends = roundMoney(Math.min(dividendIncome, available - usedByOtherIncome));

	const taxableOtherIncome = roundMoney(otherIncome - usedByOtherIncome);
	const chargeableDividend = roundMoney(dividendIncome - usedByDividends);

	// Convention (3): the nil rate is the bottom slice of the chargeable dividend, and uses band
	// space like any other income — so the ladder is walked from where it ends, not where it starts.
	const dividendAllowanceUsed = roundMoney(Math.min(DIVIDEND_ALLOWANCE, chargeableDividend));
	const taxable = roundMoney(chargeableDividend - dividendAllowanceUsed);

	const from = roundMoney(taxableOtherIncome + dividendAllowanceUsed);
	const to = roundMoney(taxableOtherIncome + chargeableDividend);

	const bands = DIVIDEND_TAX_BANDS.map((band) => {
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

	const totalTax = roundMoney(bands.reduce((total, band) => total + band.tax, 0));
	const netIncome = roundMoney(dividendIncome - totalTax);

	return {
		taxYear: DIVIDEND_TAX_YEAR,
		dividendIncome,
		otherIncome,
		totalIncome,
		personalAllowance: {
			available,
			usedByOtherIncome,
			usedByDividends,
			tapered: available < PERSONAL_ALLOWANCE
		},
		dividendAllowance: DIVIDEND_ALLOWANCE,
		dividendAllowanceUsed,
		dividendAllowanceRemaining: roundMoney(DIVIDEND_ALLOWANCE - dividendAllowanceUsed),
		taxableDividendIncome: taxable,
		bands,
		totalTax,
		netIncome,
		monthlyNetIncome: roundMoney(netIncome / 12),
		effectiveRate: dividendIncome === 0 ? 0 : (totalTax / dividendIncome) * 100,
		marginalRate: marginalDividendRate({ dividendIncome, otherIncome })
	};
}

/**
 * Dividend tax due, in one number.
 *
 * @param {{ dividendIncome?: number, otherIncome?: number }} [raw]
 * @returns {number} (£/yr)
 */
export function dividendTax(raw = {}) {
	return dividendTaxBreakdown(raw).totalTax;
}

/**
 * The rate the next pound of dividend income would be taxed at (%) — `0` while the personal
 * allowance or the £500 nil rate still has room, then the statutory rate for wherever that pound
 * lands on the ladder.
 *
 * Computed from where the *existing* income leaves off rather than by re-running the whole
 * calculation on `dividendIncome + 1`, so a portfolio sitting exactly on a band boundary reports the
 * rate of the band it is about to enter rather than the one it just left.
 *
 * @param {{ dividendIncome?: number, otherIncome?: number }} [raw]
 * @returns {number} (%)
 */
export function marginalDividendRate(raw = {}) {
	const dividendIncome = asMoney(raw?.dividendIncome);
	const otherIncome = asMoney(raw?.otherIncome);
	const totalIncome = roundMoney(otherIncome + dividendIncome);

	const available = personalAllowance(totalIncome);
	const usedByOtherIncome = Math.min(otherIncome, available);
	const usedByDividends = Math.min(dividendIncome, available - usedByOtherIncome);

	// Still inside the personal allowance, or inside the £500 nil rate: the next pound is free.
	if (usedByDividends < available - usedByOtherIncome) return 0;
	const chargeableDividend = roundMoney(dividendIncome - usedByDividends);
	if (chargeableDividend < DIVIDEND_ALLOWANCE) return 0;

	const position = roundMoney(otherIncome - usedByOtherIncome + chargeableDividend);
	const band =
		DIVIDEND_TAX_BANDS.find((candidate) => candidate.to === null || position < candidate.to) ??
		DIVIDEND_TAX_BANDS[DIVIDEND_TAX_BANDS.length - 1];
	return band.rate;
}

/* -------------------------------------------------------------------------- */
/* A whole portfolio                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One holding's share of the portfolio's dividend tax.
 *
 * @typedef {object} DividendHoldingTax
 * @property {string} id
 * @property {string} name
 * @property {import('./enums.js').Wrapper | null} wrapper
 * @property {boolean} sheltered Whether the wrapper shelters it entirely — convention (6).
 * @property {number} grossIncome (£/yr)
 * @property {number} tax This holding's apportioned share of the portfolio's tax (£/yr) — `0` for a
 *   sheltered holding. See {@link dividendPortfolioTax} for why this is an apportionment.
 * @property {number} netIncome `grossIncome - tax` (£/yr).
 */

/**
 * A whole `dividends[]` list, taxed.
 *
 * @typedef {object} DividendPortfolioTax
 * @property {string} taxYear
 * @property {number} count Holdings in the list.
 * @property {number} shelteredCount Holdings in an ISA/SIPP/workplace-pension wrapper.
 * @property {number} taxableCount Holdings in a GIA or unwrapped.
 * @property {number} grossIncome Every holding's income, sheltered or not (£/yr).
 * @property {number} shelteredIncome (£/yr) — tax-free, and outside the allowance entirely.
 * @property {number} taxableWrapperIncome (£/yr) — the slice handed to {@link dividendTaxBreakdown}.
 * @property {DividendTaxBreakdown} breakdown The calculation on that slice.
 * @property {number} totalTax (£/yr)
 * @property {number} netIncome Gross income across the whole portfolio, less tax (£/yr) — sheltered
 *   income included, since it is part of what the portfolio actually pays out.
 * @property {number} monthlyNetIncome `netIncome / 12` (£).
 * @property {number} effectiveRate Tax as a share of *whole-portfolio* gross income (%) — lower than
 *   `breakdown.effectiveRate` whenever anything is sheltered, which is the comparison that makes
 *   the shelter's worth visible.
 * @property {number} taxIfNothingSheltered What the same income would cost with every holding in a
 *   GIA (£/yr) — the counterfactual behind {@link DividendPortfolioTax.shelterSaving}.
 * @property {number} shelterSaving `taxIfNothingSheltered - totalTax` (£/yr): what the ISA/SIPP
 *   wrappers are worth this year.
 * @property {DividendHoldingTax[]} holdings Per holding, input order kept.
 */

/**
 * Tax a whole portfolio, splitting it by wrapper first.
 *
 * Per-holding tax is an **apportionment**, not a separate calculation: dividend tax is charged on
 * the taxpayer's total dividend income against one set of bands, so no individual holding has a
 * rate of its own — a second GIA holding can push the first one's income into the upper rate. Each
 * taxable holding therefore carries its pro-rata share of the total by gross income. A sheltered
 * holding's share is zero, not "its share of a bill it did not cause".
 *
 * @param {readonly Partial<import('./types.js').Dividend>[]} [dividends]
 * @param {{ otherIncome?: number }} [options] `otherIncome` is everything else taxable — salary,
 *   pension income, rent — before dividends are stacked on top of it (convention (1)).
 * @returns {DividendPortfolioTax}
 */
export function dividendPortfolioTax(dividends, options = {}) {
	const list = Array.isArray(dividends) ? dividends : [];
	const otherIncome = asMoney(options?.otherIncome);

	const shelteredIncome = shelteredDividendIncome(list);
	const taxableWrapperIncome = taxableDividendIncome(list);
	const grossIncome = roundMoney(shelteredIncome + taxableWrapperIncome);

	const breakdown = dividendTaxBreakdown({ dividendIncome: taxableWrapperIncome, otherIncome });
	const totalTax = breakdown.totalTax;
	const netIncome = roundMoney(grossIncome - totalTax);

	const taxIfNothingSheltered = dividendTax({ dividendIncome: grossIncome, otherIncome });

	/** @type {DividendHoldingTax[]} */
	const holdings = list.map((dividend) => {
		const sheltered = isShelteredWrapper(dividend?.wrapper);
		const income = annualDividendIncome(dividend);
		const tax =
			sheltered || taxableWrapperIncome === 0
				? 0
				: roundMoney((totalTax * income) / taxableWrapperIncome);

		return {
			id: typeof dividend?.id === 'string' ? dividend.id : '',
			name: typeof dividend?.name === 'string' ? dividend.name : '',
			wrapper: /** @type {import('./enums.js').Wrapper | null} */ (dividend?.wrapper ?? null),
			sheltered,
			grossIncome: income,
			tax,
			netIncome: roundMoney(income - tax)
		};
	});

	return {
		taxYear: DIVIDEND_TAX_YEAR,
		count: list.length,
		shelteredCount: list.filter((d) => isShelteredWrapper(d?.wrapper)).length,
		taxableCount: list.filter(isTaxableHolding).length,
		grossIncome,
		shelteredIncome,
		taxableWrapperIncome,
		breakdown,
		totalTax,
		netIncome,
		monthlyNetIncome: roundMoney(netIncome / 12),
		effectiveRate: grossIncome === 0 ? 0 : (totalTax / grossIncome) * 100,
		taxIfNothingSheltered,
		shelterSaving: roundMoney(taxIfNothingSheltered - totalTax),
		holdings
	};
}

/**
 * How much more taxable-wrapper dividend income could be added before any tax is due (£/yr) — the
 * personal allowance's unused remainder plus whatever is left of the £500. `0` once the portfolio is
 * already paying tax.
 *
 * Useful on its own rather than only as part of a breakdown: "you have £320 of allowance left" is
 * the single most actionable number on the dividend tab for a small GIA holding.
 *
 * "Tax-free" means free of *dividend* tax. Above £100,000 of total income the added dividends would
 * still shrink the personal allowance and so raise the tax on the taxpayer's other income — the
 * knock-on cost the module header lists as not modelled here, and which belongs to `tax.js`.
 *
 * @param {{ dividendIncome?: number, otherIncome?: number }} [raw]
 * @returns {number} (£/yr)
 */
export function taxFreeDividendHeadroom(raw = {}) {
	const breakdown = dividendTaxBreakdown(raw);
	if (breakdown.taxableDividendIncome > 0) return 0;

	const personalAllowanceLeft = roundMoney(
		breakdown.personalAllowance.available -
			breakdown.personalAllowance.usedByOtherIncome -
			breakdown.personalAllowance.usedByDividends
	);
	return roundMoney(Math.max(0, personalAllowanceLeft) + breakdown.dividendAllowanceRemaining);
}
