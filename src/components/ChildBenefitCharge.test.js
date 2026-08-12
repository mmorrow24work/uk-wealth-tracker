/**
 * Server-rendered smoke tests for the Child Benefit / HICBC panel (issue #24).
 *
 * Same approach and same limits as `TaxCalculator.test.js`: `svelte/server`'s `render` gives the
 * panel's *initial* markup, which is enough to assert the sentences a user actually reads at a
 * given income. It cannot assert what happens after an input event — the arithmetic behind every
 * update is covered directly in `$lib/hicbc.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import ChildBenefitCharge from './ChildBenefitCharge.svelte';

/**
 * The rendered markup as plain text, so an assertion reads the sentence a user reads rather than
 * the tags around it.
 *
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(ChildBenefitCharge, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ');
}

describe('ChildBenefitCharge', () => {
	it('names the tax year and the two thresholds its figures come from', () => {
		const body = text({ income: 50_000 });

		expect(body).toContain('2026/27');
		expect(body).toContain('£60,000');
		expect(body).toContain('£80,000');
	});

	it('shows the full benefit and no charge below the threshold', () => {
		const body = text({ income: 50_000, children: 1 });

		// One child, 2026/27: £27.05 a week, £1,406.60 a year, £108.20 every four weeks.
		expect(body).toContain('£1,407');
		expect(body).toContain('£108.20');
		expect(body).toContain('No charge — you keep all of it');
		expect(body).toContain('£10,000');
	});

	it('claws back half the benefit at £70,000', () => {
		const body = text({ income: 70_000, children: 1 });

		expect(body).toContain('50% of your Child Benefit is being charged back');
		// Half of £1,406.60.
		expect(body).toContain('£703');
		expect(body).toContain('£10,000');
	});

	it('reports the real marginal rate a two-child family faces, not the band rate', () => {
		const body = text({ income: 70_000, children: 2 });

		// 40% income tax + £2,337.40 / £200 = 11.69 points of clawback.
		expect(body).toContain('51.69%');
		expect(body).toContain('40%');
	});

	it('adds the clawback to the Scottish band rate instead', () => {
		const body = text({ income: 70_000, children: 2, region: 'scotland' });

		// Scotland's higher rate is 42% at this income.
		expect(body).toContain('53.69%');
		expect(body).not.toContain('51.69%');
	});

	it('says the clawback is complete at £80,000, and why claiming still pays', () => {
		const body = text({ income: 85_000, children: 2 });

		expect(body).toContain('cancels the benefit out entirely');
		expect(body).toContain('National Insurance credits');
		expect(body).not.toContain('is being charged back');
	});

	it('puts the charge on the higher earner when that is the partner', () => {
		const body = text({ income: 40_000, partnerIncome: 75_000, children: 1 });

		expect(body).toContain('Your partner');
		expect(body).toContain('follows the higher income');
		expect(body).toContain('75% of your Child Benefit is being charged back');
	});

	it('quotes what a reduction in income would clear', () => {
		const body = text({ income: 66_500, children: 2 });

		expect(body).toContain('pension contribution, salary sacrifice or Gift Aid');
		// £66,500 − £60,000.
		expect(body).toContain('£6,500');
	});

	it('charges nothing when no children are claimed for', () => {
		const body = text({ income: 120_000, children: 0 });

		expect(body).toContain('No Child Benefit, so no charge');
		expect(body).not.toContain('is being charged back');
	});

	it('shows what taking stopped payments would be worth', () => {
		const body = text({ income: 70_000, children: 2, claiming: false });

		expect(body).toContain('payments are stopped, so there');
		// Half of £2,337.40 kept, half charged.
		expect(body).toContain('£1,169');
		expect(body).toContain('claiming is never a loss');
	});

	it('says a stopped claim at £80,000 would be neutral rather than worth taking', () => {
		const body = text({ income: 85_000, children: 1, claiming: false });

		expect(body).toContain('would be neutral at this income');
		expect(body).not.toContain('claiming is never a loss');
	});

	it('says what the charge is assessed on, and does not present itself as advice', () => {
		const body = text({ income: 70_000 });

		expect(body).toContain('adjusted net income');
		expect(body).toContain('not financial advice');
		expect(body).toContain('post-April-2024 rules');
	});
});
