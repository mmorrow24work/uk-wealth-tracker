/**
 * Server-rendered smoke tests for the Defined Benefit income card (issue #30).
 *
 * As `PensionTracker.test.js` documents: no browser test environment, so `svelte/server`'s `render`
 * covers the initial render only. That is most of this card — the totals, the per-scheme table, the
 * warnings and the empty state are all functions of the `pensions` prop, and the projection panel
 * renders at its zero-extra-years default. What it cannot reach is the projection *after* typing
 * into it; `projectDefinedBenefit` is covered directly in `$lib/defined-benefit.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { accrualRateFromDenominator } from '$lib/defined-benefit.js';
import { createPension } from '$lib/model.js';
import DefinedBenefitIncome from './DefinedBenefitIncome.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(DefinedBenefitIncome, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/\s+/g, ' ');
}

/** 1/60th, 25 years, £45,000 — £18,750 a year. */
const finalSalary = createPension({
	name: 'Legacy final salary scheme',
	type: 'db_final_salary',
	db_accrual_rate: accrualRateFromDenominator(60),
	db_years: 25,
	db_salary: 45_000
});

/** A statement figure with no accrual inputs behind it. */
const care = createPension({ name: 'NHS 2015', type: 'db_care', db_annual_income: 6_250 });

describe('DefinedBenefitIncome', () => {
	it('says there is nothing to show when no Defined Benefit scheme is recorded', () => {
		const body = text({ pensions: [createPension({ type: 'sipp', value: 90_000 })] });

		expect(body).toContain('No Defined Benefit schemes recorded');
		expect(body).toContain('Defined Benefit (Final Salary)');
		expect(body).toContain('Defined Benefit (CARE)');
	});

	it('states the formula it is applying', () => {
		expect(text()).toContain('accrual rate × pensionable salary × years of service');
	});

	it('shows one scheme’s income annually and monthly, and how it got there', () => {
		const body = text({ pensions: [finalSalary] });

		expect(body).toContain('£18,750');
		expect(body).toContain('£1,563');
		expect(body).toContain('1/60th × 25 years × £45,000');
	});

	it('reports the income as a share of pensionable salary', () => {
		// 25 years of 1/60ths is 25/60 of salary.
		expect(text({ pensions: [finalSalary] })).toContain('41.67% of pensionable salary');
	});

	it('adds every scheme up, ignoring pots that are not Defined Benefit', () => {
		const body = text({
			pensions: [createPension({ type: 'dc_workplace', value: 200_000 }), finalSalary, care]
		});

		expect(body).toContain('£25,000/yr');
		expect(body).toContain('2 of 2 schemes costed');
	});

	it('prices the total as the pot it would take to buy it', () => {
		const body = text({ pensions: [finalSalary, care] });

		// £25,000 a year at 4% is 25× — £625,000.
		expect(body).toContain('£625,000');
		expect(body).toContain('at a 4% withdrawal rate');
	});

	it('honours a different withdrawal rate', () => {
		const body = text({ pensions: [finalSalary, care], withdrawalRate: 5 });

		expect(body).toContain('£500,000');
		expect(body).toContain('at a 5% withdrawal rate');
	});

	it('names the inputs a half-filled scheme still needs', () => {
		const body = text({
			pensions: [createPension({ name: 'Old scheme', type: 'db_final_salary', db_years: 4 })]
		});

		expect(body).toContain('Needs accrual rate and pensionable salary');
		expect(body).toContain('0 of 1 scheme costed');
	});

	it('flags a statement that disagrees with the accrual inputs beside it', () => {
		const body = text({
			pensions: [
				createPension({
					name: 'Legacy final salary scheme',
					type: 'db_final_salary',
					db_accrual_rate: accrualRateFromDenominator(60),
					db_years: 25,
					db_salary: 45_000,
					db_annual_income: 20_000
				})
			]
		});

		expect(body).toContain('the two routes disagree');
		expect(body).toContain('£20,000');
		expect(body).toContain('£18,750');
	});

	it('does not flag a disagreement under a pound', () => {
		const body = text({
			pensions: [
				createPension({
					type: 'db_final_salary',
					db_accrual_rate: accrualRateFromDenominator(60),
					db_years: 25,
					db_salary: 45_000,
					db_annual_income: 18_750.4
				})
			]
		});

		expect(body).not.toContain('the two routes disagree');
	});

	it('offers to project a scheme still on the accrual route', () => {
		expect(text({ pensions: [finalSalary] })).toContain('If you keep accruing');
	});

	it('has nothing to project when every scheme came off a statement', () => {
		expect(text({ pensions: [care] })).not.toContain('If you keep accruing');
	});

	it('only offers a scheme picker when there is more than one scheme to pick', () => {
		expect(text({ pensions: [finalSalary] })).not.toContain('Scheme Further years');
		expect(
			text({
				pensions: [
					finalSalary,
					createPension({
						name: 'Another scheme',
						type: 'db_care',
						db_accrual_rate: accrualRateFromDenominator(49),
						db_years: 8,
						db_salary: 30_000
					})
				]
			})
		).toContain('Another scheme');
	});

	it('carries the disclaimer about what a Defined Benefit figure leaves out', () => {
		const body = text({ pensions: [finalSalary] });

		expect(body).toContain('Illustrative only, not financial advice');
		expect(body).toContain('Drawing early cuts the pension');
	});
});
