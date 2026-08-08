/**
 * CSV export — the third, simpler export format alongside `data-transfer.js`'s JSON and
 * `xlsx-export.js`'s XLSX (issue #129), for a GDPR Article 20 data-portability request or a quick
 * import into whatever spreadsheet tool someone actually reaches for.
 *
 * Pure logic only, exactly like its two siblings: this module never touches `localStorage`,
 * IndexedDB or the network, and never reads `$lib/store.js` directly. `DataManager.svelte` is the
 * DOM wiring around it, same as it already is for JSON and XLSX.
 *
 * Read-only, like XLSX. DESIGN.md → "Data Persistence": "CSV and XLSX export are secondary,
 * read-only data paths" — nothing here parses a CSV back into `AppData`, and JSON stays the only
 * re-importable format.
 *
 * One file per dataset rather than one flat table, per the issue's own instruction — net worth
 * history, holdings and debts don't share a column shape, and forcing them into a single table
 * would mean either a ragged column set or three datasets' worth of blank cells in every row. Three
 * files also means three separate downloads rather than a bundled ZIP: no ZIP library is otherwise
 * needed anywhere in this app, and `DataManager.svelte` already has a working multi-button pattern
 * (Export/XLSX/Import) for offering several related downloads side by side.
 *
 * Reuses `xlsx-export.js`'s row-shaping wholesale rather than re-deriving it, per the issue: the
 * three datasets here are exactly its net worth history/holdings/debts sheets (net-worth-history,
 * holdings and debts — pensions/properties/physical assets are out of scope, per the issue's own
 * title), so {@link import('./xlsx-export.js').NET_WORTH_HISTORY_COLUMNS}, its `HOLDINGS_COLUMNS`
 * and `DEBTS_COLUMNS`, plus its `expandHoldingRows`/`expandDebtRows` row-expansion, are imported
 * directly — this module only adds a CSV cell serialiser ({@link columnsToCsv}) as the sibling of
 * that module's `buildSheet`, over the same `XlsxColumn[]` column spec.
 */

import { netWorthSeries } from './net-worth.js';
import {
	DEBTS_COLUMNS,
	HOLDINGS_COLUMNS,
	NET_WORTH_HISTORY_COLUMNS,
	expandDebtRows,
	expandHoldingRows
} from './xlsx-export.js';

/**
 * @typedef {import('./types.js').AppData} CsvAppData
 *
 * Named with a `Csv` prefix for the same reason `xlsx-export.js`'s `XlsxAppData` is: `index.js`
 * re-exports every module with `export *`, and two same-named top-level JSDoc typedefs read as an
 * ambiguous re-export.
 */

/**
 * One CSV row's worth of a cell value, turned into the text that goes on the wire. A cell's
 * {@link import('./xlsx-export.js').XlsxColumn.value} getter already returns exactly what
 * `buildSheet` would write into an Excel cell — a `Date`, a number already converted by
 * `percentFraction`/`isoDateToUtcDate`, a string, or `null` — so this reads that same value and
 * only decides how to print it, not what it is.
 *
 * - `null`/`undefined` → `''`, matching `buildSheet`'s own null-stays-blank rule (a fee never
 *   entered reads as an empty cell, not a stated `0.00%` or `0.00`).
 * - A `Date` → an ISO `YYYY-MM-DD` string. Every date column in `xlsx-export.js` (`Month`, `Deal
 *   Expiry`, `Purchase Date`) is UTC-midnight already, so `toISOString().slice(0, 10)` never
 *   crosses a day boundary the way reading `.getDate()` in a non-UTC locale could. ISO over
 *   `dd/mm/yyyy` specifically because CSV has no cell type to disambiguate a date from text, and a
 *   spreadsheet reading `03/04/2026` back in guesses the field order from its own locale — ISO is
 *   the one format every reader parses the same way.
 * - A `currency`-formatted column → fixed to 2dp, as a bare number (no `£`), so the column stays
 *   numeric on re-open (summable, sortable) rather than text a spreadsheet must be told to parse.
 * - A `percent`-formatted column → the same fraction `percentFraction` produced, multiplied back
 *   out to a percentage and suffixed `%` (`0.0022` → `'0.22%'`), matching the number Excel's own
 *   `0.00%` format would render that cell as — the CSV and XLSX exports agree on every figure they
 *   share, not just the ones with no formatting to disagree about.
 * - Anything else (a plain number, an enum label, a name, `Yes`/`No`, notes) → `String(value)`
 *   as-is; `xlsx-export.js` has already done any lookup/derivation this column needed.
 *
 * @param {import('./xlsx-export.js').XlsxColumn} column
 * @param {string | number | Date | null | undefined} value `undefined` is not a value any
 *   `XlsxColumn.value` getter actually returns (its own type is `string | number | Date | null`),
 *   but is accepted and treated the same as `null` regardless, so a column getter that omits an
 *   explicit `return` doesn't produce a literal `'undefined'` cell.
 * @returns {string}
 */
export function formatCsvValue(column, value) {
	if (value === null || value === undefined) return '';
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	const numeric = /** @type {number} */ (value);
	if (column.format === 'currency') return numeric.toFixed(2);
	if (column.format === 'percent') return `${(numeric * 100).toFixed(2)}%`;
	return String(value);
}

/**
 * RFC 4180 field escaping: a field containing a comma, a double quote or a line break is wrapped in
 * double quotes, with any double quote inside it doubled. Every other field is written bare —
 * quoting everything would still be valid CSV, but leaving plain fields unquoted is what makes a
 * quick `less`/`cat` of the file actually readable, and is what every spreadsheet app itself writes.
 *
 * @param {string} field
 * @returns {string}
 */
export function csvEscapeField(field) {
	return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/**
 * The CSV sibling of `xlsx-export.js`'s `buildSheet`: a header row from `columns[].header`, then
 * one row per record with each cell read through that column's `value` getter and
 * {@link formatCsvValue}. `\r\n` line endings throughout (including after the final row), per RFC
 * 4180 — the line ending Excel itself writes, and the one every CSV parser is guaranteed to accept.
 *
 * @param {readonly import('./xlsx-export.js').XlsxColumn[]} columns
 * @param {readonly any[]} rows
 * @returns {string}
 */
export function columnsToCsv(columns, rows) {
	const header = columns.map((column) => column.header);
	const body = rows.map((row) =>
		columns.map((column) => formatCsvValue(column, column.value(row)))
	);
	return [header, ...body].map((line) => line.map(csvEscapeField).join(',')).join('\r\n') + '\r\n';
}

/**
 * A UTF-8 byte-order mark, prepended to every CSV this module produces. Every dataset here can
 * carry free-text (`Notes`, holding/debt/pension names) outside the ASCII range, and Excel — unlike
 * every other reader — assumes a BOM-less `.csv` is in the system codepage rather than UTF-8,
 * mangling anything non-ASCII on open. A BOM tells it (and everything else) unambiguously that the
 * bytes that follow are UTF-8; readers that already assume UTF-8 either strip it automatically or
 * treat it as a harmless zero-width character.
 */
const CSV_BOM = String.fromCharCode(0xfeff);

/**
 * The MIME type a CSV `Blob` download should be given.
 */
export const CSV_MIME_TYPE = 'text/csv;charset=utf-8';

/**
 * A filename carrying today's date and which dataset it is, mirroring `data-transfer.js`'s
 * `suggestExportFilename`/`xlsx-export.js`'s `suggestXlsxExportFilename` but with a dataset slug in
 * the middle — three CSVs exported the same day need three distinct names, unlike the single-file
 * JSON/XLSX exports.
 *
 * @param {string} exportedAt ISO date-time.
 * @param {string} datasetSlug e.g. `'net-worth-history'`.
 * @returns {string}
 */
export function suggestCsvExportFilename(exportedAt, datasetSlug) {
	const datePart = exportedAt.slice(0, 10);
	return `uk-wealth-tracker-export-${datasetSlug}-${datePart || 'unknown-date'}.csv`;
}

/**
 * The net worth history CSV: `net-worth.js`'s {@link import('./net-worth.js').netWorthSeries}
 * restated as one row per recorded month, oldest first — the same points, same rounding, same
 * order the Net Worth chart plots and the XLSX export's Net Worth History sheet carries, so all
 * three agree to the penny.
 *
 * @param {CsvAppData} data
 * @param {{ exportedAt?: string }} [options] `exportedAt` defaults to now; only ever overridden by
 *   tests, matching `exportAppData`/`exportFinancialDataXlsx`.
 * @returns {{ csv: string, filename: string }}
 */
export function exportNetWorthHistoryCsv(data, { exportedAt = new Date().toISOString() } = {}) {
	const points = netWorthSeries(data.monthly_entries);
	return {
		csv: CSV_BOM + columnsToCsv(NET_WORTH_HISTORY_COLUMNS, points),
		filename: suggestCsvExportFilename(exportedAt, 'net-worth-history')
	};
}

/**
 * The holdings CSV: `AppData.monthly_entries` expanded into one row per holding per recorded
 * month, exactly as the XLSX export's Holdings sheet is — the lossless shape, not a collapse to
 * "current" that would drop the history the JSON export still carries.
 *
 * @param {CsvAppData} data
 * @param {{ exportedAt?: string }} [options]
 * @returns {{ csv: string, filename: string }}
 */
export function exportHoldingsCsv(data, { exportedAt = new Date().toISOString() } = {}) {
	return {
		csv: CSV_BOM + columnsToCsv(HOLDINGS_COLUMNS, expandHoldingRows(data.monthly_entries)),
		filename: suggestCsvExportFilename(exportedAt, 'holdings')
	};
}

/**
 * The debts CSV: `AppData.monthly_entries` expanded into one row per debt per recorded month,
 * matching {@link exportHoldingsCsv} and the XLSX export's Debts sheet.
 *
 * @param {CsvAppData} data
 * @param {{ exportedAt?: string }} [options]
 * @returns {{ csv: string, filename: string }}
 */
export function exportDebtsCsv(data, { exportedAt = new Date().toISOString() } = {}) {
	return {
		csv: CSV_BOM + columnsToCsv(DEBTS_COLUMNS, expandDebtRows(data.monthly_entries)),
		filename: suggestCsvExportFilename(exportedAt, 'debts')
	};
}
