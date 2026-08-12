import { describe, expect, it } from 'vitest';

import { inheritanceTaxWithGifts, lifetimeGiftLedger } from './lifetime-gifts.js';
import {
	DEFAULT_PROPERTY_GIFT_BENEFICIARY,
	DEFAULT_PROPERTY_SALE,
	DEFAULT_PROPERTY_SALE_GIFTED_PCT,
	createPropertyGiftBeneficiary,
	normalisePropertyGiftBeneficiaries,
	normalisePropertyGiftBeneficiary,
	normalisePropertySale,
	propertySaleGifts,
	propertySaleGiftsFromProperty
} from './property-gift-on-sale.js';

describe('createPropertyGiftBeneficiary', () => {
	it('gives every beneficiary a stable, prefixed id', () => {
		const beneficiary = createPropertyGiftBeneficiary();
		expect(beneficiary.id).toMatch(/^beneficiary/);
		expect(beneficiary).toMatchObject(DEFAULT_PROPERTY_GIFT_BENEFICIARY);
	});

	it('applies overrides on top of the defaults', () => {
		const beneficiary = createPropertyGiftBeneficiary({ name: 'Jo', sharePct: 50 });
		expect(beneficiary.name).toBe('Jo');
		expect(beneficiary.sharePct).toBe(50);
		expect(beneficiary.exemption).toBe('none');
	});
});

describe('normalisePropertyGiftBeneficiary', () => {
	it('fills in every field from an empty object', () => {
		expect(normalisePropertyGiftBeneficiary()).toMatchObject({
			name: '',
			sharePct: 0,
			exemption: 'none'
		});
	});

	it('preserves a supplied id rather than minting a new one', () => {
		expect(normalisePropertyGiftBeneficiary({ id: 'ben-1' }).id).toBe('ben-1');
	});

	it('clamps a negative sharePct to zero', () => {
		expect(normalisePropertyGiftBeneficiary({ sharePct: -10 }).sharePct).toBe(0);
	});

	it('coerces a non-numeric sharePct to the default', () => {
		expect(
			normalisePropertyGiftBeneficiary({ sharePct: /** @type {never} */ ('lots') }).sharePct
		).toBe(0);
	});

	it('falls back an unrecognised exemption to none, the chargeable reading', () => {
		expect(
			normalisePropertyGiftBeneficiary({ exemption: /** @type {never} */ ('not-a-real-one') })
				.exemption
		).toBe('none');
	});

	it('keeps a recognised exemption', () => {
		expect(normalisePropertyGiftBeneficiary({ exemption: 'spouse' }).exemption).toBe('spouse');
	});
});

describe('normalisePropertyGiftBeneficiaries', () => {
	it('normalises every entry in a list', () => {
		const result = normalisePropertyGiftBeneficiaries([{ name: 'A' }, { name: 'B', sharePct: -5 }]);
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe('A');
		expect(result[1].sharePct).toBe(0);
	});

	it('reads anything that is not an array as no beneficiaries', () => {
		expect(normalisePropertyGiftBeneficiaries(undefined)).toEqual([]);
		expect(normalisePropertyGiftBeneficiaries(null)).toEqual([]);
		expect(normalisePropertyGiftBeneficiaries(/** @type {never} */ ('not a list'))).toEqual([]);
	});
});

describe('normalisePropertySale', () => {
	it('fills in every field from an empty object', () => {
		expect(normalisePropertySale()).toEqual(DEFAULT_PROPERTY_SALE);
	});

	it('clamps giftedPct to 0-100', () => {
		expect(normalisePropertySale({ giftedPct: 150 }).giftedPct).toBe(100);
		expect(normalisePropertySale({ giftedPct: -20 }).giftedPct).toBe(0);
	});

	it('defaults giftedPct to 100 when omitted', () => {
		expect(normalisePropertySale({}).giftedPct).toBe(DEFAULT_PROPERTY_SALE_GIFTED_PCT);
	});

	it('clamps negative money fields to zero', () => {
		const sale = normalisePropertySale({
			salePrice: -100,
			mortgageRedemption: -50,
			sellingCosts: -5
		});
		expect(sale.salePrice).toBe(0);
		expect(sale.mortgageRedemption).toBe(0);
		expect(sale.sellingCosts).toBe(0);
	});

	it('reads an empty-string date as undated', () => {
		expect(normalisePropertySale({ date: '' }).date).toBeNull();
	});
});

describe('propertySaleGifts', () => {
	it('splits a fully-gifted sale evenly between two beneficiaries weighted 1:1', () => {
		const result = propertySaleGifts({
			date: '2026-06-01',
			propertyName: 'Old family home',
			salePrice: 500_000,
			mortgageRedemption: 150_000,
			sellingCosts: 10_000,
			giftedPct: 100,
			beneficiaries: [
				{ name: 'Alex', sharePct: 1 },
				{ name: 'Sam', sharePct: 1 }
			]
		});

		expect(result.netProceeds).toBeCloseTo(340_000, 2);
		expect(result.giftedProceeds).toBeCloseTo(340_000, 2);
		expect(result.retainedProceeds).toBeCloseTo(0, 2);
		expect(result.gifts).toHaveLength(2);
		expect(result.gifts[0]).toMatchObject({
			date: '2026-06-01',
			amount: 170_000,
			recipient: 'Alex',
			description: 'Share of sale proceeds: Old family home',
			exemption: 'none'
		});
		expect(result.gifts[1].amount).toBeCloseTo(170_000, 2);
	});

	it('gifts only giftedPct of the net proceeds, retaining the rest', () => {
		const result = propertySaleGifts({
			date: '2026-06-01',
			salePrice: 500_000,
			mortgageRedemption: 150_000,
			sellingCosts: 10_000,
			giftedPct: 60,
			beneficiaries: [
				{ name: 'Alex', sharePct: 1 },
				{ name: 'Sam', sharePct: 1 }
			]
		});

		expect(result.netProceeds).toBeCloseTo(340_000, 2);
		expect(result.giftedProceeds).toBeCloseTo(204_000, 2);
		expect(result.retainedProceeds).toBeCloseTo(136_000, 2);
		expect(result.gifts.map((gift) => gift.amount)).toEqual([102_000, 102_000]);
	});

	it('floors net proceeds at zero when the mortgage exceeds the sale price', () => {
		const result = propertySaleGifts({
			salePrice: 300_000,
			mortgageRedemption: 320_000,
			beneficiaries: [{ name: 'Alex', sharePct: 1 }]
		});

		expect(result.netProceeds).toBe(0);
		expect(result.giftedProceeds).toBe(0);
		expect(result.retainedProceeds).toBe(0);
		expect(result.gifts).toEqual([]);
		expect(result.splits[0].amount).toBe(0);
	});

	it('splits proportionally across unevenly weighted beneficiaries', () => {
		const result = propertySaleGifts({
			salePrice: 500_000,
			beneficiaries: [
				{ name: 'Alex', sharePct: 2 },
				{ name: 'Sam', sharePct: 1 },
				{ name: 'Jo', sharePct: 1 }
			]
		});

		expect(result.gifts.map((gift) => gift.amount)).toEqual([250_000, 125_000, 125_000]);
	});

	it('is indifferent to whether weights sum to 100 — only the ratio between them matters', () => {
		const evenThirds = propertySaleGifts({
			salePrice: 300_000,
			beneficiaries: [
				{ name: 'A', sharePct: 33.3 },
				{ name: 'B', sharePct: 33.3 },
				{ name: 'C', sharePct: 33.3 }
			]
		});
		const unitWeights = propertySaleGifts({
			salePrice: 300_000,
			beneficiaries: [
				{ name: 'A', sharePct: 1 },
				{ name: 'B', sharePct: 1 },
				{ name: 'C', sharePct: 1 }
			]
		});

		expect(evenThirds.gifts.map((gift) => gift.amount)).toEqual(
			unitWeights.gifts.map((gift) => gift.amount)
		);
	});

	it('gives the rounding remainder to the last beneficiary so the split always sums exactly', () => {
		const result = propertySaleGifts({
			salePrice: 100_000,
			beneficiaries: [
				{ name: 'A', sharePct: 1 },
				{ name: 'B', sharePct: 1 },
				{ name: 'C', sharePct: 1 }
			]
		});

		const total = result.gifts.reduce((sum, gift) => sum + gift.amount, 0);
		expect(total).toBeCloseTo(result.giftedProceeds, 2);
		expect(result.gifts[0].amount).toBeCloseTo(33_333.33, 2);
		expect(result.gifts[1].amount).toBeCloseTo(33_333.33, 2);
		// The remainder lands on the last entry, not spread evenly.
		expect(result.gifts[2].amount).toBeCloseTo(33_333.34, 2);
	});

	it('produces no gift, but reports the split, for a beneficiary on a zero share', () => {
		const result = propertySaleGifts({
			salePrice: 100_000,
			beneficiaries: [
				{ name: 'Alex', sharePct: 1 },
				{ name: 'Sam', sharePct: 0 }
			]
		});

		expect(result.splits).toHaveLength(2);
		expect(result.splits[1]).toMatchObject({ name: 'Sam', amount: 0 });
		expect(result.gifts).toHaveLength(1);
		expect(result.gifts[0].recipient).toBe('Alex');
	});

	it('gifts nothing when every beneficiary is on a zero share', () => {
		const result = propertySaleGifts({
			salePrice: 100_000,
			beneficiaries: [
				{ name: 'Alex', sharePct: 0 },
				{ name: 'Sam', sharePct: 0 }
			]
		});

		expect(result.gifts).toEqual([]);
	});

	it('gifts nothing with no beneficiaries recorded, even if giftedPct is set', () => {
		const result = propertySaleGifts({ salePrice: 100_000, giftedPct: 100, beneficiaries: [] });

		expect(result.giftedProceeds).toBeCloseTo(100_000, 2);
		expect(result.gifts).toEqual([]);
		expect(result.splits).toEqual([]);
	});

	it('passes each beneficiary’s declared exemption through to their gift', () => {
		const result = propertySaleGifts({
			salePrice: 100_000,
			beneficiaries: [{ name: 'Partner', sharePct: 1, exemption: 'spouse' }]
		});

		expect(result.gifts[0].exemption).toBe('spouse');
	});

	it('falls back to a generic description when no property name is given', () => {
		const result = propertySaleGifts({
			salePrice: 100_000,
			beneficiaries: [{ name: 'Alex', sharePct: 1 }]
		});

		expect(result.gifts[0].description).toBe('Share of property sale proceeds');
	});

	it('carries a null date onto every produced gift', () => {
		const result = propertySaleGifts({
			salePrice: 100_000,
			beneficiaries: [{ name: 'Alex', sharePct: 1 }]
		});

		expect(result.gifts[0].date).toBeNull();
	});

	it('produces gifts that plug straight into lifetimeGiftLedger', () => {
		const result = propertySaleGifts({
			date: '2024-01-01',
			salePrice: 400_000,
			beneficiaries: [
				{ name: 'Alex', sharePct: 1 },
				{ name: 'Sam', sharePct: 1 }
			]
		});

		const ledger = lifetimeGiftLedger(result.gifts, {
			deathDate: '2026-06-01',
			applyAnnualExemption: false
		});

		expect(ledger.gifts).toHaveLength(2);
		expect(ledger.gifts.every((gift) => gift.status === 'failed')).toBe(true);
		expect(ledger.chargeableTransfers).toBeCloseTo(400_000, 2);
	});

	it('feeds into inheritanceTaxWithGifts end to end', () => {
		const result = propertySaleGifts({
			date: '2020-01-01',
			salePrice: 400_000,
			beneficiaries: [{ name: 'Child', sharePct: 1 }]
		});

		const withGifts = inheritanceTaxWithGifts({ estateValue: 1_000_000 }, result.gifts, {
			deathDate: '2026-06-01',
			applyAnnualExemption: false
		});

		expect(withGifts.ledger.chargeableTransfers).toBeCloseTo(400_000, 2);
		expect(withGifts.nilRateBandUsedByGifts).toBeGreaterThan(0);
	});
});

describe('propertySaleGiftsFromProperty', () => {
	const property = {
		id: 'prop-1',
		name: 'Buy-to-let flat',
		value: 250_000,
		mortgage_balance: 80_000
	};

	it('defaults propertyName, salePrice and mortgageRedemption from the property record', () => {
		const result = propertySaleGiftsFromProperty(property, {
			date: '2026-06-01',
			beneficiaries: [{ name: 'Alex', sharePct: 1 }]
		});

		expect(result.propertyName).toBe('Buy-to-let flat');
		expect(result.salePrice).toBeCloseTo(250_000, 2);
		expect(result.mortgageRedemption).toBeCloseTo(80_000, 2);
		expect(result.netProceeds).toBeCloseTo(170_000, 2);
		expect(result.gifts[0].amount).toBeCloseTo(170_000, 2);
	});

	it('lets an explicit sale price/redemption override the property record', () => {
		const result = propertySaleGiftsFromProperty(property, {
			salePrice: 300_000,
			mortgageRedemption: 0,
			beneficiaries: [{ name: 'Alex', sharePct: 1 }]
		});

		expect(result.salePrice).toBeCloseTo(300_000, 2);
		expect(result.mortgageRedemption).toBe(0);
		expect(result.netProceeds).toBeCloseTo(300_000, 2);
	});

	it('handles a missing property record gracefully', () => {
		const result = propertySaleGiftsFromProperty(null, {
			salePrice: 100_000,
			beneficiaries: [{ name: 'Alex', sharePct: 1 }]
		});

		expect(result.propertyName).toBe('');
		expect(result.salePrice).toBeCloseTo(100_000, 2);
	});
});

describe('penny rounding', () => {
	it('never leaves a fraction of a penny in a produced gift amount', () => {
		const result = propertySaleGifts({
			salePrice: 100_000.01,
			beneficiaries: [
				{ name: 'A', sharePct: 1 },
				{ name: 'B', sharePct: 1 },
				{ name: 'C', sharePct: 1 }
			]
		});

		for (const gift of result.gifts) {
			expect(Math.round(gift.amount * 100) / 100).toBe(gift.amount);
		}
	});
});
