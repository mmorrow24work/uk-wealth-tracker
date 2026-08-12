<script>
	/**
	 * Monthly snapshot entry UI for debts — README.md → "Net Worth Tracking": "Monthly snapshot
	 * entry: investments (per holding) + debts", "Debt tracking with D/I ratio (debt-to-investment
	 * %; <14% healthy, >18% concern)" and "Mortgage debt toggle (exclude from net worth when
	 * property equity already tracked)" (issues #10 and #11). Investment entry is `InvestmentHoldings`
	 * (issue #8), kept separate — this component only ever touches `MonthlyEntry.debts`.
	 *
	 * Follows `InvestmentHoldings`' shape closely (issue #68 was split off issue #8 specifically to
	 * keep debt entry's own session small, not to invent a different UI for it): a debt is re-stated
	 * fresh each month rather than mutated in place (`$lib/model.js`'s own convention for
	 * `MonthlyEntry`), so the first thing this UI needs is *which* month is being edited — a select
	 * over the months already recorded, plus a small form to start a new one. Once a month is
	 * selected, debts within it can be added, edited in place and removed.
	 *
	 * `monthlyEntries` is bindable so the parent (the dashboard today, the store via #5's
	 * `appData.monthly_entries` in practice) owns the history; this component only ever replaces the
	 * array wholesale, matching `InvestmentHoldings`' contract over the same prop. `debts` has no
	 * top-level home in `AppData` any more than `investments` does — both are nested per month — so
	 * unlike the pre-#68 version of this component, there is no separate `debts` prop.
	 *
	 * Every add/edit/remove also writes to the shared `activityLog` (issue #14) via
	 * `$lib/activity-log.js`, exactly like `InvestmentHoldings` does for investments. Because both
	 * entity types share one array, this component's `ActivityLog` instance is filtered to `debt`
	 * entries only, and reverts pass `'debt'` as the expected type — see `InvestmentHoldings.svelte`
	 * and `revertEntityRemoval`'s own doc comment for why that guard exists.
	 *
	 * Reverting a *removed* debt needs to know which month to put it back into, which
	 * `ActivityLogEntry` has no field for — the removal snapshot carries one extra
	 * `_monthly_entry_id` key alongside the debt fields, stripped back off before the record
	 * re-enters `debts`, exactly as `InvestmentHoldings` does for investments.
	 *
	 * The debt-to-investment ratio card reads both sides — `selectedEntry.debts` and
	 * `selectedEntry.investments` — from the *same* selected `MonthlyEntry`, so the ratio is always
	 * one month's debts against that same month's investments rather than mixing snapshots from two
	 * independently-selected months (flagged as a known gap in #8's journal entry, now closed here).
	 */
	import { DEBT_TYPES, DEBT_TYPE_LABELS } from '$lib/enums.js';
	import {
		compareMonthlyEntries,
		createDebt,
		createMonthlyEntry,
		monthlyEntryKey
	} from '$lib/model.js';
	import {
		DEBT_TO_INVESTMENT_STATUS_LABELS,
		DEBT_TO_INVESTMENT_THRESHOLDS,
		debtToInvestmentRatio,
		debtToInvestmentStatus,
		defaultsToExcludedFromNetWorth,
		sumDebtBalances,
		sumInvestmentValues
	} from '$lib/debt.js';
	import {
		logEntityAdded,
		logEntityRemoved,
		logEntityUpdated,
		revertEntityRemoval
	} from '$lib/activity-log.js';
	import { cn } from '$lib/utils.js';
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

	const debtLog = $derived(activityLog.filter((entry) => entry.entity_type === 'debt'));

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
	/** @type {import('$lib/enums.js').DebtType} */
	let type = $state('other');
	let balance = $state('');
	let notes = $state('');
	let excludeFromNetWorth = $state(false);

	const MORTGAGE_EXCLUDE_HINT =
		"Mortgages are usually excluded once your property's equity (value minus mortgage) is tracked separately on the Property tab — otherwise the same debt is counted twice.";

	/** Only re-applies the mortgage default while adding a new debt — changing an existing debt's
	 * type during an edit must not silently overwrite a checkbox the user already set deliberately.
	 * @param {import('$lib/enums.js').DebtType} newType */
	function handleTypeChange(newType) {
		type = newType;
		if (editingId === null) excludeFromNetWorth = defaultsToExcludedFromNetWorth(type);
	}

	function resetForm() {
		editingId = null;
		name = '';
		type = 'other';
		balance = '';
		notes = '';
		excludeFromNetWorth = false;
	}

	function formFields() {
		return {
			name: name.trim(),
			type,
			balance: Number(balance) || 0,
			notes: notes.trim(),
			exclude_from_net_worth: excludeFromNetWorth
		};
	}

	/** @param {import('$lib/types.js').Debt} debt */
	function startEdit(debt) {
		editingId = debt.id;
		name = debt.name;
		type = debt.type;
		balance = String(debt.balance);
		notes = debt.notes;
		excludeFromNetWorth = debt.exclude_from_net_worth;
	}

	function addDebt() {
		if (!selectedEntry) return;
		const fields = formFields();
		if (fields.name === '') return;

		const newDebt = createDebt(fields);
		const entryId = selectedEntry.id;
		monthlyEntries = monthlyEntries.map((entry) =>
			entry.id === entryId ? { ...entry, debts: [...entry.debts, newDebt] } : entry
		);
		activityLog = logEntityAdded(activityLog, 'debt', newDebt);
		resetForm();
	}

	function saveEdit() {
		if (!selectedEntry || editingId === null) return;
		const before = selectedEntry.debts.find((debt) => debt.id === editingId);
		if (!before) return;

		const fields = formFields();
		if (fields.name === '') return;

		const after = { ...before, ...fields };
		const entryId = selectedEntry.id;
		monthlyEntries = monthlyEntries.map((entry) =>
			entry.id === entryId
				? { ...entry, debts: entry.debts.map((debt) => (debt.id === editingId ? after : debt)) }
				: entry
		);
		activityLog = logEntityUpdated(activityLog, 'debt', before, after);
		resetForm();
	}

	function submitForm() {
		if (editingId === null) addDebt();
		else saveEdit();
	}

	/** @param {string} id */
	function removeDebt(id) {
		if (!selectedEntry) return;
		const removed = selectedEntry.debts.find((debt) => debt.id === id);
		if (!removed) return;

		const entryId = selectedEntry.id;
		monthlyEntries = monthlyEntries.map((entry) =>
			entry.id === entryId
				? { ...entry, debts: entry.debts.filter((debt) => debt.id !== id) }
				: entry
		);
		activityLog = logEntityRemoved(activityLog, 'debt', { ...removed, _monthly_entry_id: entryId });
		if (editingId === id) resetForm();
	}

	/** @param {string} logEntryId */
	function revertDebtRemoval(logEntryId) {
		const { log, entity } = revertEntityRemoval(activityLog, logEntryId, 'debt');
		activityLog = log;
		if (!entity) return;

		const { _monthly_entry_id, ...debt } = entity;
		monthlyEntries = monthlyEntries.map((entry) =>
			entry.id === _monthly_entry_id
				? { ...entry, debts: [...entry.debts, /** @type {import('$lib/types.js').Debt} */ (debt)] }
				: entry
		);
	}

	/** @param {string} id */
	function toggleExclude(id) {
		if (!selectedEntry) return;
		const entryId = selectedEntry.id;
		monthlyEntries = monthlyEntries.map((entry) =>
			entry.id === entryId
				? {
						...entry,
						debts: entry.debts.map((debt) =>
							debt.id === id
								? { ...debt, exclude_from_net_worth: !debt.exclude_from_net_worth }
								: debt
						)
					}
				: entry
		);
	}

	const totalDebt = $derived(selectedEntry ? sumDebtBalances(selectedEntry.debts) : 0);
	const totalInvestments = $derived(
		selectedEntry ? sumInvestmentValues(selectedEntry.investments) : 0
	);
	const ratio = $derived(
		selectedEntry ? debtToInvestmentRatio(selectedEntry.investments, selectedEntry.debts) : null
	);
	const status = $derived(debtToInvestmentStatus(ratio));

	/** @type {Record<string, string>} */
	const STATUS_CLASSES = {
		healthy: 'bg-green-50 text-green-700 border-green-200',
		moderate: 'bg-amber-50 text-amber-700 border-amber-200',
		concern: 'bg-red-50 text-red-700 border-red-200',
		unknown: 'bg-muted text-muted-foreground border-border'
	};
</script>

<div class="flex flex-col gap-6">
	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Monthly snapshot — debts</h2>

		<div class="flex flex-wrap items-end gap-3 mb-4">
			{#if ordered.length > 0}
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="debt-month-select">Month</label>
					<select
						id="debt-month-select"
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
						<label class="text-sm font-medium" for="new-debt-month">Month</label>
						<select
							id="new-debt-month"
							bind:value={newMonth}
							class="border border-input rounded-md px-2 py-1.5 text-sm"
						>
							{#each monthOptions as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium" for="new-debt-year">Year</label>
						<input
							id="new-debt-year"
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
				No monthly snapshot yet. Add a month above to start recording debts.
			</p>
		{:else}
			{#if selectedEntry.debts.length === 0}
				<p class="text-sm text-muted-foreground mb-4">
					No debts recorded for {formatMonth(selectedEntry)} yet.
				</p>
			{:else}
				<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
					{#each selectedEntry.debts as debt (debt.id)}
						<li
							class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
						>
							<div class="flex flex-col">
								<span class="font-medium">{debt.name}</span>
								<span class="text-sm text-muted-foreground">
									{DEBT_TYPE_LABELS[debt.type]} · {formatMoney(debt.balance)}
								</span>
								{#if debt.notes !== ''}
									<span class="text-xs text-muted-foreground">{debt.notes}</span>
								{/if}
							</div>
							<div class="flex flex-col items-end gap-1">
								<div class="flex items-center gap-3">
									<label
										class="flex items-center gap-1.5 text-sm text-muted-foreground"
										title={debt.type === 'mortgage' ? MORTGAGE_EXCLUDE_HINT : undefined}
									>
										<input
											type="checkbox"
											checked={debt.exclude_from_net_worth}
											onchange={() => toggleExclude(debt.id)}
										/>
										{debt.type === 'mortgage'
											? 'Exclude — property equity tracked separately'
											: 'Exclude from net worth'}
									</label>
									<Button variant="outline" size="sm" type="button" onclick={() => startEdit(debt)}>
										Edit
									</Button>
									<Button
										variant="ghost"
										size="sm"
										type="button"
										onclick={() => removeDebt(debt.id)}
									>
										Remove
									</Button>
								</div>
								{#if debt.type === 'mortgage' && !debt.exclude_from_net_worth}
									<p class="text-xs text-amber-600 max-w-xs text-right">
										Counted twice if this property's equity is also tracked.
									</p>
								{/if}
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
					<label class="text-sm font-medium" for="debt-name">Name</label>
					<input
						id="debt-name"
						type="text"
						bind:value={name}
						placeholder="e.g. Halifax mortgage"
						class="border border-input rounded-md px-2 py-1.5 text-sm"
						required
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="debt-type">Type</label>
					<select
						id="debt-type"
						value={type}
						onchange={(event) => handleTypeChange(/** @type {any} */ (event.currentTarget.value))}
						class="border border-input rounded-md px-2 py-1.5 text-sm"
					>
						{#each DEBT_TYPES as debtType (debtType)}
							<option value={debtType}>{DEBT_TYPE_LABELS[debtType]}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="debt-balance">Balance (£)</label>
					<input
						id="debt-balance"
						type="number"
						min="0"
						step="0.01"
						bind:value={balance}
						placeholder="0"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="debt-notes">Notes</label>
					<input
						id="debt-notes"
						type="text"
						bind:value={notes}
						placeholder="Optional"
						class="border border-input rounded-md px-2 py-1.5 text-sm"
					/>
				</div>

				<div class="flex flex-col gap-1 pb-2">
					<label
						class="flex items-center gap-1.5 text-sm text-muted-foreground"
						title={type === 'mortgage' ? MORTGAGE_EXCLUDE_HINT : undefined}
					>
						<input type="checkbox" bind:checked={excludeFromNetWorth} />
						{type === 'mortgage'
							? 'Exclude — property equity tracked separately'
							: 'Exclude from net worth'}
					</label>
					{#if type === 'mortgage'}
						<p class="text-xs text-muted-foreground max-w-xs">{MORTGAGE_EXCLUDE_HINT}</p>
					{/if}
				</div>

				<Button type="submit" size="sm">{editingId === null ? 'Add debt' : 'Save changes'}</Button>
				{#if editingId !== null}
					<Button variant="ghost" size="sm" type="button" onclick={resetForm}>Cancel</Button>
				{/if}
			</form>
		{/if}
	</Card>

	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Debt-to-investment ratio</h2>

		{#if !selectedEntry}
			<p class="text-sm text-muted-foreground">Add a monthly snapshot above to see the ratio.</p>
		{:else}
			<div class="flex flex-wrap items-baseline gap-4 mb-3">
				<span class="text-sm text-muted-foreground">
					{formatMonth(selectedEntry)}
				</span>
				<span class="text-sm text-muted-foreground">
					Total debt: <span class="font-medium text-foreground">{formatMoney(totalDebt)}</span>
				</span>
				<span class="text-sm text-muted-foreground">
					Total investments:
					<span class="font-medium text-foreground">{formatMoney(totalInvestments)}</span>
				</span>
			</div>

			<div class="flex items-center gap-3">
				<span class="text-2xl font-semibold">
					{ratio === null ? '—' : `${ratio.toFixed(1)}%`}
				</span>
				<span
					class={cn(
						'inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-medium',
						STATUS_CLASSES[status]
					)}
				>
					{DEBT_TO_INVESTMENT_STATUS_LABELS[status]}
				</span>
			</div>

			<p class="text-sm text-muted-foreground mt-2">
				Below {DEBT_TO_INVESTMENT_THRESHOLDS.healthy}% is healthy; above {DEBT_TO_INVESTMENT_THRESHOLDS.concern}%
				is a concern.
				{#if ratio === null}
					Record an investment holding for {formatMonth(selectedEntry)} to calculate your ratio.
				{/if}
			</p>
		{/if}
	</Card>

	<ActivityLog entries={debtLog} onRevert={revertDebtRemoval} />
</div>
