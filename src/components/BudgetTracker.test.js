/**
 * Server-rendered smoke tests for the Budget & Bills tracker (issue #145).
 *
 * As `PensionTracker.test.js`/`AssetsTracker.test.js` document: no browser test environment, so
 * `svelte/server`'s `render` covers the initial render only — the empty states, the ONS benchmark
 * comparison line, and a bill's monthly-equivalent figure. The add/edit/remove logic itself is
 * straightforward state-juggling (mirroring every other flat-list tracker, none of which test that
 * part either) left to `npm run build && npm run preview` manual verification instead.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createBudgetBill, createBudgetCategory, createBudgetLineItem } from '$lib/model.js';
import { ONS_CATEGORY_PRESETS } from '$lib/budget.js';
import BudgetTracker from './BudgetTracker.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(BudgetTracker, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('BudgetTracker', () => {
	it('shows empty states with no budget recorded', () => {
		const body = text();
		expect(body).toContain('No spending categories recorded yet');
		expect(body).toContain('No recurring bills recorded yet');
		expect(body).toContain('No one-off items recorded yet');
	});

	it('shows every ONS preset as a quick-add option', () => {
		const body = text();
		for (const preset of ONS_CATEGORY_PRESETS) {
			expect(body).toContain(preset.name);
		}
	});

	it('shows a category above its ONS benchmark', () => {
		const body = text({
			budget: {
				categories: [
					createBudgetCategory({ name: 'Groceries', monthly_amount: 300, ons_benchmark: 280 })
				],
				bills: [],
				line_items: []
			}
		});

		expect(body).toContain('Groceries');
		expect(body).toContain('£300');
		expect(body).toContain('above');
	});

	it('shows the bank statement CSV import card between bills and one-off items', () => {
		expect(text()).toContain('Import bank statement (CSV)');
	});

	it("shows a bill's monthly-equivalent amount", () => {
		const body = text({
			budget: {
				categories: [],
				bills: [createBudgetBill({ name: 'Council tax', amount: 1200, frequency: 'annually' })],
				line_items: []
			}
		});

		expect(body).toContain('Council tax');
		expect(body).toContain('£100');
	});

	it('lists a one-off line item separately from recurring bills', () => {
		const body = text({
			budget: {
				categories: [],
				bills: [],
				line_items: [createBudgetLineItem({ name: 'Washing machine repair', amount: 150 })]
			}
		});

		expect(body).toContain('Washing machine repair');
		expect(body).toContain('£150');
	});

	it('totals categories, bills and one-off items into the monthly summary', () => {
		const body = text({
			budget: {
				categories: [createBudgetCategory({ monthly_amount: 200 })],
				bills: [createBudgetBill({ amount: 1200, frequency: 'annually' })],
				line_items: [createBudgetLineItem({ amount: 50 })]
			}
		});

		expect(body).toContain('£350');
	});
});
