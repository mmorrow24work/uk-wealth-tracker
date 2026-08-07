/**
 * Server-rendered smoke tests for the net worth chart — the tracked line (issue #67), the forecast
 * confidence band overlaid on it (issue #81), the point markers/caption/table fallback on top of
 * both (issue #82), and the hover tooltip's wording (issue #87).
 *
 * Same approach and same limits as the other component tests here: `svelte/server`'s `render` gives
 * the component's *initial* markup, which is enough to assert the empty states, the headline figure,
 * the legend and the accessible summary a screen reader is handed. It deliberately does not assert
 * anything inside `<Chart>` — a `<Chart>` measures its container via `ResizeObserver` before it draws
 * anything, there is no container to measure under `svelte/server` (no DOM, no browser), and `<Chart>`
 * renders nothing at all until that measurement resolves. That rules out asserting the `Circle`
 * markers' markup here the way #67/#81 couldn't assert the `Spline`/`Area` paths'; the marker logic is
 * covered where it can be, in `$lib/net-worth.test.js` (`autoFilledPointCount`) and in a real browser
 * (see the journal entry). The caption and table fallback below are ordinary markup outside `<Chart>`,
 * so they render and assert normally here.
 *
 * #87's hover tooltip is the same limitation one step further on: a tooltip with no pointer over it
 * renders as nothing at all, so there is not even an empty element to assert against. Its words are
 * therefore `netWorthTooltipReading`, a pure function exported from the component's `<script module>`
 * block, and the last describe block below tests that directly.
 */
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

import { createDebt, createInvestment, createMonthlyEntry } from '$lib/model.js';
import { netWorthPoint } from '$lib/net-worth.js';
import NetWorthChart, { netWorthTooltipReading } from './NetWorthChart.svelte';

/**
 * @param {number} month
 * @param {number} year
 * @param {{ investments?: number[], debts?: number[], auto_filled?: boolean }} [contents]
 * @returns {import('$lib/types.js').MonthlyEntry}
 */
function entry(month, year, contents = {}) {
	const { investments = [], debts = [], auto_filled = false } = contents;
	return createMonthlyEntry({
		month,
		year,
		auto_filled,
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
		// With the forecast switched off a single snapshot really is unplottable — a one-point spline
		// draws nothing — so this is still the #67 empty state.
		const rendered = text({
			monthlyEntries: [entry(3, 2026, { investments: [12_500] })],
			showForecast: false
		});

		expect(rendered).toContain('£12,500');
		expect(rendered).toContain('Mar 2026');
		expect(rendered).toContain('A line needs two months');
	});

	it('plots the forecast from a single snapshot rather than refusing to draw', () => {
		const rendered = text({ monthlyEntries: [entry(3, 2026, { investments: [12_500] })] });

		expect(rendered).toContain('what you see plotted is the forecast from this one');
		expect(rendered).not.toContain('A line needs two months');
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

describe('NetWorthChart forecast overlay', () => {
	/** @returns {import('$lib/types.js').MonthlyEntry[]} */
	function history() {
		return [entry(1, 2026, { investments: [100_000] }), entry(2, 2026, { investments: [101_000] })];
	}

	it('names all three series, so identity is never colour alone', () => {
		const rendered = text({ monthlyEntries: history() });

		expect(rendered).toContain('Tracked');
		expect(rendered).toContain('Realistic (5%)');
		expect(rendered).toContain('Pessimistic–optimistic (3%–7%)');
	});

	it('shifts the scenario rates with the growth rate and spread it is given', () => {
		const rendered = text({ monthlyEntries: history(), growthRate: 6, spread: 3 });

		expect(rendered).toContain('Realistic (6%)');
		expect(rendered).toContain('Pessimistic–optimistic (3%–9%)');
		expect(rendered).toContain('6% a year, give or take 3 percentage points');
	});

	it('says which snapshot the forecast is projected from', () => {
		const rendered = text({ monthlyEntries: history() });

		expect(rendered).toContain('Projected from your Feb 2026 snapshot');
		expect(rendered).toContain('Illustrative only');
	});

	it('offers the horizon picker, defaulting to the horizon it was given', () => {
		const rendered = body({ monthlyEntries: history(), forecastYears: 20 });

		expect(rendered).toContain('Show forecast');
		expect(rendered).toContain('20 years');
		// Svelte marks the bound option as selected in the server render.
		expect(rendered).toMatch(/<option[^>]*selected[^>]*>20 years/);
	});

	it('describes the band, not just the line, for a screen reader', () => {
		const rendered = body({ monthlyEntries: history(), forecastYears: 10 });

		expect(rendered).toContain('Forecast to Feb 2036');
		expect(rendered).toContain('realistic at 5% a year');
		expect(rendered).toContain('pessimistic to');
		expect(rendered).toContain('optimistic.');
	});

	it('drops the overlay, the legend and the summary sentence when it is switched off', () => {
		const rendered = body({ monthlyEntries: history(), showForecast: false });

		expect(rendered).not.toContain('Projected from your');
		expect(rendered).not.toContain('Pessimistic–optimistic');
		expect(rendered).not.toContain('Forecast to');
		// The tracked line is still there, and so is the switch to bring the forecast back.
		expect(rendered).toContain('2 months recorded since Jan 2026');
		expect(rendered).toContain('Show forecast');
	});

	it('offers nothing to forecast from before the first snapshot', () => {
		const rendered = text({ monthlyEntries: [] });

		expect(rendered).not.toContain('Show forecast');
		expect(rendered).not.toContain('Projected from your');
	});
});

describe('NetWorthChart auto-filled caption', () => {
	it('says nothing when no month was auto-filled', () => {
		const rendered = text({
			monthlyEntries: [
				entry(1, 2026, { investments: [10_000] }),
				entry(2, 2026, { investments: [20_000] })
			]
		});

		expect(rendered).not.toContain('auto-filled by the auto-invest projection');
	});

	it('counts exactly the auto-filled months, singular phrasing for one', () => {
		const rendered = text({
			monthlyEntries: [
				entry(1, 2026, { investments: [10_000] }),
				entry(2, 2026, { investments: [20_000], auto_filled: true }),
				entry(3, 2026, { investments: [30_000] })
			]
		});

		expect(rendered).toContain('1 of the 3 months shown was auto-filled');
		expect(rendered).toContain('hollow marker');
	});

	it('uses plural phrasing for more than one auto-filled month', () => {
		const rendered = text({
			monthlyEntries: [
				entry(1, 2026, { investments: [10_000], auto_filled: true }),
				entry(2, 2026, { investments: [20_000], auto_filled: true }),
				entry(3, 2026, { investments: [30_000] })
			]
		});

		expect(rendered).toContain('2 of the 3 months shown were auto-filled');
	});
});

describe('NetWorthChart table fallback', () => {
	it('offers no table when there is nothing recorded', () => {
		const rendered = text({ monthlyEntries: [] });

		expect(rendered).not.toContain('Show as a table');
	});

	it('lists every recorded month with its figures and auto-filled status', () => {
		const rendered = text({
			monthlyEntries: [
				entry(1, 2026, { investments: [100_000], debts: [10_000] }),
				entry(2, 2026, { investments: [105_000], debts: [10_000], auto_filled: true })
			],
			showForecast: false
		});

		expect(rendered).toContain('Show as a table');
		expect(rendered).toContain('Month');
		expect(rendered).toContain('Investments');
		expect(rendered).toContain('Debts');
		expect(rendered).toContain('Net worth');
		expect(rendered).toContain('Auto-filled');
		expect(rendered).toContain('Jan 2026');
		expect(rendered).toContain('£100,000');
		expect(rendered).toContain('£90,000');
		expect(rendered).toContain('Feb 2026');
		expect(rendered).toContain('£95,000');
		expect(rendered).toContain('Yes');
		expect(rendered).toContain('No');
	});

	it('offers the table even for a single recorded month with no plot', () => {
		const rendered = text({
			monthlyEntries: [entry(3, 2026, { investments: [12_500] })],
			showForecast: false
		});

		expect(rendered).toContain('A line needs two months');
		expect(rendered).toContain('Show as a table');
		expect(rendered).toContain('Mar 2026');
	});
});

describe('netWorthTooltipReading', () => {
	/**
	 * A plotted point, built through `netWorthPoint` rather than as an object literal — the tooltip
	 * reads whatever the chart plots, so the test should read the same shape the chart is handed.
	 *
	 * @param {number} month
	 * @param {number} year
	 * @param {{ investments?: number[], debts?: number[], auto_filled?: boolean }} [contents]
	 * @returns {import('$lib/net-worth.js').NetWorthPoint}
	 */
	function point(month, year, contents = {}) {
		return netWorthPoint(entry(month, year, contents));
	}

	it('leads with net worth, then what it is made of', () => {
		// A reading that gave only the difference would make this month look identical to a £5,000
		// month with no debts at all.
		const reading = netWorthTooltipReading(
			point(3, 2026, { investments: [305_000], debts: [300_000] })
		);

		expect(reading?.heading).toBe('Mar 2026');
		expect(reading?.rows).toEqual([
			{ label: 'Net worth', value: '£5,000', color: 'hsl(var(--chart-1))' },
			{ label: 'Investments', value: '£305,000' },
			{ label: 'Debts', value: '£300,000' }
		]);
	});

	it('gives a swatch only to the row the line actually plots', () => {
		const rows = netWorthTooltipReading(point(3, 2026, { investments: [1_000] }))?.rows ?? [];

		expect(rows.filter((row) => row.color)).toHaveLength(1);
		expect(rows[0].color).toBe('hsl(var(--chart-1))');
	});

	it('names an auto-filled month in words, not just as a hollow marker', () => {
		const filled = netWorthTooltipReading(
			point(6, 2026, { investments: [20_000], auto_filled: true })
		);
		const recorded = netWorthTooltipReading(point(6, 2026, { investments: [20_000] }));

		expect(filled?.heading).toBe('Jun 2026 · auto-filled');
		expect(recorded?.heading).toBe('Jun 2026');
	});

	it('names the month in UTC, not in the reader time zone', async () => {
		// The trap `$lib/net-worth.js` convention 4 describes: a January month start is UTC midnight
		// on the 1st, which anywhere west of Greenwich is still the previous December locally. The
		// formatter is pinned to UTC, so the heading has to read January in every zone — and since
		// CI runs in UTC, the only way to actually exercise that is to re-import the module under a
		// negative-offset zone. `Intl` reads `process.env.TZ` when a formatter is constructed, and
		// this component builds its formatters at module scope, so resetting the registry first is
		// what makes the re-import pick up the new zone.
		const original = process.env.TZ;
		process.env.TZ = 'America/Los_Angeles';
		vi.resetModules();

		try {
			expect(
				new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(
					new Date(Date.UTC(2026, 0, 1))
				)
			).toBe('Dec 2025'); // the wrong answer this test exists to rule out

			// Awaited inside the `try`, so the module is evaluated while `TZ` is still the wrong one.
			const module = await import('./NetWorthChart.svelte');

			expect(module.netWorthTooltipReading(point(1, 2026, { investments: [1_000] }))?.heading).toBe(
				'Jan 2026'
			);
		} finally {
			process.env.TZ = original;
			vi.resetModules();
		}
	});

	it('reads a zero-debt month as £0 rather than dropping the row', () => {
		const reading = netWorthTooltipReading(point(4, 2026, { investments: [40_000] }));

		expect(reading?.rows.map((row) => row.value)).toEqual(['£40,000', '£40,000', '£0']);
	});

	it('reads an underwater month as a negative net worth', () => {
		const reading = netWorthTooltipReading(
			point(4, 2026, { investments: [5_000], debts: [12_000] })
		);

		expect(reading?.rows[0].value).toBe('-£7,000');
		expect(reading?.rows[2].value).toBe('£12,000');
	});

	it('says nothing when no month is hovered', () => {
		expect(netWorthTooltipReading(null)).toBeNull();
		expect(netWorthTooltipReading(undefined)).toBeNull();
	});

	it('says nothing rather than £NaN when handed something that is not a recorded month', () => {
		// The failure the two-`<Chart>` split exists to prevent: a forecast band point has
		// `low`/`mid`/`high` where this wants `net_worth`. It should not reach here at all — this is
		// the guard that keeps the symptom out of the UI if it ever does.
		const bandPoint = /** @type {any} */ ({
			month: 4,
			year: 2026,
			date: new Date(Date.UTC(2026, 3, 1)),
			low: 1,
			mid: 2,
			high: 3
		});

		expect(netWorthTooltipReading(bandPoint)).toBeNull();
	});
});
