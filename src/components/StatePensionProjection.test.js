/**
 * Server-rendered smoke tests for the State Pension card (issue #31).
 *
 * As `PensionTracker.test.js` documents: no browser test environment, so `svelte/server`'s `render`
 * covers the initial render only. That is the whole of this card's output — the tiles, the
 * shortfall/minimum/full-rate sentences, the timing line and the empty state are all functions of
 * the `pensions`/`profile` props. What it cannot reach is what typing into the two boxes does;
 * `asQualifyingYears` and `statePensionProjection` are covered directly in
 * `$lib/state-pension.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createPension, createProfile } from '$lib/model.js';
import { STATE_PENSION_NAME } from '$lib/state-pension.js';
import StatePensionProjection from './StatePensionProjection.svelte';

/** Today, fixed — the timing line counts from it. */
const now = new Date('2026-08-07T00:00:00Z');

/**
 * @param {Partial<import('$lib/types.js').Pension>} [overrides]
 * @returns {import('$lib/types.js').Pension}
 */
function statePension(overrides = {}) {
	return createPension({
		name: STATE_PENSION_NAME,
		type: 'state',
		ni_qualifying_years: 20,
		ni_future_years: 10,
		...overrides
	});
}

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(StatePensionProjection, { props: { now, ...props } });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/\s+/g, ' ');
}

describe('StatePensionProjection', () => {
	it('states the rule it is applying, with the 2026/27 figures', () => {
		const body = text();

		expect(body).toContain('35 qualifying years');
		expect(body).toContain('£241.30');
		expect(body).toContain('under 10 gets nothing at all');
	});

	it('asks for the two counts and nothing else', () => {
		const body = text();

		expect(body).toContain('Qualifying years so far');
		expect(body).toContain('Further years expected');
		expect(body).not.toContain('Employer contribution');
	});

	it('says there is nothing to project before a National Insurance record is entered', () => {
		const body = text({ pensions: [createPension({ type: 'sipp', value: 90_000 })] });

		expect(body).toContain('No National Insurance record entered yet');
	});

	it('projects the income weekly, annually and monthly off the state-type record', () => {
		const body = text({ pensions: [statePension()] });

		// 30 years — £206.83 a week, £10,755 a year.
		expect(body).toContain('£206.83/wk');
		expect(body).toContain('£10,755 a year');
		expect(body).toContain('30 years of National Insurance');
	});

	it('shows the years banked against the 35 the full rate takes', () => {
		const body = text({ pensions: [statePension()] });

		expect(body).toContain('20 earned + 10 expected');
		expect(body).toContain('of 35');
		expect(body).toContain('5 years short');
	});

	it('prices the shortfall at what a further year is actually worth', () => {
		const body = text({ pensions: [statePension({ ni_future_years: 0 })] });

		expect(body).toContain('15 years short of the full rate');
		expect(body).toContain('£358 a year for life');
		expect(body).toContain('£5,374 a year'); // 15 × £358.28
	});

	it('separates what is banked from what the expected years add', () => {
		const body = text({ pensions: [statePension()] });

		expect(body).toContain('20 years already on your record would pay £7,170 a year');
		expect(body).toContain('10 years you still expect add £3,585 a year');
	});

	it('warns that under ten years pays nothing at all', () => {
		const body = text({ pensions: [statePension({ ni_qualifying_years: 8, ni_future_years: 0 })] });

		expect(body).toContain('Under the 10-year minimum');
		expect(body).toContain('8 years pays nothing at all');
		expect(body).toContain('Another 2 years takes it from £0 to £3,585 a year');
	});

	it('says when the full rate is already in sight, and calls surplus years normal', () => {
		const body = text({
			pensions: [statePension({ ni_qualifying_years: 30, ni_future_years: 12 })]
		});

		expect(body).toContain('On course for the full rate');
		expect(body).toContain('7 of the 42 years projected go past the 35 that pay');
		expect(body).toContain('£241.30/wk');
	});

	it('dates State Pension age off the profile', () => {
		const body = text({
			pensions: [statePension()],
			profile: createProfile({ dob_year: 1985, dob_month: 3 })
		});

		expect(body).toContain('State Pension age is 68 for you, in 2053');
		expect(body).toContain('27 years away');
	});

	it('says what it is assuming when no date of birth is recorded', () => {
		const body = text({ pensions: [statePension()] });

		expect(body).toContain('Add your date of birth on the forecast tab');
		expect(body).toContain('it assumes 67');
	});

	it('flags future years there is no time left to earn', () => {
		const body = text({
			pensions: [statePension({ ni_qualifying_years: 30, ni_future_years: 35 })],
			profile: createProfile({ dob_year: 1985, dob_month: 3 })
		});

		expect(body).toContain('More future years than there is time for');
		expect(body).toContain('8 of the 35 years above cannot be earned');
	});

	it('prices the income as a pot, at the withdrawal rate it is handed', () => {
		const body = text({ pensions: [statePension()], withdrawalRate: 3.5 });

		expect(body).toContain('at a 3.5% withdrawal rate');
		expect(body).toContain('£307,290'); // £10,755.16 ÷ 3.5%
	});

	it('is honest about the transitional rules it does not model', () => {
		const body = text({ pensions: [statePension()] });

		expect(body).toContain('before April 2016');
		expect(body).toContain('contracted out');
		expect(body).toContain('Illustrative only, not financial advice');
	});
});
