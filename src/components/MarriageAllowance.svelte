<script>
	/**
	 * Marriage Allowance — README.md → "UK Income Tax Calculator (2026/27)": "Marriage Allowance"
	 * (issue #25).
	 *
	 * Like `ChildBenefitCharge`, this panel reads the salary and region from `TaxCalculator.svelte`
	 * rather than owning a second income field — the transfer is worked on the *same* two incomes
	 * the band table and the Child Benefit card already show. What it owns is the one fact neither of
	 * those knows: what a partner earns. That field is `bind:`-shared with `ChildBenefitCharge`
	 * (`TaxCalculator` holds the single `partnerIncome` value both cards read and write), so a
	 * partner's income is typed once rather than twice on the same tab.
	 *
	 * Marriage Allowance additionally requires something Child Benefit does not: being married or in
	 * a civil partnership. `$lib/marriage-allowance.js`'s eligibility rules apply to *any* pair of
	 * incomes, so without a gate for that a `partnerIncome` of `0` left at its "no partner" default
	 * (see `ChildBenefitCharge`'s own convention) would read as a non-earning spouse and show a false
	 * £252 saving to someone who has no partner at all. The `married` checkbox exists to prevent
	 * exactly that — it defaults to unchecked, so the panel says nothing numeric until the user
	 * opts in.
	 *
	 * The lower earner is always treated as the one transferring allowance to the other, since that
	 * is the only direction the rules ever pay out on (`marriageAllowanceSummary` fails eligibility
	 * on the recipient side otherwise) — the panel works out which of "you"/"your partner" that is
	 * from the two incomes rather than asking the user to say.
	 */
	import {
		higherRateThreshold,
		MARRIAGE_ALLOWANCE_RATE,
		MARRIAGE_ALLOWANCE_TAX_YEAR,
		MARRIAGE_ALLOWANCE_TRANSFER,
		marriageAllowanceSummary
	} from '$lib/marriage-allowance.js';
	import { PERSONAL_ALLOWANCE } from '$lib/tax.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 *   income?: number,
	 *   region?: import('$lib/enums.js').TaxRegion,
	 *   partnerIncome?: number,
	 *   married?: boolean,
	 *   claiming?: boolean
	 * }}
	 */
	let {
		income = 0,
		region = 'england_wales_ni',
		partnerIncome = $bindable(0),
		married: initialMarried = false,
		claiming: initialClaiming = true
	} = $props();

	// svelte-ignore state_referenced_locally
	let married = $state(initialMarried);
	// svelte-ignore state_referenced_locally
	let claiming = $state(initialClaiming);

	/**
	 * `bind:value` on a number input hands back a number, or `null` once the field is cleared — the
	 * same tolerant parse `TaxCalculator`/`ChildBenefitCharge` use on their income fields.
	 *
	 * @param {unknown} value
	 * @param {number} fallback
	 * @returns {number}
	 */
	function parse(value, fallback) {
		if (value === null || value === undefined || value === '') return fallback;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	const partnerAmount = $derived(Math.max(0, parse(partnerIncome, 0)));

	/** The lower of the two incomes always transfers — the only direction the rules pay out on. */
	const youAreTransferor = $derived(income <= partnerAmount);
	const transferorIncome = $derived(youAreTransferor ? income : partnerAmount);
	const recipientIncome = $derived(youAreTransferor ? partnerAmount : income);

	const result = $derived(
		marriageAllowanceSummary({
			transferorIncome,
			recipientIncome,
			region,
			claiming: married && claiming
		})
	);

	/** Same household with the transfer switched back on — the "what would it be worth" counterfactual. */
	const ifClaiming = $derived(
		marriageAllowanceSummary({
			transferorIncome,
			recipientIncome,
			region,
			claiming: true
		})
	);

	const transferorLabel = $derived(youAreTransferor ? 'You' : 'Your partner');
	const recipientLabel = $derived(youAreTransferor ? 'your partner' : 'you');

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});
	const penceFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} amount */
	function formatExact(amount) {
		return penceFormatter.format(amount);
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Marriage Allowance, {MARRIAGE_ALLOWANCE_TAX_YEAR}</h2>
	<p class="text-sm text-muted-foreground mb-4">
		A spouse or civil partner who doesn't use all of their {formatMoney(PERSONAL_ALLOWANCE)} Personal
		Allowance can transfer {formatMoney(MARRIAGE_ALLOWANCE_TRANSFER)} of it to the other, who gets a flat
		{MARRIAGE_ALLOWANCE_RATE}% reduction on their own tax bill in return — worth up to {formatMoney(
			(MARRIAGE_ALLOWANCE_TRANSFER * MARRIAGE_ALLOWANCE_RATE) / 100
		)} a year. It works on the same two incomes as the Child Benefit card below: yours from the salary
		field above, and your partner's from the field here.
	</p>

	<div class="flex flex-wrap items-end gap-4 mb-4">
		<label class="flex items-center gap-2 text-sm pb-1.5" for="ma-married">
			<input id="ma-married" type="checkbox" bind:checked={married} class="h-4 w-4 accent-black" />
			We're married or in a civil partnership
		</label>

		{#if married}
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="ma-partner-income">Partner's income (£)</label>
				<input
					id="ma-partner-income"
					type="number"
					min="0"
					step="500"
					bind:value={partnerIncome}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<label class="flex items-center gap-2 text-sm pb-1.5" for="ma-claiming">
				<input
					id="ma-claiming"
					type="checkbox"
					bind:checked={claiming}
					class="h-4 w-4 accent-black"
				/>
				We've applied for the transfer
			</label>
		{/if}
	</div>

	{#if !married}
		<p class="text-sm mb-3">
			<span class="font-medium">Only available to spouses and civil partners.</span>
			Unmarried couples, however long they've lived together, can't use Marriage Allowance — it's one
			of the few UK tax rules that still turns on marital status rather than the household. Tick the box
			above if that's your situation to see what it could be worth.
		</p>
	{:else if !result.eligible}
		<p class="text-sm mb-3">
			{#if !result.transferorEligible && !result.recipientEligible}
				<span class="font-medium">Neither of you qualifies.</span>
				{transferorLabel} would need to be the lower earner and below {formatMoney(
					PERSONAL_ALLOWANCE
				)}, but the lower income here is {formatMoney(transferorIncome)} — over the Personal Allowance
				already, which makes {transferorLabel === 'You' ? 'you' : 'them'} a taxpayer in your own right
				with nothing spare to transfer.
			{:else if !result.transferorEligible}
				<span class="font-medium">
					{transferorLabel}
					{transferorLabel === 'You' ? "don't" : "doesn't"} have anything spare to transfer.
				</span>
				Marriage Allowance needs the lower earner's income below {formatMoney(PERSONAL_ALLOWANCE)} —
				{formatMoney(transferorIncome)} is already over it, which makes {transferorLabel === 'You'
					? 'you'
					: 'them'} a taxpayer in your own right with no unused allowance to give away.
			{:else}
				<span class="font-medium">
					{recipientLabel === 'you' ? 'You already pay' : 'Your partner already pays'} higher-rate tax.
				</span>
				The transfer is only for a recipient who isn't a higher (or, in Scotland, higher/advanced/top)
				rate taxpayer — that boundary is {formatMoney(higherRateThreshold(region))} here, and {formatMoney(
					recipientIncome
				)} is over it.
			{/if}
		</p>
	{:else if !claiming}
		<p class="text-sm mb-3">
			<span class="font-medium">You qualify, but haven't applied.</span>
			Marriage Allowance isn't automatic — {transferorLabel === 'You' ? 'you' : 'your partner'} has to
			apply, and once granted it renews automatically each year until either of you cancels it or your
			circumstances change.
		</p>
		<p class="text-sm mb-3">
			{#if ifClaiming.netHouseholdBenefit <= 0}
				Applying wouldn't help here: the {formatMoney(ifClaiming.recipientTaxReduction)}
				{recipientLabel === 'you' ? 'you' : 'your partner'} would save is cancelled out by the
				{formatMoney(ifClaiming.transferorExtraTax)} of extra tax
				{transferorLabel === 'You' ? 'you would' : 'they would'} pay on the allowance given up.
			{:else}
				Applying would be worth {formatMoney(ifClaiming.netHouseholdBenefit)} a year to the two of you
				together — {formatMoney(ifClaiming.recipientTaxReduction)} off {recipientLabel === 'you'
					? 'your'
					: "your partner's"} bill{ifClaiming.transferorExtraTax > 0
					? `, less the ${formatMoney(ifClaiming.transferorExtraTax)} of extra tax ${
							transferorLabel === 'You' ? 'you would' : 'they would'
						} pay`
					: ''}.
			{/if}
		</p>
	{:else}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Allowance transferred</div>
				<div class="text-xs text-muted-foreground mb-1">
					{transferorLabel}
					{transferorLabel === 'You' ? 'give' : 'gives'} up this much
				</div>
				<div class="text-xl font-semibold">{formatMoney(result.transferAmount)}</div>
				<div class="text-xs text-muted-foreground">
					down to {formatMoney(result.transferorNewAllowance)} of allowance
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">
					Extra tax, {transferorLabel === 'You' ? 'you' : 'them'}
				</div>
				<div class="text-xs text-muted-foreground mb-1">from the reduced allowance</div>
				<div class="text-xl font-semibold">{formatMoney(result.transferorExtraTax)}</div>
				<div class="text-xs text-muted-foreground">
					{result.transferorExtraTax === 0 ? 'still fully under the allowance' : 'pushed into tax'}
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Saving, {recipientLabel}</div>
				<div class="text-xs text-muted-foreground mb-1">
					{MARRIAGE_ALLOWANCE_RATE}% of the transfer, capped at what's owed
				</div>
				<div class="text-xl font-semibold">{formatMoney(result.recipientTaxReduction)}</div>
				<div class="text-xs text-muted-foreground">
					{result.recipientTaxReduction < (result.transferAmount * MARRIAGE_ALLOWANCE_RATE) / 100
						? 'capped by the tax owed'
						: 'the full fixed reduction'}
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Net benefit</div>
				<div class="text-xs text-muted-foreground mb-1">the two of you together</div>
				<div class="text-xl font-semibold">{formatMoney(result.netHouseholdBenefit)}</div>
				<div class="text-xs text-muted-foreground">
					{formatExact(result.netHouseholdBenefit / 12)} a month on average
				</div>
			</div>
		</div>

		<p class="text-sm mb-3">
			{transferorLabel}
			{transferorLabel === 'You' ? 'earn' : 'earns'}
			{formatMoney(transferorIncome)}, under the {formatMoney(PERSONAL_ALLOWANCE)} Personal Allowance,
			and {recipientLabel}
			{recipientLabel === 'you' ? 'earn' : 'earns'}
			{formatMoney(recipientIncome)}, under the {formatMoney(result.higherRateThreshold)} higher-rate
			boundary — so the transfer applies. {#if result.netHouseholdBenefit > 0}The household keeps {formatMoney(
					result.netHouseholdBenefit
				)} of it a year that would otherwise have gone to HMRC.{:else}It nets out to nothing this
				year, though it costs nothing to keep the claim in place for a year the incomes move.{/if}
		</p>
	{/if}

	<p class="text-xs text-muted-foreground">
		Illustrative only, not financial advice. {MARRIAGE_ALLOWANCE_TAX_YEAR} figures. The lower earner is
		always treated as the one transferring — the rules only pay out in that direction. Marriage Allowance
		and the Child Benefit card below both ask what a partner earns; enter it once and both use it. Nothing
		here is saved between visits, the same as the rest of this tab.
	</p>
</Card>
