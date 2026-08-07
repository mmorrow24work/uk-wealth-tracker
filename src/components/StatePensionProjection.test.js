/**
 * Server-rendered smoke tests for the State Pension projection panel (issue #31).
 *
 * As `FireCalculator.test.js`/`PensionTracker.test.js` document: no browser test environment, so
 * `svelte/server`'s `render` covers the initial render only — what a user sees for a given
 * `pensions` list and birth date, before dragging a slider. That is the right level here anyway,
 * because the panel holds no state of its own for the year counts: they live on the `state` record
 * inside `pensions`, so "what the panel shows" is entirely a function of its props. The arithmetic
 * behind every figure is pinned separately in `$lib/state-pension.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createPension } from '$lib/model.js';
import { setStatePensionYears } from '$lib/state-pension.js';
import StatePensionProjection from './StatePensionProjection.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(StatePensionProjection, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/\s+/g, ' ');
}

/**
 * @param {number} qualifying
 * @param {number} future
 * @returns {import('$lib/types.js').Pension[]}
 */
function withYears(qualifying, future = 0) {
	return setStatePensionYears([], {
		ni_qualifying_years: qualifying,
		ni_future_years: future
	});
}

describe('StatePensionProjection', () => {
	it('states README.md’s headline rule: 35 years for £241.30 a week', () => {
		const body = text();

		expect(body).toContain('35 qualifying National Insurance years');
		expect(body).toContain('£241.30');
	});

	it('warns that nothing at all is payable with no NI years recorded', () => {
		const body = text();

		expect(body).toContain('no State Pension is payable at all');
		expect(body).toContain('at least 10 qualifying years');
	});

	it('prices clearing the 10-year floor, not the worthless next single year', () => {
		const body = text({ pensions: withYears(7) });

		expect(body).toContain('7 years projected — no State Pension is payable at all');
		expect(body).toContain('3 years short');
		expect(body).toContain('Getting to 10 years is worth £68.94 a week (£3,585 a year)');
		expect(body).toContain('still short of the 10-year floor');
		expect(body).toContain('none of your 7 years count yet');
	});

	it('projects the full rate on 35 qualifying years', () => {
		const body = text({ pensions: withYears(35) });

		expect(body).toContain('£241.30 a week');
		expect(body).toContain('£12,548 a year');
		expect(body).toContain('100%');
		expect(body).toContain('Full rate reached');
		expect(body).not.toContain('no State Pension is payable at all');
	});

	it('pro-rates a partial record and says how far short of the full rate it is', () => {
		const body = text({ pensions: withYears(20) });

		// 241.30 × 20/35 = £137.89 a week, 15 years short of the full rate.
		expect(body).toContain('£137.89 a week');
		expect(body).toContain('15 years short');
	});

	it('adds expected future years to the years already earned', () => {
		const body = text({ pensions: withYears(20, 15) });

		expect(body).toContain('on 35 years qualifying');
		expect(body).toContain('£241.30 a week');
	});

	it('shows what today’s years alone would pay once future years are claimed', () => {
		const body = text({ pensions: withYears(20, 15) });

		expect(body).toContain('If you stopped paying today');
		expect(body).toContain('on the 20 years already earned');
		expect(body).toContain('£137.89 a week');
	});

	it('hides the "if you stopped paying today" tile when no future years are claimed', () => {
		const body = text({ pensions: withYears(20) });

		expect(body).not.toContain('If you stopped paying today');
	});

	it('prices one more qualifying year, and says when there is nothing left to gain', () => {
		const partial = text({ pensions: withYears(20) });
		expect(partial).toContain('One more qualifying year');
		expect(partial).toContain('£6.89 a week');

		const full = text({ pensions: withYears(35) });
		expect(full).toContain('nothing left to gain');
		expect(full).toContain('£0.00 a week');
	});

	it('flags years recorded past the 35th as adding nothing', () => {
		const body = text({ pensions: withYears(40) });

		expect(body).toContain('Full rate reached');
		expect(body).toContain('5 years past the 35th add nothing');
	});

	it('renders the ladder with the floor, the projection and the full rate labelled', () => {
		const body = text({ pensions: withYears(20, 4) });

		expect(body).toContain('already earned');
		expect(body).toContain('your projection');
		expect(body).toContain('minimum to be paid anything');
		expect(body).toContain('full rate');
	});

	it('derives State Pension age and its calendar year from a birth date', () => {
		const body = text({ pensions: withYears(30), dobYear: 1985, dobMonth: 6 });

		// The countdown clause is date-dependent, so only its shape is pinned here — the year
		// arithmetic itself is covered against a fixed "today" in `$lib/state-pension.test.js`.
		// `text()` strips tags, which leaves a space where the `</span>` before the comma was — the
		// rendered sentence is "Paid from age 68, in 2053 — 27 years away."
		expect(body).toContain('Paid from age 68 , in 2053 — ');
		expect(body).toContain('years away.');
	});

	it('asks for a birth year when there is none, without blocking the projection', () => {
		const body = text({ pensions: withYears(30) });

		expect(body).toContain('Add a birth year');
		expect(body).toContain('£206.83 a week');
	});

	it('explains that the State Pension is taxable but paid gross, against the allowance', () => {
		const body = text({ pensions: withYears(35) });

		expect(body).toContain('taxable, but it is paid gross');
		// £12,570 allowance less £12,547.60 of full State Pension.
		expect(body).toContain('£22');
		expect(body).toContain('£12,570');
	});

	it('points the user at their own gov.uk forecast rather than presenting this as entitlement', () => {
		const body = text({ pensions: withYears(35) });

		expect(body).toContain('gov.uk/check-state-pension');
		expect(body).toContain('Illustrative only, not financial advice');
		expect(body).toContain('before April 2016');
	});

	it('offers a clear action only once a State Pension record exists', () => {
		expect(text({ pensions: withYears(12) })).toContain('Clear NI years');
		expect(text()).not.toContain('Clear NI years');
		expect(text({ pensions: [createPension({ name: 'SIPP', type: 'sipp' })] })).not.toContain(
			'Clear NI years'
		);
	});

	it('ignores pot pensions sitting alongside the State Pension record', () => {
		const pensions = setStatePensionYears([createPension({ name: 'SIPP', type: 'sipp' })], {
			ni_qualifying_years: 35
		});
		const body = text({ pensions });

		expect(body).toContain('£241.30 a week');
		expect(body).not.toContain('SIPP');
	});
});
