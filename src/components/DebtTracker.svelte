<script>
	/**
	 * Debt entry UI + debt-to-investment (D/I) ratio display — README.md → "Net Worth Tracking":
	 * "Debt tracking with D/I ratio (debt-to-investment %; <14% healthy, >18% concern)" and
	 * "Mortgage debt toggle (exclude from net worth when property equity already tracked)".
	 *
	 * Every debt gets the generic `exclude_from_net_worth` checkbox; `mortgage`-typed debts
	 * additionally default that checkbox to checked (`defaultsToExcludedFromNetWorth`, $lib/debt.js)
	 * and get mortgage-specific copy explaining why, since a mortgage is the one debt type that
	 * routinely double-counts against a property's equity once that is tracked separately.
	 *
	 * `investments` is read-only here (holding entry is issue #8's monthly snapshot form); `debts`
	 * is owned by this component and passed back via the bindable prop so a parent — eventually the
	 * store, once #5 lands — can persist it.
	 *
	 * Every add/remove also writes to `activityLog` (README.md → "Net Worth Tracking": "Activity
	 * log with revert support for deleted entries", issue #14) via `$lib/activity-log.js`, rendered
	 * below the ratio card through the `ActivityLog` component. Removing a debt keeps a full
	 * snapshot of it in the log entry, so "Revert" on a removed entry re-adds the exact same record
	 * (same id, so it is recognisably "the same debt" again rather than a new one) without a second
	 * "added" entry cluttering the log — the log already shows the removal as undone.
	 *
	 * `activityLog` is shared with `InvestmentHoldings` (issue #8) — both entity types live in one
	 * array — so this component's own `ActivityLog` instance only ever shows the `debt` entries, and
	 * `revertEntityRemoval` is called with `'debt'` as the expected type so a stale click can never
	 * mark an investment's removal reverted and hand back a non-`Debt` snapshot for `debts` to absorb.
	 */
	import { DEBT_TYPES, DEBT_TYPE_LABELS } from '$lib/enums.js';
	import { createDebt } from '$lib/model.js';
	import {
		DEBT_TO_INVESTMENT_STATUS_LABELS,
		DEBT_TO_INVESTMENT_THRESHOLDS,
		debtToInvestmentRatio,
		debtToInvestmentStatus,
		defaultsToExcludedFromNetWorth,
		sumDebtBalances,
		sumInvestmentValues
	} from '$lib/debt.js';
	import { logEntityAdded, logEntityRemoved, revertEntityRemoval } from '$lib/activity-log.js';
	import { cn } from '$lib/utils.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';
	import ActivityLog from './ActivityLog.svelte';

	/**
	 * @type {{
	 * 	investments?: import('$lib/types.js').Investment[],
	 * 	debts?: import('$lib/types.js').Debt[],
	 * 	activityLog?: import('$lib/types.js').ActivityLogEntry[]
	 * }}
	 */
	let { investments = [], debts = $bindable([]), activityLog = $bindable([]) } = $props();

	let name = $state('');
	/** @type {import('$lib/enums.js').DebtType} */
	let type = $state('other');
	let balance = $state('');
	let notes = $state('');
	let excludeFromNetWorth = $state(false);

	const totalDebt = $derived(sumDebtBalances(debts));
	const totalInvestments = $derived(sumInvestmentValues(investments));
	const ratio = $derived(debtToInvestmentRatio(investments, debts));
	const status = $derived(debtToInvestmentStatus(ratio));

	/** @type {Record<string, string>} */
	const STATUS_CLASSES = {
		healthy: 'bg-green-50 text-green-700 border-green-200',
		moderate: 'bg-amber-50 text-amber-700 border-amber-200',
		concern: 'bg-red-50 text-red-700 border-red-200',
		unknown: 'bg-muted text-muted-foreground border-border'
	};

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	const MORTGAGE_EXCLUDE_HINT =
		"Mortgages are usually excluded once your property's equity (value minus mortgage) is tracked separately on the Property tab — otherwise the same debt is counted twice.";

	/** @param {import('$lib/enums.js').DebtType} newType */
	function handleTypeChange(newType) {
		type = newType;
		excludeFromNetWorth = defaultsToExcludedFromNetWorth(type);
	}

	function addDebt() {
		const trimmedName = name.trim();
		if (trimmedName === '') return;

		const newDebt = createDebt({
			name: trimmedName,
			type,
			balance: Number(balance) || 0,
			notes: notes.trim(),
			exclude_from_net_worth: excludeFromNetWorth
		});

		debts = [...debts, newDebt];
		activityLog = logEntityAdded(activityLog, 'debt', newDebt);

		name = '';
		type = 'other';
		balance = '';
		notes = '';
		excludeFromNetWorth = false;
	}

	/** @param {string} id */
	function removeDebt(id) {
		const removed = debts.find((debt) => debt.id === id);
		if (!removed) return;

		debts = debts.filter((debt) => debt.id !== id);
		activityLog = logEntityRemoved(activityLog, 'debt', removed);
	}

	/** @param {string} logEntryId */
	function revertDebtRemoval(logEntryId) {
		const { log, entity } = revertEntityRemoval(activityLog, logEntryId, 'debt');
		activityLog = log;
		if (entity) debts = [...debts, /** @type {import('$lib/types.js').Debt} */ (entity)];
	}

	/** @param {string} id */
	function toggleExclude(id) {
		debts = debts.map((debt) =>
			debt.id === id ? { ...debt, exclude_from_net_worth: !debt.exclude_from_net_worth } : debt
		);
	}
</script>

<div class="flex flex-col gap-6">
	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Debts</h2>

		{#if debts.length === 0}
			<p class="text-sm text-muted-foreground mb-4">No debts recorded yet.</p>
		{:else}
			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each debts as debt (debt.id)}
					<li
						class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
					>
						<div class="flex flex-col">
							<span class="font-medium">{debt.name}</span>
							<span class="text-sm text-muted-foreground">
								{DEBT_TYPE_LABELS[debt.type]} · {formatMoney(debt.balance)}
							</span>
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
								<Button variant="ghost" size="sm" type="button" onclick={() => removeDebt(debt.id)}>
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
				addDebt();
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

			<Button type="submit" size="sm">Add debt</Button>
		</form>
	</Card>

	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Debt-to-investment ratio</h2>

		<div class="flex flex-wrap items-baseline gap-4 mb-3">
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
				Record an investment holding to calculate your ratio.
			{/if}
		</p>
	</Card>

	<ActivityLog
		entries={activityLog.filter((entry) => entry.entity_type === 'debt')}
		onRevert={revertDebtRemoval}
	/>
</div>
