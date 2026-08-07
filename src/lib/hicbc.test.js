/**
 * High Income Child Benefit Charge, 2026/27 — issue #24.
 *
 * Two kinds of test here. The first pins the figures the charge is built from — README.md's
 * £60,000/£80,000 thresholds, the 1%-per-£200 step and the Child Benefit weekly rates — so that a
 * new tax year is a deliberate, visible edit rather than a silent drift. The second checks the
 * behaviour that is easy to get subtly wrong: the whole-number percentage's staircase at each end
 * of the band, which of a couple actually owes the charge, and the fact that the marginal-rate
 * figure on screen matches what an extra £200 of income observably costs.
 */
import { describe, expect, it } from 'vitest';

import { TAX_REGIONS } from './enums.js';
import {
	CHILD_BENEFIT_ADDITIONAL_WEEKLY,
	CHILD_BENEFIT_ELDEST_WEEKLY,
	CHILD_BENEFIT_WEEKS_PER_PAYMENT,
	CHILD_BENEFIT_WEEKS_PER_YEAR,
	chargeBearer,
	childBenefitCharge,
	childBenefitEntitlement,
	childBenefitPerPayment,
	childBenefitSummary,
	childBenefitWeekly,
	HICBC_FULL_CLAWBACK_AT,
	HICBC_INCOME_PER_PERCENT,
	HICBC_TAX_YEAR,
	HICBC_THRESHOLD,
	hicbcMarginalRate,
	hicbcPercentage,
	inChargeBand,
	incomeToClearCharge
} from './hicbc.js';
import { marginalTaxRate, takeHomePay, TAX_YEAR } from './tax.js';

/**
 * Hand-worked expectations are built from decimal multiplications, which drift in the last few
 * binary places; this rounds them to whole pence the same way the module rounds its own answers.
 *
 * @param {number} amount
 * @returns {number}
 */
const p = (amount) => Math.round(amount * 100) / 100;

/** One child's full-year entitlement, worked by hand: £27.05 × 52. */
const ONE_CHILD_YEAR = p(27.05 * 52);
/** Two children: (£27.05 + £17.90) × 52. */
const TWO_CHILD_YEAR = p((27.05 + 17.9) * 52);

describe('the 2026/27 figures', () => {
	it('is labelled with the same tax year as the income tax module', () => {
		expect(HICBC_TAX_YEAR).toBe('2026/27');
		expect(HICBC_TAX_YEAR).toBe(TAX_YEAR);
		expect(childBenefitSummary({ income: 50_000 }).taxYear).toBe('2026/27');
	});

	it('pins the Child Benefit weekly rates', () => {
		expect(CHILD_BENEFIT_ELDEST_WEEKLY).toBe(27.05);
		expect(CHILD_BENEFIT_ADDITIONAL_WEEKLY).toBe(17.9);
		expect(CHILD_BENEFIT_WEEKS_PER_YEAR).toBe(52);
		expect(CHILD_BENEFIT_WEEKS_PER_PAYMENT).toBe(4);
	});

	it("pins README.md's post-April-2024 HICBC thresholds", () => {
		expect(HICBC_THRESHOLD).toBe(60_000);
		expect(HICBC_FULL_CLAWBACK_AT).toBe(80_000);
		expect(HICBC_INCOME_PER_PERCENT).toBe(200);
	});

	it('has thresholds and a step that agree: £200 a point over £20,000 is exactly 100 points', () => {
		expect((HICBC_FULL_CLAWBACK_AT - HICBC_THRESHOLD) / HICBC_INCOME_PER_PERCENT).toBe(100);
	});
});

describe('childBenefitWeekly / childBenefitEntitlement', () => {
	it('pays nothing for no children', () => {
		expect(childBenefitWeekly(0)).toBe(0);
		expect(childBenefitEntitlement(0)).toBe(0);
		expect(childBenefitPerPayment(0)).toBe(0);
	});

	it('pays the eldest-child rate for one child', () => {
		expect(childBenefitWeekly(1)).toBe(27.05);
		expect(childBenefitEntitlement(1)).toBe(1_406.6);
		expect(childBenefitEntitlement(1)).toBe(ONE_CHILD_YEAR);
	});

	it('adds the lower rate for each child after the first, not the higher one', () => {
		expect(childBenefitWeekly(2)).toBe(p(27.05 + 17.9));
		expect(childBenefitWeekly(3)).toBe(p(27.05 + 2 * 17.9));
		expect(childBenefitEntitlement(2)).toBe(TWO_CHILD_YEAR);
		expect(childBenefitEntitlement(2)).toBe(2_337.4);
		expect(childBenefitEntitlement(3)).toBe(3_268.2);

		// The second child is worth less than the first — the thing a flat multiple would get wrong.
		expect(childBenefitWeekly(2)).toBeLessThan(2 * childBenefitWeekly(1));
	});

	it('pays four weeks at a time', () => {
		expect(childBenefitPerPayment(1)).toBe(p(27.05 * 4));
		expect(childBenefitPerPayment(2)).toBe(p((27.05 + 17.9) * 4));
	});

	it('reads a fractional or negative count of children as a whole, non-negative one', () => {
		expect(childBenefitWeekly(2.9)).toBe(childBenefitWeekly(2));
		expect(childBenefitWeekly(-3)).toBe(0);
		expect(childBenefitWeekly(/** @type {never} */ ('two'))).toBe(0);
		expect(childBenefitWeekly()).toBe(0);
	});
});

describe('hicbcPercentage', () => {
	it('charges nothing at or below £60,000', () => {
		expect(hicbcPercentage(0)).toBe(0);
		expect(hicbcPercentage(59_999)).toBe(0);
		expect(hicbcPercentage(60_000)).toBe(0);
	});

	it('steps in whole percentage points, one for each complete £200', () => {
		// The first pound of charge appears at £60,200, not at £60,001.
		expect(hicbcPercentage(60_100)).toBe(0);
		expect(hicbcPercentage(60_199.99)).toBe(0);
		expect(hicbcPercentage(60_200)).toBe(1);
		expect(hicbcPercentage(60_399)).toBe(1);
		expect(hicbcPercentage(60_400)).toBe(2);
	});

	it('is halfway through the clawback at £70,000', () => {
		expect(hicbcPercentage(70_000)).toBe(50);
	});

	it('reaches 100% at £80,000 and never exceeds it', () => {
		expect(hicbcPercentage(79_999)).toBe(99);
		expect(hicbcPercentage(80_000)).toBe(100);
		expect(hicbcPercentage(250_000)).toBe(100);
	});

	it('treats nonsense income as nothing rather than producing NaN', () => {
		expect(hicbcPercentage(-10_000)).toBe(0);
		expect(hicbcPercentage(Number.NaN)).toBe(0);
		expect(hicbcPercentage(/** @type {never} */ ('90000'))).toBe(0);
		expect(hicbcPercentage()).toBe(0);
	});
});

describe('inChargeBand', () => {
	it('excludes both edges: nothing is charged at £60,000, nothing is left to taper at £80,000', () => {
		expect(inChargeBand(59_999)).toBe(false);
		expect(inChargeBand(60_000)).toBe(false);
		expect(inChargeBand(60_000.01)).toBe(true);
		expect(inChargeBand(79_999.99)).toBe(true);
		expect(inChargeBand(80_000)).toBe(false);
		expect(inChargeBand(120_000)).toBe(false);
	});
});

describe('childBenefitCharge', () => {
	it('takes nothing below the threshold', () => {
		expect(childBenefitCharge(ONE_CHILD_YEAR, 59_000)).toBe(0);
	});

	it('takes the stated share of the benefit inside the band', () => {
		// £70,000 is 50% of the way up the clawback: half of one child's £1,406.60.
		expect(childBenefitCharge(ONE_CHILD_YEAR, 70_000)).toBe(p(ONE_CHILD_YEAR / 2));
		expect(childBenefitCharge(TWO_CHILD_YEAR, 70_000)).toBe(p(TWO_CHILD_YEAR / 2));
		expect(childBenefitCharge(TWO_CHILD_YEAR, 65_000)).toBe(p(TWO_CHILD_YEAR * 0.25));
	});

	it('takes the whole benefit at and above £80,000', () => {
		expect(childBenefitCharge(TWO_CHILD_YEAR, 80_000)).toBe(TWO_CHILD_YEAR);
		expect(childBenefitCharge(TWO_CHILD_YEAR, 150_000)).toBe(TWO_CHILD_YEAR);
	});

	it('takes nothing when there is no benefit to claw back, however high the income', () => {
		expect(childBenefitCharge(0, 200_000)).toBe(0);
	});
});

describe('hicbcMarginalRate', () => {
	it('is zero outside the clawback band', () => {
		expect(hicbcMarginalRate(TWO_CHILD_YEAR, 50_000)).toBe(0);
		expect(hicbcMarginalRate(TWO_CHILD_YEAR, 60_000)).toBe(0);
		expect(hicbcMarginalRate(TWO_CHILD_YEAR, 80_000)).toBe(0);
		expect(hicbcMarginalRate(TWO_CHILD_YEAR, 100_000)).toBe(0);
	});

	it('is the benefit divided by £200 inside it', () => {
		expect(hicbcMarginalRate(ONE_CHILD_YEAR, 70_000)).toBeCloseTo(7.033, 3);
		expect(hicbcMarginalRate(TWO_CHILD_YEAR, 70_000)).toBeCloseTo(11.687, 3);
	});

	it('matches what £200 more income observably costs, for one to four children', () => {
		for (const children of [1, 2, 3, 4]) {
			const benefit = childBenefitEntitlement(children);
			const before = childBenefitCharge(benefit, 70_000);
			const after = childBenefitCharge(benefit, 70_200);
			// The quoted rate is a percentage of income; £200 of income at that rate is the step. The
			// two agree to within a penny rather than exactly, because each charge either side is
			// itself rounded to whole pence.
			const predicted = (hicbcMarginalRate(benefit, 70_000) / 100) * HICBC_INCOME_PER_PERCENT;
			expect(Math.abs(after - before - predicted)).toBeLessThan(0.01);
		}
	});

	it('is the gradient across a step, not the cost of one literal pound', () => {
		const benefit = TWO_CHILD_YEAR;
		// Nothing at all changes for 199 of the 200 pounds — see convention (2).
		expect(childBenefitCharge(benefit, 70_001)).toBe(childBenefitCharge(benefit, 70_000));
		expect(hicbcMarginalRate(benefit, 70_001)).toBeGreaterThan(0);
	});
});

describe('incomeToClearCharge', () => {
	it('is nothing for anyone at or below the threshold', () => {
		expect(incomeToClearCharge(45_000)).toBe(0);
		expect(incomeToClearCharge(60_000)).toBe(0);
	});

	it('is the whole excess over £60,000', () => {
		expect(incomeToClearCharge(66_500)).toBe(6_500);
		expect(incomeToClearCharge(80_000)).toBe(20_000);
		expect(incomeToClearCharge(95_000)).toBe(35_000);
	});
});

describe('chargeBearer', () => {
	it('finds nobody liable when neither income clears the threshold', () => {
		expect(chargeBearer(0, 0)).toBe('neither');
		expect(chargeBearer(59_000, 58_000)).toBe('neither');
		expect(chargeBearer(60_000, 60_000)).toBe('neither');
	});

	it('charges the higher earner, not the household', () => {
		expect(chargeBearer(70_000, 20_000)).toBe('you');
		expect(chargeBearer(70_000, 75_000)).toBe('partner');
		expect(chargeBearer(30_000, 90_000)).toBe('partner');
	});

	it('leaves a £70,000 earner owing nothing when their partner earns more', () => {
		// Two incomes over the threshold is still exactly one charge.
		expect(chargeBearer(70_000, 78_000)).toBe('partner');
	});

	it('treats an exact tie as yours — see convention (3)', () => {
		expect(chargeBearer(70_000, 70_000)).toBe('you');
	});
});

describe('childBenefitSummary', () => {
	it('keeps the whole benefit below the threshold', () => {
		const result = childBenefitSummary({ income: 45_000, children: 2 });

		expect(result.annualBenefit).toBe(TWO_CHILD_YEAR);
		expect(result.charge).toBe(0);
		expect(result.netBenefit).toBe(TWO_CHILD_YEAR);
		expect(result.percentage).toBe(0);
		expect(result.bearer).toBe('neither');
		expect(result.liable).toBe(false);
		expect(result.headroom).toBe(15_000);
		expect(result.inChargeBand).toBe(false);
		expect(result.fullyClawedBack).toBe(false);
	});

	it('claws back part of it inside the band', () => {
		const result = childBenefitSummary({ income: 70_000, children: 2 });

		expect(result.percentage).toBe(50);
		expect(result.charge).toBe(p(TWO_CHILD_YEAR / 2));
		expect(result.netBenefit).toBe(p(TWO_CHILD_YEAR / 2));
		expect(result.bearer).toBe('you');
		expect(result.liable).toBe(true);
		expect(result.inChargeBand).toBe(true);
		expect(result.headroom).toBe(0);
		expect(result.incomeToClearCharge).toBe(10_000);
	});

	it('cancels it out entirely at £80,000', () => {
		const result = childBenefitSummary({ income: 80_000, children: 3 });

		expect(result.percentage).toBe(100);
		expect(result.charge).toBe(result.annualBenefit);
		expect(result.netBenefit).toBe(0);
		expect(result.fullyClawedBack).toBe(true);
		// Above the band the clawback is complete, not tapering — no marginal cost to a pay rise.
		expect(result.inChargeBand).toBe(false);
		expect(result.hicbcMarginalRate).toBe(0);
	});

	it('has the charge follow the higher earner, and takes it off the right person', () => {
		const result = childBenefitSummary({ income: 40_000, partnerIncome: 75_000, children: 1 });

		expect(result.bearer).toBe('partner');
		expect(result.liable).toBe(false);
		expect(result.chargeIncome).toBe(75_000);
		expect(result.percentage).toBe(75);
		expect(result.charge).toBe(p(ONE_CHILD_YEAR * 0.75));
		// It is the household's benefit that shrinks, but not this person's take-home pay.
		expect(result.netBenefit).toBe(p(ONE_CHILD_YEAR * 0.25));
		expect(result.takeHomeAfterCharge).toBe(takeHomePay(40_000, 'england_wales_ni'));
		expect(result.hicbcMarginalRate).toBe(0);
	});

	it('deducts a charge you do owe from your own take-home figure', () => {
		const result = childBenefitSummary({ income: 70_000, children: 2 });

		expect(result.takeHomeAfterCharge).toBe(
			p(takeHomePay(70_000, 'england_wales_ni') - result.charge)
		);
	});

	it('charges nothing when the payments have been stopped, however high the income', () => {
		const result = childBenefitSummary({ income: 120_000, children: 2, claiming: false });

		expect(result.annualBenefit).toBe(0);
		expect(result.weeklyBenefit).toBe(0);
		expect(result.perPaymentBenefit).toBe(0);
		expect(result.charge).toBe(0);
		expect(result.netBenefit).toBe(0);
		expect(result.bearer).toBe('neither');
		expect(result.percentage).toBe(0);
		expect(result.fullyClawedBack).toBe(false);
	});

	it('charges nothing when no Child Benefit is claimed for anyone', () => {
		const result = childBenefitSummary({ income: 120_000, children: 0 });

		expect(result.annualBenefit).toBe(0);
		expect(result.charge).toBe(0);
		expect(result.bearer).toBe('neither');
	});

	it('accepts a benefit figure directly, for a part-year claim', () => {
		// A child born partway through the year: 30 weeks of the eldest-child rate.
		const received = p(27.05 * 30);
		const result = childBenefitSummary({ income: 70_000, children: 1, annualBenefit: received });

		expect(result.annualBenefit).toBe(received);
		expect(result.charge).toBe(p(received / 2));
		// The override drives the weekly figure too, rather than the panel showing a full-year rate
		// next to a part-year charge.
		expect(result.weeklyBenefit).toBe(p(received / 52));
	});

	it('reports the benefit four weeks at a time, as it is actually paid', () => {
		const result = childBenefitSummary({ income: 30_000, children: 2 });
		expect(result.perPaymentBenefit).toBe(childBenefitPerPayment(2));
	});

	it('adds HICBC to the income tax marginal rate, in every region', () => {
		for (const region of TAX_REGIONS) {
			const result = childBenefitSummary({ income: 70_000, children: 2, region });

			expect(result.incomeTaxMarginalRate).toBe(marginalTaxRate(70_000, region));
			expect(result.hicbcMarginalRate).toBeCloseTo(11.687, 3);
			expect(result.combinedMarginalRate).toBeCloseTo(
				result.incomeTaxMarginalRate + result.hicbcMarginalRate,
				6
			);
		}
	});

	it('puts a two-child family on £70,000 above 50% marginal, in both regions', () => {
		// The point of the figure: a 40% (E/W/NI) or 42% (Scotland) taxpayer is really paying more.
		expect(childBenefitSummary({ income: 70_000, children: 2 }).combinedMarginalRate).toBeCloseTo(
			51.687,
			3
		);
		expect(
			childBenefitSummary({ income: 70_000, children: 2, region: 'scotland' }).combinedMarginalRate
		).toBeCloseTo(53.687, 3);
	});

	it('adds nothing to the marginal rate once the clawback is complete', () => {
		const result = childBenefitSummary({ income: 90_000, children: 2 });

		expect(result.hicbcMarginalRate).toBe(0);
		expect(result.combinedMarginalRate).toBe(result.incomeTaxMarginalRate);
	});

	it('falls back to England, Wales & NI for an unrecognised region', () => {
		const result = childBenefitSummary({
			income: 70_000,
			children: 1,
			region: /** @type {never} */ ('wales')
		});
		expect(result.region).toBe('england_wales_ni');
	});

	it('survives an empty input rather than producing NaN', () => {
		const result = childBenefitSummary();

		expect(result.income).toBe(0);
		expect(result.annualBenefit).toBe(0);
		expect(result.charge).toBe(0);
		expect(result.combinedMarginalRate).toBe(0);
		expect(result.headroom).toBe(HICBC_THRESHOLD);
	});

	it('accounts for every pound of benefit: charge plus what is kept is what was received', () => {
		for (const income of [30_000, 60_000, 62_500, 70_000, 79_800, 80_000, 140_000]) {
			for (const children of [1, 2, 3]) {
				const result = childBenefitSummary({ income, children });
				expect(p(result.charge + result.netBenefit)).toBe(result.annualBenefit);
				expect(result.charge).toBeLessThanOrEqual(result.annualBenefit);
			}
		}
	});

	it('never makes claiming worse than not claiming below £80,000', () => {
		// The charge is a share of the benefit, so keeping the payments is never a loss — the reason
		// opting out is only ever about convenience, not money.
		for (const income of [61_000, 65_000, 70_000, 79_000]) {
			const claimed = childBenefitSummary({ income, children: 2 });
			expect(claimed.netBenefit).toBeGreaterThan(0);
		}
		const clawedBack = childBenefitSummary({ income: 85_000, children: 2 });
		expect(clawedBack.netBenefit).toBe(0);
	});
});
