/**
 * Income shock overlay — README.md → "Advanced Scenarios": "Income shock (job loss, illness)"
 * (issue #133).
 *
 * `forecast.js` answers "what if the long-run average were higher or lower?" and `stress-test.js`
 * (issue #21) answers "what if the market falls off a cliff?". This module answers a third, unrelated
 * question: "what if *I* stop being able to pay in for a while?" — a job loss or a spell of illness
 * that cuts or stops contributions for a stated period, with an optional ramp back to normal for
 * illness recoveries that taper rather than snap back. Exactly like the stress test, it is built as a
 * `forecast.js` `adjustMonth` overlay rather than a second projector, so it is this module's own
 * arithmetic with a few months' worth of contributions scaled down, not a walker that could drift from
 * the baseline.
 *
 * Four conventions decide what the numbers mean, mirroring `stress-test.js`'s own:
 *
 * 1. **A shocked forecast *is* a `Forecast`.** {@link incomeShockForecast} returns the same shape
 *    `forecastScenarios` does, with the config it was built from attached as `shock` — so every reader
 *    of a `Forecast` (`forecastBand`, `summariseForecast`, `milestoneCrossings`, `compounding.js`)
 *    reads a shocked projection unchanged.
 * 2. **An income shock changes the standing order, not the market.** The opposite of `stress-test.js`'s
 *    convention 5 ("a crash changes the market, not the standing order"): every holding still compounds
 *    at exactly the scenario's growth rate throughout, so the only thing that differs from the baseline
 *    is how much gets paid in. That is what `ForecastMonthAdjustment.contributionFactor` is for —
 *    `forecast.js` scales the month's contribution by it instead of touching growth.
 * 3. **The drop is a flat rate for a stated number of months, then — optionally — a ramp back.**
 *    `dropPct` (0–100) is how much of each holding's contribution is missing for `durationMonths`
 *    starting at `atMonth` — `100` stops contributions outright (a clean job loss), `50` halves them
 *    (working reduced hours through illness). `rampMonths` then linearly recovers the contribution
 *    from the dropped level back to normal — a return to full income that tapers rather than snaps, for
 *    an illness that gets better gradually. `rampMonths: 0` is a job loss with no taper: full
 *    contributions resume the month after the drop ends.
 * 4. **Nothing is ever paid back.** A missed contribution is missed — there is no catch-up month that
 *    pays double once income recovers, because nothing in the data model records an intention to do
 *    that. The gap an income shock opens up therefore never closes on its own: once contributions
 *    resume, the shocked line runs parallel to the baseline rather than converging back onto it. That
 *    is what {@link incomeShockImpact}'s `contributionsForgone` measures directly, rather than trying
 *    to describe a recovery date that will never come.
 *
 * Everything here is pure: a position and a config go in, new objects come out, nothing is mutated.
 */

import {
	FORECAST_SCENARIOS,
	MAX_FORECAST_MONTHS,
	forecastScenarios,
	summariseForecast
} from './forecast.js';

/*
 * As elsewhere in `$lib`: types are referenced inline as `import('./forecast.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *` and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The four dials README.md's "job loss / illness" scenario needs.
 *
 * @typedef {object} IncomeShock
 * @property {number} dropPct How much of each holding's contribution is missing while the shock is in
 *   force, as a whole-number percent (`100` = contributions stop entirely, `50` = half pay). `0` means
 *   no shock at all.
 * @property {number} atMonth Timing: whole months after the forecast anchor the shock starts. `1` is
 *   the first projected month; `0` is not allowed, matching `stress-test.js`'s own `atMonth` — offset 0
 *   is the anchor itself, which every scenario shares unchanged.
 * @property {number} durationMonths How many months the drop stays at the full `dropPct` before any
 *   ramp begins. `0` means the drop is instantaneous — the ramp (if any) starts immediately at
 *   `atMonth`.
 * @property {number} rampMonths How many months it then takes to taper the contribution back from the
 *   dropped level to normal. `0` means no taper: full contributions resume the month the drop ends —
 *   a job loss that ends cleanly rather than an illness that gets better by degrees.
 */

/**
 * Defaults for an income shock nobody has configured yet.
 *
 * README.md names the scenario but gives no numbers, so these are ours: a full stop (job loss, not a
 * reduced-hours illness) a year out, lasting half a year — long enough to matter, short enough to stay
 * a plausible spell between jobs — with no ramp, since a ramp is the illness-specific option the panel
 * turns on rather than a house view of how job loss ends.
 *
 * @type {Readonly<IncomeShock>}
 */
export const DEFAULT_INCOME_SHOCK = Object.freeze({
	dropPct: 100,
	atMonth: 12,
	durationMonths: 6,
	rampMonths: 0
});

/** Contributions cannot drop by more than everything. */
export const MAX_INCOME_SHOCK_DROP = 100;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asNumber(value, fallback) {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

/**
 * Fill in and bound a partial config, so a slider, a hand-edited document or an empty object all
 * become an {@link IncomeShock} the projector can walk. Out-of-range values are clamped rather than
 * rejected, matching `stress-test.js`'s `normaliseStressTest`.
 *
 * @param {Partial<IncomeShock>} [shock]
 * @returns {IncomeShock}
 */
export function normaliseIncomeShock(shock = {}) {
	const dropPct = clamp(
		asNumber(shock.dropPct, DEFAULT_INCOME_SHOCK.dropPct),
		0,
		MAX_INCOME_SHOCK_DROP
	);
	const atMonth = clamp(
		Math.trunc(asNumber(shock.atMonth, DEFAULT_INCOME_SHOCK.atMonth)),
		1,
		MAX_FORECAST_MONTHS
	);
	const durationMonths = clamp(
		Math.trunc(asNumber(shock.durationMonths, DEFAULT_INCOME_SHOCK.durationMonths)),
		0,
		MAX_FORECAST_MONTHS
	);
	const rampMonths = clamp(
		Math.trunc(asNumber(shock.rampMonths, DEFAULT_INCOME_SHOCK.rampMonths)),
		0,
		MAX_FORECAST_MONTHS
	);

	return { dropPct, atMonth, durationMonths, rampMonths };
}

/**
 * The contribution multiplier while the drop is at full severity: `0` for a 100% drop, `0.5` for a
 * 50% one.
 *
 * @param {number} dropPct
 * @returns {number}
 */
export function droppedContributionFactor(dropPct) {
	return 1 - clamp(dropPct, 0, MAX_INCOME_SHOCK_DROP) / 100;
}

/**
 * The last month contributions run at the full drop, before any ramp — an offset from the anchor.
 * Equal to `atMonth` when `durationMonths` is 0.
 *
 * @param {IncomeShock} shock
 * @returns {number}
 */
export function dropEndsAt(shock) {
	return shock.atMonth + shock.durationMonths;
}

/**
 * The first month contributions are back to normal — an offset from the anchor. Equal to
 * {@link dropEndsAt} when there is no ramp.
 *
 * @param {IncomeShock} shock
 * @returns {number}
 */
export function rampEndsAt(shock) {
	return dropEndsAt(shock) + shock.rampMonths;
}

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turn a config into the per-month hook `forecast.js` projects through: every month from `atMonth` up
 * to {@link dropEndsAt} pays the dropped contribution, every month of the ramp pays a linearly
 * increasing share on its way back to normal, and every other month returns `null` (pay in full).
 *
 * A zero-drop config returns a hook that is `null` everywhere, so the overlay lands exactly on the
 * baseline rather than quietly tapering a shock that never happened — the same guarantee
 * `stress-test.js`'s `stressAdjustment` gives at zero magnitude.
 *
 * @param {IncomeShock} shock
 * @returns {(offset: number) => import('./forecast.js').ForecastMonthAdjustment | null}
 */
export function incomeShockAdjustment(shock) {
	const droppedFactor = droppedContributionFactor(shock.dropPct);
	const dropEnd = dropEndsAt(shock);
	const rampEnd = rampEndsAt(shock);

	return (offset) => {
		if (shock.dropPct <= 0) return null;
		if (offset >= shock.atMonth && offset < dropEnd) {
			return { contributionFactor: droppedFactor };
		}
		if (offset >= dropEnd && offset < rampEnd) {
			// Step 1 of `rampMonths` lands just above the dropped level, step `rampMonths` lands just
			// below normal — the month after the ramp closes is the first one back at a full 1, with
			// no seam between "just below normal" and "normal" landing on the same offset twice.
			const step = offset - dropEnd + 1;
			const recovered = (1 - droppedFactor) * (step / (shock.rampMonths + 1));
			return { contributionFactor: droppedFactor + recovered };
		}
		return null;
	};
}

/**
 * A forecast with the income shock in it.
 *
 * @typedef {import('./forecast.js').Forecast & { shock: IncomeShock }} IncomeShockedForecast
 */

/**
 * Project a position under all three scenarios *with* an income shock — the overlay line to the
 * baseline `forecastScenarios` draws.
 *
 * Takes the same `input`/`options` as {@link import('./forecast.js').forecastScenarios} so the two can
 * be built from one set of assumptions: pass the baseline forecast's own `start`, `months` and
 * `spread` and the overlay shares its anchor, horizon and band width rather than being a differently
 * shaped projection on the same chart — exactly `stress-test.js`'s `stressForecast` pattern.
 *
 * @param {object} [input]
 * @param {readonly import('./types.js').Investment[]} [input.investments]
 * @param {readonly import('./types.js').Debt[]} [input.debts]
 * @param {{ month: number, year: number }} [input.start]
 * @param {number} [input.months]
 * @param {number} [input.spread]
 * @param {import('./forecast.js').ForecastOptions} [options]
 * @param {Partial<IncomeShock>} [shock]
 * @returns {IncomeShockedForecast}
 */
export function incomeShockForecast(input = {}, options = {}, shock = {}) {
	const config = normaliseIncomeShock(shock);
	const forecast = forecastScenarios(input, {
		...options,
		adjustMonth: incomeShockAdjustment(config)
	});

	return { ...forecast, shock: config };
}

/* -------------------------------------------------------------------------- */
/* Reading the damage                                                          */
/* -------------------------------------------------------------------------- */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * What the shock did to one scenario.
 *
 * Every figure is net worth or contributions, not investment growth, since the shock's whole effect is
 * routed through the contribution schedule (convention 2 above) — the debts a forecast carries are
 * constant through it either way, so net worth is the line the rest of the tab already talks in.
 *
 * @typedef {object} IncomeShockImpact
 * @property {import('./forecast.js').ForecastScenario} scenario
 * @property {boolean} occurs Whether the shock starts inside this forecast's horizon at all. A shock
 *   dated past the end of the projection leaves the overlay identical to the baseline.
 * @property {number} atMonth Offset the shock starts at.
 * @property {{ month: number, year: number } | null} date Calendar month the shock starts.
 * @property {number} dropEndsAtOffset Offset the full-severity drop ends (the ramp, if any, starts here).
 * @property {{ month: number, year: number } | null} dropEndsDate
 * @property {number} rampEndsAtOffset Offset contributions are back to normal.
 * @property {{ month: number, year: number } | null} rampEndsDate
 * @property {number} contributionsForgone Total contributions missed by the time the ramp closes (£) —
 *   the gap between the baseline's and the shocked forecast's cumulative `contributions`, which stops
 *   widening once ordinary contributions resume (convention 4).
 * @property {number} baselineFinal Net worth at the horizon without the shock (£).
 * @property {number} shockedFinal Net worth at the horizon with it (£).
 * @property {number} shortfall `baselineFinal - shockedFinal` (£).
 * @property {number | null} shortfallShare `shortfall / baselineFinal`, or `null` when the baseline
 *   ends at or below zero.
 * @property {number} compoundingLoss `shortfall - contributionsForgone` (£) — what the shock cost
 *   beyond the missed pounds themselves, i.e. the growth those pounds would have earned had they been
 *   invested on schedule.
 */

/**
 * @param {import('./forecast.js').ForecastPoint | undefined} point
 * @returns {{ month: number, year: number } | null}
 */
function dateOf(point) {
	return point ? { month: point.month, year: point.year } : null;
}

/**
 * Compare one scenario of a shocked forecast against the same scenario of the baseline it was built
 * alongside.
 *
 * The two must share an anchor and a horizon — build them from one set of assumptions (see
 * {@link incomeShockForecast}) and they do.
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {IncomeShockedForecast} shocked
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @returns {IncomeShockImpact}
 */
export function incomeShockImpact(baseline, shocked, scenario = 'realistic') {
	const shockedSeries = shocked.series[scenario] ?? [];
	const baselineSeries = baseline.series[scenario] ?? [];
	const { atMonth, dropPct } = shocked.shock;
	const dropEnd = dropEndsAt(shocked.shock);
	const rampEnd = rampEndsAt(shocked.shock);

	const occurs = dropPct > 0 && Boolean(shockedSeries[atMonth]) && Boolean(baselineSeries[atMonth]);

	const baselineFinal = baselineSeries.at(-1)?.net_worth ?? 0;
	const shockedFinal = shockedSeries.at(-1)?.net_worth ?? 0;
	const shortfall = roundMoney(baselineFinal - shockedFinal);

	// The gap between cumulative contributions stops moving once ordinary contributions resume, so
	// reading it at the ramp's close (or the horizon, if that comes first) gives the same number any
	// later offset would.
	const lastOffset = Math.min(shockedSeries.length, baselineSeries.length) - 1;
	const measureAt = Math.min(rampEnd, Math.max(lastOffset, 0));
	const contributionsForgone = occurs
		? roundMoney(
				(baselineSeries[measureAt]?.contributions ?? 0) -
					(shockedSeries[measureAt]?.contributions ?? 0)
			)
		: 0;

	return {
		scenario,
		occurs,
		atMonth,
		date: dateOf(shockedSeries[atMonth]),
		dropEndsAtOffset: dropEnd,
		dropEndsDate: dateOf(shockedSeries[dropEnd]),
		rampEndsAtOffset: rampEnd,
		rampEndsDate: dateOf(shockedSeries[rampEnd]),
		contributionsForgone,
		baselineFinal,
		shockedFinal,
		shortfall,
		shortfallShare: baselineFinal > 0 ? shortfall / baselineFinal : null,
		compoundingLoss: roundMoney(shortfall - contributionsForgone)
	};
}

/**
 * {@link incomeShockImpact} for all three scenarios — the low/mid/high shape the rest of the tab
 * already reads (`forecastBand`, `milestoneCrossings`, `growthCrossovers`).
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {IncomeShockedForecast} shocked
 * @returns {Record<import('./forecast.js').ForecastScenario, IncomeShockImpact>}
 */
export function incomeShockImpacts(baseline, shocked) {
	/** @type {Record<string, IncomeShockImpact>} */
	const impacts = {};
	for (const scenario of FORECAST_SCENARIOS) {
		impacts[scenario] = incomeShockImpact(baseline, shocked, scenario);
	}
	return /** @type {Record<import('./forecast.js').ForecastScenario, IncomeShockImpact>} */ (
		impacts
	);
}

/**
 * One month of the overlay against the baseline.
 *
 * @typedef {object} IncomeShockComparisonRow
 * @property {number} offset Months since the anchor.
 * @property {number} years
 * @property {number} month
 * @property {number} year
 * @property {number} baseline Net worth without the shock (£).
 * @property {number} shocked Net worth with it (£).
 * @property {number} gap `shocked - baseline` (£) — negative once the shock has started costing.
 * @property {number | null} gapShare `gap / baseline`, or `null` when the baseline is at or below zero.
 */

/**
 * Line the two projections up month by month at the offsets given — normally whichever rows the
 * forecast summary table is showing, matching `stress-test.js`'s `compareStressed`. Offsets past the
 * horizon are dropped rather than returned as holes.
 *
 * @param {import('./forecast.js').Forecast} baseline
 * @param {IncomeShockedForecast} shocked
 * @param {import('./forecast.js').ForecastScenario} [scenario]
 * @param {readonly number[] | null} [offsets] Defaults to `summariseForecast`'s own horizons.
 * @returns {IncomeShockComparisonRow[]}
 */
export function compareIncomeShock(baseline, shocked, scenario = 'realistic', offsets = null) {
	const wanted =
		offsets && offsets.length > 0 ? offsets : summariseForecast(baseline).map((row) => row.offset);

	/** @type {IncomeShockComparisonRow[]} */
	const rows = [];
	for (const offset of wanted) {
		const basePoint = baseline.series[scenario]?.[offset];
		const shockedPoint = shocked.series[scenario]?.[offset];
		if (!basePoint || !shockedPoint) continue;

		const gap = roundMoney(shockedPoint.net_worth - basePoint.net_worth);
		rows.push({
			offset,
			years: offset / 12,
			month: basePoint.month,
			year: basePoint.year,
			baseline: basePoint.net_worth,
			shocked: shockedPoint.net_worth,
			gap,
			gapShare: basePoint.net_worth > 0 ? gap / basePoint.net_worth : null
		});
	}
	return rows;
}
