/**
 * The "if I died today" engine — README.md → "Estate & IHT Planning Suite": "'If I died today' —
 * what family receives per stream" and "Who-gets-what wishes per beneficiary" (issue #140).
 *
 * This module does no band, taper or gift arithmetic of its own — that is `estate.js` (#138) and
 * `lifetime-gifts.js` (#139). Its whole job is assembling *their* inputs from data the app already
 * tracks, and pricing named beneficiaries against the result:
 *
 * ```text
 * monthly_entries, properties, assets, pensions,  →  budget-policy.js's estateValuation()
 * life_insurance                                      (today's year, ungrown — "today" is the point)
 * + iht_settings                                  →  an estate.js EstateInput
 * + gifts                                         →  lifetime-gifts.js's inheritanceTaxWithGifts()
 * = estateSnapshot()                                 the bill, and what is left to pass on
 *
 * beneficiaries + estateSnapshot().netAfterTax    →  beneficiaryShares()
 *                                                     who gets what, priced against the net estate
 * ```
 *
 * Four conventions decide what the numbers mean:
 *
 * 1. **`estateSnapshot()` values the estate at the default, ungrown tax year.** `estateValuation()`
 *    defaults to 2026/27 with no growth applied, which is exactly "today" — and, per
 *    `budget-policy.js`'s own convention 7, DC pension pots are excluded from the total at that
 *    year regardless of the April 2027 toggle (#137's own overlay, out of scope here per the issue).
 *    A caller wanting a future year or the Budget policy overlay wants `budget-policy.js` directly.
 * 2. **`spouse_exempt` is a whole-estate simplification, not a partial one.** This app has no
 *    who-gets-what split yet to price a real spouse exemption against — that is `beneficiaries`
 *    (#167) — so `IhtSettings.spouse_exempt: true` reads as "the whole net estate passes to a spouse
 *    or civil partner, exempt", matching `estate.js`'s own worked example of an estate that pays
 *    nothing however large. `false` is the conservative default: a document with no evidence of a
 *    spouse reports the estate's full, untapered bill.
 * 3. **`netAfterTax` is what the estate itself pays out, and does not include gift tax.** Tax on a
 *    failed lifetime gift is primarily the recipient's, not the estate's (`lifetime-gifts.js`'s own
 *    documented convention) — so the amount `beneficiaryShares()` has to split among the people named
 *    in a will is `inheritanceTaxWithGifts()`'s nested `estate.netAfterTax`, restated here at the top
 *    level for #167 to read without reaching into the full result. `totalTax` — estate tax plus gift
 *    tax, the whole cost of the death — is already at `inheritanceTaxWithGifts()`'s own top level and
 *    is carried through unchanged.
 * 4. **`beneficiaryShares()` never rescales a share to fit.** A half-drafted will (shares that sum to
 *    60%, or to 140%) is not this function's problem to solve — `totalSharePct`, `unallocatedPct`,
 *    `unallocatedAmount` and `overAllocated` say so out loud, signed rather than floored at zero, so
 *    an over-allocated will reads as `unallocatedPct: -40` and not as a quietly-corrected `0`.
 *
 * Both functions re-normalise their inputs defensively, the way `estate.js`'s `normaliseEstate` and
 * `lifetime-gifts.js`'s `normaliseGift` already treat theirs: they are handed a document straight off
 * `$lib/store.js`, which is normalised on load but not on every in-flight edit, and a half-typed
 * field must not produce `NaN`. Every money figure is rounded to whole pence; percentages are left at
 * full precision for the caller to round for display, matching `estate.js`'s own convention 7.
 */

import { estateValuation } from './budget-policy.js';
import { positionFromEntries } from './forecast.js';
import { inheritanceTaxWithGifts } from './lifetime-gifts.js';

/*
 * As elsewhere in `$lib`: types from sibling modules are referenced inline as
 * `import('./x.js').X` rather than re-declared as local `@typedef`s, because `index.js` re-exports
 * every module with `export *` and svelte-check reads two same-named top-level typedefs as an
 * ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* Coercion helpers                                                            */
/* -------------------------------------------------------------------------- */

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
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function asBoolean(value, fallback) {
	return typeof value === 'boolean' ? value : fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function asString(value, fallback = '') {
	return typeof value === 'string' ? value : fallback;
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

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/* -------------------------------------------------------------------------- */
/* The snapshot                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The slice of `AppData` {@link estateSnapshot} needs — named narrowly here rather than typed as the
 * whole document, so it is equally at home taking the live store or a hand-built pick of five keys.
 *
 * @typedef {object} EstateSnapshotInput
 * @property {readonly import('./types.js').MonthlyEntry[]} [monthly_entries]
 * @property {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @property {readonly Partial<import('./types.js').Property>[]} [properties]
 * @property {readonly Partial<import('./types.js').Asset>[]} [assets]
 * @property {readonly Partial<import('./types.js').LifeInsurance>[]} [life_insurance]
 * @property {readonly Partial<import('./lifetime-gifts.js').Gift>[]} [gifts]
 * @property {Partial<import('./types.js').IhtSettings>} [iht_settings]
 */

/**
 * The `IhtSettings` document fields, filled in and bound the way `estate.js`'s own `normaliseEstate`
 * treats theirs — an out-of-range percentage is clamped, not rejected, and a half-typed field falls
 * back rather than propagating `NaN`.
 *
 * @param {Partial<import('./types.js').IhtSettings>} [settings]
 * @returns {{ spouseExempt: boolean, directDescendants: boolean, transferredNilRateBandPct: number, transferredResidenceNilRateBandPct: number, funeralExpenses: number }}
 */
function normaliseIhtSettingsInput(settings = {}) {
	const source = settings ?? {};
	return {
		spouseExempt: asBoolean(source.spouse_exempt, false),
		directDescendants: asBoolean(source.direct_descendants, true),
		transferredNilRateBandPct: clamp(asNumber(source.transferred_nil_rate_band_pct, 0), 0, 100),
		transferredResidenceNilRateBandPct: clamp(
			asNumber(source.transferred_residence_nil_rate_band_pct, 0),
			0,
			100
		),
		funeralExpenses: Math.max(0, asNumber(source.funeral_expenses, 0))
	};
}

/**
 * An estate valued from tracked data and the tax on it, gifts included — the whole of "if I died
 * today".
 *
 * `estate` is `EstateWithGifts`'s own field, the after-gifts `IhtCalculation` (tax, allowances,
 * `netEstate`) — kept as `inheritanceTaxWithGifts()` names it rather than shadowed by the raw input,
 * which is `estateInput` here instead.
 *
 * @typedef {import('./lifetime-gifts.js').EstateWithGifts & {
 *   valuation: import('./budget-policy.js').EstateValuation,
 *   estateInput: import('./estate.js').EstateInput,
 *   ihtSettings: ReturnType<typeof normaliseIhtSettingsInput>,
 *   netAfterTax: number
 * }} EstateSnapshot
 */

/**
 * Value the estate exactly as it stands right now, from data the app already tracks, and work out
 * what it would owe if the user died today — README.md → "Estate value from existing tracked data —
 * no re-entry".
 *
 * The estate itself comes from `budget-policy.js`'s `estateValuation()`, run at its default,
 * ungrown tax year (convention 1): the latest monthly snapshot's holdings and debts
 * (`forecast.js`'s `positionFromEntries()`, the one place "latest" is derived, rather than a second
 * way of finding it), plus every tracked property, physical asset, pension pot and life insurance
 * policy not written in trust (`estateValuation()`'s own rule, not re-applied here). `IhtSettings` is
 * folded in for the assumptions that data cannot supply, and the whole estate is then run through
 * `lifetime-gifts.js`'s `inheritanceTaxWithGifts()`, which spends the nil-rate band on any recorded
 * lifetime gifts before the estate itself reaches it.
 *
 * @param {EstateSnapshotInput} [data]
 * @param {import('./lifetime-gifts.js').GiftLedgerOptions & { bands?: import('./estate.js').NilRateBandPair, taxYear?: string }} [options]
 *   Passed straight through to `inheritanceTaxWithGifts()` — `deathDate` defaults to today, which is
 *   what makes the no-argument call "if I died today".
 * @returns {EstateSnapshot}
 */
export function estateSnapshot(data = {}, options = {}) {
	const source = data ?? {};
	const monthlyEntries = Array.isArray(source.monthly_entries) ? source.monthly_entries : [];
	const position = positionFromEntries(monthlyEntries);

	const estatePosition = {
		investments: position?.investments ?? [],
		debts: position?.debts ?? [],
		properties: Array.isArray(source.properties) ? source.properties : [],
		assets: Array.isArray(source.assets) ? source.assets : [],
		pensions: Array.isArray(source.pensions) ? source.pensions : [],
		// Whether a policy counts is `estateValuation()`'s own in-trust rule, applied there and
		// nowhere else — this hands over the whole recorded list, in trust or not.
		lifeInsurance: Array.isArray(source.life_insurance) ? source.life_insurance : []
	};
	const gifts = Array.isArray(source.gifts) ? source.gifts : [];
	const settings = normaliseIhtSettingsInput(source.iht_settings);

	const valuation = estateValuation(estatePosition);
	// Convention 2: no beneficiary split exists yet to price a partial spouse exemption against, so
	// `spouse_exempt` reads as "the whole net estate, exempt" — estate.js's own worked example of an
	// estate that pays nothing however large.
	const netBeforeSpouse = roundMoney(valuation.total - settings.funeralExpenses);

	/** @type {import('./estate.js').EstateInput} */
	const estateInput = {
		estateValue: valuation.total,
		liabilities: settings.funeralExpenses,
		spouseExempt: settings.spouseExempt ? Math.max(0, netBeforeSpouse) : 0,
		residenceValue: valuation.residence,
		directDescendants: settings.directDescendants,
		transferredNilRateBandPct: settings.transferredNilRateBandPct,
		transferredResidenceNilRateBandPct: settings.transferredResidenceNilRateBandPct
	};

	// `inheritanceTaxWithGifts` re-normalises the gifts itself (`lifetimeGiftLedger` →
	// `normaliseGifts`), so nothing here duplicates that pass.
	const result = inheritanceTaxWithGifts(estateInput, gifts, options);

	return {
		...result,
		valuation,
		estateInput,
		ihtSettings: settings,
		// Convention 3: what the estate pays out, gift tax excluded — the figure #167 splits.
		netAfterTax: result.estate.netAfterTax
	};
}

/* -------------------------------------------------------------------------- */
/* Who gets what                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One beneficiary, priced.
 *
 * @typedef {object} BeneficiaryShare
 * @property {string} id
 * @property {string} name
 * @property {string} relationship
 * @property {string} notes
 * @property {number} sharePct Wished share of the net estate, as stored (£`share_pct`).
 * @property {number} amount `netEstate × sharePct / 100` (£) — never rescaled, per convention 4.
 */

/**
 * Every beneficiary, priced, plus how the wishes as a whole compare to the estate they are drawn
 * against.
 *
 * @typedef {object} BeneficiarySharesResult
 * @property {number} netEstate The amount being split (£), floored at zero.
 * @property {BeneficiaryShare[]} shares
 * @property {number} totalSharePct Every `share_pct` added, whatever it sums to.
 * @property {number} allocatedAmount Every `amount` added (£).
 * @property {number} unallocatedPct `100 - totalSharePct` — negative when over-allocated.
 * @property {number} unallocatedAmount `netEstate - allocatedAmount` (£) — negative when
 *   over-allocated.
 * @property {boolean} overAllocated Whether `totalSharePct` is above 100.
 */

/**
 * Price each stated wish against the net estate after tax. Shares are never rescaled to fit —
 * convention 4 — so a half-drafted will (or one that promises away more than there is) reads as
 * under- or over-allocated rather than being silently corrected.
 *
 * @param {readonly Partial<import('./types.js').Beneficiary>[] | undefined | null} beneficiaries
 * @param {number} netEstate The amount to split (£) — {@link estateSnapshot}'s `netAfterTax`.
 * @returns {BeneficiarySharesResult}
 */
export function beneficiaryShares(beneficiaries, netEstate) {
	const net = Math.max(0, asNumber(netEstate, 0));
	const list = Array.isArray(beneficiaries) ? beneficiaries : [];

	const shares = list.map((raw) => {
		const source = raw ?? {};
		const sharePct = clamp(asNumber(source.share_pct, 0), 0, 100);
		return {
			id: asString(source.id),
			name: asString(source.name),
			relationship: asString(source.relationship),
			notes: asString(source.notes),
			sharePct,
			amount: roundMoney((net * sharePct) / 100)
		};
	});

	const totalSharePct = shares.reduce((total, share) => total + share.sharePct, 0);
	const allocatedAmount = roundMoney(shares.reduce((total, share) => total + share.amount, 0));

	return {
		netEstate: net,
		shares,
		totalSharePct,
		allocatedAmount,
		unallocatedPct: 100 - totalSharePct,
		unallocatedAmount: roundMoney(net - allocatedAmount),
		overAllocated: totalSharePct > 100
	};
}
