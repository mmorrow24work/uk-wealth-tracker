/**
 * High Income Child Benefit Charge (HICBC), 2026/27 — README.md → "UK Income Tax Calculator
 * (2026/27)": "High Income Child Benefit Charge (HICBC) — post-April 2024 rules (£60k threshold,
 * £80k full clawback)" — issue #24.
 *
 * HICBC is not income tax. It is a separate charge, assessed on one individual, that claws back
 * Child Benefit somebody else in the household may have received — so it lives in its own module
 * rather than inside `tax.js`'s band arithmetic, and only borrows `tax.js` for the one place the
 * two genuinely meet: the rate on the next pound of income.
 *
 * Five conventions decide what the numbers here mean:
 *
 * 1. **Post-April-2024 rules only.** The charge starts at £60,000 of adjusted net income and takes
 *    1% of the year's Child Benefit for every £200 above it, so it equals the whole benefit at
 *    £80,000 — the two figures README.md states. The pre-April-2024 £50,000/£100 ladder is not
 *    modelled at all; this app has no prior tax year (see `tax.js`'s `TAX_YEAR`).
 * 2. **The percentage is a whole number, and it steps.** `(income − £60,000) / £200`, rounded
 *    *down*. £60,199 and £60,000 both give 0%; the first pound of charge appears at £60,200. That
 *    makes the true marginal cost a £200-wide staircase rather than a smooth slope, which
 *    {@link hicbcMarginalRate} reports as the average gradient across a step — see its note.
 * 3. **The charge falls on one person: whoever has the higher adjusted net income.** It is not a
 *    household charge and it is not the claimant's charge. A £70,000 earner whose partner earns
 *    £75,000 owes nothing — the partner does. On an exact tie this module treats the charge as the
 *    user's; in law the tie is broken by reference to who actually receives the benefit, which this
 *    app does not model (nobody's Child Benefit claim is stored — see convention 5).
 * 4. **Entitlement is derived from a count of children, or supplied directly.** The weekly rates
 *    below give the full-year figure for a family whose circumstances did not change. A part-year
 *    claim (a child born in November, a child who left full-time education in June) is not a count
 *    of children, so `annualBenefit` can be passed instead and everything downstream uses it.
 * 5. **Income in, charge out — nothing is persisted.** `Profile` has no children, no Child Benefit
 *    claim and no partner (README.md's data model lists none of them, and household/partner
 *    planning is Phase 2), so the tab's inputs are session-only, exactly as the salary on the tax
 *    tab already is.
 *
 * Every figure is in pounds, rounded to whole pence, except `percentage`, which is a whole-number
 * percent by law. Everything is pure.
 *
 * **Sourcing note.** The £60,000/£80,000 thresholds and the 1%-per-£200 step are README.md's own
 * stated rules, restated here. The Child Benefit weekly rates are *not* in README.md and had to
 * come from elsewhere — see {@link CHILD_BENEFIT_ELDEST_WEEKLY}, which records where they came from
 * and how to check them. They are the only figures in this module not traceable to the repo's own
 * spec.
 */

import { marginalTaxRate, normaliseTaxRegion, takeHomePay } from './tax.js';

/*
 * As in `tax.js`/`fire.js`, model types are referenced inline as `import('./types.js').X` rather
 * than re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *`
 * and svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* Child Benefit                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Child Benefit for the eldest or only child (£/week), 2026/27.
 *
 * **Where this figure comes from, and how to check it.** Unlike every threshold below it, this rate
 * is not in README.md — the spec names HICBC's £60k/£80k boundaries but not the benefit those
 * boundaries claw back, and CLAUDE.md's rule ("match README.md's stated figures exactly rather than
 * substituting general knowledge") therefore has nothing to match against here. Child Benefit is
 * uprated every April by the previous September's CPI and published on gov.uk's "Child Benefit
 * rates" page; this is the 2026/27 figure, being the 2025/26 rate of £26.05 uprated and rounded to
 * the nearest 5p in the usual way. Re-check it against gov.uk at the start of each tax year,
 * alongside `tax.js`'s bands — `hicbc.test.js` pins both rates so a change is a deliberate edit.
 */
export const CHILD_BENEFIT_ELDEST_WEEKLY = 27.05;

/** Child Benefit for each additional child (£/week), 2026/27 — same sourcing note as above. */
export const CHILD_BENEFIT_ADDITIONAL_WEEKLY = 17.9;

/**
 * Child Benefit is a weekly entitlement, and the tax year is treated as 52 weeks of it. HMRC's own
 * annual figures (£1,406.60 for one child in 2026/27) are the weekly rate times 52, so this is the
 * multiplier that reproduces the published annual amounts rather than an approximation of a year.
 */
export const CHILD_BENEFIT_WEEKS_PER_YEAR = 52;

/** Child Benefit is normally paid every four weeks — the amount that actually lands in an account. */
export const CHILD_BENEFIT_WEEKS_PER_PAYMENT = 4;

/* -------------------------------------------------------------------------- */
/* The charge                                                                  */
/* -------------------------------------------------------------------------- */

/** Adjusted net income at which the charge starts (£) — README.md's "£60k threshold". */
export const HICBC_THRESHOLD = 60_000;

/**
 * Adjusted net income at which the charge equals the whole year's Child Benefit (£) — README.md's
 * "£80k full clawback".
 */
export const HICBC_FULL_CLAWBACK_AT = 80_000;

/**
 * 1% of the year's Child Benefit is charged for every £200 of income above the threshold.
 *
 * The three constants are not independent: `(80,000 − 60,000) / 200 = 100`, so the £200 step is
 * exactly what makes README.md's two thresholds 100 percentage points apart. A test asserts that,
 * because a future rules change that moved one boundary without the others would otherwise leave
 * the clawback silently incomplete (or over-complete) rather than failing.
 */
export const HICBC_INCOME_PER_PERCENT = 200;

/** The tax year every figure in this module belongs to — matches `tax.js`'s `TAX_YEAR`. */
export const HICBC_TAX_YEAR = '2026/27';

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

/** @param {unknown} value @returns {number} A non-negative, finite amount of money. */
function asMoney(value) {
	return Math.max(0, asFinite(value, 0));
}

/** @param {unknown} value @returns {number} A non-negative whole number of children. */
function asChildCount(value) {
	return Math.floor(Math.max(0, asFinite(value, 0)));
}

/* -------------------------------------------------------------------------- */
/* Entitlement                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Child Benefit for a family of `children` children (£/week). The first child is paid at the higher
 * rate and every other child at the lower one, so this is not a simple multiple.
 *
 * @param {number} [children]
 * @returns {number} (£/week)
 */
export function childBenefitWeekly(children = 0) {
	const count = asChildCount(children);
	if (count === 0) return 0;
	return roundMoney(CHILD_BENEFIT_ELDEST_WEEKLY + (count - 1) * CHILD_BENEFIT_ADDITIONAL_WEEKLY);
}

/**
 * A full year of Child Benefit for `children` children (£/yr) — the amount the charge is a
 * percentage *of*.
 *
 * @param {number} [children]
 * @returns {number} (£/yr)
 */
export function childBenefitEntitlement(children = 0) {
	return roundMoney(childBenefitWeekly(children) * CHILD_BENEFIT_WEEKS_PER_YEAR);
}

/**
 * What actually arrives in the bank, four weeks at a time (£).
 *
 * @param {number} [children]
 * @returns {number}
 */
export function childBenefitPerPayment(children = 0) {
	return roundMoney(childBenefitWeekly(children) * CHILD_BENEFIT_WEEKS_PER_PAYMENT);
}

/* -------------------------------------------------------------------------- */
/* The percentage                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The share of the year's Child Benefit clawed back at a given adjusted net income (%) —
 * convention (2): 1 point per whole £200 above £60,000, rounded down, capped at 100.
 *
 * @param {number} [adjustedNetIncome] (£/yr)
 * @returns {number} A whole number, 0–100.
 */
export function hicbcPercentage(adjustedNetIncome = 0) {
	const income = asMoney(adjustedNetIncome);
	if (income <= HICBC_THRESHOLD) return 0;
	if (income >= HICBC_FULL_CLAWBACK_AT) return 100;
	return Math.floor((income - HICBC_THRESHOLD) / HICBC_INCOME_PER_PERCENT);
}

/**
 * Whether an income sits inside the clawback range — above the threshold, but not yet losing the
 * whole benefit. The lower edge is exclusive (at exactly £60,000 there is no charge) and the upper
 * edge is too (at £80,000 the benefit is gone entirely rather than tapering).
 *
 * @param {number} [adjustedNetIncome]
 * @returns {boolean}
 */
export function inChargeBand(adjustedNetIncome = 0) {
	const income = asMoney(adjustedNetIncome);
	return income > HICBC_THRESHOLD && income < HICBC_FULL_CLAWBACK_AT;
}

/**
 * The charge itself (£/yr): a percentage of the Child Benefit actually received.
 *
 * @param {number} [annualBenefit] Child Benefit received in the year (£/yr).
 * @param {number} [adjustedNetIncome] (£/yr)
 * @returns {number} (£/yr)
 */
export function childBenefitCharge(annualBenefit = 0, adjustedNetIncome = 0) {
	return roundMoney((asMoney(annualBenefit) * hicbcPercentage(adjustedNetIncome)) / 100);
}

/**
 * How much extra income tax-and-charge the *next* pound costs because of HICBC alone (%).
 *
 * Each £200 of income costs another 1% of the year's benefit, so the gradient is
 * `benefit / 200` percent — 7.03% for one child, 11.69% for two, on top of whatever `tax.js` says
 * the band rate is. Outside the £60,000–£80,000 range it is zero.
 *
 * This is the *average* gradient across a £200 step, not the rate on one literal next pound:
 * convention (2)'s whole-number percentage means the true cost is £0 for 199 pounds and then a jump
 * of 1% of the benefit on the 200th. Averaging is the only reading that describes a pay rise, which
 * is the question the figure is on screen to answer.
 *
 * @param {number} [annualBenefit] (£/yr)
 * @param {number} [adjustedNetIncome] (£/yr)
 * @returns {number} (%)
 */
export function hicbcMarginalRate(annualBenefit = 0, adjustedNetIncome = 0) {
	if (!inChargeBand(adjustedNetIncome)) return 0;
	return asMoney(annualBenefit) / HICBC_INCOME_PER_PERCENT;
}

/**
 * The reduction in adjusted net income that would clear the charge completely (£) — what a pension
 * contribution, salary sacrifice or Gift Aid donation would have to cover to bring income back to
 * £60,000. Zero for anyone not above the threshold.
 *
 * @param {number} [adjustedNetIncome]
 * @returns {number} (£)
 */
export function incomeToClearCharge(adjustedNetIncome = 0) {
	return roundMoney(Math.max(0, asMoney(adjustedNetIncome) - HICBC_THRESHOLD));
}

/* -------------------------------------------------------------------------- */
/* Who pays                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Which member of a couple the charge falls on — convention (3).
 *
 * `'neither'` covers both "nobody is over £60,000" and "no Child Benefit is being received", since
 * either alone means there is no charge to allocate.
 *
 * @typedef {'you' | 'partner' | 'neither'} ChargeBearer
 */

/**
 * Who owes the charge, given both incomes.
 *
 * @param {number} [income] Your adjusted net income (£/yr).
 * @param {number} [partnerIncome] Your partner's (£/yr); `0` when there is no partner.
 * @returns {ChargeBearer}
 */
export function chargeBearer(income = 0, partnerIncome = 0) {
	const yours = asMoney(income);
	const theirs = asMoney(partnerIncome);
	const highest = Math.max(yours, theirs);
	if (highest <= HICBC_THRESHOLD) return 'neither';
	// Ties are treated as the user's — see convention (3) on why the law's tie-break is unmodellable
	// here.
	return yours >= theirs ? 'you' : 'partner';
}

/* -------------------------------------------------------------------------- */
/* The whole calculation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Everything the child benefit panel's controls describe.
 *
 * @typedef {object} ChildBenefitInput
 * @property {number} income Your adjusted net income for the year (£/yr).
 * @property {number} partnerIncome Your partner's adjusted net income (£/yr); `0` for no partner.
 * @property {number} children How many children Child Benefit is claimed for.
 * @property {number | null} annualBenefit Child Benefit actually received in the year (£/yr),
 *   overriding the figure derived from `children` — convention (4)'s part-year seam.
 * @property {boolean} claiming Whether the payments are being received at all. Opting out of the
 *   payments (while keeping the claim, and with it the National Insurance credits) leaves nothing
 *   to claw back.
 * @property {import('./enums.js').TaxRegion} region Only used for the marginal-rate figures.
 */

/**
 * A full HICBC calculation — README.md's "High Income Child Benefit Charge (HICBC) — post-April
 * 2024 rules".
 *
 * @typedef {object} ChildBenefitBreakdown
 * @property {string} taxYear Always {@link HICBC_TAX_YEAR}.
 * @property {import('./enums.js').TaxRegion} region
 * @property {number} income Your adjusted net income (£/yr).
 * @property {number} partnerIncome Your partner's (£/yr).
 * @property {number} children
 * @property {boolean} claiming
 * @property {number} weeklyBenefit Entitlement (£/week); `0` when not claiming.
 * @property {number} perPaymentBenefit Entitlement per four-weekly payment (£).
 * @property {number} annualBenefit Child Benefit received across the year (£/yr).
 * @property {ChargeBearer} bearer Who owes the charge.
 * @property {boolean} liable Whether *you* owe it.
 * @property {number} chargeIncome The income the charge is actually assessed on (£/yr) — yours or
 *   your partner's, whichever is higher.
 * @property {number} percentage Share of the benefit clawed back (%), a whole number.
 * @property {number} charge The charge itself (£/yr).
 * @property {number} netBenefit Benefit received less the charge (£/yr) — what the household keeps.
 * @property {boolean} inChargeBand Whether the assessed income is inside £60,000–£80,000.
 * @property {boolean} fullyClawedBack Whether the charge cancels the benefit out entirely.
 * @property {number} headroom Income the assessed person could still gain before any charge starts
 *   (£); `0` once over the threshold.
 * @property {number} incomeToClearCharge Reduction in the assessed income that would remove the
 *   charge entirely (£).
 * @property {number} incomeTaxMarginalRate Rate on your next pound from `tax.js` alone (%).
 * @property {number} hicbcMarginalRate What HICBC adds to it (%) — `0` unless you are the one
 *   liable and inside the band.
 * @property {number} combinedMarginalRate The two together (%).
 * @property {number} takeHomeAfterCharge Your income, less income tax, less any charge you owe
 *   (£/yr) — still before National Insurance, student loan and pension contributions, exactly as
 *   `tax.js`'s take-home figures are.
 */

/**
 * The child benefit panel's single entry point: incomes, a count of children and whether the money
 * is being taken, in — every figure the panel shows, out.
 *
 * @param {Partial<ChildBenefitInput>} [raw]
 * @returns {ChildBenefitBreakdown}
 */
export function childBenefitSummary(raw = {}) {
	const income = asMoney(raw.income);
	const partnerIncome = asMoney(raw.partnerIncome);
	const children = asChildCount(raw.children);
	const claiming = raw.claiming ?? true;
	const region = normaliseTaxRegion(raw.region);

	const entitlement =
		raw.annualBenefit === null || raw.annualBenefit === undefined
			? childBenefitEntitlement(children)
			: asMoney(raw.annualBenefit);
	const annualBenefit = claiming ? entitlement : 0;

	// Nobody owes a charge on Child Benefit that isn't being received, whatever the incomes are.
	const bearer = annualBenefit === 0 ? 'neither' : chargeBearer(income, partnerIncome);
	const chargeIncome = bearer === 'partner' ? partnerIncome : income;
	const percentage = bearer === 'neither' ? 0 : hicbcPercentage(chargeIncome);
	const charge = roundMoney((annualBenefit * percentage) / 100);
	const liable = bearer === 'you';

	const incomeTaxMarginal = marginalTaxRate(income, region);
	const hicbcMarginal = liable ? hicbcMarginalRate(annualBenefit, income) : 0;

	return {
		taxYear: HICBC_TAX_YEAR,
		region,
		income,
		partnerIncome,
		children,
		claiming,
		weeklyBenefit: claiming ? roundMoney(annualBenefit / CHILD_BENEFIT_WEEKS_PER_YEAR) : 0,
		perPaymentBenefit: claiming
			? roundMoney((annualBenefit / CHILD_BENEFIT_WEEKS_PER_YEAR) * CHILD_BENEFIT_WEEKS_PER_PAYMENT)
			: 0,
		annualBenefit,
		bearer,
		liable,
		chargeIncome,
		percentage,
		charge,
		netBenefit: roundMoney(annualBenefit - charge),
		inChargeBand: bearer !== 'neither' && inChargeBand(chargeIncome),
		fullyClawedBack: annualBenefit > 0 && percentage >= 100,
		headroom: roundMoney(Math.max(0, HICBC_THRESHOLD - Math.max(income, partnerIncome))),
		incomeToClearCharge: bearer === 'neither' ? 0 : incomeToClearCharge(chargeIncome),
		incomeTaxMarginalRate: incomeTaxMarginal,
		hicbcMarginalRate: hicbcMarginal,
		combinedMarginalRate: incomeTaxMarginal + hicbcMarginal,
		takeHomeAfterCharge: roundMoney(takeHomePay(income, region) - (liable ? charge : 0))
	};
}
