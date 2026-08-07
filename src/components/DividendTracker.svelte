<script>
	/**
	 * Dividend holding tracking — README.md → "Dividend Income Planner": "Per-holding: fund/stock
	 * name, wrapper, value, annual yield %, monthly contribution, frequency, strategy (DRIP /
	 * income)" (issue #34's exact field list).
	 *
	 * Structured the same way `PensionTracker.svelte` handles `pensions[]`: `dividends[]` sits
	 * directly on `AppData` (`$lib/model.js`'s own `Dividend` typedef), one flat list the user adds
	 * to, edits and removes from, not re-stated per month the way `InvestmentHoldings` treats
	 * `monthly_entries[].investments`. A dividend holding is a point-in-time fact about what a fund
	 * pays and how it is treated, not a monthly snapshot line.
	 *
	 * No activity log: as `PensionTracker.svelte` notes, `ACTIVITY_LOG_ENTITY_TYPES` covers
	 * `investment`/`debt` only (issue #14's own scope) and dividends were never in it.
	 *
	 * This component only collects the fields — what they add up to (today's income, the DRIP vs
	 * income-taken projection) is `DividendIncomePlanner.svelte`'s job, reading the same `dividends`
	 * list from further down the page.
	 */
	import {
		DIVIDEND_STRATEGIES,
		DIVIDEND_STRATEGY_LABELS,
		PAYOUT_FREQUENCIES,
		PAYOUT_FREQUENCY_LABELS,
		WRAPPERS,
		WRAPPER_LABELS
	} from '$lib/enums.js';
	import { annualDividendIncome } from '$lib/dividends.js';
	import { createDividend } from '$lib/model.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/**
	 * @type {{ dividends?: import('$lib/types.js').Dividend[] }}
	 */
	let { dividends = $bindable([]) } = $props();

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	const totalValue = $derived(dividends.reduce((sum, d) => sum + d.value, 0));
	const totalAnnualIncome = $derived(
		dividends.reduce((sum, d) => sum + annualDividendIncome(d), 0)
	);

	/** @type {string | null} */
	let editingId = $state(null);
	let name = $state('');
	/** @type {import('$lib/enums.js').Wrapper} */
	let wrapper = $state('gia');
	let value = $state('');
	let yieldPct = $state('');
	let monthlyContribution = $state('');
	/** @type {import('$lib/enums.js').PayoutFrequency} */
	let frequency = $state('quarterly');
	/** @type {import('$lib/enums.js').DividendStrategy} */
	let strategy = $state('drip');
	let notes = $state('');

	function resetForm() {
		editingId = null;
		name = '';
		wrapper = 'gia';
		value = '';
		yieldPct = '';
		monthlyContribution = '';
		frequency = 'quarterly';
		strategy = 'drip';
		notes = '';
	}

	function formFields() {
		return {
			name: name.trim(),
			wrapper,
			value: Number(value) || 0,
			yield_pct: Number(yieldPct) || 0,
			monthly_contribution: Number(monthlyContribution) || 0,
			frequency,
			strategy,
			notes: notes.trim()
		};
	}

	/** @param {import('$lib/types.js').Dividend} dividend */
	function startEdit(dividend) {
		editingId = dividend.id;
		name = dividend.name;
		wrapper = dividend.wrapper;
		value = String(dividend.value);
		yieldPct = String(dividend.yield_pct);
		monthlyContribution = String(dividend.monthly_contribution);
		frequency = dividend.frequency;
		strategy = dividend.strategy;
		notes = dividend.notes;
	}

	function addDividend() {
		const fields = formFields();
		if (fields.name === '') return;

		dividends = [...dividends, createDividend(fields)];
		resetForm();
	}

	function saveEdit() {
		if (editingId === null) return;
		const before = dividends.find((d) => d.id === editingId);
		if (!before) return;

		const fields = formFields();
		if (fields.name === '') return;

		const after = { ...before, ...fields };
		dividends = dividends.map((d) => (d.id === editingId ? after : d));
		resetForm();
	}

	function submitForm() {
		if (editingId === null) addDividend();
		else saveEdit();
	}

	/** @param {string} id */
	function removeDividend(id) {
		dividends = dividends.filter((d) => d.id !== id);
		if (editingId === id) resetForm();
	}
</script>

<div class="flex flex-col gap-6">
	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Dividend holdings</h2>

		{#if dividends.length === 0}
			<p class="text-sm text-muted-foreground mb-4">
				No dividend holdings recorded yet. Add one below.
			</p>
		{:else}
			<p class="text-sm text-muted-foreground mb-3">
				{dividends.length} holding{dividends.length === 1 ? '' : 's'} recorded, totalling {formatMoney(
					totalValue
				)} of value paying {formatMoney(totalAnnualIncome)}/yr at today's yields.
			</p>

			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each dividends as dividend (dividend.id)}
					<li
						class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
					>
						<div class="flex flex-col">
							<span class="font-medium">{dividend.name}</span>
							<span class="text-sm text-muted-foreground">
								{WRAPPER_LABELS[dividend.wrapper]} · {DIVIDEND_STRATEGY_LABELS[dividend.strategy]} ·
								{PAYOUT_FREQUENCY_LABELS[dividend.frequency]}
							</span>
							<span class="text-xs text-muted-foreground">
								{formatMoney(dividend.value)} at {dividend.yield_pct}% yield · {formatMoney(
									annualDividendIncome(dividend)
								)}/yr
								{#if dividend.monthly_contribution > 0}
									· {formatMoney(dividend.monthly_contribution)}/mo added
								{/if}
							</span>
						</div>
						<div class="flex items-center gap-2">
							<Button variant="outline" size="sm" type="button" onclick={() => startEdit(dividend)}>
								Edit
							</Button>
							<Button
								variant="ghost"
								size="sm"
								type="button"
								onclick={() => removeDividend(dividend.id)}
							>
								Remove
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			class="flex flex-wrap items-end gap-3"
			onsubmit={(event) => {
				event.preventDefault();
				submitForm();
			}}
		>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="dividend-name">Fund / stock name</label>
				<input
					id="dividend-name"
					type="text"
					bind:value={name}
					placeholder="e.g. Vanguard FTSE All-World High Dividend Yield"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
					required
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="dividend-wrapper">Account wrapper</label>
				<select
					id="dividend-wrapper"
					bind:value={wrapper}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				>
					{#each WRAPPERS as w (w)}
						<option value={w}>{WRAPPER_LABELS[w]}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="dividend-value">Value (£)</label>
				<input
					id="dividend-value"
					type="number"
					min="0"
					step="0.01"
					bind:value
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="dividend-yield">Annual yield (%)</label>
				<input
					id="dividend-yield"
					type="number"
					min="0"
					max="100"
					step="0.01"
					bind:value={yieldPct}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="dividend-contribution">
					Monthly contribution (£)
				</label>
				<input
					id="dividend-contribution"
					type="number"
					min="0"
					step="0.01"
					bind:value={monthlyContribution}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="dividend-frequency">Payout frequency</label>
				<select
					id="dividend-frequency"
					bind:value={frequency}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				>
					{#each PAYOUT_FREQUENCIES as f (f)}
						<option value={f}>{PAYOUT_FREQUENCY_LABELS[f]}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="dividend-strategy">Strategy</label>
				<select
					id="dividend-strategy"
					bind:value={strategy}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				>
					{#each DIVIDEND_STRATEGIES as s (s)}
						<option value={s}>{DIVIDEND_STRATEGY_LABELS[s]}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="dividend-notes">Notes</label>
				<input
					id="dividend-notes"
					type="text"
					bind:value={notes}
					placeholder="Optional"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				/>
			</div>

			<Button type="submit" size="sm">{editingId === null ? 'Add holding' : 'Save changes'}</Button>
			{#if editingId !== null}
				<Button variant="ghost" size="sm" type="button" onclick={resetForm}>Cancel</Button>
			{/if}
		</form>
	</Card>
</div>
