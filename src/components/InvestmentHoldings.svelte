<script>
	/**
	 * Monthly snapshot entry UI for investment holdings — README.md → "Net Worth Tracking":
	 * "Monthly snapshot entry: investments (per holding) + debts" and "Per-holding fields: name,
	 * type, current value, purchase price, year purchased, monthly contribution, account wrapper"
	 * (issue #9's exact field list). Debt entry is issue #68, kept separate — this component only
	 * ever touches `MonthlyEntry.investments`.
	 *
	 * A holding is re-stated fresh each month rather than mutated in place (`$lib/model.js`'s own
	 * convention for `MonthlyEntry`), so the first thing this UI needs is *which* month is being
	 * edited: a select over the months already recorded, plus a small form to start a new one. Once
	 * a month is selected, holdings within it can be added, edited in place and removed.
	 *
	 * `monthlyEntries` is bindable so the parent (the dashboard today, the store via #5's
	 * `appData.monthly_entries` in practice) owns the history; this component only ever replaces the
	 * array wholesale, matching `AutoInvestFill`'s contract over the same prop.
	 *
	 * Every add/edit/remove also writes to the shared `activityLog` (issue #14) via
	 * `$lib/activity-log.js`, exactly like `DebtTracker` does for debts. Because both entity types
	 * now share one array, this component's `ActivityLog` instance is filtered to `investment`
	 * entries only, and reverts pass `'investment'` as the expected type — see `DebtTracker.svelte`
	 * and `revertEntityRemoval`'s own doc comment for why that guard exists.
	 *
	 * Reverting a *removed* holding needs to know which month to put it back into, which
	 * `ActivityLogEntry` has no field for (it is not month-scoped for debts, the only entity type it
	 * previously had to support). Rather than widening the shared log schema for one caller, the
	 * snapshot recorded on removal carries one extra `_monthly_entry_id` key alongside the investment
	 * fields; `revertInvestmentRemoval` reads it to find the right entry and strips it back off
	 * before the record re-enters `investments`, so the restored holding is a clean `Investment`
	 * again.
	 */
	import {
		INVESTMENT_TYPES,
		INVESTMENT_TYPE_LABELS,
		WRAPPERS,
		WRAPPER_LABELS
	} from '$lib/enums.js';
	import {
		compareMonthlyEntries,
		createInvestment,
		createMonthlyEntry,
		monthlyEntryKey
	} from '$lib/model.js';
	import { sumInvestmentValues } from '$lib/debt.js';
	import {
		logEntityAdded,
		logEntityRemoved,
		logEntityUpdated,
		revertEntityRemoval
	} from '$lib/activity-log.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';
	import ActivityLog from './ActivityLog.svelte';

	/**
	 * @type {{
	 * 	monthlyEntries?: import('$lib/types.js').MonthlyEntry[],
	 * 	activityLog?: import('$lib/types.js').ActivityLogEntry[]
	 * }}
	 */
	let { monthlyEntries = $bindable([]), activityLog = $bindable([]) } = $props();

	/** Matches `$lib/model.js`'s own (unexported) bounds, so the "add month" form rejects the same
	 * years `validateAppData` would flag rather than a caller-chosen different range. */
	const MIN_YEAR = 1900;
	const MAX_YEAR = 2200;

	const ordered = $derived([...monthlyEntries].sort(compareMonthlyEntries));
	const orderedDesc = $derived([...ordered].reverse());

	let selectedEntryId = $state(/** @type {string | null} */ (null));
	$effect(() => {
		if (selectedEntryId === null && ordered.length > 0) {
			selectedEntryId = ordered[ordered.length - 1].id;
		}
	});

	const selectedEntry = $derived(
		monthlyEntries.find((entry) => entry.id === selectedEntryId) ?? null
	);

	const investmentLog = $derived(activityLog.filter((entry) => entry.entity_type === 'investment'));

	const today = new Date();
	let showAddMonth = $state(false);
	let newMonth = $state(today.getMonth() + 1);
	let newYear = $state(today.getFullYear());
	let duplicateMonthError = $state(false);

	const monthOptions = Array.from({ length: 12 }, (_, index) => ({
		value: index + 1,
		label: new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(new Date(2000, index, 1))
	}));

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

	function addMonth() {
		const month = Number(newMonth);
		const year = Number(newYear);
		if (!Number.isInteger(month) || month < 1 || month > 12) return;
		if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return;

		const key = monthlyEntryKey({ month, year });
		if (monthlyEntries.some((entry) => monthlyEntryKey(entry) === key)) {
			duplicateMonthError = true;
			return;
		}

		duplicateMonthError = false;
		const entry = createMonthlyEntry({ month, year });
		monthlyEntries = [...monthlyEntries, entry];
		selectedEntryId = entry.id;
		showAddMonth = false;
	}

	/** @type {string | null} */
	let editingId = $state(null);
	let name = $state('');
	/** @type {import('$lib/enums.js').InvestmentType} */
	let type = $state('shares');
	/** @type {import('$lib/enums.js').Wrapper} */
	let wrapper = $state('gia');
	let value = $state('');
	let boughtFor = $state('');
	let yearPurchased = $state('');
	let monthlyContribution = $state('');

	function resetForm() {
		editingId = null;
		name = '';
		type = 'shares';
		wrapper = 'gia';
		value = '';
		boughtFor = '';
		yearPurchased = '';
		monthlyContribution = '';
	}

	function formFields() {
		return {
			name: name.trim(),
			type,
			wrapper,
			value: Number(value) || 0,
			bought_for: boughtFor.trim() === '' ? null : Number(boughtFor),
			year_purchased: yearPurchased.trim() === '' ? null : Number(yearPurchased),
			monthly_contribution: Number(monthlyContribution) || 0
		};
	}

	/** @param {import('$lib/types.js').Investment} investment */
	function startEdit(investment) {
		editingId = investment.id;
		name = investment.name;
		type = investment.type;
		wrapper = investment.wrapper;
		value = String(investment.value);
		boughtFor = investment.bought_for === null ? '' : String(investment.bought_for);
		yearPurchased = investment.year_purchased === null ? '' : String(investment.year_purchased);
		monthlyContribution = String(investment.monthly_contribution);
	}

	function addInvestment() {
		if (!selectedEntry) return;
		const fields = formFields();
		if (fields.name === '') return;

		const newInvestment = createInvestment(fields);
		const entryId = selectedEntry.id;
		monthlyEntries = monthlyEntries.map((entry) =>
			entry.id === entryId
				? { ...entry, investments: [...entry.investments, newInvestment] }
				: entry
		);
		activityLog = logEntityAdded(activityLog, 'investment', newInvestment);
		resetForm();
	}

	function saveEdit() {
		if (!selectedEntry || editingId === null) return;
		const before = selectedEntry.investments.find((investment) => investment.id === editingId);
		if (!before) return;

		const fields = formFields();
		if (fields.name === '') return;

		const after = { ...before, ...fields };
		const entryId = selectedEntry.id;
		monthlyEntries = monthlyEntries.map((entry) =>
			entry.id === entryId
				? {
						...entry,
						investments: entry.investments.map((investment) =>
							investment.id === editingId ? after : investment
						)
					}
				: entry
		);
		activityLog = logEntityUpdated(activityLog, 'investment', before, after);
		resetForm();
	}

	function submitForm() {
		if (editingId === null) addInvestment();
		else saveEdit();
	}

	/** @param {string} id */
	function removeInvestment(id) {
		if (!selectedEntry) return;
		const removed = selectedEntry.investments.find((investment) => investment.id === id);
		if (!removed) return;

		const entryId = selectedEntry.id;
		monthlyEntries = monthlyEntries.map((entry) =>
			entry.id === entryId
				? { ...entry, investments: entry.investments.filter((investment) => investment.id !== id) }
				: entry
		);
		activityLog = logEntityRemoved(activityLog, 'investment', {
			...removed,
			_monthly_entry_id: entryId
		});
		if (editingId === id) resetForm();
	}

	/** @param {string} logEntryId */
	function revertInvestmentRemoval(logEntryId) {
		const { log, entity } = revertEntityRemoval(activityLog, logEntryId, 'investment');
		activityLog = log;
		if (!entity) return;

		const { _monthly_entry_id, ...investment } = entity;
		monthlyEntries = monthlyEntries.map((entry) =>
			entry.id === _monthly_entry_id
				? {
						...entry,
						investments: [
							...entry.investments,
							/** @type {import('$lib/types.js').Investment} */ (investment)
						]
					}
				: entry
		);
	}
</script>

<div class="flex flex-col gap-6">
	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Monthly snapshot — investment holdings</h2>

		<div class="flex flex-wrap items-end gap-3 mb-4">
			{#if ordered.length > 0}
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="holding-month-select">Month</label>
					<select
						id="holding-month-select"
						value={selectedEntryId}
						onchange={(event) => {
							selectedEntryId = event.currentTarget.value;
							resetForm();
						}}
						class="border border-input rounded-md px-2 py-1.5 text-sm"
					>
						{#each orderedDesc as entry (entry.id)}
							<option value={entry.id}
								>{formatMonth(entry)}{entry.auto_filled ? ' (auto-filled)' : ''}</option
							>
						{/each}
					</select>
				</div>
			{/if}

			{#if !showAddMonth}
				<Button variant="outline" size="sm" type="button" onclick={() => (showAddMonth = true)}>
					+ Add month
				</Button>
			{:else}
				<form
					class="flex flex-wrap items-end gap-2"
					onsubmit={(event) => {
						event.preventDefault();
						addMonth();
					}}
				>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium" for="new-month">Month</label>
						<select
							id="new-month"
							bind:value={newMonth}
							class="border border-input rounded-md px-2 py-1.5 text-sm"
						>
							{#each monthOptions as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium" for="new-year">Year</label>
						<input
							id="new-year"
							type="number"
							min={MIN_YEAR}
							max={MAX_YEAR}
							bind:value={newYear}
							class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
						/>
					</div>
					<Button type="submit" size="sm">Create</Button>
					<Button
						variant="ghost"
						size="sm"
						type="button"
						onclick={() => {
							showAddMonth = false;
							duplicateMonthError = false;
						}}
					>
						Cancel
					</Button>
				</form>
			{/if}
		</div>

		{#if duplicateMonthError}
			<p class="text-sm text-red-600 mb-3">
				A snapshot for that month already exists — pick it from the list above instead.
			</p>
		{/if}

		{#if !selectedEntry}
			<p class="text-sm text-muted-foreground">
				No monthly snapshot yet. Add a month above to start recording holdings.
			</p>
		{:else}
			<p class="text-sm text-muted-foreground mb-3">
				{selectedEntry.investments.length} holding{selectedEntry.investments.length === 1
					? ''
					: 's'} recorded for {formatMonth(selectedEntry)}, totalling {formatMoney(
					sumInvestmentValues(selectedEntry.investments, { includeExcluded: true })
				)}.
			</p>

			{#if selectedEntry.investments.length > 0}
				<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
					{#each selectedEntry.investments as investment (investment.id)}
						<li
							class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
						>
							<div class="flex flex-col">
								<span class="font-medium">{investment.name}</span>
								<span class="text-sm text-muted-foreground">
									{INVESTMENT_TYPE_LABELS[investment.type]} · {WRAPPER_LABELS[investment.wrapper]} ·
									{formatMoney(investment.value)}
								</span>
								<span class="text-xs text-muted-foreground">
									{investment.bought_for === null
										? 'Purchase price not recorded'
										: `Bought for ${formatMoney(investment.bought_for)}`}{investment.year_purchased ===
									null
										? ''
										: ` in ${investment.year_purchased}`} · {formatMoney(
										investment.monthly_contribution
									)}/mo
								</span>
							</div>
							<div class="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									type="button"
									onclick={() => startEdit(investment)}
								>
									Edit
								</Button>
								<Button
									variant="ghost"
									size="sm"
									type="button"
									onclick={() => removeInvestment(investment.id)}
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
					<label class="text-sm font-medium" for="holding-name">Name</label>
					<input
						id="holding-name"
						type="text"
						bind:value={name}
						placeholder="e.g. Vanguard FTSE Global All Cap"
						class="border border-input rounded-md px-2 py-1.5 text-sm"
						required
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="holding-type">Type</label>
					<select
						id="holding-type"
						bind:value={type}
						class="border border-input rounded-md px-2 py-1.5 text-sm"
					>
						{#each INVESTMENT_TYPES as investmentType (investmentType)}
							<option value={investmentType}>{INVESTMENT_TYPE_LABELS[investmentType]}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="holding-wrapper">Account wrapper</label>
					<select
						id="holding-wrapper"
						bind:value={wrapper}
						class="border border-input rounded-md px-2 py-1.5 text-sm"
					>
						{#each WRAPPERS as w (w)}
							<option value={w}>{WRAPPER_LABELS[w]}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="holding-value">Current value (£)</label>
					<input
						id="holding-value"
						type="number"
						min="0"
						step="0.01"
						bind:value
						placeholder="0"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="holding-bought-for">Purchase price (£)</label>
					<input
						id="holding-bought-for"
						type="text"
						inputmode="decimal"
						bind:value={boughtFor}
						placeholder="Unknown"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="holding-year-purchased">Year purchased</label>
					<input
						id="holding-year-purchased"
						type="text"
						inputmode="numeric"
						bind:value={yearPurchased}
						placeholder="Unknown"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="holding-contribution"
						>Monthly contribution (£)</label
					>
					<input
						id="holding-contribution"
						type="number"
						min="0"
						step="0.01"
						bind:value={monthlyContribution}
						placeholder="0"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
					/>
				</div>

				<Button type="submit" size="sm"
					>{editingId === null ? 'Add holding' : 'Save changes'}</Button
				>
				{#if editingId !== null}
					<Button variant="ghost" size="sm" type="button" onclick={resetForm}>Cancel</Button>
				{/if}
			</form>
		{/if}
	</Card>

	<ActivityLog entries={investmentLog} onRevert={revertInvestmentRemoval} />
</div>
