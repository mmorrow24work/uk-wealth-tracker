/**
 * Server-rendered smoke tests for the Student Loan repayment panel (issue #26).
 *
 * Same approach and same limits as `ChildBenefitCharge.test.js`: `svelte/server`'s `render` gives
 * the panel's *initial* markup, which is enough to assert the sentences a user actually reads at a
 * given income and plan. It cannot assert what happens after an input event — the arithmetic behind
 * every update is covered directly in `$lib/student-loan.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import StudentLoanRepayment from './StudentLoanRepayment.svelte';

/**
 * The rendered markup as plain text, so an assertion reads the sentence a user reads rather than
 * the tags around it.
 *
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(StudentLoanRepayment, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ');
}

describe('StudentLoanRepayment', () => {
	it('names the tax year', () => {
		const body = text({ income: 40_000 });

		expect(body).toContain('2026/27');
	});

	it('shows nothing to repay when no plan is selected', () => {
		const body = text({ income: 40_000 });

		expect(body).toContain('No Student Loan selected, so nothing is repaid here');
	});

	it('shows a Plan 2 repayment above its threshold', () => {
		const body = text({ income: 40_000, plan: 'plan_2' });

		// £11,530 over £28,470 at 9% = £1,037.70, rounded down to £1,037.
		expect(body).toContain('£1,037');
		expect(body).toContain('£28,470');
	});

	it('shows no repayment, and headroom, below the threshold', () => {
		const body = text({ income: 20_000, plan: 'plan_2' });

		expect(body).toContain('£8,470');
		expect(body).toContain('to go');
	});

	it('sums an undergraduate plan and a Postgraduate Loan as two separate rows', () => {
		const body = text({ income: 40_000, plan: 'plan_2', postgraduate: true });

		expect(body).toContain('Plan 2');
		expect(body).toContain('Postgraduate Loan');
		expect(body).toContain('2 loans, summed');
		// £1,037 (Plan 2) + £1,140 (PG: £19,000 over £21,000 at 6%) = £2,177.
		expect(body).toContain('£2,177');
	});

	it('reports the combined marginal rate as tax plus the active repayment rate', () => {
		const body = text({ income: 40_000, plan: 'plan_2', region: 'england_wales_ni' });

		// 20% basic rate + 9% Plan 2 = 29%.
		expect(body).toContain('29%');
		expect(body).toContain('20% tax');
		expect(body).toContain('9% repayment');
	});

	it('lists all five plan types for reference regardless of which is selected', () => {
		const body = text({ income: 40_000, plan: 'plan_2' });

		expect(body).toContain('Plan 1');
		expect(body).toContain('Plan 2');
		expect(body).toContain('Plan 4');
		expect(body).toContain('Plan 5');
		expect(body).toContain('Postgraduate Loan');
	});

	it('says it is not financial advice and notes the annual-vs-payroll rounding gap', () => {
		const body = text({ income: 40_000, plan: 'plan_2' });

		expect(body).toContain('not financial advice');
		expect(body).toContain('pay period');
	});
});
