<script>
	/**
	 * Salary sacrifice, and what it is worth against the 60% personal allowance taper — README.md →
	 * "UK Income Tax Calculator (2026/27)": "Salary sacrifice" and "60% personal allowance taper
	 * (£100k–£125,140)" (issue #27).
	 *
	 * The sacrifice amount itself is *not* owned here. It sits next to the salary in
	 * `TaxCalculator.svelte`, because unlike this tab's other card-local inputs (children, a plan
	 * type, whether you're married) it changes every figure in the card above it: sacrificed pay is
	 * never the employee's income, so the band table, the effective rate, the High Income Child
	 * Benefit Charge and Student Loan repayments are all worked on what's left. Putting the control
	 * beside the salary keeps "the income these figures are about" in one place; this panel is the
	 * explanation of what that control bought, and takes it as a `$bindable` prop so its one action —
	 * "sacrifice exactly enough to clear the taper" — can write back to it.
	 *
	 * The figure the panel exists to surface is the cost, not the saving: inside the taper band a
	 * pound into the pension costs 40p of take-home in England/Wales/NI (32.5p in Scotland), because
	 * the other 60p was going to HMRC either way. The slice table underneath shows that rate changing
	 * as the sacrifice eats down through the bands, which is the part a single "you'd save £X" number
	 * hides.
	 */
	import {
		PENSION_ANNUAL_ALLOWANCE,
		SALARY_SACRIFICE_TAX_YEAR,
		salarySacrificeSummary
	} from '$lib/salary-sacrifice.js';
	import {
		ALLOWANCE_EXHAUSTED_AT,
		ALLOWANCE_TAPER_THRESHOLD,
		marginalTaxRate,
		PERSONAL_ALLOWANCE
	} from '$lib/tax.js';
	import Button from './ui/button.svelte';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 *   salary?: number,
	 *   sacrifice?: number,
	 *   region?: import('$lib/enums.js').TaxRegion
	 * }}
	 */
	let { salary = 0, sacrifice = $bindable(0), region = 'england_wales_ni' } = $props();

	const result = $derived(salarySacrificeSummary({ salary, sacrifice, region }));

	/** The taper is only worth talking about for a salary that actually reaches it. */
	const taperIsRelevant = $derived(salary > ALLOWANCE_TAPER_THRESHOLD);

	/**
	 * The rate a pound sacrificed out of the taper band is relieved at — 60% in England/Wales/NI,
	 * 67.5% in Scotland. Read off `tax.js`'s own marginal rate at the middle of the band rather than
	 * written into the copy, so the two can't disagree if a rate ever moves.
	 */
	const taperReliefRate = $derived(
		marginalTaxRate((ALLOWANCE_TAPER_THRESHOLD + ALLOWANCE_EXHAUSTED_AT) / 2, region)
	);

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

	/** @param {number} rate @returns {string} e.g. "40%", "67.5%" */
	function formatRate(rate) {
		return `${Math.round(rate * 100) / 100}%`;
	}

	/** Sacrifice exactly enough to bring the salary back to £100,000 — the panel's one action. */
	function clearTaper() {
		sacrifice = result.taper.sacrificeToClear;
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Salary sacrifice, {SALARY_SACRIFICE_TAX_YEAR}</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Sacrificed pay never counts as your income, so it is the reduced salary — not the original one —
		that the bands above, the personal allowance taper, the Child Benefit charge and any Student
		Loan repayment are all worked out on. Set the amount beside your salary at the top of this tab;
		this card explains what it bought.
	</p>

	{#if result.sacrifice === 0}
		<p class="text-sm mb-3">
			<span class="font-medium"
				>Nothing sacrificed, so every figure on this tab is your full {formatMoney(
					result.salary
				)}.</span
			>
			{#if taperIsRelevant}
				You're above {formatMoney(ALLOWANCE_TAPER_THRESHOLD)}, so
				{result.taper.allowanceBefore === 0
					? 'your personal allowance has gone entirely'
					: `${formatMoney(result.taper.allowanceBefore)} of your ${formatMoney(
							PERSONAL_ALLOWANCE
						)} allowance is left`} — see below for what sacrificing would be worth.
			{:else}
				Each pound you give up would avoid tax at {formatRate(result.marginalRateBefore)}, your
				current marginal rate, and land in your pension in full.
			{/if}
		</p>
	{:else}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Into your pension</div>
				<div class="text-xs text-muted-foreground mb-1">
					{formatRate(result.sacrificePct)} of your salary
				</div>
				<div class="text-xl font-semibold">{formatMoney(result.sacrifice)}</div>
				<div class="text-xs text-muted-foreground">
					no tax on the way in, nothing to reclaim later
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Income tax saved</div>
				<div class="text-xs text-muted-foreground mb-1">
					{formatMoney(result.before.totalTax)} → {formatMoney(result.after.totalTax)}
				</div>
				<div class="text-xl font-semibold">{formatMoney(result.taxSaved)}</div>
				<div class="text-xs text-muted-foreground">before any National Insurance saving</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">What it costs you</div>
				<div class="text-xs text-muted-foreground mb-1">the fall in your take-home pay</div>
				<div class="text-xl font-semibold">{formatMoney(result.netCost)}</div>
				<div class="text-xs text-muted-foreground">
					{formatExact(result.costPerPound)} per £1 in the pot
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Effective relief</div>
				<div class="text-xs text-muted-foreground mb-1">share of it paid for by tax saved</div>
				<div class="text-xl font-semibold">{formatRate(result.effectiveReliefRate)}</div>
				<div class="text-xs text-muted-foreground">
					marginal rate now {formatRate(result.marginalRateAfter)}, was {formatRate(
						result.marginalRateBefore
					)}
				</div>
			</div>
		</div>

		<h3 class="text-sm font-semibold mb-1">Where the sacrifice came from</h3>
		<p class="text-xs text-muted-foreground mb-2">
			The last pound you earn is the first one you give up, so a sacrifice is relieved from the top
			down — and the rate changes as it eats through each band. Ranges are gross salary, not the
			after-allowance figures the band table above uses.
		</p>
		<table class="w-full text-sm border-collapse mb-3">
			<thead>
				<tr class="border-b border-border text-left">
					<th class="py-2 pr-2 font-medium">Slice of salary</th>
					<th class="py-2 px-2 font-medium text-right">Relieved at</th>
					<th class="py-2 px-2 font-medium text-right">Sacrificed</th>
					<th class="py-2 px-2 font-medium text-right">Tax saved</th>
					<th class="py-2 pl-2 font-medium text-right">Costs you</th>
				</tr>
			</thead>
			<tbody>
				{#each result.slices as slice (slice.from)}
					<tr class="border-b border-border/60">
						<td class="py-2 pr-2">{formatMoney(slice.from)} – {formatMoney(slice.to)}</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatRate(slice.rate)}</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatExact(slice.amount)}</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatExact(slice.taxSaved)}</td>
						<td class="py-2 pl-2 text-right tabular-nums font-medium">
							{formatExact(slice.netCost)}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="border-t border-border font-medium">
					<td class="py-2 pr-2" colspan="2">Total</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatExact(result.sacrifice)}</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatExact(result.taxSaved)}</td>
					<td class="py-2 pl-2 text-right tabular-nums">{formatExact(result.netCost)}</td>
				</tr>
			</tfoot>
		</table>
	{/if}

	{#if taperIsRelevant}
		<div class="rounded-md border border-border bg-muted/40 px-3 py-2 mb-3">
			<h3 class="text-sm font-semibold mb-1">The {formatRate(taperReliefRate)} band</h3>
			<p class="text-sm">
				Between {formatMoney(ALLOWANCE_TAPER_THRESHOLD)} and {formatMoney(ALLOWANCE_EXHAUSTED_AT)} every
				extra £1 of income costs 50p of personal allowance as well as its own tax, so a pound sacrificed
				out of that band is relieved at {formatRate(taperReliefRate)} rather than the headline rate.
				{#if result.taper.clearsTaper}
					<span class="font-medium"
						>This sacrifice clears the taper: your income is {formatMoney(result.adjustedNetIncome)} and
						the full {formatMoney(result.taper.allowanceAfter)} allowance is back</span
					>, {formatMoney(result.taper.allowanceRestored)} of it recovered by sacrificing.
				{:else if result.sacrifice === 0}
					<span class="font-medium"
						>Sacrificing {formatMoney(result.taper.sacrificeToClear)} would clear it entirely</span
					>, taking you to {formatMoney(ALLOWANCE_TAPER_THRESHOLD)} with the whole {formatMoney(
						PERSONAL_ALLOWANCE
					)} allowance restored.
				{:else if result.taper.shortfallToClear > 0}
					<span class="font-medium"
						>{formatMoney(result.taper.shortfallToClear)} more would clear it entirely</span
					>
					— a total sacrifice of {formatMoney(result.taper.sacrificeToClear)}, taking you to
					{formatMoney(ALLOWANCE_TAPER_THRESHOLD)} with the whole allowance restored.
					{#if result.taper.allowanceAfter > result.taper.allowanceBefore}
						So far it has bought back {formatMoney(result.taper.allowanceRestored)} of allowance.
					{/if}
				{/if}
			</p>
			{#if result.taper.shortfallToClear > 0}
				<Button variant="outline" size="sm" type="button" className="mt-2" onclick={clearTaper}>
					Sacrifice {formatMoney(result.taper.sacrificeToClear)} to clear the taper
				</Button>
			{/if}
		</div>
	{/if}

	{#if result.overAnnualAllowance}
		<p class="text-sm text-amber-700 mb-3">
			<span class="font-medium"
				>That is more than the {formatMoney(PENSION_ANNUAL_ALLOWANCE)} pension annual allowance.</span
			>
			Contributions above it can attract an annual allowance charge that takes the relief back — though
			unused allowance from the previous three years can often be carried forward, and this figure counts
			only what you've entered here, not employer contributions or other pensions.
		</p>
	{:else if result.sacrifice > 0}
		<p class="text-xs text-muted-foreground mb-3">
			{formatMoney(result.annualAllowanceHeadroom)} of the {formatMoney(PENSION_ANNUAL_ALLOWANCE)} pension
			annual allowance left, counting this sacrifice alone — employer contributions and other pensions
			use it up too.
		</p>
	{/if}

	<p class="text-xs text-muted-foreground">
		Illustrative only, not financial advice. {SALARY_SACRIFICE_TAX_YEAR} figures. Income tax only: the
		real saving is bigger, because sacrificed pay is also free of employee National Insurance and of the
		employer's, which some employers add to the pot — none of which this app models. Sacrifice defers
		tax rather than cancelling it; a pension is normally 25% tax-free and the rest taxed as income when
		drawn. A real scheme can't take your pay below the National Minimum Wage, and reducing your salary
		can also reduce anything pegged to it — death-in-service cover, statutory maternity pay, mortgage
		affordability. Nothing here is saved between visits, the same as the rest of this tab.
	</p>
</Card>
