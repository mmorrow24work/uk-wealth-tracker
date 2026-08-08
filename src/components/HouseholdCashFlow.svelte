<script>
	/**
	 * Household cash flow — README.md → "Household / Partner Planning": "Household budget and cash
	 * flow" (issue #145). Both partners' take-home income, set against the budget `BudgetTracker`
	 * (above, on this same tab) manages — `$lib/budget.js`'s `householdCashFlow` is the whole of the
	 * arithmetic; this component only presents it.
	 *
	 * Read-only, like `DefinedBenefitIncome`/`PensionTaxRelief`/`RetirementIncomeStreams` on the
	 * Pensions tab: `profile`/`partner`/`budget` are plain props, never `bind:`, since this card
	 * reaches into data two other tabs (Settings, and #170's still-unbuilt partner entry form) own —
	 * it has nothing of its own to write back.
	 *
	 * `partner` is `null` for the common case — no partner recorded, or #170's entry form not yet
	 * used to add one — and this renders that state honestly (a note, not a zeroed-out "Partner" row
	 * that looks like a real answer of £0) rather than pretending a single-income household is a
	 * household of two earning nothing each.
	 */
	import { householdCashFlow } from '$lib/budget.js';
	import { createProfile } from '$lib/model.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 * 	profile?: import('$lib/types.js').Profile,
	 * 	partner?: import('$lib/types.js').Partner | null,
	 * 	budget?: import('$lib/types.js').Budget
	 * }}
	 */
	let {
		profile = createProfile(),
		partner = null,
		budget = { categories: [], bills: [], line_items: [] }
	} = $props();

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});
	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	const cashFlow = $derived(householdCashFlow({ profile, partner, budget }));
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Household cash flow</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Take-home income (income tax only — National Insurance and Student Loan repayments are not
		modelled) against this budget's outgoings, per month.
	</p>

	<div class="flex flex-wrap gap-4 text-sm mb-4">
		<span>You: <span class="font-medium">{formatMoney(cashFlow.you)}</span>/mo</span>
		{#if partner}
			<span>
				{partner.name.trim() === '' ? 'Partner' : partner.name}:
				<span class="font-medium">{formatMoney(cashFlow.partner)}</span>/mo
			</span>
		{/if}
		<span>Household income: <span class="font-medium">{formatMoney(cashFlow.income)}</span>/mo</span
		>
		<span>Outgoings: <span class="font-medium">{formatMoney(cashFlow.outgoings)}</span>/mo</span>
	</div>

	{#if !partner}
		<p class="text-sm text-muted-foreground mb-4">
			No partner recorded — this is your income alone. Add a partner on Settings to include theirs.
		</p>
	{/if}

	<div class="flex items-center gap-3">
		<span class="text-2xl font-semibold {cashFlow.net < 0 ? 'text-red-600' : 'text-green-700'}">
			{formatMoney(cashFlow.net)}/mo
		</span>
		<span class="text-sm text-muted-foreground">
			{cashFlow.net < 0 ? 'projected shortfall' : 'left after outgoings'}
			{#if cashFlow.savingsRatePct !== null}
				· {cashFlow.savingsRatePct.toFixed(1)}% of income
			{/if}
		</span>
	</div>
</Card>
