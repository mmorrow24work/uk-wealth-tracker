/**
 * Server-rendered smoke tests for the building/income phase planner (issue #34).
 *
 * As `FireCalculator.test.js` documents: no browser test environment, so `svelte/server`'s
 * `render` covers the initial render only, against whatever `dividends`/`profile` props are passed
 * — the slider and age fields cannot be dragged here, but the numbers they seed at first render can
 * be pinned. The projection arithmetic itself is covered directly in `$lib/dividends.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createDividend, createProfile } from '$lib/model.js';
import DividendIncomePlanner from './DividendIncomePlanner.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(DividendIncomePlanner, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('DividendIncomePlanner', () => {
	it('shows an empty state with no dividend holdings recorded', () => {
		const body = text();
		expect(body).toContain('No dividend holdings recorded yet');
	});

	it('shows today’s portfolio value and blended yield', () => {
		const body = text({
			dividends: [
				createDividend({ name: 'A', value: 10_000, yield_pct: 4 }),
				createDividend({ name: 'B', value: 30_000, yield_pct: 2 })
			]
		});

		expect(body).toContain('£40,000');
		expect(body).toContain('2 holdings');
		// (10,000×4 + 30,000×2) / 40,000 = 2.5%
		expect(body).toContain('2.5% blended yield');
	});

	it('shows the pot and income at the default switch age with a profile’s retirement age seeding it', () => {
		const body = text({
			dividends: [
				createDividend({
					name: 'A',
					value: 100_000,
					yield_pct: 4,
					strategy: 'drip',
					monthly_contribution: 0
				})
			],
			profile: createProfile({ retirement_age: 65, dob_year: 1990, dob_month: 1 })
		});

		expect(body).toContain('Pot at 65');
		expect(body).toContain('Income from 65');
		expect(body).toContain('Building phase');
		expect(body).toContain('Income phase');
	});

	it('says "switching now" when the switch age has already been reached', () => {
		const body = text({
			dividends: [createDividend({ name: 'A', value: 50_000, yield_pct: 5 })],
			profile: createProfile({ retirement_age: 30, dob_year: 1980, dob_month: 1 })
		});

		expect(body).toContain('switching now');
	});

	it('notes that dividend allowance and GIA tax rates are not yet modelled', () => {
		const body = text({
			dividends: [createDividend({ name: 'A', value: 10_000, yield_pct: 4 })]
		});
		expect(body).toContain('gross of tax');
		expect(body).toContain('#35');
	});
});
