/**
 * Server-rendered smoke tests for the retirement income stream builder (issue #33).
 *
 * As `PensionTracker.test.js`/`DefinedBenefitIncome.test.js` document: no browser test environment,
 * so `svelte/server`'s `render` covers the initial render only. That is the whole of this card except
 * what the controls do once they are moved — the six rows, the totals, the tax sentence, the
 * "not counted here" list and the empty state are all functions of the props, rendered at the
 * defaults (4% withdrawal rate, nothing annuitised, State Pension in). What the sliders produce
 * afterwards is covered directly in `$lib/retirement-income.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { accrualRateFromDenominator } from '$lib/defined-benefit.js';
import { createDividend, createInvestment, createMonthlyEntry, createPension } from '$lib/model.js';
import RetirementIncomeStreams from './RetirementIncomeStreams.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(RetirementIncomeStreams, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/\s+/g, ' ');
}

/** £18,750 a year — 1/60th, 25 years, £45,000. */
const finalSalary = createPension({
	name: 'Legacy final salary scheme',
	type: 'db_final_salary',
	db_accrual_rate: accrualRateFromDenominator(60),
	db_years: 25,
	db_salary: 45_000
});

const sipp = createPension({ name: 'Vanguard SIPP', type: 'sipp', value: 400_000 });
const niRecord = createPension({ type: 'state', ni_qualifying_years: 30, ni_future_years: 5 });

const isaSnapshot = [
	createMonthlyEntry({
		month: 6,
		year: 2026,
		investments: [
			createInvestment({ name: 'Global All Cap', wrapper: 'isa_stocks_shares', value: 200_000 })
		]
	})
];

const giaDividends = [
	createDividend({ name: 'Income fund', wrapper: 'gia', value: 50_000, yield_pct: 4 })
];

/** Everything at once, at the card's default assumptions. */
function everything() {
	return {
		pensions: [finalSalary, sipp, niRecord],
		monthlyEntries: isaSnapshot,
		dividends: giaDividends,
		profile: { retirement_target: 40_000, tax_region: 'england_wales_ni' }
	};
}

describe('RetirementIncomeStreams', () => {
	it('says there is nothing to draw on when the document is empty', () => {
		const body = text();

		expect(body).toContain('Nothing to draw on yet');
		expect(body).not.toContain('Stream by stream');
	});

	it('lists all six streams, named the way the issue names them', () => {
		const body = text(everything());

		expect(body).toContain('Defined Benefit pension');
		expect(body).toContain('Annuity');
		expect(body).toContain('SIPP / DC drawdown');
		expect(body).toContain('ISA withdrawals');
		expect(body).toContain('GIA dividends');
		expect(body).toContain('State Pension');
	});

	it('shows a stream that has nothing behind it rather than hiding it', () => {
		const body = text({ pensions: [sipp] });

		expect(body).toContain('No Defined Benefit scheme costed yet');
		expect(body).toContain('Nothing annuitised');
		expect(body).toContain('No ISA holdings in your latest snapshot');
		expect(body).toContain('No unwrapped holdings in the dividend planner');
	});

	it('adds every stream up gross, per year and per month', () => {
		const body = text(everything());

		// £18,750 DB + £16,000 drawdown + £8,000 ISA + £2,000 dividends + £12,547.60 State Pension.
		expect(body).toContain('£57,298');
		expect(body).toContain('£4,775');
	});

	it('shows what each pot is drawn at', () => {
		const body = text(everything());

		expect(body).toContain('£400,000 drawn at 4%');
		expect(body).toContain('£200,000 drawn at 4%');
		expect(body).toContain('£50,000 yielding 4%');
	});

	it('nets income tax off and names the region and tax year it used', () => {
		const body = text(everything());

		expect(body).toContain('After income tax');
		expect(body).toContain('England, Wales & Northern Ireland');
		expect(body).toContain('2026/27');
	});

	it('says which part of the income is tax-free', () => {
		const body = text(everything());

		// £8,000 of ISA withdrawals plus a quarter of £16,000 of drawdown.
		expect(body).toContain('£12,000 arrives tax-free');
		expect(body).toContain('£4,000 of it tax-free');
	});

	it('warns that dividend tax is not in the figure yet', () => {
		expect(text(everything())).toContain('not worked out here yet');
	});

	it('leaves the dividend warning out when there are no dividends to tax', () => {
		expect(text({ pensions: [sipp] })).not.toContain('not worked out here yet');
	});

	it('measures the net income against the target on the profile', () => {
		const body = text(everything());

		expect(body).toContain('£40,000 a year wanted');
		expect(body).toContain('a year clear');
	});

	it('says how far short the streams fall when they do not reach the target', () => {
		const body = text({ ...everything(), profile: { retirement_target: 90_000 } });

		expect(body).toContain('a year short');
	});

	it('has nothing to measure against when no target is set', () => {
		expect(text({ pensions: [sipp] })).toContain('no target income set on your profile');
	});

	it('works the State Pension out from the NI years on file', () => {
		const body = text(everything());

		expect(body).toContain('35 of 35 qualifying NI years');
		expect(body).toContain('£12,548');
	});

	it('asks for NI years when no record carries them', () => {
		expect(text({ pensions: [sipp] })).toContain('No NI record yet');
	});

	it('reports what no stream could use, and why', () => {
		const body = text({
			pensions: [sipp],
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [
						createInvestment({ wrapper: 'sipp', value: 400_000 }),
						createInvestment({ wrapper: 'jisa', value: 9_000 })
					]
				})
			]
		});

		expect(body).toContain('Not counted here');
		expect(body).toContain('Snapshot holdings in a pension wrapper (1, £400,000)');
		expect(body).toContain('count the same money twice');
		expect(body).toContain('Junior ISA holdings (1, £9,000)');
		expect(body).toContain('the child’s money at 18');
	});

	it('says nothing about uncounted capital when everything is in a stream', () => {
		expect(text(everything())).not.toContain('Not counted here');
	});

	it('offers the assumptions as controls', () => {
		const body = text(everything());

		expect(body).toContain('Withdrawal rate (%)');
		expect(body).toContain('Pot annuitised (%)');
		expect(body).toContain('Annuity rate (%)');
		expect(body).toContain('Include the State Pension');
	});

	it('carries the disclaimer about what the figures leave out', () => {
		const body = text(everything());

		expect(body).toContain('Illustrative only, not financial advice');
		expect(body).toContain('State Pension age');
	});
});
