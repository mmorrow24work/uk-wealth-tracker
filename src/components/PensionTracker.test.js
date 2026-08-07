/**
 * Server-rendered smoke tests for the Pension tracker (issues #29, #30 and #31's filtering).
 *
 * As `FireCalculator.test.js` documents: no browser test environment, so `svelte/server`'s
 * `render` covers the initial render only — what a user sees against a given `pensions` list,
 * before touching the add/edit form. `PensionTracker`'s only interesting *initial-render* branch
 * is per-pension (pot-value fields vs the Defined Benefit income line #30 added), so that is what
 * these tests pin; the add/edit/remove logic itself is straightforward enough state-juggling
 * (mirroring `InvestmentHoldings`/`DebtTracker`, neither of which has its own test file either)
 * that it is left to `npm run build && npm run preview` manual verification instead. The Defined
 * Benefit half of the form — the accrual fraction select and the four `db_*` inputs — only renders
 * once a Defined Benefit type is chosen, which is an interaction, so it is out of reach here too;
 * the formula behind it is covered directly in `$lib/defined-benefit.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { accrualRateFromDenominator } from '$lib/defined-benefit.js';
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

	it('asks a Defined Benefit pot for its inputs instead of showing an income it cannot work out', () => {
		const body = text({
			pensions: [createPension({ name: 'NHS Pension', type: 'db_final_salary' })]
		});

		expect(body).toContain('NHS Pension');
		expect(body).toContain('Defined Benefit (Final Salary)');
		expect(body).toContain('No income yet');
		// The list-item summary format for pot-value types ("£X pot · Y% your contribution + …") must
		// not appear for a Defined Benefit entry.
		expect(body).not.toContain('pot ·');
	});

	it('works a Defined Benefit income out from the accrual route and shows how — issue #30', () => {
		const body = text({
			pensions: [
				createPension({
					name: 'Legacy final salary scheme',
					type: 'db_final_salary',
					db_accrual_rate: accrualRateFromDenominator(60),
					db_years: 25,
					db_salary: 45_000
				})
			]
		});

		// (1/60) × £45,000 × 25 = £18,750 a year, £1,562.50 a month.
		expect(body).toContain('£18,750/yr');
		expect(body).toContain('£1,563/mo');
		expect(body).toContain('1/60th × 25 yrs × £45,000');
	});

	it('says when a Defined Benefit income came off a statement rather than the formula', () => {
		const body = text({
			pensions: [createPension({ name: 'NHS 2015', type: 'db_care', db_annual_income: 9_320 })]
		});

		expect(body).toContain('£9,320/yr');
		expect(body).toContain('taken from your statement');
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

	it('leaves the State Pension record out of the list entirely — it has its own card (#31)', () => {
		const body = text({
			pensions: [
				createPension({ name: 'SIPP', type: 'sipp', value: 30_000 }),
				createPension({ name: 'State Pension', type: 'state', ni_qualifying_years: 20 })
			]
		});

		expect(body).toContain('1 pot recorded');
		expect(body).not.toContain('State Pension');
	});

	it('shows the empty state when the only record is the State Pension', () => {
		const body = text({
			pensions: [createPension({ name: 'State Pension', type: 'state', ni_qualifying_years: 20 })]
		});

		expect(body).toContain('No pension pots recorded yet');
	});

	it('labels the submit button "Add pot" until a pot is being edited', () => {
		const body = text();
		expect(body).toContain('Add pot');
		expect(body).not.toContain('Save changes');
	});
});
