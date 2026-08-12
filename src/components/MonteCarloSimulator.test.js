/**
 * Server-rendered smoke tests for the Monte Carlo panel (issues #132, #155).
 *
 * As the other component tests here note: no browser test environment, so `svelte/server`'s
 * `render` only covers the initial markup — real slider drags, the debounced re-run and timer
 * teardown were driven for real in a browser instead (see the PR description). What *is* covered
 * here in full is the pure logic #155 adds: seeding the six controls off an already-assembled
 * `MonteCarloInput`, validating them, splitting the combined contribution slider back into the
 * engine's own two fields, and turning valid controls into the patch handed to
 * `monteCarloInputFromAppData()`.
 *
 * `monteCarloReadiness` is the correctness-critical part of #132 — get it wrong and the panel
 * either hides a real answer or prints one against a fallback nobody typed in — so it keeps its
 * own direct unit tests against `$lib/monte-carlo.js`'s own `MonteCarloInput` shape, ahead of the
 * render tests.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createPension, createProfile } from '$lib/model.js';
import {
	DEFAULT_TARGET_AGE,
	DEFAULT_VOLATILITY,
	MAX_AGE,
	MAX_VOLATILITY,
	MIN_AGE,
	MIN_VOLATILITY,
	normaliseMonteCarloInput
} from '$lib/monte-carlo.js';
import MonteCarloSimulator, {
	monteCarloControlDefaults,
	monteCarloControlsValid,
	monteCarloOverridesFromControls,
	monteCarloReadiness,
	splitMonthlyContribution
} from './MonteCarloSimulator.svelte';

/** A profile with a date of birth recorded, so `monteCarloReadiness` never reads `no_dob` from it. */
const withDob = createProfile({ dob_year: 1990, dob_month: 6 });

/** A syntactically valid set of controls, for tests that mutate one field at a time. */
const validControls = {
	retirementAge: 67,
	targetAge: 95,
	targetIncome: 30_000,
	monthlyContribution: 500,
	growthRate: 5,
	volatility: 15
};

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

describe('splitMonthlyContribution', () => {
	it('puts the whole amount into the pension when nothing was seeded to take a ratio of', () => {
		expect(splitMonthlyContribution(600, 0, 0)).toEqual({
			pensionContribution: 600,
			isaContribution: 0
		});
	});

	it('splits in the seeded ratio when both pots were seeded with a contribution', () => {
		// Seeded 300 pension / 100 ISA — a 3:1 ratio — applied to a slider raised to 800.
		expect(splitMonthlyContribution(800, 300, 100)).toEqual({
			pensionContribution: 600,
			isaContribution: 200
		});
	});

	it('keeps the ISA share at zero when only the pension was ever seeded', () => {
		expect(splitMonthlyContribution(1000, 400, 0)).toEqual({
			pensionContribution: 1000,
			isaContribution: 0
		});
	});

	it('keeps the pension share at zero when only the ISA was ever seeded', () => {
		expect(splitMonthlyContribution(1000, 0, 250)).toEqual({
			pensionContribution: 0,
			isaContribution: 1000
		});
	});

	it('the two halves always add back up to the total, pence included', () => {
		const { pensionContribution, isaContribution } = splitMonthlyContribution(333.33, 1, 2);
		expect(Math.round((pensionContribution + isaContribution) * 100) / 100).toBe(333.33);
	});

	it('treats a negative or non-finite total as zero rather than throwing', () => {
		expect(splitMonthlyContribution(-50, 100, 100)).toEqual({
			pensionContribution: 0,
			isaContribution: 0
		});
		expect(splitMonthlyContribution(Number.NaN, 100, 100)).toEqual({
			pensionContribution: 0,
			isaContribution: 0
		});
	});
});

describe('monteCarloControlDefaults', () => {
	it('seeds the four store-derived controls off the input, and the other two off the engine defaults', () => {
		const seeded = normaliseMonteCarloInput({
			retirementAge: 60,
			targetIncome: 25_000,
			growthRate: 4,
			pensionContribution: 300,
			isaContribution: 100
		});

		expect(monteCarloControlDefaults(seeded)).toEqual({
			retirementAge: 60,
			targetAge: DEFAULT_TARGET_AGE,
			targetIncome: 25_000,
			monthlyContribution: 400,
			growthRate: 4,
			volatility: DEFAULT_VOLATILITY
		});
	});

	it('combines a zero pension contribution with a zero ISA contribution into a zero slider', () => {
		const seeded = normaliseMonteCarloInput({});
		expect(monteCarloControlDefaults(seeded).monthlyContribution).toBe(0);
	});
});

describe('monteCarloControlsValid', () => {
	it('accepts a fully in-range set of controls', () => {
		expect(monteCarloControlsValid(validControls)).toBe(true);
	});

	it('rejects a NaN field — what a cleared number input parses to', () => {
		expect(monteCarloControlsValid({ ...validControls, targetIncome: Number.NaN })).toBe(false);
	});

	it('rejects a retirement age past the engine’s own MAX_AGE', () => {
		expect(monteCarloControlsValid({ ...validControls, retirementAge: MAX_AGE + 1 })).toBe(false);
	});

	it('rejects a target age below the engine’s own MIN_AGE', () => {
		expect(monteCarloControlsValid({ ...validControls, targetAge: MIN_AGE - 1 })).toBe(false);
	});

	it('rejects a volatility outside MIN_VOLATILITY…MAX_VOLATILITY', () => {
		expect(monteCarloControlsValid({ ...validControls, volatility: MAX_VOLATILITY + 1 })).toBe(
			false
		);
		expect(monteCarloControlsValid({ ...validControls, volatility: MIN_VOLATILITY - 1 })).toBe(
			false
		);
	});

	it('rejects a growth rate outside -100…100', () => {
		expect(monteCarloControlsValid({ ...validControls, growthRate: 101 })).toBe(false);
		expect(monteCarloControlsValid({ ...validControls, growthRate: -101 })).toBe(false);
	});

	it('rejects a negative target income or monthly contribution', () => {
		expect(monteCarloControlsValid({ ...validControls, targetIncome: -1 })).toBe(false);
		expect(monteCarloControlsValid({ ...validControls, monthlyContribution: -1 })).toBe(false);
	});

	it('accepts a target age below the retirement age — the engine pulls it up rather than refusing it', () => {
		expect(monteCarloControlsValid({ ...validControls, retirementAge: 70, targetAge: 65 })).toBe(
			true
		);
	});
});

describe('monteCarloOverridesFromControls', () => {
	it('carries the five direct fields through and splits the sixth', () => {
		const seeded = normaliseMonteCarloInput({ pensionContribution: 300, isaContribution: 100 });
		const overrides = monteCarloOverridesFromControls(
			{ ...validControls, monthlyContribution: 800 },
			seeded
		);

		expect(overrides).toEqual({
			retirementAge: 67,
			targetAge: 95,
			targetIncome: 30_000,
			growthRate: 5,
			volatility: 15,
			pensionContribution: 600,
			isaContribution: 200
		});
	});

	it('leaves every other field to monteCarloInputFromAppData — no pot, stream, tax or seed key here', () => {
		const seeded = normaliseMonteCarloInput({});
		const overrides = monteCarloOverridesFromControls(validControls, seeded);

		expect(overrides).not.toHaveProperty('pensionPot');
		expect(overrides).not.toHaveProperty('isaPot');
		expect(overrides).not.toHaveProperty('streams');
		expect(overrides).not.toHaveProperty('inflationRate');
		expect(overrides).not.toHaveProperty('feeRate');
		expect(overrides).not.toHaveProperty('taxRegion');
		expect(overrides).not.toHaveProperty('withdrawalOrder');
		expect(overrides).not.toHaveProperty('seed');
		expect(overrides).not.toHaveProperty('paths');
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
	it('renders the six controls, labelled, whatever state the panel is in', () => {
		const body = text();

		for (const label of [
			'Retirement age',
			'Target income',
			'Monthly contributions',
			'Annual growth',
			'Volatility',
			'Money must last to'
		]) {
			expect(body).toContain(label);
		}
	});

	it('names the path count in the intro, without hard-coding the now-editable target age or volatility', () => {
		const body = text();
		expect(body).toContain('5,000 paths');
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
		// `MonteCarloOutcomes` (#154/#218) mounts beneath the fan chart once there is a real summary.
		expect(body).toContain('Pot left at age');
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

	it('seeds the retirement-age and target-income sliders from the profile on first render', () => {
		// Raw markup, not `text()`'s tag-stripped version — a `value="…"` attribute lives inside the
		// tag `text()` throws away.
		const { body } = render(MonteCarloSimulator, {
			props: {
				profile: createProfile({
					dob_year: 1970,
					dob_month: 1,
					retirement_age: 62,
					retirement_target: 45_000
				}),
				pensions: [createPension({ type: 'dc_workplace', value: 100_000 })]
			}
		});

		expect(body).toContain('value="62"');
		expect(body).toContain('value="45000"');
	});
});
