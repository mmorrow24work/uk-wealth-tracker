/**
 * Tests for the Monte Carlo fan chart (issue #153).
 *
 * Same approach and same limits as the other charted components here: `svelte/server`'s `render`
 * gives the component's *initial* markup, and a `<Chart>` measures its container via
 * `ResizeObserver` before it draws anything — there is no container to measure under
 * `svelte/server`, so nothing inside `<Chart>` renders and no `<Area>`, `<Spline>` or `<Rule>` path
 * can be asserted here. That is exactly why every piece of arithmetic this chart does lives in the
 * component's `<script module>` block as a pure function; the first six describe blocks below test
 * those directly, and the render tests cover the states, the legend, the caption and the table
 * fallback, which are ordinary markup outside `<Chart>`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { simulateRetirement } from '$lib/monte-carlo.js';
import MonteCarloFanChart, {
	fanChartAgeTicks,
	fanChartRetirementMarker,
	fanChartSeries,
	fanChartState,
	fanChartSummaryText,
	fanChartTableRows,
	fanChartXDomain,
	fanChartYDomain
} from './MonteCarloFanChart.svelte';

/**
 * One rung of a hand-built band, in the shape `simulateRetirement()` produces.
 *
 * @param {number} year
 * @param {number} age
 * @param {Record<string, number>} percentiles
 * @returns {import('$lib/monte-carlo.js').MonteCarloBandPoint}
 */
function bandPoint(year, age, percentiles) {
	return {
		year,
		age,
		month: 4,
		calendarYear: 2026 + year,
		percentiles,
		median: percentiles.p50 ?? 0,
		mean: percentiles.p50 ?? 0,
		min: percentiles.p5 ?? 0,
		max: percentiles.p95 ?? 0,
		depletedPaths: 0,
		depletedShare: 0
	};
}

/**
 * A minimal summary carrying only what this component reads — `band`, `input.retirementAge` and
 * `paths`. Hand-built rather than simulated so a test can state the exact spread it is asserting
 * about; `realSummary()` below covers the shape the real engine actually emits.
 *
 * @param {import('$lib/monte-carlo.js').MonteCarloBandPoint[]} band
 * @param {{ retirementAge?: number, paths?: number }} [options]
 * @returns {import('$lib/monte-carlo.js').MonteCarloSummary}
 */
function summaryWith(band, options = {}) {
	const { retirementAge = 67, paths = 5000 } = options;
	return /** @type {import('$lib/monte-carlo.js').MonteCarloSummary} */ (
		/** @type {unknown} */ ({ band, paths, input: { retirementAge } })
	);
}

/**
 * A four-rung band ages 40–43, widening as it goes — enough to plot, small enough to assert on.
 *
 * @returns {import('$lib/monte-carlo.js').MonteCarloBandPoint[]}
 */
function wideningBand() {
	return [
		bandPoint(0, 40, { p5: 100, p25: 100, p50: 100, p75: 100, p95: 100 }),
		bandPoint(1, 41, { p5: 90, p25: 105, p50: 120, p75: 140, p95: 170 }),
		bandPoint(2, 42, { p5: 80, p25: 110, p50: 145, p75: 190, p95: 260 }),
		bandPoint(3, 43, { p5: 60, p25: 115, p50: 175, p75: 250, p95: 400 })
	];
}

/**
 * A real run of the engine, small enough to be quick — the shape assertions that matter are that
 * `band` really does carry `percentiles.p5`…`p95` under those keys and that a real fan widens.
 *
 * @returns {import('$lib/monte-carlo.js').MonteCarloSummary}
 */
function realSummary() {
	return simulateRetirement({
		paths: 200,
		currentAge: 40,
		retirementAge: 60,
		targetAge: 80,
		pensionPot: 250_000,
		pensionContribution: 500,
		targetIncome: 20_000
	});
}

describe('fanChartSeries', () => {
	it('is empty for no summary at all', () => {
		expect(fanChartSeries(null)).toEqual([]);
		expect(fanChartSeries(undefined)).toEqual([]);
	});

	it('is empty for a summary with no band on it', () => {
		expect(fanChartSeries(/** @type {never} */ (/** @type {unknown} */ ({ paths: 5000 })))).toEqual(
			[]
		);
	});

	it('flattens percentiles.pN onto the point, keeping year, age and calendar year', () => {
		const series = fanChartSeries(summaryWith(wideningBand()));

		expect(series).toHaveLength(4);
		expect(series[0]).toEqual({
			year: 0,
			age: 40,
			calendarYear: 2026,
			p5: 100,
			p25: 100,
			median: 100,
			p75: 100,
			p95: 100
		});
		expect(series[3]).toEqual({
			year: 3,
			age: 43,
			calendarYear: 2029,
			p5: 60,
			p25: 115,
			median: 175,
			p75: 250,
			p95: 400
		});
	});

	it('reads the median off the point rather than off percentiles.p50', () => {
		// `MonteCarloBandPoint` carries `median` as a field in its own right — "named for the callers
		// that only want the middle" — so that is the documented place to read it from, with
		// `percentiles.p50` only the fallback for a band built without one.
		const band = [
			bandPoint(0, 40, { p5: 10, p25: 20, p75: 40, p95: 50 }),
			bandPoint(1, 41, { p5: 10, p25: 20, p75: 40, p95: 50 })
		];
		band[0].median = 33;
		band[1].median = 34;

		const series = fanChartSeries(summaryWith(band));
		expect(series.map((point) => point.median)).toEqual([33, 34]);
	});

	it('substitutes zero for a missing or non-finite percentile rather than emitting NaN', () => {
		const band = [
			bandPoint(0, 40, { p5: Number.NaN, p50: 100, p95: 200 }),
			bandPoint(1, 41, { p50: 110, p95: 220 })
		];

		const series = fanChartSeries(summaryWith(band));
		for (const point of series) {
			for (const value of [point.p5, point.p25, point.median, point.p75, point.p95]) {
				expect(Number.isFinite(value)).toBe(true);
			}
		}
		expect(series[0].p5).toBe(0);
		expect(series[1].p25).toBe(0);
	});

	it('never lets a lower percentile sit above a higher one, so an Area cannot render inside out', () => {
		// Not something the engine emits — `percentileOf` is monotonic — but an `<Area>` given
		// `y0 > y1` draws a wrong chart rather than no chart, so the guard is worth having.
		const band = [
			bandPoint(0, 40, { p5: 500, p25: 100, p50: 50, p75: 25, p95: 10 }),
			bandPoint(1, 41, { p5: 500, p25: 100, p50: 50, p75: 25, p95: 10 })
		];

		const [point] = fanChartSeries(summaryWith(band));
		expect(point.p5).toBeLessThanOrEqual(point.p25);
		expect(point.p25).toBeLessThanOrEqual(point.median);
		expect(point.median).toBeLessThanOrEqual(point.p75);
		expect(point.p75).toBeLessThanOrEqual(point.p95);
	});

	it('reads a real simulateRetirement() band, which widens with age', () => {
		const summary = realSummary();
		const series = fanChartSeries(summary);

		expect(series).toHaveLength(summary.band.length);
		expect(series[0].age).toBe(40);
		expect(series[0].p5).toBe(series[0].p95); // today's pot is one known figure every path shares

		const early = series[5];
		const late = series[series.length - 1];
		expect(late.p95 - late.p5).toBeGreaterThan(early.p95 - early.p5);
	});
});

describe('fanChartState', () => {
	it('reads no_summary with nothing to draw from', () => {
		expect(fanChartState(null, [])).toBe('no_summary');
		expect(fanChartState(undefined, [])).toBe('no_summary');
	});

	it('reads no_summary for an object carrying no band', () => {
		const summary = /** @type {never} */ (/** @type {unknown} */ ({ paths: 5000 }));
		expect(fanChartState(summary, [])).toBe('no_summary');
	});

	it('reads no_plot for a single rung, since a band needs two ages to open out over', () => {
		const band = [bandPoint(0, 40, { p5: 1, p25: 2, p50: 3, p75: 4, p95: 5 })];
		const summary = summaryWith(band);
		expect(fanChartState(summary, fanChartSeries(summary))).toBe('no_plot');
	});

	it('reads all_zero when every percentile at every age is zero', () => {
		const band = [
			bandPoint(0, 40, { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 }),
			bandPoint(1, 41, { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 }),
			bandPoint(2, 42, { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 })
		];
		const summary = summaryWith(band);
		expect(fanChartState(summary, fanChartSeries(summary))).toBe('all_zero');
	});

	it('reads ready when any age has any money at the top of the band', () => {
		// The whole fan sits at zero except the top of one rung — still something to draw.
		const band = [
			bandPoint(0, 40, { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 }),
			bandPoint(1, 41, { p5: 0, p25: 0, p50: 0, p75: 0, p95: 5 }),
			bandPoint(2, 42, { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 })
		];
		const summary = summaryWith(band);
		expect(fanChartState(summary, fanChartSeries(summary))).toBe('ready');
	});

	it('reads ready off a real run', () => {
		const summary = realSummary();
		expect(fanChartState(summary, fanChartSeries(summary))).toBe('ready');
	});
});

describe('fanChartXDomain', () => {
	it('runs from the first plotted age to the last', () => {
		expect(fanChartXDomain(fanChartSeries(summaryWith(wideningBand())))).toEqual([40, 43]);
	});

	it('gives a one-year span rather than a zero-width one for a single age', () => {
		const band = [bandPoint(0, 40, { p5: 1, p50: 2, p95: 3 })];
		expect(fanChartXDomain(fanChartSeries(summaryWith(band)))).toEqual([40, 41]);
	});

	it('falls back to a usable domain for an empty series', () => {
		expect(fanChartXDomain([])).toEqual([0, 1]);
	});
});

describe('fanChartYDomain', () => {
	it('starts at zero, because zero is depletion rather than an arbitrary floor', () => {
		const [low] = fanChartYDomain(fanChartSeries(summaryWith(wideningBand())));
		expect(low).toBe(0);
	});

	it('tops out just above the highest percentile drawn', () => {
		const [, high] = fanChartYDomain(fanChartSeries(summaryWith(wideningBand())));
		expect(high).toBeCloseTo(400 * 1.05, 6);
	});

	it('never returns a zero-height domain, even for an all-zero band', () => {
		const band = [
			bandPoint(0, 40, { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 }),
			bandPoint(1, 41, { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 })
		];
		const [low, high] = fanChartYDomain(fanChartSeries(summaryWith(band)));
		expect(low).toBe(0);
		expect(high).toBeGreaterThan(0);
	});

	it('covers a median that somehow sits above the top of its own band', () => {
		const band = [bandPoint(0, 40, { p5: 0, p25: 0, p75: 0, p95: 0 })];
		band[0].median = 900;
		const [, high] = fanChartYDomain(fanChartSeries(summaryWith(band)));
		expect(high).toBeGreaterThanOrEqual(900);
	});
});

describe('fanChartAgeTicks', () => {
	it('always labels both ends', () => {
		const series = fanChartSeries(summaryWith(realSummary().band));
		const ticks = fanChartAgeTicks(series, 60);

		expect(ticks[0]).toBe(40);
		expect(ticks.at(-1)).toBe(80);
	});

	it('labels the retirement age, so the marker sits under a tick a reader can name', () => {
		const series = fanChartSeries(summaryWith(realSummary().band));
		expect(fanChartAgeTicks(series, 60)).toContain(60);
	});

	it('keeps the ticks sorted and free of duplicates', () => {
		const series = fanChartSeries(summaryWith(realSummary().band));
		const ticks = fanChartAgeTicks(series, 61);

		expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
		expect(new Set(ticks).size).toBe(ticks.length);
	});

	it('drops an even tick that would print on top of the retirement marker', () => {
		// Ages 40-80 at a target of 7 gives a step of 7: 40, 47, 54, 61, 68, 75, 80. A marker at 62 is
		// one year off the 61 tick, so 61 goes and 62 takes its place.
		const series = fanChartSeries(summaryWith(realSummary().band));
		const ticks = fanChartAgeTicks(series, 62);

		expect(ticks).toContain(62);
		expect(ticks).not.toContain(61);
	});

	it('drops an even tick that would print on top of an end', () => {
		// The case the browser drive found: ages 40-95 at a target of 7 gives a step of 9, whose last
		// even tick is 94 — one year short of the target age, and unreadable next to it.
		const summary = simulateRetirement({
			paths: 20,
			currentAge: 40,
			retirementAge: 60,
			targetAge: 95,
			pensionPot: 100_000,
			targetIncome: 10_000
		});
		const ticks = fanChartAgeTicks(fanChartSeries(summary), 60);

		expect(ticks).toEqual([40, 49, 60, 67, 76, 85, 95]);
	});

	it('leaves the ticks even when there is no retirement marker to anchor on', () => {
		const series = fanChartSeries(summaryWith(realSummary().band));
		expect(fanChartAgeTicks(series, null)).toEqual([40, 47, 54, 61, 68, 75, 80]);
	});

	it('gives one tick for a single age and none for an empty series', () => {
		const band = [bandPoint(0, 40, { p5: 1, p50: 2, p95: 3 })];
		expect(fanChartAgeTicks(fanChartSeries(summaryWith(band)), null)).toEqual([40]);
		expect(fanChartAgeTicks([], null)).toEqual([]);
	});
});

describe('fanChartRetirementMarker', () => {
	it('marks a retirement age inside the plotted range', () => {
		const summary = summaryWith(wideningBand(), { retirementAge: 42 });
		expect(fanChartRetirementMarker(summary, fanChartSeries(summary))).toBe(42);
	});

	it('marks nothing when retirement is at the first plotted age — already retired', () => {
		const summary = summaryWith(wideningBand(), { retirementAge: 40 });
		expect(fanChartRetirementMarker(summary, fanChartSeries(summary))).toBeNull();
	});

	it('marks nothing when retirement is at or past the last plotted age', () => {
		const summary = summaryWith(wideningBand(), { retirementAge: 43 });
		expect(fanChartRetirementMarker(summary, fanChartSeries(summary))).toBeNull();

		const beyond = summaryWith(wideningBand(), { retirementAge: 70 });
		expect(fanChartRetirementMarker(beyond, fanChartSeries(beyond))).toBeNull();
	});

	it('marks nothing without a summary, a retirement age, or a plottable series', () => {
		expect(fanChartRetirementMarker(null, fanChartSeries(summaryWith(wideningBand())))).toBeNull();

		const noAge = /** @type {never} */ (
			/** @type {unknown} */ ({ band: wideningBand(), paths: 1, input: {} })
		);
		expect(fanChartRetirementMarker(noAge, fanChartSeries(noAge))).toBeNull();

		const oneRung = summaryWith([bandPoint(0, 40, { p5: 1, p50: 2, p95: 3 })], {
			retirementAge: 40
		});
		expect(fanChartRetirementMarker(oneRung, fanChartSeries(oneRung))).toBeNull();
	});
});

describe('fanChartTableRows', () => {
	it('lists five-yearly ages, counted on the age rather than on the row index', () => {
		const summary = summaryWith(realSummary().band); // ages 40-80
		const rows = fanChartTableRows(fanChartSeries(summary));

		expect(rows.map((row) => row.age)).toEqual([40, 45, 50, 55, 60, 65, 70, 75, 80]);
	});

	it('always keeps today and the target age, whether or not they fall on a multiple of five', () => {
		const summary = simulateRetirement({
			paths: 50,
			currentAge: 41,
			retirementAge: 60,
			targetAge: 72,
			pensionPot: 100_000,
			targetIncome: 10_000
		});
		const ages = fanChartTableRows(fanChartSeries(summary)).map((row) => row.age);

		expect(ages[0]).toBe(41);
		expect(ages.at(-1)).toBe(72);
		expect(ages).toContain(45);
	});

	it('never repeats a row when an end also lands on a multiple of five', () => {
		const summary = summaryWith(realSummary().band);
		const rows = fanChartTableRows(fanChartSeries(summary));

		expect(new Set(rows.map((row) => row.age)).size).toBe(rows.length);
	});

	it('honours a different step', () => {
		const summary = summaryWith(realSummary().band);
		expect(fanChartTableRows(fanChartSeries(summary), 10).map((row) => row.age)).toEqual([
			40, 50, 60, 70, 80
		]);
	});

	it('is empty for an empty series', () => {
		expect(fanChartTableRows([])).toEqual([]);
	});
});

describe('fanChartSummaryText', () => {
	it('says nothing is simulated yet when there is no summary', () => {
		expect(fanChartSummaryText(null, [])).toContain('Nothing simulated yet');
	});

	it('names the age range, the calendar years and the starting pot', () => {
		const summary = summaryWith(wideningBand(), { retirementAge: 42, paths: 5000 });
		const text = fanChartSummaryText(summary, fanChartSeries(summary));

		expect(text).toContain('5,000 paths');
		expect(text).toContain('age 40 in 2026');
		expect(text).toContain('age 43 in 2029');
		expect(text).toContain('Starting pot £100');
	});

	it('reads the spread at retirement and at the target age', () => {
		const summary = summaryWith(wideningBand(), { retirementAge: 42 });
		const text = fanChartSummaryText(summary, fanChartSeries(summary));

		expect(text).toContain('At retirement, age 42: median £145');
		expect(text).toContain('between £80 and £260');
		expect(text).toContain('At age 43: median £175');
		expect(text).toContain('between £60 and £400');
	});

	it('skips the retirement sentence when retirement falls outside the plotted ages', () => {
		const summary = summaryWith(wideningBand(), { retirementAge: 70 });
		expect(fanChartSummaryText(summary, fanChartSeries(summary))).not.toContain('At retirement');
	});

	it('talks about shares of paths, never about a single path', () => {
		const summary = summaryWith(wideningBand(), { retirementAge: 42 });
		const text = fanChartSummaryText(summary, fanChartSeries(summary));

		expect(text).toContain('paths at each age');
		expect(text).toContain('9 paths in 10');
		expect(text).not.toMatch(/\bthe worst path\b/);
	});
});

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
	return render(MonteCarloFanChart, { props }).body;
}

describe('MonteCarloFanChart', () => {
	it('says nothing is simulated yet with no summary, and with no props at all', () => {
		expect(text({ summary: null })).toContain('Nothing simulated yet');
		expect(text()).toContain('Nothing simulated yet');
	});

	it('spells out that a band is a spread rather than one retirement', () => {
		const rendered = text({ summary: summaryWith(wideningBand()) });

		expect(rendered).toContain('not anybody');
		expect(rendered).toContain(
			'the path that is among the worst at 70 is a different path from the one that is among the worst at 90'
		);
	});

	it('explains a single-year run rather than drawing a fan across one age', () => {
		const summary = summaryWith([bandPoint(0, 40, { p5: 1, p25: 2, p50: 3, p75: 4, p95: 5 })]);
		const rendered = text({ summary });

		expect(rendered).toContain('covers a single year');
		expect(rendered).not.toContain('Show as a table');
	});

	it('explains an all-zero band instead of plotting a flat line along the axis', () => {
		const band = [
			bandPoint(0, 40, { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 }),
			bandPoint(1, 41, { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 })
		];
		const rendered = text({ summary: summaryWith(band) });

		expect(rendered).toContain('no pension pot or ISA pot recorded');
		expect(rendered).toContain('promised income alone');
		expect(rendered).not.toContain('Show as a table');
	});

	it('names all three bands in the legend', () => {
		const rendered = text({ summary: summaryWith(wideningBand(), { retirementAge: 42 }) });

		expect(rendered).toContain('Median');
		expect(rendered).toContain('Middle 50% of paths');
		expect(rendered).toContain('Middle 90% of paths');
	});

	it('names the retirement age in the legend and the caption when it falls inside the range', () => {
		const rendered = text({ summary: summaryWith(wideningBand(), { retirementAge: 42 }) });

		expect(rendered).toContain('Retirement at 42');
		expect(rendered).toContain('where contributions stop and drawdown begins');
	});

	it('leaves the retirement marker out entirely when it falls outside the range', () => {
		const rendered = text({ summary: summaryWith(wideningBand(), { retirementAge: 70 }) });

		expect(rendered).not.toContain('Retirement at');
		expect(rendered).not.toContain('drawdown begins');
	});

	it('captions the plotted ages and their calendar years', () => {
		const rendered = text({ summary: summaryWith(wideningBand()) });
		expect(rendered).toContain('Ages 40–43 (2026–2029)');
	});

	it('hands a screen reader the summary as the image label', () => {
		const rendered = body({ summary: summaryWith(wideningBand(), { retirementAge: 42 }) });

		expect(rendered).toContain('role="img"');
		expect(rendered).toContain('At retirement, age 42');
	});

	it('lists five-yearly ages in the table fallback, each with its calendar year', () => {
		const rendered = text({ summary: summaryWith(realSummary().band, { retirementAge: 60 }) });

		expect(rendered).toContain('Show as a table');
		expect(rendered).toContain('Worst 5% below');
		expect(rendered).toContain('Best 5% above');
		// Age 45 is a five-yearly row; 46 is not.
		expect(rendered).toContain('45 · 2031');
		expect(rendered).not.toContain('46 · 2032');
	});

	it('says in the table caption that a column is a percentile and not a path', () => {
		const rendered = text({ summary: summaryWith(wideningBand()) });
		expect(rendered).toContain('not a single path followed down the table');
	});

	it('renders a real simulateRetirement() summary end to end', () => {
		const rendered = text({ summary: realSummary() });

		expect(rendered).toContain('Ages 40–80');
		expect(rendered).toContain('Retirement at 60');
		expect(rendered).toContain('Show as a table');
	});
});
