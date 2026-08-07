<script>
	/**
	 * Child Benefit and the High Income Child Benefit Charge — README.md → "UK Income Tax Calculator
	 * (2026/27)": "High Income Child Benefit Charge (HICBC) — post-April 2024 rules (£60k threshold,
	 * £80k full clawback)" (issue #24).
	 *
	 * The panel sits under the income tax ladder and reads the *same* salary: HICBC is assessed on
	 * adjusted net income, so a charge shown against a different income than the one the bands were
	 * worked on would be two answers to one question. That is why `income` and `region` arrive as
	 * props from `TaxCalculator.svelte` rather than this panel owning a second salary field.
	 *
	 * What it does own is everything `tax.js` cannot know: how many children are claimed for and
	 * whether the payments are actually being taken. What a partner earns is different again — it
	 * matters here (the charge falls on whichever of a couple has the higher income, not on the
	 * claimant and not on the household) *and* to `MarriageAllowance.svelte` alongside this panel
	 * (issue #25), so `partnerIncome` is `bindable` and `TaxCalculator` holds the one value both
	 * panels read and write, rather than each asking the same question separately. None of it is
	 * persisted; `Profile` has no children and no partner (README.md's data model lists neither, and
	 * household planning is Phase 2), so these are session-only, as the salary above already is.
	 *
	 * The figure the tab exists to surface is the marginal rate: a two-child family on £70,000 is
	 * losing 51.7% of the next £200, not the 40% the band table shows.
	 */
	import {
		childBenefitSummary,
		HICBC_FULL_CLAWBACK_AT,
		HICBC_INCOME_PER_PERCENT,
		HICBC_TAX_YEAR,
		HICBC_THRESHOLD
	} from '$lib/hicbc.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 *   income?: number,
	 *   region?: import('$lib/enums.js').TaxRegion,
	 *   children?: number,
	 *   partnerIncome?: number,
	 *   claiming?: boolean
	 * }}
	 */
	let {
		income = 0,
		region = 'england_wales_ni',
		children: initialChildren = 1,
		partnerIncome = $bindable(0),
		claiming: initialClaiming = true
	} = $props();

	/** More than this is a data-entry slip rather than a family — the inputs cap rather than reject. */
	const MAX_CHILDREN = 12;

	// svelte-ignore state_referenced_locally
	let children = $state(initialChildren);
	// svelte-ignore state_referenced_locally
	let claiming = $state(initialClaiming);

	/**
	 * `bind:value` on a number input hands back a number, or `null` once the field is cleared — the
	 * same tolerant parse `TaxCalculator` uses on the salary.
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

	const childCount = $derived(Math.min(MAX_CHILDREN, Math.max(0, Math.floor(parse(children, 0)))));
	const partnerAmount = $derived(Math.max(0, parse(partnerIncome, 0)));

	const result = $derived(
		childBenefitSummary({
			income,
			partnerIncome: partnerAmount,
			children: childCount,
			claiming,
			region
		})
	);

	/**
	 * The same household with the payments switched back on. Opting out is the one control here whose
	 * whole point is the comparison — "what would taking the money be worth, net of the charge?" — and
	 * the answer is never negative below {@link HICBC_FULL_CLAWBACK_AT}, which is worth showing rather
	 * than asserting.
	 */
	const ifClaiming = $derived(
		childBenefitSummary({
			income,
			partnerIncome: partnerAmount,
			children: childCount,
			claiming: true,
			region
		})
	);

	/** Which of the two incomes the charge is actually being worked on — theirs, or yours. */
	const bearerLabel = $derived(result.bearer === 'partner' ? 'Your partner' : 'You');

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

	/** @param {number} rate @returns {string} e.g. "50%", "51.69%" */
	function formatRate(rate) {
		return `${Math.round(rate * 100) / 100}%`;
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Child Benefit &amp; the HICBC, {HICBC_TAX_YEAR}</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Child Benefit isn't means-tested, but once the higher earner in a couple passes {formatMoney(
			HICBC_THRESHOLD
		)} of adjusted net income, a separate charge starts clawing it back — 1% of the year's benefit for
		every {formatMoney(HICBC_INCOME_PER_PERCENT)} above, all of it by {formatMoney(
			HICBC_FULL_CLAWBACK_AT
		)}. It is worked on the same income as the bands above, so change the salary there to see this
		move.
	</p>

	<div class="flex flex-wrap items-end gap-4 mb-4">
		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="cb-children">Children claimed for</label>
			<input
				id="cb-children"
				type="number"
				min="0"
				max={MAX_CHILDREN}
				step="1"
				bind:value={children}
				class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
			/>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="cb-partner-income">Partner's income (£)</label>
			<input
				id="cb-partner-income"
				type="number"
				min="0"
				step="500"
				bind:value={partnerIncome}
				class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
			/>
			<span class="text-xs text-muted-foreground">0 if you have no partner</span>
		</div>

		<label class="flex items-center gap-2 text-sm pb-1.5" for="cb-claiming">
			<input
				id="cb-claiming"
				type="checkbox"
				bind:checked={claiming}
				class="h-4 w-4 accent-black"
			/>
			We take the payments
		</label>
	</div>

	{#if childCount === 0}
		<p class="text-sm mb-3">
			<span class="font-medium">No Child Benefit, so no charge.</span>
			Set how many children you claim for above. The charge is only ever a share of benefit actually received
			— no claim, nothing to claw back, whatever anyone earns.
		</p>
	{:else if !claiming}
		<p class="text-sm mb-3">
			<span class="font-medium">The payments are stopped, so there's no charge.</span>
			Keeping the claim itself is still worth doing: it's the claim, not the money, that earns the parent
			at home National Insurance credits towards their State Pension and gets the child a National Insurance
			number at 16.
		</p>
		<p class="text-sm mb-3">
			{#if ifClaiming.netBenefit === 0}
				Taking the payments would be neutral at this income: {formatMoney(ifClaiming.annualBenefit)} of
				Child Benefit would come in and the whole of it would go back out as the charge.
			{:else}
				Taking them would be worth {formatMoney(ifClaiming.netBenefit)} a year —
				{formatMoney(ifClaiming.annualBenefit)} of Child Benefit less a {formatMoney(
					ifClaiming.charge
				)} charge. The charge is only ever a share of the benefit, so claiming is never a loss below
				{formatMoney(HICBC_FULL_CLAWBACK_AT)}.
			{/if}
		</p>
	{:else}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Child Benefit</div>
				<div class="text-xs text-muted-foreground mb-1">
					for {childCount}
					{childCount === 1 ? 'child' : 'children'}
				</div>
				<div class="text-xl font-semibold">{formatMoney(result.annualBenefit)}</div>
				<div class="text-xs text-muted-foreground">
					{formatExact(result.perPaymentBenefit)} every 4 weeks
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">The charge</div>
				<div class="text-xs text-muted-foreground mb-1">
					{result.percentage}% of the year's benefit
				</div>
				<div class="text-xl font-semibold">{formatMoney(result.charge)}</div>
				<div class="text-xs text-muted-foreground">
					{result.bearer === 'neither'
						? 'nobody is over the threshold'
						: `on ${result.bearer === 'partner' ? "your partner's" : 'your'} ${formatMoney(result.chargeIncome)}`}
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">What you keep</div>
				<div class="text-xs text-muted-foreground mb-1">benefit after the charge</div>
				<div class="text-xl font-semibold">{formatMoney(result.netBenefit)}</div>
				<div class="text-xs text-muted-foreground">
					{result.netBenefit === 0
						? 'the clawback is complete'
						: `${formatExact(result.netBenefit / 12)} a month on average`}
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Your marginal rate</div>
				<div class="text-xs text-muted-foreground mb-1">with the charge included</div>
				<div class="text-xl font-semibold">{formatRate(result.combinedMarginalRate)}</div>
				<div class="text-xs text-muted-foreground">
					{result.hicbcMarginalRate > 0
						? `${formatRate(result.incomeTaxMarginalRate)} tax + ${formatRate(
								result.hicbcMarginalRate
							)} clawback`
						: 'income tax alone — the charge adds nothing here'}
				</div>
			</div>
		</div>

		{#if result.bearer === 'neither'}
			<p class="text-sm mb-3">
				<span class="font-medium">No charge — you keep all of it.</span>
				The higher of the two incomes is {formatMoney(
					Math.max(result.income, result.partnerIncome)
				)}, which is {formatMoney(result.headroom)} short of the {formatMoney(HICBC_THRESHOLD)} threshold.
				Earn more than that and the clawback starts.
			</p>
		{:else if result.fullyClawedBack}
			<p class="text-sm mb-3">
				<span class="font-medium">The charge now cancels the benefit out entirely.</span>
				{bearerLabel}
				{result.bearer === 'partner' ? 'earns' : 'earn'}
				{formatMoney(result.chargeIncome)}, at or above the {formatMoney(HICBC_FULL_CLAWBACK_AT)} point
				where the clawback reaches 100%, so {formatMoney(result.annualBenefit)} comes in and {formatMoney(
					result.charge
				)} goes back out. Claiming is still worth doing — you can keep the claim and stop the payments,
				which leaves the National Insurance credits and the child's NI number intact with nothing to pay.
			</p>
		{:else}
			<p class="text-sm mb-3">
				<span class="font-medium">
					{result.percentage}% of your Child Benefit is being charged back.
				</span>
				{bearerLabel}
				{result.bearer === 'partner' ? 'earns' : 'earn'}
				{formatMoney(result.chargeIncome)}, which is {formatMoney(
					result.chargeIncome - HICBC_THRESHOLD
				)} over the threshold — one point of clawback for each complete {formatMoney(
					HICBC_INCOME_PER_PERCENT
				)}. Bringing that income down by {formatMoney(result.incomeToClearCharge)}, with a pension
				contribution, salary sacrifice or Gift Aid, would clear the charge completely and hand back
				the {formatMoney(result.charge)} it costs this year.
			</p>
			{#if result.hicbcMarginalRate > 0}
				<p class="text-sm mb-3">
					That is what makes your real marginal rate {formatRate(result.combinedMarginalRate)} rather
					than the {formatRate(result.incomeTaxMarginalRate)} the band table shows: each extra {formatMoney(
						HICBC_INCOME_PER_PERCENT
					)} you earn is taxed <em>and</em> costs another 1% of the benefit. The percentage is a
					whole number, so it moves in steps — the charge doesn't change at all until your income
					crosses the next {formatMoney(HICBC_INCOME_PER_PERCENT)}.
				</p>
			{/if}
		{/if}

		{#if result.bearer === 'partner'}
			<p class="text-sm text-muted-foreground mb-3">
				The charge follows the higher income, not the claim and not the household — so it lands on
				your partner's tax return, not yours, and the {formatMoney(result.takeHomeAfterCharge)} above
				the band table is untouched by it.
			</p>
		{:else if result.liable}
			<p class="text-sm text-muted-foreground mb-3">
				Taking the charge off leaves you {formatMoney(result.takeHomeAfterCharge)} of your own income
				for the year, before National Insurance and any student loan.
			</p>
		{/if}
	{/if}

	<p class="text-xs text-muted-foreground">
		Illustrative only, not financial advice. {HICBC_TAX_YEAR} figures, post-April-2024 rules. The charge
		is assessed on <em>adjusted net income</em> — gross pay less pension contributions given relief at
		source, salary sacrifice and Gift Aid — so enter incomes already net of those. It is a charge on one
		person, collected through their own tax return (or PAYE code), even when someone else receives the
		money; where both partners earn the same, HMRC settles which of them pays by reference to who claims,
		which this app doesn't track. Child Benefit's own claim/opt-out rules beyond what's above — who can
		claim, and the interaction with a parent's National Insurance credits — remain open. Marriage Allowance,
		which shares the partner income field above, is the card below this one.
	</p>
</Card>
