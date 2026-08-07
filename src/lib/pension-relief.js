/**
 * Pension tax relief per pot — README.md → "Pension Tracker": "Tax relief display per pot (20%
 * basic, 40% higher — claim extra via Self Assessment)" — issue #32.
 *
 * A DC Workplace or SIPP pot's `contribution_pct` is the same "your contribution" figure
 * `PensionTracker.svelte` already shows on the pot's row — the member's own contribution as a
 * percentage of `profile.gross_salary`. What this module adds is what HMRC does with it: a
 * relief-at-source provider claims basic-rate relief automatically, so the amount that lands in the
 * pot is already more than what left the member's take-home pay, and a higher- or additional-rate
 * taxpayer is entitled to the rest of the relief at their marginal rate — but only gets it by
 * claiming it back through Self Assessment, since it is never added to the pot itself.
 *
 * Four conventions decide what the numbers here mean:
 *
 * 1. **`contribution_pct` is read as the amount the member's own pay is short by, before relief is
 *    added** — the net, relief-at-source contribution, matching how gov.uk itself describes a
 *    workplace scheme's minimum ("you pay 4%, get 1% tax relief, for 5% total"). Grossing this up
 *    ({@link grossUpContribution}) is what makes the automatic 20% visible; reading the field as
 *    already-gross would leave nothing here to add.
 * 2. **Relief is assessed at the member's marginal rate on their whole salary**, via `tax.js`'s
 *    `marginalTaxRate`, rather than sliced band-by-band the way `salary-sacrifice.js`'s
 *    `sacrificeSlices` treats a sacrifice. A personal contribution does not reduce the salary the way
 *    a sacrifice does, and slicing it would double-count relief already reflected in the 60% taper
 *    band's own marginal rate; one flat rate per pot is the simpler reading, and still correct at the
 *    margin. See "what this deliberately does not model" below for what that gives up.
 * 3. **Basic-rate relief (20%) is always the first slice**, whatever the member's marginal rate is.
 *    Anything above 20% is the "extra" README.md's wording refers to, and is `0` for a basic-rate (or
 *    non-) taxpayer.
 * 4. **Only `dc_workplace` and `sipp` pots get this treatment.** A Lifetime ISA's 25% top-up is a
 *    government bonus on savings, not income tax relief on earnings — it does not vary with the
 *    member's tax rate and cannot be topped up via Self Assessment, so folding it into these numbers
 *    would be wrong twice over. {@link isReliefEligible} returns `false` for `lisa`, and
 *    {@link pensionReliefSummary} carries LISA pots separately, uncalculated. Defined Benefit and
 *    State pots have no personal contribution field at all and are dropped entirely, the same as
 *    `defined-benefit.js` drops a non-Defined-Benefit pot handed to it.
 *
 * **What this deliberately does not model**: the £3,600 gross "relief on relief" floor that lets even
 * a non-earner's contribution be grossed up (so a real contribution against a £0 salary would still
 * carry relief, which convention (2) above does not give it); the tapered and money-purchase annual
 * allowances `salary-sacrifice.js` also leaves out; employer contributions, which are never the
 * employee's income and so never attract personal tax relief; and net-pay-arrangement workplace
 * schemes, where relief at every rate is automatic because the contribution never leaves gross pay in
 * the first place — this module always assumes relief-at-source, the SIPP-standard case and the one
 * that actually needs a "claim extra via Self Assessment" note.
 *
 * Every figure is in pounds, rounded to whole pence, matching `tax.js`. Rates are whole-number
 * percents. The module imports from `enums.js` and `tax.js` and nothing goes the other way, the same
 * one-directional shape `salary-sacrifice.js` and `defined-benefit.js` have.
 */

import { marginalTaxRate } from './tax.js';

/*
 * As in `tax.js`/`salary-sacrifice.js`/`defined-benefit.js`, model types are referenced inline as
 * `import('./types.js').X` rather than re-declared as local `@typedef`s, because `index.js`
 * re-exports every module with `export *` and svelte-check reads two same-named top-level typedefs
 * as an ambiguous export.
 */

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

/** @param {unknown} value @returns {number} A non-negative, finite amount of money. */
function asMoney(value) {
	return Math.max(0, asFinite(value, 0));
}

/* -------------------------------------------------------------------------- */
/* The tax year                                                                */
/* -------------------------------------------------------------------------- */

/** The tax year every figure in this module belongs to — matches `tax.js`'s `TAX_YEAR`. */
export const PENSION_RELIEF_TAX_YEAR = '2026/27';

/** The rate a relief-at-source provider adds automatically, whatever the member's own rate is (%). */
export const BASIC_RATE_RELIEF_PCT = 20;

/**
 * The pot types a personal contribution attracts income tax relief on — convention (4). Every other
 * `PensionType` is either a Defined Benefit/State pot with no contribution field, or a Lifetime ISA,
 * whose 25% top-up is a different mechanism entirely (see {@link isLifetimeIsa}).
 *
 * @type {readonly import('./enums.js').PensionType[]}
 */
export const RELIEF_ELIGIBLE_PENSION_TYPES = Object.freeze(['dc_workplace', 'sipp']);

/**
 * Whether a pension type is one a personal contribution attracts income tax relief on.
 *
 * @param {unknown} type
 * @returns {boolean}
 */
export function isReliefEligible(type) {
	return RELIEF_ELIGIBLE_PENSION_TYPES.includes(
		/** @type {import('./enums.js').PensionType} */ (type)
	);
}

/**
 * Whether a pension type is a Lifetime ISA — the one `PENSION_POT_TYPES` member that is neither
 * relief-eligible nor a Defined Benefit/State pot, and so needs its own explanatory note rather than
 * silently vanishing from a per-pot list.
 *
 * @param {unknown} type
 * @returns {boolean}
 */
export function isLifetimeIsa(type) {
	return type === 'lisa';
}

/* -------------------------------------------------------------------------- */
/* Grossing up a relief-at-source contribution                                 */
/* -------------------------------------------------------------------------- */

/**
 * The member's own annual contribution to one pot, before relief is added — convention (1).
 *
 * @param {Partial<import('./types.js').Pension> | null} [pension]
 * @param {number} [salary] `profile.gross_salary` (£/yr).
 * @returns {number} (£/yr)
 */
export function ownContribution(pension, salary = 0) {
	const pct = asMoney(pension?.contribution_pct);
	return roundMoney((asMoney(salary) * pct) / 100);
}

/**
 * Gross a relief-at-source contribution up to what actually lands in the pot: a £80 net payment
 * becomes £100, since the £20 the provider claims from HMRC is 20% of the gross figure, not of the
 * £80 paid in.
 *
 * @param {number} [netContribution] (£/yr)
 * @returns {number} (£/yr)
 */
export function grossUpContribution(netContribution = 0) {
	const net = asMoney(netContribution);
	return roundMoney((net * 100) / (100 - BASIC_RATE_RELIEF_PCT));
}

/**
 * The basic-rate relief a provider adds automatically (£/yr) — the gap {@link grossUpContribution}
 * opens up between what was paid in and what landed in the pot.
 *
 * @param {number} [netContribution] (£/yr)
 * @returns {number} (£/yr)
 */
export function basicRateRelief(netContribution = 0) {
	return roundMoney(grossUpContribution(netContribution) - asMoney(netContribution));
}

/* -------------------------------------------------------------------------- */
/* One pot, in full                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Everything known about one pot's tax relief.
 *
 * @typedef {object} PensionReliefBreakdown
 * @property {string} id The pension's id, unchanged.
 * @property {string} name
 * @property {import('./enums.js').PensionType | null} type
 * @property {boolean} eligible Whether this pot attracts income tax relief at all — `false` for a
 *   Lifetime ISA, Defined Benefit or State pot, where every figure below is `0`.
 * @property {number} netContribution What actually left the member's take-home pay (£/yr).
 * @property {number} grossContribution What landed in the pot (£/yr) — `netContribution` plus
 *   {@link PensionReliefBreakdown.basicRateRelief}.
 * @property {number} basicRateRelief The automatic 20% relief a relief-at-source provider added
 *   (£/yr) — already inside `grossContribution`, not extra to claim.
 * @property {number} marginalRate The rate the member's next pound of salary is taxed at (%),
 *   `tax.js`'s own `marginalTaxRate` — convention (2).
 * @property {number} extraReliefRate How much of `marginalRate` sits above the 20% already given
 *   (percentage points). `0` for a basic-rate or non-taxpayer.
 * @property {number} extraRelief What the member can claim back via Self Assessment (£/yr) — `0`
 *   when `extraReliefRate` is `0`.
 * @property {boolean} claimableViaSelfAssessment Whether there is anything to claim.
 * @property {number} totalRelief `basicRateRelief` plus `extraRelief` (£/yr) — the whole tax saving
 *   this contribution earns, in the pot and out of it combined.
 */

/**
 * Work one pot's tax relief out in full. Tolerant of a partial or malformed record: an ineligible
 * pot (Lifetime ISA, Defined Benefit, State, or anything else) comes back with every figure `0`
 * rather than throwing, the same tolerance `defined-benefit.js`'s `definedBenefitBreakdown` gives a
 * DC pot handed to it.
 *
 * @param {Partial<import('./types.js').Pension> | null} [pension]
 * @param {Partial<import('./types.js').Profile> | null} [profile]
 * @returns {PensionReliefBreakdown}
 */
export function pensionReliefBreakdown(pension, profile) {
	const source = pension ?? {};
	const salary = asMoney(profile?.gross_salary);
	const eligible = isReliefEligible(source.type);

	const netContribution = eligible ? ownContribution(source, salary) : 0;
	const grossContribution = eligible ? grossUpContribution(netContribution) : 0;
	const relief = eligible ? basicRateRelief(netContribution) : 0;

	const marginalRate = eligible ? marginalTaxRate(salary, profile?.tax_region) : 0;
	const extraReliefRate = Math.max(0, marginalRate - BASIC_RATE_RELIEF_PCT);
	const extraRelief = eligible ? roundMoney((grossContribution * extraReliefRate) / 100) : 0;

	return {
		id: typeof source.id === 'string' ? source.id : '',
		name: typeof source.name === 'string' ? source.name : '',
		type: /** @type {import('./enums.js').PensionType | null} */ (source.type ?? null),
		eligible,
		netContribution,
		grossContribution,
		basicRateRelief: relief,
		marginalRate,
		extraReliefRate,
		extraRelief,
		claimableViaSelfAssessment: extraRelief > 0,
		totalRelief: roundMoney(relief + extraRelief)
	};
}

/* -------------------------------------------------------------------------- */
/* Every pot together                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The relief-eligible half of a `pensions` list, totalled up.
 *
 * @typedef {object} PensionReliefSummary
 * @property {PensionReliefBreakdown[]} pots One per relief-eligible pot (`dc_workplace`/`sipp`),
 *   input order kept.
 * @property {import('./types.js').Pension[]} lisaPots Lifetime ISA pots from the same list,
 *   unmodified — carried separately per convention (4) rather than reported as zero relief.
 * @property {number} count How many relief-eligible pots there are.
 * @property {number} claimingCount How many of them have relief left to claim via Self Assessment.
 * @property {number} netContribution Total paid in from take-home pay, across every eligible pot
 *   (£/yr).
 * @property {number} grossContribution Total landing in eligible pots (£/yr).
 * @property {number} basicRateRelief Total automatic relief, already inside `grossContribution`
 *   (£/yr).
 * @property {number} extraRelief Total still to claim via Self Assessment (£/yr).
 * @property {number} totalRelief `basicRateRelief` plus `extraRelief` (£/yr).
 */

/**
 * Add up every relief-eligible pot in a `pensions` list.
 *
 * @param {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @param {Partial<import('./types.js').Profile> | null} [profile]
 * @returns {PensionReliefSummary}
 */
export function pensionReliefSummary(pensions, profile) {
	const list = Array.isArray(pensions) ? pensions : [];

	const pots = list
		.filter((pension) => isReliefEligible(pension.type))
		.map((pension) => pensionReliefBreakdown(pension, profile));
	const lisaPots = /** @type {import('./types.js').Pension[]} */ (
		list.filter((pension) => isLifetimeIsa(pension.type))
	);

	const sum = (/** @type {(pot: PensionReliefBreakdown) => number} */ pick) =>
		roundMoney(pots.reduce((total, pot) => total + pick(pot), 0));

	return {
		pots,
		lisaPots,
		count: pots.length,
		claimingCount: pots.filter((pot) => pot.claimableViaSelfAssessment).length,
		netContribution: sum((pot) => pot.netContribution),
		grossContribution: sum((pot) => pot.grossContribution),
		basicRateRelief: sum((pot) => pot.basicRateRelief),
		extraRelief: sum((pot) => pot.extraRelief),
		totalRelief: sum((pot) => pot.totalRelief)
	};
}
