/**
 * Server-rendered smoke tests for the household cash flow card (issue #145). As `BudgetTracker.test.js`
 * documents: no browser test environment, so `svelte/server`'s `render` covers the initial render
 * only — every branch here is a read-only presentation of `$lib/budget.js`'s `householdCashFlow`
 * output, which is itself covered end to end in `$lib/budget.test.js`, so these tests only pin that
 * the right figures land in the right place.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createPartner, createProfile } from '$lib/model.js';
import HouseholdCashFlow from './HouseholdCashFlow.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(HouseholdCashFlow, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('HouseholdCashFlow', () => {
	it('notes when no partner is recorded rather than showing a zeroed partner row', () => {
		const body = text({ profile: createProfile({ gross_salary: 30_000 }), partner: null });
		expect(body).toContain('No partner recorded');
	});

	it("shows the partner's name once one is recorded", () => {
		const body = text({
			profile: createProfile({ gross_salary: 30_000 }),
			partner: createPartner({ name: 'Alex', gross_salary: 25_000 })
		});
		expect(body).toContain('Alex');
		expect(body).not.toContain('No partner recorded');
	});

	it('falls back to the literal word "Partner" for an unnamed partner', () => {
		const body = text({
			profile: createProfile({ gross_salary: 30_000 }),
			partner: createPartner({ name: '', gross_salary: 25_000 })
		});
		expect(body).toContain('Partner:');
	});

	it('shows a projected shortfall when outgoings exceed income', () => {
		const body = text({
			profile: createProfile({ gross_salary: 0 }),
			partner: null,
			budget: {
				categories: [],
				bills: [],
				line_items: [{ id: 'l1', name: 'Repair', amount: 500, category_id: null, notes: '' }]
			}
		});
		expect(body).toContain('projected shortfall');
	});

	it('shows what is left after outgoings when income covers them', () => {
		const body = text({ profile: createProfile({ gross_salary: 60_000 }), partner: null });
		expect(body).toContain('left after outgoings');
	});
});
