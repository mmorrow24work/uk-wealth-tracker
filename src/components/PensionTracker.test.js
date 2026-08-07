/**
 * Server-rendered smoke tests for the Pension tracker (issue #29).
 *
 * As `FireCalculator.test.js` documents: no browser test environment, so `svelte/server`'s
 * `render` covers the initial render only — what a user sees against a given `pensions` list,
 * before touching the add/edit form. `PensionTracker`'s only interesting *initial-render* branch
 * is per-pension (pot-value fields vs the Defined Benefit forward-reference note), so that is what
 * these tests pin; the add/edit/remove logic itself is straightforward enough state-juggling
 * (mirroring `InvestmentHoldings`/`DebtTracker`, neither of which has its own test file either)
 * that it is left to `npm run build && npm run preview` manual verification instead.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { PENSION_POT_TYPES, PENSION_TYPE_LABELS } from '$lib/enums.js';
import { createPension } from '$lib/model.js';
import PensionTracker from './PensionTracker.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(PensionTracker, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('PensionTracker', () => {
	it('shows an empty state with no pots recorded', () => {
		const body = text();
		expect(body).toContain('No pension pots recorded yet');
	});

	it('offers every pot type issue #29 names, but not the State Pension', () => {
		const body = text();
		expect(body).toContain('DC Workplace');
		expect(body).toContain('SIPP');
		expect(body).toContain('Defined Benefit (Final Salary)');
		expect(body).toContain('Defined Benefit (CARE)');
		expect(body).toContain('Lifetime ISA');
		expect(body).not.toContain('State Pension');
	});

	it('lists every PENSION_POT_TYPES label exactly once in the type select', () => {
		const body = text();
		for (const type of PENSION_POT_TYPES) {
			expect(body).toContain(PENSION_TYPE_LABELS[type]);
		}
	});

	it('shows pot value, contribution %, employer % and fund fee for a DC Workplace pot', () => {
		const body = text({
			pensions: [
				createPension({
					name: 'Aviva workplace pension',
					type: 'dc_workplace',
					value: 45_000,
					contribution_pct: 5,
					employer_pct: 3,
					fund_fee: 0.35
				})
			]
		});

		expect(body).toContain('Aviva workplace pension');
		expect(body).toContain('£45,000');
		expect(body).toContain('5% your contribution');
		expect(body).toContain('3% employer');
		expect(body).toContain('0.35% fund fee');
	});

	it('shows a Lifetime ISA pot the same way as the other pot-value types', () => {
		const body = text({
			pensions: [
				createPension({
					name: 'Moneybox LISA',
					type: 'lisa',
					value: 12_000,
					contribution_pct: 4,
					employer_pct: 0,
					fund_fee: 0.45
				})
			]
		});

		expect(body).toContain('Moneybox LISA');
		expect(body).toContain('£12,000');
		expect(body).toContain('Lifetime ISA');
	});

	it('shows a forward-reference note for a Defined Benefit pot instead of pot-value fields', () => {
		const body = text({
			pensions: [createPension({ name: 'NHS Pension', type: 'db_final_salary' })]
		});

		expect(body).toContain('NHS Pension');
		expect(body).toContain('Defined Benefit (Final Salary)');
		expect(body).toContain(
			'accrual rate, years of service and income calculation land in a later build (#30)'
		);
		// The list-item summary format for pot-value types ("£X pot · Y% your contribution + …") must
		// not appear for a Defined Benefit entry — only the note above should describe it.
		expect(body).not.toContain('pot ·');
	});

	it('sums pot value across pots, defined benefit pots contributing zero', () => {
		const body = text({
			pensions: [
				createPension({ name: 'SIPP', type: 'sipp', value: 30_000 }),
				createPension({ name: 'Final salary scheme', type: 'db_final_salary' })
			]
		});

		expect(body).toContain('2 pots recorded');
		expect(body).toContain('£30,000');
	});

	it('labels the submit button "Add pot" until a pot is being edited', () => {
		const body = text();
		expect(body).toContain('Add pot');
		expect(body).not.toContain('Save changes');
	});
});
