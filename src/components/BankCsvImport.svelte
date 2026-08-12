<script>
	/**
	 * Bank statement CSV import (issue #267) — the upload/mapping/confirm UI over
	 * `$lib/bank-csv-import.js`'s pure parse/merge logic, the same split `DataManager.svelte` has
	 * with `$lib/csv-import.js`. Sits in its own card in `BudgetTracker.svelte`, beside "One-off
	 * items" (`$lib/bank-csv-import.js`'s module header explains why imported rows land there:
	 * `BudgetLineItem` has no date field, so the mapped date goes into `notes` instead).
	 *
	 * Three phases:
	 *
	 * 1. **`idle`** — a file picker. `csv-import.js`'s own `parseCsv` does the raw RFC 4180 parse;
	 *    a parse failure or an empty file stops here with an error, same as `DataManager.svelte`'s
	 *    CSV import.
	 * 2. **`mapping`** — the header row and up to 5 sample data rows are shown so the user can see
	 *    what they're mapping, plus the column-mapping form itself (`guessBankCsvMapping` pre-fills
	 *    it from the header text so most files need no changes). "Continue" runs the *full* file
	 *    through `parseBankCsvImport` — a row-level parse failure (bad date, non-numeric amount)
	 *    reports every problem and stays on this screen so the mapping can be corrected and
	 *    retried, rather than advancing on a file that still has errors.
	 * 3. **`confirming`** — the parsed rows already exist as real `BudgetLineItem`s at this point;
	 *    this is just the summary + explicit confirm click before they're appended to
	 *    `budget.line_items` (additive, never a replacement — same as every other "Add" in
	 *    `BudgetTracker.svelte`).
	 *
	 * Unlike `DataManager.svelte`'s imports, there is no `flushAppDataSync()` call here: this
	 * component only ever mutates the bindable `budget` prop, the same as `BudgetTracker.svelte`'s
	 * own `submitLineItem` — the page that hosts `BudgetTracker` already owns writing `budget`
	 * changes back into the shared store.
	 */
	import {
		BANK_CSV_DATE_FORMATS,
		guessBankCsvMapping,
		isBankCsvMappingComplete,
		parseBankCsvImport
	} from '$lib/bank-csv-import.js';
	import { parseCsv } from '$lib/csv-import.js';
	import Button from './ui/button.svelte';
	import Card from './ui/card.svelte';

	/** @type {{ budget?: import('$lib/types.js').Budget }} */
	let { budget = $bindable({ categories: [], bills: [], line_items: [] }) } = $props();

	/** @param {number} count @param {string} singular @param {string} [plural] */
	function pluralise(count, singular, plural = `${singular}s`) {
		return `${count} ${count === 1 ? singular : plural}`;
	}

	/** @type {'idle' | 'mapping' | 'confirming'} */
	let phase = $state('idle');
	let notice = $state('');

	let fileError = $state('');

	/** @type {string[]} */
	let header = $state([]);
	/** @type {string[][]} */
	let dataRows = $state([]);
	/** @type {import('$lib/bank-csv-import.js').BankCsvMapping | null} */
	let mapping = $state(null);

	let mappingError = $state('');
	/** @type {import('$lib/types.js').ValidationError[]} */
	let mappingErrors = $state([]);

	/** @type {import('$lib/types.js').BudgetLineItem[]} */
	let pendingLineItems = $state([]);
	/** @type {import('$lib/bank-csv-import.js').BankCsvImportSummary | null} */
	let pendingSummary = $state(null);

	const sampleRows = $derived(dataRows.slice(0, 5));

	function resetToIdle() {
		phase = 'idle';
		header = [];
		dataRows = [];
		mapping = null;
		mappingError = '';
		mappingErrors = [];
		pendingLineItems = [];
		pendingSummary = null;
	}

	/** @param {Event} event */
	async function onFileChosen(event) {
		fileError = '';
		notice = '';

		const input = /** @type {HTMLInputElement} */ (event.target);
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		const text = await file.text();

		/** @type {string[][]} */
		let rows;
		try {
			rows = parseCsv(text);
		} catch (cause) {
			fileError = `That file is not valid CSV: ${cause instanceof Error ? cause.message : String(cause)}`;
			return;
		}
		if (rows.length === 0) {
			fileError = 'That file is empty.';
			return;
		}

		const [fileHeader, ...fileDataRows] = rows;
		header = fileHeader;
		dataRows = fileDataRows;
		mapping = guessBankCsvMapping(fileHeader);
		mappingError = '';
		mappingErrors = [];
		phase = 'mapping';
	}

	function continueMapping() {
		if (!mapping) return;
		mappingError = '';
		mappingErrors = [];

		const result = parseBankCsvImport(dataRows, mapping, budget.categories);
		if (!result.ok) {
			mappingError = result.message;
			mappingErrors = result.errors;
			return;
		}

		pendingLineItems = result.lineItems;
		pendingSummary = result.summary;
		phase = 'confirming';
	}

	function confirmImport() {
		if (!pendingSummary) return;
		budget = { ...budget, line_items: [...budget.line_items, ...pendingLineItems] };
		notice = `Imported. ${pluralise(pendingSummary.records, 'transaction')} added as one-off items (${pendingSummary.matchedCategories} matched an existing category by name, ${pendingSummary.unmatchedCategories} left uncategorised).`;
		resetToIdle();
	}

	function cancel() {
		resetToIdle();
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Import bank statement (CSV)</h2>
	<p class="text-sm text-muted-foreground mb-3">
		Upload a CSV export from your bank — Monzo, Starling, a high-street bank, whatever it is — and
		map its columns to date, description and amount yourself; every bank lays its export out
		differently, so nothing is guessed at blindly. Imported transactions are added as one-off items
		below, on top of whatever is already there. Categorising them can happen afterwards in the usual
		way, unless a mapped category column's text already matches one of your category names.
	</p>

	{#if phase === 'idle'}
		<label class="text-sm font-medium block mb-1" for="bank-csv-file">
			Choose a bank statement CSV file
		</label>
		<input
			id="bank-csv-file"
			type="file"
			accept="text/csv,.csv"
			onchange={onFileChosen}
			class="text-sm"
		/>
		{#if fileError}<p class="text-sm text-red-600 mt-2" role="alert">{fileError}</p>{/if}
	{/if}

	{#if phase === 'mapping' && mapping}
		<div class="border border-border rounded-md p-3 mb-3 overflow-x-auto">
			<p class="text-sm font-medium mb-2">Preview ({pluralise(dataRows.length, 'row')} in file)</p>
			<table class="text-xs border-collapse">
				<thead>
					<tr>
						{#each header as column, index (index)}
							<th class="border border-border px-2 py-1 text-left font-medium"
								>{column || `Column ${index + 1}`}</th
							>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each sampleRows as row, rowIndex (rowIndex)}
						<tr>
							{#each row as cell, columnIndex (columnIndex)}
								<td class="border border-border px-2 py-1">{cell}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="flex flex-col gap-3 mb-3">
			<div class="flex flex-wrap items-end gap-3">
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="bank-csv-date-column">Date column</label>
					<select
						id="bank-csv-date-column"
						bind:value={mapping.dateColumn}
						class="border border-input rounded-md px-2 py-1.5 text-sm"
					>
						<option value={null}>— Select —</option>
						{#each header as column, index (index)}
							<option value={index}>{column || `Column ${index + 1}`}</option>
						{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="bank-csv-date-format">Date format</label>
					<select
						id="bank-csv-date-format"
						bind:value={mapping.dateFormat}
						class="border border-input rounded-md px-2 py-1.5 text-sm"
					>
						{#each BANK_CSV_DATE_FORMATS as format (format.id)}
							<option value={format.id}>{format.label}</option>
						{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="bank-csv-description-column"
						>Description column</label
					>
					<select
						id="bank-csv-description-column"
						bind:value={mapping.descriptionColumn}
						class="border border-input rounded-md px-2 py-1.5 text-sm"
					>
						<option value={null}>— Select —</option>
						{#each header as column, index (index)}
							<option value={index}>{column || `Column ${index + 1}`}</option>
						{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="bank-csv-category-column"
						>Category column (optional)</label
					>
					<select
						id="bank-csv-category-column"
						bind:value={mapping.categoryColumn}
						class="border border-input rounded-md px-2 py-1.5 text-sm"
					>
						<option value={null}>None</option>
						{#each header as column, index (index)}
							<option value={index}>{column || `Column ${index + 1}`}</option>
						{/each}
					</select>
				</div>
			</div>

			<fieldset class="flex flex-wrap items-end gap-4">
				<legend class="text-sm font-medium mb-1">Amount</legend>
				<label class="flex items-center gap-2 text-sm">
					<input
						type="radio"
						name="bank-csv-amount-mode"
						value="signed"
						bind:group={mapping.amountMode}
					/>
					Single amount column (+ in, − out)
				</label>
				<label class="flex items-center gap-2 text-sm">
					<input
						type="radio"
						name="bank-csv-amount-mode"
						value="debit-credit"
						bind:group={mapping.amountMode}
					/>
					Separate Debit / Credit columns
				</label>

				{#if mapping.amountMode === 'signed'}
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium" for="bank-csv-amount-column">Amount column</label>
						<select
							id="bank-csv-amount-column"
							bind:value={mapping.amountColumn}
							class="border border-input rounded-md px-2 py-1.5 text-sm"
						>
							<option value={null}>— Select —</option>
							{#each header as column, index (index)}
								<option value={index}>{column || `Column ${index + 1}`}</option>
							{/each}
						</select>
					</div>
				{:else}
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium" for="bank-csv-debit-column">Debit column</label>
						<select
							id="bank-csv-debit-column"
							bind:value={mapping.debitColumn}
							class="border border-input rounded-md px-2 py-1.5 text-sm"
						>
							<option value={null}>— Select —</option>
							{#each header as column, index (index)}
								<option value={index}>{column || `Column ${index + 1}`}</option>
							{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium" for="bank-csv-credit-column">Credit column</label>
						<select
							id="bank-csv-credit-column"
							bind:value={mapping.creditColumn}
							class="border border-input rounded-md px-2 py-1.5 text-sm"
						>
							<option value={null}>— Select —</option>
							{#each header as column, index (index)}
								<option value={index}>{column || `Column ${index + 1}`}</option>
							{/each}
						</select>
					</div>
				{/if}
			</fieldset>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<Button
				type="button"
				size="sm"
				disabled={!isBankCsvMappingComplete(mapping)}
				onclick={continueMapping}
			>
				Continue
			</Button>
			<Button type="button" variant="outline" size="sm" onclick={cancel}>Cancel</Button>
		</div>

		{#if mappingError}
			<p class="text-sm text-red-600 mt-3" role="alert">{mappingError}</p>
			{#if mappingErrors.length > 0}
				<ul class="text-xs text-red-600 list-disc pl-5 mt-1 max-h-40 overflow-y-auto">
					{#each mappingErrors as err (`${err.path}-${err.message}`)}
						<li><code>{err.path}</code>: {err.message}</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/if}

	{#if phase === 'confirming' && pendingSummary}
		<div class="border border-border rounded-md p-3">
			<p class="text-sm font-medium mb-1">
				{pluralise(pendingSummary.records, 'transaction')} will be added as one-off items:
			</p>
			<p class="text-sm text-muted-foreground mb-3">
				{pendingSummary.matchedCategories} matched an existing category by name, {pendingSummary.unmatchedCategories}
				will be uncategorised. Nothing else currently stored is changed.
			</p>
			<div class="flex flex-wrap items-center gap-2">
				<Button type="button" size="sm" onclick={confirmImport}>Add these transactions</Button>
				<Button type="button" variant="outline" size="sm" onclick={cancel}>Cancel</Button>
			</div>
		</div>
	{/if}

	{#if notice}<p class="text-sm text-green-700 mt-3" role="status">{notice}</p>{/if}
</Card>
