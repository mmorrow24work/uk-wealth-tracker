/**
 * Server-rendered smoke tests for the ISA allowance tracker panel (issue #28).
 *
 * Same approach and same limits as `StudentLoanRepayment.test.js`: `svelte/server`'s `render` gives
 * the panel's *initial* markup, which is enough to assert the sentences and seeded figures a user
 * actually sees for a given set of holdings. It cannot assert what happens after an input event —
 * the arithmetic behind every update is covered directly in `$lib/isa.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createInvestment } from '$lib/model.js';
import IsaAllowanceTracker from './IsaAllowanceTracker.svelte';

/**
 * The rendered markup as plain text, so an assertion reads the sentence a user reads rather than
 * the tags around it.
 *
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(IsaAllowanceTracker, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ');
}

describe('IsaAllowanceTracker', () => {
	it('names the tax year', () => {
		const body = text();

		expect(body).toContain('2026/27');
	});

	it('lists all six ISA wrappers by their full names', () => {
		const body = text();

		expect(body).toContain('Stocks & Shares ISA');
		expect(body).toContain('Cash ISA');
		expect(body).toContain('Lifetime ISA');
		expect(body).toContain('Junior ISA');
		expect(body).toContain('Innovative Finance ISA');
		expect(body).toContain('Help to Buy ISA');
	});

	it('shows the full adult, Junior and Lifetime ISA limits with nothing contributed', () => {
		const body = text();

		expect(body).toContain('£20,000');
		expect(body).toContain('£9,000');
		expect(body).toContain('£4,000');
		expect(body).toContain('£0');
	});

	it('flags Help to Buy as closed to new accounts', () => {
		const body = text();

		expect(body).toContain('closed to new accounts');
	});

	it('seeds a wrapper from a recorded holding’s monthly contribution, annualised', () => {
		const investment = createInvestment({
			wrapper: 'isa_stocks_shares',
			monthly_contribution: 500,
			contribution_frequency: 'monthly'
		});

		const body = text({ investments: [investment] });

		// £500/month annualised is £6,000, which the adult total and remaining allowance both reflect.
		expect(body).toContain('£6,000 of £20,000');
		expect(body).toContain('£14,000 remaining');
	});

	it('ignores a non-ISA holding when seeding', () => {
		const investment = createInvestment({
			wrapper: 'sipp',
			monthly_contribution: 1_000,
			contribution_frequency: 'monthly'
		});

		const body = text({ investments: [investment] });

		expect(body).toContain('£0 of £20,000');
		expect(body).toContain('£20,000 remaining');
	});

	it('says it is not financial advice and notes nothing here is saved', () => {
		const body = text();

		expect(body).toContain('not financial advice');
		expect(body).toContain('Nothing on this card is saved');
	});

	it('mentions the Lifetime ISA bonus and withdrawal penalty', () => {
		const body = text();

		expect(body).toContain('25% government bonus');
		expect(body).toContain('25% withdrawal penalty');
	});
});
