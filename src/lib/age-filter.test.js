import { describe, expect, it } from 'vitest';

import { createInvestment } from './model.js';
import { forecastScenarios } from './forecast.js';
import {
	DEFAULT_AGE_SUMMARY_STEP_YEARS,
	filterPointsByAge,
	forecastAgeBounds,
	summariseForecastByAge
} from './age-filter.js';

const JAN_2026 = { month: 1, year: 2026 };

/** @param {Partial<import('./types.js').Investment>} [overrides] */
function holding(overrides = {}) {
	return createInvestment({ id: 'inv_a', name: 'Global All Cap', value: 50_000, ...overrides });
}

/** Born January 1986: turns 40 in Jan 2026, the forecast's anchor month. */
const DOB_YEAR = 1986;
const DOB_MONTH = 1;

/** @param {object} [overrides] */
function fortyYearForecast(overrides = {}) {
	return forecastScenarios(
		{
			investments: [holding({ monthly_contribution: 500 })],
			start: JAN_2026,
			months: 360,
			...overrides
		},
		{ growthRate: 5 }
	);
}

/* -------------------------------------------------------------------------- */
/* filterPointsByAge                                                          */
/* -------------------------------------------------------------------------- */

describe('filterPointsByAge', () => {
	it('returns a copy of the points unchanged when neither bound is given', () => {
		const forecast = fortyYearForecast();
		const points = forecast.series.realistic;
		const filtered = filterPointsByAge(points, DOB_YEAR, DOB_MONTH, {});
		expect(filtered).toEqual(points);
		expect(filtered).not.toBe(points);
	});

	it('drops points before fromAge', () => {
		const forecast = fortyYearForecast();
		const filtered = filterPointsByAge(forecast.series.realistic, DOB_YEAR, DOB_MONTH, {
			fromAge: 45
		});
		expect(
			filtered.every((point) => point.year - DOB_YEAR - (point.month < DOB_MONTH ? 1 : 0) >= 45)
		).toBe(true);
		// Anchor (age 40) is excluded.
		expect(filtered.some((point) => point.offset === 0)).toBe(false);
	});

	it('drops points after toAge', () => {
		const forecast = fortyYearForecast();
		const filtered = filterPointsByAge(forecast.series.realistic, DOB_YEAR, DOB_MONTH, {
			toAge: 45
		});
		expect(filtered.length).toBeGreaterThan(0);
		expect(filtered.every((point) => point.year <= DOB_YEAR + 45)).toBe(true);
		// The final point (age 70) is excluded.
		expect(filtered.some((point) => point.offset === forecast.months)).toBe(false);
	});

	it('keeps only points within an inclusive [fromAge, toAge] window', () => {
		const forecast = fortyYearForecast();
		const filtered = filterPointsByAge(forecast.series.realistic, DOB_YEAR, DOB_MONTH, {
			fromAge: 50,
			toAge: 55
		});
		expect(filtered.length).toBeGreaterThan(0);
		for (const point of filtered) {
			const age = point.year - DOB_YEAR - (point.month < DOB_MONTH ? 1 : 0);
			expect(age).toBeGreaterThanOrEqual(50);
			expect(age).toBeLessThanOrEqual(55);
		}
	});

	it('returns an empty array when the window falls entirely outside the series', () => {
		const forecast = fortyYearForecast();
		const filtered = filterPointsByAge(forecast.series.realistic, DOB_YEAR, DOB_MONTH, {
			fromAge: 200,
			toAge: 210
		});
		expect(filtered).toEqual([]);
	});

	it('works on ForecastSummaryRow-shaped points too, not just ForecastPoint', () => {
		const rows = [
			{ month: 1, year: 2026, label: 'anchor' },
			{ month: 1, year: 2046, label: 'twenty years on' }
		];
		const filtered = filterPointsByAge(rows, DOB_YEAR, DOB_MONTH, { fromAge: 50 });
		expect(filtered).toEqual([{ month: 1, year: 2046, label: 'twenty years on' }]);
	});
});

/* -------------------------------------------------------------------------- */
/* forecastAgeBounds                                                          */
/* -------------------------------------------------------------------------- */

describe('forecastAgeBounds', () => {
	it('reports the age at the anchor and at the end of the horizon', () => {
		const forecast = fortyYearForecast({ months: 360 });
		const bounds = forecastAgeBounds(forecast, DOB_YEAR, DOB_MONTH);
		expect(bounds.minAge).toBe(40);
		expect(bounds.maxAge).toBe(70);
	});

	it('collapses to a single age when the forecast has a zero-month horizon', () => {
		const forecast = fortyYearForecast({ months: 0 });
		const bounds = forecastAgeBounds(forecast, DOB_YEAR, DOB_MONTH);
		expect(bounds.minAge).toBe(40);
		expect(bounds.maxAge).toBe(40);
	});

	it('is accurate to within a year when dobMonth is unknown', () => {
		const forecast = fortyYearForecast({ months: 360 });
		const bounds = forecastAgeBounds(forecast, DOB_YEAR, null);
		expect(bounds.minAge).toBe(40);
		expect(bounds.maxAge).toBe(70);
	});
});

/* -------------------------------------------------------------------------- */
/* summariseForecastByAge                                                     */
/* -------------------------------------------------------------------------- */

describe('summariseForecastByAge', () => {
	it('returns an empty table when dobYear is not known', () => {
		const forecast = fortyYearForecast();
		expect(summariseForecastByAge(forecast, null, null, { fromAge: 50, toAge: 60 })).toEqual([]);
	});

	it('produces one row per year of age within the requested range by default', () => {
		const forecast = fortyYearForecast();
		const rows = summariseForecastByAge(forecast, DOB_YEAR, DOB_MONTH, { fromAge: 50, toAge: 55 });

		expect(DEFAULT_AGE_SUMMARY_STEP_YEARS).toBe(1);
		const ages = rows.map((row) => row.year - DOB_YEAR);
		expect(ages).toEqual([50, 51, 52, 53, 54, 55]);
	});

	it('clamps a range that reaches past the forecast horizon rather than returning nothing', () => {
		const forecast = fortyYearForecast({ months: 120 }); // anchor 40 .. horizon 50
		const rows = summariseForecastByAge(forecast, DOB_YEAR, DOB_MONTH, { fromAge: 45, toAge: 90 });

		expect(rows.length).toBeGreaterThan(0);
		expect(rows.at(0)?.year).toBe(DOB_YEAR + 45);
		expect(rows.at(-1)?.year).toBe(DOB_YEAR + 50);
	});

	it('clamps a range that starts before the anchor age', () => {
		const forecast = fortyYearForecast({ months: 120 });
		const rows = summariseForecastByAge(forecast, DOB_YEAR, DOB_MONTH, { fromAge: 10, toAge: 42 });
		expect(rows.at(0)?.year).toBe(DOB_YEAR + 40);
	});

	it('returns an empty table when toAge is before fromAge after clamping', () => {
		const forecast = fortyYearForecast({ months: 120 });
		const rows = summariseForecastByAge(forecast, DOB_YEAR, DOB_MONTH, {
			fromAge: 200,
			toAge: 210
		});
		expect(rows).toEqual([]);
	});

	it('defaults to the full forecast age span when no range is given', () => {
		const forecast = fortyYearForecast({ months: 360 });
		const rows = summariseForecastByAge(forecast, DOB_YEAR, DOB_MONTH);
		expect(rows.at(0)?.year).toBe(DOB_YEAR + 40);
		expect(rows.at(-1)?.year).toBe(DOB_YEAR + 70);
	});

	it('never yields two rows for the same age when the range is a single age', () => {
		const forecast = fortyYearForecast({ months: 360 });
		const rows = summariseForecastByAge(forecast, DOB_YEAR, DOB_MONTH, { fromAge: 50, toAge: 50 });
		expect(rows).toHaveLength(1);
		expect(rows[0].year - DOB_YEAR).toBe(50);
	});

	it('still shows the range edge when toAge falls between step boundaries', () => {
		const forecast = fortyYearForecast({ months: 300 }); // anchor 40 .. horizon 65
		const rows = summariseForecastByAge(
			forecast,
			DOB_YEAR,
			DOB_MONTH,
			{ fromAge: 40, toAge: 53 },
			{ stepYears: 5 }
		);
		const ages = rows.map((row) => row.year - DOB_YEAR);
		// 40, 45, 50 land on the 5-year cadence; 53 (the requested edge) isn't on the cadence but is
		// still shown, since otherwise the last three years of the requested window would be invisible.
		expect(ages).toEqual([40, 45, 50, 53]);
	});

	it('honours a wider stepYears', () => {
		const forecast = fortyYearForecast({ months: 240 });
		const rows = summariseForecastByAge(
			forecast,
			DOB_YEAR,
			DOB_MONTH,
			{ fromAge: 40, toAge: 60 },
			{ stepYears: 5 }
		);
		const ages = rows.map((row) => row.year - DOB_YEAR);
		expect(ages).toEqual([40, 45, 50, 55, 60]);
	});

	it('rows carry net worth for all three scenarios, matching forecastSummaryRow shape', () => {
		const forecast = fortyYearForecast();
		const rows = summariseForecastByAge(forecast, DOB_YEAR, DOB_MONTH, { fromAge: 50, toAge: 50 });
		expect(rows).toHaveLength(1);
		const [row] = rows;
		expect(row.net_worth.pessimistic).toBeLessThanOrEqual(row.net_worth.realistic);
		expect(row.net_worth.realistic).toBeLessThanOrEqual(row.net_worth.optimistic);
		expect(row.contributions).toBeGreaterThan(0);
	});
});
