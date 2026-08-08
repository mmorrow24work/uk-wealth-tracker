/**
 * Budget 2026–2031 policy changes overlay — README.md → "Advanced Scenarios": "Budget 2026–2031
 * changes (pension IHT, frozen nil-rate bands)" (issue #137).
 *
 * "Budget" here means the Chancellor's, not the household spending plan on the `/budget` tab —
 * nothing in this module touches `types.js`'s `Budget`/`BudgetCategory`/`BudgetBill`.
 *
 * The other four Phase 2 scenarios (`stress-test.js`, `income-shock.js`, `mortgage-rate-rise.js`,
 * `one-off-costs.js`) are all `forecast.js` `adjustMonth` overlays, because all four are questions
 * about a monthly savings path. This one is not: nothing here changes what the pot is worth. It
 * changes **who gets to keep it** — two announced tax changes that between them decide how much
 * Inheritance Tax an estate pays in each tax year from 2026/27 to 2030/31. So it is an overlay on an
 * *estate valuation*, not on a projection, and it shares no machinery with its four siblings.
 *
 * Seven conventions decide what the numbers mean:
 *
 * 1. **Two measures, named and dated, and nothing else.** {@link BUDGET_POLICY_MEASURES} is the
 *    whole of what is modelled: unused pension funds entering the estate from 6 April 2027, and the
 *    nil-rate bands staying frozen in cash terms. Each carries the Budget it was announced at, the
 *    date it bites, the figures, and — see the sourcing note at the foot of this comment — how
 *    confident this repo is in each. Anything else a Budget did (income tax thresholds, NI, CGT,
 *    APR/BPR on farms and businesses) is deliberately not here.
 * 2. **The counterfactual is "these two changes never happened", not "no tax".** Every figure this
 *    module reports as an impact is the difference between two full IHT calculations on the same
 *    estate: one with the changes, one with pensions outside the estate and the bands rising with
 *    inflation. The second is a counterfactual, not a historical fact — the bands have not actually
 *    risen since 2009/10 (NRB) and 2020/21 (RNRB) — so it is labelled `withoutChanges` throughout
 *    rather than "before" or "old rules".
 * 3. **The split between the two measures is sequential, and the order is stated.** Tax is not
 *    additive across overlapping thresholds — putting a pension into the estate is worth more once
 *    the bands are frozen than it would be if they had kept up — so "how much of this is the freeze
 *    and how much is the pension change?" has no order-free answer. {@link budgetPolicyImpact}
 *    applies the freeze first and the pension inclusion second, so the two parts add exactly to the
 *    total by construction. Reversing the order would move value between them without changing the
 *    total.
 * 4. **The estate is what counts towards net worth, plus the pension pots.** The
 *    `exclude_from_net_worth` / `include_in_net_worth` flags in this data model exist to stop the
 *    same money being counted twice — above all the mortgage toggle, which hides a mortgage because
 *    the property tab is already netting it off — so honouring them is what keeps this estate figure
 *    reconcilable with the net worth headline the rest of the app shows. The cost is that a holding
 *    the user has deliberately hidden from net worth is also outside this estate figure even though
 *    it would be inside their real one; the remedy is the toggle, and #138's `estate.js` is where a
 *    fuller valuation belongs.
 * 5. **Only Defined Contribution pots are "unused pension funds".** {@link definedContributionPot}
 *    — DC workplace pots and SIPPs. Defined Benefit schemes have no fund to leave, and the survivors'
 *    pensions they pay are outside the measure; the State Pension is a promise, not a pot. A Lifetime
 *    ISA recorded on the Pensions tab is an ISA in everything but the tab it was typed into, so it is
 *    in the estate *both* sides of the change and sits in the base estate rather than in the pension
 *    figure — the same reading `retirement-income.js` already takes of a LISA.
 * 6. **Growth to a future tax year is one nominal rate, applied to assets, with debts held flat.**
 *    This module is not a projector — `forecast.js` is, and it models monthly contributions, per
 *    holding growth rates and fund fees that none of this needs. An estate valued for 2029/30 is
 *    today's asset side compounded three years at one stated rate; balances owed do not grow. That is
 *    a coarse figure and is labelled as one.
 * 7. **A tax year is named by the April it starts in.** `2026` means 6 April 2026 – 5 April 2027,
 *    written `2026/27`. The pension measure is therefore off for 2026/27 and on from 2027/28, which
 *    is exactly what "effective 6 April 2027" means, and is worth stating because getting it one year
 *    out is the easiest mistake available here.
 *
 * Every figure is in pounds, rounded to whole pence. Rates are whole-number percents (`40` = 40%),
 * matching `types.js`'s convention. Everything is pure: an estate and a policy config go in, plain
 * objects come out, nothing is mutated.
 *
 * ## Sourcing note — read before trusting a number here
 *
 * The issue that commissioned this module asked for the same rigour `tax.js`/`hicbc.js` hold
 * themselves to, and said in terms that a clearly-labelled illustrative placeholder beats a wrong
 * number presented as fact. This session had **no network access**, so nothing below was verified
 * against gov.uk at the time of writing; every figure is stated from the author's knowledge, and each
 * measure carries a `confidence` field saying how far that goes:
 *
 * - **`high`** — long-standing, repeatedly-published figures: the £325,000 nil-rate band (unchanged
 *   since 2009/10), the £175,000 residence nil-rate band and its £2,000,000 taper threshold
 *   (unchanged since 2020/21), the 40% rate, and the 6 April 2027 start date for pensions in the
 *   estate (Autumn Budget 2024, confirmed in the July 2025 consultation response).
 * - **`medium`** — the *end* of the band freeze. It is firmly established that the freeze runs to at
 *   least 5 April 2030 (extended there at the Autumn Budget of 30 October 2024). A further one-year
 *   extension to 5 April 2031 is what {@link BAND_FREEZE_END_TAX_YEAR} encodes, and it is the reading
 *   this issue's own title ("2026–2031") takes, but it is not verified here. It changes nothing
 *   before 2030/31 — see that constant's note, and override it via
 *   {@link BudgetPolicy.freezeEndTaxYear} rather than editing it if it turns out to be wrong.
 * - **`medium`** — that the statutory default in the absence of a freeze is CPI uprating rounded up
 *   to the nearest £1,000 (IHTA 1984 s.8). The rounding rule is what {@link indexedBand} applies; the
 *   *rate* is the user's own inflation assumption, never a published forecast.
 *
 * Anything a reader wants to rely on for real estate planning should be checked against HMRC's
 * "Inheritance Tax thresholds and interest rates" and the "Inheritance Tax on pensions" policy paper
 * on gov.uk. README.md's standing disclaimer — illustrative, not financial advice — applies here
 * more than anywhere else in this codebase.
 */

import { sumDebtBalances, sumInvestmentValues } from './debt.js';
import { propertyEquity } from './property.js';
import { definedContributionPot } from './retirement-income.js';

/*
 * As elsewhere in `$lib`: model types are referenced inline as `import('./types.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *` and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* Statutory figures                                                           */
/* -------------------------------------------------------------------------- */

/** The nil-rate band (£). CLAUDE.md's domain rules state this figure for 2026/27. */
export const NIL_RATE_BAND = 325_000;

/**
 * The residence nil-rate band (£) — the extra allowance for a home passing to direct descendants.
 * CLAUDE.md's domain rules state this figure for 2026/27.
 */
export const RESIDENCE_NIL_RATE_BAND = 175_000;

/** Net estate above which the residence nil-rate band starts to taper away (£). */
export const RNRB_TAPER_THRESHOLD = 2_000_000;

/** £1 of residence nil-rate band is lost for every £2 of estate over the threshold. */
export const RNRB_TAPER_DIVISOR = 2;

/** The standard Inheritance Tax rate on the estate above the available bands (%). */
export const IHT_RATE = 40;

/**
 * Indexed bands are rounded *up* to the nearest £1,000 — the statutory uprating rule (IHTA 1984
 * s.8), which is what convention 2's counterfactual has to reproduce to be worth comparing against.
 */
export const BAND_INDEXATION_ROUNDING = 1_000;

/* -------------------------------------------------------------------------- */
/* The two measures                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The first tax year this module models — 6 April 2026 to 5 April 2027, the year every other figure
 * in `$lib` is stated for (see `tax.js`'s `TAX_YEAR`).
 */
export const FIRST_MODELLED_TAX_YEAR = 2026;

/**
 * The tax year the pension measure takes effect in. Unused pension funds enter the estate for deaths
 * on or after **6 April 2027**, which is the first day of 2027/28 — convention 7.
 */
export const PENSION_IHT_TAX_YEAR = 2027;

/**
 * The last tax year the nil-rate bands are frozen for: 2030/31, ending 5 April 2031.
 *
 * **Confidence: medium — this is the one figure here most likely to be wrong.** The freeze certainly
 * runs to 5 April 2030 (extended there at the Autumn Budget of 30 October 2024, from the 5 April
 * 2028 set at the Autumn Statement of 17 November 2022). A further year, to 5 April 2031, is what
 * this constant encodes and what issue #137's own title ("Budget 2026–2031") describes, but it was
 * not verifiable from this session — see the module comment's sourcing note.
 *
 * It only matters for the single tax year 2030/31: set {@link BudgetPolicy.freezeEndTaxYear} to
 * `2029` to model the freeze ending after 2029/30 instead, and every other year is unaffected either
 * way.
 */
export const BAND_FREEZE_END_TAX_YEAR = 2030;

/**
 * The tax years {@link budgetPolicyProjection} reports on — 2026/27 through 2030/31, the window
 * README.md's "Budget 2026–2031 changes" names. Derived from the freeze so the two cannot drift.
 *
 * @type {readonly number[]}
 */
export const MODELLED_TAX_YEARS = Object.freeze(
	Array.from(
		{ length: Math.max(1, BAND_FREEZE_END_TAX_YEAR - FIRST_MODELLED_TAX_YEAR + 1) },
		(_, index) => FIRST_MODELLED_TAX_YEAR + index
	)
);

/**
 * One announced policy change, with the paper trail behind it.
 *
 * @typedef {object} BudgetPolicyMeasure
 * @property {'pensions_in_estate' | 'frozen_nil_rate_bands'} id
 * @property {string} label Short name for a heading or a toggle.
 * @property {string} announcedIn Which Budget or Statement announced it, with the date.
 * @property {string} effectiveFrom When it bites, in plain English.
 * @property {string} figures The numbers it turns on.
 * @property {'high' | 'medium' | 'low'} confidence How far this repo stands behind those numbers —
 *   see the module comment's sourcing note. Surfaced rather than hidden so a panel can say so.
 * @property {string} source Where to check it.
 * @property {string} summary What the measure actually does.
 */

/**
 * The two measures modelled here — convention 1. Frozen, and exported so a panel can render the
 * provenance next to the pounds rather than restating it in markup.
 *
 * @type {readonly BudgetPolicyMeasure[]}
 */
export const BUDGET_POLICY_MEASURES = Object.freeze([
	Object.freeze({
		id: /** @type {const} */ ('frozen_nil_rate_bands'),
		label: 'Frozen nil-rate bands',
		announcedIn:
			'Budget of 3 March 2021, extended at the Autumn Statement of 17 November 2022 and again at the Autumn Budget of 30 October 2024',
		effectiveFrom: `In force now; frozen through ${taxYearLabel(BAND_FREEZE_END_TAX_YEAR)}`,
		figures: `Nil-rate band £${NIL_RATE_BAND.toLocaleString('en-GB')}, residence nil-rate band £${RESIDENCE_NIL_RATE_BAND.toLocaleString('en-GB')}, both unchanged in cash terms`,
		confidence: /** @type {const} */ ('medium'),
		source: 'gov.uk — "Inheritance Tax thresholds and interest rates"',
		summary:
			'The two allowances stay at their cash figures instead of rising with inflation, so a growing estate is taxed on more of itself every year. The end date is the uncertain part — see BAND_FREEZE_END_TAX_YEAR.'
	}),
	Object.freeze({
		id: /** @type {const} */ ('pensions_in_estate'),
		label: 'Unused pension funds in the estate',
		announcedIn:
			'Autumn Budget of 30 October 2024, confirmed in the consultation response of July 2025',
		effectiveFrom: `Deaths on or after 6 April 2027 (${taxYearLabel(PENSION_IHT_TAX_YEAR)})`,
		figures: 'Unused Defined Contribution funds counted in full at their value on death',
		confidence: /** @type {const} */ ('high'),
		source: 'gov.uk — "Inheritance Tax on pensions: liability, reporting and payment"',
		summary:
			'Money left in a DC pot stops being outside the estate. It counts towards the £2,000,000 residence nil-rate band taper as well as towards the taxable estate, which is why a pot can cost more than 40% of itself.'
	})
]);

/* -------------------------------------------------------------------------- */
/* Tax years                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `2026` → `'2026/27'` — convention 7's naming, in one place so no caller has to do the arithmetic.
 *
 * @param {number} startYear The April the tax year starts in.
 * @returns {string}
 */
export function taxYearLabel(startYear) {
	const year = Math.trunc(startYear);
	return `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The dials this overlay offers.
 *
 * @typedef {object} BudgetPolicy
 * @property {boolean} pensionsInEstate Model the pension measure at all. `true` does *not* put
 *   pensions into a 2026/27 estate — the measure still only bites from {@link PENSION_IHT_TAX_YEAR}
 *   (convention 7). `false` is "assume it is repealed before it starts".
 * @property {boolean} bandsFrozen Model the freeze. `false` uprates the bands by
 *   `indexationRate` from 2026/27 onwards — the same counterfactual `withoutChanges` uses.
 * @property {number} freezeEndTaxYear Last tax year the freeze applies to; bands are uprated from
 *   their frozen level for tax years after it. Defaults to {@link BAND_FREEZE_END_TAX_YEAR}, which
 *   is the medium-confidence figure — this field is the override.
 * @property {number} indexationRate Annual uprating the bands would have had without the freeze (%).
 *   The user's own inflation assumption (`Profile.inflation_rate`), never a published forecast.
 * @property {number} estateGrowthRate Annual nominal growth applied to the asset side when valuing
 *   the estate in a future tax year (%) — convention 6.
 * @property {number} transferredBandsPct Percentage of a deceased spouse's or civil partner's unused
 *   nil-rate bands brought forward, 0–100. `100` is the common case where everything passed to the
 *   survivor; `0` is a single person or a first death.
 * @property {boolean} directDescendants Whether a home is passing to children or grandchildren —
 *   the residence nil-rate band's own precondition. `false` removes the RNRB entirely.
 */

/**
 * Defaults for an estate nobody has configured yet.
 *
 * README.md names the scenario but gives no figures, so the modelling assumptions are ours: both
 * measures on (the point of the overlay is to show what was announced, so "off" is the comparison,
 * not the starting state); 2.5% indexation and 5% estate growth, matching `model.js`'s own
 * `createProfile` defaults for `inflation_rate` and `growth_rate` so a panel seeded from the
 * profile changes nothing; no transferred bands, because assuming a widowed user would double the
 * allowance of every single person who never touched the control; and `directDescendants: true`,
 * because the RNRB is the allowance README.md's estate feature leads with and an estate with no
 * descendants is the narrower case.
 *
 * @type {Readonly<BudgetPolicy>}
 */
export const DEFAULT_BUDGET_POLICY = Object.freeze({
	pensionsInEstate: true,
	bandsFrozen: true,
	freezeEndTaxYear: BAND_FREEZE_END_TAX_YEAR,
	indexationRate: 2.5,
	estateGrowthRate: 5,
	transferredBandsPct: 0,
	directDescendants: true
});

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

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
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
 * Fill in and bound a partial config, so a hand-edited document or a half-filled form both become
 * something this module can calculate from. Out-of-range values are clamped rather than rejected,
 * matching every sibling scenario's own `normalise*` function.
 *
 * @param {Partial<BudgetPolicy>} [policy]
 * @returns {BudgetPolicy}
 */
export function normaliseBudgetPolicy(policy = {}) {
	return {
		pensionsInEstate: asBoolean(policy.pensionsInEstate, DEFAULT_BUDGET_POLICY.pensionsInEstate),
		bandsFrozen: asBoolean(policy.bandsFrozen, DEFAULT_BUDGET_POLICY.bandsFrozen),
		freezeEndTaxYear: Math.trunc(
			clamp(
				asNumber(policy.freezeEndTaxYear, DEFAULT_BUDGET_POLICY.freezeEndTaxYear),
				FIRST_MODELLED_TAX_YEAR,
				FIRST_MODELLED_TAX_YEAR + 100
			)
		),
		indexationRate: clamp(
			asNumber(policy.indexationRate, DEFAULT_BUDGET_POLICY.indexationRate),
			0,
			100
		),
		estateGrowthRate: clamp(
			asNumber(policy.estateGrowthRate, DEFAULT_BUDGET_POLICY.estateGrowthRate),
			-100,
			100
		),
		transferredBandsPct: clamp(
			asNumber(policy.transferredBandsPct, DEFAULT_BUDGET_POLICY.transferredBandsPct),
			0,
			100
		),
		directDescendants: asBoolean(policy.directDescendants, DEFAULT_BUDGET_POLICY.directDescendants)
	};
}

/* -------------------------------------------------------------------------- */
/* The bands                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A band uprated for `years` years at `ratePct` and rounded up to the nearest £1,000 — the statutory
 * rule the freeze suspends (see {@link BAND_INDEXATION_ROUNDING}).
 *
 * @param {number} band Starting amount (£).
 * @param {number} ratePct Annual uprating (%).
 * @param {number} years Whole years of uprating; `0` returns `band` unchanged.
 * @returns {number} (£)
 */
export function indexedBand(band, ratePct, years) {
	if (years <= 0) return roundMoney(band);
	const grown = band * (1 + ratePct / 100) ** years;
	return Math.ceil(grown / BAND_INDEXATION_ROUNDING) * BAND_INDEXATION_ROUNDING;
}

/**
 * The two statutory bands as they stand in one tax year.
 *
 * @typedef {object} NilRateBands
 * @property {number} startYear
 * @property {string} taxYear
 * @property {number} nrb Nil-rate band (£).
 * @property {number} rnrb Residence nil-rate band (£).
 * @property {boolean} frozen Whether the freeze was still in force for this tax year.
 * @property {number} indexedYears How many years of uprating were applied — `0` under the freeze.
 */

/**
 * What the bands are worth in a given tax year, under this config.
 *
 * Under the freeze the answer is the cash figures, every year, until `freezeEndTaxYear`; after it,
 * uprating resumes *from the frozen level* (the freeze is not made up afterwards). With
 * `bandsFrozen: false` the bands are uprated from 2026/27 throughout — which is the counterfactual
 * convention 2 compares against, not a prediction.
 *
 * @param {number} startYear The April the tax year starts in.
 * @param {Partial<BudgetPolicy>} [policy]
 * @returns {NilRateBands}
 */
export function nilRateBandsForTaxYear(startYear, policy = {}) {
	const config = normaliseBudgetPolicy(policy);
	const year = Math.trunc(startYear);
	const yearsSinceBase = Math.max(0, year - FIRST_MODELLED_TAX_YEAR);
	const frozen = config.bandsFrozen && year <= config.freezeEndTaxYear;

	const indexedYears = config.bandsFrozen
		? Math.max(0, year - Math.max(config.freezeEndTaxYear, FIRST_MODELLED_TAX_YEAR))
		: yearsSinceBase;

	return {
		startYear: year,
		taxYear: taxYearLabel(year),
		nrb: indexedBand(NIL_RATE_BAND, config.indexationRate, indexedYears),
		rnrb: indexedBand(RESIDENCE_NIL_RATE_BAND, config.indexationRate, indexedYears),
		frozen,
		indexedYears
	};
}

/**
 * The allowance an estate actually gets, after the residence nil-rate band's preconditions, its
 * £2,000,000 taper and any transferred bands.
 *
 * @typedef {object} AvailableBands
 * @property {number} nrb Nil-rate band including any transferred share (£).
 * @property {number} rnrb Residence nil-rate band actually available, after taper and the
 *   residence-value cap (£).
 * @property {number} rnrbBeforeTaper What the RNRB would have been without the taper (£).
 * @property {number} taperLoss RNRB withdrawn by the taper (£).
 * @property {number} residenceCapLoss RNRB lost because the home is worth less than the band (£).
 * @property {number} total `nrb + rnrb` — the estate can pass this much tax-free (£).
 */

/**
 * Apply the residence nil-rate band's own rules to one tax year's bands.
 *
 * Three of them, in this order, because the order changes the answer:
 *
 * 1. **Preconditions.** No home passing to direct descendants, no RNRB at all.
 * 2. **The taper.** £1 of RNRB is withdrawn for every £2 of net estate above £2,000,000, applied to
 *    the RNRB *including* any transferred share — which is why the pension measure can cost an
 *    estate far more than 40% of the pot: the pot pushes the estate through the taper as well as
 *    into the taxable band.
 * 3. **The residence-value cap.** The RNRB is limited to what the home is actually worth net of its
 *    mortgage. A £120,000 home cannot attract a £175,000 allowance.
 *
 * `residenceValue` of `null` — no primary residence recorded — is treated as *no qualifying home*,
 * not as "unknown, assume the full band". That is the legally accurate reading (no home, no RNRB)
 * and the only one consistent with convention 4: an estate valued from this app's own data with no
 * property in it has no home in its `total` either, so granting it a home-related allowance would
 * quietly understate the bill.
 *
 * @param {number} estateValue Net estate the taper is assessed on (£).
 * @param {NilRateBands} bands
 * @param {Partial<BudgetPolicy>} [policy]
 * @param {number | null} [residenceValue] Net value of the qualifying home (£), or `null` for none.
 * @returns {AvailableBands}
 */
export function availableNilRateBands(estateValue, bands, policy = {}, residenceValue = null) {
	const config = normaliseBudgetPolicy(policy);
	const transferMultiplier = 1 + config.transferredBandsPct / 100;

	const nrb = roundMoney(bands.nrb * transferMultiplier);

	if (!config.directDescendants || residenceValue === null || residenceValue <= 0) {
		return {
			nrb,
			rnrb: 0,
			rnrbBeforeTaper: 0,
			taperLoss: 0,
			residenceCapLoss: 0,
			total: nrb
		};
	}

	const rnrbBeforeTaper = roundMoney(bands.rnrb * transferMultiplier);
	const taperLoss = roundMoney(
		Math.min(rnrbBeforeTaper, Math.max(0, estateValue - RNRB_TAPER_THRESHOLD) / RNRB_TAPER_DIVISOR)
	);
	const afterTaper = roundMoney(rnrbBeforeTaper - taperLoss);
	const capped = roundMoney(Math.min(afterTaper, residenceValue));

	return {
		nrb,
		rnrb: capped,
		rnrbBeforeTaper,
		taperLoss,
		residenceCapLoss: roundMoney(afterTaper - capped),
		total: roundMoney(nrb + capped)
	};
}

/* -------------------------------------------------------------------------- */
/* The estate                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Everything the app knows about that an estate is made of. Every field is optional: an empty
 * position is an empty estate, not an error.
 *
 * @typedef {object} EstatePosition
 * @property {readonly import('./types.js').Investment[]} [investments] Latest snapshot's holdings.
 *   Stated as complete records because that is what a `MonthlyEntry` holds and what `debt.js`'s
 *   {@link sumInvestmentValues} takes; the other three lists are `Partial` because the helpers
 *   behind them (`propertyEquity`, `definedContributionPot`) already read half-filled records.
 * @property {readonly import('./types.js').Debt[]} [debts] Latest snapshot's debts.
 * @property {readonly Partial<import('./types.js').Property>[]} [properties]
 * @property {readonly Partial<import('./types.js').Asset>[]} [assets]
 * @property {readonly Partial<import('./types.js').Pension>[]} [pensions]
 */

/**
 * @param {EstatePosition} position
 * @returns {Partial<import('./types.js').Property>[]}
 */
function countedProperties(position) {
	return (position.properties ?? []).filter((property) => property?.include_in_net_worth !== false);
}

/**
 * The net value of the home the residence nil-rate band could attach to: the most valuable
 * `primary_residence`, net of its mortgage. Only a home the deceased lived in qualifies, so a
 * buy-to-let or a holiday home is not it, however valuable.
 *
 * Returns `null` when no primary residence is recorded, which {@link availableNilRateBands} reads as
 * no qualifying home and therefore no residence nil-rate band at all. An estate valued from this
 * app's own data with no property in it has no home inside its total either, so the allowance and
 * the asset it attaches to appear and disappear together.
 *
 * @param {EstatePosition} [position]
 * @returns {number | null} (£)
 */
export function qualifyingResidenceValue(position = {}) {
	const homes = countedProperties(position).filter(
		(property) => property?.type === 'primary_residence'
	);
	if (homes.length === 0) return null;
	return roundMoney(Math.max(0, ...homes.map((home) => propertyEquity(home))));
}

/**
 * One estate, valued for one tax year.
 *
 * @typedef {object} EstateValuation
 * @property {number} startYear
 * @property {string} taxYear
 * @property {number} growthYears Years of growth applied since 2026/27 — convention 6.
 * @property {number} investments Counted snapshot holdings (£).
 * @property {number} propertyEquity Counted property equity (£).
 * @property {number} physicalAssets Counted physical assets (£).
 * @property {number} lifetimeIsaPots Lifetime ISA pots recorded on the Pensions tab (£) — in the
 *   estate on both sides of the pension measure, see convention 5.
 * @property {number} debts Balances owed, held flat (£).
 * @property {number} pensionPots Unused Defined Contribution funds (£), whether or not they are in
 *   the estate this year.
 * @property {boolean} pensionsCounted Whether `pensionPots` is inside `total` for this tax year.
 * @property {number | null} residence Net value of the qualifying home (£), grown to this tax year,
 *   or `null` when none is recorded — see {@link qualifyingResidenceValue}.
 * @property {number} withoutPensions Estate excluding the pension pots (£).
 * @property {number} total The chargeable estate for this tax year (£).
 */

/**
 * Value an estate for one tax year.
 *
 * `pensionsCounted` is the whole of the pension measure: the pots are always reported, and they are
 * only added to `total` when the caller asked for the measure *and* the tax year is 2027/28 or later
 * (convention 7).
 *
 * @param {EstatePosition} [position]
 * @param {number} [startYear] Defaults to 2026/27 — today's estate, ungrown.
 * @param {Partial<BudgetPolicy>} [policy]
 * @returns {EstateValuation}
 */
export function estateValuation(position = {}, startYear = FIRST_MODELLED_TAX_YEAR, policy = {}) {
	const config = normaliseBudgetPolicy(policy);
	const year = Math.trunc(startYear);
	const growthYears = Math.max(0, year - FIRST_MODELLED_TAX_YEAR);
	const growth = (1 + config.estateGrowthRate / 100) ** growthYears;

	/** @param {number} amount @returns {number} */
	const grown = (amount) => roundMoney(amount * growth);

	const investments = grown(sumInvestmentValues(position.investments ?? []));
	const equity = grown(
		countedProperties(position).reduce((total, property) => total + propertyEquity(property), 0)
	);
	const physicalAssets = grown(
		(position.assets ?? [])
			.filter((asset) => asset?.include_in_net_worth !== false)
			.reduce((total, asset) => total + asNumber(asset?.current_value, 0), 0)
	);
	const lifetimeIsaPots = grown(
		(position.pensions ?? [])
			.filter((pension) => pension?.type === 'lisa')
			.reduce((total, pension) => total + asNumber(pension?.value, 0), 0)
	);
	const debts = roundMoney(sumDebtBalances(position.debts ?? []));
	const pensionPots = grown(definedContributionPot(position.pensions ?? []));

	const residence = qualifyingResidenceValue(position);
	const grownResidence = residence === null ? null : grown(residence);

	const withoutPensions = roundMoney(
		investments + equity + physicalAssets + lifetimeIsaPots - debts
	);
	const pensionsCounted = config.pensionsInEstate && year >= PENSION_IHT_TAX_YEAR;

	return {
		startYear: year,
		taxYear: taxYearLabel(year),
		growthYears,
		investments,
		propertyEquity: equity,
		physicalAssets,
		lifetimeIsaPots,
		debts,
		pensionPots,
		pensionsCounted,
		residence: grownResidence,
		withoutPensions,
		total: roundMoney(withoutPensions + (pensionsCounted ? pensionPots : 0))
	};
}

/* -------------------------------------------------------------------------- */
/* The bill                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What one estate pays in one tax year.
 *
 * @typedef {object} IhtLiability
 * @property {number} startYear
 * @property {string} taxYear
 * @property {number} estate Chargeable estate (£).
 * @property {number} allowance Nil-rate bands available (£).
 * @property {number} taxable Estate above the allowance (£).
 * @property {number} tax Inheritance Tax due (£).
 * @property {number} effectiveRate `tax / estate` as a percent, `0` on an empty estate (%).
 * @property {NilRateBands} bands The statutory bands for the year.
 * @property {AvailableBands} available How much of them this estate got.
 * @property {EstateValuation} valuation
 */

/**
 * Value an estate for a tax year and work out the tax on it — bands, taper, 40%.
 *
 * A negative estate (more owed than owned) is taxable at nothing, not at a negative amount.
 *
 * @param {EstatePosition} [position]
 * @param {number} [startYear]
 * @param {Partial<BudgetPolicy>} [policy]
 * @returns {IhtLiability}
 */
export function estateIht(position = {}, startYear = FIRST_MODELLED_TAX_YEAR, policy = {}) {
	const valuation = estateValuation(position, startYear, policy);
	const bands = nilRateBandsForTaxYear(startYear, policy);
	const available = availableNilRateBands(valuation.total, bands, policy, valuation.residence);

	const estate = Math.max(0, valuation.total);
	const taxable = roundMoney(Math.max(0, estate - available.total));
	const tax = roundMoney((taxable * IHT_RATE) / 100);

	return {
		startYear: valuation.startYear,
		taxYear: valuation.taxYear,
		estate: roundMoney(estate),
		allowance: available.total,
		taxable,
		tax,
		effectiveRate: estate > 0 ? (tax / estate) * 100 : 0,
		bands,
		available,
		valuation
	};
}

/* -------------------------------------------------------------------------- */
/* The overlay                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What the two announced changes did to one estate in one tax year.
 *
 * @typedef {object} BudgetPolicyImpact
 * @property {number} startYear
 * @property {string} taxYear
 * @property {IhtLiability} withChanges Both measures as configured — the world as announced.
 * @property {IhtLiability} withoutChanges Neither measure: pensions outside the estate, bands
 *   uprated with inflation. The counterfactual of convention 2.
 * @property {IhtLiability} freezeOnly The intermediate step convention 3's split is taken at.
 * @property {number} extraTax `withChanges.tax - withoutChanges.tax` (£).
 * @property {number} fromFrozenBands The part of `extraTax` attributable to the freeze (£).
 * @property {number} fromPensionsInEstate The part attributable to unused pensions entering the
 *   estate (£) — zero before 2027/28, always.
 * @property {number | null} extraTaxShare `extraTax / withoutChanges.tax`, or `null` when the
 *   counterfactual estate paid nothing — an estate that goes from no bill to a bill has no
 *   meaningful percentage increase.
 * @property {number} bandErosion How much the frozen bands are worth less than the uprated ones (£).
 */

/**
 * Run one estate through both worlds for one tax year and split the difference between the two
 * measures — the headline this overlay exists to produce.
 *
 * The split is sequential and the order is stated (convention 3): the freeze is applied first, the
 * pension inclusion second, so `fromFrozenBands + fromPensionsInEstate === extraTax` exactly.
 *
 * A config with a measure switched off simply reports `0` for that measure's share, because
 * `withChanges` and the intermediate step then coincide — no special case needed.
 *
 * @param {EstatePosition} [position]
 * @param {number} [startYear]
 * @param {Partial<BudgetPolicy>} [policy]
 * @returns {BudgetPolicyImpact}
 */
export function budgetPolicyImpact(
	position = {},
	startYear = FIRST_MODELLED_TAX_YEAR,
	policy = {}
) {
	const config = normaliseBudgetPolicy(policy);

	const withoutChanges = estateIht(position, startYear, {
		...config,
		pensionsInEstate: false,
		bandsFrozen: false
	});
	const freezeOnly = estateIht(position, startYear, { ...config, pensionsInEstate: false });
	const withChanges = estateIht(position, startYear, config);

	const extraTax = roundMoney(withChanges.tax - withoutChanges.tax);

	return {
		startYear: withChanges.startYear,
		taxYear: withChanges.taxYear,
		withChanges,
		withoutChanges,
		freezeOnly,
		extraTax,
		fromFrozenBands: roundMoney(freezeOnly.tax - withoutChanges.tax),
		fromPensionsInEstate: roundMoney(withChanges.tax - freezeOnly.tax),
		extraTaxShare: withoutChanges.tax > 0 ? extraTax / withoutChanges.tax : null,
		bandErosion: roundMoney(withoutChanges.available.total - freezeOnly.available.total)
	};
}

/**
 * {@link budgetPolicyImpact} for every tax year in the Budget window — the row-per-year table a
 * panel draws, 2026/27 through 2030/31.
 *
 * @param {EstatePosition} [position]
 * @param {Partial<BudgetPolicy>} [policy]
 * @param {readonly number[]} [years] Defaults to {@link MODELLED_TAX_YEARS}.
 * @returns {BudgetPolicyImpact[]}
 */
export function budgetPolicyProjection(position = {}, policy = {}, years = MODELLED_TAX_YEARS) {
	return years.map((startYear) => budgetPolicyImpact(position, startYear, policy));
}

/**
 * The one-line reading of a whole projection.
 *
 * @typedef {object} BudgetPolicySummary
 * @property {string} firstTaxYear
 * @property {string} lastTaxYear
 * @property {BudgetPolicyImpact | null} last The final year's impact — the figure a headline quotes.
 * @property {string | null} firstTaxedTaxYear The first modelled tax year the estate owes anything
 *   in *because of* these changes, or `null` if none does.
 * @property {number} peakExtraTax The largest single year's `extraTax` across the window (£).
 * @property {boolean} pensionsBite Whether the pension measure changed the bill in any modelled year.
 * @property {boolean} freezeBites Whether the freeze changed the bill in any modelled year.
 */

/**
 * Collapse a projection to the handful of figures a headline needs, so a panel reads one object
 * rather than re-scanning the rows.
 *
 * @param {readonly BudgetPolicyImpact[]} projection
 * @returns {BudgetPolicySummary}
 */
export function budgetPolicySummary(projection) {
	const rows = [...projection];
	const first = rows[0] ?? null;
	const last = rows.at(-1) ?? null;
	const firstTaxed = rows.find((row) => row.extraTax > 0) ?? null;

	return {
		firstTaxYear: first?.taxYear ?? '',
		lastTaxYear: last?.taxYear ?? '',
		last,
		firstTaxedTaxYear: firstTaxed?.taxYear ?? null,
		peakExtraTax: roundMoney(rows.reduce((peak, row) => Math.max(peak, row.extraTax), 0)),
		pensionsBite: rows.some((row) => row.fromPensionsInEstate !== 0),
		freezeBites: rows.some((row) => row.fromFrozenBands !== 0)
	};
}
