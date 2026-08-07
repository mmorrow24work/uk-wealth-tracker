<script>
	/**
	 * XLSX export (issue #64) — a single button that hands the whole document to
	 * `$lib/xlsx-export.js` as a `.xlsx` download. No backend involved, same as the JSON export
	 * planned for issue #100: everything happens in the browser, from the store's current value.
	 *
	 * Reads `appData` from the store directly (`$appData`) rather than taking it as a prop —
	 * unlike `InvestmentHoldings`/`DebtTracker`, which only ever touch one or two collections and
	 * so take those as bindable props, this needs the whole document (pensions, properties, assets
	 * included), and there is nowhere sensible on the dashboard page to thread six extra props
	 * through just for this one button.
	 */
	import { appData } from '$lib/index.js';
	import { defaultXlsxFilename, exportAppDataToXlsx } from '$lib/xlsx-export.js';
	import Button from './ui/button.svelte';
	import Card from './ui/card.svelte';

	let notice = $state('');

	function exportData() {
		const filename = defaultXlsxFilename();
		exportAppDataToXlsx($appData, filename);
		notice = `Downloaded ${filename}.`;
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Export data</h2>
	<p class="text-sm text-muted-foreground mb-3">
		Download everything you've recorded — net worth history, holdings, debts, pensions, properties
		and physical assets — as an Excel workbook, one sheet per collection. Generated entirely in this
		browser; nothing is sent anywhere.
	</p>
	<Button type="button" size="sm" onclick={exportData}>Export to Excel (.xlsx)</Button>
	{#if notice}<p class="text-xs text-muted-foreground mt-2">{notice}</p>{/if}
</Card>
