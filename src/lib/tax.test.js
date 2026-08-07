/**
 * Income tax bands and take-home pay, 2026/27 — issue #23.
 *
 * The whole point of this module is that the thresholds are exactly right, so the tests here pin
 * the published figures rather than only checking that the arithmetic is self-consistent: HMRC's
 * "Income Tax rates and allowances for current and previous tax years" (gov.uk, 2026 to 2027
 * column) for the ladders themselves, and hand-worked totals at each band edge for the tax due.
 */
import { describe, expect, it } from 'vitest';

import { TAX_REGIONS } from './enums.js';
import {
	ALLOWANCE_EXHAUSTED_AT,
	ALLOWANCE_TAPER_THRESHOLD,
	bandsFor,
	compareRegions,
	effectiveTaxRate,
	ENGLAND_WALES_NI_BANDS,
	INCOME_TAX_BANDS,
	allowanceLostToTaper,
	inAllowanceTaper,
	incomeTax,
	marginalTaxRate,
	normaliseTaxRegion,
	PERSONAL_ALLOWANCE,
	personalAllowance,
	SCOTLAND_BANDS,
	sliceIntoBands,
	takeHomeBreakdown,
	takeHomePay,
	TAX_YEAR,
	taxableIncome
} from './tax.js';

/**
 * Hand-worked expectations are built from decimal multiplications, which drift in the last few
 * binary places; this rounds them to whole pence the same way `tax.js` rounds its own answers.
 *
 * @param {number} amount
 * @returns {number}
 */
const p = (amount) => Math.round(amount * 100) / 100;

describe('the 2026/27 band ladders', () => {
	it('is labelled with the tax year its figures belong to', () => {
		expect(TAX_YEAR).toBe('2026/27');
		expect(takeHomeBreakdown({ income: 50_000 }).taxYear).toBe('2026/27');
	});

	it('covers every TaxRegion the data model allows', () => {
		for (const region of TAX_REGIONS) {
			expect(INCOME_TAX_BANDS[region]).toBeDefined();
			expect(INCOME_TAX_BANDS[region].length).toBeGreaterThan(0);
		}
		expect(Object.keys(INCOME_TAX_BANDS).sort()).toEqual([...TAX_REGIONS].sort());
	});

	it('matches HMRC for England, Wales and Northern Ireland', () => {
		expect(
			ENGLAND_WALES_NI_BANDS.map(({ id, rate, from, to }) => ({ id, rate, from, to }))
		).toEqual([
			{ id: 'basic', rate: 20, from: 0, to: 37_700 },
			{ id: 'higher', rate: 40, from: 37_700, to: 125_140 },
			{ id: 'additional', rate: 45, from: 125_140, to: null }
		]);
	});

	it('matches HMRC for Scotland', () => {
		expect(SCOTLAND_BANDS.map(({ id, rate, from, to }) => ({ id, rate, from, to }))).toEqual([
			{ id: 'starter', rate: 19, from: 0, to: 3_967 },
			{ id: 'basic', rate: 20, from: 3_967, to: 16_956 },
			{ id: 'intermediate', rate: 21, from: 16_956, to: 31_092 },
			{ id: 'higher', rate: 42, from: 31_092, to: 62_430 },
			{ id: 'advanced', rate: 45, from: 62_430, to: 125_140 },
			{ id: 'top', rate: 48, from: 125_140, to: null }
		]);
	});

	it('reproduces the Scottish gross-income thresholds once the allowance is added back', () => {
		// The figures the Scottish Government publishes are on gross income; ours are on taxable
		// income (convention 1). Adding the full allowance to each ceiling has to reproduce them.
		const grossCeilings = SCOTLAND_BANDS.slice(0, 4).map(
			(band) => (band.to ?? 0) + PERSONAL_ALLOWANCE
		);

		expect(grossCeilings).toEqual([16_537, 29_526, 43_662, 75_000]);
	});

	it('leaves no gaps or overlaps in either ladder', () => {
		for (const region of TAX_REGIONS) {
			const bands = bandsFor(region);
			expect(bands[0].from).toBe(0);
			expect(bands.at(-1)?.to).toBeNull();
			for (let i = 1; i < bands.length; i += 1) {
				expect(bands[i].from).toBe(bands[i - 1].to);
			}
		}
	});

	it('falls back to England/Wales/NI for a region it does not recognise', () => {
		expect(normaliseTaxRegion('wales_only')).toBe('england_wales_ni');
		expect(normaliseTaxRegion(undefined)).toBe('england_wales_ni');
		expect(normaliseTaxRegion('scotland')).toBe('scotland');
		expect(bandsFor('nonsense')).toBe(ENGLAND_WALES_NI_BANDS);
	});
});

describe('personalAllowance', () => {
	it('is the full £12,570 up to and including £100,000', () => {
		expect(personalAllowance(0)).toBe(12_570);
		expect(personalAllowance(50_000)).toBe(12_570);
		expect(personalAllowance(ALLOWANCE_TAPER_THRESHOLD)).toBe(12_570);
	});

	it('falls by £1 for every £2 above £100,000', () => {
		expect(personalAllowance(100_002)).toBe(12_569);
		expect(personalAllowance(110_000)).toBe(7_570);
		expect(personalAllowance(120_000)).toBe(2_570);
	});

	it('reaches exactly zero at £125,140 and stays there', () => {
		expect(ALLOWANCE_EXHAUSTED_AT).toBe(125_140);
		expect(personalAllowance(125_139)).toBe(0.5);
		expect(personalAllowance(ALLOWANCE_EXHAUSTED_AT)).toBe(0);
		expect(personalAllowance(1_000_000)).toBe(0);
	});

	it('reports what the taper took', () => {
		expect(allowanceLostToTaper(90_000)).toBe(0);
		expect(allowanceLostToTaper(110_000)).toBe(5_000);
		expect(allowanceLostToTaper(130_000)).toBe(PERSONAL_ALLOWANCE);
	});

	it('marks README.md’s £100k–£125,140 band, inclusive at the bottom only', () => {
		expect(inAllowanceTaper(99_999)).toBe(false);
		expect(inAllowanceTaper(100_000)).toBe(true);
		expect(inAllowanceTaper(125_139)).toBe(true);
		expect(inAllowanceTaper(125_140)).toBe(false);
	});

	it('treats a negative or nonsense income as nothing earned', () => {
		expect(personalAllowance(-5_000)).toBe(12_570);
		expect(personalAllowance(Number.NaN)).toBe(12_570);
	});
});

describe('taxableIncome', () => {
	it('is income less the allowance, never below zero', () => {
		expect(taxableIncome(0)).toBe(0);
		expect(taxableIncome(10_000)).toBe(0);
		expect(taxableIncome(12_570)).toBe(0);
		expect(taxableIncome(50_000)).toBe(37_430);
	});

	it('grows £1.50 for every extra £1 inside the taper band', () => {
		expect(taxableIncome(100_000)).toBe(87_430);
		expect(taxableIncome(100_100)).toBe(87_580);
		expect(taxableIncome(125_140)).toBe(125_140);
	});
});

describe('incomeTax — England, Wales and Northern Ireland', () => {
	it('charges nothing up to the personal allowance', () => {
		expect(incomeTax(0)).toBe(0);
		expect(incomeTax(12_570)).toBe(0);
	});

	it('charges 20% on the first £37,700 above it', () => {
		expect(incomeTax(20_000)).toBe(p(7_430 * 0.2));
		// The very top of the basic rate band: £12,570 + £37,700.
		expect(incomeTax(50_270)).toBe(7_540);
	});

	it('charges 40% between £50,270 and £100,000', () => {
		expect(incomeTax(60_000)).toBe(p(7_540 + 9_730 * 0.4));
		expect(incomeTax(100_000)).toBe(27_432);
	});

	it('reaches £42,516 at £125,140, where the allowance has gone', () => {
		expect(incomeTax(125_140)).toBe(42_516);
	});

	it('charges 45% above £125,140', () => {
		expect(incomeTax(150_000)).toBe(53_703);
		expect(incomeTax(200_000)).toBe(p(42_516 + 74_860 * 0.45));
	});
});

describe('incomeTax — Scotland', () => {
	/** @param {number} income @returns {number} */
	const scot = (income) => incomeTax(income, 'scotland');

	it('charges nothing up to the personal allowance', () => {
		expect(scot(12_570)).toBe(0);
	});

	it('charges 19% through the starter band, to £16,537 of income', () => {
		expect(scot(15_000)).toBe(p(2_430 * 0.19));
		expect(scot(16_537)).toBe(p(3_967 * 0.19));
	});

	it('charges 20% then 21% through the basic and intermediate bands', () => {
		const starter = 3_967 * 0.19;
		expect(scot(29_526)).toBe(p(starter + 12_989 * 0.2));
		expect(scot(43_662)).toBe(p(starter + 12_989 * 0.2 + 14_136 * 0.21));
	});

	it('charges 42% through the higher band, to £75,000 of income', () => {
		const throughIntermediate = 3_967 * 0.19 + 12_989 * 0.2 + 14_136 * 0.21;
		expect(scot(50_000)).toBe(p(throughIntermediate + 6_338 * 0.42));
		expect(scot(75_000)).toBe(p(throughIntermediate + 31_338 * 0.42));
	});

	it('charges 45% through the advanced band and 48% on the top rate', () => {
		const throughHigher = 3_967 * 0.19 + 12_989 * 0.2 + 14_136 * 0.21 + 31_338 * 0.42;
		expect(scot(125_140)).toBe(p(throughHigher + 62_710 * 0.45));
		expect(scot(150_000)).toBe(p(throughHigher + 62_710 * 0.45 + 24_860 * 0.48));
	});

	it('is cheaper than England/Wales/NI on a low salary and dearer on a high one', () => {
		expect(compareRegions(30_000).difference).toBeLessThan(0);
		expect(compareRegions(60_000).difference).toBeGreaterThan(0);
		expect(compareRegions(30_000).scotland.totalTax).toBe(scot(30_000));
	});
});

describe('sliceIntoBands', () => {
	it('returns the whole ladder, including bands the income never reaches', () => {
		const slices = sliceIntoBands(10_000, 'scotland');
		expect(slices).toHaveLength(6);
		expect(slices.map((slice) => slice.amount)).toEqual([3_967, 6_033, 0, 0, 0, 0]);
		expect(slices.filter((slice) => slice.amount > 0).map((slice) => slice.id)).toEqual([
			'starter',
			'basic'
		]);
	});

	it('splits an income across bands so the pieces add back up', () => {
		const slices = sliceIntoBands(87_430);
		expect(slices.reduce((total, slice) => total + slice.amount, 0)).toBe(87_430);
		expect(slices.map((slice) => slice.amount)).toEqual([37_700, 49_730, 0]);
	});

	it('puts a boundary pound in the band below it', () => {
		// "Up to £37,700" means £37,700 exactly is all basic rate; £37,701 spills one pound over.
		expect(sliceIntoBands(37_700).map((slice) => slice.amount)).toEqual([37_700, 0, 0]);
		expect(sliceIntoBands(37_701).map((slice) => slice.amount)).toEqual([37_700, 1, 0]);
	});

	it('charges each slice at its own rate', () => {
		const [basic, higher] = sliceIntoBands(50_000);
		expect(basic.tax).toBe(7_540);
		expect(higher.tax).toBe(p(12_300 * 0.4));
	});
});

describe('marginalTaxRate', () => {
	it('is 0% below the allowance', () => {
		expect(marginalTaxRate(0)).toBe(0);
		expect(marginalTaxRate(12_000)).toBe(0);
	});

	it('is the surrounding band rate outside the taper', () => {
		expect(marginalTaxRate(12_570)).toBe(20);
		expect(marginalTaxRate(30_000)).toBe(20);
		expect(marginalTaxRate(60_000)).toBe(40);
		expect(marginalTaxRate(150_000)).toBe(45);

		expect(marginalTaxRate(30_000, 'scotland')).toBe(21);
		expect(marginalTaxRate(60_000, 'scotland')).toBe(42);
		expect(marginalTaxRate(80_000, 'scotland')).toBe(45);
		expect(marginalTaxRate(150_000, 'scotland')).toBe(48);
	});

	it('is README.md’s 60% across £100k–£125,140, and 67.5% in Scotland', () => {
		expect(marginalTaxRate(100_000)).toBe(60);
		expect(marginalTaxRate(110_000)).toBe(60);
		expect(marginalTaxRate(125_139)).toBe(60);
		// Back to the headline rate the moment there is no allowance left to lose.
		expect(marginalTaxRate(125_140)).toBe(45);

		expect(marginalTaxRate(110_000, 'scotland')).toBe(67.5);
		expect(marginalTaxRate(125_140, 'scotland')).toBe(48);
	});

	it('agrees with what the next £100 of income actually costs', () => {
		// The analytic answer above and the observed one have to be the same thing. £100 rather than
		// £1 so the comparison isn't swamped by rounding to the penny; incomes chosen to sit clear of
		// band edges, where a £100 step would straddle two rates.
		for (const region of TAX_REGIONS) {
			for (const income of [20_000, 45_000, 80_000, 105_000, 118_000, 200_000]) {
				const observed =
					((incomeTax(income + 100, region) - incomeTax(income, region)) / 100) * 100;
				expect(p(observed)).toBeCloseTo(marginalTaxRate(income, region), 6);
			}
		}
	});
});

describe('takeHomePay and effectiveTaxRate', () => {
	it('is income less income tax', () => {
		// £50,000 leaves £37,430 taxable, all of it basic rate: £7,486 of tax.
		expect(takeHomePay(50_000)).toBe(42_514);
		expect(takeHomePay(50_000, 'scotland')).toBe(p(50_000 - incomeTax(50_000, 'scotland')));
	});

	it('is the whole income when nothing is owed', () => {
		expect(takeHomePay(12_570)).toBe(12_570);
		expect(effectiveTaxRate(12_570)).toBe(0);
	});

	it('rises with income but always stays below the marginal rate', () => {
		for (const income of [20_000, 50_000, 100_000, 150_000]) {
			expect(effectiveTaxRate(income)).toBeLessThan(marginalTaxRate(income));
		}
		expect(effectiveTaxRate(20_000)).toBeLessThan(effectiveTaxRate(50_000));
		expect(effectiveTaxRate(50_000)).toBeLessThan(effectiveTaxRate(150_000));
	});

	it('does not divide by zero on an income of nothing', () => {
		expect(effectiveTaxRate(0)).toBe(0);
		expect(takeHomeBreakdown({ income: 0 }).effectiveRate).toBe(0);
	});
});

describe('takeHomeBreakdown', () => {
	it('accounts for every pound earned', () => {
		for (const income of [8_000, 30_000, 60_000, 110_000, 250_000]) {
			for (const region of TAX_REGIONS) {
				const result = takeHomeBreakdown({ income, region });
				const accounted =
					result.allowance.used + result.bands.reduce((total, slice) => total + slice.amount, 0);
				expect(p(accounted)).toBe(income);
				expect(p(result.takeHome + result.totalTax)).toBe(income);
			}
		}
	});

	it('reports the allowance the bands were actually measured against', () => {
		const comfortable = takeHomeBreakdown({ income: 60_000 });
		expect(comfortable.allowance).toMatchObject({
			standard: 12_570,
			available: 12_570,
			used: 12_570,
			lost: 0,
			tapered: false,
			inTaperBand: false
		});

		const tapered = takeHomeBreakdown({ income: 110_000 });
		expect(tapered.allowance).toMatchObject({
			available: 7_570,
			used: 7_570,
			lost: 5_000,
			tapered: true,
			inTaperBand: true
		});

		// Below the allowance, only the part actually covered counts as used.
		const small = takeHomeBreakdown({ income: 8_000 });
		expect(small.allowance.available).toBe(12_570);
		expect(small.allowance.used).toBe(8_000);
	});

	it('breaks the year down into months and weeks', () => {
		const result = takeHomeBreakdown({ income: 50_000 });
		expect(result.takeHome).toBe(42_514);
		expect(result.monthlyTakeHome).toBe(p(42_514 / 12));
		expect(result.weeklyTakeHome).toBe(p(42_514 / 52));
		expect(result.monthlyTax).toBe(p(7_486 / 12));
	});

	it('normalises a missing or unrecognised region rather than throwing', () => {
		expect(takeHomeBreakdown().region).toBe('england_wales_ni');
		// Cast because the input type promises a `TaxRegion`; the point of the assertion is that a
		// document with a bad `profile.tax_region` in it still calculates rather than throwing.
		const nonsense = /** @type {any} */ ('narnia');
		expect(takeHomeBreakdown({ income: 50_000, region: nonsense }).region).toBe('england_wales_ni');
		expect(takeHomeBreakdown({ income: -1 }).income).toBe(0);
		expect(takeHomeBreakdown({ income: Number.NaN }).totalTax).toBe(0);
	});

	it('agrees with the standalone helpers it composes', () => {
		for (const region of TAX_REGIONS) {
			for (const income of [0, 15_000, 43_000, 99_000, 112_500, 300_000]) {
				const result = takeHomeBreakdown({ income, region });
				expect(result.totalTax).toBe(incomeTax(income, region));
				expect(result.takeHome).toBe(takeHomePay(income, region));
				expect(result.taxableIncome).toBe(taxableIncome(income));
				expect(result.marginalRate).toBe(marginalTaxRate(income, region));
				expect(result.effectiveRate).toBe(effectiveTaxRate(income, region));
			}
		}
	});
});

describe('compareRegions', () => {
	it('runs the same income through both ladders', () => {
		const both = compareRegions(50_000);
		expect(both.england_wales_ni.region).toBe('england_wales_ni');
		expect(both.scotland.region).toBe('scotland');
		expect(both.difference).toBe(p(both.scotland.totalTax - both.england_wales_ni.totalTax));
	});

	it('crosses over somewhere around £30,000', () => {
		// Scotland's starter rate makes it cheaper at the bottom; the 42% higher rate, which starts
		// £6,608 of income earlier than England's 40%, makes it dearer well before £50,000.
		expect(compareRegions(20_000).difference).toBeLessThan(0);
		expect(compareRegions(40_000).difference).toBeGreaterThan(0);
	});
});
