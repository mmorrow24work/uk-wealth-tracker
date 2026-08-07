/**
 * Server-rendered smoke tests for the Marriage Allowance panel (issue #25).
 *
 * Same approach and same limits as `TaxCalculator.test.js`/`ChildBenefitCharge.test.js`:
 * `svelte/server`'s `render` gives the panel's *initial* markup, which is enough to assert the
 * sentences a user actually reads for a given pair of incomes. It cannot assert what happens after
 * an input event — the arithmetic behind every update is covered directly in
 * `$lib/marriage-allowance.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import MarriageAllowance from './MarriageAllowance.svelte';

/**
 * The rendered markup as plain text, so an assertion reads the sentence a user reads rather than
 * the tags around it.
 *
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(MarriageAllowance, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ');
}

describe('MarriageAllowance', () => {
	it('says nothing numeric until the couple confirms they are married', () => {
		const body = text({ income: 40_000, partnerIncome: 5_000 });

		expect(body).toContain('Only available to spouses and civil partners');
		// The intro still states the headline transfer/saving figures generically; what must not
		// appear is any per-couple breakdown for an unconfirmed £0-partner-income pairing.
		expect(body).not.toContain('Allowance transferred');
		expect(body).not.toContain('Net benefit');
	});

	it('names the tax year and the transfer figures in the intro', () => {
		const body = text({ income: 40_000, married: true });

		expect(body).toContain('2026/27');
		expect(body).toContain('£12,570');
		expect(body).toContain('£1,260');
		expect(body).toContain('20%');
		expect(body).toContain('£252');
	});

	it('treats the lower earner as the transferor regardless of who "you" are', () => {
		// You earn more, your partner earns less — your partner transfers to you.
		const asRecipient = text({ income: 40_000, partnerIncome: 5_000, married: true });
		expect(asRecipient).toContain('Your partner');
		expect(asRecipient).toContain('Saving, you');
		expect(asRecipient).toContain('£252');

		// Swap the incomes — now you are the lower earner and transfer to your partner.
		const asTransferor = text({ income: 5_000, partnerIncome: 40_000, married: true });
		expect(asTransferor).toContain('Extra tax, you');
		expect(asTransferor).toContain('Saving, your partner');
		expect(asTransferor).toContain('£252');
	});

	it('reports no extra tax for a transferor comfortably under the Personal Allowance', () => {
		const body = text({ income: 40_000, partnerIncome: 5_000, married: true });

		expect(body).toContain('still fully under the allowance');
	});

	it('caps the saving at what the recipient actually owes', () => {
		// £13,000 taxable income is only £86 of tax — less than the £252 headline figure.
		const body = text({ income: 5_000, partnerIncome: 13_000, married: true });

		expect(body).toContain('Saving, your partner');
		expect(body).toContain('capped by the tax owed');
		expect(body).toContain('household keeps £86');
	});

	it('refuses the transfer when neither income qualifies', () => {
		const body = text({ income: 15_000, partnerIncome: 60_000, married: true });

		expect(body).toContain('Neither of you qualifies');
	});

	it('refuses the transfer when the would-be transferor already pays tax', () => {
		const body = text({ income: 15_000, partnerIncome: 40_000, married: true });

		expect(body).toContain("don't have anything spare to transfer");
	});

	it('refuses the transfer when the would-be recipient is already a higher-rate taxpayer', () => {
		const body = text({ income: 5_000, partnerIncome: 60_000, married: true });

		expect(body).toContain('Your partner already pays');
		expect(body).toContain('higher-rate tax');
	});

	it('shows the counterfactual value when eligible but not yet applied', () => {
		const body = text({ income: 5_000, partnerIncome: 40_000, married: true, claiming: false });

		expect(body).toContain("You qualify, but haven't applied");
		expect(body).toContain('Applying would be worth £252 a year');
	});

	it('uses the Scottish higher-rate boundary and starter-band cost instead', () => {
		const body = text({
			income: 12_570,
			partnerIncome: 40_000,
			married: true,
			region: 'scotland'
		});

		expect(body).toContain('£43,662');
		// Fixed £252 saving less the transferor's 19%-starter-band cost of £239.40 = £12.60, rounds to £13.
		expect(body).toContain('£13');
	});

	it('says what it is not, and does not present itself as advice', () => {
		const body = text({ income: 40_000, partnerIncome: 5_000, married: true });

		expect(body).toContain('not financial advice');
		expect(body).toContain('Nothing here is saved between visits');
	});
});
