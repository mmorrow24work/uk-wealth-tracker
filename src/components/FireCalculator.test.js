/**
 * Server-rendered smoke tests for the FIRE panel (issue #22).
 *
 * The project has no browser test environment (no jsdom, no `@testing-library/svelte`) — earlier
 * build-log entries record that as a deliberate gap — but `svelte/server`'s `render` does resolve
 * from a plain vitest file here, and vitest already transforms `.svelte` through the configured
 * `sveltekit()` plugin. That is enough to assert the panel's *initial* render: what a user sees
 * before touching a slider, which is where every wrong-by-default figure and every misleading
 * sentence lives. It cannot assert what happens after an input event; the arithmetic behind those
 * updates is covered directly in `$lib/fire.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createInvestment, createMonthlyEntry, createProfile } from '$lib/model.js';
import FireCalculator from './FireCalculator.svelte';

/**
 * The rendered markup as plain text, so an assertion reads the sentence a user reads rather than
 * the tags around it.
 *
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(FireCalculator, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/\s+/g, ' ');
}

/*
 * No fixture sets `profile.dob_year`: the panel derives "your age now" from it against the current
 * calendar month, so a birth year would make every horizon below one year longer each January.
 * Without one the panel falls back to its own default age, which is what keeps these deterministic.
 */

/** @param {Partial<import('$lib/types.js').Investment>} overrides */
function snapshot(overrides) {
	return [
		createMonthlyEntry({
			month: 8,
			year: 2026,
			investments: [createInvestment(overrides)]
		})
	];
}

describe('FireCalculator', () => {
	it('renders the four sliders README.md names', () => {
		const body = text();

		expect(body).toContain('Target income');
		expect(body).toContain('Monthly saving');
		expect(body).toContain('Annual growth');
		expect(body).toContain('Withdrawal rate');
	});

	it('asks for a starting position only when there is no history', () => {
		expect(text()).toContain('No monthly snapshots recorded yet');

		const withHistory = text({ monthlyEntries: snapshot({ value: 180_000 }) });
		expect(withHistory).not.toContain('No monthly snapshots recorded yet');
		expect(withHistory).toContain('£180,000 invested');
	});

	it('shows the magic number as 25x the target income at the default 4%', () => {
		const body = text({
			monthlyEntries: snapshot({ value: 100_000 }),
			profile: createProfile({ retirement_target: 40_000 })
		});

		expect(body).toContain('25× £40,000 at 4%');
		expect(body).toContain('£1,000,000');
	});

	it('dates coasting when the plan gets far enough ahead', () => {
		const body = text({
			monthlyEntries: snapshot({ value: 200_000, monthly_contribution: 800 }),
			profile: createProfile({ retirement_target: 20_000, retirement_age: 60 })
		});

		expect(body).toContain('Coasting starts');
		expect(body).toContain('you could stop saving entirely');
		// Not there *yet* — that is a different sentence, and saying both would contradict itself.
		expect(body).not.toContain('You can stop contributing now');
	});

	it('does not claim coasting when the pot only gets there after retirement', () => {
		const body = text({
			monthlyEntries: snapshot({ value: 5_000, monthly_contribution: 100 }),
			profile: createProfile({ retirement_target: 40_000, retirement_age: 67 })
		});

		expect(body).toContain("There's no month before 67 you could stop saving in");
		expect(body).not.toContain('Coasting starts');
	});

	it('answers "will my money last" against the pot at retirement', () => {
		const short = text({
			monthlyEntries: snapshot({ value: 20_000, monthly_contribution: 100 }),
			profile: createProfile({ retirement_target: 30_000, retirement_age: 60 })
		});
		expect(short).toContain('The money runs out in');
		expect(short).toContain('short of lasting to 95');

		// Same drawdown, a bigger pot behind it: it outlasts 95 without growth ever covering the draw,
		// so this is the "lasts long enough" wording rather than the "never falls" one.
		const comfortable = text({
			monthlyEntries: snapshot({ value: 200_000, monthly_contribution: 800 }),
			profile: createProfile({ retirement_target: 20_000, retirement_age: 60 })
		});
		expect(comfortable).toContain('is still there at 95');
		expect(comfortable).not.toContain('The money runs out in');
	});

	it('says everything is in today’s money and nothing here is advice', () => {
		const body = text();

		expect(body).toContain("in today's money");
		expect(body).toContain('not financial advice');
	});
});
