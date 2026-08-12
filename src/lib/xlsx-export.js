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
 *    `book_append_sheet` over a list of named sheets). This is what every sheet #111/#113 adds
 *    reuses; nothing below this point is specific to net worth.
 * 2. **Six sheets: net worth history, holdings, debts, pensions, properties, physical assets.**
 *    {@link exportFinancialDataXlsx} restates `net-worth.js`'s
 *    {@link import('./net-worth.js').netWorthSeries} as rows for the first, expands
 *    `AppData.monthly_entries` into one row per holding/debt per recorded month for the next two
 *    (#111) — the same numbers the Net Worth chart plots and the monthly snapshots hold, to the
 *    penny, rather than re-deriving or collapsing them — and restates `AppData.pensions`/
 *    `properties`/`assets` as one row per record, flat, with no month column, for the last three
 *    (#113), reusing {@link enumLabel} and {@link percentFraction} throughout.
 *
 * The net worth history/holdings/debts column specs ({@link NET_WORTH_HISTORY_COLUMNS},
 * {@link HOLDINGS_COLUMNS}, {@link DEBTS_COLUMNS}) and the two row-expansion helpers
 * ({@link expandHoldingRows}, {@link expandDebtRows}) are exported so `./csv-export.js` (#129) can
 * restate the exact same rows as CSV text instead of workbook cells — the row-shaping (which
 * fields, in which order, enum codes resolved to labels) stays defined once, here.
 */

import * as XLSX from 'xlsx';

import {
	ASSET_CATEGORY_LABELS,
	CONTRIBUTION_FREQUENCY_LABELS,
	DEBT_TYPE_LABELS,
	INVESTMENT_TYPE_LABELS,
	MORTGAGE_TYPE_LABELS,
	PENSION_TYPE_LABELS,
	PROPERTY_TYPE_LABELS,
	WRAPPER_LABELS
} from './enums.js';
import { compareMonthlyEntries } from './model.js';
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
 * is also used by the holdings sheet's fee/ownership columns and the pensions/properties/physical
 * assets sheets' rate columns; `integer` is used by the pensions sheet's year counts (DB years, NI
 * qualifying/future years).
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
 * formatted. `value` is a function rather than a property key because #111's and #113's sheets each
 * restate a differently-shaped record (a holding, a debt, a pension) into a row — a getter
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
 * An enum code's human-readable `enums.js` label, e.g. `enumLabel(INVESTMENT_TYPE_LABELS, 'gia')`
 * → `'General Investment Account'`. A function rather than every sheet indexing its `*_LABELS` map
 * directly, because a {@link XlsxColumn.value}'s `row` is `any` by design (each sheet restates a
 * differently-shaped record) and `jsconfig.json`'s `noImplicitAny`/`strict` rejects indexing a
 * closed `Record<Code, string>` with an `any`-typed expression — this one generic function is
 * where that cast happens, once, instead of at every call site.
 *
 * @template {string} Code
 * @param {Record<Code, string>} labels One of `enums.js`'s `*_LABELS` maps.
 * @param {Code} code
 * @returns {string}
 */
export function enumLabel(labels, code) {
	return labels[code];
}

/**
 * Turn a stored whole-number percent (`model.js`'s convention — `5` means 5%) into the fraction a
 * `0.00%` Excel format expects (`0.05`). Excel's percent format multiplies the underlying cell
 * value by 100 for display, so writing the stored `5` straight into a `0.00%` cell would show
 * `500.00%`.
 *
 * `null` passes through as `null` rather than becoming `0` — a fee that was never entered
 * (`fund_fee`/`ownership_pct` can be `null`) should read as a blank cell, not a stated `0.00%`,
 * matching {@link buildSheet}'s own null-stays-blank rule.
 *
 * @param {number | null} value
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
 * Exported (not just module-local) so `csv-export.js` (#129) can restate the same rows as CSV
 * without re-deriving which fields make up this dataset or how each is shaped — only the output
 * format (a sheet cell vs a CSV cell) differs between the two modules.
 *
 * @type {XlsxColumn[]}
 */
export const NET_WORTH_HISTORY_COLUMNS = [
	{ header: 'Month', value: (point) => point.date, numFmt: 'mmm yyyy', width: 12 },
	{ header: 'Investments', value: (point) => point.investments, format: 'currency' },
	{ header: 'Debts', value: (point) => point.debts, format: 'currency' },
	{ header: 'Net Worth', value: (point) => point.net_worth, format: 'currency' }
];

/**
 * `Yes`/`No` for a record's `exclude_from_net_worth` flag, phrased as the positive "Included in
 * net worth" a reader wants rather than the negated field name — the holdings and debts sheets
 * keep every row (issue #111: "honour `exclude_from_net_worth` ... as a readable column rather
 * than dropping the rows"), so this is the only place that flag surfaces.
 *
 * @param {{ exclude_from_net_worth: boolean }} record
 * @returns {'Yes' | 'No'}
 */
function includedInNetWorth(record) {
	return record.exclude_from_net_worth ? 'No' : 'Yes';
}

/**
 * `Yes`/`No` for a record's own `include_in_net_worth` flag — Property and Asset spell this the
 * positive way round (README.md's outline, not this codebase's choice), the opposite of
 * investments/debts' `exclude_from_net_worth` above, but the column reads the same either way.
 *
 * @param {{ include_in_net_worth: boolean }} record
 * @returns {'Yes' | 'No'}
 */
function includeInNetWorth(record) {
	return record.include_in_net_worth ? 'Yes' : 'No';
}

/**
 * An ISO `YYYY-MM-DD` date string as a UTC-midnight `Date`, the same convention
 * `net-worth.js`'s `monthStartDate` and `property.js`'s `dealExpiryStatus`/`assets.js`'s
 * `assetAge` already use — a local-midnight `Date` reads a day early in any timezone west of
 * Greenwich. `null` passes through as `null`, matching {@link percentFraction}'s null-stays-blank
 * rule, since `Property.deal_expiry` and `Asset.purchase_date` are both `string | null`.
 *
 * @param {string | null} isoDate
 * @returns {Date | null}
 */
function isoDateToUtcDate(isoDate) {
	return isoDate === null ? null : new Date(`${isoDate}T00:00:00.000Z`);
}

/**
 * The sheet name for the holdings sheet, exported so #113 can append its own sheets after it
 * without duplicating this string.
 */
export const HOLDINGS_SHEET_NAME = 'Holdings';

/**
 * One row: a single {@link import('./types.js').Investment} as it stood in one recorded month.
 *
 * @typedef {object} HoldingRow
 * @property {Date} month `monthStartDate` of the entry the holding was recorded in.
 * @property {import('./types.js').Investment} investment
 */

/**
 * `monthly_entries` restates every holding fresh each month (`model.js`/`types.js`'s convention —
 * see the module doc comment), so the lossless export is one row per holding per month it was
 * recorded in, not a collapse to "current" that would silently drop the history the JSON export
 * still carries. Entries are sorted oldest first via `model.js`'s `compareMonthlyEntries`, the
 * same ordering `netWorthSeries` uses, before flattening — a holding present across several months
 * appears once per month, at that month's value.
 *
 * Exported for the same reason {@link NET_WORTH_HISTORY_COLUMNS} is — `csv-export.js` (#129) reuses
 * this expansion rather than re-deriving the one-row-per-holding-per-month shape itself.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {HoldingRow[]}
 */
export function expandHoldingRows(entries) {
	return [...entries]
		.sort(compareMonthlyEntries)
		.flatMap((entry) =>
			entry.investments.map((investment) => ({ month: monthStartDate(entry), investment }))
		);
}

/**
 * Exported for the same reason {@link NET_WORTH_HISTORY_COLUMNS} is.
 *
 * @type {XlsxColumn[]}
 */
export const HOLDINGS_COLUMNS = [
	{ header: 'Month', value: (row) => row.month, numFmt: 'mmm yyyy', width: 12 },
	{ header: 'Name', value: (row) => row.investment.name, width: 24 },
	{ header: 'Type', value: (row) => enumLabel(INVESTMENT_TYPE_LABELS, row.investment.type) },
	{
		header: 'Wrapper',
		value: (row) => enumLabel(WRAPPER_LABELS, row.investment.wrapper),
		width: 22
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
	{
		header: 'Included in Net Worth',
		value: (row) => includedInNetWorth(row.investment),
		width: 18
	},
	{ header: 'Notes', value: (row) => row.investment.notes, width: 30 }
];

/**
 * The sheet name for the debts sheet, exported so #113 can append its own sheets after it without
 * duplicating this string.
 */
export const DEBTS_SHEET_NAME = 'Debts';

/**
 * @typedef {object} DebtRow
 * @property {Date} month `monthStartDate` of the entry the debt was recorded in.
 * @property {import('./types.js').Debt} debt
 */

/**
 * Same per-month expansion as {@link expandHoldingRows}, over each entry's `debts` instead of its
 * `investments`.
 *
 * Exported for the same reason {@link expandHoldingRows} is.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {DebtRow[]}
 */
export function expandDebtRows(entries) {
	return [...entries]
		.sort(compareMonthlyEntries)
		.flatMap((entry) => entry.debts.map((debt) => ({ month: monthStartDate(entry), debt })));
}

/**
 * Exported for the same reason {@link NET_WORTH_HISTORY_COLUMNS} is.
 *
 * @type {XlsxColumn[]}
 */
export const DEBTS_COLUMNS = [
	{ header: 'Month', value: (row) => row.month, numFmt: 'mmm yyyy', width: 12 },
	{ header: 'Name', value: (row) => row.debt.name, width: 24 },
	{ header: 'Type', value: (row) => enumLabel(DEBT_TYPE_LABELS, row.debt.type) },
	{ header: 'Balance', value: (row) => row.debt.balance, format: 'currency' },
	{
		header: 'Included in Net Worth',
		value: (row) => includedInNetWorth(row.debt),
		width: 18
	},
	{ header: 'Notes', value: (row) => row.debt.notes, width: 30 }
];

/**
 * The sheet name for the pensions sheet, exported for the same reason {@link HOLDINGS_SHEET_NAME}
 * is.
 */
export const PENSIONS_SHEET_NAME = 'Pensions';

/**
 * `data.pensions` restated one row per pot, flat — unlike the holdings/debts sheets above, a
 * pension is not part of a monthly snapshot, so there is no month column and no per-entry
 * expansion, just the list as stored.
 *
 * `types.js`'s `Pension` is a union in practice: DC pots use `value`/`contribution_pct`/
 * `employer_pct`/`fund_fee`, DB pots use the `db_*` fields, and the State Pension uses the `ni_*`
 * fields, with whichever group doesn't apply to a given row left `null`. Every column is written
 * for every row regardless of `type` and `buildSheet` already leaves a `null` cell blank rather
 * than `0`, so a DC pot's `db_years` reads as an empty cell, not a stated zero years of service.
 *
 * @type {XlsxColumn[]}
 */
const PENSIONS_COLUMNS = [
	{ header: 'Name', value: (pension) => pension.name, width: 24 },
	{ header: 'Type', value: (pension) => enumLabel(PENSION_TYPE_LABELS, pension.type), width: 26 },
	{ header: 'Value', value: (pension) => pension.value, format: 'currency' },
	{
		header: 'Contribution %',
		value: (pension) => percentFraction(pension.contribution_pct),
		format: 'percent'
	},
	{
		header: 'Employer %',
		value: (pension) => percentFraction(pension.employer_pct),
		format: 'percent'
	},
	{ header: 'Fund Fee', value: (pension) => percentFraction(pension.fund_fee), format: 'percent' },
	{
		header: 'DB Accrual Rate',
		value: (pension) => percentFraction(pension.db_accrual_rate),
		format: 'percent',
		width: 16
	},
	{ header: 'DB Years', value: (pension) => pension.db_years, format: 'integer' },
	{ header: 'DB Salary', value: (pension) => pension.db_salary, format: 'currency' },
	{
		header: 'DB Annual Income',
		value: (pension) => pension.db_annual_income,
		format: 'currency',
		width: 16
	},
	{
		header: 'NI Qualifying Years',
		value: (pension) => pension.ni_qualifying_years,
		format: 'integer',
		width: 18
	},
	{
		header: 'NI Future Years',
		value: (pension) => pension.ni_future_years,
		format: 'integer',
		width: 16
	}
];

/**
 * The sheet name for the properties sheet, exported for the same reason
 * {@link HOLDINGS_SHEET_NAME} is.
 */
export const PROPERTIES_SHEET_NAME = 'Properties';

/**
 * `data.properties` restated one row per property, flat, plus the derived **Equity**
 * (`value - mortgage_balance`) a spreadsheet user would otherwise compute by hand — placed
 * straight after the two fields it is computed from rather than at the row's end, so the
 * subtraction it performs is visually adjacent to its inputs.
 *
 * @type {XlsxColumn[]}
 */
const PROPERTIES_COLUMNS = [
	{ header: 'Name', value: (property) => property.name, width: 24 },
	{
		header: 'Type',
		value: (property) => enumLabel(PROPERTY_TYPE_LABELS, property.type),
		width: 18
	},
	{ header: 'Value', value: (property) => property.value, format: 'currency' },
	{
		header: 'Mortgage Balance',
		value: (property) => property.mortgage_balance,
		format: 'currency',
		width: 16
	},
	{
		header: 'Equity',
		value: (property) => property.value - property.mortgage_balance,
		format: 'currency'
	},
	{
		header: 'Monthly Payment',
		value: (property) => property.monthly_payment,
		format: 'currency',
		width: 16
	},
	{
		header: 'Interest Rate',
		value: (property) => percentFraction(property.interest_rate),
		format: 'percent'
	},
	{
		header: 'Mortgage Type',
		value: (property) => enumLabel(MORTGAGE_TYPE_LABELS, property.mortgage_type),
		width: 20
	},
	{
		header: 'Deal Expiry',
		value: (property) => isoDateToUtcDate(property.deal_expiry),
		format: 'date',
		width: 12
	},
	{
		header: 'Purchase Price',
		value: (property) => property.purchase_price,
		format: 'currency',
		width: 16
	},
	{
		header: 'Purchase Date',
		value: (property) => isoDateToUtcDate(property.purchase_date),
		format: 'date',
		width: 12
	},
	{
		header: 'Letting Period Start',
		value: (property) => isoDateToUtcDate(property.let_from),
		format: 'date',
		width: 12
	},
	{
		header: 'Rental Income',
		value: (property) => property.rental_income,
		format: 'currency',
		width: 16
	},
	{
		header: 'Running Costs',
		value: (property) => property.running_costs,
		format: 'currency',
		width: 16
	},
	{
		header: 'Growth Rate',
		value: (property) => percentFraction(property.growth_rate),
		format: 'percent'
	},
	{
		header: 'Include in Net Worth',
		value: (property) => includeInNetWorth(property),
		width: 18
	}
];

/**
 * The sheet name for the physical assets sheet, exported for the same reason
 * {@link HOLDINGS_SHEET_NAME} is.
 */
export const ASSETS_SHEET_NAME = 'Physical Assets';

/**
 * `data.assets` restated one row per asset, flat, plus the derived **Gain/Loss**
 * (`current_value - purchase_price`) a spreadsheet user would otherwise compute by hand — placed
 * straight after the two fields it is computed from, matching {@link PROPERTIES_COLUMNS}'s Equity
 * column.
 *
 * @type {XlsxColumn[]}
 */
const ASSETS_COLUMNS = [
	{ header: 'Name', value: (asset) => asset.name, width: 24 },
	{
		header: 'Category',
		value: (asset) => enumLabel(ASSET_CATEGORY_LABELS, asset.category),
		width: 20
	},
	{
		header: 'Purchase Price',
		value: (asset) => asset.purchase_price,
		format: 'currency',
		width: 16
	},
	{ header: 'Current Value', value: (asset) => asset.current_value, format: 'currency', width: 16 },
	{
		header: 'Gain/Loss',
		value: (asset) => asset.current_value - asset.purchase_price,
		format: 'currency'
	},
	{
		header: 'Purchase Date',
		value: (asset) => isoDateToUtcDate(asset.purchase_date),
		format: 'date',
		width: 14
	},
	{
		header: 'Expected Growth',
		value: (asset) => percentFraction(asset.expected_growth),
		format: 'percent',
		width: 16
	},
	{ header: 'Holding Cost', value: (asset) => asset.holding_cost, format: 'currency', width: 14 },
	{
		header: 'Include in Net Worth',
		value: (asset) => includeInNetWorth(asset),
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
 * Six sheets, in the order README.md/#113 settled on: the tracked total first (net worth
 * history), then what a monthly snapshot records (holdings, debts — #111), then the three
 * collections a monthly snapshot doesn't cover (pensions, properties, physical assets — #113).
 *
 * @param {XlsxAppData} data
 * @param {{ exportedAt?: string }} [options] `exportedAt` defaults to now; only ever overridden by
 *   tests, matching `data-transfer.js`'s `exportAppData`.
 * @returns {{ bytes: ArrayBuffer, filename: string }}
 */
export function exportFinancialDataXlsx(data, { exportedAt = new Date().toISOString() } = {}) {
	const points = netWorthSeries(data.monthly_entries);
	const netWorthHistorySheet = buildSheet(NET_WORTH_HISTORY_COLUMNS, points);
	const holdingsSheet = buildSheet(HOLDINGS_COLUMNS, expandHoldingRows(data.monthly_entries));
	const debtsSheet = buildSheet(DEBTS_COLUMNS, expandDebtRows(data.monthly_entries));
	const pensionsSheet = buildSheet(PENSIONS_COLUMNS, data.pensions);
	const propertiesSheet = buildSheet(PROPERTIES_COLUMNS, data.properties);
	const assetsSheet = buildSheet(ASSETS_COLUMNS, data.assets);
	const workbook = buildWorkbook([
		{ name: NET_WORTH_HISTORY_SHEET_NAME, worksheet: netWorthHistorySheet },
		{ name: HOLDINGS_SHEET_NAME, worksheet: holdingsSheet },
		{ name: DEBTS_SHEET_NAME, worksheet: debtsSheet },
		{ name: PENSIONS_SHEET_NAME, worksheet: pensionsSheet },
		{ name: PROPERTIES_SHEET_NAME, worksheet: propertiesSheet },
		{ name: ASSETS_SHEET_NAME, worksheet: assetsSheet }
	]);
	const bytes = /** @type {ArrayBuffer} */ (
		XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
	);

	return { bytes, filename: suggestXlsxExportFilename(exportedAt) };
}

/** The MIME type an XLSX `Blob` download should be given. */
export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
