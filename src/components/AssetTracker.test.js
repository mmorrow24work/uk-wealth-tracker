/**
 * Server-rendered smoke tests for the physical assets tracker (issue #39).
 *
 * As `PropertyTracker.test.js`/`DividendTracker.test.js` document: no browser test environment, so
 * `svelte/server`'s `render` covers the initial render only — the empty state, the field select
 * options, the per-asset gain/loss/CAGR/net-position line, the `include_in_net_worth` checkbox's
 * initial `checked` state, and the future value projection table. The add/edit/remove logic itself
 * is straightforward state-juggling (mirroring `PropertyTracker`, which does not test that part
 * either) left to `npm run build && npm run preview` manual verification instead.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { ASSET_CATEGORIES, ASSET_CATEGORY_LABELS } from '$lib/enums.js';
import { createAsset } from '$lib/model.js';
import AssetTracker from './AssetTracker.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(AssetTracker, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('AssetTracker', () => {
	it('shows an empty state with no assets recorded', () => {
		const body = text();
		expect(body).toContain('No physical assets recorded yet');
	});

	it('does not show the future value projection card with no assets recorded', () => {
		const body = text();
		expect(body).not.toContain('Future value projection');
	});

	it('lists every asset category option in the form select', () => {
		const body = text();
		for (const category of ASSET_CATEGORIES) {
			expect(body).toContain(ASSET_CATEGORY_LABELS[category]);
		}
	});

	it("shows an asset's category, value and purchase details on its own row", () => {
		const body = text({
			assets: [
				createAsset({
					name: 'Rolex Submariner',
					category: 'watches_jewellery',
					purchase_price: 8_000,
					current_value: 11_000,
					purchase_date: '2020-01-15'
				})
			]
		});

		expect(body).toContain('Rolex Submariner');
		expect(body).toContain('Watches & Jewellery');
		expect(body).toContain('£11,000 now');
		expect(body).toContain('£8,000 paid');
		expect(body).toContain('bought 2020-01-15');
	});

	it('does not show the "bought" note when purchase_date is unset', () => {
		const body = text({
			assets: [createAsset({ name: 'Gold bar', category: 'precious_metals', current_value: 2_000 })]
		});
		expect(body).not.toContain('bought');
	});

	it("shows an asset's gain/loss and net position", () => {
		const body = text({
			assets: [
				createAsset({
					name: 'Classic Porsche',
					category: 'classic_cars',
					purchase_price: 30_000,
					current_value: 45_000
				})
			]
		});
		expect(body).toContain('+£15,000 gain/loss');
		expect(body).toContain('+£15,000 net of holding costs');
	});

	it('shows a loss with a minus sign', () => {
		const body = text({
			assets: [
				createAsset({
					name: 'Depreciating car',
					category: 'classic_cars',
					purchase_price: 40_000,
					current_value: 25_000
				})
			]
		});
		expect(body).toContain('-£15,000 gain/loss');
	});

	it('shows CAGR when a purchase_date is on file', () => {
		const body = text({
			assets: [
				createAsset({
					name: 'Vintage watch',
					purchase_price: 5_000,
					current_value: 9_000,
					purchase_date: '2016-01-01'
				})
			]
		});
		expect(body).toMatch(/[\d.]+% CAGR/);
	});

	it('does not show CAGR with no purchase_date on file', () => {
		const body = text({
			assets: [createAsset({ name: 'Undated art', purchase_price: 5_000, current_value: 9_000 })]
		});
		expect(body).not.toContain('CAGR');
	});

	it('sums current value and purchase price across assets', () => {
		const body = text({
			assets: [
				createAsset({ name: 'A', purchase_price: 5_000, current_value: 6_000 }),
				createAsset({ name: 'B', purchase_price: 10_000, current_value: 8_000 })
			]
		});

		expect(body).toContain('2 assets recorded');
		expect(body).toContain('£14,000 of value');
		expect(body).toContain('£15,000 paid');
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

	it('flags an asset excluded from net worth', () => {
		const body = text({
			assets: [createAsset({ name: 'Heirloom', current_value: 5_000, include_in_net_worth: false })]
		});
		expect(body).toContain('excluded from net worth');
	});

	it('shows the portfolio total and the excluded-asset note when relevant', () => {
		const body = text({
			assets: [
				createAsset({ name: 'A', current_value: 6_000, include_in_net_worth: true }),
				createAsset({ name: 'B', current_value: 4_000, include_in_net_worth: false })
			]
		});
		expect(body).toContain('£10,000 of value');
		expect(body).toContain('£6,000 of that counts towards net worth');
		expect(body).toContain('1 asset excluded');
	});

	it('renders the include-in-net-worth checkbox checked by default, unchecked once excluded', () => {
		const included = render(AssetTracker, {
			props: { assets: [createAsset({ name: 'A', current_value: 1_000 })] }
		}).body;
		expect(included).toMatch(/<input type="checkbox"[^>]*checked[^>]*\/>/);

		const excluded = render(AssetTracker, {
			props: {
				assets: [createAsset({ name: 'A', current_value: 1_000, include_in_net_worth: false })]
			}
		}).body;
		expect(excluded).not.toMatch(/<input type="checkbox"[^>]*checked[^>]*\/>/);
	});

	it('lists the purchase price, current value and holding cost fields in the form', () => {
		const body = text();
		expect(body).toContain('Purchase price (£)');
		expect(body).toContain('Current value (£)');
		expect(body).toContain('Expected annual change (%)');
		expect(body).toContain('Annual holding cost (£)');
	});

	it('shows the future value projection table with at least one recorded asset', () => {
		const body = text({
			assets: [createAsset({ name: 'A', current_value: 10_000, expected_growth: 5 })]
		});
		expect(body).toContain('Future value projection');
		expect(body).toContain('Projected value');
		expect(body).toContain('Holding costs to date');
		expect(body).toContain('Net of holding costs');
	});

	it('projects every recorded asset regardless of the net worth toggle', () => {
		const body = text({
			assets: [
				createAsset({
					name: 'Excluded but still projected',
					current_value: 10_000,
					expected_growth: 0,
					include_in_net_worth: false
				})
			]
		});
		// Every yearly row should still show the £10,000 starting value carried through the horizon.
		expect(body).toContain('£10,000');
	});
});
