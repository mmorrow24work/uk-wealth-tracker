import { describe, expect, it } from 'vitest';

import { createDebt, createInvestment, createMonthlyEntry } from './model.js';
import { forecastFromEntries, forecastScenarios, projectScenario } from './forecast.js';
import {
	MONTH_TICK_TARGET,
	autoFilledPointCount,
	forecastBandSeries,
	monthStartDate,
	netWorthChartMonthTicks,
	netWorthChartXDomain,
	netWorthChartYExtent,
	netWorthMonthTicks,
	netWorthPoint,
	netWorthSeries,
	netWorthXDomain,
	netWorthYExtent
} from './net-worth.js';

/**
 * @param {number} month
 * @param {number} year
 * @param {{ investments?: number[], debts?: number[], auto_filled?: boolean }} [contents]
 * @returns {import('./types.js').MonthlyEntry}
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

describe('monthStartDate', () => {
	it('is UTC midnight on the 1st', () => {
		expect(monthStartDate({ month: 3, year: 2026 }).toISOString()).toBe('2026-03-01T00:00:00.000Z');
	});

	it('formats back to its own month in UTC, from any host time zone', () => {
		// The bug this exists to stop: `new Date(2026, 0, 1)` in, say, New York is
		// 2026-01-01T05:00:00Z, which formats back in UTC as January — but the same construction
		// *east* of Greenwich lands on 2025-12-31, and the label reads December. Asking for UTC on
		// both sides makes the label independent of where the browser is.
		const label = new Intl.DateTimeFormat('en-GB', {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(monthStartDate({ month: 1, year: 2026 }));

		expect(label).toBe('Jan 2026');
	});

	it('reads month/year off a forecast point unchanged', () => {
		const [anchor] = projectScenario({
			investments: [createInvestment({ value: 1000 })],
			start: { month: 11, year: 2026 },
			months: 0
		});

		expect(monthStartDate(anchor).toISOString()).toBe('2026-11-01T00:00:00.000Z');
	});
});

describe('netWorthPoint', () => {
	it('nets debts off investments', () => {
		const point = netWorthPoint(entry(4, 2026, { investments: [10_000, 5_000], debts: [2_000] }));

		expect(point.investments).toBe(15_000);
		expect(point.debts).toBe(2_000);
		expect(point.net_worth).toBe(13_000);
	});

	it('carries the calendar month and its UTC date', () => {
		const point = netWorthPoint(entry(4, 2026));

		expect(point.month).toBe(4);
		expect(point.year).toBe(2026);
		expect(point.date.toISOString()).toBe('2026-04-01T00:00:00.000Z');
	});

	it('drops a holding flagged exclude_from_net_worth', () => {
		const point = netWorthPoint(
			createMonthlyEntry({
				month: 4,
				year: 2026,
				investments: [
					createInvestment({ value: 10_000 }),
					createInvestment({ value: 400_000, exclude_from_net_worth: true })
				]
			})
		);

		expect(point.investments).toBe(10_000);
		expect(point.net_worth).toBe(10_000);
	});

	it('drops a mortgage flagged exclude_from_net_worth, as the D/I ratio does', () => {
		const point = netWorthPoint(
			createMonthlyEntry({
				month: 4,
				year: 2026,
				investments: [createInvestment({ value: 10_000 })],
				debts: [
					createDebt({ balance: 250_000, type: 'mortgage', exclude_from_net_worth: true }),
					createDebt({ balance: 1_500, type: 'credit_card' })
				]
			})
		);

		expect(point.debts).toBe(1_500);
		expect(point.net_worth).toBe(8_500);
	});

	it('rounds to whole pence, like a forecast point', () => {
		const point = netWorthPoint(entry(4, 2026, { investments: [0.005, 0.005], debts: [0.001] }));

		expect(point.investments).toBe(0.01);
		expect(point.debts).toBe(0);
		expect(point.net_worth).toBe(0.01);
	});

	it('never reports a negative zero', () => {
		const point = netWorthPoint(entry(4, 2026, { investments: [0], debts: [0] }));

		expect(Object.is(point.net_worth, -0)).toBe(false);
	});

	it('goes negative when the debts outweigh the holdings', () => {
		const point = netWorthPoint(entry(4, 2026, { investments: [1_000], debts: [30_000] }));

		expect(point.net_worth).toBe(-29_000);
	});

	it('records whether the month was auto-filled', () => {
		expect(netWorthPoint(entry(4, 2026)).auto_filled).toBe(false);
		expect(netWorthPoint(entry(4, 2026, { auto_filled: true })).auto_filled).toBe(true);
	});

	it('agrees with a zero-month forecast projected from the same position', () => {
		// Convention 3: #81 joins this series to `forecast.js`'s, so the shared field names must also
		// carry the same numbers — offset 0 of a forecast anchored on a month *is* that month.
		const recorded = createMonthlyEntry({
			month: 6,
			year: 2026,
			investments: [
				createInvestment({ value: 12_345.678 }),
				createInvestment({ value: 400_000, exclude_from_net_worth: true })
			],
			debts: [createDebt({ balance: 4_321.987 })]
		});
		const point = netWorthPoint(recorded);
		const [anchor] = projectScenario(
			{
				investments: recorded.investments,
				debts: recorded.debts,
				start: { month: recorded.month, year: recorded.year },
				months: 0
			},
			{}
		);

		expect(point.month).toBe(anchor.month);
		expect(point.year).toBe(anchor.year);
		expect(point.investments).toBe(anchor.investments);
		expect(point.debts).toBe(anchor.debts);
		expect(point.net_worth).toBe(anchor.net_worth);
	});
});

describe('netWorthSeries', () => {
	it('returns one point per recorded month', () => {
		const points = netWorthSeries([entry(1, 2026), entry(2, 2026), entry(3, 2026)]);
		expect(points).toHaveLength(3);
	});

	it('is empty when nothing has been recorded', () => {
		expect(netWorthSeries([])).toEqual([]);
	});

	it('sorts oldest first regardless of input order', () => {
		const points = netWorthSeries([entry(2, 2026), entry(12, 2025), entry(1, 2026)]);

		expect(points.map((point) => `${point.year}-${point.month}`)).toEqual([
			'2025-12',
			'2026-1',
			'2026-2'
		]);
	});

	it('does not interpolate a skipped month', () => {
		// Eighteen months between the two snapshots, and nothing invented in between: filling gaps
		// is AutoInvestFill's job, not the chart's.
		const points = netWorthSeries([
			entry(1, 2025, { investments: [10_000] }),
			entry(7, 2026, { investments: [20_000] })
		]);

		expect(points).toHaveLength(2);
		expect(points[1].date.getTime() - points[0].date.getTime()).toBeGreaterThan(
			500 * 24 * 60 * 60 * 1000
		);
	});

	it('does not mutate the array it was given', () => {
		const entries = [entry(2, 2026), entry(1, 2026)];
		netWorthSeries(entries);

		expect(entries.map((value) => value.month)).toEqual([2, 1]);
	});

	it('keeps two snapshots of the same month rather than merging them', () => {
		const points = netWorthSeries([
			entry(4, 2026, { investments: [1_000] }),
			entry(4, 2026, { investments: [2_000] })
		]);

		expect(points).toHaveLength(2);
	});
});

describe('netWorthXDomain', () => {
	it('runs from the first recorded month to the last', () => {
		const domain = netWorthXDomain(netWorthSeries([entry(3, 2026), entry(1, 2025)]));

		expect(domain?.[0].toISOString()).toBe('2025-01-01T00:00:00.000Z');
		expect(domain?.[1].toISOString()).toBe('2026-03-01T00:00:00.000Z');
	});

	it('is null when there is nothing to plot', () => {
		expect(netWorthXDomain([])).toBeNull();
	});

	it('widens a single month to the months either side', () => {
		const domain = netWorthXDomain(netWorthSeries([entry(1, 2026)]));

		expect(domain?.[0].toISOString()).toBe('2025-12-01T00:00:00.000Z');
		expect(domain?.[1].toISOString()).toBe('2026-02-01T00:00:00.000Z');
	});
});

describe('netWorthYExtent', () => {
	it('is null when there is nothing to plot', () => {
		expect(netWorthYExtent([])).toBeNull();
	});

	it('spans zero to just above the highest month by default', () => {
		const points = netWorthSeries([
			entry(1, 2026, { investments: [50_000] }),
			entry(2, 2026, { investments: [100_000] })
		]);

		expect(netWorthYExtent(points)).toEqual([0, 105_000]);
	});

	it('zooms to the data when includeZero is off', () => {
		const points = netWorthSeries([
			entry(1, 2026, { investments: [100_000] }),
			entry(2, 2026, { investments: [200_000] })
		]);

		expect(netWorthYExtent(points, { includeZero: false })).toEqual([95_000, 205_000]);
	});

	it('reaches below zero when net worth is negative, and pins the top at zero', () => {
		const points = netWorthSeries([
			entry(1, 2026, { debts: [10_000] }),
			entry(2, 2026, { debts: [5_000] })
		]);

		expect(netWorthYExtent(points)).toEqual([-10_500, 0]);
	});

	it('covers both sides when the history crosses zero', () => {
		const points = netWorthSeries([
			entry(1, 2026, { debts: [20_000] }),
			entry(2, 2026, { investments: [80_000] })
		]);

		expect(netWorthYExtent(points)).toEqual([-25_000, 85_000]);
	});

	it('gives a flat history a range rather than a single value', () => {
		const points = netWorthSeries([entry(1, 2026), entry(2, 2026)]);
		const extent = netWorthYExtent(points);

		expect(extent?.[0]).toBe(0);
		expect(extent?.[1]).toBeGreaterThan(0);
	});

	it('takes a custom padding fraction', () => {
		const points = netWorthSeries([entry(1, 2026, { investments: [100_000] })]);

		expect(netWorthYExtent(points, { padding: 0.2 })).toEqual([0, 120_000]);
	});
});

describe('netWorthMonthTicks', () => {
	/** @param {Date[]} ticks @returns {string[]} */
	const labels = (ticks) => ticks.map((tick) => tick.toISOString().slice(0, 7));

	it('is empty when there is nothing to plot', () => {
		expect(netWorthMonthTicks([])).toEqual([]);
	});

	it('labels the single month of a one-month history', () => {
		expect(labels(netWorthMonthTicks(netWorthSeries([entry(4, 2026)])))).toEqual(['2026-04']);
	});

	it('labels every month when they fit', () => {
		const points = netWorthSeries([entry(1, 2026), entry(2, 2026), entry(3, 2026)]);

		expect(labels(netWorthMonthTicks(points))).toEqual(['2026-01', '2026-02', '2026-03']);
	});

	it('thins the labels out over a long history, keeping first and last', () => {
		const points = netWorthSeries(
			Array.from({ length: 37 }, (_, index) =>
				entry((index % 12) + 1, 2020 + Math.floor(index / 12))
			)
		);
		const ticks = netWorthMonthTicks(points);

		expect(ticks.length).toBeLessThanOrEqual(MONTH_TICK_TARGET + 1);
		expect(labels(ticks).at(0)).toBe('2020-01');
		expect(labels(ticks).at(-1)).toBe('2023-01');
	});

	it('steps through the calendar, not through the recorded months', () => {
		// Two snapshots eighteen months apart: the axis is eighteen months wide, so its labels are
		// spread across those eighteen months rather than sitting on the only two points.
		const ticks = netWorthMonthTicks(netWorthSeries([entry(1, 2025), entry(7, 2026)]), { max: 4 });

		expect(labels(ticks)).toEqual(['2025-01', '2025-07', '2026-01', '2026-07']);
	});

	it('honours a smaller label budget', () => {
		const points = netWorthSeries(
			Array.from({ length: 24 }, (_, index) =>
				entry((index % 12) + 1, 2025 + Math.floor(index / 12))
			)
		);

		expect(netWorthMonthTicks(points, { max: 3 }).length).toBeLessThanOrEqual(4);
	});

	it('never places fewer than two labels on a multi-month history', () => {
		const points = netWorthSeries([entry(1, 2026), entry(12, 2026)]);

		expect(netWorthMonthTicks(points, { max: 0 }).length).toBeGreaterThanOrEqual(2);
	});

	it('always ends on the last recorded month', () => {
		for (const months of [5, 7, 11, 13, 29, 100]) {
			const points = netWorthSeries(
				Array.from({ length: months }, (_, index) =>
					entry((index % 12) + 1, 2020 + Math.floor(index / 12))
				)
			);
			const ticks = netWorthMonthTicks(points);

			expect(ticks.at(-1)?.getTime()).toBe(points.at(-1)?.date.getTime());
			expect(ticks.at(0)?.getTime()).toBe(points[0].date.getTime());
		}
	});
});

describe('forecastBandSeries', () => {
	/**
	 * A recorded history whose holding actually grows, so a forecast projected from it separates the
	 * three scenarios rather than drawing one flat line three times.
	 *
	 * @param {number} months How many months to record.
	 * @returns {import('./types.js').MonthlyEntry[]}
	 */
	function growingHistory(months = 3) {
		return Array.from({ length: months }, (_, index) =>
			createMonthlyEntry({
				month: index + 1,
				year: 2026,
				investments: [
					createInvestment({ value: 100_000 + index * 1_000, monthly_contribution: 500 })
				]
			})
		);
	}

	it('is empty when there is no forecast to plot', () => {
		expect(forecastBandSeries(null)).toEqual([]);
		expect(forecastBandSeries()).toEqual([]);
	});

	it('returns the anchor plus one point per projected month', () => {
		const forecast = forecastFromEntries(growingHistory(), { months: 12 });

		expect(forecastBandSeries(forecast)).toHaveLength(13);
	});

	it('starts exactly where the tracked line ends, to the penny', () => {
		// The join #67 and #81 both exist to keep seamless: offset 0 of every scenario is the anchor
		// position itself, which is the latest recorded month. A disagreement here draws a visible
		// step where the tracked line meets the forecast.
		const entries = growingHistory(4);
		const points = netWorthSeries(entries);
		const band = forecastBandSeries(forecastFromEntries(entries, { months: 6 }));
		const latest = points.at(-1);

		expect(band[0].date.getTime()).toBe(latest?.date.getTime());
		expect(band[0].low).toBe(latest?.net_worth);
		expect(band[0].mid).toBe(latest?.net_worth);
		expect(band[0].high).toBe(latest?.net_worth);
	});

	it('dates every month as a UTC month start, one month apart', () => {
		const band = forecastBandSeries(
			forecastScenarios({
				investments: [createInvestment({ value: 1_000 })],
				start: { month: 11, year: 2026 },
				months: 3
			})
		);

		expect(band.map((point) => point.date.toISOString().slice(0, 10))).toEqual([
			'2026-11-01',
			'2026-12-01',
			'2027-01-01',
			'2027-02-01'
		]);
	});

	it('carries the offset and calendar month of each projected point', () => {
		const band = forecastBandSeries(
			forecastScenarios({
				investments: [createInvestment({ value: 1_000 })],
				start: { month: 12, year: 2026 },
				months: 2
			})
		);

		expect(band.map((point) => point.offset)).toEqual([0, 1, 2]);
		expect(band.map((point) => `${point.year}-${point.month}`)).toEqual([
			'2026-12',
			'2027-1',
			'2027-2'
		]);
	});

	it('widens from a single point at the anchor as the scenarios diverge', () => {
		const band = forecastBandSeries(
			forecastFromEntries(growingHistory(), { months: 120 }, { growthRate: 5 })
		);

		expect(band[0].high - band[0].low).toBe(0);
		for (const point of band) {
			expect(point.low).toBeLessThanOrEqual(point.mid);
			expect(point.mid).toBeLessThanOrEqual(point.high);
		}
		const final = band.at(-1);
		expect((final?.high ?? 0) - (final?.low ?? 0)).toBeGreaterThan(0);
	});

	it('reads low/mid/high straight off the three scenarios', () => {
		const forecast = forecastScenarios(
			{
				investments: [createInvestment({ value: 50_000, monthly_contribution: 250 })],
				debts: [createDebt({ balance: 5_000 })],
				start: { month: 1, year: 2026 },
				months: 24
			},
			{ growthRate: 6 }
		);
		const band = forecastBandSeries(forecast);
		const last = band.length - 1;

		expect(band[last].low).toBe(forecast.series.pessimistic[last].net_worth);
		expect(band[last].mid).toBe(forecast.series.realistic[last].net_worth);
		expect(band[last].high).toBe(forecast.series.optimistic[last].net_worth);
	});
});

describe('netWorthChartXDomain', () => {
	/** @param {number} months @returns {import('./forecast.js').Forecast} */
	const forecastFrom = (months) =>
		forecastScenarios({
			investments: [createInvestment({ value: 10_000 })],
			start: { month: 3, year: 2026 },
			months
		});

	it('runs from the first recorded month to the last forecast month', () => {
		const points = netWorthSeries([entry(1, 2026), entry(2, 2026), entry(3, 2026)]);
		const domain = netWorthChartXDomain(points, forecastBandSeries(forecastFrom(24)));

		expect(domain?.[0].toISOString().slice(0, 10)).toBe('2026-01-01');
		expect(domain?.[1].toISOString().slice(0, 10)).toBe('2028-03-01');
	});

	it('is the tracked range when there is no forecast', () => {
		const points = netWorthSeries([entry(1, 2026), entry(3, 2026)]);

		expect(netWorthChartXDomain(points, [])).toEqual(netWorthXDomain(points));
	});

	it('plots a single snapshot without widening once a forecast runs from it', () => {
		const points = netWorthSeries([entry(3, 2026)]);
		const domain = netWorthChartXDomain(points, forecastBandSeries(forecastFrom(12)));

		expect(domain?.[0].toISOString().slice(0, 10)).toBe('2026-03-01');
		expect(domain?.[1].toISOString().slice(0, 10)).toBe('2027-03-01');
	});

	it('widens when the forecast has no months in it either', () => {
		const points = netWorthSeries([entry(3, 2026)]);
		const domain = netWorthChartXDomain(points, forecastBandSeries(forecastFrom(0)));

		expect(domain?.[0].toISOString().slice(0, 10)).toBe('2026-02-01');
		expect(domain?.[1].toISOString().slice(0, 10)).toBe('2026-04-01');
	});

	it('is null when there is nothing to plot at all', () => {
		expect(netWorthChartXDomain([], [])).toBeNull();
	});
});

describe('netWorthChartYExtent', () => {
	it('reaches the top of the band, not just the top of the history', () => {
		const entries = [
			createMonthlyEntry({
				month: 1,
				year: 2026,
				investments: [createInvestment({ value: 100_000, monthly_contribution: 1_000 })]
			})
		];
		const band = forecastBandSeries(forecastFromEntries(entries, { months: 240 }));
		const points = netWorthSeries(entries);
		const extent = netWorthChartYExtent(points, band);
		const highest = Math.max(...band.map((point) => point.high));

		expect(highest).toBeGreaterThan(100_000);
		expect(extent?.[1]).toBeGreaterThanOrEqual(highest);
		expect(netWorthYExtent(points)?.[1]).toBeLessThan(highest);
	});

	it('reaches the bottom of the band when the forecast is under water', () => {
		const entries = [
			createMonthlyEntry({
				month: 1,
				year: 2026,
				investments: [createInvestment({ value: 10_000 })],
				debts: [createDebt({ balance: 60_000 })]
			})
		];
		const band = forecastBandSeries(
			forecastFromEntries(entries, { months: 60 }, { growthRate: -5 })
		);
		const extent = netWorthChartYExtent(netWorthSeries(entries), band);
		const lowest = Math.min(...band.map((point) => point.low));

		expect(lowest).toBeLessThan(-50_000);
		expect(extent?.[0]).toBeLessThanOrEqual(lowest);
	});

	it('matches the tracked-only extent when there is no forecast', () => {
		const points = netWorthSeries([entry(1, 2026, { investments: [50_000] })]);

		expect(netWorthChartYExtent(points, [])).toEqual(netWorthYExtent(points));
	});

	it('plots a forecast even with no recorded history behind it', () => {
		const band = forecastBandSeries(
			forecastScenarios({
				investments: [createInvestment({ value: 20_000 })],
				start: { month: 1, year: 2026 },
				months: 12
			})
		);

		expect(netWorthChartYExtent([], band)?.[1]).toBeGreaterThan(20_000);
	});

	it('is null when neither series has anything in it', () => {
		expect(netWorthChartYExtent([], [])).toBeNull();
	});
});

describe('netWorthChartMonthTicks', () => {
	/** @param {Date[]} ticks @returns {string[]} */
	const labels = (ticks) => ticks.map((tick) => tick.toISOString().slice(0, 7));

	it('labels the whole span, history and forecast together', () => {
		const points = netWorthSeries([entry(1, 2026), entry(2, 2026), entry(3, 2026)]);
		const band = forecastBandSeries(
			forecastScenarios({
				investments: [createInvestment({ value: 1_000 })],
				start: { month: 3, year: 2026 },
				months: 120
			})
		);
		const ticks = netWorthChartMonthTicks(points, band);

		expect(labels(ticks).at(0)).toBe('2026-01');
		expect(labels(ticks).at(-1)).toBe('2036-03');
		expect(ticks.length).toBeLessThanOrEqual(MONTH_TICK_TARGET + 1);
	});

	it('matches the tracked-only ticks when there is no forecast', () => {
		const points = netWorthSeries([entry(1, 2025), entry(7, 2026)]);

		expect(netWorthChartMonthTicks(points, [], { max: 4 })).toEqual(
			netWorthMonthTicks(points, { max: 4 })
		);
	});

	it('is empty when there is nothing to plot', () => {
		expect(netWorthChartMonthTicks([], [])).toEqual([]);
	});
});

describe('autoFilledPointCount', () => {
	it('is zero for an empty series', () => {
		expect(autoFilledPointCount([])).toBe(0);
	});

	it('is zero when nothing was auto-filled', () => {
		const points = netWorthSeries([entry(1, 2026), entry(2, 2026)]);

		expect(autoFilledPointCount(points)).toBe(0);
	});

	it('counts only the points flagged auto_filled, not the whole series', () => {
		const points = netWorthSeries([
			entry(1, 2026),
			entry(2, 2026, { auto_filled: true }),
			entry(3, 2026, { auto_filled: true }),
			entry(4, 2026)
		]);

		expect(autoFilledPointCount(points)).toBe(2);
	});

	it('counts every point when the whole series was auto-filled', () => {
		const points = netWorthSeries([
			entry(1, 2026, { auto_filled: true }),
			entry(2, 2026, { auto_filled: true })
		]);

		expect(autoFilledPointCount(points)).toBe(2);
	});
});
