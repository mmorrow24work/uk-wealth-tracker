/**
 * Server-rendered smoke tests for the ISA/Capital Gains Tax guidance card (issue #255).
 *
 * Same approach and same limits as `IsaAllowanceTracker.test.js`: `svelte/server`'s `render` gives
 * the card's markup as first sent to the browser, which is enough to assert every sentence and
 * figure a user can read — including the content inside the collapsed `<details>`, since collapsing
 * is a browser rendering behaviour (the `open` attribute), not something that removes markup from
 * the response. There is no interactive state here to leave untested.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import InvestmentGuidance from './InvestmentGuidance.svelte';

/** @returns {string} */
function text() {
	const { body } = render(InvestmentGuidance, { props: {} });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ');
}

describe('InvestmentGuidance', () => {
	it('is collapsed behind a summary, not shown open by default', () => {
		const { body } = render(InvestmentGuidance, { props: {} });

		expect(body).toContain('<details>');
		expect(body).not.toContain('<details open');
	});

	it('has all four section headings the issue asks for', () => {
		const body = text();

		expect(body).toContain('Key rules for all ISAs');
		expect(body).toContain('Which ISA for your goals?');
		expect(body).toContain('UK ISA options explained');
		expect(body).toContain('Capital Gains Tax for non-ISA investments');
	});

	it('states the shared adult allowance is combined, not per wrapper', () => {
		const body = text();

		expect(body).toContain('£20,000');
		expect(body).toContain('not £20,000 for each one separately');
	});

	it('names all six ISA wrappers by their full labels', () => {
		const body = text();

		expect(body).toContain('Stocks & Shares ISA');
		expect(body).toContain('Cash ISA');
		expect(body).toContain('Lifetime ISA');
		expect(body).toContain('Junior ISA');
		expect(body).toContain('Innovative Finance ISA');
		expect(body).toContain('Help to Buy ISA');
	});

	it('flags Help to Buy as closed to new applicants, with the closure date', () => {
		const body = text();

		expect(body).toContain('Closed to new applicants since 30 November 2019');
	});

	it('gives the Lifetime ISA sub-limit, bonus and withdrawal penalty, and points to the Pensions tab', () => {
		const body = text();

		expect(body).toContain('£4,000/yr sub-limit');
		expect(body).toContain('25% government bonus');
		expect(body).toContain('25% penalty');
		expect(body).toContain('Pensions tab');
		expect(body).toContain('PENSION_TYPES');
	});

	it('flags the Innovative Finance ISA as higher risk with no deposit protection', () => {
		const body = text();

		expect(body).toContain('no deposit-protection scheme');
	});

	it('states ISAs and SIPPs are never subject to Capital Gains Tax', () => {
		const body = text();

		expect(body).toContain('never subject to Capital Gains Tax');
	});

	it('gives the non-ISA Capital Gains Tax annual exempt amount and both rates', () => {
		const body = text();

		expect(body).toContain('£3,000');
		expect(body).toContain('18%');
		expect(body).toContain('24%');
	});

	it('says this is background only, with no calculator for non-property gains', () => {
		const body = text();

		expect(body).toContain('background only');
		expect(body).toContain("doesn't calculate Capital Gains Tax on shares, funds or crypto");
	});

	it('is not financial advice', () => {
		const body = text();

		expect(body).toContain('not financial advice');
	});
});
