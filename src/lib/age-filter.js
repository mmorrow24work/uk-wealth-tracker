/**
 * Age-range zoom/filter for the forecast — README.md → "Forecast": "Age filter (zoom forecast to
 * specific age range)" (issue #19).
 *
 * Like #18's milestone markers before it, this is a chart-adjacent feature with no chart to zoom
 * yet: the net worth chart itself (tracked line + confidence band, README.md → "Net Worth
 * Tracking") is #12, still open. So this module does the part that doesn't need a chart to exist —
 * work out which forecast points fall inside a `[fromAge, toAge]` window off `Profile.dob_year`/
 * `dob_month` — against plain `ForecastPoint`/`ForecastSummaryRow`-shaped arrays, the same
 * forward-compatible pattern `milestones.js` used: #12 can filter the series it feeds a chart's
 * x-axis domain with {@link filterPointsByAge} directly, instead of reinventing age-window math.
 *
 * Two conventions:
 *
 * 1. **Filtering narrows what's shown, it does not reproject anything.** A `ForecastPoint` outside
 *    the age window is simply dropped from the array handed to a table or (eventually) a chart; the
 *    underlying `Forecast` and its scenario arithmetic are untouched, so milestone crossings and the
 *    retirement marker (`milestones.js`) keep reading the full, unfiltered forecast and stay correct
 *    regardless of what age window the display is currently zoomed to.
 * 2. **Age needs a birth year.** Same as {@link import('./milestones.js').retirementMarker}: without
 *    `Profile.dob_year` there is no age to filter by, so the age-aware entry points here either
 *    return everything unfiltered or an explicit "unavailable" shape rather than guessing an age.
 */

import { ageAtPoint } from './milestones.js';
import { forecastSummaryRow } from './forecast.js';

/**
 * An age window to zoom/filter to. Either end left `null`/omitted is unbounded on that side, so
 * "from age 55 onward" and "up to age 40" are both expressible without a sentinel value.
 *
 * @typedef {object} AgeRange
 * @property {number | null} [fromAge]
 * @property {number | null} [toAge]
 */

/**
 * Keep only the points whose age at that point falls within `range` (inclusive on both ends).
 * Works on any point carrying `month`/`year` — `ForecastPoint`, `ForecastBandPoint` and
 * `ForecastSummaryRow` all qualify — so the same filter serves this module's own
 * {@link summariseForecastByAge} today and #12's chart series once it exists.
 *
 * @template {{ month: number, year: number }} T
 * @param {readonly T[]} points
 * @param {number} dobYear
 * @param {number | null} dobMonth
 * @param {AgeRange} [range]
 * @returns {T[]}
 */
export function filterPointsByAge(points, dobYear, dobMonth, range = {}) {
	const { fromAge, toAge } = range;
	if (fromAge == null && toAge == null) return [...points];

	return points.filter((point) => {
		const age = ageAtPoint(dobYear, dobMonth, point);
		if (fromAge != null && age < fromAge) return false;
		if (toAge != null && age > toAge) return false;
		return true;
	});
}

/**
 * The age range a forecast actually spans: the user's age at the anchor (offset 0) and at the end
 * of the projected horizon. The bounds an "age range" UI control should offer as its min/max, and
 * what {@link summariseForecastByAge} clamps a requested range to — a `toAge` of 90 against a
 * forecast that only runs to age 75 is not an error, it is just clamped to what the forecast has.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @param {number} dobYear
 * @param {number | null} dobMonth
 * @returns {{ minAge: number, maxAge: number }}
 */
export function forecastAgeBounds(forecast, dobYear, dobMonth) {
	const realistic = forecast.series.realistic;
	const anchor = realistic[0];
	const final = realistic.at(-1) ?? anchor;
	return {
		minAge: ageAtPoint(dobYear, dobMonth, anchor),
		maxAge: ageAtPoint(dobYear, dobMonth, final)
	};
}

/** Default spacing, in years of age, between rows {@link summariseForecastByAge} returns. */
export const DEFAULT_AGE_SUMMARY_STEP_YEARS = 1;

/**
 * The scenario summary table's equivalent of "zoom the chart to an age range" (issue #19):
 * {@link import('./forecast.js').summariseForecast}'s counterpart when the horizons wanted are
 * "every year of age from 55 to 65", not a fixed set of years-from-now.
 *
 * `range` is clamped to what the forecast actually covers ({@link forecastAgeBounds}), so a range
 * that reaches past the horizon is trimmed rather than producing an empty table. One row is emitted
 * per `stepYears` of age reached (the first month that age is reached), and — mirroring
 * {@link import('./forecast.js').summariseForecast}'s "always end where the projection does" rule —
 * the last point inside the (clamped) range is appended too when its age isn't already covered,
 * so a `toAge` that falls between two step boundaries (e.g. `stepYears: 5` and `toAge: 53`) still
 * shows the range's true edge. It is *not* appended when it shares an age already shown (`toAge`
 * itself, or the month before a birthday), so filtering to a single age never yields two rows that
 * both say the same age.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @param {number | null} dobYear `null` (birth year not recorded) returns an empty table — there is
 *   no age to filter by, matching {@link import('./milestones.js').retirementMarker}'s convention.
 * @param {number | null} dobMonth
 * @param {AgeRange} [range]
 * @param {{ stepYears?: number }} [options]
 * @returns {import('./forecast.js').ForecastSummaryRow[]}
 */
export function summariseForecastByAge(forecast, dobYear, dobMonth, range = {}, options = {}) {
	if (dobYear == null) return [];

	const stepYears = Math.max(1, options.stepYears ?? DEFAULT_AGE_SUMMARY_STEP_YEARS);
	const bounds = forecastAgeBounds(forecast, dobYear, dobMonth);
	const fromAge = range.fromAge != null ? Math.max(range.fromAge, bounds.minAge) : bounds.minAge;
	const toAge = range.toAge != null ? Math.min(range.toAge, bounds.maxAge) : bounds.maxAge;
	if (toAge < fromAge) return [];

	const inRange = filterPointsByAge(forecast.series.realistic, dobYear, dobMonth, {
		fromAge,
		toAge
	});
	if (inRange.length === 0) return [];

	/** @type {import('./forecast.js').ForecastPoint[]} */
	const chosen = [];
	let nextAge = fromAge;
	for (const point of inRange) {
		const age = ageAtPoint(dobYear, dobMonth, point);
		if (age >= nextAge) {
			chosen.push(point);
			nextAge = age + stepYears;
		}
	}

	const last = inRange.at(-1);
	const lastChosenAge =
		chosen.length > 0 ? ageAtPoint(dobYear, dobMonth, chosen[chosen.length - 1]) : null;
	if (last && ageAtPoint(dobYear, dobMonth, last) !== lastChosenAge) chosen.push(last);

	return chosen.map((point) => forecastSummaryRow(forecast, point));
}
