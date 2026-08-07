/**
 * ISA allowance tracker — README.md → "ISA Allowance Tracker": "All six UK ISA wrappers: Stocks &
 * Shares, Cash, LISA, JISA, IFISA, Help to Buy" and "Per-wrapper limits, contributions and
 * remaining allowance (2026/27: £20,000 adult, £9,000 JISA)" (issue #28).
 *
 * The six wrappers don't each get their own £20,000 — HMRC gives one adult allowance shared across
 * five of them (Stocks & Shares, Cash, Lifetime, Innovative Finance and Help to Buy ISAs), split
 * however the saver likes across providers and wrapper types within a single tax year. The Junior
 * ISA is a completely separate allowance that belongs to the child, not the parent, so it neither
 * shares nor competes with the adult figure. And the Lifetime ISA carries a second, tighter cap of
 * its own — £4,000 a year — that sits *inside* the shared adult allowance rather than beside it,
 * since the 25% government bonus is only ever paid on that £4,000. `ISA_WRAPPERS` (`$lib/enums.js`)
 * lists all six in the order the tracker displays them; this module is the arithmetic behind that
 * list.
 *
 * Every figure here is a per-tax-year *contribution* — money paid in, not the value of the holding,
 * which rises and falls with the market without touching the allowance. `Investment.monthly_
 * contribution` (`$lib/types.js`) is a forward-looking pace, the same figure `fire.js`/`forecast.js`
 * project growth from — not a ledger of what has actually been paid in since 6 April, which the
 * data model has no field for on any wrapper. {@link isaContributionPace} turns the current pace
 * into an annualised estimate a tracker can seed itself with; a user then corrects it to what they
 * have actually contributed so far, the same "seed from the store, then let the user own it" shape
 * `TaxCalculator.svelte` already uses for salary and region.
 */
import { ISA_WRAPPERS, WRAPPER_LABELS } from './enums.js';
import { monthlyEquivalentContribution } from './fire.js';

/** The tax year every figure in this module belongs to, matching `$lib/tax.js`'s `TAX_YEAR`. */
export const ISA_TAX_YEAR = '2026/27';

/** UK tax years run 6 April to 5 April; {@link ISA_TAX_YEAR}'s own boundaries, ISO `YYYY-MM-DD`. */
export const ISA_TAX_YEAR_START = '2026-04-06';
export const ISA_TAX_YEAR_END = '2027-04-05';

/** The adult ISA allowance, shared across every wrapper except the Junior ISA (£). */
export const ADULT_ISA_ALLOWANCE = 20_000;

/** The Junior ISA allowance — separate from, not shared with, the adult allowance (£). */
export const JISA_ALLOWANCE = 9_000;

/** The Lifetime ISA's own annual cap, inside the shared adult allowance rather than beside it (£). */
export const LISA_ANNUAL_SUBLIMIT = 4_000;

const JISA_WRAPPER = 'jisa';
const LISA_WRAPPER = 'lisa';
const HTB_WRAPPER = 'htb_isa';

/** The five wrappers that share {@link ADULT_ISA_ALLOWANCE} — every ISA wrapper except the JISA. */
export const ADULT_ISA_WRAPPERS = Object.freeze(
	ISA_WRAPPERS.filter((wrapper) => wrapper !== JISA_WRAPPER)
);

/** @param {number} amount @returns {number} */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100;
}

/**
 * @param {Record<string, number>} contributions
 * @param {string} wrapper
 * @returns {number} Never negative — a missing or negative entry reads as 0.
 */
function contributedTo(contributions, wrapper) {
	const value = Number(contributions?.[wrapper]);
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Sum each ISA-wrapped holding's contribution rate, annualised, grouped by wrapper — the seed a
 * fresh tracker starts from (see the module header). Reuses `fire.js`'s
 * `monthlyEquivalentContribution` so a quarterly or one-off contribution annualises the same way
 * the forecast tab already does, rather than a second, possibly-disagreeing conversion.
 *
 * @param {readonly import('./types.js').Investment[]} [investments]
 * @returns {Record<import('./enums.js').Wrapper, number>} One entry per {@link ISA_WRAPPERS}
 *   member, 0 for a wrapper nothing is currently held in.
 */
export function isaContributionPace(investments = []) {
	/** @type {Record<string, number>} */
	const totals = Object.fromEntries(ISA_WRAPPERS.map((wrapper) => [wrapper, 0]));

	for (const investment of investments) {
		if (!ISA_WRAPPERS.includes(investment.wrapper)) continue;
		totals[investment.wrapper] += monthlyEquivalentContribution(investment) * 12;
	}

	for (const wrapper of ISA_WRAPPERS) totals[wrapper] = roundMoney(totals[wrapper]);
	return totals;
}

/**
 * @typedef {object} IsaLimitSummary
 * @property {number} contributed
 * @property {number} limit
 * @property {number} remaining Never negative — 0 once the limit is met or exceeded.
 * @property {number} overLimit How far past the limit contributions have gone, 0 if not exceeded.
 */

/**
 * @param {number} contributed
 * @param {number} limit
 * @returns {IsaLimitSummary}
 */
function limitSummary(contributed, limit) {
	return {
		contributed: roundMoney(contributed),
		limit,
		remaining: roundMoney(Math.max(0, limit - contributed)),
		overLimit: roundMoney(Math.max(0, contributed - limit))
	};
}

/**
 * @typedef {object} IsaWrapperSummary
 * @property {import('./enums.js').Wrapper} wrapper
 * @property {string} label
 * @property {number} contributed
 * @property {'adult' | 'jisa'} group Which allowance this wrapper draws against.
 * @property {number} remaining Allowance still available to pay into *this* wrapper specifically —
 *   for the Lifetime ISA this is the tighter of its own £4,000 sub-limit and the shared adult
 *   allowance left; for every other adult wrapper it is just the shared allowance left; for the
 *   JISA it is the separate £9,000 allowance left.
 * @property {boolean} overLimit Whether a limit that applies to this wrapper (its group limit or,
 *   for the Lifetime ISA, its own sub-limit) has been exceeded.
 * @property {number} overBy How far past the binding limit this wrapper is, 0 if `overLimit` is
 *   false. For the Lifetime ISA this is whichever of its sub-limit or the shared adult limit is
 *   currently exceeded (the larger of the two, if both are).
 * @property {boolean} closedToNewAccounts Help to Buy ISAs closed to new savers on 30 November
 *   2019; existing account-holders can still pay in until the account closes.
 */

/**
 * @typedef {object} IsaAllowanceResult
 * @property {string} taxYear
 * @property {IsaWrapperSummary[]} wrappers One entry per {@link ISA_WRAPPERS}, in that order.
 * @property {IsaLimitSummary} adult The shared £20,000 allowance across every wrapper but the JISA.
 * @property {IsaLimitSummary} jisa The separate £9,000 Junior ISA allowance.
 * @property {IsaLimitSummary} lisaSublimit The Lifetime ISA's own £4,000 cap, inside `adult`.
 * @property {number} totalContributed Adult + JISA contributions combined — informational only,
 *   since the two allowances belong to different people and neither limits the other.
 */

/**
 * The full picture for all six wrappers at once: what has been paid into each, and what is left.
 *
 * @param {Partial<Record<import('./enums.js').Wrapper, number>>} [contributions] Amount
 *   contributed this tax year, keyed by wrapper. Missing or negative entries are treated as 0.
 * @returns {IsaAllowanceResult}
 */
export function isaAllowanceSummary(contributions = {}) {
	const jisaContributed = contributedTo(contributions, JISA_WRAPPER);
	const lisaContributed = contributedTo(contributions, LISA_WRAPPER);
	const adultContributed = ADULT_ISA_WRAPPERS.reduce(
		(total, wrapper) => total + contributedTo(contributions, wrapper),
		0
	);

	const adult = limitSummary(adultContributed, ADULT_ISA_ALLOWANCE);
	const jisa = limitSummary(jisaContributed, JISA_ALLOWANCE);
	const lisaSublimit = limitSummary(lisaContributed, LISA_ANNUAL_SUBLIMIT);

	const wrappers = ISA_WRAPPERS.map((wrapper) => {
		const contributed = roundMoney(contributedTo(contributions, wrapper));

		if (wrapper === JISA_WRAPPER) {
			return {
				wrapper,
				label: WRAPPER_LABELS[wrapper],
				contributed,
				group: /** @type {'jisa'} */ ('jisa'),
				remaining: jisa.remaining,
				overLimit: jisa.overLimit > 0,
				overBy: jisa.overLimit,
				closedToNewAccounts: false
			};
		}

		const remaining =
			wrapper === LISA_WRAPPER
				? roundMoney(Math.min(adult.remaining, lisaSublimit.remaining))
				: adult.remaining;
		const overBy =
			wrapper === LISA_WRAPPER
				? roundMoney(Math.max(adult.overLimit, lisaSublimit.overLimit))
				: adult.overLimit;

		return {
			wrapper,
			label: WRAPPER_LABELS[wrapper],
			contributed,
			group: /** @type {'adult'} */ ('adult'),
			remaining,
			overLimit: overBy > 0,
			overBy,
			closedToNewAccounts: wrapper === HTB_WRAPPER
		};
	});

	return {
		taxYear: ISA_TAX_YEAR,
		wrappers,
		adult,
		jisa,
		lisaSublimit,
		totalContributed: roundMoney(adultContributed + jisaContributed)
	};
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How much of {@link ISA_TAX_YEAR} is left to use the allowance, as of `today`. Clamped to the tax
 * year's own boundaries so a date outside 2026/27 (this app's one hard-coded year, same posture as
 * `tax.js`) reports a full or exhausted year rather than a negative or over-long count.
 *
 * @param {Date} [today]
 * @returns {{ daysRemaining: number, daysTotal: number, fractionElapsed: number }}
 */
export function isaTaxYearProgress(today = new Date()) {
	const start = new Date(`${ISA_TAX_YEAR_START}T00:00:00Z`);
	const end = new Date(`${ISA_TAX_YEAR_END}T00:00:00Z`);
	const now = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

	const daysTotal = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;

	let daysRemaining;
	if (now.getTime() < start.getTime()) daysRemaining = daysTotal;
	else if (now.getTime() > end.getTime()) daysRemaining = 0;
	else daysRemaining = Math.round((end.getTime() - now.getTime()) / MS_PER_DAY) + 1;

	const daysElapsed = daysTotal - daysRemaining;

	return {
		daysRemaining,
		daysTotal,
		fractionElapsed: Math.round((daysElapsed / daysTotal) * 1000) / 1000
	};
}
