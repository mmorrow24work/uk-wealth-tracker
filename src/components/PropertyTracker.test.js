/**
 * Server-rendered smoke tests for the property tracker (issue #36).
 *
 * As `DividendTracker.test.js`/`PensionTracker.test.js` document: no browser test environment, so
 * `svelte/server`'s `render` covers the initial render only — the empty state, the field select
 * options, and the per-property summary line. The add/edit/remove logic itself is straightforward
 * state-juggling (mirroring `DividendTracker`/`PensionTracker`, neither of which tests that part
 * either) left to `npm run build && npm run preview` manual verification instead.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import {
	MORTGAGE_TYPES,
	MORTGAGE_TYPE_LABELS,
	PROPERTY_TYPES,
	PROPERTY_TYPE_LABELS
} from '$lib/enums.js';
import { createProperty } from '$lib/model.js';
import PropertyTracker from './PropertyTracker.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(PropertyTracker, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('PropertyTracker', () => {
	it('shows an empty state with no properties recorded', () => {
		const body = text();
		expect(body).toContain('No properties recorded yet');
	});

	it('lists every property type and mortgage type option in the form selects', () => {
		const body = text();
		for (const type of PROPERTY_TYPES) {
			expect(body).toContain(PROPERTY_TYPE_LABELS[type]);
		}
		for (const mortgageType of MORTGAGE_TYPES) {
			expect(body).toContain(MORTGAGE_TYPE_LABELS[mortgageType]);
		}
	});

	it("shows a property's type, mortgage details and value on its own row", () => {
		const body = text({
			properties: [
				createProperty({
					name: '12 Oak Avenue',
					type: 'buy_to_let',
					value: 300_000,
					mortgage_balance: 180_000,
					monthly_payment: 900,
					interest_rate: 4.5,
					mortgage_type: 'tracker',
					deal_expiry: '2027-06-30'
				})
			]
		});

		expect(body).toContain('12 Oak Avenue');
		expect(body).toContain('Buy to let');
		expect(body).toContain('Tracker');
		expect(body).toContain('£300,000');
		expect(body).toContain('£180,000');
		expect(body).toContain('4.5%');
		expect(body).toContain('£900/mo');
		expect(body).toContain('deal expires 2027-06-30');
	});

	it('does not show the "/mo" or "deal expires" notes when those fields are unset', () => {
		const body = text({
			properties: [
				createProperty({ name: 'Paid-off house', value: 250_000, mortgage_type: 'none' })
			]
		});
		expect(body).not.toContain('/mo');
		expect(body).not.toContain('deal expires');
	});

	it('sums value and outstanding mortgage across properties', () => {
		const body = text({
			properties: [
				createProperty({ name: 'A', value: 200_000, mortgage_balance: 100_000 }),
				createProperty({ name: 'B', value: 400_000, mortgage_balance: 150_000 })
			]
		});

		expect(body).toContain('2 properties recorded');
		expect(body).toContain('£600,000');
		expect(body).toContain('£250,000');
	});

	it('uses singular "property" for exactly one recorded property', () => {
		const body = text({ properties: [createProperty({ name: 'Solo', value: 100_000 })] });
		expect(body).toContain('1 property recorded');
	});

	it('labels the submit button "Add property" until a property is being edited', () => {
		const body = text();
		expect(body).toContain('Add property');
		expect(body).not.toContain('Save changes');
	});
});
