<script>
	/**
	 * Student Loan repayments — README.md → "UK Income Tax Calculator (2026/27)": "Student Loan
	 * plans 1, 2, 4, 5, PG" (issue #26).
	 *
	 * Like `ChildBenefitCharge` and `MarriageAllowance`, this panel reads the salary and region from
	 * `TaxCalculator.svelte` rather than owning a second income field — repayments are worked on the
	 * same income the band table already shows. What it owns is the two facts `tax.js` cannot know:
	 * which undergraduate plan (if any) applies, and whether a Postgraduate Loan is also being
	 * repaid alongside it — `$lib/student-loan.js`'s convention that these are independent, since a
	 * borrower can hold both at once.
	 *
	 * The headline figure is the combined marginal rate: on Plan 2 above £28,470, the next pound is
	 * taxed at the income tax band rate *and* repaid at 9% — 29% rather than 20% for most basic-rate
	 * earners on that plan, the thing this card exists to make visible next to the band table above.
	 */
	import {
		ALL_STUDENT_LOAN_TYPES,
		studentLoanSummary,
		STUDENT_LOAN_TAX_YEAR,
		UNDERGRADUATE_PLAN_LABELS,
		UNDERGRADUATE_PLANS
	} from '$lib/student-loan.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 *   income?: number,
	 *   region?: import('$lib/enums.js').TaxRegion,
	 *   plan?: import('$lib/student-loan.js').UndergraduatePlan,
	 *   postgraduate?: boolean
	 * }}
	 */
	let {
		income = 0,
		region = 'england_wales_ni',
		plan: initialPlan = 'none',
		postgraduate: initialPostgraduate = false
	} = $props();

	// svelte-ignore state_referenced_locally
	let plan = $state(initialPlan);
	// svelte-ignore state_referenced_locally
	let postgraduate = $state(initialPostgraduate);

	const result = $derived(studentLoanSummary({ income, plan, postgraduate, region }));

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} rate @returns {string} e.g. "9%", "29%" */
	function formatRate(rate) {
		return `${Math.round(rate * 100) / 100}%`;
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Student Loan repayments, {STUDENT_LOAN_TAX_YEAR}</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Each plan repays 9% of income above its own threshold — 6% for a Postgraduate Loan — worked on
		the same salary as the band table above. An undergraduate plan and a Postgraduate Loan can both
		be active at once, each against its own threshold.
	</p>

	<div class="flex flex-wrap items-end gap-4 mb-4">
		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="sl-plan">Undergraduate plan</label>
			<select
				id="sl-plan"
				bind:value={plan}
				class="border border-input rounded-md px-2 py-1.5 text-sm"
			>
				{#each UNDERGRADUATE_PLANS as value (value)}
					<option {value}>{UNDERGRADUATE_PLAN_LABELS[value]}</option>
				{/each}
			</select>
		</div>

		<label class="flex items-center gap-2 text-sm pb-1.5" for="sl-postgraduate">
			<input
				id="sl-postgraduate"
				type="checkbox"
				bind:checked={postgraduate}
				class="h-4 w-4 accent-black"
			/>
			I also have a Postgraduate Loan
		</label>
	</div>

	{#if !result.hasAnyLoan}
		<p class="text-sm mb-3">
			<span class="font-medium">No Student Loan selected, so nothing is repaid here.</span>
			Choose a plan above, or tick the Postgraduate Loan box, to see what would come out of
			{formatMoney(income)}.
		</p>
	{:else}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Total repayment</div>
				<div class="text-xs text-muted-foreground mb-1">
					{result.loans.length === 1 ? 'one loan' : `${result.loans.length} loans, summed`}
				</div>
				<div class="text-xl font-semibold">{formatMoney(result.totalRepayment)}</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(result.monthlyRepayment)} a month
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">After income tax &amp; student loan</div>
				<div class="text-xs text-muted-foreground mb-1">still before National Insurance</div>
				<div class="text-xl font-semibold">{formatMoney(result.takeHomeAfterStudentLoan)}</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(result.takeHomePay)} before the repayment
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Marginal rate</div>
				<div class="text-xs text-muted-foreground mb-1">tax + student loan on your next pound</div>
				<div class="text-xl font-semibold">{formatRate(result.combinedMarginalRate)}</div>
				<div class="text-xs text-muted-foreground">
					{result.studentLoanMarginalRate > 0
						? `${formatRate(result.incomeTaxMarginalRate)} tax + ${formatRate(
								result.studentLoanMarginalRate
							)} repayment`
						: 'below every active threshold — tax alone'}
				</div>
			</div>
		</div>

		<table class="w-full text-sm border-collapse mb-3">
			<thead>
				<tr class="border-b border-border text-left">
					<th class="py-2 pr-2 font-medium">Loan</th>
					<th class="py-2 px-2 font-medium text-right">Rate</th>
					<th class="py-2 px-2 font-medium text-right">Threshold</th>
					<th class="py-2 pl-2 font-medium text-right">Repayment</th>
				</tr>
			</thead>
			<tbody>
				{#each result.loans as loan (loan.id)}
					<tr class="border-b border-border/60 {loan.overThreshold ? '' : 'text-muted-foreground'}">
						<td class="py-2 pr-2">{loan.label}</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatRate(loan.rate)}</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatMoney(loan.threshold)}</td>
						<td class="py-2 pl-2 text-right tabular-nums font-medium">
							{loan.overThreshold
								? formatMoney(loan.repayment)
								: `${formatMoney(loan.headroom)} to go`}
						</td>
					</tr>
				{/each}
			</tbody>
			{#if result.loans.length > 1}
				<tfoot>
					<tr class="border-t border-border font-medium">
						<td class="py-2 pr-2" colspan="3">Total</td>
						<td class="py-2 pl-2 text-right tabular-nums">{formatMoney(result.totalRepayment)}</td>
					</tr>
				</tfoot>
			{/if}
		</table>
	{/if}

	<details class="mb-3">
		<summary class="text-sm font-medium cursor-pointer select-none">All five plan types</summary>
		<table class="w-full text-sm border-collapse mt-2">
			<thead>
				<tr class="border-b border-border text-left">
					<th class="py-2 pr-2 font-medium">Plan</th>
					<th class="py-2 px-2 font-medium text-right">Rate</th>
					<th class="py-2 pl-2 font-medium text-right">Threshold</th>
				</tr>
			</thead>
			<tbody>
				{#each ALL_STUDENT_LOAN_TYPES as loanType (loanType.id)}
					<tr class="border-b border-border/60 text-muted-foreground">
						<td class="py-2 pr-2">{loanType.label}</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatRate(loanType.rate)}</td>
						<td class="py-2 pl-2 text-right tabular-nums">{formatMoney(loanType.threshold)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</details>

	<p class="text-xs text-muted-foreground">
		Illustrative only, not financial advice. {STUDENT_LOAN_TAX_YEAR} figures, best-known thresholds —
		see the module's sourcing note for how to check them against gov.uk. Repayments are worked out on
		the whole year's income at once; a real payslip calculates and rounds each pay period separately,
		so the annual total here can differ by a few pounds from what actually gets deducted if your pay varies
		through the year. Choosing the wrong plan is easy to do by accident — check your plan type on your
		student loan account at gov.uk if you're not sure. Nothing here is saved between visits, the same
		as the rest of this tab.
	</p>
</Card>
