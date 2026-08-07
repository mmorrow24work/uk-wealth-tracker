import { describe, expect, it } from 'vitest';

import {
	DIVIDEND_ADDITIONAL_RATE,
	DIVIDEND_ALLOWANCE,
	DIVIDEND_ORDINARY_RATE,
	DIVIDEND_TAX_BANDS,
	DIVIDEND_TAX_YEAR,
	DIVIDEND_UPPER_RATE,
	dividendPortfolioTax,
	dividendTax,
	dividendTaxBreakdown,
	isShelteredWrapper,
	isTaxableHolding,
	marginalDividendRate,
	shelteredDividendIncome,
	taxFreeDividendHeadroom,
	taxableDividendIncome
} from './dividend-tax.js';
import { createDividend } from './model.js';
import { PERSONAL_ALLOWANCE } from './tax.js';

/* -------------------------------------------------------------------------- */
/* The published figures                                                      */
/* -------------------------------------------------------------------------- */

describe('rates and allowances', () => {
	it('is the 2026/27 tax year', () => {
		expect(DIVIDEND_TAX_YEAR).toBe('2026/27');
	});

	it('matches README.md’s stated 2026/27 figures exactly', () => {
		expect(DIVIDEND_ALLOWANCE).toBe(500);
		expect(DIVIDEND_ORDINARY_RATE).toBe(10.75);
		expect(DIVIDEND_UPPER_RATE).toBe(35.75);
		// Not in README.md's two-rate summary, but real — see the constant's own note.
		expect(DIVIDEND_ADDITIONAL_RATE).toBe(39.35);
	});

	it('states the three bands on taxable income, as half-open slices with no gaps', () => {
		expect(DIVIDEND_TAX_BANDS.map((band) => band.id)).toEqual(['ordinary', 'upper', 'additional']);
		expect(DIVIDEND_TAX_BANDS[0].from).toBe(0);
		expect(DIVIDEND_TAX_BANDS[0].to).toBe(DIVIDEND_TAX_BANDS[1].from);
		expect(DIVIDEND_TAX_BANDS[1].to).toBe(DIVIDEND_TAX_BANDS[2].from);
		expect(DIVIDEND_TAX_BANDS[2].to).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* Wrappers                                                                   */
/* -------------------------------------------------------------------------- */

describe('isShelteredWrapper / isTaxableHolding', () => {
	it('shelters every ISA, the SIPP and the workplace pension', () => {
		for (const wrapper of [
			'isa_stocks_shares',
			'isa_cash',
			'lisa',
			'jisa',
			'ifisa',
			'htb_isa',
			'sipp',
			'workplace_pension'
		]) {
			expect(isShelteredWrapper(wrapper)).toBe(true);
		}
	});

	it('treats a GIA, an unwrapped holding and anything unrecognised as taxable', () => {
		expect(isShelteredWrapper('gia')).toBe(false);
		expect(isShelteredWrapper('none')).toBe(false);
		expect(isShelteredWrapper(undefined)).toBe(false);
		expect(isTaxableHolding(createDividend({ wrapper: 'gia' }))).toBe(true);
		expect(isTaxableHolding(createDividend({ wrapper: 'isa_stocks_shares' }))).toBe(false);
		expect(isTaxableHolding(null)).toBe(true);
	});
});

describe('taxableDividendIncome / shelteredDividendIncome', () => {
	const holdings = [
		createDividend({ wrapper: 'gia', value: 20_000, yield_pct: 4 }), // £800
		createDividend({ wrapper: 'none', value: 5_000, yield_pct: 4 }), // £200
		createDividend({ wrapper: 'isa_stocks_shares', value: 50_000, yield_pct: 4 }), // £2,000
		createDividend({ wrapper: 'sipp', value: 10_000, yield_pct: 3 }) // £300
	];

	it('splits a portfolio by wrapper', () => {
		expect(taxableDividendIncome(holdings)).toBe(1_000);
		expect(shelteredDividendIncome(holdings)).toBe(2_300);
	});

	it('is zero on an empty or missing list', () => {
		expect(taxableDividendIncome([])).toBe(0);
		expect(shelteredDividendIncome(undefined)).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* The allowance                                                              */
/* -------------------------------------------------------------------------- */

describe('the £500 dividend allowance', () => {
	it('taxes nothing on exactly £500 of dividends alongside a salary', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 500, otherIncome: 30_000 });
		expect(result.dividendAllowanceUsed).toBe(500);
		expect(result.dividendAllowanceRemaining).toBe(0);
		expect(result.taxableDividendIncome).toBe(0);
		expect(result.totalTax).toBe(0);
		expect(result.netIncome).toBe(500);
	});

	it('taxes only the excess over £500 — £1,500 of dividends leaves £1,000 taxable', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 1_500, otherIncome: 30_000 });
		expect(result.taxableDividendIncome).toBe(1_000);
		expect(result.totalTax).toBe(107.5); // £1,000 at 10.75%
	});

	it('reports the unused part of the allowance on a small portfolio', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 180, otherIncome: 30_000 });
		expect(result.dividendAllowanceUsed).toBe(180);
		expect(result.dividendAllowanceRemaining).toBe(320);
		expect(result.totalTax).toBe(0);
	});

	it('accounts for every pound: allowances plus band amounts equal the dividend income', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 12_345, otherIncome: 45_000 });
		const banded = result.bands.reduce((total, band) => total + band.amount, 0);
		expect(
			result.personalAllowance.usedByDividends + result.dividendAllowanceUsed + banded
		).toBeCloseTo(12_345, 6);
	});
});

describe('the personal allowance ahead of the dividend allowance', () => {
	it('covers dividends with the personal allowance where there is no other income', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 10_000, otherIncome: 0 });
		expect(result.personalAllowance.usedByDividends).toBe(10_000);
		expect(result.dividendAllowanceUsed).toBe(0);
		expect(result.totalTax).toBe(0);
	});

	it('gives £13,070 of dividends tax-free with no other income — £12,570 plus £500', () => {
		const free = PERSONAL_ALLOWANCE + DIVIDEND_ALLOWANCE;
		expect(dividendTax({ dividendIncome: free })).toBe(0);
		expect(dividendTax({ dividendIncome: free + 1_000 })).toBe(107.5);
	});

	it('gives other income the allowance first, dividends the remainder', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 5_000, otherIncome: 10_000 });
		expect(result.personalAllowance.usedByOtherIncome).toBe(10_000);
		expect(result.personalAllowance.usedByDividends).toBe(2_570);
		expect(result.dividendAllowanceUsed).toBe(500);
		expect(result.taxableDividendIncome).toBe(1_930);
		expect(result.totalTax).toBe(207.48); // 1,930 at 10.75%
	});
});

/* -------------------------------------------------------------------------- */
/* Rates and band stacking                                                    */
/* -------------------------------------------------------------------------- */

describe('dividends as the top slice of income', () => {
	it('charges the ordinary rate where other income leaves basic-rate room', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 5_500, otherIncome: 30_000 });
		expect(result.bands[0].amount).toBe(5_000);
		expect(result.bands[1].amount).toBe(0);
		expect(result.totalTax).toBe(537.5); // 5,000 at 10.75%
		expect(result.effectiveRate).toBeCloseTo(9.77, 2);
	});

	it('charges the upper rate once other income has used the basic band up', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 5_500, otherIncome: 60_000 });
		expect(result.bands[0].amount).toBe(0);
		expect(result.bands[1].amount).toBe(5_000);
		expect(result.totalTax).toBe(1_787.5); // 5,000 at 35.75%
	});

	it('splits a dividend that straddles the basic/upper boundary', () => {
		// £50,000 salary leaves £37,430 of taxable income, £270 short of the £37,700 limit. The £500
		// nil rate eats that £270 and £230 of the upper band, so every taxed pound is at 35.75%.
		const result = dividendTaxBreakdown({ dividendIncome: 10_000, otherIncome: 50_000 });
		expect(result.bands[0].amount).toBe(0);
		expect(result.bands[1].amount).toBe(9_500);
		expect(result.totalTax).toBe(3_396.25);
	});

	it('leaves the ordinary-rate room the nil rate does not consume', () => {
		// £45,000 salary leaves £32,430 taxable; £5,270 of basic band remains. £500 nil rate takes
		// the first slice of it, so £4,770 is taxed at 10.75% and the rest at 35.75%.
		const result = dividendTaxBreakdown({ dividendIncome: 10_000, otherIncome: 45_000 });
		expect(result.bands[0].amount).toBe(4_770);
		expect(result.bands[1].amount).toBe(4_730);
		expect(result.totalTax).toBe(2_203.76); // 512.78 + 1,690.98
	});

	it('reaches the additional rate above £125,140', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 20_000, otherIncome: 140_000 });
		expect(result.personalAllowance.available).toBe(0);
		expect(result.personalAllowance.tapered).toBe(true);
		expect(result.bands[2].amount).toBe(19_500);
		expect(result.totalTax).toBe(7_673.25); // 19,500 at 39.35%
	});

	it('splits across the upper/additional boundary', () => {
		// £120,000 of other income: PA is fully tapered away, so all £120,000 is taxable and £5,140
		// of upper-rate room is left. The £500 nil rate takes the first slice of that.
		const result = dividendTaxBreakdown({ dividendIncome: 10_000, otherIncome: 120_000 });
		expect(result.bands[1].amount).toBe(4_640);
		expect(result.bands[2].amount).toBe(4_860);
		expect(result.totalTax).toBe(3_571.21); // 1,658.80 + 1,912.41
	});

	it('returns the whole ladder including bands the income never reaches', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 1_000, otherIncome: 20_000 });
		expect(result.bands).toHaveLength(3);
		expect(result.bands[1].amount).toBe(0);
		expect(result.bands[1].tax).toBe(0);
	});
});

describe('the personal allowance taper', () => {
	it('lets dividend income itself taper the allowance away', () => {
		// £95,000 salary and £20,000 of dividends: total income £115,000, so £7,500 of allowance is
		// lost even though the salary alone would have kept all of it.
		const result = dividendTaxBreakdown({ dividendIncome: 20_000, otherIncome: 95_000 });
		expect(result.personalAllowance.available).toBe(5_070);
		expect(result.personalAllowance.usedByOtherIncome).toBe(5_070);
		expect(result.personalAllowance.usedByDividends).toBe(0);
		expect(result.personalAllowance.tapered).toBe(true);
	});

	it('leaves the allowance alone below £100,000 of total income', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 5_000, otherIncome: 60_000 });
		expect(result.personalAllowance.available).toBe(PERSONAL_ALLOWANCE);
		expect(result.personalAllowance.tapered).toBe(false);
	});
});

describe('the region makes no difference', () => {
	it('has no tax_region input at all — dividend rates are UK-wide (convention 2)', () => {
		// A Scottish taxpayer on £50,000 pays 42% on the top of their salary but the same 35.75% on
		// dividends as anyone else, against the same £37,700 limit. Nothing in this module's inputs
		// can express a region, which is the point.
		const result = dividendTaxBreakdown({ dividendIncome: 10_000, otherIncome: 50_000 });
		expect(result.totalTax).toBe(3_396.25);
	});
});

/* -------------------------------------------------------------------------- */
/* Marginal rate and headroom                                                 */
/* -------------------------------------------------------------------------- */

describe('marginalDividendRate', () => {
	it('is 0% while the personal allowance still has room', () => {
		expect(marginalDividendRate({ dividendIncome: 5_000, otherIncome: 0 })).toBe(0);
	});

	it('is 0% while the £500 nil rate still has room', () => {
		expect(marginalDividendRate({ dividendIncome: 100, otherIncome: 30_000 })).toBe(0);
		expect(marginalDividendRate({ dividendIncome: 499, otherIncome: 30_000 })).toBe(0);
	});

	it('is the ordinary rate once both allowances are used', () => {
		expect(marginalDividendRate({ dividendIncome: 500, otherIncome: 30_000 })).toBe(10.75);
		expect(marginalDividendRate({ dividendIncome: 2_000, otherIncome: 30_000 })).toBe(10.75);
	});

	it('is the upper rate for a higher-rate taxpayer', () => {
		expect(marginalDividendRate({ dividendIncome: 2_000, otherIncome: 60_000 })).toBe(35.75);
	});

	it('is the additional rate at the top', () => {
		expect(marginalDividendRate({ dividendIncome: 2_000, otherIncome: 140_000 })).toBe(39.35);
	});

	it('reports the band the next pound enters, not the one just left', () => {
		// £45,000 salary leaves £32,430 taxable; £5,270 of dividends lands exactly on the £37,700
		// limit, so the next pound is the first upper-rate one.
		expect(marginalDividendRate({ dividendIncome: 5_270, otherIncome: 45_000 })).toBe(35.75);
		expect(marginalDividendRate({ dividendIncome: 5_269, otherIncome: 45_000 })).toBe(10.75);
	});

	it('is on the breakdown too, agreeing with the standalone function', () => {
		const result = dividendTaxBreakdown({ dividendIncome: 2_000, otherIncome: 60_000 });
		expect(result.marginalRate).toBe(35.75);
	});
});

describe('taxFreeDividendHeadroom', () => {
	it('is the unused part of the £500 where other income eats the personal allowance', () => {
		expect(taxFreeDividendHeadroom({ dividendIncome: 180, otherIncome: 30_000 })).toBe(320);
		expect(taxFreeDividendHeadroom({ dividendIncome: 0, otherIncome: 30_000 })).toBe(500);
	});

	it('adds the unused personal allowance where there is little other income', () => {
		// £10,000 salary leaves £2,570 of personal allowance plus the whole £500.
		expect(taxFreeDividendHeadroom({ dividendIncome: 0, otherIncome: 10_000 })).toBe(3_070);
	});

	it('is zero once the portfolio is already paying tax', () => {
		expect(taxFreeDividendHeadroom({ dividendIncome: 5_000, otherIncome: 30_000 })).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Tolerance                                                                  */
/* -------------------------------------------------------------------------- */

describe('tolerance of missing or malformed input', () => {
	it('treats no arguments as no income', () => {
		const result = dividendTaxBreakdown();
		expect(result.dividendIncome).toBe(0);
		expect(result.totalTax).toBe(0);
		expect(result.effectiveRate).toBe(0);
		expect(result.marginalRate).toBe(0);
		expect(dividendTax()).toBe(0);
	});

	it('reads a negative or non-numeric income as zero', () => {
		expect(dividendTax({ dividendIncome: -5_000, otherIncome: 30_000 })).toBe(0);
		expect(dividendTax(/** @type {never} */ ({ dividendIncome: 'lots', otherIncome: null }))).toBe(
			0
		);
	});
});

/* -------------------------------------------------------------------------- */
/* A whole portfolio                                                          */
/* -------------------------------------------------------------------------- */

describe('dividendPortfolioTax', () => {
	const portfolio = [
		createDividend({
			id: 'a',
			name: 'ISA fund',
			wrapper: 'isa_stocks_shares',
			value: 50_000,
			yield_pct: 4
		}), // £2,000, sheltered
		createDividend({ id: 'b', name: 'GIA fund', wrapper: 'gia', value: 60_000, yield_pct: 4 }), // £2,400, taxable
		createDividend({ id: 'c', name: 'Direct shares', wrapper: 'none', value: 20_000, yield_pct: 3 }) // £600, taxable
	];

	it('taxes only the unsheltered slice', () => {
		const result = dividendPortfolioTax(portfolio, { otherIncome: 30_000 });
		expect(result.grossIncome).toBe(5_000);
		expect(result.shelteredIncome).toBe(2_000);
		expect(result.taxableWrapperIncome).toBe(3_000);
		expect(result.breakdown.taxableDividendIncome).toBe(2_500); // less the £500 allowance
		expect(result.totalTax).toBe(268.75); // 2,500 at 10.75%
		expect(result.netIncome).toBe(4_731.25);
	});

	it('counts holdings by wrapper', () => {
		const result = dividendPortfolioTax(portfolio, { otherIncome: 30_000 });
		expect(result.count).toBe(3);
		expect(result.shelteredCount).toBe(1);
		expect(result.taxableCount).toBe(2);
	});

	it('reports the effective rate against whole-portfolio income, not just the taxed slice', () => {
		const result = dividendPortfolioTax(portfolio, { otherIncome: 30_000 });
		expect(result.effectiveRate).toBeCloseTo(5.375, 3); // 268.75 / 5,000
		expect(result.breakdown.effectiveRate).toBeCloseTo(8.958, 3); // 268.75 / 3,000
	});

	it('prices what the ISA/SIPP shelter is worth this year', () => {
		const result = dividendPortfolioTax(portfolio, { otherIncome: 30_000 });
		// All £5,000 in a GIA would tax £4,500 at 10.75% = £483.75.
		expect(result.taxIfNothingSheltered).toBe(483.75);
		expect(result.shelterSaving).toBe(215);
	});

	it('apportions tax across the taxable holdings pro rata, sparing the sheltered one', () => {
		const result = dividendPortfolioTax(portfolio, { otherIncome: 30_000 });
		const [isa, gia, direct] = result.holdings;

		expect(isa.sheltered).toBe(true);
		expect(isa.tax).toBe(0);
		expect(isa.netIncome).toBe(2_000);

		expect(gia.tax).toBe(215); // 2,400/3,000 of £268.75
		expect(direct.tax).toBe(53.75); // 600/3,000
		expect(gia.tax + direct.tax).toBeCloseTo(result.totalTax, 6);
		expect(gia.netIncome).toBe(2_185);
	});

	it('keeps input order and carries each holding’s name and wrapper', () => {
		const result = dividendPortfolioTax(portfolio, { otherIncome: 30_000 });
		expect(result.holdings.map((h) => h.name)).toEqual(['ISA fund', 'GIA fund', 'Direct shares']);
		expect(result.holdings.map((h) => h.wrapper)).toEqual(['isa_stocks_shares', 'gia', 'none']);
	});

	it('charges nothing on an all-sheltered portfolio, however large', () => {
		const sheltered = [
			createDividend({ wrapper: 'isa_stocks_shares', value: 500_000, yield_pct: 5 }),
			createDividend({ wrapper: 'sipp', value: 400_000, yield_pct: 4 })
		];
		const result = dividendPortfolioTax(sheltered, { otherIncome: 60_000 });
		expect(result.grossIncome).toBe(41_000);
		expect(result.totalTax).toBe(0);
		expect(result.netIncome).toBe(41_000);
		expect(result.shelterSaving).toBeGreaterThan(0);
	});

	it('reads other income as zero when none is given', () => {
		const result = dividendPortfolioTax(portfolio);
		expect(result.breakdown.otherIncome).toBe(0);
		expect(result.totalTax).toBe(0); // £3,000 fits inside the personal allowance
	});

	it('is empty and free on an empty or missing list', () => {
		for (const result of [dividendPortfolioTax([]), dividendPortfolioTax(undefined)]) {
			expect(result.count).toBe(0);
			expect(result.grossIncome).toBe(0);
			expect(result.totalTax).toBe(0);
			expect(result.holdings).toEqual([]);
			expect(result.monthlyNetIncome).toBe(0);
		}
	});

	it('carries the tax year through', () => {
		expect(dividendPortfolioTax(portfolio).taxYear).toBe(DIVIDEND_TAX_YEAR);
	});
});
