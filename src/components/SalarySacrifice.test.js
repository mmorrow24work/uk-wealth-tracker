/**
 * Server-rendered smoke tests for the salary sacrifice panel (issue #27).
 *
 * Same approach and same limits as `StudentLoanRepayment.test.js`: `svelte/server`'s `render` gives
 * the panel's *initial* markup, which is enough to assert the sentences a user actually reads at a
 * given salary and sacrifice. It cannot assert what happens after an input event — so the one
 * interactive thing here, the "sacrifice enough to clear the taper" button writing back to the
 * bindable amount, is covered only as far as the button's presence and its label; the arithmetic
 * behind every figure is covered directly in `$lib/salary-sacrifice.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import SalarySacrifice from './SalarySacrifice.svelte';

/**
 * The rendered markup as plain text, so an assertion reads the sentence a user reads rather than
 * the tags around it.
 *
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(SalarySacrifice, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ');
}

describe('SalarySacrifice', () => {
	it('names the tax year', () => {
		expect(text({ salary: 60_000 })).toContain('2026/27');
	});

	it('says nothing is sacrificed, and what a pound would be worth, when the amount is zero', () => {
		const body = text({ salary: 60_000 });

		expect(body).toContain('Nothing sacrificed');
		expect(body).toContain('40%');
		expect(body).not.toContain('Where the sacrifice came from');
	});

	it('reports the cost, the saving and the effective relief on a basic-rate salary', () => {
		const body = text({ salary: 40_000, sacrifice: 4_000 });

		// £800 saved, £3,200 out of take-home, 80p per £1 in the pot.
		expect(body).toContain('£800');
		expect(body).toContain('£3,200');
		expect(body).toContain('£0.80 per £1 in the pot');
		expect(body).toContain('20%');
	});

	it('reports 60% relief and 40p per pound inside the taper', () => {
		const body = text({ salary: 120_000, sacrifice: 10_000 });

		expect(body).toContain('£6,000');
		expect(body).toContain('£4,000');
		expect(body).toContain('£0.40 per £1 in the pot');
		expect(body).toContain('60%');
	});

	it('reports 67.5% rather than 60% for a Scottish taxpayer in the same band', () => {
		const body = text({ salary: 120_000, sacrifice: 10_000, region: 'scotland' });

		expect(body).toContain('The 67.5% band');
		expect(body).toContain('£6,750');
		expect(body).not.toContain('The 60% band');
	});

	it('breaks a sacrifice that spans several rates into one row each, top down', () => {
		const body = text({ salary: 130_000, sacrifice: 40_000 });

		expect(body).toContain('Where the sacrifice came from');
		expect(body).toContain('£125,140 – £130,000');
		expect(body).toContain('£100,000 – £125,140');
		expect(body).toContain('£90,000 – £100,000');
		// The whole sacrifice, and the blended relief across those three rates.
		expect(body).toContain('£21,271');
		expect(body).toContain('53.18%');
	});

	it('offers the amount that would clear the taper, as an action', () => {
		const body = text({ salary: 125_140 });

		expect(body).toContain('The 60% band');
		expect(body).toContain('Sacrificing £25,140 would clear it entirely');
		expect(body).toContain('Sacrifice £25,140 to clear the taper');
	});

	it('says how much more would clear the taper when a partial sacrifice has been made', () => {
		const body = text({ salary: 120_000, sacrifice: 10_000 });

		expect(body).toContain('£10,000 more would clear it entirely');
		expect(body).toContain('bought back £5,000 of allowance');
	});

	it('confirms the full allowance is back once the taper is cleared', () => {
		const body = text({ salary: 125_140, sacrifice: 25_140 });

		expect(body).toContain('This sacrifice clears the taper');
		expect(body).toContain('£12,570 allowance is back');
		expect(body).not.toContain('would clear it entirely');
	});

	it('says nothing about the taper for a salary that never reaches it', () => {
		const body = text({ salary: 60_000, sacrifice: 6_000 });

		expect(body).not.toContain('The 60% band');
		expect(body).not.toContain('clear the taper');
	});

	it('flags a sacrifice past the pension annual allowance, and shows headroom below it', () => {
		expect(text({ salary: 200_000, sacrifice: 70_000 })).toContain(
			'more than the £60,000 pension annual allowance'
		);
		expect(text({ salary: 200_000, sacrifice: 20_000 })).toContain(
			'£40,000 of the £60,000 pension annual allowance left'
		);
	});

	it('is honest about what it leaves out', () => {
		const body = text({ salary: 120_000, sacrifice: 10_000 });

		expect(body).toContain('not financial advice');
		expect(body).toContain('National Insurance');
		expect(body).toContain('National Minimum Wage');
		expect(body).toContain('defers tax rather than cancelling it');
	});
});
