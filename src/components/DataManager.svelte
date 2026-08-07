<script>
	/**
	 * The Settings tab's data management panel (issue #100) — the last piece `README.md`'s
	 * "Persistence modes" section promises: switching storage mode without going through sign-in/
	 * sign-out, and JSON export/import as the manual bridge between the two modes (and a backup
	 * either way). `$lib/data-transfer.js` holds the pure export/import logic; everything here is
	 * DOM wiring — the download link, the file picker, the confirm step.
	 *
	 * Three independent sections:
	 *
	 * 1. **Storage mode.** `$lib/persistence.js`'s `setPersistenceMode` only changes which backend
	 *    *future* saves go to — its own docs say switching does not move data, that is this issue's
	 *    job. So the switch below also calls `flushAppDataSync()` immediately after, which copies
	 *    the document currently open into whichever backend is now active. The mode being switched
	 *    away from is never written to or deleted; only Export + Import move data the other way.
	 *    Hidden — with an explanation, not silently — when this build only has one usable mode
	 *    (`availablePersistenceModes()`, e.g. no GitHub sign-in and no `VITE_GITHUB_TOKEN`).
	 * 2. **Export.** A `Blob` download of whatever `$lib/store.js` currently holds.
	 * 3. **Import.** Parsed and fully validated (`parseImportDocument`) before anything on screen —
	 *    or the store — changes. A rejected file lists what is wrong and leaves the current document
	 *    untouched; a valid file still needs a confirm click, since it replaces everything.
	 *
	 * A fourth, read-only export sits beside JSON (issue #64): a real `.xlsx` workbook built with
	 * `$lib/xlsx-export.js`. It shares Export's `Blob`-download plumbing but not its section — XLSX
	 * is never a re-import source, only JSON round-trips (DESIGN.md → "Data Persistence": "CSV and
	 * XLSX export are secondary, read-only data paths"), so it gets its own card with its own copy
	 * making that explicit rather than living as a second button beside "Export data as JSON" where
	 * it would look like an equivalent choice.
	 */
	import { get } from 'svelte/store';

	import { resolve } from '$app/paths';
	import { exportAppData, parseImportDocument } from '$lib/data-transfer.js';
	import {
		availablePersistenceModes,
		getPersistenceMode,
		setPersistenceMode
	} from '$lib/persistence.js';
	import { appData, flushAppDataSync, syncState } from '$lib/store.js';
	import { XLSX_MIME_TYPE, exportFinancialDataXlsx } from '$lib/xlsx-export.js';
	import Button from './ui/button.svelte';
	import Card from './ui/card.svelte';

	/** @type {Record<import('$lib/persistence.js').PersistenceMode, string>} */
	const MODE_LABELS = { browser: 'This browser only', gist: 'GitHub Gist sync' };

	let mode = $state(getPersistenceMode());
	let availableModes = $state(availablePersistenceModes());
	let modeBusy = $state(false);
	let modeError = $state('');
	let modeNotice = $state('');

	function refreshModes() {
		mode = getPersistenceMode();
		availableModes = availablePersistenceModes();
	}

	/** @param {import('$lib/persistence.js').PersistenceMode} next */
	async function switchMode(next) {
		if (next === mode || modeBusy) return;
		modeError = '';
		modeNotice = '';
		modeBusy = true;
		const fromLabel = MODE_LABELS[mode];

		try {
			setPersistenceMode(next);
		} catch (cause) {
			modeError = cause instanceof Error ? cause.message : String(cause);
			modeBusy = false;
			return;
		}

		await flushAppDataSync();
		const state = get(syncState);
		if (state.error) {
			modeError = state.error;
		} else {
			modeNotice = `Switched to ${MODE_LABELS[next]}. The data you had open has been copied there — ${fromLabel} is untouched.`;
		}
		refreshModes();
		modeBusy = false;
	}

	let exportError = $state('');

	function exportData() {
		exportError = '';
		try {
			const { json, filename } = exportAppData(get(appData));
			const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			link.click();
			URL.revokeObjectURL(url);
		} catch (cause) {
			exportError = cause instanceof Error ? cause.message : String(cause);
		}
	}

	let xlsxExportError = $state('');

	function exportXlsx() {
		xlsxExportError = '';
		try {
			const { bytes, filename } = exportFinancialDataXlsx(get(appData));
			const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME_TYPE }));
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			link.click();
			URL.revokeObjectURL(url);
		} catch (cause) {
			xlsxExportError = cause instanceof Error ? cause.message : String(cause);
		}
	}

	/** @type {'idle' | 'confirming'} */
	let importPhase = $state('idle');
	let importError = $state('');
	/** @type {import('$lib/types.js').ValidationError[]} */
	let importErrors = $state([]);
	let importNotice = $state('');
	let importBusy = $state(false);
	/** @type {import('$lib/types.js').AppData | null} */
	let pendingImport = $state(null);
	let pendingSummary = $state('');

	/** @param {number} count @param {string} singular @param {string} [plural] */
	function pluralise(count, singular, plural = `${singular}s`) {
		return `${count} ${count === 1 ? singular : plural}`;
	}

	/** @param {import('$lib/types.js').AppData} data @returns {string} */
	function summarise(data) {
		return [
			pluralise(data.monthly_entries.length, 'monthly snapshot'),
			pluralise(data.pensions.length, 'pension'),
			pluralise(data.properties.length, 'property', 'properties'),
			pluralise(data.assets.length, 'asset'),
			pluralise(data.dividends.length, 'dividend holding')
		].join(', ');
	}

	/** @param {Event} event */
	async function onFileChosen(event) {
		importError = '';
		importErrors = [];
		importNotice = '';
		pendingImport = null;
		importPhase = 'idle';

		const input = /** @type {HTMLInputElement} */ (event.target);
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		const text = await file.text();
		const result = parseImportDocument(text);
		if (!result.ok) {
			importError = result.message;
			importErrors = result.errors;
			return;
		}
		pendingImport = result.data;
		pendingSummary = summarise(result.data);
		importPhase = 'confirming';
	}

	async function confirmImport() {
		if (!pendingImport) return;
		importBusy = true;
		appData.set(pendingImport);
		await flushAppDataSync();
		const state = get(syncState);
		importNotice = state.error
			? `Imported, but saving it failed: ${state.error}`
			: 'Imported. Your previous data has been replaced with the contents of that file.';
		pendingImport = null;
		pendingSummary = '';
		importPhase = 'idle';
		importBusy = false;
	}

	function cancelImport() {
		pendingImport = null;
		pendingSummary = '';
		importPhase = 'idle';
	}
</script>

<div class="flex flex-col gap-6">
	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-1">Storage mode</h2>
		<p class="text-sm text-muted-foreground mb-3">
			Storage mode right now: <span class="font-medium">{MODE_LABELS[mode]}</span>.
		</p>

		{#if availableModes.length > 1}
			<div class="flex flex-wrap gap-2 mb-2">
				{#each availableModes as candidate (candidate)}
					<Button
						type="button"
						variant={candidate === mode ? 'default' : 'outline'}
						size="sm"
						disabled={modeBusy || candidate === mode}
						onclick={() => switchMode(candidate)}
					>
						{MODE_LABELS[candidate]}
					</Button>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground mb-1">
				Switching copies the data you have open right now into the mode you switch to. The mode you
				switch away from is left exactly as it was — nothing is deleted there, and switching back
				later still finds it.
			</p>
		{:else}
			<p class="text-xs text-muted-foreground mb-1">
				GitHub Gist sync isn't available yet on this browser, so browser-only is the only mode on
				offer here — sign in with GitHub on the
				<a class="underline" href={resolve('/connect')}>Connect GitHub</a> page first.
			</p>
		{/if}

		{#if modeNotice}<p class="text-sm text-green-700 mt-2" role="status">{modeNotice}</p>{/if}
		{#if modeError}<p class="text-sm text-red-600 mt-2" role="alert">{modeError}</p>{/if}
	</Card>

	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-1">Export data</h2>
		<p class="text-sm text-muted-foreground mb-3">
			Downloads everything currently stored as one JSON file — a backup, or the file to bring into
			another browser or a different storage mode via Import below.
		</p>
		<Button type="button" size="sm" onclick={exportData}>Export data as JSON</Button>
		{#if exportError}<p class="text-sm text-red-600 mt-2" role="alert">{exportError}</p>{/if}
	</Card>

	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-1">Export data as Excel</h2>
		<p class="text-sm text-muted-foreground mb-3">
			Downloads a real <code>.xlsx</code> workbook — currently just your net worth history, one row per
			recorded month. This is read-only: unlike the JSON export above, an XLSX file can't be brought back
			in via Import, so it's a spreadsheet for your own use, not a backup.
		</p>
		<Button type="button" size="sm" variant="outline" onclick={exportXlsx}>
			Export data as Excel (.xlsx)
		</Button>
		{#if xlsxExportError}<p class="text-sm text-red-600 mt-2" role="alert">
				{xlsxExportError}
			</p>{/if}
	</Card>

	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-1">Import data</h2>
		<p class="text-sm text-muted-foreground mb-3">
			Replaces everything currently stored with the contents of a JSON file this app exported. The
			file is checked in full before anything changes — a file that fails validation changes
			nothing.
		</p>

		{#if importPhase === 'idle'}
			<label class="text-sm font-medium block mb-1" for="import-file">
				Choose a JSON export file
			</label>
			<input
				id="import-file"
				type="file"
				accept="application/json,.json"
				onchange={onFileChosen}
				class="text-sm"
			/>
		{:else if pendingImport}
			<div class="border border-border rounded-md p-3">
				<p class="text-sm font-medium mb-1">
					This file is valid. Importing will replace everything currently stored with:
				</p>
				<p class="text-sm text-muted-foreground mb-3">{pendingSummary}</p>
				<div class="flex flex-wrap items-center gap-2">
					<Button type="button" size="sm" disabled={importBusy} onclick={confirmImport}>
						{importBusy ? 'Importing…' : 'Replace my data with this file'}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={importBusy}
						onclick={cancelImport}
					>
						Cancel
					</Button>
				</div>
			</div>
		{/if}

		{#if importNotice}<p class="text-sm text-green-700 mt-3" role="status">{importNotice}</p>{/if}
		{#if importError}
			<p class="text-sm text-red-600 mt-3" role="alert">{importError}</p>
			{#if importErrors.length > 0}
				<ul class="text-xs text-red-600 list-disc pl-5 mt-1">
					{#each importErrors as err (err.path)}
						<li><code>{err.path}</code>: {err.message}</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</Card>
</div>
