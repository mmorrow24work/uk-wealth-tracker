/**
 * Inheritance Tax: the nil-rate bands and the bill — README.md → "Estate & IHT Calculator": the
 * £325,000 nil-rate band, the £175,000 residence nil-rate band, "Spouse/civil partner transferable
 * allowances", and the 40% charged on whatever is left above them (issue #138).
 *
 * This is the foundation the rest of the Estate & IHT suite is built on: lifetime gifts with the
 * 7-year taper (#139), the "if I died today" and who-gets-what views (#140) and the property
 * gift-on-sale (#141) all read the bands and the liability from here rather than restating them.
 * `budget-policy.js` (#137) already did the same in the other direction — it was written first and
 * carried its own copy of these figures; that copy is now this module's, imported back, so there is
 * exactly one statement of each statutory number in the codebase.
 *
 * The whole calculation, in the order it actually happens:
 *
 * ```text
 * gross estate                       everything owned at death
 *   less liabilities                 mortgages, loans, funeral expenses
 * = net estate                       ← the £2,000,000 residence-band taper is measured on THIS
 *   less exempt transfers            anything passing to a spouse or civil partner
 * = chargeable estate
 *   less residence nil-rate band     first, and only against a home closely inherited
 *   less nil-rate band               £325,000, plus any percentage brought forward from a spouse
 * = taxable estate                   × 40%
 * ```
 *
 * Seven conventions decide what the numbers here mean:
 *
 * 1. **The taper is measured on the net estate, before exemptions and reliefs.** The residence
 *    nil-rate band is withdrawn at £1 for every £2 of estate above {@link RNRB_TAPER_THRESHOLD}, and
 *    the figure that £2,000,000 is compared against is the estate after debts but *before* anything
 *    is taken off for passing to a spouse. This is the single easiest thing to get wrong here — an
 *    estate of £2.4m that leaves everything to a spouse pays no tax at all and still loses the whole
 *    residence band — so {@link estateAllowances} takes the net estate and never the chargeable one.
 * 2. **The residence band is used before the nil-rate band.** It makes no difference to this death's
 *    bill (both are charged at nil, and the total available is the same either way) but it decides
 *    how much of the £325,000 is left unused, and therefore how much a surviving spouse can bring
 *    forward — see convention 5.
 * 3. **The residence band is capped three times over**, in this order: it needs a home closely
 *    inherited by direct descendants at all (`directDescendants`); it is then tapered
 *    (convention 1); and it is finally capped at what the home is actually worth net of its
 *    mortgage. A £120,000 home cannot attract a £175,000 allowance.
 * 4. **Transferred allowances are percentages, not amounts.** What a widow or widower inherits from
 *    a first death is the *percentage* of each band that went unused, applied to the bands in force
 *    at the second death. `transferredNilRateBandPct: 100` — the usual case, where everything passed
 *    to the survivor — doubles the band to £650,000. The two bands transfer independently and are
 *    stated as two fields, because a first estate can easily use one and not the other.
 * 5. **{@link transferableAllowances} is the other side of that transfer**: run a first death through
 *    {@link inheritanceTax} and it reports the two percentages the survivor's estate should later be
 *    given. Each is capped at 100% — the statutory ceiling is one extra band, however many the first
 *    estate itself had.
 * 6. **Every band is a parameter, defaulting to the 2026/27 statutory figures.** The bands are frozen
 *    in cash terms and this app is a 2026/27 app, so callers can ignore the second argument
 *    entirely; `budget-policy.js`, which models what happens if the freeze ends, passes its own
 *    uprated figures through the same functions rather than reimplementing them.
 * 7. **Everything is pure and every money figure is rounded to whole pence**, matching `tax.js`,
 *    `state-pension.js` and the rest of `$lib`. Rates and percentages are whole-number percents
 *    (`40` = 40%), per `types.js`'s convention; percentages that fall out of a calculation
 *    (a transferable share, an effective rate) are left at full precision for the caller to round
 *    for display.
 *
 * ## Worked examples
 *
 * Each of these is a test in `estate.test.js`, and they are the examples this module was written
 * against rather than an illustration added afterwards:
 *
 * ```text
 * £500,000, nothing to descendants        325,000 free, 175,000 taxable        → £70,000
 * £500,000, £300,000 home to children     500,000 free, nothing taxable        → £0
 * £1,000,000, £400,000 home to children,
 *   both bands transferred in full        1,000,000 free                       → £0
 * £2,100,000, £500,000 home to children   taper takes 50,000 of the RNRB       → £660,000
 * £2,350,000, £500,000 home to children   taper takes the RNRB entirely        → £810,000
 * £600,000, £120,000 home to children     RNRB capped at the home's value      → £62,000
 * £900,000, £400,000 to a spouse,
 *   £300,000 home to children             chargeable estate 500,000            → £0
 * ```
 *
 * ## What this deliberately does not model
 *
 * - **The 36% reduced rate** where 10% or more of the estate goes to charity (README.md's free-tier
 *   list names it). Charitable legacies are exempt, which is the easy half; the rate itself turns on
 *   a "baseline amount" whose interaction with the residence nil-rate band this session could not
 *   verify against HMRC (no network access — the same constraint `budget-policy.js`'s sourcing note
 *   records). Charging 40% where 36% was due would overstate a real bill, so rather than ship a
 *   half-checked rule this module takes no charity input at all: an estate with charitable legacies
 *   cannot be modelled here yet, which is visible, instead of being modelled wrongly, which is not.
 * - **Lifetime gifts.** Chargeable transfers in the seven years before death use the nil-rate band
 *   first and can exhaust it before the estate reaches it. That is #139, and it plugs in at exactly
 *   one place: reducing {@link AvailableBands.nrb} before {@link inheritanceTax} charges anything.
 * - **Business and Agricultural Property Relief, quick succession relief, trusts and settled
 *   property, grossing up where a specific gift is left free of tax, the instalment option on land
 *   and businesses, and the deemed £100,000 residence band for a spouse who died before 6 April
 *   2017.** None has a field in this app's data model.
 * - **Unused pension funds entering the estate from 6 April 2027.** That is a question about what
 *   the estate *contains*, not about the bands, and `budget-policy.js` already models it — including
 *   the way a pension pot can push an estate through the £2,000,000 taper as well as into the taxed
 *   band.
 *
 * ## Sourcing
 *
 * The four figures below — £325,000, £175,000, the £2,000,000 taper threshold and 40% — are the ones
 * CLAUDE.md's domain-rules section states for 2026/27, and this module matches them exactly rather
 * than substituting general knowledge. Like `budget-policy.js`, this session had **no network
 * access**, so nothing was re-verified against gov.uk at the time of writing; anything relied on for
 * real estate planning should be checked against HMRC's "Inheritance Tax thresholds and interest
 * rates" and "Inheritance Tax: residence nil rate band". README.md's standing disclaimer —
 * illustrative, not financial advice — applies here more than anywhere else in this codebase.
 */

/*
 * As elsewhere in `$lib`: model types are referenced inline as `import('./types.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *` and
 * svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* Statutory figures                                                           */
/* -------------------------------------------------------------------------- */

/** The tax year every figure in this module belongs to, matching `tax.js`'s `TAX_YEAR`. */
export const IHT_TAX_YEAR = '2026/27';

/**
 * The nil-rate band (£) — what any estate can pass on before Inheritance Tax is charged at all.
 * CLAUDE.md's domain rules state this figure for {@link IHT_TAX_YEAR}; it has been £325,000 since
 * 2009/10 and is frozen in cash terms (see `budget-policy.js`).
 */
export const NIL_RATE_BAND = 325_000;

/**
 * The residence nil-rate band (£) — the extra allowance for a home passing to direct descendants.
 * CLAUDE.md's domain rules state this figure for {@link IHT_TAX_YEAR}.
 */
export const RESIDENCE_NIL_RATE_BAND = 175_000;

/** Net estate above which the residence nil-rate band starts to taper away (£) — convention 1. */
export const RNRB_TAPER_THRESHOLD = 2_000_000;

/** £1 of residence nil-rate band is lost for every £2 of estate over the threshold. */
export const RNRB_TAPER_DIVISOR = 2;

/** The standard Inheritance Tax rate on the estate above the available bands (%). */
export const IHT_RATE = 40;

/**
 * The most of either band that can be brought forward from a spouse or civil partner (%) — one
 * extra band, however many the first estate itself was entitled to (convention 5).
 */
export const MAX_TRANSFERRED_BAND_PCT = 100;

/**
 * The two bands as they stand in {@link IHT_TAX_YEAR} — the default second argument to every
 * function here that needs them (convention 6).
 *
 * @type {Readonly<NilRateBandPair>}
 */
export const STATUTORY_NIL_RATE_BANDS = Object.freeze({
	nrb: NIL_RATE_BAND,
	rnrb: RESIDENCE_NIL_RATE_BAND
});

/**
 * The pair of statutory bands a calculation is run against — `budget-policy.js`'s own `NilRateBands`
 * satisfies this, which is how an uprated or frozen year's figures reach these functions.
 *
 * @typedef {object} NilRateBandPair
 * @property {number} nrb Nil-rate band before any transfer (£).
 * @property {number} rnrb Residence nil-rate band before any transfer (£).
 */

/* -------------------------------------------------------------------------- */
/* The estate                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One estate, as this module needs it stated. Every field is optional — an empty object is an empty
 * estate, not an error — and every one is a plain number, because the job of turning this app's
 * holdings, properties, pensions and debts into these figures belongs to the caller
 * (`budget-policy.js`'s `estateValuation` does it today; #140's "if I died today" view is where a
 * fuller valuation lands).
 *
 * @typedef {object} Estate
 * @property {number} estateValue Everything owned at death, before deducting anything (£).
 * @property {number} liabilities Mortgages, loans, credit balances and funeral expenses (£).
 *   Deducted from `estateValue` to give the net estate — which is what the taper is measured on.
 * @property {number} spouseExempt The part of the net estate passing to a spouse or civil partner
 *   (£). Exempt without limit, and deducted *after* the taper has been measured (convention 1).
 * @property {number} residenceValue The home closely inherited by direct descendants, net of its
 *   mortgage (£). Caps the residence nil-rate band; `0` means there is no qualifying home and so no
 *   residence band at all.
 * @property {boolean} directDescendants Whether that home is passing to children, grandchildren or
 *   other direct descendants — the residence band's own precondition. `false` removes it entirely,
 *   however valuable the home.
 * @property {number} transferredNilRateBandPct Percentage of a predeceased spouse's or civil
 *   partner's nil-rate band brought forward, 0–{@link MAX_TRANSFERRED_BAND_PCT}. `100` is the common
 *   case where everything passed to the survivor; `0` is a single person or a first death.
 * @property {number} transferredResidenceNilRateBandPct The same for the residence band, stated
 *   separately because a first estate can easily leave one unused and not the other (convention 4).
 */

/**
 * An estate as a caller may hand it over: any subset of {@link Estate}'s fields, with `null`
 * accepted for the residence — that is how `budget-policy.js` reports "no primary residence
 * recorded", and an estate with no home is the same thing as one with a home worth nothing as far as
 * the residence band is concerned.
 *
 * @typedef {Omit<Partial<Estate>, 'residenceValue'> & { residenceValue?: number | null }} EstateInput
 */

/**
 * An estate nobody has described yet: nothing owned, nothing owed, no home.
 *
 * `directDescendants` defaults to `true` — matching `budget-policy.js`'s `DEFAULT_BUDGET_POLICY` —
 * because `residenceValue` is what actually gates the residence band here: an estate with no home
 * recorded gets no residence band regardless, and stating a home's value at all is the affirmative
 * act. The flag is for the case where there *is* a home and it is going somewhere other than to
 * children.
 *
 * @type {Readonly<Estate>}
 */
export const DEFAULT_ESTATE = Object.freeze({
	estateValue: 0,
	liabilities: 0,
	spouseExempt: 0,
	residenceValue: 0,
	directDescendants: true,
	transferredNilRateBandPct: 0,
	transferredResidenceNilRateBandPct: 0
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

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function asBoolean(value, fallback) {
	return typeof value === 'boolean' ? value : fallback;
}

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * Fill in and bound a partial estate, so a half-filled form or a hand-edited document both become
 * something this module can calculate from. Negative money reads as zero and out-of-range
 * percentages are clamped rather than rejected, matching every other `normalise*` in `$lib`.
 *
 * `null` is accepted anywhere a number is expected and reads as `0` — see {@link EstateInput}.
 *
 * @param {EstateInput} [estate]
 * @returns {Estate}
 */
export function normaliseEstate(estate = {}) {
	return {
		estateValue: Math.max(0, asNumber(estate.estateValue, DEFAULT_ESTATE.estateValue)),
		liabilities: Math.max(0, asNumber(estate.liabilities, DEFAULT_ESTATE.liabilities)),
		spouseExempt: Math.max(0, asNumber(estate.spouseExempt, DEFAULT_ESTATE.spouseExempt)),
		residenceValue: Math.max(0, asNumber(estate.residenceValue, DEFAULT_ESTATE.residenceValue)),
		directDescendants: asBoolean(estate.directDescendants, DEFAULT_ESTATE.directDescendants),
		transferredNilRateBandPct: clamp(
			asNumber(estate.transferredNilRateBandPct, DEFAULT_ESTATE.transferredNilRateBandPct),
			0,
			MAX_TRANSFERRED_BAND_PCT
		),
		transferredResidenceNilRateBandPct: clamp(
			asNumber(
				estate.transferredResidenceNilRateBandPct,
				DEFAULT_ESTATE.transferredResidenceNilRateBandPct
			),
			0,
			MAX_TRANSFERRED_BAND_PCT
		)
	};
}

/**
 * Everything owned less everything owed (£) — and the figure the £2,000,000 taper is measured
 * against, per convention 1. Can be negative: an estate can owe more than it owns.
 *
 * @param {EstateInput} [estate]
 * @returns {number} (£)
 */
export function netEstate(estate = {}) {
	const { estateValue, liabilities } = normaliseEstate(estate);
	return roundMoney(estateValue - liabilities);
}

/**
 * The part of the net estate Inheritance Tax is actually charged on: everything left after the
 * spouse exemption, floored at zero.
 *
 * @param {EstateInput} [estate]
 * @returns {number} (£)
 */
export function chargeableEstate(estate = {}) {
	const config = normaliseEstate(estate);
	return roundMoney(Math.max(0, netEstate(config) - config.spouseExempt));
}

/* -------------------------------------------------------------------------- */
/* The bands                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A band plus whatever percentage of it was brought forward from a first death — convention 4.
 * `transferredBand(325_000, 100)` is £650,000.
 *
 * @param {number} band The statutory band (£).
 * @param {number} transferredPct Percentage brought forward, 0–{@link MAX_TRANSFERRED_BAND_PCT}.
 * @returns {number} (£)
 */
export function transferredBand(band, transferredPct) {
	const pct = clamp(asNumber(transferredPct, 0), 0, MAX_TRANSFERRED_BAND_PCT);
	return roundMoney(band * (1 + pct / 100));
}

/**
 * The allowance an estate actually gets, after the residence band's preconditions, its £2,000,000
 * taper and the value of the home it attaches to.
 *
 * @typedef {object} AvailableBands
 * @property {number} nrb Nil-rate band including any transferred share (£).
 * @property {number} rnrb Residence nil-rate band actually available, after taper and the
 *   residence-value cap (£).
 * @property {number} rnrbEnhancement The residence band including any transferred share, before the
 *   precondition, the taper or the cap (£) — always stated, even where no residence band is
 *   available, because it is the denominator {@link transferableAllowances} measures against.
 * @property {number} rnrbBeforeTaper What the residence band would have been without the taper (£).
 *   `0` where the estate has no qualifying home at all, which is what distinguishes it from
 *   `rnrbEnhancement`.
 * @property {number} taperLoss Residence band withdrawn by the taper (£).
 * @property {number} residenceCapLoss Residence band lost because the home is worth less than the
 *   band (£).
 * @property {number} total `nrb + rnrb` — the estate can pass this much before anything is taxed (£).
 */

/**
 * Work out an estate's two bands.
 *
 * The order is convention 3's, and it changes the answer: no qualifying home means no residence band
 * at all, so nothing else is computed; the taper is then applied to the residence band *including*
 * any transferred share; and only what survives both is capped at the home's own value.
 *
 * The taper is measured on {@link netEstate} — before the spouse exemption — which is why an estate
 * that pays no tax whatsoever can still lose the whole residence band (convention 1).
 *
 * @param {EstateInput} [estate]
 * @param {NilRateBandPair} [bands] Defaults to {@link STATUTORY_NIL_RATE_BANDS} — convention 6.
 * @returns {AvailableBands}
 */
export function estateAllowances(estate = {}, bands = STATUTORY_NIL_RATE_BANDS) {
	const config = normaliseEstate(estate);
	const nrb = transferredBand(bands.nrb, config.transferredNilRateBandPct);
	const rnrbEnhancement = transferredBand(bands.rnrb, config.transferredResidenceNilRateBandPct);

	if (!config.directDescendants || config.residenceValue <= 0) {
		return {
			nrb,
			rnrb: 0,
			rnrbEnhancement,
			rnrbBeforeTaper: 0,
			taperLoss: 0,
			residenceCapLoss: 0,
			total: nrb
		};
	}

	const taperLoss = roundMoney(
		Math.min(
			rnrbEnhancement,
			Math.max(0, netEstate(config) - RNRB_TAPER_THRESHOLD) / RNRB_TAPER_DIVISOR
		)
	);
	const afterTaper = roundMoney(rnrbEnhancement - taperLoss);
	const available = roundMoney(Math.min(afterTaper, config.residenceValue));

	return {
		nrb,
		rnrb: available,
		rnrbEnhancement,
		rnrbBeforeTaper: rnrbEnhancement,
		taperLoss,
		residenceCapLoss: roundMoney(afterTaper - available),
		total: roundMoney(nrb + available)
	};
}

/* -------------------------------------------------------------------------- */
/* The bill                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What one estate owes, and how it got there.
 *
 * @typedef {object} IhtCalculation
 * @property {string} taxYear The tax year the bands came from — {@link IHT_TAX_YEAR} unless the
 *   caller passed its own.
 * @property {NilRateBandPair} bands The statutory bands this death was assessed against, before any
 *   transfer — carried so {@link transferableAllowances} can measure what went unused against the
 *   bands in force *at this death* rather than against whatever they are when the survivor dies.
 * @property {Estate} estate The normalised estate the figures were calculated from.
 * @property {number} grossEstate Everything owned (£).
 * @property {number} liabilities Everything owed (£).
 * @property {number} netEstate `grossEstate - liabilities` (£) — what the taper is measured on.
 * @property {number} spouseExempt Passing to a spouse or civil partner, exempt (£).
 * @property {number} chargeableEstate What tax is charged on, before the bands (£).
 * @property {AvailableBands} allowances The bands this estate got.
 * @property {number} residenceNilRateBandUsed How much of the residence band the estate used (£) —
 *   set against the estate first, per convention 2.
 * @property {number} nilRateBandUsed How much of the nil-rate band the estate used (£).
 * @property {number} unusedAllowance Bands available but not needed (£) — the headroom before this
 *   estate would start paying anything.
 * @property {number} taxableEstate The chargeable estate above the bands (£).
 * @property {number} rate The rate charged on it (%) — {@link IHT_RATE}.
 * @property {number} tax Inheritance Tax due (£).
 * @property {number} netAfterTax The net estate after the bill, spouse's share included (£) — what
 *   there is left to pass on.
 * @property {number} effectiveRate `tax / chargeableEstate` as a percent, `0` on an estate with
 *   nothing chargeable (%). Always at or below {@link IHT_RATE}, because the bands are charged at
 *   nil.
 * @property {boolean} taperApplies Whether the net estate is above {@link RNRB_TAPER_THRESHOLD} —
 *   worth saying out loud, since it is the one threshold that costs an estate an allowance it would
 *   otherwise plainly qualify for.
 */

/**
 * Work out the Inheritance Tax on an estate: the bands, what is left above them, 40%.
 *
 * A negative estate — more owed than owned — is taxable at nothing rather than at a negative amount,
 * and so is an estate that passes entirely to a spouse.
 *
 * @param {EstateInput} [estate]
 * @param {NilRateBandPair} [bands] Defaults to {@link STATUTORY_NIL_RATE_BANDS} — convention 6.
 * @param {string} [taxYear] Label for the bands passed in; defaults to {@link IHT_TAX_YEAR}.
 * @returns {IhtCalculation}
 */
export function inheritanceTax(
	estate = {},
	bands = STATUTORY_NIL_RATE_BANDS,
	taxYear = IHT_TAX_YEAR
) {
	const config = normaliseEstate(estate);
	const allowances = estateAllowances(config, bands);

	const net = netEstate(config);
	const chargeable = roundMoney(Math.max(0, net - config.spouseExempt));

	// Convention 2: the residence band is set against the estate before the nil-rate band. It makes
	// no difference to `taxableEstate`, and all the difference to what `transferableAllowances`
	// reports as left over.
	const residenceNilRateBandUsed = roundMoney(Math.min(allowances.rnrb, chargeable));
	const nilRateBandUsed = roundMoney(
		Math.min(allowances.nrb, Math.max(0, chargeable - residenceNilRateBandUsed))
	);

	const taxableEstate = roundMoney(Math.max(0, chargeable - allowances.total));
	const tax = roundMoney((taxableEstate * IHT_RATE) / 100);

	return {
		taxYear,
		bands: { nrb: bands.nrb, rnrb: bands.rnrb },
		estate: config,
		grossEstate: roundMoney(config.estateValue),
		liabilities: roundMoney(config.liabilities),
		netEstate: net,
		spouseExempt: roundMoney(config.spouseExempt),
		chargeableEstate: chargeable,
		allowances,
		residenceNilRateBandUsed,
		nilRateBandUsed,
		unusedAllowance: roundMoney(
			Math.max(0, allowances.total - residenceNilRateBandUsed - nilRateBandUsed)
		),
		taxableEstate,
		rate: IHT_RATE,
		tax,
		netAfterTax: roundMoney(net - tax),
		effectiveRate: chargeable > 0 ? (tax / chargeable) * 100 : 0,
		taperApplies: net > RNRB_TAPER_THRESHOLD
	};
}

/* -------------------------------------------------------------------------- */
/* The spousal transfer                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What a first death leaves to the survivor's own estate — convention 5.
 *
 * @typedef {object} TransferableAllowances
 * @property {number} nilRateBandPct Percentage of the nil-rate band unused at this death, 0–100.
 * @property {number} residenceNilRateBandPct The same for the residence band, 0–100.
 * @property {number} nilRateBand What that percentage is worth at the bands supplied (£).
 * @property {number} residenceNilRateBand The same for the residence band (£).
 * @property {number} total The two added (£) — how much extra the survivor's estate can pass on.
 */

/**
 * Read the two transferable percentages off a first death.
 *
 * Feed the result back in as {@link Estate.transferredNilRateBandPct} and
 * {@link Estate.transferredResidenceNilRateBandPct} on the survivor's own estate and the pair of
 * functions closes the loop: the classic "£1,000,000 for a couple" is the second half of it, and is
 * a test in `estate.test.js`.
 *
 * Three readings are worth stating, because each could defensibly go the other way:
 *
 * 1. **The unused nil-rate band is measured after the residence band has been set against the
 *    estate** (convention 2), so an estate sheltered by its home preserves more of its £325,000 for
 *    the survivor. Treating the whole chargeable estate as falling on the nil-rate band instead
 *    would transfer less, and would make the residence band worth strictly less than it is.
 * 2. **A residence band tapered away still transfers in full.** The percentage is measured against
 *    the residence *enhancement* — the band plus anything brought forward, before the taper — so a
 *    first estate over £2,000,000 that used no residence band passes on 100% of it, rather than
 *    passing on nothing because the taper had already removed it.
 * 3. **Each percentage is capped at 100%**, whatever the first estate itself was entitled to: the
 *    statutory ceiling is one extra band, not an accumulating one.
 *
 * The percentages are measured against the bands in force at *this* death — the ones
 * {@link IhtCalculation.bands} recorded — and then priced at whatever bands the survivor will face,
 * which is the whole point of transferring a percentage rather than an amount.
 *
 * @param {IhtCalculation} calculation A first death, from {@link inheritanceTax}.
 * @param {NilRateBandPair} [bands] The bands the survivor's own estate will be assessed against;
 *   defaults to {@link STATUTORY_NIL_RATE_BANDS}, which is right while the bands stay frozen.
 * @returns {TransferableAllowances}
 */
export function transferableAllowances(calculation, bands = STATUTORY_NIL_RATE_BANDS) {
	const atFirstDeath = calculation.bands ?? STATUTORY_NIL_RATE_BANDS;
	const nrbBasis = atFirstDeath.nrb > 0 ? atFirstDeath.nrb : NIL_RATE_BAND;
	const rnrbBasis = atFirstDeath.rnrb > 0 ? atFirstDeath.rnrb : RESIDENCE_NIL_RATE_BAND;

	const nilRateBandPct = clamp(
		((nrbBasis - calculation.nilRateBandUsed) / nrbBasis) * 100,
		0,
		MAX_TRANSFERRED_BAND_PCT
	);
	const residenceNilRateBandPct = clamp(
		((calculation.allowances.rnrbEnhancement - calculation.residenceNilRateBandUsed) / rnrbBasis) *
			100,
		0,
		MAX_TRANSFERRED_BAND_PCT
	);

	const nilRateBand = roundMoney((bands.nrb * nilRateBandPct) / 100);
	const residenceNilRateBand = roundMoney((bands.rnrb * residenceNilRateBandPct) / 100);

	return {
		nilRateBandPct,
		residenceNilRateBandPct,
		nilRateBand,
		residenceNilRateBand,
		total: roundMoney(nilRateBand + residenceNilRateBand)
	};
}
