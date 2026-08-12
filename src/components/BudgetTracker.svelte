<script>
	/**
	 * Budget & Bills — README.md → "Budget & Bills": "Monthly spend categories", "Recurring bills
	 * and line items", "ONS UK household average benchmarks" and "Manual entry only (no bank feed)"
	 * (issue #145, finally building out the `/budget` tab `types.js`'s `Budget` typedef has had a
	 * shape for since the core data model).
	 *
	 * Three flat lists, one card each, the same "point-in-time fact, not a monthly snapshot" pattern
	 * `PensionTracker`/`PropertyTracker`/`AssetsTracker`/`DividendTracker` already use for their own
	 * `AppData`-level collections: a category's `monthly_amount` is today's budgeted figure, not a
	 * per-month entry, so there is no month selector here, just add/edit/remove against
	 * `budget.categories`/`budget.bills`/`budget.line_items`.
	 *
	 * `$lib/budget.js` owns every total — this component only ever reads `billMonthlyAmount`,
	 * `budgetMonthlySummary` and `onsBenchmarkSummary`, never recomputes them, so the totals shown
	 * here and the ones `HouseholdCashFlow` builds its cash flow figure from can never drift apart.
	 *
	 * The ONS benchmark field is a plain optional number a user types in themselves — `$lib/budget.js`'s
	 * `ONS_CATEGORY_PRESETS` gives a "quick add" list of illustrative starter categories (its own doc
	 * comment explains why the figures are labelled illustrative rather than sourced) so a category
	 * with a benchmark already attached is one click away, but nothing stops a category being added
	 * by hand with its own benchmark or none at all.
	 *
	 * No activity log: `$lib/enums.js`'s `ACTIVITY_LOG_ENTITY_TYPES` covers `investment`/`debt` only
	 * (issue #14's own scope) — budget items were never in it, same as pensions/dividends/properties/
	 * assets.
	 *
	 * A fourth card (issue #267) sits between Recurring bills and One-off items: `BankCsvImport`,
	 * a generic column-mapper that turns an uploaded bank statement CSV into fresh one-off
	 * `budget.line_items` — see that component and `$lib/bank-csv-import.js` for the mapping/parsing
	 * logic. It only ever mutates the same bindable `budget` prop every add/edit/remove function
	 * below already does, so it adds no new state-management path of its own.
	 */
	import { BILL_FREQUENCIES, BILL_FREQUENCY_LABELS } from '$lib/enums.js';
	import { createBudgetBill, createBudgetCategory, createBudgetLineItem } from '$lib/model.js';
	import {
		ONS_CATEGORY_PRESETS,
		billMonthlyAmount,
		budgetMonthlySummary,
		onsBenchmarkSummary
	} from '$lib/budget.js';
	import BankCsvImport from './BankCsvImport.svelte';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/** @type {{ budget?: import('$lib/types.js').Budget }} */
	let { budget = $bindable({ categories: [], bills: [], line_items: [] }) } = $props();

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});
	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	const summary = $derived(budgetMonthlySummary(budget));
	const onsSummary = $derived(onsBenchmarkSummary(budget.categories));

	/** @param {string | null} categoryId */
	function categoryName(categoryId) {
		if (categoryId === null) return null;
		return budget.categories.find((category) => category.id === categoryId)?.name ?? null;
	}

	/* -------------------------------------------------------------------------- */
	/* Categories                                                                  */
	/* -------------------------------------------------------------------------- */

	/** @type {string | null} */
	let editingCategoryId = $state(null);
	let categoryName_ = $state('');
	let categoryAmount = $state('');
	let categoryBenchmark = $state('');

	function resetCategoryForm() {
		editingCategoryId = null;
		categoryName_ = '';
		categoryAmount = '';
		categoryBenchmark = '';
	}

	/** @param {import('$lib/types.js').BudgetCategory} category */
	function startEditCategory(category) {
		editingCategoryId = category.id;
		categoryName_ = category.name;
		categoryAmount = String(category.monthly_amount);
		categoryBenchmark = category.ons_benchmark === null ? '' : String(category.ons_benchmark);
	}

	function submitCategory() {
		const name = categoryName_.trim();
		if (name === '') return;
		const fields = {
			name,
			monthly_amount: Number(categoryAmount) || 0,
			ons_benchmark: categoryBenchmark.trim() === '' ? null : Number(categoryBenchmark) || 0
		};

		if (editingCategoryId === null) {
			budget = { ...budget, categories: [...budget.categories, createBudgetCategory(fields)] };
		} else {
			const id = editingCategoryId;
			budget = {
				...budget,
				categories: budget.categories.map((category) =>
					category.id === id ? { ...category, ...fields } : category
				)
			};
		}
		resetCategoryForm();
	}

	/** @param {string} id */
	function removeCategory(id) {
		budget = {
			...budget,
			categories: budget.categories.filter((category) => category.id !== id),
			bills: budget.bills.map((bill) =>
				bill.category_id === id ? { ...bill, category_id: null } : bill
			),
			line_items: budget.line_items.map((item) =>
				item.category_id === id ? { ...item, category_id: null } : item
			)
		};
		if (editingCategoryId === id) resetCategoryForm();
	}

	/** @param {{ name: string, ons_benchmark: number }} preset */
	function addPreset(preset) {
		if (budget.categories.some((category) => category.name === preset.name)) return;
		budget = {
			...budget,
			categories: [
				...budget.categories,
				createBudgetCategory({
					name: preset.name,
					monthly_amount: 0,
					ons_benchmark: preset.ons_benchmark
				})
			]
		};
	}

	/* -------------------------------------------------------------------------- */
	/* Bills                                                                       */
	/* -------------------------------------------------------------------------- */

	/** @type {string | null} */
	let editingBillId = $state(null);
	let billName = $state('');
	let billAmount = $state('');
	/** @type {import('$lib/enums.js').BillFrequency} */
	let billFrequency = $state('monthly');
	let billDueDay = $state('');
	/** @type {string} */
	let billCategoryId = $state('');
	let billNotes = $state('');

	function resetBillForm() {
		editingBillId = null;
		billName = '';
		billAmount = '';
		billFrequency = 'monthly';
		billDueDay = '';
		billCategoryId = '';
		billNotes = '';
	}

	/** @param {import('$lib/types.js').BudgetBill} bill */
	function startEditBill(bill) {
		editingBillId = bill.id;
		billName = bill.name;
		billAmount = String(bill.amount);
		billFrequency = bill.frequency;
		billDueDay = bill.due_day === null ? '' : String(bill.due_day);
		billCategoryId = bill.category_id ?? '';
		billNotes = bill.notes;
	}

	function submitBill() {
		const name = billName.trim();
		if (name === '') return;
		const fields = {
			name,
			amount: Number(billAmount) || 0,
			frequency: billFrequency,
			due_day: billDueDay.trim() === '' ? null : Number(billDueDay) || null,
			category_id: billCategoryId === '' ? null : billCategoryId,
			notes: billNotes.trim()
		};

		if (editingBillId === null) {
			budget = { ...budget, bills: [...budget.bills, createBudgetBill(fields)] };
		} else {
			const id = editingBillId;
			budget = {
				...budget,
				bills: budget.bills.map((bill) => (bill.id === id ? { ...bill, ...fields } : bill))
			};
		}
		resetBillForm();
	}

	/** @param {string} id */
	function removeBill(id) {
		budget = { ...budget, bills: budget.bills.filter((bill) => bill.id !== id) };
		if (editingBillId === id) resetBillForm();
	}

	/* -------------------------------------------------------------------------- */
	/* Line items                                                                  */
	/* -------------------------------------------------------------------------- */

	/** @type {string | null} */
	let editingLineItemId = $state(null);
	let lineItemName = $state('');
	let lineItemAmount = $state('');
	/** @type {string} */
	let lineItemCategoryId = $state('');
	let lineItemNotes = $state('');

	function resetLineItemForm() {
		editingLineItemId = null;
		lineItemName = '';
		lineItemAmount = '';
		lineItemCategoryId = '';
		lineItemNotes = '';
	}

	/** @param {import('$lib/types.js').BudgetLineItem} item */
	function startEditLineItem(item) {
		editingLineItemId = item.id;
		lineItemName = item.name;
		lineItemAmount = String(item.amount);
		lineItemCategoryId = item.category_id ?? '';
		lineItemNotes = item.notes;
	}

	function submitLineItem() {
		const name = lineItemName.trim();
		if (name === '') return;
		const fields = {
			name,
			amount: Number(lineItemAmount) || 0,
			category_id: lineItemCategoryId === '' ? null : lineItemCategoryId,
			notes: lineItemNotes.trim()
		};

		if (editingLineItemId === null) {
			budget = { ...budget, line_items: [...budget.line_items, createBudgetLineItem(fields)] };
		} else {
			const id = editingLineItemId;
			budget = {
				...budget,
				line_items: budget.line_items.map((item) =>
					item.id === id ? { ...item, ...fields } : item
				)
			};
		}
		resetLineItemForm();
	}

	/** @param {string} id */
	function removeLineItem(id) {
		budget = { ...budget, line_items: budget.line_items.filter((item) => item.id !== id) };
		if (editingLineItemId === id) resetLineItemForm();
	}
</script>

<div class="flex flex-col gap-6">
	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Monthly totals</h2>
		<div class="flex flex-wrap gap-4 text-sm">
			<span
				>Categories: <span class="font-medium">{formatMoney(summary.categoriesTotal)}</span></span
			>
			<span>Bills: <span class="font-medium">{formatMoney(summary.billsTotal)}</span></span>
			<span
				>Recurring total: <span class="font-medium">{formatMoney(summary.recurringTotal)}</span
				></span
			>
			<span
				>One-off items: <span class="font-medium">{formatMoney(summary.lineItemsTotal)}</span></span
			>
			<span class="font-semibold">Total: {formatMoney(summary.total)}</span>
		</div>
	</Card>

	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Spending categories</h2>

		{#if budget.categories.length === 0}
			<p class="text-sm text-muted-foreground mb-4">No spending categories recorded yet.</p>
		{:else}
			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each budget.categories as category (category.id)}
					{@const onsRow = onsSummary.categories.find((row) => row.category.id === category.id)}
					<li
						class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
					>
						<div class="flex flex-col">
							<span class="font-medium">{category.name}</span>
							<span class="text-sm text-muted-foreground"
								>{formatMoney(category.monthly_amount)}/mo</span
							>
							{#if onsRow}
								<span class="text-xs {onsRow.aboveAverage ? 'text-amber-600' : 'text-green-700'}">
									ONS average {formatMoney(onsRow.benchmark)}/mo · {onsRow.aboveAverage
										? 'above'
										: 'at or below'}
									average by {formatMoney(Math.abs(onsRow.diff))}
								</span>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								type="button"
								onclick={() => startEditCategory(category)}
							>
								Edit
							</Button>
							<Button
								variant="ghost"
								size="sm"
								type="button"
								onclick={() => removeCategory(category.id)}
							>
								Remove
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			class="flex flex-wrap items-end gap-3 mb-4"
			onsubmit={(event) => {
				event.preventDefault();
				submitCategory();
			}}
		>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-category-name">Name</label>
				<input
					id="budget-category-name"
					type="text"
					bind:value={categoryName_}
					placeholder="e.g. Groceries"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
					required
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-category-amount">Monthly amount (£)</label>
				<input
					id="budget-category-amount"
					type="number"
					min="0"
					step="0.01"
					bind:value={categoryAmount}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-category-benchmark"
					>ONS benchmark (£/mo)</label
				>
				<input
					id="budget-category-benchmark"
					type="number"
					min="0"
					step="0.01"
					bind:value={categoryBenchmark}
					placeholder="Optional"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>
			<Button type="submit" size="sm"
				>{editingCategoryId === null ? 'Add category' : 'Save changes'}</Button
			>
			{#if editingCategoryId !== null}
				<Button variant="ghost" size="sm" type="button" onclick={resetCategoryForm}>Cancel</Button>
			{/if}
		</form>

		<div class="flex flex-wrap items-center gap-2">
			<span class="text-sm text-muted-foreground"
				>Quick add (illustrative ONS-shaped averages):</span
			>
			{#each ONS_CATEGORY_PRESETS as preset (preset.name)}
				<Button
					variant="outline"
					size="sm"
					type="button"
					disabled={budget.categories.some((category) => category.name === preset.name)}
					onclick={() => addPreset(preset)}
				>
					+ {preset.name}
				</Button>
			{/each}
		</div>
	</Card>

	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Recurring bills</h2>

		{#if budget.bills.length === 0}
			<p class="text-sm text-muted-foreground mb-4">No recurring bills recorded yet.</p>
		{:else}
			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each budget.bills as bill (bill.id)}
					<li
						class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
					>
						<div class="flex flex-col">
							<span class="font-medium">{bill.name}</span>
							<span class="text-sm text-muted-foreground">
								{formatMoney(bill.amount)}
								{BILL_FREQUENCY_LABELS[bill.frequency]} ({formatMoney(billMonthlyAmount(bill))}/mo)
								{#if bill.due_day !== null}
									· due day {bill.due_day}
								{/if}
								{#if categoryName(bill.category_id)}
									· {categoryName(bill.category_id)}
								{/if}
							</span>
							{#if bill.notes !== ''}
								<span class="text-xs text-muted-foreground">{bill.notes}</span>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<Button variant="outline" size="sm" type="button" onclick={() => startEditBill(bill)}>
								Edit
							</Button>
							<Button variant="ghost" size="sm" type="button" onclick={() => removeBill(bill.id)}>
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
				submitBill();
			}}
		>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-bill-name">Name</label>
				<input
					id="budget-bill-name"
					type="text"
					bind:value={billName}
					placeholder="e.g. Council tax"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
					required
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-bill-amount">Amount (£)</label>
				<input
					id="budget-bill-amount"
					type="number"
					min="0"
					step="0.01"
					bind:value={billAmount}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-bill-frequency">Frequency</label>
				<select
					id="budget-bill-frequency"
					bind:value={billFrequency}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				>
					{#each BILL_FREQUENCIES as frequency (frequency)}
						<option value={frequency}>{BILL_FREQUENCY_LABELS[frequency]}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-bill-due-day">Due day</label>
				<input
					id="budget-bill-due-day"
					type="number"
					min="1"
					max="31"
					bind:value={billDueDay}
					placeholder="Optional"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-bill-category">Category</label>
				<select
					id="budget-bill-category"
					bind:value={billCategoryId}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				>
					<option value="">None</option>
					{#each budget.categories as category (category.id)}
						<option value={category.id}>{category.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-bill-notes">Notes</label>
				<input
					id="budget-bill-notes"
					type="text"
					bind:value={billNotes}
					placeholder="Optional"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				/>
			</div>
			<Button type="submit" size="sm">{editingBillId === null ? 'Add bill' : 'Save changes'}</Button
			>
			{#if editingBillId !== null}
				<Button variant="ghost" size="sm" type="button" onclick={resetBillForm}>Cancel</Button>
			{/if}
		</form>
	</Card>

	<BankCsvImport bind:budget />

	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">One-off items</h2>
		<p class="text-sm text-muted-foreground mb-3">
			Ad hoc spend that isn't a recurring bill — kept out of the monthly total above and shown as
			its own figure, since a one-off doesn't repeat next month.
		</p>

		{#if budget.line_items.length === 0}
			<p class="text-sm text-muted-foreground mb-4">No one-off items recorded yet.</p>
		{:else}
			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each budget.line_items as item (item.id)}
					<li
						class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
					>
						<div class="flex flex-col">
							<span class="font-medium">{item.name}</span>
							<span class="text-sm text-muted-foreground">
								{formatMoney(item.amount)}
								{#if categoryName(item.category_id)}
									· {categoryName(item.category_id)}
								{/if}
							</span>
							{#if item.notes !== ''}
								<span class="text-xs text-muted-foreground">{item.notes}</span>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								type="button"
								onclick={() => startEditLineItem(item)}
							>
								Edit
							</Button>
							<Button
								variant="ghost"
								size="sm"
								type="button"
								onclick={() => removeLineItem(item.id)}
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
				submitLineItem();
			}}
		>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-line-item-name">Name</label>
				<input
					id="budget-line-item-name"
					type="text"
					bind:value={lineItemName}
					placeholder="e.g. Washing machine repair"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
					required
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-line-item-amount">Amount (£)</label>
				<input
					id="budget-line-item-amount"
					type="number"
					min="0"
					step="0.01"
					bind:value={lineItemAmount}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-line-item-category">Category</label>
				<select
					id="budget-line-item-category"
					bind:value={lineItemCategoryId}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				>
					<option value="">None</option>
					{#each budget.categories as category (category.id)}
						<option value={category.id}>{category.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="budget-line-item-notes">Notes</label>
				<input
					id="budget-line-item-notes"
					type="text"
					bind:value={lineItemNotes}
					placeholder="Optional"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				/>
			</div>
			<Button type="submit" size="sm"
				>{editingLineItemId === null ? 'Add item' : 'Save changes'}</Button
			>
			{#if editingLineItemId !== null}
				<Button variant="ghost" size="sm" type="button" onclick={resetLineItemForm}>Cancel</Button>
			{/if}
		</form>
	</Card>
</div>
