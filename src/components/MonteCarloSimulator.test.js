/**
 * Server-rendered smoke tests for the Monte Carlo panel (issue #132).
 *
 * As the other component tests here note: no browser test environment, so `svelte/server`'s
 * `render` only covers the initial markup — which is all three states this component ever shows
 * without a control to move (#155 adds those), so it is enough to cover the whole component.
 *
 * `monteCarloReadiness` is the correctness-critical part of this issue — get it wrong and the panel
 * either hides a real answer or prints one against a fallback nobody typed in — so it gets its own
 * direct unit tests against `$lib/monte-carlo.js`'s own `MonteCarloInput` shape, ahead of the
 * render tests.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createPension, createProfile } from '$lib/model.js';
import { normaliseMonteCarloInput } from '$lib/monte-carlo.js';
import MonteCarloSimulator, { monteCarloReadiness } from './MonteCarloSimulator.svelte';

/** A profile with a date of birth recorded, so `monteCarloReadiness` never reads `no_dob` from it. */
const withDob = createProfile({ dob_year: 1990, dob_month: 6 });

describe('monteCarloReadiness', () => {
	it('reads no_dob when the profile has no date of birth, whatever the input carries', () => {
		const input = normaliseMonteCarloInput({ pensionPot: 500_000 });
		expect(monteCarloReadiness(createProfile(), input)).toBe('no_dob');
	});

	it('reads no_data when there is a date of birth but no pot, contribution or stream', () => {
		const input = normaliseMonteCarloInput({});
		expect(monteCarloReadiness(withDob, input)).toBe('no_data');
	});

	it('reads ready off a pension pot alone', () => {
		const input = normaliseMonteCarloInput({ pensionPot: 100_000 });
		expect(monteCarloReadiness(withDob, input)).toBe('ready');
	});

	it('reads ready off an ISA pot alone', () => {
		const input = normaliseMonteCarloInput({ isaPot: 20_000 });
		expect(monteCarloReadiness(withDob, input)).toBe('ready');
	});

	it('reads ready off a monthly contribution alone, with both pots still at zero', () => {
		const input = normaliseMonteCarloInput({ pensionContribution: 500 });
		expect(monteCarloReadiness(withDob, input)).toBe('ready');
	});

	it('reads ready off a promised income stream alone, with no pot and no contribution', () => {
		const input = normaliseMonteCarloInput({
			streams: [{ id: 'state_pension', annualIncome: 12_000, startAge: 68 }]
		});
		expect(monteCarloReadiness(withDob, input)).toBe('ready');
	});

	it('treats a missing profile the same as one with no date of birth', () => {
		const input = normaliseMonteCarloInput({ pensionPot: 500_000 });
		expect(monteCarloReadiness(undefined, input)).toBe('no_dob');
	});
});

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(MonteCarloSimulator, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/±/g, '±')
		.replace(/\s+/g, ' ');
}

describe('MonteCarloSimulator', () => {
	it('names the engine’s own defaults in the intro, since this issue adds no controls over them', () => {
		const body = text();

		expect(body).toContain('5,000 paths');
		expect(body).toContain('age 95');
		expect(body).toContain('15% volatility');
	});

	it('shows the no-date-of-birth state rather than a probability off the age-40 fallback', () => {
		const body = text({ profile: createProfile() });

		expect(body).toContain('Add your date of birth on the forecast tab');
		expect(body).not.toContain('Probability of success');
	});

	it('shows the no-data state when a date of birth is on file but nothing is recorded to fund a plan', () => {
		const body = text({ profile: withDob, pensions: [], monthlyEntries: [] });

		expect(body).toContain('No pension pot, ISA holding or promised income recorded yet');
		expect(body).not.toContain('Probability of success');
	});

	it('runs the simulation and shows the headline once there is a pot and a target income to fund', () => {
		const body = text({
			profile: createProfile({
				dob_year: 1970,
				dob_month: 1,
				retirement_age: 67,
				growth_rate: 5,
				retirement_target: 40_000
			}),
			pensions: [createPension({ type: 'dc_workplace', value: 250_000 })]
		});

		expect(body).toContain('Probability of success');
		expect(body).toMatch(/\d+\.\d%/);
		expect(body).toContain('percentage points');
		expect(body).toContain('paths');
		// A real target income against one pension pot, drawing from age 67 to 95, is not guaranteed
		// by promised income alone — this is the branch that reports how the simulated paths split.
		expect(body).toContain('funded every retirement year in full');
	});

	it('surfaces the guaranteed flag when promised income alone covers the target, not the pot', () => {
		const body = text({
			profile: createProfile({
				dob_year: 1970,
				dob_month: 1,
				retirement_age: 67,
				retirement_target: 0
			}),
			pensions: [createPension({ type: 'dc_workplace', value: 100_000 })]
		});

		// A zero target needs nothing funded in any retirement year, so every path succeeds without
		// the market ever being asked to do anything — the same `guaranteed` semantics a real
		// promised-income plan would trigger.
		expect(body).toContain('This is guaranteed, not simulated');
		expect(body).toContain('100.0%');
	});
});
