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
 *    `book_append_sheet` over a list of named sheets). This is what every sheet #111 and #113 add
 *    reuse; nothing below this point is specific to net worth.
 * 2. **Three sheets: net worth history, holdings, debts.** {@link exportFinancialDataXlsx}
 *    restates `net-worth.js`'s {@link import('./net-worth.js').netWorthSeries} as rows for the
 *    first — the export reads the same numbers the Net Worth chart plots, to the penny, rather
 *    than re-deriving them. Holdings and Debts are the two `monthly_entries`-derived sheets
 *    (issue #111): every `Investment`/`Debt` is re-stated fresh each month (`model.js`'s
 *    convention), so the lossless shape is one row per holding/debt *per month*, not a collapse
 *    to "current" — collapsing would silently drop the history the JSON export preserves.
 *    #113 appends the pensions/properties/physical-assets sheets to the same workbook this
 *    function returns, reusing {@link enumLabel} and {@link percentFraction} below.
 */

import * as XLSX from 'xlsx';

import { compareMonthlyEntries } from './model.js';
import {
	CONTRIBUTION_FREQUENCY_LABELS,
	DEBT_TYPE_LABELS,
	INVESTMENT_TYPE_LABELS,
	WRAPPER_LABELS
} from './enums.js';
import { monthStartDate, netWorthSeries } from './net-worth.js';

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
 * is exercised by the holdings sheet's `Fund Fee`/`Ownership %` columns; `integer` exists for
 * #113's sheets (gross yield, CAGR, qualifying years) to reuse rather than reinvent.
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
 * formatted. `value` is a function rather than a property key because the six sheets across #111
 * and #113 each restate a differently-shaped record (a holding, a debt, a pension) into a row — a
 * getter composes with any shape, a dotted key path would not.
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
 * Enum code → its `enums.js` `*_LABELS` string, e.g. `enumLabel(INVESTMENT_TYPE_LABELS, 'gia')` →
 * `'General Investment Account'`. A generic function rather than every column value getter
 * indexing its `*_LABELS` map directly, because {@link XlsxColumn.value}'s `row` is `any` by
 * design (each sheet restates a differently-shaped record) and `jsconfig.json`'s `noImplicitAny`
 * rejects indexing a closed `Record<Code, string>` with an `any` expression. Exported so #113's
 * pensions/properties/physical-assets sheets reuse it rather than reinventing it.
 *
 * @param {Record<string, string>} labels One of `enums.js`'s `*_LABELS` maps.
 * @param {string} code The stored enum code.
 * @returns {string}
 */
export function enumLabel(labels, code) {
	return labels[code];
}

/**
 * `model.js` stores whole-number percents (`5` means 5%), but Excel's `0.00%` format expects the
 * cell value already divided by 100 — it multiplies by 100 itself when rendering. `null` passes
 * through unchanged so a not-recorded percent (e.g. a pension fee never entered, for #113) stays a
 * blank cell rather than becoming `0.00%`, which would read as "this fee is zero" instead of "this
 * fee is unknown". Exported so #113 reuses it rather than reinventing it.
 *
 * @param {number | null} value A whole-number percent, or `null` if not recorded.
 * @returns {number | null}
 */
export function percentFraction(value) {
	return value === null ? null : value / 100;
}

/**
 * The sheet name every consumer (this module, and #113's) should use for the net worth history
 * sheet — exported so #113 can append its own sheets to the same workbook without duplicating this
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

/** The sheet name for the holdings sheet — exported for the same reason as {@link NET_WORTH_HISTORY_SHEET_NAME}. */
export const HOLDINGS_SHEET_NAME = 'Holdings';

/** The sheet name for the debts sheet — exported for the same reason as {@link NET_WORTH_HISTORY_SHEET_NAME}. */
export const DEBTS_SHEET_NAME = 'Debts';

/**
 * One holding, at one recorded month — the row shape {@link HOLDINGS_COLUMNS}' getters read from.
 *
 * @typedef {object} HoldingRow
 * @property {number} month
 * @property {number} year
 * @property {import('./types.js').Investment} investment
 */

/**
 * One debt, at one recorded month — the row shape {@link DEBTS_COLUMNS}' getters read from.
 *
 * @typedef {object} DebtRow
 * @property {number} month
 * @property {number} year
 * @property {import('./types.js').Debt} debt
 */

/**
 * Flatten every monthly entry's investments into one row per holding per month, oldest month
 * first. Holdings are re-stated fresh every month rather than mutated (`model.js`/`types.js`
 * convention), so this is the lossless shape — collapsing to "current" would silently drop the
 * history the JSON export already preserves.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {HoldingRow[]}
 */
function flattenHoldingRows(entries) {
	const rows = [];
	for (const entry of [...entries].sort(compareMonthlyEntries)) {
		for (const investment of entry.investments) {
			rows.push({ month: entry.month, year: entry.year, investment });
		}
	}
	return rows;
}

/**
 * As {@link flattenHoldingRows}, but over each entry's `debts`.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {DebtRow[]}
 */
function flattenDebtRows(entries) {
	const rows = [];
	for (const entry of [...entries].sort(compareMonthlyEntries)) {
		for (const debt of entry.debts) {
			rows.push({ month: entry.month, year: entry.year, debt });
		}
	}
	return rows;
}

/**
 * The holdings sheet's columns, in `Investment`'s own field order. `Year Purchased` deliberately
 * has no `format`/`numFmt` — the `integer` preset (`#,##0`) would print a four-digit year as
 * `1,996`; leaving it `General` shows it as typed. `Fund Fee` and `Ownership %` go through
 * {@link percentFraction} so the `percent` format reads them correctly. `Included in Net Worth`
 * restates `exclude_from_net_worth` as a readable Yes/No column rather than dropping excluded
 * rows, so the export stays lossless.
 *
 * @type {XlsxColumn[]}
 */
const HOLDINGS_COLUMNS = [
	{ header: 'Month', value: (row) => monthStartDate(row), numFmt: 'mmm yyyy', width: 12 },
	{ header: 'Name', value: (row) => row.investment.name, width: 24 },
	{ header: 'Type', value: (row) => enumLabel(INVESTMENT_TYPE_LABELS, row.investment.type) },
	{
		header: 'Wrapper',
		value: (row) => enumLabel(WRAPPER_LABELS, row.investment.wrapper),
		width: 24
	},
	{ header: 'Value', value: (row) => row.investment.value, format: 'currency' },
	{ header: 'Bought For', value: (row) => row.investment.bought_for, format: 'currency' },
	{ header: 'Year Purchased', value: (row) => row.investment.year_purchased },
	{
		header: 'Monthly Contribution',
		value: (row) => row.investment.monthly_contribution,
		format: 'currency',
		width: 18
	},
	{
		header: 'Contribution Frequency',
		value: (row) => enumLabel(CONTRIBUTION_FREQUENCY_LABELS, row.investment.contribution_frequency),
		width: 20
	},
	{
		header: 'Fund Fee',
		value: (row) => percentFraction(row.investment.fund_fee),
		format: 'percent'
	},
	{
		header: 'Ownership %',
		value: (row) => percentFraction(row.investment.ownership_pct),
		format: 'percent'
	},
	{ header: 'Notes', value: (row) => row.investment.notes, width: 30 },
	{
		header: 'Included in Net Worth',
		value: (row) => (row.investment.exclude_from_net_worth ? 'No' : 'Yes'),
		width: 18
	}
];

/**
 * The debts sheet's columns, in `Debt`'s own field order — as {@link HOLDINGS_COLUMNS}, but over
 * the smaller `Debt` shape.
 *
 * @type {XlsxColumn[]}
 */
const DEBTS_COLUMNS = [
	{ header: 'Month', value: (row) => monthStartDate(row), numFmt: 'mmm yyyy', width: 12 },
	{ header: 'Name', value: (row) => row.debt.name, width: 24 },
	{ header: 'Type', value: (row) => enumLabel(DEBT_TYPE_LABELS, row.debt.type) },
	{ header: 'Balance', value: (row) => row.debt.balance, format: 'currency' },
	{ header: 'Notes', value: (row) => row.debt.notes, width: 30 },
	{
		header: 'Included in Net Worth',
		value: (row) => (row.debt.exclude_from_net_worth ? 'No' : 'Yes'),
		width: 18
	}
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
 * Net Worth History, Holdings and Debts exist so far (#64's and #111's scope, in that sheet
 * order); #113 appends the pensions/properties/physical-assets sheets to the same
 * {@link buildWorkbook} call.
 *
 * @param {XlsxAppData} data
 * @param {{ exportedAt?: string }} [options] `exportedAt` defaults to now; only ever overridden by
 *   tests, matching `data-transfer.js`'s `exportAppData`.
 * @returns {{ bytes: ArrayBuffer, filename: string }}
 */
export function exportFinancialDataXlsx(data, { exportedAt = new Date().toISOString() } = {}) {
	const points = netWorthSeries(data.monthly_entries);
	const netWorthHistorySheet = buildSheet(NET_WORTH_HISTORY_COLUMNS, points);
	const holdingsSheet = buildSheet(HOLDINGS_COLUMNS, flattenHoldingRows(data.monthly_entries));
	const debtsSheet = buildSheet(DEBTS_COLUMNS, flattenDebtRows(data.monthly_entries));
	const workbook = buildWorkbook([
		{ name: NET_WORTH_HISTORY_SHEET_NAME, worksheet: netWorthHistorySheet },
		{ name: HOLDINGS_SHEET_NAME, worksheet: holdingsSheet },
		{ name: DEBTS_SHEET_NAME, worksheet: debtsSheet }
	]);
	const bytes = /** @type {ArrayBuffer} */ (
		XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
	);

	return { bytes, filename: suggestXlsxExportFilename(exportedAt) };
}

/** The MIME type an XLSX `Blob` download should be given. */
export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
