/**
 * CSV import — the parse/validate/merge engine for re-importing this app's own CSV export shape
 * (issue #130), the inverse of `csv-export.js` (#129) for the two of its three files that can be
 * inverted. Pure logic only, exactly like every sibling in this file — no DOM, no `localStorage`,
 * no `$lib/store.js`. `DataManager.svelte`'s file picker / confirm step / error reporting (#150)
 * is the wiring around this module, the same split `data-transfer.js` has with its own UI.
 *
 * Three layers:
 *
 * 1. **RFC 4180 parse** ({@link parseCsv}) — the mirror of `csv-export.js`'s `columnsToCsv`/
 *    `csvEscapeField`: a leading UTF-8 BOM (every file this app writes carries one), `"..."`
 *    quoted fields with doubled-`""` escaping, `\r\n` and bare `\n` line endings, a trailing blank
 *    line dropped rather than read as a spurious one-column row.
 * 2. **Dataset detection** ({@link detectCsvDataset}) — the header row compared against the
 *    `header` strings of `xlsx-export.js`'s own `NET_WORTH_HISTORY_COLUMNS`/`HOLDINGS_COLUMNS`/
 *    `DEBTS_COLUMNS`, imported rather than re-typed, so a change to either sheet's shape can't
 *    silently drift the export and import formats apart.
 * 3. **Parse, validate and merge** ({@link parseCsvImport}) — per-cell parsing in column-spec
 *    order, rows turned into fresh `Investment`/`Debt` records via `model.js`'s own
 *    `createInvestment`/`createDebt` factories (the exported columns never carried `id`, so a
 *    round trip cannot recover the originals), upserted into a copy of `monthly_entries` by month,
 *    and the whole merged document re-validated through `model.js`'s `validateAppData` — the same
 *    checks JSON import (`data-transfer.js`) already relies on, not reimplemented.
 *
 * **Merge, not replace.** A CSV carries one dataset (Holdings or Debts), not the whole `AppData`
 * document, so this cannot be "replace everything" the way JSON import is. A month the file
 * mentions has its `investments` (or `debts`) replaced wholesale — matching `MonthlyEntry`'s own
 * restate-the-snapshot-fresh convention — while the *other* collection on that entry, and every
 * month the file doesn't mention, is left exactly as it was. A month with no existing entry gets
 * one via `createMonthlyEntry`. `auto_filled` is reset to `false` on any entry the file touches:
 * once a month has real imported data it is no longer `auto-invest.js`'s bridged placeholder.
 *
 * **Net Worth History is deliberately not importable.** It is `net-worth.js`'s derived monthly
 * totals, and there is no way back from three numbers a month to the individual holdings/debts
 * that produced them. {@link parseCsvImport} detects that header and rejects it with a specific,
 * actionable message rather than a generic "unrecognised file".
 *
 * `parseCsvImport` never throws and never mutates its inputs — the caller (#150) only swaps the
 * document in once it returns `ok: true`, the same contract `data-transfer.js`'s
 * `parseImportDocument` has.
 *
 * TODO(#130): WealthR's own CSV export format is out of scope here. README.md's Phase 2 spec names
 * "CSV import: WealthR export format + generic format", but no real WealthR CSV export sample was
 * available to build a column mapping against, and guessing at an unverified layout risks silently
 * mis-importing someone's real financial data — exactly what this module's reject-with-a-reason
 * design exists to prevent. Only this app's own export format (above) is handled; a WealthR column
 * mapping is blocked on a real sample file (see DESIGN.md → "Data Migration").
 */

import {
	CONTRIBUTION_FREQUENCY_LABELS,
	DEBT_TYPE_LABELS,
	INVESTMENT_TYPE_LABELS,
	WRAPPER_LABELS
} from './enums.js';
import {
	compareMonthlyEntries,
	createDebt,
	createInvestment,
	createMonthlyEntry,
	monthlyEntryKey,
	validateAppData
} from './model.js';
import { DEBTS_COLUMNS, HOLDINGS_COLUMNS, NET_WORTH_HISTORY_COLUMNS } from './xlsx-export.js';

/**
 * Named with a `CsvImport` prefix for the same reason `csv-export.js`'s `CsvAppData` and
 * `data-transfer.js`'s `TransferAppData`/`TransferValidationError` are: `index.js` re-exports
 * every module with `export *`, and two same-named top-level JSDoc typedefs read as an ambiguous
 * re-export.
 * @typedef {import('./types.js').AppData} CsvImportAppData
 * @typedef {import('./types.js').ValidationError} CsvImportValidationError
 */

/* -------------------------------------------------------------------------- */
/* RFC 4180 parse                                                              */
/* -------------------------------------------------------------------------- */

const CSV_BOM = '﻿';

/**
 * Parse RFC 4180 CSV text into rows of raw string cells — the mirror of `csv-export.js`'s
 * `columnsToCsv`. A leading UTF-8 BOM is stripped. `"..."` quoted fields may contain commas, line
 * breaks or a doubled `""` for a literal quote. Both `\r\n` (what this app writes) and a bare
 * `\n` (a hand-edited or re-saved file) end a row. A single trailing line break at the very end of
 * the file ends the last row rather than starting a spurious empty one — the same "trailing blank
 * line dropped" reading `csv-export.js`'s own `\r\n`-terminated-after-every-row output needs to
 * round-trip cleanly; a genuine blank line *before* the end of the file still parses as a one-cell
 * row, since that is what it actually is.
 *
 * @param {string} text
 * @returns {string[][]} One array of cells per row, in file order.
 * @throws {Error} If a quoted field is never closed — the one shape of CSV this parser cannot
 *   read back at all, as opposed to a well-formed-but-wrong-shaped row {@link parseCsvImport}
 *   reports per-row instead.
 */
export function parseCsv(text) {
	const input = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;

	/** @type {string[][]} */
	const rows = [];
	/** @type {string[]} */
	let row = [];
	let field = '';
	let inQuotes = false;
	let index = 0;

	while (index < input.length) {
		const char = input[index];

		if (inQuotes) {
			if (char === '"') {
				if (input[index + 1] === '"') {
					field += '"';
					index += 2;
				} else {
					inQuotes = false;
					index += 1;
				}
			} else {
				field += char;
				index += 1;
			}
			continue;
		}

		if (char === '"') {
			inQuotes = true;
			index += 1;
		} else if (char === ',') {
			row.push(field);
			field = '';
			index += 1;
		} else if (char === '\r' || char === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			index += char === '\r' && input[index + 1] === '\n' ? 2 : 1;
		} else {
			field += char;
			index += 1;
		}
	}

	if (inQuotes) throw new Error('a quoted field is never closed');

	// Only a bare trailing terminator (the state left behind by the loop above once the file's
	// final line break has already been consumed into a row) is dropped; a field or a row started
	// by real content is always flushed, including a file with no trailing line break at all.
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	return rows;
}

/* -------------------------------------------------------------------------- */
/* Dataset detection                                                           */
/* -------------------------------------------------------------------------- */

/**
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 * @returns {boolean}
 */
function sameHeaders(a, b) {
	return a.length === b.length && a.every((header, index) => header === b[index]);
}

/**
 * Which dataset a CSV's header row belongs to, by comparing it against `xlsx-export.js`'s own
 * column specs — imported, not re-typed, so a change to either sheet's shape can't silently drift
 * the export and import formats apart.
 *
 * @param {readonly string[]} headerRow
 * @returns {'holdings' | 'debts' | 'net-worth-history' | 'unrecognised'}
 */
export function detectCsvDataset(headerRow) {
	if (
		sameHeaders(
			headerRow,
			HOLDINGS_COLUMNS.map((column) => column.header)
		)
	)
		return 'holdings';
	if (
		sameHeaders(
			headerRow,
			DEBTS_COLUMNS.map((column) => column.header)
		)
	)
		return 'debts';
	if (
		sameHeaders(
			headerRow,
			NET_WORTH_HISTORY_COLUMNS.map((column) => column.header)
		)
	) {
		return 'net-worth-history';
	}
	return 'unrecognised';
}

/* -------------------------------------------------------------------------- */
/* Per-cell parsing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A cell parse outcome — never throws, so a whole file can be walked collecting every problem
 * rather than stopping at the first one.
 * @typedef {{ ok: true, value: any } | { ok: false, message: string }} CellParseResult
 */

/**
 * @param {string} value
 * @returns {boolean} Whether `value` is a calendar-valid ISO `YYYY-MM-DD` date.
 */
function isIsoDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	// Round-tripping catches calendar-invalid dates like 2026-02-30, which `Date` rolls over —
	// the same check `model.js`'s own (private) `isIsoDate` makes.
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The `Month` column: `csv-export.js` writes `monthStartDate` as an ISO `YYYY-MM-DD` string, always
 * the 1st of the month, so only the year/month need reading back out — the day is fixed and carries
 * no information of its own.
 *
 * @param {string} raw
 * @returns {CellParseResult}
 */
function parseMonthCell(raw) {
	const trimmed = raw.trim();
	if (!isIsoDate(trimmed)) {
		return { ok: false, message: 'must be an ISO date, e.g. "2026-03-01"' };
	}
	return {
		ok: true,
		value: { year: Number(trimmed.slice(0, 4)), month: Number(trimmed.slice(5, 7)) }
	};
}

/** @param {string} raw @returns {CellParseResult} */
function parseTextCell(raw) {
	return { ok: true, value: raw };
}

/**
 * `csv-export.js`'s currency cells are a bare decimal with no thousands separator or `£` sign
 * (`formatCsvValue`'s `numeric.toFixed(2)`), so a plain `Number()` is the exact inverse.
 *
 * @param {string} raw
 * @returns {CellParseResult}
 */
function parseCurrencyCell(raw) {
	const trimmed = raw.trim();
	const value = Number(trimmed);
	if (trimmed === '' || !Number.isFinite(value)) {
		return { ok: false, message: 'must be a number, e.g. "1234.56"' };
	}
	return { ok: true, value };
}

/**
 * As {@link parseCurrencyCell}, but a blank cell — what `formatCsvValue` writes for a `null`
 * `bought_for` — reads back as `null` rather than an error.
 *
 * @param {string} raw
 * @returns {CellParseResult}
 */
function parseNullableCurrencyCell(raw) {
	return raw.trim() === '' ? { ok: true, value: null } : parseCurrencyCell(raw);
}

/**
 * The `Year Purchased` column: a bare whole-number year, or blank for `null`.
 *
 * @param {string} raw
 * @returns {CellParseResult}
 */
function parseNullableYearCell(raw) {
	const trimmed = raw.trim();
	if (trimmed === '') return { ok: true, value: null };
	const value = Number(trimmed);
	if (!Number.isInteger(value)) {
		return { ok: false, message: 'must be a whole number year, e.g. "2022"' };
	}
	return { ok: true, value };
}

/**
 * `csv-export.js` writes a percent-formatted column (already `percentFraction`-converted back to
 * a whole-number percent) suffixed `%`, e.g. `fund_fee: 0.22` becomes `"0.22%"` — so stripping the
 * `%` and parsing the number is the exact inverse; there is no fraction round trip to undo, since
 * the CSV cell already carries the same whole-number percent `model.js`'s `Investment.fund_fee`/
 * `ownership_pct` store.
 *
 * @param {string} raw
 * @returns {CellParseResult}
 */
function parsePercentCell(raw) {
	const match = /^(-?\d+(?:\.\d+)?)%$/.exec(raw.trim());
	if (!match) return { ok: false, message: 'must be a percentage, e.g. "5.00%"' };
	return { ok: true, value: Number(match[1]) };
}

/**
 * The `Included in Net Worth` column: `Yes`/`No` inverted back to the stored
 * `exclude_from_net_worth` flag (`csv-export.js`'s `includedInNetWorth` phrases it the positive
 * way round for readability, so this is the one place that inversion happens on the way back in).
 *
 * @param {string} raw
 * @returns {CellParseResult}
 */
function parseIncludedInNetWorthCell(raw) {
	const trimmed = raw.trim();
	if (trimmed === 'Yes') return { ok: true, value: false };
	if (trimmed === 'No') return { ok: true, value: true };
	return { ok: false, message: 'must be "Yes" or "No"' };
}

/**
 * @param {Record<string, string>} labels One of `enums.js`'s `*_LABELS` maps.
 * @returns {Record<string, string>} The same map, inverted: label text → stored code.
 */
function invertLabels(labels) {
	return Object.fromEntries(Object.entries(labels).map(([code, label]) => [label, code]));
}

/**
 * An enum column: the label text `enums.js`'s `*_LABELS` map (via `xlsx-export.js`'s `enumLabel`)
 * wrote, resolved back to its stored code via the inverted map — never re-typed as a separate
 * list, so a label added to `enums.js` is importable without a change here.
 *
 * @param {string} raw
 * @param {Record<string, string>} codesByLabel
 * @returns {CellParseResult}
 */
function parseEnumLabelCell(raw, codesByLabel) {
	const code = codesByLabel[raw.trim()];
	if (code === undefined) {
		return { ok: false, message: `must be one of: ${Object.keys(codesByLabel).join(', ')}` };
	}
	return { ok: true, value: code };
}

const INVESTMENT_TYPE_CODES_BY_LABEL = invertLabels(INVESTMENT_TYPE_LABELS);
const WRAPPER_CODES_BY_LABEL = invertLabels(WRAPPER_LABELS);
const CONTRIBUTION_FREQUENCY_CODES_BY_LABEL = invertLabels(CONTRIBUTION_FREQUENCY_LABELS);
const DEBT_TYPE_CODES_BY_LABEL = invertLabels(DEBT_TYPE_LABELS);

/**
 * One parser per `HOLDINGS_COLUMNS` header — keyed by the header text itself (rather than
 * position) so a row is read cell-by-cell in step with `HOLDINGS_COLUMNS`'s own order.
 * @type {Record<string, (raw: string) => CellParseResult>}
 */
const HOLDING_CELL_PARSERS = {
	Month: parseMonthCell,
	Name: parseTextCell,
	Type: (raw) => parseEnumLabelCell(raw, INVESTMENT_TYPE_CODES_BY_LABEL),
	Wrapper: (raw) => parseEnumLabelCell(raw, WRAPPER_CODES_BY_LABEL),
	Value: parseCurrencyCell,
	'Bought For': parseNullableCurrencyCell,
	'Year Purchased': parseNullableYearCell,
	'Monthly Contribution': parseCurrencyCell,
	'Contribution Frequency': (raw) => parseEnumLabelCell(raw, CONTRIBUTION_FREQUENCY_CODES_BY_LABEL),
	'Fund Fee': parsePercentCell,
	'Ownership %': parsePercentCell,
	'Included in Net Worth': parseIncludedInNetWorthCell,
	Notes: parseTextCell
};

/** Which `createInvestment` override each `HOLDINGS_COLUMNS` header parses into. */
const HOLDING_FIELD_NAMES = {
	Name: 'name',
	Type: 'type',
	Wrapper: 'wrapper',
	Value: 'value',
	'Bought For': 'bought_for',
	'Year Purchased': 'year_purchased',
	'Monthly Contribution': 'monthly_contribution',
	'Contribution Frequency': 'contribution_frequency',
	'Fund Fee': 'fund_fee',
	'Ownership %': 'ownership_pct',
	'Included in Net Worth': 'exclude_from_net_worth',
	Notes: 'notes'
};

/**
 * As {@link HOLDING_CELL_PARSERS}, for `DEBTS_COLUMNS`.
 * @type {Record<string, (raw: string) => CellParseResult>}
 */
const DEBT_CELL_PARSERS = {
	Month: parseMonthCell,
	Name: parseTextCell,
	Type: (raw) => parseEnumLabelCell(raw, DEBT_TYPE_CODES_BY_LABEL),
	Balance: parseCurrencyCell,
	'Included in Net Worth': parseIncludedInNetWorthCell,
	Notes: parseTextCell
};

/** Which `createDebt` override each `DEBTS_COLUMNS` header parses into. */
const DEBT_FIELD_NAMES = {
	Name: 'name',
	Type: 'type',
	Balance: 'balance',
	'Included in Net Worth': 'exclude_from_net_worth',
	Notes: 'notes'
};

/* -------------------------------------------------------------------------- */
/* Rows → records                                                              */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} ParsedRow
 * @property {{ year: number, month: number }} month
 * @property {import('./types.js').Investment | import('./types.js').Debt} record Fresh id — the
 *   exported columns never carried one, so a round trip can't recover the originals.
 */

/**
 * Parse one data row against a column spec, producing a specific, row-and-column-named reason for
 * the first cell (of potentially several) that doesn't parse — never a silent default.
 *
 * @param {readonly string[]} cells
 * @param {number} rowNumber 1-based, counting the header as row 1 (i.e. the file's own row
 *   numbering, the one a reader would see opening the CSV in a spreadsheet) — the first data row
 *   is row 2.
 * @param {readonly import('./xlsx-export.js').XlsxColumn[]} columns
 * @param {Record<string, (raw: string) => CellParseResult>} cellParsers
 * @param {Record<string, string>} fieldNames
 * @param {(overrides: Record<string, any>) => any} factory `createInvestment`/`createDebt`.
 * @returns {{ ok: true, row: ParsedRow } | { ok: false, errors: CsvImportValidationError[] }}
 */
function parseDatasetRow(cells, rowNumber, columns, cellParsers, fieldNames, factory) {
	/** @type {CsvImportValidationError[]} */
	const errors = [];
	/** @type {Record<string, any>} */
	const overrides = {};
	/** @type {{ year: number, month: number } | undefined} */
	let month;

	for (let index = 0; index < columns.length; index += 1) {
		const column = columns[index];
		const result = cellParsers[column.header](cells[index]);
		if (!result.ok) {
			errors.push({ path: `row ${rowNumber} (${column.header})`, message: result.message });
		} else if (column.header === 'Month') {
			month = result.value;
		} else {
			overrides[fieldNames[column.header]] = result.value;
		}
	}

	if (errors.length > 0) return { ok: false, errors };
	// Every column set here includes a `Month` column, so `month` is always assigned by this point.
	return {
		ok: true,
		row: {
			month: /** @type {{ year: number, month: number }} */ (month),
			record: factory(overrides)
		}
	};
}

/* -------------------------------------------------------------------------- */
/* Merge                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Upsert parsed rows into a copy of `monthly_entries`, grouped by month, replacing only the
 * collection (`investments` or `debts`) the dataset carries on any month the file mentions — the
 * other collection on that entry, and every month the file doesn't mention, is left exactly as it
 * was. A month with no existing entry gets a fresh one via `createMonthlyEntry`. `auto_filled` is
 * reset to `false` on any entry the file touches, new or existing.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries
 * @param {readonly ParsedRow[]} rows
 * @param {'holdings' | 'debts'} dataset
 * @returns {{ entries: import('./types.js').MonthlyEntry[], months: number, newMonths: number, updatedMonths: number }}
 */
function mergeRowsIntoEntries(entries, rows, dataset) {
	const collectionKey = dataset === 'holdings' ? 'investments' : 'debts';

	/** @type {Map<string, { year: number, month: number, records: any[] }>} */
	const grouped = new Map();
	for (const { month, record } of rows) {
		const key = monthlyEntryKey(month);
		const group = grouped.get(key);
		if (group) group.records.push(record);
		else grouped.set(key, { year: month.year, month: month.month, records: [record] });
	}

	const merged = [...entries];
	let newMonths = 0;
	let updatedMonths = 0;

	for (const [key, group] of grouped) {
		const existingIndex = merged.findIndex((entry) => monthlyEntryKey(entry) === key);
		if (existingIndex === -1) {
			newMonths += 1;
			merged.push(
				createMonthlyEntry({
					year: group.year,
					month: group.month,
					[collectionKey]: group.records
				})
			);
		} else {
			updatedMonths += 1;
			merged[existingIndex] = {
				...merged[existingIndex],
				[collectionKey]: group.records,
				auto_filled: false
			};
		}
	}

	merged.sort(compareMonthlyEntries);
	return { entries: merged, months: grouped.size, newMonths, updatedMonths };
}

/* -------------------------------------------------------------------------- */
/* The entry point                                                             */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} CsvImportSuccess
 * @property {true} ok
 * @property {'holdings' | 'debts'} dataset
 * @property {CsvImportAppData} data The document to replace the current one with — already merged
 *   and confirmed valid. The caller (#150) decides when, and whether, to actually swap it in.
 * @property {{ records: number, months: number, newMonths: number, updatedMonths: number }} summary
 *   `records` is the count of holdings/debts read from the file; `months` how many distinct
 *   months they span; `newMonths`/`updatedMonths` split that between months that gained a fresh
 *   `MonthlyEntry` and months that already had one.
 */

/**
 * @typedef {object} CsvImportFailure
 * @property {false} ok
 * @property {'invalid-csv' | 'unrecognised-csv' | 'read-only-dataset' | 'invalid-data'} reason
 * @property {string} message A sentence safe to show the user as-is.
 * @property {CsvImportValidationError[]} errors The offending fields — populated for
 *   `invalid-csv` (one entry per cell/row that didn't parse, `path` naming the row and column) and
 *   `invalid-data` (`validateAppData`'s own errors over the merged document); empty for
 *   `unrecognised-csv`/`read-only-dataset`, which have nothing more specific to point at.
 */

/**
 * @typedef {CsvImportSuccess | CsvImportFailure} CsvImportResult
 */

/**
 * Parse, validate and merge a Holdings or Debts CSV — this app's own export format — into
 * `currentData`. Never throws, never mutates `currentData` or its `monthly_entries`: the caller
 * only swaps the document in once this returns `ok: true`, the same contract
 * `data-transfer.js`'s `parseImportDocument` has for JSON.
 *
 * @param {string} raw File contents, as text.
 * @param {CsvImportAppData} currentData The document to merge the file's rows into.
 * @returns {CsvImportResult}
 */
export function parseCsvImport(raw, currentData) {
	/** @type {string[][]} */
	let rows;
	try {
		rows = parseCsv(raw);
	} catch (cause) {
		return {
			ok: false,
			reason: 'invalid-csv',
			message: `That file is not valid CSV: ${cause instanceof Error ? cause.message : String(cause)}`,
			errors: []
		};
	}

	if (rows.length === 0) {
		return { ok: false, reason: 'invalid-csv', message: 'That file is empty.', errors: [] };
	}

	const [header, ...dataRows] = rows;
	const dataset = detectCsvDataset(header);

	if (dataset === 'net-worth-history') {
		return {
			ok: false,
			reason: 'read-only-dataset',
			message:
				'Net Worth History is a derived total, not a set of individual records — there is no way to reconstruct the holdings and debts that produced it from three monthly totals. Import a Holdings or Debts export instead, or use the JSON export for a full backup/restore.',
			errors: []
		};
	}
	if (dataset === 'unrecognised') {
		return {
			ok: false,
			reason: 'unrecognised-csv',
			message:
				'That file\'s header row doesn\'t match a Holdings or Debts export from this app. Choose a file created with "Export data as CSV", or use the JSON export for a full backup/restore.',
			errors: []
		};
	}

	const columns = dataset === 'holdings' ? HOLDINGS_COLUMNS : DEBTS_COLUMNS;
	const cellParsers = dataset === 'holdings' ? HOLDING_CELL_PARSERS : DEBT_CELL_PARSERS;
	const fieldNames = dataset === 'holdings' ? HOLDING_FIELD_NAMES : DEBT_FIELD_NAMES;
	const factory = dataset === 'holdings' ? createInvestment : createDebt;

	/** @type {CsvImportValidationError[]} */
	const rowErrors = [];
	/** @type {ParsedRow[]} */
	const parsedRows = [];

	dataRows.forEach((cells, index) => {
		const rowNumber = index + 2; // the header is row 1
		if (cells.length !== columns.length) {
			rowErrors.push({
				path: `row ${rowNumber}`,
				message: `expected ${columns.length} columns, found ${cells.length}`
			});
			return;
		}
		const parsed = parseDatasetRow(cells, rowNumber, columns, cellParsers, fieldNames, factory);
		if (parsed.ok) parsedRows.push(parsed.row);
		else rowErrors.push(...parsed.errors);
	});

	if (rowErrors.length > 0) {
		return {
			ok: false,
			reason: 'invalid-csv',
			message: `That file has ${rowErrors.length} problem${rowErrors.length === 1 ? '' : 's'} that can't be imported as-is — nothing has been changed.`,
			errors: rowErrors
		};
	}

	const { entries, months, newMonths, updatedMonths } = mergeRowsIntoEntries(
		currentData.monthly_entries,
		parsedRows,
		dataset
	);
	const mergedData = { ...currentData, monthly_entries: entries };

	const { valid, errors } = validateAppData(mergedData);
	if (!valid) {
		return {
			ok: false,
			reason: 'invalid-data',
			message: `That file's data has ${errors.length} problem${errors.length === 1 ? '' : 's'} that can't be imported as-is — nothing has been changed.`,
			errors
		};
	}

	return {
		ok: true,
		dataset,
		data: mergedData,
		summary: { records: parsedRows.length, months, newMonths, updatedMonths }
	};
}
