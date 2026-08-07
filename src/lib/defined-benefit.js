/**
 * Defined Benefit pension income — README.md → "Pension Tracker": "DB pension: accrual rate, years
 * of service, expected salary, or direct annual income input" — issue #30.
 *
 * A Defined Benefit scheme has no pot to value. It promises an income, and that income comes from
 * one formula the scheme fixes and three numbers the member supplies:
 *
 * ```text
 * annual income = accrual rate × pensionable salary × years of pensionable service
 * ```
 *
 * A 1/60th scheme, 25 years of service and a £45,000 pensionable salary is
 * `(1/60) × £45,000 × 25 = £18,750` a year for life. That is the whole calculation; everything
 * else in this module is either a spelling of one of those three numbers, a route around them
 * (a figure read straight off a scheme statement), or a projection forward.
 *
 * Six conventions decide what the numbers here mean:
 *
 * 1. **Accrual is stored as a percentage of salary per year of service, not as a fraction.**
 *    "1/60th" and "1.6667%" are two spellings of the same number, and `Pension.db_accrual_rate`
 *    holds the second — a plain number the arithmetic can use without parsing. Schemes are always
 *    *described* in the first, so {@link accrualRateFromDenominator} and
 *    {@link accrualFractionLabel} convert both ways and the form offers the usual denominators.
 * 2. **A Defined Benefit input counts as recorded only when it is a positive number.** `null`, `0`
 *    and negatives all read as "not entered". This is a deliberate simplification of `types.js`'s
 *    "when set it wins": a form cannot reliably tell a blank box from a typed zero, no Defined
 *    Benefit scheme pays a £0 income or accrues at 0% a year, and the alternative — a stated
 *    income of `0` silently overriding a complete set of accrual inputs — looks exactly like a
 *    bug. One rule for all four `db_*` fields, so there is nothing to remember.
 * 3. **A stated income wins over the formula.** README.md offers both routes and a figure off an
 *    annual benefit statement is the scheme's own arithmetic, which knows things this module never
 *    can (see the list of omissions below). {@link definedBenefitBreakdown} still reports what the
 *    formula would have said when both are present, and the gap between them, because a large
 *    disagreement usually means a mistyped input rather than a generous scheme.
 * 4. **`db_years` means total pensionable service at the point the pension is drawn**, not service
 *    accrued so far. This is the single most common way a DB projection comes out wrong, so
 *    {@link projectDefinedBenefit} exists to turn "service so far" into "service at retirement"
 *    explicitly rather than leaving the user to do it in their head.
 * 5. **Nominal pounds, in the money the salary was entered in.** For a final salary scheme, enter
 *    the salary you expect at retirement and the formula is exact. For a CARE (career average
 *    revalued earnings) scheme it is an approximation: a real CARE pension is the sum of each
 *    year's own slice, individually revalued to retirement, and a single salary figure can only
 *    stand in for the career-average revalued salary — which for a rising career is below the
 *    final one. The per-year salary history a CARE scheme would need is not in the data model and
 *    is not being invented here.
 * 6. **Everything is pure, and every money figure is rounded to whole pence**, matching `tax.js`
 *    and `salary-sacrifice.js`.
 *
 * **What this deliberately does not model**, all of which a real scheme applies and none of which
 * has a field in `Pension` to hold it: the early retirement reduction for drawing before the
 * scheme's normal pension age (commonly ~4% a year) and the corresponding late retirement uplift;
 * revaluation of deferred benefits and CARE slices before retirement; indexation in payment (CPI,
 * usually capped at 2.5% or 5%); the automatic 3/80ths lump sum classic 1/80th schemes pay on top;
 * commutation of pension for tax-free cash at a scheme factor (often around 12:1); a spouse's or
 * dependant's pension; Guaranteed Minimum Pension and State Pension integration in older schemes;
 * and income tax, which a DB pension is fully liable to as earned income. Every figure here is
 * therefore a gross, unindexed, at-normal-pension-age number, and consistently so.
 *
 * The module imports from `enums.js` and `fire.js` and nothing goes the other way — the same
 * one-directional shape `salary-sacrifice.js` has with `tax.js`.
 */

import { DEFINED_BENEFIT_PENSION_TYPES } from './enums.js';
import {
	DEFAULT_WITHDRAWAL_RATE,
	MAX_WITHDRAWAL_RATE,
	MIN_WITHDRAWAL_RATE,
	fireNumber
} from './fire.js';

/*
 * As in `tax.js`/`salary-sacrifice.js`, model types are referenced inline as
 * `import('./types.js').X` rather than re-declared as local `@typedef`s, because `index.js`
 * re-exports every module with `export *` and svelte-check reads two same-named top-level typedefs
 * as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* Accrual rates                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The accrual denominators UK schemes actually use, densest first — the options the form offers
 * before falling back to a typed percentage.
 *
 * For orientation rather than as scheme advice: 1/49th is the Local Government Pension Scheme,
 * 1/54th the NHS 2015 scheme, 1/57th Teachers' career average, 1/75th USS's DB section, and 1/60th
 * and 1/80th the two classic final salary shapes still common in private sector legacy schemes.
 *
 * @type {readonly number[]}
 */
export const COMMON_ACCRUAL_DENOMINATORS = Object.freeze([45, 49, 54, 57, 60, 75, 80]);

/** The most service any scheme will count, and the ceiling `model.js` validates `db_years` against. */
export const MAX_PENSIONABLE_YEARS = 100;

/**
 * How close a rate has to sit to `100 / denominator` before it is called that fraction (percentage
 * points). Half of the last place a two-decimal rate carries, so a stored `1.67` still reads as
 * 1/60th but `1.9%` — which is nobody's fraction — stays a percentage.
 */
const FRACTION_TOLERANCE = 0.005;

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
 * A Defined Benefit input as this module reads it — convention (2). Anything that is not a finite
 * number greater than zero is "not entered", and comes back as `null`.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function asRecordedInput(value) {
	const parsed = asFinite(
		typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
		0
	);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The accrual rate a "1/n" scheme accrues at, as a percentage of salary per year of service —
 * `60` in, `1.6666…` out.
 *
 * @param {number | null} [denominator] The n in 1/n.
 * @returns {number} (%) `0` for a denominator that is not a positive number.
 */
export function accrualRateFromDenominator(denominator = 0) {
	const n = asRecordedInput(denominator);
	return n === null ? 0 : 100 / n;
}

/**
 * The inverse: the n in 1/n for a given accrual rate. `null` when the rate is not recorded.
 *
 * @param {number | null} [ratePct] (%)
 * @returns {number | null}
 */
export function accrualDenominatorFromRate(ratePct = 0) {
	const rate = asRecordedInput(ratePct);
	return rate === null ? null : 100 / rate;
}

/**
 * @param {number} n
 * @returns {string} `n` with its English ordinal suffix — 60th, 49th, 43rd.
 */
function ordinal(n) {
	const lastTwo = n % 100;
	if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
	const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
	return `${n}${suffix}`;
}

/**
 * How a scheme would describe an accrual rate — `1.6667` in, `"1/60th"` out. Empty string when the
 * rate is not recorded or does not land on a whole fraction within {@link FRACTION_TOLERANCE}, so a
 * caller can fall back to showing the percentage.
 *
 * @param {number | null} [ratePct] (%)
 * @returns {string}
 */
export function accrualFractionLabel(ratePct = 0) {
	const rate = asRecordedInput(ratePct);
	if (rate === null || rate > 100) return '';

	const denominator = Math.round(100 / rate);
	if (denominator < 1) return '';
	return Math.abs(100 / denominator - rate) <= FRACTION_TOLERANCE
		? `1/${ordinal(denominator)}`
		: '';
}

/* -------------------------------------------------------------------------- */
/* The formula                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The Defined Benefit formula itself: accrual rate × pensionable salary × years of service.
 *
 * `null` when any of the three is not recorded (convention 2) — the caller has to distinguish "you
 * have not told me your salary yet" from "your pension is £0 a year", and a zero cannot do both.
 *
 * @param {number | null} [accrualRatePct] Accrual as a percentage of salary per year (%).
 * @param {number | null} [years] Total pensionable service when the pension is drawn — convention (4).
 * @param {number | null} [salary] Pensionable salary the accrual applies to (£/yr).
 * @returns {number | null} (£/yr)
 */
export function accruedIncome(accrualRatePct, years, salary) {
	const rate = asRecordedInput(accrualRatePct);
	const service = asRecordedInput(years);
	const pay = asRecordedInput(salary);
	if (rate === null || service === null || pay === null) return null;

	return roundMoney((rate / 100) * pay * Math.min(service, MAX_PENSIONABLE_YEARS));
}

/**
 * Whether a pension record is one of the two Defined Benefit types — the pots the `db_*` fields
 * apply to. Tolerant of anything, so a caller can hand it a raw record.
 *
 * @param {unknown} pension
 * @returns {boolean}
 */
export function isDefinedBenefit(pension) {
	const type = /** @type {{ type?: unknown }} */ (pension ?? {}).type;
	return DEFINED_BENEFIT_PENSION_TYPES.includes(
		/** @type {import('./enums.js').PensionType} */ (type)
	);
}

/**
 * The income one Defined Benefit scheme pays, in a single number: the stated figure if there is
 * one, the formula otherwise, and `0` when neither route has enough to go on.
 *
 * Non-Defined-Benefit pots return `0` — a DC pot's income comes from drawing down its `value`, not
 * from these fields, and is a different tab's arithmetic (#33).
 *
 * @param {Partial<import('./types.js').Pension> | null} [pension]
 * @returns {number} (£/yr)
 */
export function definedBenefitIncome(pension) {
	if (!isDefinedBenefit(pension)) return 0;

	const stated = asRecordedInput(pension?.db_annual_income);
	if (stated !== null) return roundMoney(stated);

	return accruedIncome(pension?.db_accrual_rate, pension?.db_years, pension?.db_salary) ?? 0;
}

/* -------------------------------------------------------------------------- */
/* One scheme, in full                                                         */
/* -------------------------------------------------------------------------- */

/** The `Pension` fields this module reads, in the order the form asks for them. */
export const DEFINED_BENEFIT_INPUTS = Object.freeze([
	'db_accrual_rate',
	'db_years',
	'db_salary',
	'db_annual_income'
]);

/**
 * Human labels for {@link DEFINED_BENEFIT_INPUTS}, so a caller naming a missing field does not have
 * to keep its own copy of the wording.
 *
 * @type {Record<string, string>}
 */
export const DEFINED_BENEFIT_INPUT_LABELS = Object.freeze({
	db_accrual_rate: 'accrual rate',
	db_years: 'years of service',
	db_salary: 'pensionable salary',
	db_annual_income: 'annual income'
});

/**
 * Everything known about one Defined Benefit scheme's income.
 *
 * @typedef {object} DefinedBenefitBreakdown
 * @property {string} id The pension's id, unchanged.
 * @property {string} name
 * @property {import('./enums.js').PensionType | null} type
 * @property {boolean} isDefinedBenefit `false` for a DC/SIPP/LISA/State pot handed in by mistake —
 *   every figure below is then zero or null.
 * @property {'stated' | 'accrual' | 'none'} source Which route produced `annualIncome` —
 *   convention (3). `'none'` when neither had enough recorded.
 * @property {number | null} accrualRate (%) as recorded, or `null`.
 * @property {string} accrualFraction e.g. `"1/60th"`; empty when the rate is not a whole fraction.
 * @property {number | null} years Total pensionable service at retirement — convention (4).
 * @property {number | null} salary Pensionable salary (£/yr).
 * @property {number | null} accruedIncome What the formula gives (£/yr), or `null` if it cannot run.
 * @property {number | null} statedIncome The figure off the scheme statement (£/yr), or `null`.
 * @property {number} annualIncome The income this scheme pays (£/yr) — `0` when `source` is `'none'`.
 * @property {number} monthlyIncome The same figure a twelfth at a time (£/mo).
 * @property {number | null} replacementRate `annualIncome` as a share of `salary` (%), or `null`
 *   when no salary is recorded to compare against.
 * @property {string[]} missingInputs Which of the three accrual fields are not recorded, in
 *   {@link DEFINED_BENEFIT_INPUTS} order. Empty once the formula can run — including when a stated
 *   income means it never needs to.
 * @property {boolean} complete Whether this scheme produces an income at all.
 * @property {number | null} routeDifference `statedIncome − accruedIncome` (£/yr) when both routes
 *   are available, `null` otherwise. A large gap is usually a mistyped input.
 */

/**
 * Work one Defined Benefit scheme out in full. Tolerant of a partial or malformed record: anything
 * missing simply lands in `missingInputs`.
 *
 * @param {Partial<import('./types.js').Pension> | null} [pension]
 * @returns {DefinedBenefitBreakdown}
 */
export function definedBenefitBreakdown(pension) {
	const source = pension ?? {};
	const isDb = isDefinedBenefit(source);

	const accrualRate = isDb ? asRecordedInput(source.db_accrual_rate) : null;
	const years = isDb ? asRecordedInput(source.db_years) : null;
	const salary = isDb ? asRecordedInput(source.db_salary) : null;
	const statedIncome = isDb ? asRecordedInput(source.db_annual_income) : null;
	const accrued = isDb ? accruedIncome(accrualRate, years, salary) : null;

	const route = statedIncome !== null ? 'stated' : accrued !== null ? 'accrual' : 'none';
	const annualIncome = roundMoney(statedIncome ?? accrued ?? 0);

	/** @type {string[]} */
	const missingInputs = [];
	if (route !== 'stated') {
		if (accrualRate === null) missingInputs.push('db_accrual_rate');
		if (years === null) missingInputs.push('db_years');
		if (salary === null) missingInputs.push('db_salary');
	}

	return {
		id: typeof source.id === 'string' ? source.id : '',
		name: typeof source.name === 'string' ? source.name : '',
		type: /** @type {import('./enums.js').PensionType | null} */ (source.type ?? null),
		isDefinedBenefit: isDb,
		source: route,
		accrualRate,
		accrualFraction: accrualRate === null ? '' : accrualFractionLabel(accrualRate),
		years,
		salary,
		accruedIncome: accrued,
		statedIncome,
		annualIncome,
		monthlyIncome: roundMoney(annualIncome / 12),
		replacementRate: salary === null ? null : (annualIncome / salary) * 100,
		missingInputs,
		complete: route !== 'none',
		routeDifference:
			statedIncome !== null && accrued !== null ? roundMoney(statedIncome - accrued) : null
	};
}

/* -------------------------------------------------------------------------- */
/* Projecting service forward                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What another stretch of service is worth — convention (4)'s escape hatch.
 *
 * @typedef {object} DefinedBenefitProjection
 * @property {'stated' | 'accrual' | 'none'} basis Which route the projection ran on. A `'stated'`
 *   income cannot be projected — it is already the scheme's own figure for retirement — so it comes
 *   back unchanged, and `extraYears`/`salaryGrowthRate` are ignored.
 * @property {number} extraYears Further years of service applied.
 * @property {number} salaryGrowthRate Annual salary growth applied over those years (%).
 * @property {number | null} years Total service at retirement, or `null` on a `'stated'`/`'none'` basis.
 * @property {number | null} salary Pensionable salary at retirement (£/yr), grown from the recorded one.
 * @property {number} annualIncome Projected income (£/yr).
 * @property {number} monthlyIncome (£/mo).
 * @property {number} uplift How much the extra service and salary growth added (£/yr).
 */

/** How far ahead a projection will run, in years — the same ceiling `db_years` is validated against. */
export const MAX_PROJECTION_YEARS = MAX_PENSIONABLE_YEARS;

/**
 * Project a scheme's income forward by a further stretch of service, optionally with the salary
 * growing over it.
 *
 * This is the answer to "my statement says 12 years of service — what will it be when I retire at
 * 67?" Both extra years and salary growth compound into the same formula: service adds linearly,
 * salary multiplies, so ten more years on a rising salary moves the number a long way.
 *
 * The salary growth is nominal, so entering a real (above-inflation) rate gives an income in
 * today's money — the same convention `fire.js` documents for its own growth rate. For a CARE
 * scheme, convention (5) applies with extra force here: growing one salary figure and multiplying
 * by total service is the final salary formula, and it overstates a career average pension.
 *
 * @param {Partial<import('./types.js').Pension> | null} [pension]
 * @param {object} [options]
 * @param {number} [options.extraYears] Further years of pensionable service. Negative reads as zero.
 * @param {number} [options.salaryGrowthRate] Annual salary growth over those years (%).
 * @returns {DefinedBenefitProjection}
 */
export function projectDefinedBenefit(pension, options = {}) {
	const breakdown = definedBenefitBreakdown(pension);
	const extraYears = Math.min(Math.max(0, asFinite(options.extraYears, 0)), MAX_PROJECTION_YEARS);
	const salaryGrowthRate = asFinite(options.salaryGrowthRate, 0);

	if (breakdown.source !== 'accrual') {
		return {
			basis: breakdown.source,
			extraYears,
			salaryGrowthRate,
			years: null,
			salary: null,
			annualIncome: breakdown.annualIncome,
			monthlyIncome: breakdown.monthlyIncome,
			uplift: 0
		};
	}

	const years = Math.min(
		/** @type {number} */ (breakdown.years) + extraYears,
		MAX_PENSIONABLE_YEARS
	);
	const salary = roundMoney(
		/** @type {number} */ (breakdown.salary) * (1 + salaryGrowthRate / 100) ** extraYears
	);
	const annualIncome = accruedIncome(breakdown.accrualRate, years, salary) ?? 0;

	return {
		basis: 'accrual',
		extraYears,
		salaryGrowthRate,
		years,
		salary,
		annualIncome,
		monthlyIncome: roundMoney(annualIncome / 12),
		uplift: roundMoney(annualIncome - breakdown.annualIncome)
	};
}

/* -------------------------------------------------------------------------- */
/* Every scheme together                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The Defined Benefit half of a retirement income, across every scheme recorded.
 *
 * @typedef {object} DefinedBenefitTotals
 * @property {DefinedBenefitBreakdown[]} schemes One per Defined Benefit pot, input order kept.
 *   Non-Defined-Benefit pots are filtered out rather than reported as zeroes.
 * @property {number} count How many Defined Benefit schemes there are.
 * @property {number} completeCount How many of them produce an income.
 * @property {number} incompleteCount How many are still missing an input.
 * @property {number} annualIncome Total guaranteed income (£/yr).
 * @property {number} monthlyIncome The same, a twelfth at a time (£/mo).
 * @property {number} withdrawalRate The rate {@link DefinedBenefitTotals.capitalEquivalent} was
 *   worked out at (%), clamped to the range `fire.js` accepts.
 * @property {number} capitalEquivalent The DC pot it would take to buy the same income at that
 *   withdrawal rate (£) — the figure that makes a DB pension comparable with the rest of this app.
 */

/**
 * Add up every Defined Benefit scheme in a `pensions` list.
 *
 * The `capitalEquivalent` is `fire.js`'s own `fireNumber` run on the total income, so "what is my
 * DB pension worth as a pot" and "what pot do I need for this income" are answered by one piece of
 * arithmetic rather than two that could drift. It is a comparison figure, not a transfer value: a
 * scheme's cash equivalent transfer value is set by the scheme's actuary on assumptions this app
 * has no access to, and a DB pension's inflation-linking and payment-for-life make it worth rather
 * more than a pot drawn at a fixed rate.
 *
 * @param {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @param {number} [withdrawalRatePct] The rate the capital equivalent is priced at (%).
 * @returns {DefinedBenefitTotals}
 */
export function definedBenefitTotals(pensions = [], withdrawalRatePct = DEFAULT_WITHDRAWAL_RATE) {
	const schemes = (Array.isArray(pensions) ? pensions : [])
		.filter(isDefinedBenefit)
		.map(definedBenefitBreakdown);

	const annualIncome = roundMoney(
		schemes.reduce((total, scheme) => total + scheme.annualIncome, 0)
	);
	const completeCount = schemes.filter((scheme) => scheme.complete).length;
	const withdrawalRate = Math.min(
		Math.max(asFinite(withdrawalRatePct, DEFAULT_WITHDRAWAL_RATE), MIN_WITHDRAWAL_RATE),
		MAX_WITHDRAWAL_RATE
	);

	return {
		schemes,
		count: schemes.length,
		completeCount,
		incompleteCount: schemes.length - completeCount,
		annualIncome,
		monthlyIncome: roundMoney(annualIncome / 12),
		withdrawalRate,
		capitalEquivalent: fireNumber(annualIncome, withdrawalRate)
	};
}
