/**
 * Server-rendered smoke tests for the retirement income stream builder (issue #33).
 *
 * As `PensionTracker.test.js` documents: no browser test environment, so `svelte/server`'s `render`
 * covers the initial render only. That is most of this card — the three tiles, the six-row table, the
 * tax sentence, the "not counted here" list and the empty state are all functions of the props, and
 * the controls render at their defaults (4% withdrawal, nothing annuitised, State Pension counted).
 * What it cannot reach is the card *after* a slider moves; every assumption is covered directly in
 * `$lib/retirement-income.test.js`, which drives `retirementIncomeSummary` with the same inputs the
 * controls produce.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createDividend, createInvestment, createMonthlyEntry, createPension } from '$lib/model.js';
import { FULL_STATE_PENSION_ANNUAL } from '$lib/state-pension.js';
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
		.replace(/&pound;/g, '£')
		.replace(/\s+/g, ' ');
}

/** The same worked position `$lib/retirement-income.test.js` uses, minus its Junior ISA line. */
const pensions = [
	createPension({ name: 'Workplace', type: 'dc_workplace', value: 200_000 }),
	createPension({ name: 'SIPP', type: 'sipp', value: 200_000 }),
	createPension({ name: 'Legacy scheme', type: 'db_final_salary', db_annual_income: 10_000 }),
	createPension({ name: 'State Pension', type: 'state', ni_qualifying_years: 35 })
];

const monthlyEntries = [
	createMonthlyEntry({
		month: 6,
		year: 2026,
		investments: [
			createInvestment({ name: 'Global tracker', wrapper: 'isa_stocks_shares', value: 100_000 }),
			createInvestment({ name: 'Old SIPP line', wrapper: 'sipp', value: 30_000 })
		]
	})
];

const dividends = [
	createDividend({ name: 'Income fund', wrapper: 'gia', value: 50_000, yield_pct: 4 })
];

const profile = { tax_region: 'england_wales_ni', retirement_target: 30_000 };

const full = { pensions, monthlyEntries, dividends, profile };

describe('RetirementIncomeStreams', () => {
	it('says there is nothing to build an income out of when nothing is recorded', () => {
		const body = text();

		expect(body).toContain('Nothing to build an income out of yet');
		expect(body).not.toContain('Stream by stream');
	});

	it('names all six streams, in the issue’s order', () => {
		const body = text(full);
		const order = [
			'Defined Benefit pension',
			'Annuity',
			'SIPP / DC drawdown',
			'ISA withdrawals',
			'GIA dividends',
			'State Pension'
		];

		let cursor = -1;
		for (const label of order) {
			const at = body.indexOf(label, cursor + 1);
			expect(at, `${label} should appear after the stream before it`).toBeGreaterThan(cursor);
			cursor = at;
		}
	});

	it('shows the gross total, the tax and what is left', () => {
		const body = text(full);

		// £10,000 DB + £16,000 drawdown + £4,000 ISA + £2,000 dividends + £12,547.60 State Pension.
		expect(body).toContain('£44,548'); // gross
		expect(body).toContain('£4,557 of tax'); // £4,395.52 income tax + £161.25 dividend tax
		expect(body).toContain('£39,991'); // after tax
	});

	it('prices each stream off the collection it came from', () => {
		const body = text(full);

		expect(body).toContain('£400,000 at 4%'); // the two DC pots, in drawdown
		expect(body).toContain('£100,000 at 4%'); // the Stocks & Shares ISA holding
		expect(body).toContain('£50,000 at 4%'); // the dividend holding, at its own yield
		expect(body).toContain('35 qualifying years of 35');
		expect(body).toContain('1 scheme, as promised');
		expect(body).toContain('Latest monthly snapshot');
		expect(body).toContain('Dividend planner');
	});

	it('splits the tax-free quarter out of the pension income', () => {
		const body = text(full);

		expect(body).toContain('£4,000 of it tax-free');
		expect(body).toContain('25% tax-free quarter');
	});

	it('measures the target against income after tax', () => {
		const body = text(full);

		expect(body).toContain('£30,000 a year wanted');
		expect(body).toContain('a year clear');
	});

	it('says how far short the income falls of a target it cannot reach', () => {
		const body = text({ ...full, profile: { ...profile, retirement_target: 60_000 } });

		expect(body).toContain('a year short');
	});

	it('says nothing about a target that was never set', () => {
		const body = text({ ...full, profile: { tax_region: 'england_wales_ni' } });

		expect(body).toContain('no retirement target set');
		expect(body).toContain('set one on the forecast tab');
	});

	it('reports what no stream could use, with its value and a reason', () => {
		const body = text(full);

		expect(body).toContain('Not counted here');
		expect(body).toContain('Snapshot holdings in a pension wrapper — £30,000');
		expect(body).toContain('would count the same money twice');
	});

	it('prices the promised income as a pot for comparison, not as money held', () => {
		const body = text(full);

		expect(body).toContain('promised rather than held');
		expect(body).toContain('a comparison and not money anyone has');
	});

	it('renders every empty stream as a zero rather than dropping it', () => {
		const body = text({ pensions: [pensions[2]] });

		expect(body).toContain('nothing recorded');
		expect(body).toContain('no National Insurance years recorded');
		expect(body).toContain('SIPP / DC drawdown');
	});

	it('states the State Pension’s own full-rate figure when the record reaches 35 years', () => {
		const body = text(full);
		const formatted = new Intl.NumberFormat('en-GB', {
			style: 'currency',
			currency: 'GBP',
			maximumFractionDigits: 0
		}).format(FULL_STATE_PENSION_ANNUAL);

		expect(body).toContain(formatted);
	});

	it('carries the illustrative-only footnote every calculator card carries', () => {
		const body = text(full);

		expect(body).toContain('Illustrative only, not financial advice');
		expect(body).toContain('a rate, not a promise');
	});
});
