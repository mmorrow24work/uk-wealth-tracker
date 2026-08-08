import { describe, expect, it } from 'vitest';

import { FORECAST_SCENARIOS, forecastScenarios } from './forecast.js';
import {
	DEFAULT_MORTGAGE_RATE_RISE,
	annuityPayment,
	compareMortgageRateRise,
	findRateRiseProperty,
	mortgageRateRiseAdjustment,
	mortgageRateRiseForecast,
	mortgageRateRiseImpact,
	mortgageRateRiseImpacts,
	mortgageRateRiseTerms,
	normaliseMortgageRateRise,
	projectMortgageBalance,
	remainingMortgageTermMonths
} from './mortgage-rate-rise.js';
import { createInvestment, createProperty } from './model.js';
import { propertyEquityProjection } from './property.js';

/** Values are money, so compare to the penny rather than to floating-point exactness. */
const PENNY = 0.005;

const JAN_2026 = { month: 1, year: 2026 };

/** @param {Partial<import('./types.js').Investment>} [overrides] */
function holding(overrides = {}) {
	return createInvestment({ id: 'inv_a', name: 'Global All Cap', value: 10_000, ...overrides });
}

/**
 * One position, projected twice off the same anchor — exactly how the panel builds its two lines.
 *
 * @param {Partial<import('./mortgage-rate-rise.js').MortgageRateRise>} rateRise
 * @param {readonly import('./types.js').Property[]} properties
 * @param {object} [input]
 * @param {import('./forecast.js').ForecastOptions} [options]
 */
function project(rateRise, properties, input = {}, options = {}) {
	const position = {
		investments: [holding({ monthly_contribution: 1_000, fund_fee: 0 })],
		start: JAN_2026,
		months: 60,
		...input
	};
	return {
		baseline: forecastScenarios(position, options),
		risen: mortgageRateRiseForecast(position, options, rateRise, properties)
	};
}

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

describe('DEFAULT_MORTGAGE_RATE_RISE', () => {
	it('carries the four dials, and nothing else', () => {
		expect(Object.keys(DEFAULT_MORTGAGE_RATE_RISE).sort()).toEqual([
			'atMonth',
			'keepTerm',
			'newRatePct',
			'propertyId'
		]);
	});

	it('has no property chosen by default', () => {
		expect(DEFAULT_MORTGAGE_RATE_RISE.propertyId).toBe('');
	});

	it('is already normalised', () => {
		expect(normaliseMortgageRateRise(DEFAULT_MORTGAGE_RATE_RISE)).toEqual({
			...DEFAULT_MORTGAGE_RATE_RISE
		});
	});
});

describe('normaliseMortgageRateRise', () => {
	it('fills an empty config with the defaults', () => {
		expect(normaliseMortgageRateRise()).toEqual({ ...DEFAULT_MORTGAGE_RATE_RISE });
	});

	it('keeps a fully specified config', () => {
		const rateRise = { propertyId: 'prop_1', newRatePct: 7, atMonth: 24, keepTerm: false };
		expect(normaliseMortgageRateRise(rateRise)).toEqual(rateRise);
	});

	it('clamps the new rate to 0…100, matching Property.interest_rate', () => {
		expect(normaliseMortgageRateRise({ newRatePct: -5 }).newRatePct).toBe(0);
		expect(normaliseMortgageRateRise({ newRatePct: 250 }).newRatePct).toBe(100);
	});

	it('never dates the change at the anchor itself, which every scenario shares', () => {
		expect(normaliseMortgageRateRise({ atMonth: 0 }).atMonth).toBe(1);
		expect(normaliseMortgageRateRise({ atMonth: -5 }).atMonth).toBe(1);
	});

	it('truncates fractional months', () => {
		expect(normaliseMortgageRateRise({ atMonth: 6.9 }).atMonth).toBe(6);
	});

	it('coerces a non-boolean keepTerm to the default rather than throwing', () => {
		expect(
			normaliseMortgageRateRise(
				/** @type {Partial<import('./mortgage-rate-rise.js').MortgageRateRise>} */ (
					/** @type {unknown} */ ({ keepTerm: 'yes' })
				)
			).keepTerm
		).toBe(DEFAULT_MORTGAGE_RATE_RISE.keepTerm);
	});

	it('falls back to a non-numeric propertyId being read as unset', () => {
		expect(
			normaliseMortgageRateRise(
				/** @type {Partial<import('./mortgage-rate-rise.js').MortgageRateRise>} */ (
					/** @type {unknown} */ ({ propertyId: 42 })
				)
			).propertyId
		).toBe('');
	});
});

describe('findRateRiseProperty', () => {
	const properties = [createProperty({ id: 'prop_1' }), createProperty({ id: 'prop_2' })];

	it('finds the property by id', () => {
		expect(findRateRiseProperty(properties, 'prop_2')?.id).toBe('prop_2');
	});

	it('returns null for an unknown id', () => {
		expect(findRateRiseProperty(properties, 'prop_missing')).toBeNull();
	});

	it('returns null for an empty id without searching', () => {
		expect(findRateRiseProperty(properties, '')).toBeNull();
	});

	it('is tolerant of a missing properties list', () => {
		expect(findRateRiseProperty(undefined, 'prop_1')).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* Mortgage arithmetic                                                        */
/* -------------------------------------------------------------------------- */

describe('remainingMortgageTermMonths', () => {
	it('is 0 for a mortgage that is already clear', () => {
		expect(remainingMortgageTermMonths({ mortgage_balance: 0 })).toBe(0);
		expect(remainingMortgageTermMonths({ mortgage_balance: -100 })).toBe(0);
	});

	it('is null when there is no payment on record', () => {
		expect(
			remainingMortgageTermMonths({
				mortgage_balance: 100_000,
				monthly_payment: 0,
				interest_rate: 4
			})
		).toBeNull();
	});

	it('at a 0% rate, is balance / payment, rounded up', () => {
		expect(
			remainingMortgageTermMonths({
				mortgage_balance: 12_000,
				interest_rate: 0,
				monthly_payment: 1_000
			})
		).toBe(12);
		expect(
			remainingMortgageTermMonths({
				mortgage_balance: 12_500,
				interest_rate: 0,
				monthly_payment: 1_000
			})
		).toBe(13);
	});

	it('is null when the payment does not exceed the interest it accrues — an interest-only mortgage', () => {
		// This codebase's MortgageType has no 'interest_only' value (module doc, convention 2) — what
		// makes a mortgage interest-only here is structural: the payment exactly covers the interest
		// and nothing more, whatever `mortgage_type` says.
		const monthlyRate = 0.05 / 12;
		const balance = 200_000;
		const interestOnlyPayment = balance * monthlyRate;
		expect(
			remainingMortgageTermMonths({
				mortgage_balance: balance,
				interest_rate: 5,
				monthly_payment: interestOnlyPayment
			})
		).toBeNull();
	});

	it('is null when the payment does not even cover the interest — underwater', () => {
		expect(
			remainingMortgageTermMonths({
				mortgage_balance: 200_000,
				interest_rate: 10,
				monthly_payment: 100
			})
		).toBeNull();
	});

	it('clears within the returned term, and not within one month fewer', () => {
		const property = { mortgage_balance: 200_000, interest_rate: 4, monthly_payment: 1_500 };
		const term = remainingMortgageTermMonths(property);
		expect(term).not.toBeNull();
		expect(projectMortgageBalance(property, /** @type {number} */ (term))).toBe(0);
		expect(projectMortgageBalance(property, /** @type {number} */ (term) - 1)).toBeGreaterThan(0);
	});
});

describe('annuityPayment', () => {
	it('is 0 for a cleared balance or an undefined term', () => {
		expect(annuityPayment(0, 0.005, 120)).toBe(0);
		expect(annuityPayment(100_000, 0.005, null)).toBe(0);
		expect(annuityPayment(100_000, 0.005, 0)).toBe(0);
	});

	it('at a 0% rate, is balance / term', () => {
		expect(annuityPayment(12_000, 0, 12)).toBe(1_000);
	});

	it('inverts remainingMortgageTermMonths — paying the solved-for payment clears in the solved-for term', () => {
		const property = { mortgage_balance: 150_000, interest_rate: 5.5, monthly_payment: 1_200 };
		const term = remainingMortgageTermMonths(property);
		const payment = annuityPayment(150_000, 5.5 / 100 / 12, /** @type {number} */ (term));

		// A payment resolved from the term should itself clear the balance in (about) that many months —
		// within a few months either side of rounding the term up to a whole number in the first place.
		const balanceAtTerm = projectMortgageBalance(
			{ mortgage_balance: 150_000, interest_rate: 5.5, monthly_payment: payment },
			/** @type {number} */ (term)
		);
		expect(balanceAtTerm).toBeCloseTo(0, 0);
	});
});

describe('projectMortgageBalance', () => {
	it('matches propertyEquityProjection’s own amortisation, sampled at the same month', () => {
		const property = createProperty({
			value: 300_000,
			mortgage_balance: 200_000,
			interest_rate: 4,
			monthly_payment: 1_500,
			growth_rate: 0
		});
		const projection = propertyEquityProjection(property, 10);
		expect(projectMortgageBalance(property, 120)).toBeCloseTo(projection[10].mortgageBalance, 0);
	});

	it('returns today’s balance unchanged for 0 months', () => {
		const property = createProperty({ mortgage_balance: 200_000, monthly_payment: 1_500 });
		expect(projectMortgageBalance(property, 0)).toBe(200_000);
	});

	it('carries the balance forward unchanged with no monthly payment on record', () => {
		const property = createProperty({ mortgage_balance: 200_000, monthly_payment: 0 });
		expect(projectMortgageBalance(property, 60)).toBe(200_000);
	});

	it('floors at zero rather than going negative', () => {
		const property = createProperty({
			mortgage_balance: 5_000,
			interest_rate: 2,
			monthly_payment: 2_000
		});
		expect(projectMortgageBalance(property, 12)).toBe(0);
	});

	it('is tolerant of a missing property', () => {
		expect(projectMortgageBalance(null, 12)).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* mortgageRateRiseTerms                                                      */
/* -------------------------------------------------------------------------- */

describe('mortgageRateRiseTerms', () => {
	it('is the empty answer for no property', () => {
		const terms = mortgageRateRiseTerms(null, normaliseMortgageRateRise());
		expect(terms).toEqual({
			hasMortgage: false,
			balanceAtRateRise: 0,
			oldPayment: 0,
			newPayment: 0,
			delta: 0,
			oldRemainingTermMonths: 0,
			newRemainingTermMonths: 0,
			extraInterestOverRemainingTerm: 0
		});
	});

	it('is the empty answer for a property with no mortgage', () => {
		const property = createProperty({ mortgage_balance: 0 });
		expect(mortgageRateRiseTerms(property, normaliseMortgageRateRise()).hasMortgage).toBe(false);
	});

	it('raises the payment and keeps the term, when keepTerm is true', () => {
		const property = createProperty({
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const config = normaliseMortgageRateRise({
			propertyId: property.id,
			newRatePct: 6,
			atMonth: 1,
			keepTerm: true
		});
		const terms = mortgageRateRiseTerms(property, config);

		expect(terms.hasMortgage).toBe(true);
		expect(terms.balanceAtRateRise).toBe(120_000);
		expect(terms.oldRemainingTermMonths).toBe(120);
		expect(terms.newRemainingTermMonths).toBe(120);
		expect(terms.newPayment).toBeGreaterThan(terms.oldPayment);
		expect(terms.delta).toBeCloseTo(terms.newPayment - terms.oldPayment, 6);
		expect(terms.extraInterestOverRemainingTerm).toBeGreaterThan(0);
	});

	it('keeps the payment and extends the term, when keepTerm is false', () => {
		const property = createProperty({
			mortgage_balance: 120_000,
			interest_rate: 3,
			monthly_payment: 1_160
		});
		const config = normaliseMortgageRateRise({
			propertyId: property.id,
			newRatePct: 6,
			atMonth: 1,
			keepTerm: false
		});
		const terms = mortgageRateRiseTerms(property, config);

		expect(terms.newPayment).toBe(terms.oldPayment);
		expect(terms.delta).toBe(0);
		expect(terms.newRemainingTermMonths).not.toBeNull();
		expect(/** @type {number} */ (terms.newRemainingTermMonths)).toBeGreaterThan(
			/** @type {number} */ (terms.oldRemainingTermMonths)
		);
		expect(terms.extraInterestOverRemainingTerm).toBeGreaterThan(0);
	});

	it('a rate cut lowers the payment when keepTerm is true', () => {
		const property = createProperty({
			mortgage_balance: 120_000,
			interest_rate: 6,
			monthly_payment: 1_332.5
		});
		const config = normaliseMortgageRateRise({
			propertyId: property.id,
			newRatePct: 3,
			atMonth: 1,
			keepTerm: true
		});
		const terms = mortgageRateRiseTerms(property, config);
		expect(terms.newPayment).toBeLessThan(terms.oldPayment);
		expect(terms.delta).toBeLessThan(0);
		expect(terms.extraInterestOverRemainingTerm).toBeLessThan(0);
	});

	it('falls back to an interest-only payment at the new rate when there is no term to keep', () => {
		const balance = 200_000;
		const oldMonthlyRate = 0.05 / 12;
		const property = createProperty({
			mortgage_balance: balance,
			interest_rate: 5,
			monthly_payment: balance * oldMonthlyRate
		});
		const config = normaliseMortgageRateRise({
			propertyId: property.id,
			newRatePct: 6,
			atMonth: 1,
			keepTerm: true
		});
		const terms = mortgageRateRiseTerms(property, config);

		expect(terms.oldRemainingTermMonths).toBeNull();
		expect(terms.newRemainingTermMonths).toBeNull();
		expect(terms.extraInterestOverRemainingTerm).toBeNull();
		expect(terms.newPayment).toBeCloseTo(balance * (0.06 / 12), 2);
	});

	it('a keepPayment change onto an interest-only mortgage never clears at the new, higher rate', () => {
		const balance = 200_000;
		const oldMonthlyRate = 0.05 / 12;
		const property = createProperty({
			mortgage_balance: balance,
			interest_rate: 5,
			monthly_payment: balance * oldMonthlyRate
		});
		const config = normaliseMortgageRateRise({
			propertyId: property.id,
			newRatePct: 6,
			atMonth: 1,
			keepTerm: false
		});
		const terms = mortgageRateRiseTerms(property, config);

		expect(terms.newPayment).toBe(terms.oldPayment);
		expect(terms.newRemainingTermMonths).toBeNull();
		expect(terms.extraInterestOverRemainingTerm).toBeNull();
	});

	it('reports the payment dropping to 0 when the mortgage clears before the change lands', () => {
		const property = createProperty({
			mortgage_balance: 1_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const config = normaliseMortgageRateRise({
			propertyId: property.id,
			newRatePct: 6,
			atMonth: 12,
			keepTerm: true
		});
		const terms = mortgageRateRiseTerms(property, config);

		expect(terms.hasMortgage).toBe(true);
		expect(terms.balanceAtRateRise).toBe(0);
		expect(terms.newPayment).toBe(0);
		expect(terms.delta).toBe(-1_000);
	});

	it('walks the balance forward to the rate-rise month before doing the mortgage arithmetic', () => {
		const property = createProperty({
			mortgage_balance: 200_000,
			interest_rate: 4,
			monthly_payment: 1_500
		});
		const atMonth1 = mortgageRateRiseTerms(
			property,
			normaliseMortgageRateRise({ propertyId: property.id, atMonth: 1, keepTerm: true })
		);
		const atMonth25 = mortgageRateRiseTerms(
			property,
			normaliseMortgageRateRise({ propertyId: property.id, atMonth: 25, keepTerm: true })
		);
		expect(atMonth25.balanceAtRateRise).toBeLessThan(atMonth1.balanceAtRateRise);
	});
});

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

describe('mortgageRateRiseAdjustment', () => {
	it('is null every month with no property chosen', () => {
		const adjust = mortgageRateRiseAdjustment(normaliseMortgageRateRise(), null, [holding()]);
		for (let offset = 1; offset <= 24; offset += 1) {
			expect(adjust(offset)).toBeNull();
		}
	});

	it('is null every month when keepTerm is false and the payment never changes', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 3,
			monthly_payment: 1_160
		});
		const adjust = mortgageRateRiseAdjustment(
			normaliseMortgageRateRise({
				propertyId: 'prop_1',
				newRatePct: 6,
				atMonth: 6,
				keepTerm: false
			}),
			property,
			[holding({ monthly_contribution: 1_000 })]
		);
		for (let offset = 1; offset <= 24; offset += 1) {
			expect(adjust(offset)).toBeNull();
		}
	});

	it('leaves months before atMonth untouched', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const adjust = mortgageRateRiseAdjustment(
			normaliseMortgageRateRise({
				propertyId: 'prop_1',
				newRatePct: 6,
				atMonth: 6,
				keepTerm: true
			}),
			property,
			[holding({ monthly_contribution: 1_000 })]
		);
		expect(adjust(5)).toBeNull();
	});

	it('scales the contribution from atMonth onward by the extra payment’s share of the total', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const config = normaliseMortgageRateRise({
			propertyId: 'prop_1',
			newRatePct: 6,
			atMonth: 1,
			keepTerm: true
		});
		const terms = mortgageRateRiseTerms(property, config);
		const investments = [holding({ monthly_contribution: 1_000 })];
		const adjust = mortgageRateRiseAdjustment(config, property, investments);

		const expectedFactor = 1 - terms.delta / 1_000;
		expect(adjust(1)?.contributionFactor).toBeCloseTo(expectedFactor, 6);
		expect(adjust(1)).not.toHaveProperty('growthRate');
		expect(adjust(1)).not.toHaveProperty('factor');
	});

	it('floors the contribution factor at 0 rather than letting it go negative', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 500_000,
			interest_rate: 1,
			monthly_payment: 1_000
		});
		const config = normaliseMortgageRateRise({
			propertyId: 'prop_1',
			newRatePct: 15,
			atMonth: 1,
			keepTerm: true
		});
		const adjust = mortgageRateRiseAdjustment(config, property, [
			holding({ monthly_contribution: 10 })
		]);
		expect(adjust(1)).toEqual({ contributionFactor: 0 });
	});

	it('has nothing to scale when no contribution is due that month, for a costlier mortgage', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const config = normaliseMortgageRateRise({
			propertyId: 'prop_1',
			newRatePct: 6,
			atMonth: 1,
			keepTerm: true
		});
		const adjust = mortgageRateRiseAdjustment(config, property, [
			holding({ monthly_contribution: 1_000, contribution_frequency: 'annually' })
		]);
		// Offset 1 is not a multiple of 12, so the annual holding pays nothing that month.
		expect(adjust(1)).toEqual({ contributionFactor: 0 });
	});
});

describe('mortgageRateRiseForecast', () => {
	it('is identical to the baseline with no property chosen', () => {
		const { baseline, risen } = project({ propertyId: '' }, []);
		for (const scenario of FORECAST_SCENARIOS) {
			expect(risen.series[scenario]).toEqual(baseline.series[scenario]);
		}
	});

	it('is identical to the baseline when keepTerm is false and the payment does not change', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 3,
			monthly_payment: 1_160
		});
		const { baseline, risen } = project(
			{ propertyId: 'prop_1', newRatePct: 6, atMonth: 6, keepTerm: false },
			[property]
		);
		for (const scenario of FORECAST_SCENARIOS) {
			expect(risen.series[scenario]).toEqual(baseline.series[scenario]);
		}
	});

	it('carries the normalised config back as .rateRise', () => {
		const { risen } = project(
			{ propertyId: 'prop_1', newRatePct: 7, atMonth: 6, keepTerm: false },
			[createProperty({ id: 'prop_1' })]
		);
		expect(risen.rateRise).toEqual({
			propertyId: 'prop_1',
			newRatePct: 7,
			atMonth: 6,
			keepTerm: false
		});
	});

	it('reduces contributions from atMonth onward when the payment rises', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const { baseline, risen } = project(
			{ propertyId: 'prop_1', newRatePct: 6, atMonth: 6, keepTerm: true },
			[property]
		);
		expect(risen.series.realistic[5].contributions).toBe(
			baseline.series.realistic[5].contributions
		);
		expect(risen.series.realistic[6].contributions).toBeLessThan(
			baseline.series.realistic[6].contributions
		);
	});

	it('leaves growth untouched — a cashflow overlay never touches the rate', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const { baseline, risen } = project(
			{ propertyId: 'prop_1', newRatePct: 6, atMonth: 6, keepTerm: true },
			[property],
			{},
			{ growthRate: 5 }
		);
		expect(risen.rates).toEqual(baseline.rates);
	});
});

/* -------------------------------------------------------------------------- */
/* Reading the damage                                                          */
/* -------------------------------------------------------------------------- */

describe('mortgageRateRiseImpact', () => {
	it('reports hasMortgage: false and occurs: false with no property chosen', () => {
		const { baseline, risen } = project({ propertyId: '' }, []);
		const impact = mortgageRateRiseImpact(baseline, risen, null);
		expect(impact.hasMortgage).toBe(false);
		expect(impact.occurs).toBe(false);
	});

	it('reports occurs: false when the change is dated past the forecast horizon', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const { baseline, risen } = project(
			{ propertyId: 'prop_1', newRatePct: 6, atMonth: 200, keepTerm: true },
			[property],
			{ months: 24 }
		);
		const impact = mortgageRateRiseImpact(baseline, risen, property);
		expect(impact.occurs).toBe(false);
	});

	it('reports the new payment, the delta and a positive shortfall for a costlier mortgage', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const { baseline, risen } = project(
			{ propertyId: 'prop_1', newRatePct: 6, atMonth: 1, keepTerm: true },
			[property]
		);
		const impact = mortgageRateRiseImpact(baseline, risen, property);

		expect(impact.occurs).toBe(true);
		expect(impact.newPayment).toBeGreaterThan(impact.oldPayment);
		expect(impact.delta).toBeCloseTo(impact.newPayment - impact.oldPayment, 6);
		expect(impact.shortfall).toBeGreaterThan(0);
		expect(impact.shortfall).toBeCloseTo(
			(baseline.series.realistic.at(-1)?.net_worth ?? 0) -
				(risen.series.realistic.at(-1)?.net_worth ?? 0),
			PENNY
		);
	});

	it('reports a 0 shortfall when keepTerm is false and cashflow never changes', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 3,
			monthly_payment: 1_160
		});
		const { baseline, risen } = project(
			{ propertyId: 'prop_1', newRatePct: 6, atMonth: 1, keepTerm: false },
			[property]
		);
		const impact = mortgageRateRiseImpact(baseline, risen, property);
		expect(impact.delta).toBe(0);
		expect(impact.shortfall).toBe(0);
		expect(/** @type {number} */ (impact.extraInterestOverRemainingTerm)).toBeGreaterThan(0);
	});

	it('shortfallShare is null when the baseline ends at or below zero', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const { baseline, risen } = project(
			{ propertyId: 'prop_1', newRatePct: 6, atMonth: 1, keepTerm: true },
			[property],
			{ investments: [] }
		);
		expect(mortgageRateRiseImpact(baseline, risen, property).shortfallShare).toBeNull();
	});
});

describe('mortgageRateRiseImpacts', () => {
	it('returns all three scenarios, keyed by name', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const { baseline, risen } = project(
			{ propertyId: 'prop_1', newRatePct: 6, atMonth: 1, keepTerm: true },
			[property]
		);
		const impacts = mortgageRateRiseImpacts(baseline, risen, property);
		expect(Object.keys(impacts).sort()).toEqual([...FORECAST_SCENARIOS].sort());
		for (const scenario of FORECAST_SCENARIOS) {
			expect(impacts[scenario].scenario).toBe(scenario);
		}
	});
});

describe('compareMortgageRateRise', () => {
	it('lines up baseline and risen net worth at the summary table’s own offsets', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const { baseline, risen } = project(
			{ propertyId: 'prop_1', newRatePct: 6, atMonth: 1, keepTerm: true },
			[property]
		);
		const rows = compareMortgageRateRise(baseline, risen);
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row.gap).toBeCloseTo(row.risen - row.baseline, PENNY);
		}
	});

	it('drops offsets past the horizon rather than returning holes', () => {
		const property = createProperty({
			id: 'prop_1',
			mortgage_balance: 120_000,
			interest_rate: 0,
			monthly_payment: 1_000
		});
		const { baseline, risen } = project(
			{ propertyId: 'prop_1', newRatePct: 6, atMonth: 1, keepTerm: true },
			[property],
			{ months: 12 }
		);
		const rows = compareMortgageRateRise(baseline, risen, 'realistic', [6, 12, 999]);
		expect(rows.map((row) => row.offset)).toEqual([6, 12]);
	});
});
