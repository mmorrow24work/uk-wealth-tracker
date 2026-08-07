<script>
	/**
	 * Pension tax relief per pot — README.md → "Pension Tracker": "Tax relief display per pot (20%
	 * basic, 40% higher — claim extra via Self Assessment)" — issue #32.
	 *
	 * `PensionTracker` above this collects each DC Workplace/SIPP pot's own contribution percentage;
	 * this card is what HMRC does with it. `$lib/pension-relief.js` owns the arithmetic — a
	 * relief-at-source provider adds basic-rate relief automatically, and a higher- or
	 * additional-rate taxpayer is owed more at their marginal rate, but only gets it by claiming it
	 * back through Self Assessment. This component formats that, the same split
	 * `DefinedBenefitIncome.svelte` draws between what `$lib/defined-benefit.js` computes and what it
	 * renders.
	 *
	 * It reads `pensions` and `profile` without binding — nothing here writes to the data model, and
	 * there is nothing to type in: every figure below falls out of the pot's own contribution
	 * percentage and `profile.gross_salary`/`profile.tax_region`, already entered elsewhere.
	 *
	 * A Lifetime ISA pot gets its own short note rather than a row in the relief table — its 25%
	 * top-up is a government bonus, not income tax relief, and does not belong in the same total.
	 */
	import { PENSION_TYPE_LABELS } from '$lib/enums.js';
	import { createProfile } from '$lib/model.js';
	import { isReliefEligible, pensionReliefSummary } from '$lib/pension-relief.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 *   pensions?: import('$lib/types.js').Pension[],
	 *   profile?: import('$lib/types.js').Profile
	 * }}
	 */
	let { pensions = [], profile = createProfile() } = $props();

	const summary = $derived(pensionReliefSummary(pensions, profile));

	/** Pots that carry neither a relief-eligible contribution nor a Lifetime ISA bonus — nothing to say. */
	const otherPots = $derived(
		pensions.filter((pension) => !isReliefEligible(pension.type) && pension.type !== 'lisa')
	);

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} rate @returns {string} e.g. "20%", "42%" */
	function formatRate(rate) {
		return `${Math.round(rate * 100) / 100}%`;
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Tax relief per pot</h2>
	<p class="text-sm text-muted-foreground mb-4">
		A relief-at-source provider adds basic-rate (20%) tax relief to your own contribution
		automatically. If your marginal rate is higher than that, the rest of the relief is yours too —
		but you have to claim it back yourself, through Self Assessment.
	</p>

	{#if summary.count === 0 && summary.lisaPots.length === 0}
		<p class="text-sm">
			No DC Workplace, SIPP or Lifetime ISA pots recorded yet. Add one above and its tax relief will
			be worked out here.
		</p>
	{:else}
		{#if summary.count > 0}
			<div class="flex flex-wrap gap-3 mb-4">
				<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
					<div class="text-sm font-medium">Your contribution</div>
					<div class="text-xs text-muted-foreground mb-1">
						across {summary.count} eligible pot{summary.count === 1 ? '' : 's'}
					</div>
					<div class="text-xl font-semibold">{formatMoney(summary.netContribution)}/yr</div>
					<div class="text-xs text-muted-foreground">from your take-home pay</div>
				</div>

				<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
					<div class="text-sm font-medium">Total relief</div>
					<div class="text-xs text-muted-foreground mb-1">
						{formatMoney(summary.basicRateRelief)} automatic, {formatMoney(summary.extraRelief)} to claim
					</div>
					<div class="text-xl font-semibold">{formatMoney(summary.totalRelief)}/yr</div>
					<div class="text-xs text-muted-foreground">
						{formatMoney(summary.grossContribution)}/yr lands in your pots
					</div>
				</div>
			</div>

			<table class="w-full text-sm border-collapse mb-4">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Pot</th>
						<th class="py-2 px-2 font-medium text-right">Your contribution</th>
						<th class="py-2 px-2 font-medium text-right">Basic-rate relief (20%)</th>
						<th class="py-2 px-2 font-medium text-right">In the pot</th>
						<th class="py-2 pl-2 font-medium text-right">Extra to claim</th>
					</tr>
				</thead>
				<tbody>
					{#each summary.pots as pot (pot.id)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-2">
								<div class="font-medium">{pot.name}</div>
								<div class="text-xs text-muted-foreground">
									{pot.type === null ? '' : PENSION_TYPE_LABELS[pot.type]} · marginal rate {formatRate(
										pot.marginalRate
									)}
								</div>
							</td>
							<td class="py-2 px-2 text-right tabular-nums">{formatMoney(pot.netContribution)}</td>
							<td class="py-2 px-2 text-right tabular-nums">{formatMoney(pot.basicRateRelief)}</td>
							<td class="py-2 px-2 text-right tabular-nums font-medium">
								{formatMoney(pot.grossContribution)}
							</td>
							<td class="py-2 pl-2 text-right tabular-nums">
								{#if pot.claimableViaSelfAssessment}
									<span class="text-amber-700">{formatMoney(pot.extraRelief)}</span>
								{:else}
									<span class="text-muted-foreground">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr class="border-t border-border font-medium">
						<td class="py-2 pr-2">Total</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatMoney(summary.netContribution)}</td
						>
						<td class="py-2 px-2 text-right tabular-nums">{formatMoney(summary.basicRateRelief)}</td
						>
						<td class="py-2 px-2 text-right tabular-nums"
							>{formatMoney(summary.grossContribution)}</td
						>
						<td class="py-2 pl-2 text-right tabular-nums">{formatMoney(summary.extraRelief)}</td>
					</tr>
				</tfoot>
			</table>

			{#if summary.claimingCount > 0}
				<p class="text-sm text-amber-700 mb-3">
					{summary.claimingCount} pot{summary.claimingCount === 1 ? '' : 's'} above
					{summary.claimingCount === 1 ? 'has' : 'have'} relief still to claim. Report your gross pension
					contributions on your Self Assessment return — HMRC extends your basic-rate band by that amount,
					which is what brings the extra relief back to you as a reduction in your tax bill, not as more
					money in the pot.
				</p>
			{/if}
		{/if}

		{#if summary.lisaPots.length > 0}
			<p class="text-sm mb-2">
				{summary.lisaPots.length} Lifetime ISA pot{summary.lisaPots.length === 1 ? '' : 's'}
				{summary.lisaPots.length === 1 ? 'is' : 'are'} not shown above: a LISA gets a 25% government bonus
				on what you pay in, not income tax relief. The bonus is the same for every taxpayer and there
				is nothing further to claim via Self Assessment.
			</p>
		{/if}

		{#if otherPots.length > 0}
			<p class="text-xs text-muted-foreground">
				Defined Benefit and State Pension pots have no personal contribution to relieve — their
				income is worked out separately, above.
			</p>
		{/if}
	{/if}

	<p class="text-xs text-muted-foreground mt-3">
		Illustrative only, not financial advice. Assumes every DC Workplace/SIPP pot uses
		relief-at-source (the SIPP-standard case) rather than a net-pay-arrangement workplace scheme,
		where relief at every rate is already automatic and there is nothing to claim. Employer
		contributions are not shown here — they are never your income, so they carry no personal tax
		relief to claim. The £3,600 minimum relief for very low or no earners, and the tapered and
		money-purchase annual allowances, are not modelled.
	</p>
</Card>
