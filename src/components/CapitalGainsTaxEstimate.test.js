/**
 * Server-rendered smoke tests for the Capital Gains Tax estimate panel (issue #246, over the
 * `$lib/capital-gains.js` engine from #245).
 *
 * As `MortgageRateRisePanel.test.js`/`DividendTaxSummary.test.js` document: no browser test
 * environment, so `svelte/server`'s `render` covers the initial render only. Every input this panel
 * has (property, sale date, sale price, other income) is reachable through the `initialXxx` props —
 * the same idiom `MortgageRateRisePanel`'s dials use — so the maths itself is fully exercisable here
 * even though nothing can be typed into a field. The arithmetic is covered directly, and to the
 * penny, in `$lib/capital-gains.test.js`; these tests pin what the panel does with it.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createProperty } from '$lib/model.js';
import CapitalGainsTaxEstimate from './CapitalGainsTaxEstimate.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(CapitalGainsTaxEstimate, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ');
}

describe('CapitalGainsTaxEstimate', () => {
	it('says so, and points at the Property tab, when there are no properties recorded', () => {
		const body = text({ properties: [] });
		expect(body).toContain('No properties recorded yet');
		expect(body).toContain('Property tab');
		expect(body).not.toContain('Rate by rate');
	});

	it('says so when no recorded property has both a purchase price and a purchase date', () => {
		const body = text({
			properties: [
				createProperty({ name: 'No dates yet', purchase_price: 0, purchase_date: null }),
				createProperty({ name: 'Price only', purchase_price: 200_000, purchase_date: null }),
				createProperty({ name: 'Date only', purchase_price: 0, purchase_date: '2015-01-01' })
			]
		});
		expect(body).toContain("can't be estimated");
		expect(body).toContain('Property tab');
		expect(body).not.toContain('No dates yet');
		expect(body).not.toContain('Price only');
		expect(body).not.toContain('Date only');
	});

	it('filters the picker to properties with both fields recorded, and picks the first by default', () => {
		const body = text({
			properties: [
				createProperty({ name: 'Not eligible', purchase_price: 0, purchase_date: null }),
				createProperty({
					id: 'prop_a',
					name: 'First house',
					purchase_price: 150_000,
					purchase_date: '2012-01-01'
				}),
				createProperty({
					id: 'prop_b',
					name: 'Second house',
					purchase_price: 200_000,
					purchase_date: '2015-01-01'
				})
			],
			initialSaleDate: '2026-01-01',
			initialSalePrice: 300_000
		});
		expect(body).toContain('First house');
		expect(body).toContain('Second house');
		expect(body).not.toContain('Not eligible');
		// The default pick is the first eligible property, not the first property overall.
		expect(body).toContain('First house was owned for');
	});

	it('labels an unnamed property honestly rather than leaving it blank', () => {
		const body = text({
			properties: [
				createProperty({ name: '', purchase_price: 150_000, purchase_date: '2012-01-01' })
			],
			initialSaleDate: '2026-01-01',
			initialSalePrice: 300_000
		});
		expect(body).toContain('Unnamed property');
	});

	it('says so, without a broken figure, when the sale date is before the purchase date', () => {
		const body = text({
			properties: [
				createProperty({ name: 'A house', purchase_price: 150_000, purchase_date: '2020-01-01' })
			],
			initialSaleDate: '2015-01-01',
			initialSalePrice: 300_000
		});
		expect(body).toContain('sale date is before the purchase date');
		expect(body).not.toContain('Rate by rate');
	});

	it('reports a loss honestly: no tax, and no loss carried forward', () => {
		const body = text({
			properties: [
				createProperty({
					name: 'Underwater flat',
					purchase_price: 300_000,
					purchase_date: '2020-01-01'
				})
			],
			initialSaleDate: '2026-01-01',
			initialSalePrice: 250_000
		});
		expect(body).toContain('would be a loss');
		expect(body).toContain('£50,000 below the £300,000 purchase price');
		expect(body).toContain("doesn't record it as a loss to carry forward");
		expect(body).not.toContain('Rate by rate');
	});

	it('matches the capital-gains.js worked example to the penny', () => {
		// Bought 1 Jan 2010 for £200,000, lived in, let from 1 Jan 2018, sold 1 Jan 2026 for
		// £500,000, seller with £60,000 of other income — the exact example in the module doc header,
		// which the module's own tests also pin: gain £300,000, PRR £164,117.04, taxable gain
		// £132,882.96, tax £31,891.91 (24% throughout — no basic rate band left).
		const body = text({
			properties: [
				createProperty({
					name: 'Long-held house',
					type: 'primary_residence',
					purchase_price: 200_000,
					purchase_date: '2010-01-01',
					let_from: '2018-01-01'
				})
			],
			initialSaleDate: '2026-01-01',
			initialSalePrice: 500_000,
			initialOtherIncome: 60_000
		});

		expect(body).toContain('£300,000'); // gain before relief
		expect(body).toContain('£164,117.04'); // Private Residence Relief
		expect(body).toContain('£132,882.96'); // taxable gain (appears in stat tile and table)
		expect(body).toContain('£31,891.91'); // tax due
		expect(body).toContain('£268,108'); // net after tax: 300,000 gain - 31,891.91 tax
		expect(body).toContain('105 months'); // relief days (3,197) ≈ 105 months
		expect(body).toContain('192 months'); // total ownership (5,844 days) ≈ 192 months
		expect(body).toContain('54.7%'); // relief fraction
		expect(body).toContain('Higher rate');
		expect(body).toContain('24%');
	});

	it('splits a gain across both CGT rate bands when other income leaves headroom', () => {
		// A buy-to-let never lived in gets no relief at all, so the whole gain (less the exempt
		// amount) is taxable — chosen here to straddle the £37,700 basic rate limit with £0 other
		// income, so both bands actually carry something to assert on.
		const body = text({
			properties: [
				createProperty({
					name: 'Rental flat',
					type: 'buy_to_let',
					purchase_price: 100_000,
					purchase_date: '2016-01-01',
					let_from: null
				})
			],
			initialSaleDate: '2026-01-01',
			initialSalePrice: 143_000, // gain 43,000; less £3,000 AEA = 40,000 taxable
			initialOtherIncome: 0
		});

		expect(body).toContain('£0'); // Private Residence Relief — never a main residence
		expect(body).toContain('Basic rate');
		expect(body).toContain('£0 – £37,700');
		expect(body).toContain('£37,700.00'); // basic band gain
		expect(body).toContain('£6,786.00'); // basic band tax: 37,700 × 18%
		expect(body).toContain('Higher rate');
		expect(body).toContain('over £37,700');
		expect(body).toContain('£2,300.00'); // higher band gain
		expect(body).toContain('£552.00'); // higher band tax: 2,300 × 24%
		expect(body).toContain('£7,338.00'); // total tax
		expect(body).toContain('17.1% of the gain before relief');
	});

	it('carries the "costs not deducted" warning whenever there is a taxable gain', () => {
		const body = text({
			properties: [
				createProperty({
					name: 'Rental flat',
					type: 'buy_to_let',
					purchase_price: 100_000,
					purchase_date: '2016-01-01',
					let_from: null
				})
			],
			initialSaleDate: '2026-01-01',
			initialSalePrice: 143_000,
			initialOtherIncome: 0
		});
		expect(body).toContain('Buying and selling costs and capital improvements are not deducted');
	});

	it('carries the illustrative-only note and calls out what is deliberately not modelled', () => {
		const body = text({
			properties: [
				createProperty({
					name: 'A house',
					purchase_price: 150_000,
					purchase_date: '2012-01-01'
				})
			],
			initialSaleDate: '2026-01-01',
			initialSalePrice: 300_000
		});
		expect(body).toContain('Illustrative estimate, not tax advice');
		expect(body).toContain('Letting Relief');
		expect(body).toContain('joint ownership');
	});
});
