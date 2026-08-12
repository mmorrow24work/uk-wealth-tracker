import { describe, expect, it } from 'vitest';

import {
	BAND_FREEZE_END_TAX_YEAR,
	BAND_INDEXATION_ROUNDING,
	BUDGET_POLICY_MEASURES,
	DEFAULT_BUDGET_POLICY,
	FIRST_MODELLED_TAX_YEAR,
	IHT_RATE,
	MODELLED_TAX_YEARS,
	NIL_RATE_BAND,
	PENSION_IHT_TAX_YEAR,
	RESIDENCE_NIL_RATE_BAND,
	RNRB_TAPER_THRESHOLD,
	availableNilRateBands,
	budgetPolicyImpact,
	budgetPolicyProjection,
	budgetPolicySummary,
	estateIht,
	estateValuation,
	indexedBand,
	nilRateBandsForTaxYear,
	normaliseBudgetPolicy,
	qualifyingResidenceValue,
	taxYearLabel
} from './budget-policy.js';
import {
	createAsset,
	createDebt,
	createInvestment,
	createLifeInsurance,
	createPension,
	createProperty
} from './model.js';

/** Values are money, so compare to the penny rather than to floating-point exactness. */
const PENNY = 0.005;

/**
 * A config with no growth and no uprating anywhere — the one to use when a test is about band
 * arithmetic rather than about compounding, so every year's estate is the same estate.
 *
 * @type {Partial<import('./budget-policy.js').BudgetPolicy>}
 */
const STATIC = { estateGrowthRate: 0, indexationRate: 0 };

/** @param {Partial<import('./types.js').Investment>} [overrides] */
function holding(overrides = {}) {
	return createInvestment({ name: 'Global All Cap', value: 400_000, ...overrides });
}

/** @param {Partial<import('./types.js').Pension>} [overrides] */
function dcPot(overrides = {}) {
	return createPension({ name: 'SIPP', type: 'sipp', value: 300_000, ...overrides });
}

/** @param {Partial<import('./types.js').LifeInsurance>} [overrides] */
function cover(overrides = {}) {
	return createLifeInsurance({
		name: 'Level term',
		provider: 'Zurich',
		sum_assured: 500_000,
		...overrides
	});
}

/** @param {Partial<import('./types.js').Property>} [overrides] */
function home(overrides = {}) {
	return createProperty({
		name: 'Home',
		type: 'primary_residence',
		value: 500_000,
		mortgage_balance: 0,
		...overrides
	});
}

/* -------------------------------------------------------------------------- */
/* Statutory figures                                                           */
/* -------------------------------------------------------------------------- */

describe('statutory figures', () => {
	it('match CLAUDE.md/README.md 2026/27 domain rules exactly', () => {
		expect(NIL_RATE_BAND).toBe(325_000);
		expect(RESIDENCE_NIL_RATE_BAND).toBe(175_000);
		expect(RNRB_TAPER_THRESHOLD).toBe(2_000_000);
		expect(IHT_RATE).toBe(40);
	});
});

describe('BUDGET_POLICY_MEASURES', () => {
	it('names exactly the two measures the issue commissioned', () => {
		expect(BUDGET_POLICY_MEASURES.map((measure) => measure.id)).toEqual([
			'frozen_nil_rate_bands',
			'pensions_in_estate'
		]);
	});

	it('states a Budget, an effective date, figures, a source and a confidence for each', () => {
		for (const measure of BUDGET_POLICY_MEASURES) {
			expect(measure.announcedIn).not.toBe('');
			expect(measure.effectiveFrom).not.toBe('');
			expect(measure.figures).not.toBe('');
			expect(measure.source).toMatch(/gov\.uk/);
			expect(['high', 'medium', 'low']).toContain(measure.confidence);
		}
	});

	it('dates the pension measure to 2027/28 and the freeze to the modelled window', () => {
		const [freeze, pensions] = BUDGET_POLICY_MEASURES;
		expect(pensions.effectiveFrom).toContain('6 April 2027');
		expect(pensions.effectiveFrom).toContain('2027/28');
		expect(freeze.effectiveFrom).toContain(taxYearLabel(BAND_FREEZE_END_TAX_YEAR));
	});

	it('is frozen, so a panel cannot rewrite the provenance it renders', () => {
		expect(Object.isFrozen(BUDGET_POLICY_MEASURES)).toBe(true);
		expect(BUDGET_POLICY_MEASURES.every((measure) => Object.isFrozen(measure))).toBe(true);
	});
});

describe('MODELLED_TAX_YEARS', () => {
	it('runs 2026/27 to the last frozen year inclusive', () => {
		expect(MODELLED_TAX_YEARS[0]).toBe(FIRST_MODELLED_TAX_YEAR);
		expect(MODELLED_TAX_YEARS.at(-1)).toBe(BAND_FREEZE_END_TAX_YEAR);
		expect(MODELLED_TAX_YEARS).toEqual([2026, 2027, 2028, 2029, 2030]);
	});
});

describe('taxYearLabel', () => {
	it('names a tax year by the April it starts in', () => {
		expect(taxYearLabel(2026)).toBe('2026/27');
		expect(taxYearLabel(2030)).toBe('2030/31');
	});

	it('pads the century rollover rather than writing 2099/0', () => {
		expect(taxYearLabel(2099)).toBe('2099/00');
	});
});

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

describe('normaliseBudgetPolicy', () => {
	it('fills an empty config from the defaults', () => {
		expect(normaliseBudgetPolicy()).toEqual(DEFAULT_BUDGET_POLICY);
		expect(normaliseBudgetPolicy({})).toEqual({ ...DEFAULT_BUDGET_POLICY });
	});

	it('keeps both measures on by default — the announced world is the starting state', () => {
		expect(DEFAULT_BUDGET_POLICY.pensionsInEstate).toBe(true);
		expect(DEFAULT_BUDGET_POLICY.bandsFrozen).toBe(true);
		expect(DEFAULT_BUDGET_POLICY.freezeEndTaxYear).toBe(BAND_FREEZE_END_TAX_YEAR);
	});

	it('clamps rather than rejects out-of-range values', () => {
		const config = normaliseBudgetPolicy({
			indexationRate: -5,
			estateGrowthRate: 500,
			transferredBandsPct: 250,
			freezeEndTaxYear: 1990
		});
		expect(config.indexationRate).toBe(0);
		expect(config.estateGrowthRate).toBe(100);
		expect(config.transferredBandsPct).toBe(100);
		expect(config.freezeEndTaxYear).toBe(FIRST_MODELLED_TAX_YEAR);
	});

	it('reads unparseable values as unset rather than as NaN', () => {
		const config = normaliseBudgetPolicy(
			/** @type {Partial<import('./budget-policy.js').BudgetPolicy>} */ (
				/** @type {unknown} */ ({ indexationRate: 'soon', pensionsInEstate: 'yes' })
			)
		);
		expect(config.indexationRate).toBe(DEFAULT_BUDGET_POLICY.indexationRate);
		expect(config.pensionsInEstate).toBe(DEFAULT_BUDGET_POLICY.pensionsInEstate);
	});

	it('allows a negative estate growth rate — an estate can shrink', () => {
		expect(normaliseBudgetPolicy({ estateGrowthRate: -3 }).estateGrowthRate).toBe(-3);
	});
});

/* -------------------------------------------------------------------------- */
/* The bands                                                                   */
/* -------------------------------------------------------------------------- */

describe('indexedBand', () => {
	it('leaves a band alone for zero or negative years', () => {
		expect(indexedBand(NIL_RATE_BAND, 2.5, 0)).toBe(NIL_RATE_BAND);
		expect(indexedBand(NIL_RATE_BAND, 2.5, -1)).toBe(NIL_RATE_BAND);
	});

	it('rounds up to the nearest £1,000, per the statutory uprating rule', () => {
		// 325,000 x 1.025 = 333,125 -> 334,000.
		expect(indexedBand(NIL_RATE_BAND, 2.5, 1)).toBe(334_000);
		expect(indexedBand(NIL_RATE_BAND, 2.5, 1) % BAND_INDEXATION_ROUNDING).toBe(0);
	});

	it('compounds across years rather than adding a flat step', () => {
		// 325,000 x 1.025^4 = 358,747.85... -> 359,000.
		expect(indexedBand(NIL_RATE_BAND, 2.5, 4)).toBe(359_000);
	});

	it('is a no-op at a zero rate, whatever the horizon', () => {
		expect(indexedBand(RESIDENCE_NIL_RATE_BAND, 0, 10)).toBe(RESIDENCE_NIL_RATE_BAND);
	});
});

describe('nilRateBandsForTaxYear', () => {
	it('holds both bands at their cash figures for every frozen year', () => {
		for (const year of MODELLED_TAX_YEARS) {
			const bands = nilRateBandsForTaxYear(year, { indexationRate: 2.5 });
			expect(bands.nrb).toBe(NIL_RATE_BAND);
			expect(bands.rnrb).toBe(RESIDENCE_NIL_RATE_BAND);
			expect(bands.frozen).toBe(true);
			expect(bands.indexedYears).toBe(0);
			expect(bands.taxYear).toBe(taxYearLabel(year));
		}
	});

	it('resumes uprating from the frozen level once the freeze ends, not from what it would have been', () => {
		const after = nilRateBandsForTaxYear(BAND_FREEZE_END_TAX_YEAR + 2, { indexationRate: 2.5 });
		expect(after.frozen).toBe(false);
		expect(after.indexedYears).toBe(2);
		// 325,000 x 1.025^2 = 341,453.125 -> 342,000, not 325,000 x 1.025^6.
		expect(after.nrb).toBe(342_000);
	});

	it('uprates from 2026/27 throughout when the freeze is switched off — the counterfactual', () => {
		const bands = nilRateBandsForTaxYear(2030, { bandsFrozen: false, indexationRate: 2.5 });
		expect(bands.frozen).toBe(false);
		expect(bands.indexedYears).toBe(4);
		expect(bands.nrb).toBe(359_000);
	});

	it('honours a shorter freeze passed through freezeEndTaxYear', () => {
		const bands = nilRateBandsForTaxYear(2030, { indexationRate: 2.5, freezeEndTaxYear: 2029 });
		expect(bands.frozen).toBe(false);
		expect(bands.indexedYears).toBe(1);
		expect(bands.nrb).toBe(334_000);
	});

	it('changes nothing before the disputed final year, whichever end date is used', () => {
		for (const year of [2026, 2027, 2028, 2029]) {
			expect(nilRateBandsForTaxYear(year, { freezeEndTaxYear: 2029 })).toEqual(
				nilRateBandsForTaxYear(year, { freezeEndTaxYear: 2030 })
			);
		}
	});
});

describe('availableNilRateBands', () => {
	const bands = nilRateBandsForTaxYear(2026, STATIC);

	it('gives an ordinary estate both bands in full', () => {
		const available = availableNilRateBands(800_000, bands, STATIC, 500_000);
		expect(available.nrb).toBe(325_000);
		expect(available.rnrb).toBe(175_000);
		expect(available.total).toBe(500_000);
		expect(available.taperLoss).toBe(0);
	});

	it('doubles both bands when a spouse’s allowances are brought forward in full', () => {
		const available = availableNilRateBands(
			800_000,
			bands,
			{ ...STATIC, transferredBandsPct: 100 },
			500_000
		);
		expect(available.nrb).toBe(650_000);
		expect(available.rnrb).toBe(350_000);
		expect(available.total).toBe(1_000_000);
	});

	it('withdraws £1 of RNRB for every £2 of estate over £2m', () => {
		const available = availableNilRateBands(2_100_000, bands, STATIC, 500_000);
		expect(available.taperLoss).toBeCloseTo(50_000, PENNY);
		expect(available.rnrb).toBeCloseTo(125_000, PENNY);
	});

	it('tapers the RNRB away completely, and no further', () => {
		const available = availableNilRateBands(2_400_000, bands, STATIC, 500_000);
		expect(available.rnrb).toBe(0);
		expect(available.taperLoss).toBe(175_000);
		expect(available.total).toBe(325_000);
	});

	it('tapers the transferred RNRB too, so a doubled band takes twice as long to disappear', () => {
		const doubled = { ...STATIC, transferredBandsPct: 100 };
		// £400k over the threshold withdraws £200k. A single £175k band would already be gone; a
		// doubled £350k one still has £150k left.
		expect(availableNilRateBands(2_400_000, bands, STATIC, 500_000).rnrb).toBe(0);
		expect(availableNilRateBands(2_400_000, bands, doubled, 500_000).rnrb).toBeCloseTo(
			150_000,
			PENNY
		);
		expect(availableNilRateBands(2_700_000, bands, doubled, 500_000).rnrb).toBe(0);
	});

	it('caps the RNRB at what the home is actually worth', () => {
		const available = availableNilRateBands(600_000, bands, STATIC, 120_000);
		expect(available.rnrb).toBe(120_000);
		expect(available.residenceCapLoss).toBe(55_000);
	});

	it('gives no residence band at all when no home is recorded', () => {
		const available = availableNilRateBands(600_000, bands, STATIC, null);
		expect(available.rnrb).toBe(0);
		expect(available.total).toBe(325_000);
	});

	it('removes the RNRB entirely when no home passes to direct descendants', () => {
		const available = availableNilRateBands(
			600_000,
			bands,
			{ ...STATIC, directDescendants: false },
			500_000
		);
		expect(available.rnrb).toBe(0);
		expect(available.rnrbBeforeTaper).toBe(0);
		expect(available.total).toBe(325_000);
	});
});

/* -------------------------------------------------------------------------- */
/* The estate                                                                  */
/* -------------------------------------------------------------------------- */

describe('qualifyingResidenceValue', () => {
	it('is the primary residence net of its mortgage', () => {
		expect(qualifyingResidenceValue({ properties: [home({ mortgage_balance: 150_000 })] })).toBe(
			350_000
		);
	});

	it('ignores a buy-to-let and a holiday home, however valuable', () => {
		expect(
			qualifyingResidenceValue({
				properties: [
					createProperty({ type: 'buy_to_let', value: 900_000, mortgage_balance: 0 }),
					createProperty({ type: 'holiday_home', value: 800_000, mortgage_balance: 0 })
				]
			})
		).toBeNull();
	});

	it('takes the most valuable home when more than one is recorded', () => {
		expect(
			qualifyingResidenceValue({
				properties: [home({ value: 300_000 }), home({ value: 500_000 })]
			})
		).toBe(500_000);
	});

	it('reads negative equity as nothing to attach the band to, not a negative allowance', () => {
		expect(qualifyingResidenceValue({ properties: [home({ mortgage_balance: 700_000 })] })).toBe(0);
	});

	it('is null when nothing is recorded — not known, rather than none', () => {
		expect(qualifyingResidenceValue()).toBeNull();
		expect(qualifyingResidenceValue({ properties: [] })).toBeNull();
	});

	it('excludes an offset mortgage’s linked savings — this is the home’s own value, not general cash', () => {
		const withOffset = home({
			mortgage_balance: 150_000,
			mortgage_type: 'offset',
			offset_savings_balance: 65_000
		});
		// Same 350,000 as the plain 'is the primary residence net of its mortgage' case above —
		// the savings pot makes no difference here even though estateValuation() below does add it
		// to the wider estate total.
		expect(qualifyingResidenceValue({ properties: [withOffset] })).toBe(350_000);
	});
});

describe('estateValuation', () => {
	const position = {
		investments: [holding()],
		debts: [createDebt({ balance: 20_000 })],
		properties: [home({ mortgage_balance: 100_000 })],
		assets: [createAsset({ current_value: 30_000 })],
		pensions: [dcPot()]
	};

	it('adds up what counts towards net worth, and leaves the pension pot outside it in 2026/27', () => {
		const valuation = estateValuation(position, 2026, STATIC);
		expect(valuation.investments).toBe(400_000);
		expect(valuation.investmentsByWrapper).toEqual([
			{ wrapper: 'gia', label: 'General Investment Account', amount: 400_000 }
		]);
		expect(valuation.propertyEquity).toBe(400_000);
		expect(valuation.physicalAssets).toBe(30_000);
		expect(valuation.debts).toBe(20_000);
		expect(valuation.debtsByType).toEqual([{ type: 'other', label: 'Other', amount: 20_000 }]);
		expect(valuation.pensionPots).toBe(300_000);
		expect(valuation.pensionsCounted).toBe(false);
		expect(valuation.withoutPensions).toBe(810_000);
		expect(valuation.total).toBe(810_000);
	});

	it('breaks investments down by wrapper, in WRAPPERS order, combining same-wrapper holdings', () => {
		const mixedWrappers = {
			investments: [
				holding({ wrapper: 'gia', value: 100_000 }),
				holding({ wrapper: 'isa_stocks_shares', value: 50_000 }),
				holding({ wrapper: 'sipp', value: 200_000 }),
				holding({ wrapper: 'isa_stocks_shares', value: 25_000 })
			]
		};
		const valuation = estateValuation(mixedWrappers, 2026, STATIC);

		expect(valuation.investmentsByWrapper).toEqual([
			{ wrapper: 'isa_stocks_shares', label: 'Stocks & Shares ISA', amount: 75_000 },
			{ wrapper: 'sipp', label: 'SIPP', amount: 200_000 },
			{ wrapper: 'gia', label: 'General Investment Account', amount: 100_000 }
		]);
		expect(valuation.investments).toBe(375_000);
	});

	it('leaves an excluded holding’s wrapper out of the breakdown, without dropping other wrappers', () => {
		const excludedWrapper = {
			investments: [
				holding({ wrapper: 'gia', value: 400_000, exclude_from_net_worth: true }),
				holding({ wrapper: 'sipp', value: 50_000 })
			]
		};
		const valuation = estateValuation(excludedWrapper, 2026, STATIC);

		expect(valuation.investmentsByWrapper).toEqual([
			{ wrapper: 'sipp', label: 'SIPP', amount: 50_000 }
		]);
		expect(valuation.investments).toBe(50_000);
	});

	it('breaks debts down by type, in DEBT_TYPES order, combining same-type debts', () => {
		const mixedDebts = {
			debts: [
				createDebt({ type: 'credit_card', balance: 2_000 }),
				createDebt({ type: 'mortgage', balance: 150_000 }),
				createDebt({ type: 'credit_card', balance: 1_000 })
			]
		};
		const valuation = estateValuation(mixedDebts, 2026, STATIC);

		expect(valuation.debtsByType).toEqual([
			{ type: 'mortgage', label: 'Mortgage', amount: 150_000 },
			{ type: 'credit_card', label: 'Credit card', amount: 3_000 }
		]);
		expect(valuation.debts).toBe(153_000);
	});

	it('leaves an excluded debt’s type out of the breakdown, without dropping other types', () => {
		const excludedDebt = {
			debts: [
				createDebt({ type: 'mortgage', balance: 200_000, exclude_from_net_worth: true }),
				createDebt({ type: 'car_finance', balance: 8_000 })
			]
		};
		const valuation = estateValuation(excludedDebt, 2026, STATIC);

		expect(valuation.debtsByType).toEqual([
			{ type: 'car_finance', label: 'Car finance', amount: 8_000 }
		]);
		expect(valuation.debts).toBe(8_000);
	});

	it('adds a counted offset mortgage’s linked savings to the estate, on top of property equity', () => {
		const withOffset = {
			...position,
			properties: [
				home({ mortgage_balance: 100_000, mortgage_type: 'offset', offset_savings_balance: 65_000 })
			]
		};
		const valuation = estateValuation(withOffset, 2026, STATIC);

		expect(valuation.propertyEquity).toBe(400_000); // unchanged — value minus mortgage only.
		expect(valuation.offsetSavings).toBe(65_000);
		expect(valuation.total).toBe(875_000); // 810,000 (base case) + 65,000 offset savings.
	});

	it('leaves offset savings out when the property itself is excluded from net worth', () => {
		const excluded = {
			...position,
			properties: [
				home({
					mortgage_balance: 100_000,
					mortgage_type: 'offset',
					offset_savings_balance: 65_000,
					include_in_net_worth: false
				})
			]
		};
		const valuation = estateValuation(excluded, 2026, STATIC);

		expect(valuation.propertyEquity).toBe(0);
		expect(valuation.offsetSavings).toBe(0);
	});

	it('counts a policy not written in trust at its full sum assured', () => {
		const notInTrust = { ...position, lifeInsurance: [cover({ in_trust: false })] };
		const valuation = estateValuation(notInTrust, 2026, STATIC);

		expect(valuation.lifeInsurance).toBe(500_000);
		expect(valuation.lifeInsuranceInTrust).toBe(0);
		expect(valuation.withoutPensions).toBe(1_310_000); // 810,000 (base case) + 500,000 of cover.
		expect(valuation.total).toBe(1_310_000);
	});

	it('counts a policy written in trust at nothing, however large the cover', () => {
		const inTrust = { ...position, lifeInsurance: [cover({ in_trust: true })] };
		const valuation = estateValuation(inTrust, 2026, STATIC);

		// It pays the beneficiaries directly and never becomes part of the estate — reported, so the
		// exclusion can be shown, but added to nothing.
		expect(valuation.lifeInsurance).toBe(0);
		expect(valuation.lifeInsuranceInTrust).toBe(500_000);
		expect(valuation.withoutPensions).toBe(810_000); // The base case, unchanged.
		expect(valuation.total).toBe(810_000);
	});

	it('excludes only the in-trust policies from a mixed list', () => {
		const mixed = {
			...position,
			lifeInsurance: [
				cover({ name: 'Level term', sum_assured: 250_000, in_trust: false }),
				cover({ name: 'Death in service', sum_assured: 500_000, in_trust: true }),
				cover({ name: 'Decreasing term', sum_assured: 120_000, in_trust: false })
			]
		};
		const valuation = estateValuation(mixed, 2026, STATIC);

		expect(valuation.lifeInsurance).toBe(370_000);
		expect(valuation.lifeInsuranceInTrust).toBe(500_000);
		expect(valuation.total).toBe(1_180_000); // 810,000 (base case) + 370,000 counted cover.
	});

	it('treats a missing or malformed in_trust flag as not in trust — the higher estate figure', () => {
		const malformed = {
			lifeInsurance: [
				{ sum_assured: 100_000 },
				/** @type {Partial<import('./types.js').LifeInsurance>} */ (
					/** @type {unknown} */ ({ sum_assured: 50_000, in_trust: 'yes' })
				),
				/** @type {Partial<import('./types.js').LifeInsurance>} */ (
					/** @type {unknown} */ ({ sum_assured: 25_000, in_trust: null })
				)
			]
		};
		const valuation = estateValuation(malformed, 2026, STATIC);

		// Only a literal `true` takes cover out of the estate — the same reading model.js's own
		// asBoolean(source.in_trust, false) takes on load. Overstating an estate is the safer error.
		expect(valuation.lifeInsurance).toBe(175_000);
		expect(valuation.lifeInsuranceInTrust).toBe(0);
		expect(valuation.total).toBe(175_000);
	});

	it('ignores a policy’s surrender value — the estate is credited with what it pays out', () => {
		const surrender = {
			lifeInsurance: [cover({ sum_assured: 300_000, current_value: 12_000, in_trust: false })]
		};
		expect(estateValuation(surrender, 2026, STATIC).lifeInsurance).toBe(300_000);
	});

	it('grows both halves of the cover at the same rate as every other asset-side component', () => {
		const withCover = {
			...position,
			lifeInsurance: [
				cover({ sum_assured: 200_000, in_trust: false }),
				cover({ sum_assured: 300_000, in_trust: true })
			]
		};
		const grown = estateValuation(withCover, 2029, { indexationRate: 0, estateGrowthRate: 5 });

		expect(grown.growthYears).toBe(3);
		expect(grown.lifeInsurance).toBeCloseTo(200_000 * 1.05 ** 3, PENNY);
		expect(grown.lifeInsuranceInTrust).toBeCloseTo(300_000 * 1.05 ** 3, PENNY);
		// 2029/30 is past 6 April 2027, so the pot is inside `total` too — the counted cover is inside
		// `withoutPensions`, which is the half this issue adds to.
		expect(grown.total).toBeCloseTo(grown.withoutPensions + grown.pensionPots, PENNY);
		expect(grown.withoutPensions).toBeCloseTo(
			grown.investments +
				grown.propertyEquity +
				grown.physicalAssets +
				grown.lifeInsurance -
				grown.debts,
			PENNY
		);
	});

	it('leaves the residence nil-rate band’s own figure alone — cover is not part of the home', () => {
		const withCover = { ...position, lifeInsurance: [cover({ in_trust: false })] };
		const valuation = estateValuation(withCover, 2026, STATIC);

		// The wider estate grew by the sum assured; the home's own net value did not.
		expect(valuation.residence).toBe(400_000);
		expect(valuation.total).toBe(1_310_000);
	});

	it('is £0 of cover on both halves when no policy is recorded', () => {
		const valuation = estateValuation(position, 2026, STATIC);

		expect(valuation.lifeInsurance).toBe(0);
		expect(valuation.lifeInsuranceInTrust).toBe(0);
		expect(estateValuation().lifeInsurance).toBe(0);
		expect(estateValuation().lifeInsuranceInTrust).toBe(0);
	});

	it('brings the pension pot in from 2027/28, the tax year 6 April 2027 starts', () => {
		expect(estateValuation(position, PENSION_IHT_TAX_YEAR - 1, STATIC).pensionsCounted).toBe(false);
		const counted = estateValuation(position, PENSION_IHT_TAX_YEAR, STATIC);
		expect(counted.pensionsCounted).toBe(true);
		expect(counted.total).toBe(1_110_000);
	});

	it('leaves the pot out of every year when the measure is switched off', () => {
		for (const year of MODELLED_TAX_YEARS) {
			const valuation = estateValuation(position, year, { ...STATIC, pensionsInEstate: false });
			expect(valuation.pensionsCounted).toBe(false);
			expect(valuation.total).toBe(valuation.withoutPensions);
		}
	});

	it('counts only Defined Contribution funds as unused pension funds', () => {
		const mixed = {
			pensions: [
				dcPot({ value: 200_000 }),
				createPension({ type: 'dc_workplace', value: 100_000 }),
				createPension({ type: 'db_final_salary', value: 0, db_annual_income: 20_000 }),
				createPension({ type: 'state', value: 0, ni_qualifying_years: 35 })
			]
		};
		expect(estateValuation(mixed, 2027, STATIC).pensionPots).toBe(300_000);
	});

	it('treats a Lifetime ISA as an ISA — in the estate both sides of the change', () => {
		const lisa = { pensions: [createPension({ type: 'lisa', value: 40_000 })] };
		const before = estateValuation(lisa, 2026, STATIC);
		const after = estateValuation(lisa, 2027, STATIC);
		expect(before.lifetimeIsaPots).toBe(40_000);
		expect(before.total).toBe(40_000);
		expect(after.pensionPots).toBe(0);
		expect(after.total).toBe(40_000);
	});

	it('honours the net worth exclusion flags, so nothing is counted twice', () => {
		const excluded = {
			investments: [holding({ exclude_from_net_worth: true })],
			debts: [createDebt({ balance: 200_000, exclude_from_net_worth: true })],
			properties: [home({ include_in_net_worth: false })],
			assets: [createAsset({ current_value: 30_000, include_in_net_worth: false })]
		};
		const excludedValuation = estateValuation(excluded, 2026, STATIC);
		expect(excludedValuation.total).toBe(0);
		expect(excludedValuation.investmentsByWrapper).toEqual([]);
		expect(excludedValuation.debtsByType).toEqual([]);
	});

	it('grows the asset side at one nominal rate and holds debts flat', () => {
		const grown = estateValuation(position, 2029, { indexationRate: 0, estateGrowthRate: 5 });
		expect(grown.growthYears).toBe(3);
		expect(grown.investments).toBeCloseTo(400_000 * 1.05 ** 3, PENNY);
		expect(grown.investmentsByWrapper).toEqual([
			{ wrapper: 'gia', label: 'General Investment Account', amount: grown.investments }
		]);
		expect(grown.debts).toBe(20_000);
		expect(grown.debtsByType).toEqual([{ type: 'other', label: 'Other', amount: 20_000 }]);
		expect(grown.residence).toBeCloseTo(400_000 * 1.05 ** 3, PENNY);
	});

	it('is an empty estate, not an error, when nothing is recorded', () => {
		const empty = estateValuation();
		expect(empty.total).toBe(0);
		expect(empty.residence).toBeNull();
		expect(empty.investmentsByWrapper).toEqual([]);
		expect(empty.debtsByType).toEqual([]);
		expect(empty.taxYear).toBe('2026/27');
	});
});

/* -------------------------------------------------------------------------- */
/* The bill                                                                    */
/* -------------------------------------------------------------------------- */

describe('estateIht', () => {
	it('gives an estate with no home only the nil-rate band', () => {
		const liability = estateIht({ investments: [holding({ value: 400_000 })] }, 2026, STATIC);
		expect(liability.allowance).toBe(325_000);
		expect(liability.taxable).toBe(75_000);
		expect(liability.tax).toBe(30_000);
	});

	it('charges 40% on the excess — a worked example with both bands', () => {
		// £900,000 estate, £500,000 of home. Bands 325,000 + 175,000 = 500,000.
		// Taxable 400,000, tax 160,000.
		const liability = estateIht(
			{ investments: [holding({ value: 400_000 })], properties: [home()] },
			2026,
			STATIC
		);
		expect(liability.estate).toBe(900_000);
		expect(liability.allowance).toBe(500_000);
		expect(liability.taxable).toBe(400_000);
		expect(liability.tax).toBe(160_000);
		expect(liability.effectiveRate).toBeCloseTo((160_000 / 900_000) * 100, PENNY);
	});

	it('charges the same cover £200,000 or nothing, on the in-trust flag alone', () => {
		// The same £900,000 estate as above, plus £500,000 of cover — the whole difference between the
		// two bills is which side of the trust the policy was written on.
		const base = { investments: [holding({ value: 400_000 })], properties: [home()] };
		const chargeable = estateIht(
			{ ...base, lifeInsurance: [cover({ in_trust: false })] },
			2026,
			STATIC
		);
		const inTrust = estateIht(
			{ ...base, lifeInsurance: [cover({ in_trust: true })] },
			2026,
			STATIC
		);

		expect(chargeable.estate).toBe(1_400_000);
		expect(chargeable.tax).toBe(360_000); // 160,000 on the base estate + 40% of 500,000.
		expect(inTrust.estate).toBe(900_000);
		expect(inTrust.tax).toBe(160_000); // The base estate's own bill, unchanged.
	});

	it('charges nothing on an estate under the bands, and never a negative amount', () => {
		const liability = estateIht({ investments: [holding({ value: 100_000 })] }, 2026, STATIC);
		expect(liability.taxable).toBe(0);
		expect(liability.tax).toBe(0);
		expect(liability.effectiveRate).toBeCloseTo((0 / 100_000) * 100, PENNY);
	});

	it('reports an insolvent estate as zero rather than a negative bill', () => {
		const liability = estateIht(
			{ investments: [holding({ value: 10_000 })], debts: [createDebt({ balance: 50_000 })] },
			2026,
			STATIC
		);
		expect(liability.estate).toBe(0);
		expect(liability.tax).toBe(0);
		expect(liability.effectiveRate).toBe(0);
	});

	it('assesses the taper on the estate *including* the pension pot once the measure bites', () => {
		// £1.8m of other assets plus a £400k pot: under 2026/27 rules the taper never starts.
		const position = {
			investments: [holding({ value: 1_300_000 })],
			properties: [home()],
			pensions: [dcPot({ value: 400_000 })]
		};
		const before = estateIht(position, 2026, STATIC);
		const after = estateIht(position, 2027, STATIC);

		expect(before.available.taperLoss).toBe(0);
		expect(after.valuation.total).toBe(2_200_000);
		expect(after.available.taperLoss).toBe(100_000);
		expect(after.available.rnrb).toBe(75_000);
	});
});

/* -------------------------------------------------------------------------- */
/* The overlay                                                                 */
/* -------------------------------------------------------------------------- */

describe('budgetPolicyImpact', () => {
	const position = {
		investments: [holding({ value: 400_000 })],
		properties: [home()],
		pensions: [dcPot({ value: 300_000 })]
	};

	it('splits the extra tax between the two measures, and the parts add to the whole', () => {
		for (const year of MODELLED_TAX_YEARS) {
			const impact = budgetPolicyImpact(position, year);
			expect(impact.fromFrozenBands + impact.fromPensionsInEstate).toBeCloseTo(
				impact.extraTax,
				PENNY
			);
		}
	});

	it('charges nothing extra for the pension measure before 2027/28', () => {
		const impact = budgetPolicyImpact(position, 2026);
		expect(impact.fromPensionsInEstate).toBe(0);
		expect(impact.withChanges.valuation.pensionsCounted).toBe(false);
	});

	it('charges 40% of the pot once it enters the estate, on an estate already over its bands', () => {
		// £900k of other assets is already past the £500k of bands, and well under £2m, so the whole
		// £300k pot is taxed at the margin: £120,000.
		const impact = budgetPolicyImpact(position, 2027, STATIC);
		expect(impact.fromPensionsInEstate).toBeCloseTo(120_000, PENNY);
	});

	it('charges nothing extra at all in 2026/27 with no uprating to lose', () => {
		const impact = budgetPolicyImpact(position, 2026, STATIC);
		expect(impact.extraTax).toBe(0);
		expect(impact.fromFrozenBands).toBe(0);
		expect(impact.bandErosion).toBe(0);
	});

	it('prices the freeze as 40% of the uprating the bands did not get', () => {
		const impact = budgetPolicyImpact(position, 2027, {
			indexationRate: 2.5,
			estateGrowthRate: 0,
			pensionsInEstate: false
		});
		// One year's uprating, each band rounded up to the nearest £1,000: 325,000 -> 334,000 and
		// 175,000 -> 180,000, so 514,000 of bands rather than 500,000.
		expect(impact.bandErosion).toBe(14_000);
		expect(impact.fromFrozenBands).toBeCloseTo(14_000 * 0.4, PENNY);
		expect(impact.fromPensionsInEstate).toBe(0);
	});

	it('reports no impact at all when both measures are switched off', () => {
		const impact = budgetPolicyImpact(position, 2030, {
			pensionsInEstate: false,
			bandsFrozen: false
		});
		expect(impact.extraTax).toBe(0);
		expect(impact.fromFrozenBands).toBe(0);
		expect(impact.fromPensionsInEstate).toBe(0);
		expect(impact.withChanges.tax).toBeCloseTo(impact.withoutChanges.tax, PENNY);
	});

	it('leaves an estate inside its bands untouched by either measure', () => {
		const small = {
			investments: [holding({ value: 100_000 })],
			pensions: [dcPot({ value: 50_000 })]
		};
		const impact = budgetPolicyImpact(small, 2030);
		expect(impact.extraTax).toBe(0);
		expect(impact.extraTaxShare).toBeNull();
	});

	it('reports the increase as a share of the counterfactual bill when there was one', () => {
		const impact = budgetPolicyImpact(position, 2027, STATIC);
		expect(impact.withoutChanges.tax).toBeGreaterThan(0);
		expect(impact.extraTaxShare).toBeCloseTo(impact.extraTax / impact.withoutChanges.tax, 1e-9);
	});

	it('makes the pension measure cost more than 40% of the pot when it drags the estate through the taper', () => {
		const taperable = {
			investments: [holding({ value: 1_300_000 })],
			properties: [home()],
			pensions: [dcPot({ value: 400_000 })]
		};
		const impact = budgetPolicyImpact(taperable, 2027, STATIC);
		// 40% of the pot is £160,000; the £100,000 of RNRB the taper withdraws costs another £40,000.
		expect(impact.fromPensionsInEstate).toBeCloseTo(200_000, PENNY);
	});

	it('is order-stable: the freeze-then-pensions split is what the intermediate step reports', () => {
		const impact = budgetPolicyImpact(position, 2029);
		expect(impact.freezeOnly.valuation.pensionsCounted).toBe(false);
		expect(impact.freezeOnly.bands.frozen).toBe(true);
		expect(impact.withoutChanges.bands.frozen).toBe(false);
		expect(impact.withChanges.valuation.pensionsCounted).toBe(true);
	});
});

describe('budgetPolicyProjection', () => {
	const position = {
		investments: [holding({ value: 400_000 })],
		properties: [home()],
		pensions: [dcPot({ value: 300_000 })]
	};

	it('reports one row per modelled tax year, in order', () => {
		const rows = budgetPolicyProjection(position);
		expect(rows).toHaveLength(MODELLED_TAX_YEARS.length);
		expect(rows.map((row) => row.taxYear)).toEqual(MODELLED_TAX_YEARS.map(taxYearLabel));
	});

	it('grows the cost of the changes across the window as the estate grows into frozen bands', () => {
		const rows = budgetPolicyProjection(position);
		const extras = rows.map((row) => row.extraTax);
		expect(extras[0]).toBe(0);
		for (let index = 2; index < extras.length; index += 1) {
			expect(extras[index]).toBeGreaterThan(extras[index - 1]);
		}
	});

	it('accepts an explicit year list for a shorter or longer window', () => {
		expect(budgetPolicyProjection(position, {}, [2027, 2028]).map((row) => row.startYear)).toEqual([
			2027, 2028
		]);
	});
});

describe('budgetPolicySummary', () => {
	const position = {
		investments: [holding({ value: 400_000 })],
		properties: [home()],
		pensions: [dcPot({ value: 300_000 })]
	};

	it('reads the window down to the figures a headline needs', () => {
		const summary = budgetPolicySummary(budgetPolicyProjection(position));
		expect(summary.firstTaxYear).toBe('2026/27');
		expect(summary.lastTaxYear).toBe('2030/31');
		expect(summary.firstTaxedTaxYear).toBe('2027/28');
		expect(summary.pensionsBite).toBe(true);
		expect(summary.freezeBites).toBe(true);
		expect(summary.peakExtraTax).toBeCloseTo(summary.last?.extraTax ?? 0, PENNY);
	});

	it('says so honestly when neither measure touches the estate', () => {
		const summary = budgetPolicySummary(
			budgetPolicyProjection({ investments: [holding({ value: 50_000 })] })
		);
		expect(summary.firstTaxedTaxYear).toBeNull();
		expect(summary.peakExtraTax).toBe(0);
		expect(summary.pensionsBite).toBe(false);
		expect(summary.freezeBites).toBe(false);
	});

	it('is an empty reading, not a crash, on an empty projection', () => {
		const summary = budgetPolicySummary([]);
		expect(summary.last).toBeNull();
		expect(summary.firstTaxYear).toBe('');
		expect(summary.peakExtraTax).toBe(0);
	});
});
