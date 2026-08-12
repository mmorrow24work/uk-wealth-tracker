<script>
	/**
	 * Auto-invest fill UI — README.md → "Net Worth Tracking": "Auto-invest amounts per holding
	 * (fills missing months with compound growth)" (issue #15).
	 *
	 * Shows the recorded monthly history, names the months missing from it, and fills them by
	 * projecting each holding forward at a compound monthly rate ($lib/auto-invest.js). Filled
	 * months are labelled as such in the list and can be cleared again — nothing this component
	 * generates is presented as something the user recorded.
	 *
	 * `monthlyEntries` is bindable so the parent (the dashboard today, the store once #5 lands) owns
	 * the history; this component only ever replaces the array wholesale, never mutates it.
	 */
	import {
		DEFAULT_GROWTH_RATE,
		autoFilledEntries,
		fillMissingMonths,
		findMissingMonths,
		stripAutoFilledEntries
	} from '$lib/auto-invest.js';
	import { sumInvestmentValues } from '$lib/debt.js';
	import { compareMonthlyEntries, monthlyEntryKey } from '$lib/model.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/**
	 * @type {{
	 * 	monthlyEntries?: import('$lib/types.js').MonthlyEntry[],
	 * 	growthRate?: number,
	 * 	applyFundFees?: boolean
	 * }}
	 */
	let {
		monthlyEntries = $bindable([]),
		growthRate = DEFAULT_GROWTH_RATE,
		applyFundFees = true
	} = $props();

	// Editable copies of the assumptions: the props seed them once, the user drives them from here.
	// Capturing only the initial value is the intent — a later prop change must not discard what the
	// user typed into the growth field.
	// svelte-ignore state_referenced_locally
	let rate = $state(String(growthRate));
	// svelte-ignore state_referenced_locally
	let deductFees = $state(applyFundFees);

	const parsedRate = $derived(rate.trim() === '' ? 0 : Number(rate));
	const rateIsValid = $derived(
		Number.isFinite(parsedRate) && parsedRate >= -100 && parsedRate <= 100
	);

	const recorded = $derived(stripAutoFilledEntries(monthlyEntries));
	const generated = $derived(autoFilledEntries(monthlyEntries));
	// Months absent from the *recorded* history: what a fill would generate, whether or not it has
	// already generated them — filling again just recomputes them at the current assumptions.
	const missing = $derived(findMissingMonths(recorded));
	const ordered = $derived([...monthlyEntries].sort(compareMonthlyEntries));

	const plural = $derived(missing.length === 1 ? '' : 's');
	const fillLabel = $derived(
		missing.length === 0
			? 'No missing months'
			: generated.length > 0
				? `Recalculate ${missing.length} filled month${plural}`
				: `Fill ${missing.length} missing month${plural}`
	);

	const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });
	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {{ month: number, year: number }} value */
	function formatMonth({ month, year }) {
		return monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
	}

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	function fillGaps() {
		if (!rateIsValid) return;
		monthlyEntries = fillMissingMonths(monthlyEntries, {
			growthRate: parsedRate,
			applyFundFees: deductFees
		});
	}

	function clearFilled() {
		monthlyEntries = stripAutoFilledEntries(monthlyEntries);
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Auto-invest fill</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Skipped a month? Each holding is carried forward at the monthly equivalent of your growth rate,
		plus its contributions, so the history stays continuous.
	</p>

	<div class="flex flex-wrap items-end gap-4 mb-4">
		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="auto-invest-growth">Annual growth (%)</label>
			<input
				id="auto-invest-growth"
				type="number"
				min="-100"
				max="100"
				step="0.1"
				bind:value={rate}
				class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
			/>
		</div>

		<label class="flex items-center gap-1.5 text-sm text-muted-foreground pb-2">
			<input type="checkbox" bind:checked={deductFees} />
			Deduct each holding's fund fee
		</label>

		<div class="flex items-center gap-2 pb-1">
			<Button
				type="button"
				size="sm"
				disabled={missing.length === 0 || !rateIsValid}
				onclick={fillGaps}
			>
				{fillLabel}
			</Button>
			{#if generated.length > 0}
				<Button variant="outline" size="sm" type="button" onclick={clearFilled}>
					Clear filled months
				</Button>
			{/if}
		</div>
	</div>

	{#if !rateIsValid}
		<p class="text-sm text-red-600 mb-4">Enter a growth rate between -100% and 100%.</p>
	{/if}

	{#if recorded.length === 0}
		<p class="text-sm text-muted-foreground">
			No monthly snapshots recorded yet — the monthly snapshot entry form is still to come, so there
			is no history to fill in.
		</p>
	{:else if recorded.length === 1}
		<p class="text-sm text-muted-foreground">
			Only one snapshot recorded. A second one is what makes a gap possible.
		</p>
	{:else if generated.length > 0}
		<p class="text-sm text-muted-foreground mb-3">
			{generated.length} month{generated.length === 1 ? '' : 's'} projected forward from your recorded
			snapshots. Change the assumptions above and recalculate to redo them.
		</p>
	{:else if missing.length > 0}
		<p class="text-sm text-amber-600 mb-3">
			Missing: {missing.map(formatMonth).join(', ')}.
		</p>
	{/if}

	{#if ordered.length > 0}
		<ul class="flex flex-col gap-2 list-none p-0 m-0">
			{#each ordered as entry (entry.id)}
				<li
					class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
				>
					<div class="flex flex-col">
						<span class="font-medium">{formatMonth(entry)}</span>
						<span class="text-xs text-muted-foreground">{monthlyEntryKey(entry)}</span>
					</div>
					<div class="flex items-center gap-3">
						<span class="text-sm">{formatMoney(sumInvestmentValues(entry.investments))}</span>
						{#if entry.auto_filled}
							<span
								class="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
								title="Projected from the last recorded month — not a snapshot you entered."
							>
								Auto-filled
							</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</Card>
