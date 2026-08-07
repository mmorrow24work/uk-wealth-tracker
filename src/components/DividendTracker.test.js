/**
 * Server-rendered smoke tests for the dividend holdings tracker (issue #34).
 *
 * As `PensionTracker.test.js` documents: no browser test environment, so `svelte/server`'s
 * `render` covers the initial render only — the empty state, the field select options, and the
 * per-holding summary line. The add/edit/remove logic itself is straightforward state-juggling
 * (mirroring `PensionTracker`/`InvestmentHoldings`, neither of which tests that part either) left
 * to `npm run build && npm run preview` manual verification instead.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { DIVIDEND_STRATEGIES, PAYOUT_FREQUENCIES, WRAPPERS, WRAPPER_LABELS } from '$lib/enums.js';
import { createDividend } from '$lib/model.js';
import DividendTracker from './DividendTracker.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(DividendTracker, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('DividendTracker', () => {
	it('shows an empty state with no holdings recorded', () => {
		const body = text();
		expect(body).toContain('No dividend holdings recorded yet');
	});

	it('lists every wrapper, frequency and strategy option in the form selects', () => {
		const body = text();
		for (const wrapper of WRAPPERS) {
			expect(body).toContain(WRAPPER_LABELS[wrapper]);
		}
		expect(body).toContain('Quarterly');
		expect(body).toContain('Reinvest (DRIP)');
		expect(body).toContain('Take as income');
		expect(PAYOUT_FREQUENCIES.length).toBeGreaterThan(0);
		expect(DIVIDEND_STRATEGIES).toEqual(['drip', 'income']);
	});

	it('shows a holding’s value, yield, income and strategy on its own row', () => {
		const body = text({
			dividends: [
				createDividend({
					name: 'Vanguard FTSE All-World High Dividend Yield',
					wrapper: 'isa_stocks_shares',
					value: 20_000,
					yield_pct: 4,
					monthly_contribution: 100,
					strategy: 'drip'
				})
			]
		});

		expect(body).toContain('Vanguard FTSE All-World High Dividend Yield');
		expect(body).toContain('Stocks & Shares ISA');
		expect(body).toContain('£20,000');
		expect(body).toContain('4% yield');
		expect(body).toContain('£800/yr');
		expect(body).toContain('£100/mo added');
		expect(body).toContain('Reinvest (DRIP)');
	});

	it('does not show the "added" note for a holding with no monthly contribution', () => {
		const body = text({
			dividends: [createDividend({ name: 'No top-ups', value: 5_000, monthly_contribution: 0 })]
		});
		expect(body).not.toContain('/mo added');
	});

	it('sums value and annual income across holdings', () => {
		const body = text({
			dividends: [
				createDividend({ name: 'A', value: 10_000, yield_pct: 4 }),
				createDividend({ name: 'B', value: 20_000, yield_pct: 5 })
			]
		});

		expect(body).toContain('2 holdings recorded');
		expect(body).toContain('£30,000');
		expect(body).toContain('£1,400/yr'); // 400 + 1,000
	});

	it('labels the submit button "Add holding" until a holding is being edited', () => {
		const body = text();
		expect(body).toContain('Add holding');
		expect(body).not.toContain('Save changes');
	});
});
