/**
 * Server-rendered smoke tests for the tax panel (issue #23).
 *
 * Same approach and same limits as `FireCalculator.test.js`: `svelte/server`'s `render` gives the
 * panel's *initial* markup, which is enough to assert the sentences a user actually reads and the
 * figures the tab opens on. It cannot assert what happens after an input event — the arithmetic
 * behind every update is covered directly in `$lib/tax.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createProfile } from '$lib/model.js';
import TaxCalculator from './TaxCalculator.svelte';

/**
 * The rendered markup as plain text, so an assertion reads the sentence a user reads rather than
 * the tags around it.
 *
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(TaxCalculator, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ');
}

/** @param {Partial<import('$lib/types.js').Profile>} overrides */
function profile(overrides) {
	return { profile: createProfile(overrides) };
}

describe('TaxCalculator', () => {
	it('names the tax year its figures belong to', () => {
		expect(text()).toContain('2026/27');
	});

	it('seeds the salary and region from the profile', () => {
		const body = text(profile({ gross_salary: 62_000, tax_region: 'scotland' }));

		// £62,000 in Scotland: £49,430 taxable, four bands used, £14,022.05 of tax.
		expect(body).toContain('£14,022.05');
		expect(body).toContain('Starter rate');
		expect(body).toContain('Advanced rate');
		expect(body).not.toContain('Additional rate');
	});

	it('shows the England/Wales/NI ladder by default', () => {
		const body = text(profile({ gross_salary: 50_000 }));

		expect(body).toContain('Basic rate');
		expect(body).toContain('Higher rate');
		expect(body).toContain('Additional rate');
		expect(body).not.toContain('Intermediate rate');
		// £50,000: £37,430 taxable, all basic rate — £7,486 of tax, £42,514 left.
		expect(body).toContain('£7,486');
		expect(body).toContain('£42,514');
	});

	it('opens on a salary rather than zeroes when the profile has none', () => {
		const body = text();
		expect(body).toContain('Personal allowance');
		expect(body).toContain('£7,486');
	});

	it('always shows the personal allowance row alongside the bands', () => {
		const body = text(profile({ gross_salary: 9_000 }));
		expect(body).toContain('Personal allowance');
		// Nothing is due, but the ladder is still there to show where the next pound would land.
		expect(body).toContain('Basic rate');
	});

	it('explains the 60% band when the salary is inside it', () => {
		const body = text(profile({ gross_salary: 110_000 }));

		expect(body).toContain("You're inside the 60% band");
		expect(body).toContain('costs you 50p of personal allowance');
		expect(body).toContain('tapered from £12,570');
	});

	it('reports 67.5% rather than 60% for a Scottish taxpayer in the same band', () => {
		const body = text(profile({ gross_salary: 110_000, tax_region: 'scotland' }));

		expect(body).toContain("You're inside the 67.5% band");
		expect(body).not.toContain("You're inside the 60% band");
	});

	it('says the allowance is gone above £125,140 without claiming it is still tapering', () => {
		const body = text(profile({ gross_salary: 150_000 }));

		expect(body).toContain('Your personal allowance has gone entirely');
		expect(body).not.toContain("You're inside the");
	});

	it('compares the salary against the other region', () => {
		const englandWalesNi = text(profile({ gross_salary: 60_000 }));
		expect(englandWalesNi).toContain('a year in Scotland');
		expect(englandWalesNi).toContain('more');

		const scotland = text(profile({ gross_salary: 20_000, tax_region: 'scotland' }));
		expect(scotland).toContain('a year in England, Wales & Northern Ireland');
		expect(scotland).toContain('more');
	});

	it('does not present the result as net pay', () => {
		const body = text();

		expect(body).toContain('After income tax');
		expect(body).toContain('National Insurance is not deducted');
		expect(body).toContain('is not your net pay');
		expect(body).toContain('not financial advice');
	});

	it('renders the salary sacrifice, Child Benefit, Marriage Allowance and Student Loan cards beneath the band table', () => {
		const body = text();

		expect(body).toContain('Salary sacrifice');
		expect(body).toContain('Nothing sacrificed');
		expect(body).toContain('Child Benefit');
		expect(body).toContain('High Income Child Benefit Charge');
		expect(body).toContain('Marriage Allowance');
		expect(body).toContain('Only available to spouses and civil partners');
		expect(body).toContain('Student Loan repayments');
		expect(body).toContain('No Student Loan selected, so nothing is repaid here');
	});

	it('sacrifices nothing by default, so a profile without a pension percentage is untouched', () => {
		const body = text(profile({ gross_salary: 50_000 }));

		expect(body).not.toContain('sacrificed, so everything below');
		// The same £7,486 the band table shows without this feature existing.
		expect(body).toContain('£7,486');
	});

	it('opens with a sacrifice seeded from the profile pension percentage', () => {
		const body = text(profile({ gross_salary: 120_000, pension_pct: 10 }));

		expect(body).toContain('£12,000 sacrificed');
		expect(body).toContain('worked out on £108,000');
	});

	it('works the bands, the taper and the allowance on the post-sacrifice income', () => {
		const body = text(profile({ gross_salary: 130_000, pension_pct: 30 }));

		// £39,000 sacrificed leaves £91,000 — under £100,000, so the taper no longer applies at all
		// and the whole personal allowance is back.
		expect(body).toContain('full personal allowance');
		expect(body).not.toContain("You're inside the");
		expect(body).not.toContain('Your personal allowance has gone entirely');
		expect(body).toContain('This sacrifice clears the taper');
	});

	it('hands the same post-sacrifice income to the cards below', () => {
		const body = text(profile({ gross_salary: 70_000, pension_pct: 20 }));

		// £56,000 after sacrificing £14,000 — below the £60,000 HICBC threshold, so no charge, and
		// £4,000 short of it rather than £10,000 over.
		expect(body).toContain('No charge — you keep all of it');
		expect(body).toContain('£4,000 short of the £60,000 threshold');
	});
});
