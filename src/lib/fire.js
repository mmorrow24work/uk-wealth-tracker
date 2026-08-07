/**
 * FIRE / Coast FIRE maths — README.md → "FIRE / Retirement Calculator": "Magic number (25× target
 * annual income)", "Coast FIRE number (pot size where contributions can stop)", "Accumulation and
 * drawdown charts", "'Will my money last?' portfolio runway in years" and the four adjustable
 * sliders (target income, monthly saving, growth rate, withdrawal rate) — issue #22.
 *
 * One position and four assumptions produce three answers: how big the pot has to be, when it gets
 * there, and how long it lasts once you start spending it. Four conventions decide what the numbers
 * mean:
 *
 * 1. **Every figure is in today's money.** The target income slider is what the user wants to live
 *    on *now*, so every pot compared against it has to be in the same units. `growthRate` is the
 *    nominal assumption and `inflationRate` deflates it — {@link realGrowthRate}, Fisher, not
 *    subtraction — and the whole projection then runs at that real rate. Pass `inflationRate: 0` to
 *    say "the rate I gave you is already real" and the module works in nominal terms instead.
 *    Without this, a 30-year accumulation reports a seven-figure pot against a target income priced
 *    in 2026 pounds, and the comparison is meaningless.
 * 2. **The arithmetic is `auto-invest.js`'s, exactly.** Geometric monthly rate, growth credited
 *    before the month's cash flow, values rounded to whole pence each month and the rounded value
 *    carried forward. A withdrawal is simply a negative contribution paid at the month end, so
 *    accumulation and drawdown are the same walk with the sign flipped — and an accumulation month
 *    here is the same number `forecast.js` would have produced for a single holding.
 * 3. **The magic number is the withdrawal rate's reciprocal, not a hard-coded 25.** README.md's
 *    "25× target annual income" is what a 4% withdrawal rate yields (`100 / 4`), and README.md also
 *    asks for a withdrawal rate slider — so the multiple follows the slider. At 3% it is 33.3×, at
 *    5% it is 20×. Hard-coding 25 would leave the slider changing the runway but not the target it
 *    is measured against.
 * 4. **The pot is what funds drawdown, not net worth.** {@link investablePot} sums the investment
 *    holdings that count towards net worth and ignores debts entirely: a mortgage is not a negative
 *    income stream you can draw down, and the house it is secured on is not one you can sell a
 *    twelfth of each month. `debt.js` and `forecast.js` still own net worth; this module is
 *    deliberately narrower.
 *
 * Everything here is pure: assumptions go in, new arrays and plain objects come out.
 */

import { DEFAULT_GROWTH_RATE, addMonths, monthlyGrowthRate } from './auto-invest.js';
import { PAYMENTS_PER_YEAR } from './enums.js';
import { currentCalendarMonth, positionFromEntries } from './forecast.js';

/*
 * As in `forecast.js`/`auto-invest.js`: model types are referenced inline as
 * `import('./types.js').X` rather than re-declared as local `@typedef`s, because `index.js`
 * re-exports every module with `export *` and svelte-check reads two same-named top-level typedefs
 * across re-exported modules as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The withdrawal rate behind README.md's "25× target annual income" — the Trinity-study 4% rule,
 * and the default position of the withdrawal-rate slider.
 */
export const DEFAULT_WITHDRAWAL_RATE = 4;

/**
 * `100 / DEFAULT_WITHDRAWAL_RATE`. Exported because README.md names the multiple rather than the
 * rate, so a caller (or a test) wanting the spec's own number shouldn't have to re-derive it.
 */
export const MAGIC_NUMBER_MULTIPLE = 25;

/**
 * A withdrawal rate of zero would demand an infinite pot, and one above 100% would spend more than
 * the pot holds in its first year. Rates are clamped into this range rather than rejected, the same
 * way `forecast.js` clamps growth rates.
 */
export const MIN_WITHDRAWAL_RATE = 0.1;
export const MAX_WITHDRAWAL_RATE = 100;

/** Default accumulation horizon in months (60 years) — long enough that "never" means never. */
export const DEFAULT_ACCUMULATION_MONTHS = 720;

/** Default drawdown horizon in months (40 years) — retiring at 55 and living to 95. */
export const DEFAULT_DRAWDOWN_MONTHS = 480;

/**
 * Longest walk this module will take, in months. Matches `forecast.js`'s own cap: beyond a century
 * the numbers are noise, and an unbounded horizon from a slider would build a series big enough to
 * lock the tab up. Longer requests are clamped, not rejected.
 */
export const MAX_FIRE_MONTHS = 1200;

/** Growth and inflation are whole-number percents; `validateAppData` accepts -100…100, so match it. */
const MIN_RATE_PCT = -100;
const MAX_RATE_PCT = 100;

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asFinite(value, fallback) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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
 * @param {number} months
 * @param {number} fallback
 * @returns {number}
 */
function clampMonths(months, fallback) {
	return clamp(Math.trunc(asFinite(months, fallback)), 0, MAX_FIRE_MONTHS);
}

/* -------------------------------------------------------------------------- */
/* Rates                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Growth net of inflation — convention (1). `(1 + g) / (1 + i) - 1`, not `g - i`: at 5% growth and
 * 2.5% inflation that is 2.439%, not 2.5%. The difference is a quarter of a percentage point that
 * compounds for thirty years.
 *
 * An inflation rate of exactly -100% (prices fall to nothing) has no meaningful real equivalent, so
 * the result is clamped to the same -100…100 band every other rate in the app lives in.
 *
 * @param {number} [nominalRatePct] Annual growth (%).
 * @param {number} [inflationRatePct] Annual inflation (%). `0` leaves the rate untouched.
 * @returns {number} Annual real growth (%).
 */
export function realGrowthRate(nominalRatePct = DEFAULT_GROWTH_RATE, inflationRatePct = 0) {
	const nominal = clamp(asFinite(nominalRatePct, DEFAULT_GROWTH_RATE), MIN_RATE_PCT, MAX_RATE_PCT);
	const inflation = clamp(asFinite(inflationRatePct, 0), MIN_RATE_PCT, MAX_RATE_PCT);
	const deflator = 1 + inflation / 100;
	if (deflator <= 0) return MAX_RATE_PCT;
	return clamp(((1 + nominal / 100) / deflator - 1) * 100, MIN_RATE_PCT, MAX_RATE_PCT);
}

/**
 * The multiple of target income a pot has to reach — the reciprocal of the withdrawal rate, per
 * convention (3). 4% → 25, 3% → 33.33, 5% → 20.
 *
 * @param {number} [withdrawalRatePct]
 * @returns {number}
 */
export function withdrawalMultiple(withdrawalRatePct = DEFAULT_WITHDRAWAL_RATE) {
	const rate = clamp(
		asFinite(withdrawalRatePct, DEFAULT_WITHDRAWAL_RATE),
		MIN_WITHDRAWAL_RATE,
		MAX_WITHDRAWAL_RATE
	);
	return 100 / rate;
}

/**
 * README.md's "magic number": the pot that supports `targetAnnualIncome` indefinitely at the given
 * withdrawal rate. At the default 4% this is the spec's 25× target income.
 *
 * @param {number} targetAnnualIncome Income wanted in retirement, in today's money (£/yr).
 * @param {number} [withdrawalRatePct]
 * @returns {number} Pot required (£).
 */
export function fireNumber(targetAnnualIncome, withdrawalRatePct = DEFAULT_WITHDRAWAL_RATE) {
	const target = Math.max(0, asFinite(targetAnnualIncome, 0));
	return roundMoney(target * withdrawalMultiple(withdrawalRatePct));
}

/**
 * The inverse: the income a pot of this size supports at that withdrawal rate. What the summary
 * shows when the projected pot lands short of (or past) the target the user asked for.
 *
 * @param {number} pot
 * @param {number} [withdrawalRatePct]
 * @returns {number} Annual income (£/yr).
 */
export function sustainableIncome(pot, withdrawalRatePct = DEFAULT_WITHDRAWAL_RATE) {
	const rate = clamp(
		asFinite(withdrawalRatePct, DEFAULT_WITHDRAWAL_RATE),
		MIN_WITHDRAWAL_RATE,
		MAX_WITHDRAWAL_RATE
	);
	return roundMoney(Math.max(0, asFinite(pot, 0)) * (rate / 100));
}

/* -------------------------------------------------------------------------- */
/* Coast FIRE                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * README.md's "Coast FIRE number (pot size where contributions can stop)": the pot that, left
 * completely alone, compounds to `target` in `years`. It is the magic number discounted back at the
 * growth rate — `target / (1 + g)^years` — so a pot at or above it needs no further saving at all,
 * only time.
 *
 * A zero-or-negative growth factor leaves nothing to coast on: money that does not grow has to be
 * saved, so the coast number is the full target.
 *
 * @param {number} target The magic number to arrive at (£).
 * @param {number} [growthRatePct] Annual real growth (%) — see convention (1).
 * @param {number} [years] Years the pot has to compound for. Negative is read as zero.
 * @returns {number} Pot size (£).
 */
export function coastFireNumber(target, growthRatePct = DEFAULT_GROWTH_RATE, years = 0) {
	const amount = Math.max(0, asFinite(target, 0));
	const rate = clamp(asFinite(growthRatePct, DEFAULT_GROWTH_RATE), MIN_RATE_PCT, MAX_RATE_PCT);
	const span = Math.max(0, asFinite(years, 0));
	const factor = (1 + rate / 100) ** span;
	if (!Number.isFinite(factor) || factor <= 0) return roundMoney(amount);
	return roundMoney(amount / factor);
}

/**
 * Where a pot stands against its Coast FIRE number today.
 *
 * @typedef {object} CoastFireStatus
 * @property {number} number The Coast FIRE number itself (£).
 * @property {boolean} achieved Whether the pot already covers it — contributions could stop now.
 * @property {number} gap How much more is needed to start coasting (£); `0` once achieved.
 * @property {number} surplus How far past it the pot already is (£); `0` until achieved.
 * @property {number} share Pot as a fraction of the coast number (`1` = exactly there). `1` when
 *   the coast number is zero, since there is nothing left to reach.
 */

/**
 * @param {number} pot Invested today (£).
 * @param {number} target The magic number (£).
 * @param {number} [growthRatePct] Annual real growth (%).
 * @param {number} [years] Years until the pot is needed.
 * @returns {CoastFireStatus}
 */
export function coastFireStatus(pot, target, growthRatePct = DEFAULT_GROWTH_RATE, years = 0) {
	const value = Math.max(0, asFinite(pot, 0));
	const number = coastFireNumber(target, growthRatePct, years);
	return {
		number,
		achieved: value >= number,
		gap: roundMoney(Math.max(0, number - value)),
		surplus: roundMoney(Math.max(0, value - number)),
		share: number === 0 ? 1 : value / number
	};
}

/* -------------------------------------------------------------------------- */
/* Accumulation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One month of the accumulation series — README.md's "accumulation chart", as data.
 *
 * `contributions` and `growth` are cumulative since the start and always add up to the change in
 * `value`, the same split {@link import('./forecast.js').ForecastPoint} carries so the compounding
 * panel's reconciliation holds here too.
 *
 * @typedef {object} AccumulationPoint
 * @property {number} offset Whole months since the start. `0` is the pot as it stands today.
 * @property {number} month Calendar month, 1–12.
 * @property {number} year Four-digit calendar year.
 * @property {number} value Pot at this month end (£).
 * @property {number} contributions Cumulative saving paid in since offset 0 (£).
 * @property {number} growth Cumulative growth earned since offset 0 (£).
 */

/**
 * Walk a pot forward while it is being saved into: grow, then add the month's saving — convention
 * (2), an ordinary annuity.
 *
 * @param {object} [input]
 * @param {number} [input.pot] Invested today (£).
 * @param {number} [input.monthlySaving] Paid in at each month end (£).
 * @param {number} [input.growthRate] Annual real growth (%).
 * @param {{ month: number, year: number }} [input.start] Anchor month. Defaults to the current one.
 * @param {number} [input.months] Months to project. Clamped to 0…{@link MAX_FIRE_MONTHS}.
 * @returns {AccumulationPoint[]} Oldest first, `months + 1` long — offset 0 is today.
 */
export function projectAccumulation(input = {}) {
	const {
		pot = 0,
		monthlySaving = 0,
		growthRate = DEFAULT_GROWTH_RATE,
		start = currentCalendarMonth(),
		months = DEFAULT_ACCUMULATION_MONTHS
	} = input;

	const horizon = clampMonths(months, DEFAULT_ACCUMULATION_MONTHS);
	const saving = Math.max(0, asFinite(monthlySaving, 0));
	const rate = monthlyGrowthRate(
		clamp(asFinite(growthRate, DEFAULT_GROWTH_RATE), MIN_RATE_PCT, MAX_RATE_PCT)
	);

	let value = roundMoney(Math.max(0, asFinite(pot, 0)));
	let contributions = 0;
	let growth = 0;

	/** @type {AccumulationPoint[]} */
	const points = [{ offset: 0, ...start, value, contributions: 0, growth: 0 }];

	for (let offset = 1; offset <= horizon; offset += 1) {
		const opening = value;
		value = roundMoney(opening * (1 + rate) + saving);
		contributions += saving;
		// Growth is whatever the month's change in value was not explained by the saving, so the two
		// always reconcile to the change exactly, rounding included.
		growth += value - opening - saving;

		points.push({
			offset,
			...addMonths(start, offset),
			value,
			contributions: roundMoney(contributions),
			growth: roundMoney(growth)
		});
	}

	return points;
}

/**
 * When a projected pot first reaches an amount.
 *
 * @typedef {object} FireTiming
 * @property {boolean} reached Whether the amount is reached within the projected horizon.
 * @property {boolean} alreadyThere Reached at offset 0 — the pot already covers it.
 * @property {number | null} offset Months from the start, or `null` if never reached.
 * @property {number | null} years `offset / 12`, or `null`.
 * @property {{ month: number, year: number } | null} date The month it happens in.
 * @property {number | null} value Pot at that month (£).
 * @property {number} finalValue Pot at the end of the horizon (£) — what you get to instead, when
 *   the amount is never reached.
 */

/**
 * The first month a series reaches `amount` — README.md's "years to FIRE", read off whichever
 * series the caller projected.
 *
 * @param {readonly AccumulationPoint[]} points
 * @param {number} amount
 * @returns {FireTiming}
 */
export function timeToTarget(points, amount) {
	const target = Math.max(0, asFinite(amount, 0));
	const finalValue = points.at(-1)?.value ?? 0;
	const hit = points.find((point) => point.value >= target) ?? null;

	if (!hit) {
		return {
			reached: false,
			alreadyThere: false,
			offset: null,
			years: null,
			date: null,
			value: null,
			finalValue
		};
	}

	return {
		reached: true,
		alreadyThere: hit.offset === 0,
		offset: hit.offset,
		years: hit.offset / 12,
		date: { month: hit.month, year: hit.year },
		value: hit.value,
		finalValue
	};
}

/**
 * The month contributions could stop — the first point at which the pot covers the Coast FIRE
 * number *for the time still left before retirement*.
 *
 * The threshold is a moving one: every month that passes is a month less of compounding, so the
 * coast number rises as retirement approaches while the pot rises with saving and growth. They meet
 * at the coast date, and by construction that is at or before the date the pot reaches the full
 * magic number — at zero years remaining, the coast number *is* the magic number.
 *
 * The search stops at the retirement date. Past it there is no compounding left to do, so the
 * threshold is simply the target and "coasting" would just be a second name for reaching the number
 * — a plan that only gets there afterwards has not found a month it could stop saving in, and says
 * so (`reached: false`) rather than reporting a date that reads as good news.
 *
 * @param {readonly AccumulationPoint[]} points
 * @param {object} input
 * @param {number} input.target The magic number (£).
 * @param {number} [input.growthRate] Annual real growth (%) — the rate the coasting pot compounds at.
 * @param {number} input.retirementOffset Months from the start until the pot is needed.
 * @returns {FireTiming & { number: number | null }} `number` is the coast number at the crossing.
 */
export function coastCrossing(points, input) {
	const { target, growthRate = DEFAULT_GROWTH_RATE, retirementOffset } = input;
	const retireAt = Math.max(0, asFinite(retirementOffset, 0));
	const finalValue = points.at(-1)?.value ?? 0;

	for (const point of points) {
		if (point.offset > retireAt) break;

		const yearsLeft = (retireAt - point.offset) / 12;
		const number = coastFireNumber(target, growthRate, yearsLeft);
		if (point.value >= number) {
			return {
				reached: true,
				alreadyThere: point.offset === 0,
				offset: point.offset,
				years: point.offset / 12,
				date: { month: point.month, year: point.year },
				value: point.value,
				finalValue,
				number
			};
		}
	}

	return {
		reached: false,
		alreadyThere: false,
		offset: null,
		years: null,
		date: null,
		value: null,
		finalValue,
		number: null
	};
}

/* -------------------------------------------------------------------------- */
/* Drawdown                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One month of the drawdown series — README.md's "drawdown chart", as data.
 *
 * @typedef {object} DrawdownPoint
 * @property {number} offset Whole months since drawdown began. `0` is the pot at retirement.
 * @property {number} month
 * @property {number} year
 * @property {number} value Pot at this month end (£), after the month's income was taken.
 * @property {number} income Taken this month (£) — less than a full month's worth in the final
 *   month, when what was left could not fund one.
 * @property {number} withdrawn Cumulative income taken since offset 0 (£).
 * @property {number} growth Cumulative growth earned since offset 0 (£).
 */

/**
 * Walk a pot forward while it is being spent: grow, then take the month's income — the same walk
 * {@link projectAccumulation} makes with the sign of the cash flow flipped, per convention (2).
 *
 * The series stops the month the pot empties, so its last point is the moment the money runs out
 * rather than a run of zeroes. A month that cannot fund a full withdrawal pays out whatever is left
 * and ends at zero — the pot is exhausted *during* that month, which is why
 * {@link portfolioRunway}'s `months` counts only the months funded in full.
 *
 * @param {object} [input]
 * @param {number} [input.pot] Pot at retirement (£).
 * @param {number} [input.annualIncome] Income drawn per year, in today's money (£).
 * @param {number} [input.growthRate] Annual real growth (%) — the pot keeps growing in drawdown.
 * @param {{ month: number, year: number }} [input.start] Month drawdown begins.
 * @param {number} [input.months] Months to project. Clamped to 0…{@link MAX_FIRE_MONTHS}.
 * @returns {DrawdownPoint[]} Oldest first; at most `months + 1` long, shorter if the pot empties.
 */
export function projectDrawdown(input = {}) {
	const {
		pot = 0,
		annualIncome = 0,
		growthRate = DEFAULT_GROWTH_RATE,
		start = currentCalendarMonth(),
		months = DEFAULT_DRAWDOWN_MONTHS
	} = input;

	const horizon = clampMonths(months, DEFAULT_DRAWDOWN_MONTHS);
	const monthlyIncome = roundMoney(Math.max(0, asFinite(annualIncome, 0)) / 12);
	const rate = monthlyGrowthRate(
		clamp(asFinite(growthRate, DEFAULT_GROWTH_RATE), MIN_RATE_PCT, MAX_RATE_PCT)
	);

	let value = roundMoney(Math.max(0, asFinite(pot, 0)));
	let withdrawn = 0;
	let growth = 0;

	/** @type {DrawdownPoint[]} */
	const points = [{ offset: 0, ...start, value, income: 0, withdrawn: 0, growth: 0 }];

	for (let offset = 1; offset <= horizon; offset += 1) {
		const opening = value;
		const grown = roundMoney(opening * (1 + rate));
		const paid = Math.min(monthlyIncome, Math.max(0, grown));
		value = roundMoney(grown - paid);
		withdrawn += paid;
		growth += grown - opening;

		points.push({
			offset,
			...addMonths(start, offset),
			value,
			income: paid,
			withdrawn: roundMoney(withdrawn),
			growth: roundMoney(growth)
		});

		// An empty pot stays empty, so there is nothing left to project. Guarded on the income being
		// non-zero: a pot of nothing drawing nothing is a flat line, not a pot that ran out.
		if (value <= 0 && monthlyIncome > 0) break;
	}

	return points;
}

/**
 * README.md's "'Will my money last?' portfolio runway in years".
 *
 * @typedef {object} PortfolioRunway
 * @property {number} months Whole months of *full* income the pot funds. Equals the horizon when
 *   the money outlasts it.
 * @property {number} years `months / 12`.
 * @property {boolean} depleted Whether the pot ran out within the horizon.
 * @property {boolean} sustainable Whether growth alone covers the income drawn, so the pot never
 *   falls at all — the "money lasts forever" case, checked directly rather than inferred from
 *   surviving an arbitrary horizon.
 * @property {{ month: number, year: number } | null} depletedDate The month the money ran out.
 * @property {number} finalValue What is left at the end of the horizon (£).
 * @property {number} withdrawn Total income taken (£).
 * @property {number} monthlyIncome The monthly withdrawal itself (£).
 * @property {DrawdownPoint[]} points The drawdown series — README.md's drawdown chart.
 */

/**
 * How long a pot funds an income, and whether it ever stops.
 *
 * `sustainable` is an exact statement, not an observation: a pot never falls if one month's growth
 * covers one month's income (`pot × r ≥ income / 12`). Note that this is a stricter test than "the
 * withdrawal rate equals the growth rate" — drawing 4% of a pot growing at 4% still shrinks it,
 * because each month's income leaves before it can compound.
 *
 * @param {object} [input] As {@link projectDrawdown}'s.
 * @param {number} [input.pot]
 * @param {number} [input.annualIncome]
 * @param {number} [input.growthRate]
 * @param {{ month: number, year: number }} [input.start]
 * @param {number} [input.months]
 * @returns {PortfolioRunway}
 */
export function portfolioRunway(input = {}) {
	const { pot = 0, annualIncome = 0, growthRate = DEFAULT_GROWTH_RATE } = input;

	const points = projectDrawdown(input);
	const last = points.at(-1) ?? {
		offset: 0,
		month: 1,
		year: 1900,
		value: 0,
		income: 0,
		withdrawn: 0,
		growth: 0
	};

	const monthlyIncome = roundMoney(Math.max(0, asFinite(annualIncome, 0)) / 12);
	const startValue = Math.max(0, asFinite(pot, 0));
	const rate = monthlyGrowthRate(
		clamp(asFinite(growthRate, DEFAULT_GROWTH_RATE), MIN_RATE_PCT, MAX_RATE_PCT)
	);
	const sustainable = startValue * rate >= monthlyIncome;

	// Drawing nothing empties nothing: a zero income is a flat pot, not a pot that ran out.
	const depleted = monthlyIncome > 0 && last.value <= 0;
	// The month the pot emptied paid out whatever was left rather than a full month's income (unless
	// it happened to land exactly on zero), so the runway counts only the months funded in full.
	const funded = depleted
		? points.filter((point) => point.offset > 0 && point.income >= monthlyIncome).length
		: last.offset;

	return {
		months: funded,
		years: funded / 12,
		depleted,
		sustainable,
		depletedDate: depleted ? { month: last.month, year: last.year } : null,
		finalValue: last.value,
		withdrawn: last.withdrawn,
		monthlyIncome,
		points
	};
}

/* -------------------------------------------------------------------------- */
/* Reading a position                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The pot a FIRE plan draws on — convention (4): investment holdings that count towards net worth,
 * with no debts netted off.
 *
 * @param {readonly import('./types.js').Investment[]} investments
 * @returns {number} (£)
 */
export function investablePot(investments) {
	return roundMoney(
		investments
			.filter((investment) => !investment.exclude_from_net_worth)
			.reduce((total, investment) => total + investment.value, 0)
	);
}

/**
 * A holding's contribution expressed per month, whatever its schedule. `monthly_contribution` is the
 * amount paid per `contribution_frequency` period (README.md's own naming — see `types.js`), so
 * £900 quarterly is £300 a month here. A one-off was paid once already and is not saving that
 * continues, so it counts as nothing.
 *
 * @param {import('./types.js').Investment} investment
 * @returns {number} (£/month)
 */
export function monthlyEquivalentContribution(investment) {
	const perYear = PAYMENTS_PER_YEAR[investment.contribution_frequency] ?? 0;
	return roundMoney((investment.monthly_contribution * perYear) / 12);
}

/**
 * Everything the holdings that count towards net worth pay in each month.
 *
 * @param {readonly import('./types.js').Investment[]} investments
 * @returns {number} (£/month)
 */
export function monthlySavingFromHoldings(investments) {
	return roundMoney(
		investments
			.filter((investment) => !investment.exclude_from_net_worth)
			.reduce((total, investment) => total + monthlyEquivalentContribution(investment), 0)
	);
}

/**
 * The starting point a FIRE plan reads off a recorded history: the latest snapshot's investable pot,
 * what it is being saved into at, and the month it was recorded.
 *
 * `null` when there is no history, so a caller can tell "nothing recorded yet" from "a pot that
 * happens to be empty" — the same distinction `forecast.js`'s `positionFromEntries` makes, which
 * this delegates the anchoring to so both tabs project from the same snapshot.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {{ pot: number, monthlySaving: number, start: { month: number, year: number } } | null}
 */
export function fireStartingPoint(entries) {
	const position = positionFromEntries(entries);
	if (!position) return null;

	return {
		pot: investablePot(position.investments),
		monthlySaving: monthlySavingFromHoldings(position.investments),
		start: position.start
	};
}

/* -------------------------------------------------------------------------- */
/* The whole plan                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Everything the FIRE tab's four sliders and two dates describe.
 *
 * @typedef {object} FireInput
 * @property {number} pot Invested today (£).
 * @property {number} monthlySaving Paid in each month (£).
 * @property {number} targetIncome Income wanted in retirement, in today's money (£/yr).
 * @property {number} growthRate Annual *nominal* growth (%).
 * @property {number} inflationRate Annual inflation (%) — see convention (1).
 * @property {number} withdrawalRate Safe withdrawal rate (%).
 * @property {number} yearsToRetirement Years until saving stops and drawdown begins.
 * @property {number} drawdownYears How long the money has to last once drawdown begins.
 * @property {{ month: number, year: number }} start Month the plan is anchored on.
 */

/** @type {Omit<FireInput, 'start'>} */
export const DEFAULT_FIRE_INPUT = Object.freeze({
	pot: 0,
	monthlySaving: 0,
	targetIncome: 0,
	growthRate: DEFAULT_GROWTH_RATE,
	// 0, not `Profile.inflation_rate`'s 2.5: a caller that says nothing about inflation is telling us
	// the growth rate it gave is the one it wants used, not asking for it to be quietly deflated.
	inflationRate: 0,
	withdrawalRate: DEFAULT_WITHDRAWAL_RATE,
	yearsToRetirement: 0,
	drawdownYears: DEFAULT_DRAWDOWN_MONTHS / 12
});

/**
 * Coerce whatever the sliders and number fields produced into a usable {@link FireInput}: money
 * non-negative, rates inside the app's -100…100 band, withdrawal rate away from zero, horizons
 * whole-ish and bounded. Never throws — a half-typed form is a normal state, not an error.
 *
 * @param {Partial<FireInput>} [raw]
 * @returns {FireInput}
 */
export function normaliseFireInput(raw = {}) {
	const source = { ...DEFAULT_FIRE_INPUT, ...raw };
	return {
		pot: Math.max(0, asFinite(source.pot, 0)),
		monthlySaving: Math.max(0, asFinite(source.monthlySaving, 0)),
		targetIncome: Math.max(0, asFinite(source.targetIncome, 0)),
		growthRate: clamp(asFinite(source.growthRate, DEFAULT_GROWTH_RATE), MIN_RATE_PCT, MAX_RATE_PCT),
		inflationRate: clamp(asFinite(source.inflationRate, 0), MIN_RATE_PCT, MAX_RATE_PCT),
		withdrawalRate: clamp(
			asFinite(source.withdrawalRate, DEFAULT_WITHDRAWAL_RATE),
			MIN_WITHDRAWAL_RATE,
			MAX_WITHDRAWAL_RATE
		),
		yearsToRetirement: clamp(asFinite(source.yearsToRetirement, 0), 0, MAX_FIRE_MONTHS / 12),
		drawdownYears: clamp(
			asFinite(source.drawdownYears, DEFAULT_DRAWDOWN_MONTHS / 12),
			0,
			MAX_FIRE_MONTHS / 12
		),
		start: raw.start ?? currentCalendarMonth()
	};
}

/**
 * The whole plan, in one object: the magic number, the Coast FIRE number, when each is reached, the
 * pot at retirement and how long it then lasts.
 *
 * This is the FIRE tab's single entry point. Every part is available separately above; composing
 * them here is what keeps one set of assumptions behind all of them — the accumulation series, the
 * coast threshold and the drawdown all run at the same real rate off the same anchor, so no two
 * figures on the tab can disagree about what the user typed.
 *
 * @typedef {object} FireSummary
 * @property {FireInput} input The normalised assumptions every figure below was computed from.
 * @property {number} realRate Annual real growth actually used (%).
 * @property {number} multiple Target income multiple implied by the withdrawal rate.
 * @property {number} number The magic number (£).
 * @property {number} gap How far today's pot is from it (£); `0` once reached.
 * @property {number} share Today's pot as a fraction of it — README.md's "FIRE percentage".
 * @property {CoastFireStatus} coast Coast FIRE, as of today.
 * @property {FireTiming & { number: number | null }} coastDate When contributions could stop.
 * @property {FireTiming} timing When the pot reaches the magic number.
 * @property {AccumulationPoint[]} accumulation Series up to the retirement date.
 * @property {number} potAtRetirement Pot when saving stops (£).
 * @property {number} incomeAtRetirement What that pot supports at the withdrawal rate (£/yr).
 * @property {number} incomeGap Target income less `incomeAtRetirement` (£/yr); `0` if it's covered.
 * @property {boolean} onTrack Whether the pot reaches the magic number by the retirement date.
 * @property {PortfolioRunway} runway How long the retirement pot funds the target income.
 *
 * @param {Partial<FireInput>} [raw]
 * @returns {FireSummary}
 */
export function fireSummary(raw = {}) {
	const input = normaliseFireInput(raw);
	const realRate = realGrowthRate(input.growthRate, input.inflationRate);
	const number = fireNumber(input.targetIncome, input.withdrawalRate);
	const retirementOffset = Math.round(input.yearsToRetirement * 12);

	// Long enough to answer "when do I get there?" even when retirement is nearer than the answer —
	// the accumulation series itself is trimmed back to the retirement date below, since saving stops
	// there, but the search for the crossing dates should not be cut short by it.
	const searchMonths = clampMonths(
		Math.max(retirementOffset, DEFAULT_ACCUMULATION_MONTHS),
		DEFAULT_ACCUMULATION_MONTHS
	);
	const search = projectAccumulation({
		pot: input.pot,
		monthlySaving: input.monthlySaving,
		growthRate: realRate,
		start: input.start,
		months: searchMonths
	});

	const accumulation = search.slice(0, Math.min(retirementOffset, searchMonths) + 1);
	const potAtRetirement = accumulation.at(-1)?.value ?? input.pot;
	const incomeAtRetirement = sustainableIncome(potAtRetirement, input.withdrawalRate);

	const runway = portfolioRunway({
		pot: potAtRetirement,
		annualIncome: input.targetIncome,
		growthRate: realRate,
		start: addMonths(input.start, retirementOffset),
		months: Math.round(input.drawdownYears * 12)
	});

	return {
		input,
		realRate,
		multiple: withdrawalMultiple(input.withdrawalRate),
		number,
		gap: roundMoney(Math.max(0, number - input.pot)),
		share: number === 0 ? 1 : input.pot / number,
		coast: coastFireStatus(input.pot, number, realRate, input.yearsToRetirement),
		coastDate: coastCrossing(search, { target: number, growthRate: realRate, retirementOffset }),
		timing: timeToTarget(search, number),
		accumulation,
		potAtRetirement,
		incomeAtRetirement,
		incomeGap: roundMoney(Math.max(0, input.targetIncome - incomeAtRetirement)),
		onTrack: potAtRetirement >= number,
		runway
	};
}
