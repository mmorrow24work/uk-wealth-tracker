/**
 * XLSX export — the SheetJS-backed sibling of `data-transfer.js`'s JSON export (issue #64).
 *
 * A real `.xlsx` workbook, built and downloaded entirely client-side. Same reason JSON export
 * needs no backend: this module never touches `localStorage`, IndexedDB or the network either,
 * and — like `data-transfer.js` — never reads `$lib/store.js` directly. `DataManager.svelte` is
 * the DOM wiring around it, exactly as it already is for JSON.
 *
 * DESIGN.md → "Data Persistence" is explicit that this is one-way: "CSV and XLSX export are
 * secondary, read-only data paths". Nothing here parses a workbook back into `AppData`, and JSON
 * stays the only re-importable format — which is also why the two advisories against the `xlsx`
 * package (SheetJS prototype pollution, GHSA-4r6h-8v6p-xvw6, and its ReDoS sibling,
 * GHSA-5pgg-2g8v-p4x9) do not apply to how it is used here: both are against `XLSX.read` and the
 * parsers it drives, and this module calls `XLSX.utils.book_new`/`book_append_sheet`/`aoa_to_sheet`
 * and `XLSX.write` only — it builds a workbook from `AppData`, it never parses one. Confirmed via
 * `npm audit`, which flags the package but only for the read path.
 *
 * Two layers:
 *
 * 1. **Generic sheet plumbing** — {@link buildSheet} (a column spec plus one row per record, with
 *    per-column number formats and widths) and {@link buildWorkbook} (`book_new` +
 *    `book_append_sheet` over a list of named sheets). This is what every sheet #111 adds will
 *    reuse; nothing below this point is specific to net worth.
 * 2. **One sheet: net worth history.** {@link exportFinancialDataXlsx} restates
 *    `net-worth.js`'s {@link import('./net-worth.js').netWorthSeries} as rows — the export reads
 *    the same numbers the Net Worth chart plots, to the penny, rather than re-deriving them.
 *    #111 appends the holdings/debts/pensions/properties/physical-assets sheets to the same
 *    workbook this function returns; this issue's scope is proving the plumbing against one sheet.
 */

import * as XLSX from 'xlsx';

import { netWorthSeries } from './net-worth.js';

/**
 * @typedef {import('./types.js').AppData} XlsxAppData
 *
 * Named with an `Xlsx` prefix, not reused from `data-transfer.js`'s `TransferAppData`, for the
 * same reason that module gives its own alias: `index.js` re-exports every module with
 * `export *`, and two same-named top-level JSDoc typedefs read as an ambiguous re-export.
 */

/**
 * Preset number formats a column can ask for by name, rather than every call site spelling out an
 * Excel format string. `currency` and `date` are exercised by the net worth sheet below; `percent`
 * and `integer` exist for #111's sheets (gross yield, CAGR, qualifying years) to reuse rather than
 * reinvent.
 *
 * @type {Record<'currency' | 'percent' | 'integer' | 'date', string>}
 */
export const XLSX_NUMBER_FORMATS = {
	currency: '£#,##0.00',
	percent: '0.00%',
	integer: '#,##0',
	date: 'dd/mm/yyyy'
};

/**
 * One column of a sheet: how to label it, how to pull its value out of a row, and how it should be
 * formatted. `value` is a function rather than a property key because the six #111 sheets will
 * each restate a differently-shaped record (a holding, a debt, a pension) into a row — a getter
 * composes with any shape, a dotted key path would not.
 *
 * @typedef {object} XlsxColumn
 * @property {string} header Header cell text, row 1.
 * @property {(row: any) => (string | number | Date | null)} value One cell's contents.
 * @property {keyof typeof XLSX_NUMBER_FORMATS} [format] Looked up in {@link XLSX_NUMBER_FORMATS}.
 * @property {string} [numFmt] An explicit Excel format string, for a column {@link format}'s
 *   presets don't cover. Takes priority over `format` when both are given.
 * @property {number} [width] Column width, in characters (`!cols`' `wch`). Defaults to 14 — wide
 *   enough for `£1,234,567.89` without truncating.
 */

/** Column width applied when a {@link XlsxColumn} doesn't specify its own. */
const DEFAULT_COLUMN_WIDTH = 14;

/**
 * Build one worksheet: a header row from `columns[].header`, then one row per record with each
 * cell read through that column's `value` and stamped with its number format.
 *
 * `aoa_to_sheet` (array-of-arrays) rather than `json_to_sheet` because a column's `header` and its
 * `value` getter are already the header/cell split `json_to_sheet` would otherwise have to infer
 * from object keys — going through arrays keeps column order exactly the order `columns` was
 * given in, which `json_to_sheet` cannot guarantee once keys vary row to row.
 *
 * A `Date` value (as {@link import('./net-worth.js').NetWorthPoint}'s `date` field already is) is
 * written as a real Excel date cell rather than a plain serial number — `aoa_to_sheet`'s own
 * default for a JS `Date` is a numeric cell (`t: 'n'`) that merely *displays* as a date via its
 * default `m/d/yy` format; `{ cellDates: true }` is what makes the cell itself typed `'d'`, which
 * matters once a column's own {@link XlsxColumn.numFmt} (`'mmm yyyy'` below) replaces that default
 * format — a `'d'` cell keeps reading as a date in Excel under any format, a plain `'n'` cell would
 * too, but only `'d'` is what a spreadsheet or a downstream script reads back as "this is a date"
 * rather than "this is a number that happens to be formatted like one".
 *
 * @param {readonly XlsxColumn[]} columns
 * @param {readonly any[]} rows
 * @returns {import('xlsx').WorkSheet}
 */
export function buildSheet(columns, rows) {
	const header = columns.map((column) => column.header);
	const body = rows.map((row) => columns.map((column) => column.value(row)));
	const worksheet = XLSX.utils.aoa_to_sheet([header, ...body], { cellDates: true });

	columns.forEach((column, columnIndex) => {
		const format =
			column.numFmt ?? (column.format ? XLSX_NUMBER_FORMATS[column.format] : undefined);
		if (!format) return;
		for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
			const address = XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex });
			const cell = worksheet[address];
			// A `null`/`undefined` cell value gives `aoa_to_sheet` nothing to create a cell for
			// (SheetJS leaves the address unset rather than writing an empty one), so there is no
			// cell here to stamp a format onto — a blank box in Excel, not a "£0.00".
			if (cell) cell.z = format;
		}
	});

	worksheet['!cols'] = columns.map((column) => ({ wch: column.width ?? DEFAULT_COLUMN_WIDTH }));
	return worksheet;
}

/**
 * Assemble a workbook from a list of named sheets, in the order given.
 *
 * @param {readonly { name: string, worksheet: import('xlsx').WorkSheet }[]} sheets
 * @returns {import('xlsx').WorkBook}
 */
export function buildWorkbook(sheets) {
	const workbook = XLSX.utils.book_new();
	for (const { name, worksheet } of sheets) {
		XLSX.utils.book_append_sheet(workbook, worksheet, name);
	}
	return workbook;
}

/**
 * The sheet name every consumer (this module, and #111's) should use for the net worth history
 * sheet — exported so #111 can append its own sheets to the same workbook without duplicating this
 * string.
 */
export const NET_WORTH_HISTORY_SHEET_NAME = 'Net Worth History';

/**
 * The net worth history sheet's columns: `net-worth.js`'s {@link import('./net-worth.js').NetWorthPoint}
 * restated as one row per recorded month, oldest first — the same points, same rounding, same
 * order the Net Worth chart plots, so the workbook agrees with the chart to the penny.
 *
 * @type {XlsxColumn[]}
 */
const NET_WORTH_HISTORY_COLUMNS = [
	{ header: 'Month', value: (point) => point.date, numFmt: 'mmm yyyy', width: 12 },
	{ header: 'Investments', value: (point) => point.investments, format: 'currency' },
	{ header: 'Debts', value: (point) => point.debts, format: 'currency' },
	{ header: 'Net Worth', value: (point) => point.net_worth, format: 'currency' }
];

/**
 * A filename carrying today's date, mirroring `data-transfer.js`'s
 * {@link import('./data-transfer.js').suggestExportFilename} exactly but for `.xlsx` — so a JSON
 * export and an XLSX export made the same day sort next to each other in a downloads folder
 * instead of interleaving with unrelated files between them.
 *
 * @param {string} exportedAt ISO date-time.
 * @returns {string}
 */
export function suggestXlsxExportFilename(exportedAt) {
	const datePart = exportedAt.slice(0, 10);
	return `uk-wealth-tracker-export-${datePart || 'unknown-date'}.xlsx`;
}

/**
 * Build the XLSX workbook and return its bytes, ready to hand to a `Blob`.
 *
 * `{ type: 'array', bookType: 'xlsx' }` is what makes the return value a `Blob`-ready
 * `ArrayBuffer` rather than a base64 string or a Node `Buffer` (SheetJS supports both, but neither
 * exists as a useful type in a browser tab) — `new Blob([bytes], { type: XLSX_MIME_TYPE })` in
 * `DataManager.svelte` takes it directly, the same shape `data-transfer.js`'s `json` string does
 * for the JSON export's `Blob`.
 *
 * Only the net worth history sheet exists yet (#64's scope); #111 appends the other five sheets
 * to the same {@link buildWorkbook} call.
 *
 * @param {XlsxAppData} data
 * @param {{ exportedAt?: string }} [options] `exportedAt` defaults to now; only ever overridden by
 *   tests, matching `data-transfer.js`'s `exportAppData`.
 * @returns {{ bytes: ArrayBuffer, filename: string }}
 */
export function exportFinancialDataXlsx(data, { exportedAt = new Date().toISOString() } = {}) {
	const points = netWorthSeries(data.monthly_entries);
	const worksheet = buildSheet(NET_WORTH_HISTORY_COLUMNS, points);
	const workbook = buildWorkbook([{ name: NET_WORTH_HISTORY_SHEET_NAME, worksheet }]);
	const bytes = /** @type {ArrayBuffer} */ (
		XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
	);

	return { bytes, filename: suggestXlsxExportFilename(exportedAt) };
}

/** The MIME type an XLSX `Blob` download should be given. */
export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
