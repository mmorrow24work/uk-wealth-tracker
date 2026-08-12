/**
 * Student Loan repayments, 2026/27 — issue #26.
 *
 * Two kinds of test here. The first pins the figures every calculation is built from — the five
 * plan thresholds and rates — so that a correction or a new tax year is a deliberate, visible edit
 * rather than a silent drift. The second checks the behaviour that's easy to get subtly wrong:
 * whole-pound-down rounding rather than penny rounding, an undergraduate plan and a Postgraduate
 * Loan summing rather than merging when both are active, and the combined marginal rate actually
 * matching what tax.js plus this module say separately.
 */
import { describe, expect, it } from 'vitest';

import { marginalTaxRate, takeHomePay, TAX_YEAR } from './tax.js';
import {
	ALL_STUDENT_LOAN_TYPES,
	LOAN_DEFS,
	normaliseUndergraduatePlan,
	rateFor,
	repaymentForLoan,
	STUDENT_LOAN_TAX_YEAR,
	studentLoanSummary,
	thresholdFor,
	UNDERGRADUATE_PLAN_LABELS,
	UNDERGRADUATE_PLANS
} from './student-loan.js';

describe('the 2026/27 figures', () => {
	it('is labelled with the same tax year as the income tax module', () => {
		expect(STUDENT_LOAN_TAX_YEAR).toBe('2026/27');
		expect(STUDENT_LOAN_TAX_YEAR).toBe(TAX_YEAR);
		expect(studentLoanSummary({ income: 30_000, plan: 'plan_2' }).taxYear).toBe('2026/27');
	});

	it('pins every plan threshold and rate', () => {
		expect(LOAN_DEFS.plan_1).toEqual({ label: 'Plan 1', threshold: 26_065, rate: 9 });
		expect(LOAN_DEFS.plan_2).toEqual({ label: 'Plan 2', threshold: 28_470, rate: 9 });
		expect(LOAN_DEFS.plan_4).toEqual({ label: 'Plan 4', threshold: 32_745, rate: 9 });
		expect(LOAN_DEFS.plan_5).toEqual({ label: 'Plan 5', threshold: 25_000, rate: 9 });
		expect(LOAN_DEFS.postgraduate).toEqual({
			label: 'Postgraduate Loan',
			threshold: 21_000,
			rate: 6
		});
	});

	it('lists all five loan types, in README.md order, for a reference table', () => {
		expect(ALL_STUDENT_LOAN_TYPES.map((loan) => loan.id)).toEqual([
			'plan_1',
			'plan_2',
			'plan_4',
			'plan_5',
			'postgraduate'
		]);
		expect(ALL_STUDENT_LOAN_TYPES.every((loan) => loan.threshold > 0)).toBe(true);
	});

	it('exposes thresholdFor/rateFor for every known loan id and 0 for an unknown one', () => {
		expect(thresholdFor('plan_2')).toBe(28_470);
		expect(rateFor('plan_2')).toBe(9);
		expect(thresholdFor('postgraduate')).toBe(21_000);
		expect(rateFor('postgraduate')).toBe(6);
		expect(thresholdFor('none')).toBe(0);
		expect(rateFor('not_a_real_plan')).toBe(0);
	});
});

describe('normaliseUndergraduatePlan', () => {
	it('accepts every plan in UNDERGRADUATE_PLANS unchanged', () => {
		for (const plan of UNDERGRADUATE_PLANS) {
			expect(normaliseUndergraduatePlan(plan)).toBe(plan);
		}
	});

	it("falls back to 'none' for anything unrecognised", () => {
		expect(normaliseUndergraduatePlan('plan_3')).toBe('none');
		expect(normaliseUndergraduatePlan(undefined)).toBe('none');
		expect(normaliseUndergraduatePlan(null)).toBe('none');
		expect(normaliseUndergraduatePlan(42)).toBe('none');
	});

	it('has a human label for every plan, including none', () => {
		for (const plan of UNDERGRADUATE_PLANS) {
			expect(typeof UNDERGRADUATE_PLAN_LABELS[plan]).toBe('string');
			expect(UNDERGRADUATE_PLAN_LABELS[plan].length).toBeGreaterThan(0);
		}
	});
});

describe('repaymentForLoan', () => {
	it('repays nothing at or below the threshold', () => {
		expect(repaymentForLoan(28_470, 'plan_2')).toBe(0);
		expect(repaymentForLoan(0, 'plan_2')).toBe(0);
		expect(repaymentForLoan(28_469, 'plan_2')).toBe(0);
	});

	it('repays 9% of the excess above a Plan 2 threshold, rounded down to the whole pound', () => {
		// £30,000 − £28,470 = £1,530; 9% of that is £137.70, which rounds down to £137.
		expect(repaymentForLoan(30_000, 'plan_2')).toBe(137);
	});

	it('repays 6% of the excess above the Postgraduate Loan threshold', () => {
		// £25,000 − £21,000 = £4,000; 6% is £240 exactly.
		expect(repaymentForLoan(25_000, 'postgraduate')).toBe(240);
	});

	it('rounds down rather than to the nearest pound', () => {
		// £21,999 − £21,000 = £999; 6% of that is £59.94, which rounds down to £59, not £60.
		expect(repaymentForLoan(21_999, 'postgraduate')).toBe(59);
	});

	it("returns 0 for 'none' or any unrecognised loan id", () => {
		expect(repaymentForLoan(100_000, 'none')).toBe(0);
		expect(repaymentForLoan(100_000, 'plan_3')).toBe(0);
		expect(repaymentForLoan(100_000, undefined)).toBe(0);
	});

	it('never returns a negative repayment for income below the threshold', () => {
		expect(repaymentForLoan(5_000, 'plan_1')).toBe(0);
	});
});

describe('studentLoanSummary — a single plan, no postgraduate loan', () => {
	it("has no active loans and repays nothing on 'none'", () => {
		const result = studentLoanSummary({ income: 60_000, plan: 'none' });

		expect(result.hasAnyLoan).toBe(false);
		expect(result.loans).toEqual([]);
		expect(result.totalRepayment).toBe(0);
		expect(result.monthlyRepayment).toBe(0);
		expect(result.weeklyRepayment).toBe(0);
	});

	it('reports one active loan below its threshold with 0 repayment and a headroom figure', () => {
		const result = studentLoanSummary({ income: 20_000, plan: 'plan_2' });

		expect(result.loans).toHaveLength(1);
		const [loan] = result.loans;
		expect(loan.id).toBe('plan_2');
		expect(loan.overThreshold).toBe(false);
		expect(loan.repayment).toBe(0);
		expect(loan.incomeOverThreshold).toBe(0);
		expect(loan.headroom).toBe(8_470);
		expect(result.totalRepayment).toBe(0);
	});

	it('reports the correct repayment and monthly/weekly split once over threshold', () => {
		// £40,000 on Plan 2: £11,530 over £28,470, 9% = £1,037.70 → £1,037.
		const result = studentLoanSummary({ income: 40_000, plan: 'plan_2' });

		expect(result.totalRepayment).toBe(1_037);
		expect(result.monthlyRepayment).toBe(Math.floor(1_037 / 12));
		expect(result.weeklyRepayment).toBe(Math.floor(1_037 / 52));
		expect(result.loans[0].overThreshold).toBe(true);
		expect(result.loans[0].incomeOverThreshold).toBe(11_530);
	});
});

describe('studentLoanSummary — combining an undergraduate plan with a Postgraduate Loan', () => {
	it('sums both repayments rather than merging the thresholds', () => {
		// £40,000, Plan 2 + PG: Plan 2 gives £1,037 (as above); PG is £19,000 over £21,000 → £1,140.
		const result = studentLoanSummary({ income: 40_000, plan: 'plan_2', postgraduate: true });

		expect(result.loans).toHaveLength(2);
		expect(result.loans.map((loan) => loan.id)).toEqual(['plan_2', 'postgraduate']);

		const plan2Only = repaymentForLoan(40_000, 'plan_2');
		const pgOnly = repaymentForLoan(40_000, 'postgraduate');
		expect(result.totalRepayment).toBe(plan2Only + pgOnly);
		expect(result.totalRepayment).not.toBe(
			// The wrong, merged-threshold answer this convention explicitly avoids.
			Math.floor(((40_000 - 21_000) * 15) / 100)
		);
	});

	it('is a Postgraduate-Loan-only summary when plan is none but postgraduate is true', () => {
		const result = studentLoanSummary({ income: 30_000, plan: 'none', postgraduate: true });

		expect(result.loans).toHaveLength(1);
		expect(result.loans[0].id).toBe('postgraduate');
		expect(result.totalRepayment).toBe(repaymentForLoan(30_000, 'postgraduate'));
	});

	it('combines the marginal rates of every active loan, and only the active ones', () => {
		// £40,000 is above both the Plan 2 (£28,470) and PG (£21,000) thresholds: 9% + 6% = 15%.
		const bothActive = studentLoanSummary({ income: 40_000, plan: 'plan_2', postgraduate: true });
		expect(bothActive.studentLoanMarginalRate).toBe(15);

		// £22,000 is above PG's threshold but below Plan 2's: only 6% applies.
		const onlyPgActive = studentLoanSummary({
			income: 22_000,
			plan: 'plan_2',
			postgraduate: true
		});
		expect(onlyPgActive.studentLoanMarginalRate).toBe(6);

		// £10,000 is below both: 0%.
		const neitherActive = studentLoanSummary({
			income: 10_000,
			plan: 'plan_2',
			postgraduate: true
		});
		expect(neitherActive.studentLoanMarginalRate).toBe(0);
	});
});

describe('studentLoanSummary — combined marginal rate and take-home', () => {
	it('adds tax.js’s own marginal rate to the student loan rate, matching each module separately', () => {
		const result = studentLoanSummary({
			income: 40_000,
			plan: 'plan_2',
			region: 'england_wales_ni'
		});

		expect(result.incomeTaxMarginalRate).toBe(marginalTaxRate(40_000, 'england_wales_ni'));
		expect(result.studentLoanMarginalRate).toBe(9);
		expect(result.combinedMarginalRate).toBe(
			result.incomeTaxMarginalRate + result.studentLoanMarginalRate
		);
	});

	it('reports 0% student loan marginal rate with no active loan, leaving the combined rate equal to tax.js’s', () => {
		const result = studentLoanSummary({ income: 40_000, plan: 'none' });

		expect(result.studentLoanMarginalRate).toBe(0);
		expect(result.combinedMarginalRate).toBe(result.incomeTaxMarginalRate);
	});

	it("take-home before repayment matches tax.js's own takeHomePay", () => {
		const result = studentLoanSummary({ income: 45_000, plan: 'plan_1', region: 'scotland' });

		expect(result.takeHomePay).toBe(takeHomePay(45_000, 'scotland'));
	});

	it('take-home after student loan is take-home less the total repayment', () => {
		const result = studentLoanSummary({ income: 45_000, plan: 'plan_1' });

		expect(result.takeHomeAfterStudentLoan).toBe(
			Math.round((result.takeHomePay - result.totalRepayment) * 100) / 100
		);
	});

	it('take-home after student loan equals take-home when there is no active loan', () => {
		const result = studentLoanSummary({ income: 45_000, plan: 'none' });

		expect(result.takeHomeAfterStudentLoan).toBe(result.takeHomePay);
	});
});

describe('studentLoanSummary — input tolerance', () => {
	it('treats a negative income as 0', () => {
		const result = studentLoanSummary({ income: -5_000, plan: 'plan_2' });
		expect(result.income).toBe(0);
		expect(result.totalRepayment).toBe(0);
	});

	it("defaults plan to 'none' and postgraduate to false when omitted", () => {
		const result = studentLoanSummary({ income: 50_000 });
		expect(result.plan).toBe('none');
		expect(result.postgraduate).toBe(false);
		expect(result.hasAnyLoan).toBe(false);
	});

	it('falls back to an unrecognised plan as none rather than throwing', () => {
		// Cast because the input type promises an `UndergraduatePlan`; the point of the assertion is
		// that a document with a bad stored plan value still calculates rather than throwing.
		const nonsensePlan = /** @type {any} */ ('plan_99');
		const result = studentLoanSummary({ income: 50_000, plan: nonsensePlan });
		expect(result.plan).toBe('none');
		expect(result.hasAnyLoan).toBe(false);
	});

	it('defaults the region the same tolerant way tax.js does', () => {
		const nonsenseRegion = /** @type {any} */ ('nowhere');
		const result = studentLoanSummary({
			income: 50_000,
			plan: 'plan_2',
			region: nonsenseRegion
		});
		expect(result.region).toBe('england_wales_ni');
	});
});
