/**
 * Retirement age marker + net worth milestone pills — README.md → "Forecast": "Retirement
 * milestone marker on chart" and "Future net worth milestones (£100k, £250k, £500k, £1M) as
 * chart pills" (issue #18).
 *
 * Both markers are the same operation performed on a {@link import('./forecast.js').Forecast}:
 * walk a scenario's points forward and report the first one that satisfies a condition (a net
 * worth threshold, or an age). Four conventions decide what the numbers mean:
 *
 * 1. **"Achieved" and "already reached" are checked once, not per scenario.** `forecast.js`'s own
 *    convention is that offset 0 is the anchor position, identical across all three series — so a
 *    milestone already crossed, or a retirement age already reached, is read off the anchor
 *    directly rather than off whichever scenario happens to be passed in.
 * 2. **The retirement date is calendar-driven, not growth-driven.** All three scenario series
 *    share the same `start`/`months` (`forecast.js` → {@link import('./forecast.js').forecastScenarios}),
 *    so age at a given offset is identical across scenarios — only the net worth at that date
 *    differs. The date is therefore found once (off the realistic series, arbitrarily — any
 *    scenario's series has the same offsets), and the net worth at that date is reported for all
 *    three scenarios, the same low/mid/high shape {@link import('./forecast.js').forecastBand} uses.
 * 3. **Age is calendar-year/month arithmetic, not a duration.** `Profile` stores `dob_year` and an
 *    optional `dob_month` (no day — README.md's data model deliberately keeps less personal data
 *    than a full date of birth), so age in a given forecast month is exact when `dob_month` is
 *    known and accurate to within a year when it isn't.
 * 4. **This is not README.md's separate "Milestones" section.** That section (custom milestones,
 *    £10k/£25k/£50k tiers, progress bars, achieved chips shown "off chart") is a bigger feature
 *    covering the whole net worth dashboard. This module only covers the four amounts the
 *    "Forecast" section names as chart pills, plus the retirement age line.
 */

/**
 * The four amounts README.md's "Forecast" section names as chart pills, smallest first.
 *
 * @type {readonly number[]}
 */
export const STANDARD_NET_WORTH_MILESTONES = Object.freeze([100_000, 250_000, 500_000, 1_000_000]);

/**
 * A milestone pill's label. £1,000,000 → "£1M", £250,000 → "£250k" — the shorthand README.md's
 * own list uses. Falls back to a full formatted amount for anything that isn't a round thousand,
 * since a custom milestone amount (README.md's separate "Milestones" section) could pass one in
 * even though the four standard amounts here never will.
 *
 * @param {number} amount
 * @returns {string}
 */
export function formatMilestoneLabel(amount) {
	if (amount !== 0 && amount % 1_000_000 === 0) {
		return `£${amount / 1_000_000}M`;
	}
	if (amount !== 0 && amount % 1_000 === 0) {
		return `£${amount / 1_000}k`;
	}
	return `£${amount.toLocaleString('en-GB')}`;
}

/**
 * The first point in an ascending-offset series that satisfies `predicate`, or `null` if none
 * does within the series' horizon.
 *
 * @template T
 * @param {readonly T[]} points
 * @param {(point: T) => boolean} predicate
 * @returns {T | null}
 */
function firstMatch(points, predicate) {
	return points.find(predicate) ?? null;
}

/**
 * The first point in one scenario at which net worth reaches `amount`.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @param {number} amount
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @returns {import('./forecast.js').ForecastPoint | null}
 */
export function netWorthCrossing(forecast, amount, scenario = 'realistic') {
	return firstMatch(forecast.series[scenario], (point) => point.net_worth >= amount);
}

/**
 * One milestone pill's data: whether it's already been reached, and where each scenario's line
 * crosses it (`null` if a scenario never reaches it within the forecast horizon).
 *
 * @typedef {object} MilestoneCrossing
 * @property {number} amount
 * @property {string} label
 * @property {boolean} achieved Already reached as of the anchor (offset 0) — true in every
 *   scenario, since the anchor is shared.
 * @property {import('./forecast.js').ForecastPoint | null} pessimistic
 * @property {import('./forecast.js').ForecastPoint | null} realistic
 * @property {import('./forecast.js').ForecastPoint | null} optimistic
 */

/**
 * @param {import('./forecast.js').Forecast} forecast
 * @param {number} amount
 * @returns {MilestoneCrossing}
 */
export function milestoneCrossing(forecast, amount) {
	const anchorNetWorth = forecast.series.realistic[0]?.net_worth ?? 0;
	return {
		amount,
		label: formatMilestoneLabel(amount),
		achieved: anchorNetWorth >= amount,
		pessimistic: netWorthCrossing(forecast, amount, 'pessimistic'),
		realistic: netWorthCrossing(forecast, amount, 'realistic'),
		optimistic: netWorthCrossing(forecast, amount, 'optimistic')
	};
}

/**
 * The chart pills for a set of milestone amounts, in the order given.
 *
 * @param {import('./forecast.js').Forecast} forecast
 * @param {readonly number[]} [amounts] Defaults to {@link STANDARD_NET_WORTH_MILESTONES}.
 * @returns {MilestoneCrossing[]}
 */
export function milestoneCrossings(forecast, amounts = STANDARD_NET_WORTH_MILESTONES) {
	return amounts.map((amount) => milestoneCrossing(forecast, amount));
}

/**
 * Age in whole years at a forecast point. Exact when `dobMonth` is known (birthday not yet
 * reached this calendar year knocks a year off); otherwise a plain year difference, which is
 * accurate to within a year either way.
 *
 * @param {number} dobYear
 * @param {number | null} dobMonth
 * @param {{ year: number, month: number }} point
 * @returns {number}
 */
export function ageAtPoint(dobYear, dobMonth, point) {
	if (dobMonth == null) return point.year - dobYear;
	return point.year - dobYear - (point.month < dobMonth ? 1 : 0);
}

/**
 * Where the retirement age marker sits on the chart: the date the user reaches
 * `profile.retirement_age`, and net worth at that date under all three scenarios.
 *
 * @typedef {object} RetirementMarker
 * @property {boolean} available `false` when `profile.dob_year` isn't recorded — there is no age
 *   to plot without it.
 * @property {number} retirementAge
 * @property {number | null} dobYear
 * @property {number | null} dobMonth
 * @property {boolean} alreadyReached Already at or past retirement age as of the anchor.
 * @property {import('./forecast.js').ForecastPoint | null} point The point the marker sits at, or
 *   `null` if retirement age falls beyond the forecast horizon.
 * @property {{ pessimistic: number, realistic: number, optimistic: number } | null} netWorth Net
 *   worth at `point` under each scenario, or `null` when `point` is `null`.
 */

/**
 * @param {import('./forecast.js').Forecast} forecast
 * @param {import('./types.js').Profile} profile
 * @returns {RetirementMarker}
 */
export function retirementMarker(forecast, profile) {
	const { dob_year: dobYear, dob_month: dobMonth, retirement_age: retirementAge } = profile;

	if (dobYear == null) {
		return {
			available: false,
			retirementAge,
			dobYear: null,
			dobMonth: null,
			alreadyReached: false,
			point: null,
			netWorth: null
		};
	}

	const realistic = forecast.series.realistic;
	const anchor = realistic[0];
	const alreadyReached = anchor ? ageAtPoint(dobYear, dobMonth, anchor) >= retirementAge : false;
	const point = firstMatch(realistic, (p) => ageAtPoint(dobYear, dobMonth, p) >= retirementAge);

	return {
		available: true,
		retirementAge,
		dobYear,
		dobMonth,
		alreadyReached,
		point,
		netWorth: point
			? {
					pessimistic: forecast.series.pessimistic[point.offset]?.net_worth ?? point.net_worth,
					realistic: point.net_worth,
					optimistic: forecast.series.optimistic[point.offset]?.net_worth ?? point.net_worth
				}
			: null
	};
}
