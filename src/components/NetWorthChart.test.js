/**
 * Server-rendered smoke tests for the tracked net worth chart (issue #67).
 *
 * Same approach and same limits as the other component tests here: `svelte/server`'s `render` gives
 * the component's *initial* markup, which is enough to assert the empty states, the headline figure
 * and the accessible summary a screen reader is handed. It deliberately does not assert the drawn
 * path — a `<Chart>` measures its container before it scales anything, and a server render has no
 * container to measure, so the plot area is empty by construction there. The maths behind every
 * coordinate is covered directly in `$lib/net-worth.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createDebt, createInvestment, createMonthlyEntry } from '$lib/model.js';
import NetWorthChart from './NetWorthChart.svelte';

/**
 * @param {number} month
 * @param {number} year
 * @param {{ investments?: number[], debts?: number[] }} [contents]
 * @returns {import('$lib/types.js').MonthlyEntry}
 */
function entry(month, year, contents = {}) {
	const { investments = [], debts = [] } = contents;
	return createMonthlyEntry({
		month,
		year,
		investments: investments.map((value) => createInvestment({ value })),
		debts: debts.map((balance) => createDebt({ balance }))
	});
}

/**
 * The rendered markup as plain text, so an assertion reads the sentence a user reads rather than
 * the tags around it.
 *
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	return body(props)
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ');
}

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function body(props = {}) {
	return render(NetWorthChart, { props }).body;
}

describe('NetWorthChart', () => {
	it('says there is nothing to plot yet when no month has been recorded', () => {
		const rendered = text({ monthlyEntries: [] });

		expect(rendered).toContain('No snapshots yet');
		expect(rendered).not.toContain('months recorded');
	});

	it('renders without a monthlyEntries prop at all', () => {
		expect(text()).toContain('No snapshots yet');
	});

	it('explains that one snapshot is not yet a line, and shows its value', () => {
		const rendered = text({ monthlyEntries: [entry(3, 2026, { investments: [12_500] })] });

		expect(rendered).toContain('£12,500');
		expect(rendered).toContain('Mar 2026');
		expect(rendered).toContain('A line needs two months');
	});

	it('leads with the latest month, not the first', () => {
		const rendered = text({
			monthlyEntries: [
				entry(1, 2026, { investments: [10_000] }),
				entry(2, 2026, { investments: [40_000] })
			]
		});

		expect(rendered).toContain('£40,000');
		expect(rendered).toContain('at Feb 2026');
		expect(rendered).toContain('2 months recorded since Jan 2026');
	});

	it('nets excluded holdings and debts out of the headline figure', () => {
		const rendered = text({
			monthlyEntries: [
				entry(1, 2026, { investments: [10_000] }),
				createMonthlyEntry({
					month: 2,
					year: 2026,
					investments: [
						createInvestment({ value: 60_000 }),
						createInvestment({ value: 400_000, exclude_from_net_worth: true })
					],
					debts: [
						createDebt({ balance: 10_000, type: 'credit_card' }),
						createDebt({ balance: 250_000, type: 'mortgage', exclude_from_net_worth: true })
					]
				})
			]
		});

		expect(rendered).toContain('£50,000');
		expect(rendered).not.toContain('£460,000');
	});

	it('describes the shape of the line for a screen reader', () => {
		const rendered = body({
			monthlyEntries: [
				entry(1, 2026, { investments: [10_000] }),
				entry(2, 2026, { investments: [25_000] })
			]
		});

		expect(rendered).toContain('role="img"');
		expect(rendered).toContain('2 recorded months');
		expect(rendered).toContain('up £15,000');
	});

	it('says so when the line went down', () => {
		const rendered = body({
			monthlyEntries: [
				entry(1, 2026, { investments: [25_000] }),
				entry(2, 2026, { investments: [10_000] })
			]
		});

		expect(rendered).toContain('down £15,000');
	});

	it('names the months in UTC, not the runner time zone', () => {
		// A January snapshot built as a local-midnight date reads back as December anywhere west of
		// Greenwich — see `$lib/net-worth.js` convention 4. Both formatters here are pinned to UTC,
		// so the label is January wherever the test runs.
		const rendered = text({
			monthlyEntries: [entry(1, 2026, { investments: [1_000] })]
		});

		expect(rendered).toContain('Jan 2026');
		expect(rendered).not.toContain('Dec 2025');
	});

	it('tells the user what the chart leaves out', () => {
		const rendered = text({ monthlyEntries: [] });

		expect(rendered).toContain('excluded from net worth');
		expect(rendered).toContain('Months you skipped');
	});
});
