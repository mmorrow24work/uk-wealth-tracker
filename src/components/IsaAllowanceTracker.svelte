<script>
	/**
	 * ISA allowance tracker — README.md → "ISA Allowance Tracker": "All six UK ISA wrappers: Stocks
	 * & Shares, Cash, LISA, JISA, IFISA, Help to Buy" and "Per-wrapper limits, contributions and
	 * remaining allowance" (issue #28).
	 *
	 * Unlike the other cards on this tab, this one isn't about income at all — it's about how much of
	 * this tax year's ISA allowance has already been used, wrapper by wrapper. Six inputs, one per
	 * `ISA_WRAPPERS` member (`$lib/enums.js`), each seeded from {@link isaContributionPace} — the
	 * *current* recorded contribution pace on holdings already on the Net Worth tab, annualised — and
	 * then editable, since a pace is a forecast, not a ledger of what has actually been paid in since
	 * 6 April (see `$lib/isa.js`'s header for why the data model can't derive that automatically).
	 *
	 * `$lib/isa.js` does the arithmetic: the five adult wrappers pool one £20,000 limit, the Junior
	 * ISA has its own separate £9,000, and the Lifetime ISA has a second £4,000 cap living inside the
	 * shared adult pool. This component is purely presentational over `isaAllowanceSummary`'s result.
	 */
	import { ISA_WRAPPERS } from '$lib/enums.js';
	import {
		isaAllowanceSummary,
		isaContributionPace,
		isaTaxYearProgress,
		ISA_TAX_YEAR
	} from '$lib/isa.js';
	import Card from './ui/card.svelte';

	/** @type {{ investments?: readonly import('$lib/types.js').Investment[] }} */
	let { investments = [] } = $props();

	// Seeded once from whatever is currently recorded, then owned by this card for the session —
	// the same "seed from the store, then let the user own it" shape `TaxCalculator.svelte` uses for
	// salary and region. Re-seeding on every `investments` change would silently overwrite a figure
	// the user has already corrected to their real year-to-date contribution.
	// svelte-ignore state_referenced_locally
	let contributions = $state({ ...isaContributionPace(investments) });

	const yearProgress = isaTaxYearProgress();

	/**
	 * `bind:value` on a number input hands back a number, or `null`/`''` once the field is cleared.
	 *
	 * @param {unknown} value
	 * @returns {number}
	 */
	function parse(value) {
		if (value === null || value === undefined || value === '') return 0;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
	}

	const normalisedContributions = $derived(
		Object.fromEntries(ISA_WRAPPERS.map((wrapper) => [wrapper, parse(contributions[wrapper])]))
	);
	const result = $derived(isaAllowanceSummary(normalisedContributions));

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/**
	 * Progress bar fraction, 0–100, clamped so an over-contributed wrapper still shows a full bar
	 * rather than overflowing it.
	 *
	 * @param {number} contributed
	 * @param {number} limit
	 * @returns {number}
	 */
	function progressPct(contributed, limit) {
		if (limit <= 0) return 0;
		return Math.min(100, Math.round((contributed / limit) * 100));
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">ISA allowance tracker, {ISA_TAX_YEAR}</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Five adult ISA wrappers share one £{formatMoney(result.adult.limit).slice(1)} allowance between them,
		split however you like across providers. The Junior ISA has its own, separate £{formatMoney(
			result.jisa.limit
		).slice(1)} — it belongs to the child, not you. The Lifetime ISA also has a tighter £{formatMoney(
			result.lisaSublimit.limit
		).slice(1)} cap of its own, inside the shared £20,000 rather than beside it.
		{yearProgress.daysRemaining > 0
			? `${yearProgress.daysRemaining} days left in this tax year.`
			: 'This tax year has ended.'}
	</p>

	<div class="flex flex-wrap gap-3 mb-4">
		<div class="flex-1 min-w-52 rounded-md border border-border px-3 py-2">
			<div class="text-sm font-medium">Adult ISA allowance</div>
			<div class="text-xs text-muted-foreground mb-1">
				Stocks &amp; Shares, Cash, Lifetime, Innovative Finance and Help to Buy ISAs, combined
			</div>
			<div class="text-xl font-semibold">
				{formatMoney(result.adult.contributed)}
				<span class="text-muted-foreground text-sm">of {formatMoney(result.adult.limit)}</span>
			</div>
			<div class="h-2 w-full rounded-full bg-muted overflow-hidden mt-1.5">
				<div
					class="h-full rounded-full {result.adult.overLimit > 0 ? 'bg-red-600' : 'bg-black'}"
					style="width: {progressPct(result.adult.contributed, result.adult.limit)}%"
				></div>
			</div>
			<div class="text-xs text-muted-foreground mt-1">
				{result.adult.overLimit > 0
					? `${formatMoney(result.adult.overLimit)} over the limit`
					: `${formatMoney(result.adult.remaining)} remaining`}
			</div>
		</div>

		<div class="flex-1 min-w-52 rounded-md border border-border px-3 py-2">
			<div class="text-sm font-medium">Junior ISA allowance</div>
			<div class="text-xs text-muted-foreground mb-1">Separate from the adult allowance above</div>
			<div class="text-xl font-semibold">
				{formatMoney(result.jisa.contributed)}
				<span class="text-muted-foreground text-sm">of {formatMoney(result.jisa.limit)}</span>
			</div>
			<div class="h-2 w-full rounded-full bg-muted overflow-hidden mt-1.5">
				<div
					class="h-full rounded-full {result.jisa.overLimit > 0 ? 'bg-red-600' : 'bg-black'}"
					style="width: {progressPct(result.jisa.contributed, result.jisa.limit)}%"
				></div>
			</div>
			<div class="text-xs text-muted-foreground mt-1">
				{result.jisa.overLimit > 0
					? `${formatMoney(result.jisa.overLimit)} over the limit`
					: `${formatMoney(result.jisa.remaining)} remaining`}
			</div>
		</div>
	</div>

	<table class="w-full text-sm border-collapse mb-3">
		<thead>
			<tr class="border-b border-border text-left">
				<th class="py-2 pr-2 font-medium">Wrapper</th>
				<th class="py-2 px-2 font-medium text-right">Contributed this tax year</th>
				<th class="py-2 pl-2 font-medium text-right">Remaining</th>
			</tr>
		</thead>
		<tbody>
			{#each result.wrappers as wrapper (wrapper.wrapper)}
				<tr class="border-b border-border/60">
					<td class="py-2 pr-2">
						{wrapper.label}
						{#if wrapper.closedToNewAccounts}
							<span class="text-xs text-muted-foreground block">closed to new accounts</span>
						{/if}
					</td>
					<td class="py-2 px-2 text-right">
						<div class="flex items-center justify-end gap-1">
							<span class="text-muted-foreground">£</span>
							<input
								type="number"
								min="0"
								step="50"
								aria-label="Contributed to {wrapper.label} this tax year"
								bind:value={contributions[wrapper.wrapper]}
								class="border border-input rounded-md px-2 py-1 text-sm w-28 text-right tabular-nums"
							/>
						</div>
					</td>
					<td
						class="py-2 pl-2 text-right tabular-nums {wrapper.overLimit
							? 'text-red-600 font-medium'
							: ''}"
					>
						{wrapper.overLimit
							? `${formatMoney(wrapper.overBy)} over`
							: formatMoney(wrapper.remaining)}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<p class="text-xs text-muted-foreground">
		Illustrative only, not financial advice. {ISA_TAX_YEAR} limits. Each field starts from the monthly
		contribution already recorded for that wrapper's holdings on the Net Worth tab, annualised — correct
		it to what you have actually paid in since 6 April if the two differ, since a recorded pace is a forecasting
		assumption, not a running total of what has gone in. The Lifetime ISA also carries a 25% government
		bonus on what you pay in and a 25% withdrawal penalty outside a first home purchase or age 60, neither
		of which is modelled here. Nothing on this card is saved between visits.
	</p>
</Card>
