import { describe, expect, it } from 'vitest';

import {
	CGT_ANNUAL_EXEMPT_AMOUNT,
	CGT_BASIC_RATE_LIMIT,
	CGT_TAX_YEAR,
	CGT_WARNINGS,
	MAIN_RESIDENCE_PROPERTY_TYPES,
	PRR_FINAL_PERIOD_MONTHS,
	RESIDENTIAL_CGT_BANDS,
	RESIDENTIAL_CGT_BASIC_RATE,
	RESIDENTIAL_CGT_HIGHER_RATE,
	capitalGainsTax,
	capitalGainsTaxOnPropertySale,
	privateResidenceReliefPeriod
} from './capital-gains.js';
import { createProperty } from './model.js';
import { ENGLAND_WALES_NI_BANDS, PERSONAL_ALLOWANCE, taxableIncome } from './tax.js';

/** Values are money, so compare to the penny rather than to floating-point exactness. */
const PENNY = 0.005;

/** Fractions and percentages fall out of a division — compare to a millionth. */
const MILLIONTH = 0.0000005;

/**
 * A property with the three CGT fields filled in, defaulting to the module doc's worked example:
 * bought 1 January 2010 for £200,000, let from 1 January 2018.
 *
 * @param {Partial<import('./types.js').Property>} [overrides]
 */
const property = (overrides = {}) =>
	createProperty({
		type: 'primary_residence',
		purchase_price: 200_000,
		purchase_date: '2010-01-01',
		let_from: null,
		...overrides
	});

/* -------------------------------------------------------------------------- */
/* Statutory figures                                                           */
/* -------------------------------------------------------------------------- */

describe('statutory figures', () => {
	it('match README.md’s "Capital Gains Tax on Property (2026/27)" section exactly', () => {
		expect(CGT_ANNUAL_EXEMPT_AMOUNT).toBe(3_000);
		expect(RESIDENTIAL_CGT_BASIC_RATE).toBe(18);
		expect(RESIDENTIAL_CGT_HIGHER_RATE).toBe(24);
		expect(PRR_FINAL_PERIOD_MONTHS).toBe(9);
	});

	it('states the tax year those figures belong to', () => {
		expect(CGT_TAX_YEAR).toBe('2026/27');
	});

	it('takes the basic rate limit from tax.js rather than restating £37,700', () => {
		expect(CGT_BASIC_RATE_LIMIT).toBe(37_700);
		expect(CGT_BASIC_RATE_LIMIT).toBe(
			ENGLAND_WALES_NI_BANDS.find((band) => band.id === 'basic')?.to
		);
	});

	it('has two rungs, not three — CGT has no additional rate above £125,140', () => {
		expect(RESIDENTIAL_CGT_BANDS.map((band) => band.id)).toEqual(['basic', 'higher']);
		expect(RESIDENTIAL_CGT_BANDS.map((band) => band.rate)).toEqual([18, 24]);
		expect(RESIDENTIAL_CGT_BANDS.at(-1)?.to).toBe(null);
		expect(Object.isFrozen(RESIDENTIAL_CGT_BANDS)).toBe(true);
	});

	it('treats a primary or rented residence, and nothing else, as lived-in-throughout', () => {
		expect(MAIN_RESIDENCE_PROPERTY_TYPES).toEqual(['primary_residence', 'rented_residence']);
	});
});

/* -------------------------------------------------------------------------- */
/* privateResidenceReliefPeriod                                                */
/* -------------------------------------------------------------------------- */

describe('privateResidenceReliefPeriod', () => {
	it('relieves the whole period for a home lived in throughout', () => {
		const period = privateResidenceReliefPeriod(property(), '2026-01-01');

		expect(period.known).toBe(true);
		expect(period.totalDays).toBe(5_844);
		expect(period.occupiedDays).toBe(5_844);
		expect(period.reliefDays).toBe(5_844);
		expect(period.reliefFraction).toBe(1);
		expect(period.everMainResidence).toBe(true);
	});

	it('relieves nothing for a buy-to-let that was never a main residence', () => {
		const period = privateResidenceReliefPeriod(
			property({ type: 'buy_to_let', let_from: null }),
			'2026-01-01'
		);

		expect(period.totalDays).toBe(5_844);
		expect(period.occupiedDays).toBe(0);
		expect(period.everMainResidence).toBe(false);
		// No main residence at any point means no final-period exemption either.
		expect(period.finalPeriodDays).toBe(0);
		expect(period.reliefFraction).toBe(0);
	});

	it('apportions a home lived in for part of the ownership and let for the rest', () => {
		const period = privateResidenceReliefPeriod(property({ let_from: '2018-01-01' }), '2026-01-01');

		expect(period.totalDays).toBe(5_844);
		expect(period.occupiedDays).toBe(2_922);
		expect(period.finalPeriodDays).toBe(275);
		expect(period.reliefDays).toBe(3_197);
		expect(period.reliefFraction).toBeCloseTo(3_197 / 5_844, 10);
		expect(period.letFrom).toBe('2018-01-01');
	});

	it('counts the last nine months even though the property was let throughout them', () => {
		const period = privateResidenceReliefPeriod(
			property({ purchase_date: '2016-01-01', let_from: '2016-07-01' }),
			'2026-01-01'
		);

		// Six months lived in, nine and a half years let — and the last nine of those are still
		// deemed occupation because it was a main residence at some point.
		expect(period.occupiedDays).toBe(182);
		expect(period.finalPeriodDays).toBe(275);
		expect(period.reliefDays).toBe(457);
		expect(period.totalDays).toBe(3_653);
	});

	it('measures the final period in calendar months from the sale date', () => {
		// 9 months before 2026-01-15 is 2025-04-15: 15 + 31 + 30 + 31 + 31 + 30 + 31 + 30 + 31 + 15.
		expect(
			privateResidenceReliefPeriod(property({ let_from: '2011-01-01' }), '2026-01-15')
				.finalPeriodDays
		).toBe(275);

		// 9 months before 2026-03-31 clamps to 2025-06-30 rather than spilling into 1 July.
		expect(
			privateResidenceReliefPeriod(property({ let_from: '2011-01-01' }), '2026-03-31')
				.finalPeriodDays
		).toBe(274);
	});

	it('caps relief at the ownership period when occupation and the final period overlap', () => {
		// Owned three months, lived in for one: 1 month occupied + 9 months deemed would otherwise
		// relieve more days than the property was ever owned for.
		const period = privateResidenceReliefPeriod(
			property({ purchase_date: '2025-10-01', let_from: '2025-11-01' }),
			'2026-01-01'
		);

		expect(period.totalDays).toBe(92);
		expect(period.occupiedDays).toBe(31);
		expect(period.finalPeriodDays).toBe(92);
		expect(period.reliefDays).toBe(92);
		expect(period.reliefFraction).toBe(1);
	});

	it('reads a let_from before the purchase as "let from the day it was bought"', () => {
		const period = privateResidenceReliefPeriod(
			property({ type: 'buy_to_let', let_from: '2005-01-01' }),
			'2026-01-01'
		);

		expect(period.occupiedDays).toBe(0);
		expect(period.everMainResidence).toBe(false);
		expect(period.reliefFraction).toBe(0);
	});

	it('reads a let_from on the purchase date the same way — never a main residence', () => {
		const period = privateResidenceReliefPeriod(property({ let_from: '2010-01-01' }), '2026-01-01');

		expect(period.occupiedDays).toBe(0);
		expect(period.everMainResidence).toBe(false);
		expect(period.finalPeriodDays).toBe(0);
	});

	it('reads a let_from after the sale as "still not let when it was sold"', () => {
		const period = privateResidenceReliefPeriod(property({ let_from: '2030-01-01' }), '2026-01-01');

		expect(period.occupiedDays).toBe(5_844);
		expect(period.reliefFraction).toBe(1);
	});

	it('lets let_from override the type — a let buy-to-let that was lived in first', () => {
		const period = privateResidenceReliefPeriod(
			property({ type: 'buy_to_let', let_from: '2018-01-01' }),
			'2026-01-01'
		);

		expect(period.occupiedDays).toBe(2_922);
		expect(period.everMainResidence).toBe(true);
	});

	it('treats a holiday home with no letting date as never a main residence', () => {
		expect(
			privateResidenceReliefPeriod(property({ type: 'holiday_home' }), '2026-01-01').reliefFraction
		).toBe(0);
	});

	it('is unavailable rather than guessing when there is no purchase date', () => {
		const period = privateResidenceReliefPeriod(property({ purchase_date: null }), '2026-01-01');

		expect(period.known).toBe(false);
		expect(period.totalDays).toBe(0);
		expect(period.reliefFraction).toBe(0);
	});

	it('is unavailable for a missing, malformed or impossible sale date', () => {
		expect(privateResidenceReliefPeriod(property(), null).known).toBe(false);
		expect(privateResidenceReliefPeriod(property(), 'not-a-date').known).toBe(false);
		expect(privateResidenceReliefPeriod(property(), '2026-02-30').known).toBe(false);
		// Sold before it was bought.
		expect(privateResidenceReliefPeriod(property(), '2009-01-01').known).toBe(false);
	});

	it('is tolerant of a missing property rather than throwing', () => {
		expect(privateResidenceReliefPeriod(undefined, '2026-01-01').known).toBe(false);
		expect(privateResidenceReliefPeriod(null, null).known).toBe(false);
	});

	it('handles a same-day sale without dividing by zero', () => {
		const lived = privateResidenceReliefPeriod(property(), '2010-01-01');
		expect(lived.totalDays).toBe(0);
		expect(lived.everMainResidence).toBe(true);
		expect(lived.reliefFraction).toBe(1);

		const let_ = privateResidenceReliefPeriod(property({ type: 'buy_to_let' }), '2010-01-01');
		expect(let_.reliefFraction).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Private Residence Relief, end to end                                        */
/* -------------------------------------------------------------------------- */

describe('capitalGainsTaxOnPropertySale — Private Residence Relief', () => {
	it('charges nothing on a home owned throughout as the main residence', () => {
		const result = capitalGainsTaxOnPropertySale({
			property: property(),
			salePrice: 500_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});

		expect(result.gain).toBe(300_000);
		expect(result.privateResidenceRelief).toBe(300_000);
		expect(result.gainAfterRelief).toBe(0);
		expect(result.taxableGain).toBe(0);
		expect(result.totalTax).toBe(0);
		// Nothing chargeable means the exemption was never reached, let alone used.
		expect(result.annualExemptAmountUsed).toBe(0);
		expect(result.effectiveRate).toBe(0);
	});

	it('gives a never-occupied buy-to-let no relief at all', () => {
		const result = capitalGainsTaxOnPropertySale({
			property: property({ type: 'buy_to_let' }),
			salePrice: 500_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});

		expect(result.privateResidenceRelief).toBe(0);
		expect(result.gainAfterRelief).toBe(300_000);
		expect(result.taxableGain).toBe(297_000);
		// Other income of £60,000 leaves no basic rate band, so the whole gain is charged at 24%.
		expect(result.totalTax).toBeCloseTo(71_280, PENNY);
	});

	it('time-apportions a home lived in for eight years and let for eight — the worked example', () => {
		const result = capitalGainsTaxOnPropertySale({
			property: property({ let_from: '2018-01-01' }),
			salePrice: 500_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});

		expect(result.gain).toBe(300_000);
		expect(result.period.reliefDays).toBe(3_197);
		expect(result.privateResidenceRelief).toBeCloseTo(164_117.04, PENNY);
		expect(result.gainAfterRelief).toBeCloseTo(135_882.96, PENNY);
		expect(result.annualExemptAmountUsed).toBe(3_000);
		expect(result.taxableGain).toBeCloseTo(132_882.96, PENNY);
		expect(result.totalTax).toBeCloseTo(31_891.91, PENNY);
		expect(result.effectiveRate).toBeCloseTo((31_891.91 / 300_000) * 100, MILLIONTH);
	});

	it('applies the final-period exemption to a gain made entirely while the property was let', () => {
		const input = {
			property: property({ purchase_date: '2016-01-01', let_from: '2016-07-01' }),
			salePrice: 400_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		};
		const withFinalPeriod = capitalGainsTaxOnPropertySale(input);

		// 457 of 3,653 days relieved: 182 lived in, plus the last nine months it was still let for.
		expect(withFinalPeriod.privateResidenceRelief).toBeCloseTo((200_000 * 457) / 3_653, PENNY);

		// The same disposal without the deemed final period would relieve only the 182 lived-in days,
		// so the exemption is worth the difference — the nine months are doing real work here.
		const occupiedOnly = (200_000 * 182) / 3_653;
		expect(withFinalPeriod.privateResidenceRelief).toBeGreaterThan(occupiedOnly);
		expect(withFinalPeriod.period.finalPeriodDays).toBe(275);
	});

	it('gives the final period only to a property that was a main residence at some point', () => {
		const neverLivedIn = capitalGainsTaxOnPropertySale({
			property: property({ type: 'buy_to_let', purchase_date: '2016-01-01' }),
			salePrice: 400_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});

		expect(neverLivedIn.period.finalPeriodDays).toBe(0);
		expect(neverLivedIn.privateResidenceRelief).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* The annual exempt amount                                                    */
/* -------------------------------------------------------------------------- */

describe('capitalGainsTaxOnPropertySale — annual exempt amount', () => {
	/** @param {number} salePrice */
	const sale = (salePrice) => ({
		property: property({ type: 'buy_to_let' }),
		salePrice,
		saleDate: '2026-01-01',
		otherIncome: 60_000
	});

	it('takes £3,000 off the relieved gain before anything is charged', () => {
		const result = capitalGainsTaxOnPropertySale(sale(210_000));

		expect(result.gain).toBe(10_000);
		expect(result.annualExemptAmountUsed).toBe(3_000);
		expect(result.annualExemptAmountRemaining).toBe(0);
		expect(result.taxableGain).toBe(7_000);
		expect(result.totalTax).toBeCloseTo(1_680, PENNY);
	});

	it('charges nothing on a gain the exemption swallows whole', () => {
		const result = capitalGainsTaxOnPropertySale(sale(202_500));

		expect(result.gain).toBe(2_500);
		expect(result.annualExemptAmountUsed).toBe(2_500);
		expect(result.annualExemptAmountRemaining).toBe(500);
		expect(result.taxableGain).toBe(0);
		expect(result.totalTax).toBe(0);
	});

	it('is an exemption, not a nil-rate band — it does not use up basic rate band space', () => {
		// £20,000 of income leaves £30,270 of basic rate band. A £33,270 gain (£30,270 taxable after
		// the exemption) fits inside it exactly: if the £3,000 used band space too, £3,000 of this
		// would have spilled into the 24% rung.
		const result = capitalGainsTaxOnPropertySale({
			property: property({ type: 'buy_to_let' }),
			salePrice: 233_270,
			saleDate: '2026-01-01',
			otherIncome: 20_000
		});

		expect(result.taxableGain).toBe(30_270);
		expect(result.bands[1].amount).toBe(0);
		expect(result.totalTax).toBeCloseTo(30_270 * 0.18, PENNY);
	});
});

/* -------------------------------------------------------------------------- */
/* Bands and rates                                                             */
/* -------------------------------------------------------------------------- */

describe('capitalGainsTaxOnPropertySale — rates by band', () => {
	/** @param {number} otherIncome */
	const sale = (otherIncome) => ({
		property: property({ type: 'buy_to_let' }),
		salePrice: 243_000,
		saleDate: '2026-01-01',
		otherIncome
	});

	it('charges 18% where the seller has basic rate band to spare', () => {
		const result = capitalGainsTaxOnPropertySale(sale(20_000));

		expect(result.taxableOtherIncome).toBe(20_000 - PERSONAL_ALLOWANCE);
		expect(result.basicRateBandAvailable).toBe(30_270);
		expect(result.taxableGain).toBe(40_000);
		expect(result.bands[0].amount).toBe(30_270);
		expect(result.bands[1].amount).toBe(9_730);
		expect(result.totalTax).toBeCloseTo(30_270 * 0.18 + 9_730 * 0.24, PENNY);
	});

	it('charges 24% on the same gain for a higher-rate taxpayer', () => {
		const result = capitalGainsTaxOnPropertySale(sale(60_000));

		expect(result.basicRateBandAvailable).toBe(0);
		expect(result.bands[0].amount).toBe(0);
		expect(result.bands[1].amount).toBe(40_000);
		expect(result.totalTax).toBeCloseTo(9_600, PENNY);
	});

	it('costs more the more other income the seller has', () => {
		expect(capitalGainsTax(sale(0))).toBeLessThan(capitalGainsTax(sale(20_000)));
		expect(capitalGainsTax(sale(20_000))).toBeLessThan(capitalGainsTax(sale(60_000)));
		// Above the higher-rate threshold the rate stops climbing — there is no additional rate.
		expect(capitalGainsTax(sale(200_000))).toBe(capitalGainsTax(sale(60_000)));
	});

	it('stacks the gain on income after the personal allowance and its taper', () => {
		// £110,000 of income tapers the allowance to £7,570, so taxable income is £102,430.
		const result = capitalGainsTaxOnPropertySale(sale(110_000));

		expect(result.taxableOtherIncome).toBe(taxableIncome(110_000));
		expect(result.taxableOtherIncome).toBe(102_430);
		expect(result.bands[1].amount).toBe(40_000);
	});

	it('charges 18% throughout for a seller with no other income at all', () => {
		const result = capitalGainsTaxOnPropertySale(sale(0));

		expect(result.taxableOtherIncome).toBe(0);
		expect(result.basicRateBandAvailable).toBe(37_700);
		expect(result.bands[0].amount).toBe(37_700);
		expect(result.bands[1].amount).toBe(2_300);
		expect(result.totalTax).toBeCloseTo(37_700 * 0.18 + 2_300 * 0.24, PENNY);
	});

	it('reports both rungs even when the gain never reaches the second', () => {
		const result = capitalGainsTaxOnPropertySale({
			property: property({ type: 'buy_to_let' }),
			salePrice: 205_000,
			saleDate: '2026-01-01',
			otherIncome: 20_000
		});

		expect(result.bands).toHaveLength(2);
		expect(result.bands[1]).toMatchObject({ id: 'higher', rate: 24, amount: 0, tax: 0 });
	});
});

/* -------------------------------------------------------------------------- */
/* Losses                                                                      */
/* -------------------------------------------------------------------------- */

describe('capitalGainsTaxOnPropertySale — losses', () => {
	it('charges nothing on a sale below the purchase price, and never negative tax', () => {
		const result = capitalGainsTaxOnPropertySale({
			property: property({ type: 'buy_to_let' }),
			salePrice: 150_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});

		expect(result.gain).toBe(-50_000);
		expect(result.isLoss).toBe(true);
		expect(result.chargeableGain).toBe(0);
		expect(result.totalTax).toBe(0);
		expect(result.taxableGain).toBe(0);
		expect(result.gainAfterTax).toBe(-50_000);
	});

	it('produces no carry-forward loss and uses none of the annual exemption', () => {
		const result = capitalGainsTaxOnPropertySale({
			property: property({ type: 'buy_to_let' }),
			salePrice: 150_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});

		expect(result.annualExemptAmountUsed).toBe(0);
		expect(result.annualExemptAmountRemaining).toBe(CGT_ANNUAL_EXEMPT_AMOUNT);
		expect(result.privateResidenceRelief).toBe(0);
		expect(Object.keys(result)).not.toContain('carriedForwardLoss');
	});
});

/* -------------------------------------------------------------------------- */
/* Shape, applicability and warnings                                           */
/* -------------------------------------------------------------------------- */

describe('capitalGainsTaxOnPropertySale — shape and warnings', () => {
	it('accounts for every pound of the gain', () => {
		const result = capitalGainsTaxOnPropertySale({
			property: property({ let_from: '2018-01-01' }),
			salePrice: 500_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});

		const bandAmounts = result.bands.reduce((total, band) => total + band.amount, 0);
		expect(result.privateResidenceRelief + result.annualExemptAmountUsed + bandAmounts).toBeCloseTo(
			result.gain,
			PENNY
		);
	});

	it('carries the tax year, so a stored result says which figures produced it', () => {
		expect(capitalGainsTaxOnPropertySale({}).taxYear).toBe(CGT_TAX_YEAR);
	});

	it('says it cannot model a property with no purchase date rather than inventing a bill', () => {
		const result = capitalGainsTaxOnPropertySale({
			property: property({ purchase_date: null }),
			salePrice: 500_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});

		expect(result.applicable).toBe(false);
		expect(result.totalTax).toBe(0);
		expect(result.gain).toBe(0);
		expect(result.warnings).toEqual([CGT_WARNINGS.noPurchaseDate]);
	});

	it('says the same for a missing sale date and for a sale before the purchase', () => {
		const base = { property: property(), salePrice: 500_000, otherIncome: 0 };

		expect(capitalGainsTaxOnPropertySale({ ...base, saleDate: null }).warnings).toEqual([
			CGT_WARNINGS.noSaleDate
		]);
		expect(capitalGainsTaxOnPropertySale({ ...base, saleDate: '2009-06-01' }).warnings).toEqual([
			CGT_WARNINGS.saleBeforePurchase
		]);
	});

	it('warns that the whole sale price is being treated as gain with no purchase price', () => {
		const result = capitalGainsTaxOnPropertySale({
			property: property({ type: 'buy_to_let', purchase_price: 0 }),
			salePrice: 500_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});

		expect(result.applicable).toBe(true);
		expect(result.gain).toBe(500_000);
		expect(result.warnings).toContain(CGT_WARNINGS.noPurchasePrice);
	});

	it('warns that buying and selling costs are not deducted whenever tax is due', () => {
		const taxable = capitalGainsTaxOnPropertySale({
			property: property({ type: 'buy_to_let' }),
			salePrice: 500_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});
		const fullyRelieved = capitalGainsTaxOnPropertySale({
			property: property(),
			salePrice: 500_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});

		expect(taxable.warnings).toContain(CGT_WARNINGS.costsNotDeducted);
		// Nothing to overstate when nothing is charged.
		expect(fullyRelieved.warnings).not.toContain(CGT_WARNINGS.costsNotDeducted);
	});

	it('treats an unrecognised property type as never a main residence, and says so', () => {
		const result = capitalGainsTaxOnPropertySale({
			property: {
				...property(),
				type: /** @type {import('./enums.js').PropertyType} */ ('lunar_timeshare')
			},
			salePrice: 500_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		});

		expect(result.privateResidenceRelief).toBe(0);
		expect(result.warnings).toContain(CGT_WARNINGS.unknownPropertyType);
	});

	it('is tolerant of missing, malformed or negative inputs rather than throwing', () => {
		expect(capitalGainsTaxOnPropertySale().totalTax).toBe(0);
		expect(capitalGainsTaxOnPropertySale({}).applicable).toBe(false);
		expect(
			capitalGainsTaxOnPropertySale({
				property: null,
				salePrice: /** @type {number} */ (/** @type {unknown} */ ('lots')),
				saleDate: '2026-01-01'
			}).totalTax
		).toBe(0);

		// A negative sale price or income is read as zero, the same `asMoney` convention tax.js uses.
		const negative = capitalGainsTaxOnPropertySale({
			property: property({ type: 'buy_to_let' }),
			salePrice: -500_000,
			saleDate: '2026-01-01',
			otherIncome: -10_000
		});
		expect(negative.salePrice).toBe(0);
		expect(negative.otherIncome).toBe(0);
		expect(negative.totalTax).toBe(0);
	});

	it('capitalGainsTax is the breakdown’s totalTax and nothing else', () => {
		const input = {
			property: property({ let_from: '2018-01-01' }),
			salePrice: 500_000,
			saleDate: '2026-01-01',
			otherIncome: 60_000
		};

		expect(capitalGainsTax(input)).toBe(capitalGainsTaxOnPropertySale(input).totalTax);
	});
});
