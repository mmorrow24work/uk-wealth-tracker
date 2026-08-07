/**
 * Marriage Allowance, 2026/27 — issue #25.
 *
 * Three kinds of test here. The first pins the figures the module derives — the £1,260 transfer,
 * the fixed 20% reduction, and the £50,270/£43,662 recipient thresholds — so a future Personal
 * Allowance or band change is a visible, deliberate edit rather than a silent drift (convention 1/2
 * in the module header). The second checks the eligibility edges: exactly at the Personal
 * Allowance, exactly at the higher-rate threshold, and the two failure modes (transferor already
 * taxed, recipient already a higher-rate taxpayer). The third checks the arithmetic that is easy to
 * get subtly wrong: the transferor's extra-tax trick reusing `tax.js`'s own `incomeTax`, the
 * recipient's reduction capped at their actual liability, and the Scotland case where the fixed 20%
 * reduction beats the transferor's 19% starter-band cost.
 */
import { describe, expect, it } from 'vitest';

import {
	eligible,
	higherRateThreshold,
	MARRIAGE_ALLOWANCE_PERCENT,
	MARRIAGE_ALLOWANCE_RATE,
	MARRIAGE_ALLOWANCE_ROUNDING,
	MARRIAGE_ALLOWANCE_TAX_YEAR,
	MARRIAGE_ALLOWANCE_TRANSFER,
	marriageAllowanceSummary,
	recipientEligible,
	recipientTaxReduction,
	transferableAllowance,
	transferorEligible,
	transferorExtraTax
} from './marriage-allowance.js';
import { incomeTax, PERSONAL_ALLOWANCE, TAX_YEAR } from './tax.js';

/**
 * Hand-worked expectations are built from decimal multiplications, which drift in the last few
 * binary places; this rounds them to whole pence the same way the module rounds its own answers.
 *
 * @param {number} amount
 * @returns {number}
 */
const p = (amount) => Math.round(amount * 100) / 100;

describe('the 2026/27 figures', () => {
	it('is labelled with the same tax year as the income tax module', () => {
		expect(MARRIAGE_ALLOWANCE_TAX_YEAR).toBe('2026/27');
		expect(MARRIAGE_ALLOWANCE_TAX_YEAR).toBe(TAX_YEAR);
		expect(marriageAllowanceSummary({}).taxYear).toBe('2026/27');
	});

	it('pins the transfer rate and rounding rule', () => {
		expect(MARRIAGE_ALLOWANCE_PERCENT).toBe(10);
		expect(MARRIAGE_ALLOWANCE_ROUNDING).toBe(10);
		expect(MARRIAGE_ALLOWANCE_RATE).toBe(20);
	});

	it('derives £1,260 from 10% of the frozen £12,570 Personal Allowance, rounded up to £10', () => {
		expect(PERSONAL_ALLOWANCE).toBe(12_570);
		expect(transferableAllowance()).toBe(1_260);
		expect(MARRIAGE_ALLOWANCE_TRANSFER).toBe(1_260);
		// 10% of £12,570 is £1,257 exactly — the rounding-up is what turns it into £1,260.
		expect((PERSONAL_ALLOWANCE * MARRIAGE_ALLOWANCE_PERCENT) / 100).toBe(1_257);
	});

	it('derives the recipient thresholds from the higher-rate band boundaries', () => {
		expect(higherRateThreshold('england_wales_ni')).toBe(50_270);
		expect(higherRateThreshold('scotland')).toBe(43_662);
	});
});

describe('transferorEligible', () => {
	it('is eligible at and below the Personal Allowance', () => {
		expect(transferorEligible(0)).toBe(true);
		expect(transferorEligible(5_000)).toBe(true);
		expect(transferorEligible(12_570)).toBe(true);
	});

	it('is ineligible one pound over the Personal Allowance', () => {
		expect(transferorEligible(12_571)).toBe(false);
	});

	it('treats a missing/undefined income as zero, which is eligible', () => {
		expect(transferorEligible()).toBe(true);
	});
});

describe('recipientEligible', () => {
	it('is eligible right up to the higher-rate threshold, exclusive', () => {
		expect(recipientEligible(50_269, 'england_wales_ni')).toBe(true);
		expect(recipientEligible(50_270, 'england_wales_ni')).toBe(false);
	});

	it('uses the lower Scottish threshold', () => {
		expect(recipientEligible(43_661, 'scotland')).toBe(true);
		expect(recipientEligible(43_662, 'scotland')).toBe(false);
	});

	it('is eligible on no income at all — a non-taxpayer is not a higher-rate taxpayer', () => {
		expect(recipientEligible(0, 'england_wales_ni')).toBe(true);
	});

	it('falls back to England/Wales/NI for an unrecognised region', () => {
		expect(recipientEligible(45_000, 'atlantis')).toBe(true);
		expect(recipientEligible(51_000, 'atlantis')).toBe(false);
	});
});

describe('eligible', () => {
	it('needs both sides to pass', () => {
		expect(eligible(5_000, 40_000, 'england_wales_ni')).toBe(true);
		expect(eligible(15_000, 40_000, 'england_wales_ni')).toBe(false); // transferor too high
		expect(eligible(5_000, 60_000, 'england_wales_ni')).toBe(false); // recipient too high
		expect(eligible(15_000, 60_000, 'england_wales_ni')).toBe(false); // both too high
	});
});

describe('transferorExtraTax', () => {
	it('costs nothing when the transferor stays under the Personal Allowance after giving up allowance', () => {
		// £5,000 + £1,260 = £6,260, still under £12,570.
		expect(transferorExtraTax(5_000, 1_260, 'england_wales_ni')).toBe(0);
	});

	it('taxes exactly the amount pushed over the new, reduced allowance', () => {
		// At the Personal Allowance itself, giving up £1,260 makes all £1,260 taxable at 20%.
		expect(transferorExtraTax(12_570, 1_260, 'england_wales_ni')).toBe(p(1_260 * 0.2));
		expect(transferorExtraTax(12_570, 1_260, 'england_wales_ni')).toBe(252);
	});

	it('matches incomeTax(income + transfer) minus incomeTax(income), by construction', () => {
		for (const income of [0, 8_000, 11_500, 12_570]) {
			for (const region of ['england_wales_ni', 'scotland']) {
				expect(transferorExtraTax(income, 1_260, region)).toBe(
					p(incomeTax(income + 1_260, region) - incomeTax(income, region))
				);
			}
		}
	});

	it("lands in Scotland's 19% starter band rather than assuming the 20% basic rate", () => {
		// Taxable income after the transfer is £1,260, entirely inside the £0–£3,967 starter band.
		const cost = transferorExtraTax(12_570, 1_260, 'scotland');
		expect(cost).toBe(p(1_260 * 0.19));
		expect(cost).toBeLessThan(252); // less than the recipient's fixed 20% reduction
	});
});

describe('recipientTaxReduction', () => {
	it('gives the full fixed £252 when the recipient owes at least that much', () => {
		expect(recipientTaxReduction(40_000, 1_260, 'england_wales_ni')).toBe(252);
	});

	it("caps at the recipient's own liability when it is thinner than £252", () => {
		// £13,000 taxable at 20% on £430 = £86 owed — less than the £252 headline figure.
		const liability = incomeTax(13_000, 'england_wales_ni');
		expect(liability).toBeLessThan(252);
		expect(recipientTaxReduction(13_000, 1_260, 'england_wales_ni')).toBe(p(liability));
	});

	it('gives nothing to a recipient who owes nothing', () => {
		expect(recipientTaxReduction(0, 1_260, 'england_wales_ni')).toBe(0);
	});
});

describe('marriageAllowanceSummary', () => {
	it('reports the full £252 net benefit for a comfortably-eligible couple', () => {
		const result = marriageAllowanceSummary({
			transferorIncome: 5_000,
			recipientIncome: 40_000,
			region: 'england_wales_ni'
		});

		expect(result.eligible).toBe(true);
		expect(result.applied).toBe(true);
		expect(result.transferAmount).toBe(1_260);
		expect(result.transferorExtraTax).toBe(0);
		expect(result.recipientTaxReduction).toBe(252);
		expect(result.netHouseholdBenefit).toBe(252);
		expect(result.transferorNewAllowance).toBe(11_310);
	});

	it('is a breakeven, not a loss, right at the Personal Allowance boundary in England/Wales/NI', () => {
		const result = marriageAllowanceSummary({
			transferorIncome: 12_570,
			recipientIncome: 40_000,
			region: 'england_wales_ni'
		});

		expect(result.eligible).toBe(true);
		expect(result.transferorExtraTax).toBe(252);
		expect(result.recipientTaxReduction).toBe(252);
		expect(result.netHouseholdBenefit).toBe(0);
	});

	it('nets a small positive in Scotland at the same boundary, from the starter-rate mismatch', () => {
		const result = marriageAllowanceSummary({
			transferorIncome: 12_570,
			recipientIncome: 40_000,
			region: 'scotland'
		});

		expect(result.netHouseholdBenefit).toBeGreaterThan(0);
		expect(result.netHouseholdBenefit).toBe(p(252 - 1_260 * 0.19));
	});

	it('applies nothing when the transferor already pays tax', () => {
		const result = marriageAllowanceSummary({
			transferorIncome: 15_000,
			recipientIncome: 40_000,
			region: 'england_wales_ni'
		});

		expect(result.transferorEligible).toBe(false);
		expect(result.eligible).toBe(false);
		expect(result.applied).toBe(false);
		expect(result.transferorExtraTax).toBe(0);
		expect(result.recipientTaxReduction).toBe(0);
		expect(result.netHouseholdBenefit).toBe(0);
	});

	it('applies nothing when the recipient is already a higher-rate taxpayer', () => {
		const result = marriageAllowanceSummary({
			transferorIncome: 5_000,
			recipientIncome: 60_000,
			region: 'england_wales_ni'
		});

		expect(result.recipientEligible).toBe(false);
		expect(result.eligible).toBe(false);
		expect(result.applied).toBe(false);
	});

	it('is eligible but not applied when the couple has not claimed', () => {
		const result = marriageAllowanceSummary({
			transferorIncome: 5_000,
			recipientIncome: 40_000,
			region: 'england_wales_ni',
			claiming: false
		});

		expect(result.eligible).toBe(true);
		expect(result.applied).toBe(false);
		expect(result.transferorExtraTax).toBe(0);
		expect(result.recipientTaxReduction).toBe(0);
		expect(result.netHouseholdBenefit).toBe(0);
	});

	it("caps the recipient's saving at their liability inside the summary too", () => {
		const result = marriageAllowanceSummary({
			transferorIncome: 5_000,
			recipientIncome: 13_000,
			region: 'england_wales_ni'
		});

		expect(result.recipientTaxReduction).toBeLessThan(252);
		expect(result.recipientTaxReduction).toBe(p(incomeTax(13_000, 'england_wales_ni')));
	});

	it('reports headroom on both sides', () => {
		const result = marriageAllowanceSummary({
			transferorIncome: 10_000,
			recipientIncome: 45_000,
			region: 'england_wales_ni'
		});

		expect(result.transferorHeadroom).toBe(2_570);
		expect(result.recipientHeadroom).toBe(5_270);
		expect(result.higherRateThreshold).toBe(50_270);
	});

	it('zeroes headroom once past the threshold rather than going negative', () => {
		const result = marriageAllowanceSummary({
			transferorIncome: 20_000,
			recipientIncome: 60_000,
			region: 'england_wales_ni'
		});

		expect(result.transferorHeadroom).toBe(0);
		expect(result.recipientHeadroom).toBe(0);
	});

	it('defaults every field sensibly on an empty input', () => {
		const result = marriageAllowanceSummary();

		expect(result.transferorIncome).toBe(0);
		expect(result.recipientIncome).toBe(0);
		expect(result.region).toBe('england_wales_ni');
		expect(result.claiming).toBe(true);
		expect(result.transferorEligible).toBe(true); // £0 is under the Personal Allowance
		expect(result.recipientEligible).toBe(true); // £0 is under the higher-rate threshold
		expect(result.eligible).toBe(true);
		expect(result.applied).toBe(true);
		// Both incomes are nil, so nothing actually changes hands.
		expect(result.transferorExtraTax).toBe(0);
		expect(result.recipientTaxReduction).toBe(0);
		expect(result.netHouseholdBenefit).toBe(0);
	});
});
