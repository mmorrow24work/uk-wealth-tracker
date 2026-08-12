/**
 * Server-rendered smoke tests for the investment holdings tracker (issue #69).
 *
 * As `DividendTracker.test.js`/`PensionTracker.test.js` document: no browser test environment, so
 * `svelte/server`'s `render` covers the initial render only. Here that ceiling is tighter still —
 * the month-select value defaults via an `$effect` (picking the latest recorded month), and
 * `svelte/server` does not run effects, so every server render lands on the component's
 * *no-month-selected* branch regardless of props. That leaves the empty state and the always-`
 * $derived` month dropdown as the only things worth asserting here.
 *
 * `addMonth`'s new-month pre-fill logic (issue #259) lives in `$lib/model.js`'s
 * `createNextMonthlyEntry` specifically so it *can* be unit tested without a DOM — see
 * `model.test.js`'s `createNextMonthlyEntry` suite for that coverage. The rest of the
 * add/edit/remove state-juggling is left to `npm run build && npm run preview` manual
 * verification, same as those sibling components.
 *
 * The same ceiling applies to issue #300's "Update prices" button and its write-back logic: the
 * button only ever renders once a month is selected, which — per the `$effect` limitation above —
 * no server render reaches, so it cannot be asserted present here even with a feed configured. What
 * *is* reachable and covered below: `PriceRefreshResults` (issue #295) renders unconditionally
 * whenever a feed is configured (so its "no results yet" empty state is a real server-render
 * assertion), and the whole price-refresh area — button and panel alike — disappears when no feed is
 * configured, matching #266's documented fallback. `$lib/price-feed.js` is mocked (`vi.mock`) rather
 * than exercised for real, per this issue's own test guidance: the module's own behaviour is already
 * covered by #266's and #298's own test suites. The write-back rules themselves (`'updated'` writes
 * value+last_price, `'baseline'` writes last_price only, `'failed'` writes nothing) are covered
 * without a DOM at all, in `model.test.js`'s `applyPriceRefreshResults` suite — the same reasoning
 * `createNextMonthlyEntry` above already established for this component.
 */
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMonthlyEntry } from '$lib/model.js';
import { isPriceFeedAvailable } from '$lib/price-feed.js';
import InvestmentHoldings from './InvestmentHoldings.svelte';

vi.mock('$lib/price-feed.js', () => ({
	isPriceFeedAvailable: vi.fn(() => false),
	refreshInvestmentPrices: vi.fn()
}));

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(InvestmentHoldings, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('InvestmentHoldings', () => {
	it('shows an empty state with no monthly snapshots recorded', () => {
		const body = text();
		expect(body).toContain('No monthly snapshot yet');
	});

	it('lists every recorded month in the select, newest first', () => {
		const jan = createMonthlyEntry({ month: 1, year: 2026 });
		const march = createMonthlyEntry({ month: 3, year: 2026 });
		// March pushed in before January -- the select's order must not depend on array order.
		const body = text({ monthlyEntries: [march, jan] });

		expect(body.indexOf('Mar 2026')).toBeLessThan(body.indexOf('Jan 2026'));
	});

	it('offers an "+ Add month" control', () => {
		const body = text();
		expect(body).toContain('+ Add month');
	});

	it('renders the ISA/CGT guidance card below the form (issue #255)', () => {
		const body = text();
		expect(body).toContain('ISA guidance & investment tax basics');
	});

	describe('issue #300 — "Update prices"', () => {
		afterEach(() => {
			vi.mocked(isPriceFeedAvailable).mockReturnValue(false);
		});

		it('hides the price refresh results panel entirely when no feed is configured', () => {
			vi.mocked(isPriceFeedAvailable).mockReturnValue(false);
			const body = text();
			expect(body).not.toContain('Price refresh results');
			expect(body).not.toContain('Update prices');
		});

		it('renders the price refresh results panel, in its empty state, once a feed is configured', () => {
			vi.mocked(isPriceFeedAvailable).mockReturnValue(true);
			const body = text();
			expect(body).toContain('Price refresh results');
			expect(body).toContain('No results yet');
		});
	});
});
