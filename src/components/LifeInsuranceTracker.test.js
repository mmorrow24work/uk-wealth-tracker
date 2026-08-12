/**
 * Server-rendered smoke tests for the Life Insurance tracker (issue #253).
 *
 * As `PensionTracker.test.js` documents: no browser test environment, so `svelte/server`'s
 * `render` covers the initial render only — what a user sees against a given `policies` list,
 * before touching the add/edit form. The add/edit/remove logic itself is straightforward enough
 * state-juggling (mirroring `PensionTracker`/`InvestmentHoldings`) that it is left to
 * `npm run build && npm run preview` manual verification instead.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createLifeInsurance } from '$lib/model.js';
import LifeInsuranceTracker from './LifeInsuranceTracker.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(LifeInsuranceTracker, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('LifeInsuranceTracker', () => {
	it('shows an empty state with no policies recorded', () => {
		const body = text();
		expect(body).toContain('No life insurance policies recorded yet');
	});

	it('shows a policy name, provider and sum assured', () => {
		const body = text({
			policies: [
				createLifeInsurance({
					name: 'Level-term £500k to age 60',
					provider: 'Zurich',
					sum_assured: 500_000
				})
			]
		});

		expect(body).toContain('Level-term £500k to age 60');
		expect(body).toContain('Zurich');
		expect(body).toContain('£500,000');
	});

	it('marks an in-trust policy in its row summary', () => {
		const body = text({
			policies: [
				createLifeInsurance({ name: 'Whole of life', provider: 'Royal London', in_trust: true })
			]
		});

		expect(body).toContain('£0 sum assured · in trust');
	});

	it('does not mark an out-of-trust policy as in trust in its row summary', () => {
		const body = text({
			policies: [createLifeInsurance({ name: 'Whole of life', in_trust: false })]
		});

		expect(body).not.toContain('£0 sum assured · in trust');
	});

	it('sums sum assured across policies', () => {
		const body = text({
			policies: [
				createLifeInsurance({ name: 'Policy A', sum_assured: 300_000 }),
				createLifeInsurance({ name: 'Policy B', sum_assured: 200_000 })
			]
		});

		expect(body).toContain('2 policies recorded');
		expect(body).toContain('£500,000');
	});

	it('pluralises a single recorded policy correctly', () => {
		const body = text({ policies: [createLifeInsurance({ name: 'Policy A', sum_assured: 1 })] });

		expect(body).toContain('1 policy recorded');
	});

	it('explains what "in trust" means for Inheritance Tax next to the checkbox', () => {
		const body = text();
		expect(body).toContain('In trust');
		expect(body).toContain('Inheritance Tax');
	});

	it('labels the submit button "Add policy" until a policy is being edited', () => {
		const body = text();
		expect(body).toContain('Add policy');
		expect(body).not.toContain('Save changes');
	});
});
