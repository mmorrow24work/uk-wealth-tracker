/**
 * Unit and server-rendered smoke tests for the shortfall/terminal-pot breakdown beneath the Monte
 * Carlo headline (issues #154 and #218).
 *
 * `monteCarloShortfallState`/`monteCarloShortfallRows`/`monteCarloTerminalRows` are pure functions
 * exported from the component's `<script module>` block, the same split `NetWorthChart.test.js`
 * tests `netWorthTooltipReading` with — they get direct unit tests against hand-built fixtures first,
 * since a hand-built fixture pins down exactly which figure produced which row, then a handful of
 * `svelte/server` render tests (same limits as `MonteCarloSimulator.test.js`: initial markup only,
 * which is all this component ever shows) confirm the four states wire together end to end, including
 * one against a real `simulateRetirement()` output rather than a fixture.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { simulateRetirement } from '$lib/monte-carlo.js';
import MonteCarloOutcomes, {
	monteCarloShortfallRows,
	monteCarloShortfallState,
	monteCarloTerminalRows
} from './MonteCarloOutcomes.svelte';

/**
 * A minimal, fully-controlled `MonteCarloSummary` fixture — only the handful of fields this
 * component actually reads (`input.targetAge`, `guaranteed`, `paths`, `shortfall`, `terminal`), cast
 * to the real type rather than built out via `simulateRetirement()`, so each test's expected numbers
 * are the ones the fixture states rather than whatever a particular seed happens to produce.
 *
 * @param {object} [overrides]
 * @returns {import('$lib/monte-carlo.js').MonteCarloSummary}
 */
function fixtureSummary(overrides = {}) {
	return /** @type {import('$lib/monte-carlo.js').MonteCarloSummary} */ (
		/** @type {unknown} */ ({
			input: { targetAge: 95 },
			paths: 5_000,
			guaranteed: false,
			shortfall: {
				paths: 800,
				probability: 0.16,
				earliestAge: 72,
				medianFirstAge: 78.4,
				meanFirstAge: 79.1,
				meanYears: 6.2,
				medianTotal: 45_000
			},
			terminal: {
				mean: 320_000,
				median: 210_000,
				percentiles: {
					p5: 0,
					p10: 5_000,
					p25: 60_000,
					p50: 210_000,
					p75: 480_000,
					p90: 720_000,
					p95: 900_000
				},
				depletedShare: 0.16
			},
			...overrides
		})
	);
}

describe('monteCarloShortfallState', () => {
	it('reads no_summary when there is nothing to explain yet', () => {
		expect(monteCarloShortfallState(null)).toBe('no_summary');
		expect(monteCarloShortfallState(undefined)).toBe('no_summary');
	});

	it('reads guaranteed when the promised income alone covers every retirement year', () => {
		expect(monteCarloShortfallState(fixtureSummary({ guaranteed: true }))).toBe('guaranteed');
	});

	it('reads no_shortfall when every path funded the plan in full', () => {
		const summary = fixtureSummary();
		summary.shortfall.paths = 0;
		expect(monteCarloShortfallState(summary)).toBe('no_shortfall');
	});

	it('reads shortfall for the ordinary case', () => {
		expect(monteCarloShortfallState(fixtureSummary())).toBe('shortfall');
	});

	it('checks guaranteed ahead of shortfall.paths, since a guaranteed plan has no failures either', () => {
		const summary = fixtureSummary({ guaranteed: true });
		summary.shortfall.paths = 0;
		expect(monteCarloShortfallState(summary)).toBe('guaranteed');
	});
});

describe('monteCarloShortfallRows', () => {
	it('formats every figure, all of it conditional on failure', () => {
		const rows = Object.fromEntries(
			monteCarloShortfallRows(fixtureSummary()).map((row) => [row.label, row.value])
		);

		expect(rows['Paths that fell short']).toBe('16.0% (800 of 5,000)');
		expect(rows['Earliest shortfall']).toBe('age 72');
		expect(rows['Median first shortfall, given a shortfall happens']).toBe('age 78');
		expect(rows['Mean years short, given a shortfall happens']).toBe('6.2 years');
		expect(rows['Median total missed, given a shortfall happens']).toBe('£45,000');
	});

	it('never renders "age 0" or NaN when no path recorded a first shortfall age', () => {
		const summary = fixtureSummary();
		summary.shortfall.earliestAge = null;
		summary.shortfall.medianFirstAge = null;

		const rows = Object.fromEntries(
			monteCarloShortfallRows(summary).map((row) => [row.label, row.value])
		);

		expect(rows['Earliest shortfall']).toBe('—');
		expect(rows['Median first shortfall, given a shortfall happens']).toBe('—');
		expect(Object.values(rows).join(' ')).not.toContain('age 0');
		expect(Object.values(rows).join(' ')).not.toContain('NaN');
	});
});

describe('monteCarloTerminalRows', () => {
	it('formats the mean, median, percentile spread and depleted share', () => {
		const rows = Object.fromEntries(
			monteCarloTerminalRows(fixtureSummary()).map((row) => [row.label, row.value])
		);

		expect(rows['Mean']).toBe('£320,000');
		expect(rows['Median']).toBe('£210,000');
		expect(rows['Middle 50% (25th–75th percentile)']).toBe('£60,000 – £480,000');
		expect(rows['Middle 90% (5th–95th percentile)']).toBe('£0 – £900,000');
		expect(rows['Paths with nothing left']).toBe('16.0%');
	});

	it('reads mean well above median on a right-skewed fixture, without collapsing them', () => {
		const rows = Object.fromEntries(
			monteCarloTerminalRows(fixtureSummary()).map((row) => [row.label, row.value])
		);

		expect(rows['Mean']).not.toBe(rows['Median']);
	});

	it('describes a depleted majority plainly — a £0 median alongside a depletedShare near 1', () => {
		const summary = fixtureSummary({
			terminal: {
				mean: 8_000,
				median: 0,
				percentiles: { p5: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 15_000, p95: 90_000 },
				depletedShare: 0.92
			}
		});

		const rows = Object.fromEntries(
			monteCarloTerminalRows(summary).map((row) => [row.label, row.value])
		);

		expect(rows['Median']).toBe('£0');
		expect(rows['Paths with nothing left']).toBe('92.0%');
	});

	it('formats a zero-depletion fixture without a stray 0.0% row', () => {
		const summary = fixtureSummary();
		summary.terminal.depletedShare = 0;

		const rows = Object.fromEntries(
			monteCarloTerminalRows(summary).map((row) => [row.label, row.value])
		);

		expect(rows['Paths with nothing left']).toBe('0.0%');
	});
});

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(MonteCarloOutcomes, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('MonteCarloOutcomes', () => {
	it('says nothing has run yet rather than showing a blank card', () => {
		const body = text();
		expect(body).toContain('Once there is a plan to simulate');
		expect(body).not.toContain('Paths that fell short');
		expect(body).not.toContain('Pot left at age');
	});

	it('shows the guaranteed message instead of an empty shortfall table, but still shows the pot', () => {
		const body = text({ summary: fixtureSummary({ guaranteed: true }) });
		expect(body).toContain('nothing here for the market to break');
		expect(body).not.toContain('Paths that fell short');
		// The promised income being guaranteed says nothing about what is left in the pot itself.
		expect(body).toContain('Pot left at age 95');
		expect(body).toContain('£320,000');
	});

	it('shows the no-shortfall message when every path funded the plan in full', () => {
		const summary = fixtureSummary();
		summary.shortfall.paths = 0;
		const body = text({ summary });

		expect(body).toContain('funded every retirement year in full');
		expect(body).not.toContain('Paths that fell short');
	});

	it('shows the shortfall and terminal breakdown for the ordinary case', () => {
		const body = text({ summary: fixtureSummary() });

		expect(body).toContain('Paths that fell short');
		expect(body).toContain('16.0% (800 of 5,000)');
		expect(body).toContain('Pot left at age 95');
		expect(body).toContain('£320,000');
		expect(body).toContain('conditional on a shortfall happening');
	});

	it('spells out a depleted majority in prose rather than leaving a bare £0 row', () => {
		const summary = fixtureSummary({
			terminal: {
				mean: 8_000,
				median: 0,
				percentiles: { p5: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 15_000, p95: 90_000 },
				depletedShare: 0.92
			}
		});
		const body = text({ summary });

		expect(body).toContain('Most paths ended with nothing left');
		expect(body).toContain('92.0%');
	});

	it('does not editorialise about a depleted majority when most paths still have money left', () => {
		const body = text({ summary: fixtureSummary() });
		expect(body).not.toContain('Most paths ended with nothing left');
	});

	it('renders a real simulateRetirement summary end to end', () => {
		const summary = simulateRetirement({
			currentAge: 40,
			retirementAge: 60,
			targetAge: 95,
			pensionPot: 250_000,
			isaPot: 100_000,
			targetIncome: 30_000,
			growthRate: 5,
			volatility: 15,
			paths: 500
		});

		const body = text({ summary });
		expect(body).toContain('Paths that fell short');
		expect(body).toContain(`Pot left at age ${summary.input.targetAge}`);
	});

	it('describes a real guaranteed plan with no market to break, and still shows a real pot', () => {
		const summary = simulateRetirement({
			currentAge: 67,
			retirementAge: 67,
			targetAge: 90,
			targetIncome: 12_000,
			streams: [{ id: 'sp', label: 'State Pension', annualIncome: 12_000, startAge: 60 }],
			paths: 20
		});

		const body = text({ summary });
		expect(body).toContain('nothing here for the market to break');
		expect(body).toContain('Pot left at age 90');
	});
});
