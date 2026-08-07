/**
 * Server-rendered smoke tests for the pension tax relief card (issue #32).
 *
 * As `DefinedBenefitIncome.test.js` documents: no browser test environment, so `svelte/server`'s
 * `render` covers the initial render only. That is all of this card — every figure is a pure
 * function of the `pensions`/`profile` props, with no local state or interaction — so these tests
 * pin the empty state, the relief table for basic- and higher-rate taxpayers, the Lifetime ISA
 * note, and the Self Assessment prompt. The arithmetic itself is covered directly in
 * `$lib/pension-relief.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createPension, createProfile } from '$lib/model.js';
import PensionTaxRelief from './PensionTaxRelief.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(PensionTaxRelief, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('PensionTaxRelief', () => {
	it('shows an empty state with no relief-eligible or Lifetime ISA pots recorded', () => {
		const body = text();
		expect(body).toContain('No DC Workplace, SIPP or Lifetime ISA pots recorded yet');
	});

	it('shows an empty state with only a Defined Benefit pot recorded', () => {
		const body = text({ pensions: [createPension({ type: 'db_final_salary' })] });
		expect(body).toContain('No DC Workplace, SIPP or Lifetime ISA pots recorded yet');
	});

	it('shows a basic-rate taxpayer’s pot with nothing to claim', () => {
		const body = text({
			pensions: [
				createPension({ name: 'Aviva workplace', type: 'dc_workplace', contribution_pct: 5 })
			],
			profile: createProfile({ gross_salary: 30_000 })
		});

		expect(body).toContain('Aviva workplace');
		expect(body).toContain('£1,500'); // net contribution
		expect(body).toContain('£375'); // basic-rate relief
		expect(body).not.toContain('pot above'); // the "still to claim" prompt
	});

	it('shows a higher-rate taxpayer’s extra relief and the Self Assessment prompt', () => {
		const body = text({
			pensions: [createPension({ name: 'My SIPP', type: 'sipp', contribution_pct: 10 })],
			profile: createProfile({ gross_salary: 80_000, tax_region: 'england_wales_ni' })
		});

		expect(body).toContain('My SIPP');
		expect(body).toContain('marginal rate 40%');
		expect(body).toContain('relief still to claim');
		expect(body).toContain('Self Assessment');
	});

	it('carries a Lifetime ISA pot separately with its own bonus note, not a relief row', () => {
		const body = text({
			pensions: [createPension({ name: 'My LISA', type: 'lisa', contribution_pct: 100 })],
			profile: createProfile({ gross_salary: 80_000 })
		});

		expect(body).toContain('1 Lifetime ISA pot is not shown above');
		expect(body).toContain('25% government bonus');
	});

	it('shows both a relief-eligible pot and a Lifetime ISA pot together', () => {
		const body = text({
			pensions: [
				createPension({ name: 'My SIPP', type: 'sipp', contribution_pct: 5 }),
				createPension({ name: 'My LISA', type: 'lisa', contribution_pct: 100 })
			],
			profile: createProfile({ gross_salary: 30_000 })
		});

		expect(body).toContain('My SIPP');
		expect(body).toContain('Lifetime ISA pot is not shown above');
	});
});
