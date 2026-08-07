/**
 * Server-rendered smoke tests for the physical assets tracker (issue #39).
 *
 * As `PropertyTracker.test.js` documents: no browser test environment, so `svelte/server`'s
 * `render` covers the initial render only — the empty state, the field select options, and the
 * per-asset summary line, including the gain/loss/CAGR/net-position figures and the
 * `include_in_net_worth` checkbox's initial `checked` state. The add/edit/remove logic itself is
 * straightforward state-juggling (mirroring `PropertyTracker`, which does not test that part
 * either) left to `npm run build && npm run preview` manual verification instead.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { ASSET_CATEGORIES, ASSET_CATEGORY_LABELS } from '$lib/enums.js';
import { createAsset } from '$lib/model.js';
import AssetsTracker from './AssetsTracker.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(AssetsTracker, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('AssetsTracker', () => {
	it('shows an empty state with no assets recorded', () => {
		const body = text();
		expect(body).toContain('No physical assets recorded yet');
	});

	it('lists every category option in the form select', () => {
		const body = text();
		for (const category of ASSET_CATEGORIES) {
			expect(body).toContain(ASSET_CATEGORY_LABELS[category]);
		}
	});

	it("shows an asset's category, purchase and current value on its own row", () => {
		const body = text({
			assets: [
				createAsset({
					name: 'Rolex Submariner',
					category: 'watches_jewellery',
					purchase_price: 8_000,
					current_value: 11_000,
					purchase_date: '2020-08-07'
				})
			]
		});

		expect(body).toContain('Rolex Submariner');
		expect(body).toContain('Watches & Jewellery');
		expect(body).toContain('£11,000');
		expect(body).toContain('£8,000');
		expect(body).toContain('bought 2020-08-07');
	});

	it('does not show the "bought" or "/yr holding cost" notes when those fields are unset', () => {
		const body = text({
			assets: [createAsset({ name: 'Unrecorded watch', current_value: 5_000 })]
		});
		expect(body).not.toContain('bought');
		expect(body).not.toContain('/yr holding cost');
	});

	it('sums purchase price and current value across assets', () => {
		const body = text({
			assets: [
				createAsset({ name: 'A', purchase_price: 5_000, current_value: 8_000 }),
				createAsset({ name: 'B', purchase_price: 10_000, current_value: 9_000 })
			]
		});

		expect(body).toContain('2 assets recorded');
		expect(body).toContain('£17,000');
		expect(body).toContain('£15,000');
	});

	it('uses singular "asset" for exactly one recorded asset', () => {
		const body = text({ assets: [createAsset({ name: 'Solo', current_value: 1_000 })] });
		expect(body).toContain('1 asset recorded');
	});

	it('labels the submit button "Add asset" until an asset is being edited', () => {
		const body = text();
		expect(body).toContain('Add asset');
		expect(body).not.toContain('Save changes');
	});

	it("shows an asset's gain/loss and net position", () => {
		const body = text({
			assets: [createAsset({ name: 'Watch', purchase_price: 5_000, current_value: 8_000 })]
		});
		expect(body).toContain('+£3,000 gain/loss');
		expect(body).not.toContain('excluded from net worth');
	});

	it('flags an asset excluded from net worth', () => {
		const body = text({
			assets: [
				createAsset({
					name: 'Holiday car',
					current_value: 20_000,
					include_in_net_worth: false
				})
			]
		});
		expect(body).toContain('excluded from net worth');
	});

	it('shows the portfolio totals, and the excluded-asset note when relevant', () => {
		const body = text({
			assets: [
				createAsset({ name: 'A', purchase_price: 5_000, current_value: 8_000 }),
				createAsset({
					name: 'B',
					purchase_price: 10_000,
					current_value: 4_000,
					include_in_net_worth: false
				})
			]
		});
		expect(body).toContain('£12,000 current value');
		expect(body).toContain('£15,000 paid');
		expect(body).toContain('£8,000 of that counts towards net worth');
		expect(body).toContain('1 asset excluded');
	});

	it('shows CAGR when purchase date and price allow it to be computed', () => {
		const now = new Date('2026-08-07T12:00:00.000Z');
		const body = text({
			now,
			assets: [
				createAsset({
					name: 'Classic car',
					purchase_price: 5_000,
					current_value: 10_000,
					purchase_date: '2016-08-07'
				})
			]
		});
		expect(body).toContain('annualised (CAGR)');
	});

	it('does not show a CAGR line when it cannot be computed', () => {
		const body = text({
			assets: [
				createAsset({
					name: 'No date',
					purchase_price: 5_000,
					current_value: 8_000,
					purchase_date: null
				})
			]
		});
		expect(body).not.toContain('annualised (CAGR)');
	});

	it('lists the category, purchase date and holding cost fields in the form', () => {
		const body = text();
		expect(body).toContain('Purchase price (£)');
		expect(body).toContain('Current value (£)');
		expect(body).toContain('Purchase date');
		expect(body).toContain('Expected annual change (%)');
		expect(body).toContain('Annual holding cost (£)');
	});

	it('renders the include-in-net-worth checkbox checked by default, unchecked once excluded', () => {
		const included = render(AssetsTracker, {
			props: { assets: [createAsset({ name: 'A', current_value: 1_000 })] }
		}).body;
		expect(included).toMatch(/<input type="checkbox"[^>]*checked[^>]*\/>/);

		const excluded = render(AssetsTracker, {
			props: {
				assets: [createAsset({ name: 'A', current_value: 1_000, include_in_net_worth: false })]
			}
		}).body;
		expect(excluded).not.toMatch(/<input type="checkbox"[^>]*checked[^>]*\/>/);
	});

	/* ---------------------------------------------------------------------- */
	/* Future value projection chart                                          */
	/* ---------------------------------------------------------------------- */

	it('shows an asset picker and the projection chart once an asset exists', () => {
		const body = text({
			assets: [createAsset({ name: 'Watch', current_value: 8_000, expected_growth: 4 })]
		});
		expect(body).toContain('Future value projection for');
		expect(body).toContain('Watch — value projection');
	});

	it('shows no projection chart when there are no assets', () => {
		const body = text();
		expect(body).not.toContain('Future value projection for');
	});

	it('offers every recorded asset in the projection chart picker', () => {
		const { body } = render(AssetsTracker, {
			props: {
				assets: [
					createAsset({ name: 'Asset A', current_value: 1_000 }),
					createAsset({ name: 'Asset B', current_value: 2_000 })
				]
			}
		});
		expect(body).toMatch(/<option value="[^"]+">Asset A<\/option>/);
		expect(body).toMatch(/<option value="[^"]+">Asset B<\/option>/);
	});
});
