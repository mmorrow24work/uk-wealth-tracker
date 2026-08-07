/**
 * Marriage Allowance, 2026/27 — README.md → "UK Income Tax Calculator (2026/27)": "Marriage
 * Allowance" — issue #25.
 *
 * Marriage Allowance lets a lower earner transfer a slice of their unused Personal Allowance to a
 * spouse or civil partner, in exchange for a fixed reduction on the recipient's tax bill. It is not
 * a joint calculation on a combined income the way a household tax return would be — it is two
 * separate, one-directional adjustments (the transferor's allowance shrinks, the recipient's bill
 * falls by a fixed amount) that only makes sense to model together because each side depends on the
 * same £1,260. That is why this is its own module rather than a `tax.js` option: `tax.js` answers
 * "what does one income owe", and Marriage Allowance is "what do two incomes owe *each other*".
 *
 * Four conventions decide what the numbers here mean:
 *
 * 1. **The transferable amount is derived, not hardcoded.** HMRC's rule is 10% of the standard
 *    Personal Allowance, rounded *up* to the nearest £10 — £1,257 rounds to £1,260. `tax.js`'s
 *    `PERSONAL_ALLOWANCE` has been frozen at £12,570 since 2021/22 (its own doc comment says so),
 *    so {@link transferableAllowance} recomputes from that constant rather than repeating the £1,260
 *    figure as a second source of truth: if the Personal Allowance ever moves, this module moves
 *    with it instead of quietly falling out of step.
 * 2. **Eligibility is two separate tests, one per person, and both must pass.** The transferor must
 *    not already be a taxpayer — HMRC's own wording is "your income is below your Personal
 *    Allowance" — and the recipient must not be a higher (or, in Scotland, higher/advanced/top) rate
 *    taxpayer. Neither test is about the couple's combined income; a couple on £11,000 and £90,000
 *    is ineligible on the recipient's side even though the transferor comfortably qualifies. The
 *    recipient threshold is derived the same way `tax.js`'s `marginalTaxRate` derives its 60% band:
 *    both the England/Wales/NI and Scottish ladders name their first disqualifying band `'higher'`,
 *    so {@link higherRateThreshold} reads that boundary out of `bandsFor` instead of hardcoding
 *    £50,270 and £43,662 as two more separately-sourced figures.
 * 3. **The recipient's reduction is a fixed 20% of the transferred amount, not their marginal
 *    rate.** Marriage Allowance is defined in statute at the basic rate of Income Tax, which is 20%
 *    UK-wide — it does not vary with Scotland's own bands the way actual liability does (Scotland's
 *    basic rate also happens to be 20%, which is a coincidence of this tax year's rates, not the
 *    reason the figure is used here). It is a *reduction to the bill*, not an addition to taxable
 *    income, and it cannot take the bill below zero: a recipient who owes less than £252 only gets
 *    given as much as they owe.
 * 4. **The transferor's cost is computed by reusing `tax.js`, not by reimplementing band logic.**
 *    Giving up £1,260 of allowance is arithmetically identical to the transferor earning £1,260
 *    more against their *original* allowance, because at incomes below the Personal Allowance
 *    (which eligibility convention (2) guarantees) nothing about the taper applies and
 *    `personalAllowance(income)` is flat at £12,570 either way. So the extra tax the transfer costs
 *    them is `incomeTax(income + transferAmount, region) − incomeTax(income, region)` — which
 *    correctly lands in Scotland's 19% starter band rather than assuming 20%, without this module
 *    knowing Scotland has a starter band at all.
 *
 * Every figure is in pounds, rounded to whole pence, except `rate`-suffixed figures, which are
 * whole-number percents, matching `tax.js`/`hicbc.js`'s convention. Everything is pure.
 *
 * Figures verified against HMRC's "Marriage Allowance" guidance (gov.uk): the transferable amount
 * and the fixed 20% reduction are both re-derivable from `tax.js`'s own constants (convention 1),
 * so — unlike `hicbc.js`'s Child Benefit rates — nothing here had to be taken on trust from outside
 * the repo.
 */

import { bandsFor, incomeTax, normaliseTaxRegion, PERSONAL_ALLOWANCE } from './tax.js';

/*
 * As in `hicbc.js`, model types are referenced inline as `import('./types.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *` and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The tax year                                                                */
/* -------------------------------------------------------------------------- */

/** The tax year every figure in this module belongs to — matches `tax.js`'s `TAX_YEAR`. */
export const MARRIAGE_ALLOWANCE_TAX_YEAR = '2026/27';

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

/* -------------------------------------------------------------------------- */
/* The transferable amount                                                     */
/* -------------------------------------------------------------------------- */

/** Marriage Allowance transfers this share of the standard Personal Allowance (%) — HMRC's rule. */
export const MARRIAGE_ALLOWANCE_PERCENT = 10;

/** The transferred amount is rounded up to the nearest £10 — HMRC's rule. */
export const MARRIAGE_ALLOWANCE_ROUNDING = 10;

/**
 * The fixed rate the recipient's reduction is given at (%) — convention (3). Not the recipient's
 * own marginal or band rate.
 */
export const MARRIAGE_ALLOWANCE_RATE = 20;

/**
 * How much Personal Allowance can be transferred (£) — 10% of the standard allowance, rounded up to
 * the nearest £10, per convention (1). £1,257 rounds to £1,260 at 2026/27's frozen £12,570
 * allowance.
 *
 * @returns {number}
 */
export function transferableAllowance() {
	const raw = (PERSONAL_ALLOWANCE * MARRIAGE_ALLOWANCE_PERCENT) / 100;
	return Math.ceil(raw / MARRIAGE_ALLOWANCE_ROUNDING) * MARRIAGE_ALLOWANCE_ROUNDING;
}

/** The 2026/27 transferable amount (£) — {@link transferableAllowance}'s result, as a constant. */
export const MARRIAGE_ALLOWANCE_TRANSFER = transferableAllowance();

/* -------------------------------------------------------------------------- */
/* Eligibility                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The gross income at which someone stops being eligible to *receive* the transfer (£) — the point
 * their region's ladder first names a band `'higher'`, plus the Personal Allowance that band's
 * `from` is measured after (`bandsFor` stores boundaries on taxable income, per `tax.js`'s
 * convention (1); this adds the allowance back to read it as a gross-income threshold). £50,270 in
 * England/Wales/NI, £43,662 in Scotland for 2026/27 — both derived, not restated.
 *
 * @param {unknown} [region]
 * @returns {number}
 */
export function higherRateThreshold(region) {
	const higherBand = bandsFor(region).find((band) => band.id === 'higher');
	return roundMoney(PERSONAL_ALLOWANCE + (higherBand?.from ?? 0));
}

/**
 * Whether an income is low enough to give up allowance — HMRC's "you do not pay Income Tax or your
 * income is below your Personal Allowance". Region-independent: the Personal Allowance itself is
 * UK-wide.
 *
 * @param {number} [income] (£/yr)
 * @returns {boolean}
 */
export function transferorEligible(income = 0) {
	return asMoney(income) <= PERSONAL_ALLOWANCE;
}

/**
 * Whether an income is low enough to receive the transfer — not a higher (or, in Scotland,
 * higher/advanced/top) rate taxpayer.
 *
 * @param {number} [income] (£/yr)
 * @param {unknown} [region]
 * @returns {boolean}
 */
export function recipientEligible(income = 0, region) {
	return asMoney(income) < higherRateThreshold(region);
}

/**
 * Whether the couple as a whole can make the transfer — convention (2): both sides must pass
 * independently.
 *
 * @param {number} [transferorIncome] (£/yr)
 * @param {number} [recipientIncome] (£/yr)
 * @param {unknown} [region] The recipient's tax region — only their side of the test uses it.
 * @returns {boolean}
 */
export function eligible(transferorIncome = 0, recipientIncome = 0, region) {
	return transferorEligible(transferorIncome) && recipientEligible(recipientIncome, region);
}

/* -------------------------------------------------------------------------- */
/* What it costs, and what it's worth                                          */
/* -------------------------------------------------------------------------- */

/**
 * The extra tax the transferor pays for giving up `transferAmount` of allowance (£) — convention
 * (4): identical to taxing `transferAmount` more of their own income, since eligibility keeps them
 * below the Personal Allowance where the taper cannot apply.
 *
 * @param {number} [income] The transferor's income (£/yr).
 * @param {number} [transferAmount] (£)
 * @param {unknown} [region]
 * @returns {number} (£/yr)
 */
export function transferorExtraTax(
	income = 0,
	transferAmount = MARRIAGE_ALLOWANCE_TRANSFER,
	region
) {
	const amount = asMoney(income);
	const transfer = asMoney(transferAmount);
	return roundMoney(incomeTax(amount + transfer, region) - incomeTax(amount, region));
}

/**
 * The recipient's tax saving (£) — a fixed 20% of the transferred amount (convention 3), capped so
 * it never exceeds — or reverses — what they actually owe.
 *
 * @param {number} [income] The recipient's income (£/yr).
 * @param {number} [transferAmount] (£)
 * @param {unknown} [region]
 * @returns {number} (£/yr)
 */
export function recipientTaxReduction(
	income = 0,
	transferAmount = MARRIAGE_ALLOWANCE_TRANSFER,
	region
) {
	const fixedReduction = roundMoney((asMoney(transferAmount) * MARRIAGE_ALLOWANCE_RATE) / 100);
	const liability = incomeTax(asMoney(income), region);
	return roundMoney(Math.max(0, Math.min(fixedReduction, liability)));
}

/* -------------------------------------------------------------------------- */
/* The whole calculation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Everything the Marriage Allowance panel's controls describe.
 *
 * @typedef {object} MarriageAllowanceInput
 * @property {number} transferorIncome The lower earner's income (£/yr) — the one giving up
 *   allowance.
 * @property {number} recipientIncome The higher earner's income (£/yr) — the one whose bill falls.
 * @property {import('./enums.js').TaxRegion} region The *recipient's* tax region — Scotland sets
 *   its own higher-rate boundary, and it is their eligibility and their reduction it governs. The
 *   transferor's own region does not change anything here: convention (4)'s trick uses the
 *   transferor's own income tax function on their own income, region and all, so if the couple live
 *   in different nations pass the transferor's region as part of `transferorIncome`'s figure by
 *   calling {@link transferorExtraTax} directly — the composite below assumes one household region.
 * @property {boolean} claiming Whether the couple has actually applied for the transfer.
 */

/**
 * A full Marriage Allowance calculation — README.md's "Marriage Allowance".
 *
 * @typedef {object} MarriageAllowanceBreakdown
 * @property {string} taxYear Always {@link MARRIAGE_ALLOWANCE_TAX_YEAR}.
 * @property {import('./enums.js').TaxRegion} region
 * @property {number} transferorIncome
 * @property {number} recipientIncome
 * @property {boolean} claiming
 * @property {boolean} transferorEligible
 * @property {boolean} recipientEligible
 * @property {boolean} eligible Both of the above.
 * @property {boolean} applied Eligible *and* claiming — the transfer is actually in effect.
 * @property {number} transferAmount {@link MARRIAGE_ALLOWANCE_TRANSFER}, restated on the result so
 *   a caller never needs the module-level constant directly.
 * @property {number} transferorNewAllowance The transferor's Personal Allowance after giving up
 *   `transferAmount` (£).
 * @property {number} transferorExtraTax What the transfer costs the transferor (£/yr); `0` unless
 *   applied and their income already uses some of what they gave up.
 * @property {number} recipientTaxReduction What the transfer saves the recipient (£/yr); `0` unless
 *   applied.
 * @property {number} netHouseholdBenefit The two together (£/yr) — positive whenever the
 *   recipient's saving outweighs the transferor's cost, which convention (3)'s cap means it always
 *   is when the recipient owes at least £252, and can fall short only when their liability is
 *   thinner than that.
 * @property {number} transferorHeadroom How much more the transferor could earn while remaining
 *   eligible (£); `0` once they are not.
 * @property {number} recipientHeadroom How much more the recipient could earn while remaining
 *   eligible (£); `0` once they are not.
 * @property {number} higherRateThreshold {@link higherRateThreshold} for `region`, restated on the
 *   result for the same reason as `transferAmount`.
 */

/**
 * The Marriage Allowance panel's single entry point: two incomes, a region and whether the transfer
 * has actually been applied for, in — every figure the panel shows, out.
 *
 * @param {Partial<MarriageAllowanceInput>} [raw]
 * @returns {MarriageAllowanceBreakdown}
 */
export function marriageAllowanceSummary(raw = {}) {
	const transferorIncome = asMoney(raw.transferorIncome);
	const recipientIncome = asMoney(raw.recipientIncome);
	const region = normaliseTaxRegion(raw.region);
	const claiming = raw.claiming ?? true;

	const transferorOk = transferorEligible(transferorIncome);
	const recipientOk = recipientEligible(recipientIncome, region);
	const isEligible = transferorOk && recipientOk;
	const applied = isEligible && claiming;

	const transferAmount = MARRIAGE_ALLOWANCE_TRANSFER;
	const extraTax = applied ? transferorExtraTax(transferorIncome, transferAmount, region) : 0;
	const reduction = applied ? recipientTaxReduction(recipientIncome, transferAmount, region) : 0;

	return {
		taxYear: MARRIAGE_ALLOWANCE_TAX_YEAR,
		region,
		transferorIncome,
		recipientIncome,
		claiming,
		transferorEligible: transferorOk,
		recipientEligible: recipientOk,
		eligible: isEligible,
		applied,
		transferAmount,
		transferorNewAllowance: roundMoney(Math.max(0, PERSONAL_ALLOWANCE - transferAmount)),
		transferorExtraTax: extraTax,
		recipientTaxReduction: reduction,
		netHouseholdBenefit: roundMoney(reduction - extraTax),
		transferorHeadroom: roundMoney(Math.max(0, PERSONAL_ALLOWANCE - transferorIncome)),
		recipientHeadroom: roundMoney(Math.max(0, higherRateThreshold(region) - recipientIncome)),
		higherRateThreshold: higherRateThreshold(region)
	};
}
