/**
 * Bank statement CSV import — issue #267. Every bank's CSV export has a different column layout
 * (Monzo, Starling, a high-street bank all disagree on header names and column order), so unlike
 * `csv-import.js`'s `parseCsvImport` (which detects *this app's own* export shape by exact header
 * match) there is no fixed header to match against here. Instead the header row and a few sample
 * rows are shown to the user, who maps columns to date/description/amount(/category) themselves —
 * a one-time mapping step per upload, not remembered across different banks' files (this app has
 * nowhere to persist import-source metadata yet — a nice-to-have for later, not required here).
 *
 * The raw RFC 4180 parse is `csv-import.js`'s own `parseCsv` — the caller (`BankCsvImport.svelte`)
 * calls it directly and passes this module the header row and data rows it returns; nothing here
 * re-implements or wraps that parse. Everything past that split is new.
 *
 * **Where the date goes.** `types.js`'s `BudgetLineItem` has no date field (`id`, `name`, `amount`,
 * `category_id`, `notes` only) — a deliberate, already-settled shape this issue does not get to
 * change. The mapped transaction date is still parsed and validated (so a bad date is still a
 * reported per-row error, not silently dropped), then carried into `notes` as an ISO
 * `YYYY-MM-DD` string, the same "no schema change, use the field that already exists" trade-off
 * `csv-import.js`'s own per-column parsers make throughout.
 *
 * **Category matching, not category entry.** The mapping screen never asks the user to pick a
 * `BudgetCategory` per row — `category_id` is left `null` unless the mapped category column's text
 * matches an existing category's `name` case-insensitively, exactly as the issue asks
 * ("leave unmapped/unset rather than forcing a category-per-row"). Categorising afterwards happens
 * in the normal Budget UI, the same as a manually-added line item today.
 *
 * **Amount handling.** Two mapping modes cover real-world bank exports: a single signed column
 * (`+`/`-`, or parenthesised negatives), or separate Debit/Credit columns where exactly one of the
 * two carries a value per row. Either way the parsed cell is currency-symbol- and
 * thousands-separator-stripped before `Number()`, and the stored `amount` is always the absolute
 * value — `BudgetLineItem.amount` (like every other amount field in this app) is a non-negative
 * spend figure, not a signed ledger entry; `model.js`'s own `validateBudget` enforces that on the
 * whole document already. Locale-aware decimal commas (`1.234,56`) are out of scope — this is a UK
 * app, and the issue only asks for symbol/thousands-separator stripping, not a full locale parser.
 *
 * **Additive, like every collection add already is.** Parsed rows are appended to
 * `budget.line_items`, never replacing what is already there — this module hands back only the
 * fresh `BudgetLineItem[]` (plus a summary), not a whole merged document, so the caller
 * (`BankCsvImport.svelte`) applies it exactly the way `BudgetTracker.svelte`'s own
 * `submitLineItem` already does: `budget = { ...budget, line_items: [...budget.line_items, ...added] }`.
 * There is no `validateAppData` call here (unlike `csv-import.js`'s Holdings/Debts import) because,
 * also unlike that module, this one never touches `monthly_entries` or any other part of `AppData` —
 * every row is built through `createBudgetLineItem` with a fresh id, an already-clamped-non-negative
 * amount and a `category_id` that is always either `null` or an id read straight off the budget's
 * own `categories` list, so the result is valid by construction, the same guarantee the manual
 * add-item form already relies on without a validation pass of its own.
 *
 * Every function here is pure: none throw on bad input, none mutate their arguments. The caller
 * only applies the result once {@link parseBankCsvImport} returns `ok: true`.
 */

import { createBudgetLineItem } from './model.js';

/**
 * @typedef {import('./types.js').BudgetCategory} BankCsvBudgetCategory
 * @typedef {import('./types.js').BudgetLineItem} BankCsvBudgetLineItem
 * @typedef {import('./types.js').ValidationError} BankCsvValidationError
 */

/* -------------------------------------------------------------------------- */
/* Date formats                                                                */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} BankCsvDateFormat
 * @property {string} id
 * @property {string} label Shown in the mapping screen's format picker.
 * @property {RegExp} pattern
 * @property {readonly string[]} order Which capture group is which ("day"/"month"/"year"), in
 *   `pattern`'s group order.
 */

/**
 * A handful of date layouts real bank exports use — UK `DD/MM/YYYY` first (this is a UK app), ISO
 * `YYYY-MM-DD`, US `MM/DD/YYYY` (a US-issued card statement), and the `-`/`.` separated variants of
 * the UK layout some banks (and most spreadsheet re-saves) produce instead of `/`.
 *
 * @type {readonly BankCsvDateFormat[]}
 */
export const BANK_CSV_DATE_FORMATS = Object.freeze([
	Object.freeze({
		id: 'DD/MM/YYYY',
		label: 'DD/MM/YYYY — UK, e.g. 31/03/2026',
		pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
		order: Object.freeze(['day', 'month', 'year'])
	}),
	Object.freeze({
		id: 'YYYY-MM-DD',
		label: 'YYYY-MM-DD — ISO, e.g. 2026-03-31',
		pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
		order: Object.freeze(['year', 'month', 'day'])
	}),
	Object.freeze({
		id: 'MM/DD/YYYY',
		label: 'MM/DD/YYYY — US, e.g. 03/31/2026',
		pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
		order: Object.freeze(['month', 'day', 'year'])
	}),
	Object.freeze({
		id: 'DD-MM-YYYY',
		label: 'DD-MM-YYYY, e.g. 31-03-2026',
		pattern: /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
		order: Object.freeze(['day', 'month', 'year'])
	}),
	Object.freeze({
		id: 'DD.MM.YYYY',
		label: 'DD.MM.YYYY, e.g. 31.03.2026',
		pattern: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
		order: Object.freeze(['day', 'month', 'year'])
	})
]);

const DEFAULT_DATE_FORMAT_ID = 'DD/MM/YYYY';

/**
 * @param {string} raw
 * @param {string} formatId One of {@link BANK_CSV_DATE_FORMATS}' `id`s.
 * @returns {{ ok: true, value: string } | { ok: false, message: string }} `value` is an ISO
 *   `YYYY-MM-DD` string.
 */
function parseBankDateCell(raw, formatId) {
	const format = BANK_CSV_DATE_FORMATS.find((candidate) => candidate.id === formatId);
	if (!format) return { ok: false, message: `unrecognised date format "${formatId}"` };

	const trimmed = raw.trim();
	const match = format.pattern.exec(trimmed);
	if (!match) {
		return {
			ok: false,
			message: `must be a date in ${format.id} format, e.g. "${sampleFor(format)}"`
		};
	}

	/** @type {Record<string, number>} */
	const parts = {};
	format.order.forEach((part, index) => {
		parts[part] = Number(match[index + 1]);
	});

	const iso = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
	const date = new Date(`${iso}T00:00:00Z`);
	// Round-tripping catches calendar-invalid dates like 31/02/2026, which `Date` rolls over —
	// the same check `csv-import.js`'s own `isIsoDate` makes.
	if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
		return { ok: false, message: `"${trimmed}" is not a valid calendar date for ${format.id}` };
	}
	return { ok: true, value: iso };
}

/** @param {BankCsvDateFormat} format @returns {string} */
function sampleFor(format) {
	const sampleParts = { day: '31', month: '03', year: '2026' };
	return format.id
		.replace('DD', sampleParts.day)
		.replace('MM', sampleParts.month)
		.replace('YYYY', sampleParts.year);
}

/* -------------------------------------------------------------------------- */
/* Amount cells                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Strips a currency symbol and thousands separators, reads a parenthesised or `-`/`+`-prefixed
 * figure as signed, and parses what remains as a number. `""` (a blank Debit/Credit cell — the
 * normal shape for the column that transaction did *not* use) parses to `null` rather than an
 * error; the caller decides whether a blank is acceptable for the mapping mode in play.
 *
 * @param {string} raw
 * @returns {{ ok: true, value: number | null } | { ok: false, message: string }}
 */
function parseBankAmountCell(raw) {
	const trimmed = raw.trim();
	if (trimmed === '') return { ok: true, value: null };

	let text = trimmed;
	let negative = false;

	if (/^\(.*\)$/.test(text)) {
		negative = true;
		text = text.slice(1, -1);
	}

	// Strip everything but digits, `.`, `,`, and a leading sign — currency symbols (£/$/€/etc.),
	// spaces and any other decoration a bank export adds.
	text = text.replace(/[^0-9.,+-]/g, '');

	if (text.startsWith('-')) {
		negative = true;
		text = text.slice(1);
	} else if (text.startsWith('+')) {
		text = text.slice(1);
	}

	text = text.replace(/,/g, ''); // thousands separator

	if (text === '' || !/^\d+(\.\d+)?$/.test(text)) {
		return {
			ok: false,
			message: `must be a number, e.g. "12.34" or "£1,234.56" (got "${trimmed}")`
		};
	}

	const value = Number(text);
	return { ok: true, value: negative ? -value : value };
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} BankCsvMapping
 * @property {number | null} dateColumn
 * @property {string} dateFormat One of {@link BANK_CSV_DATE_FORMATS}' `id`s.
 * @property {number | null} descriptionColumn
 * @property {'signed' | 'debit-credit'} amountMode
 * @property {number | null} amountColumn Used when `amountMode === 'signed'`.
 * @property {number | null} debitColumn Used when `amountMode === 'debit-credit'`.
 * @property {number | null} creditColumn Used when `amountMode === 'debit-credit'`.
 * @property {number | null} categoryColumn Optional at every step — `null` means "don't try to
 *   match a category from this file".
 */

/** @type {Record<'signed' | 'debit-credit', string>} */
export const BANK_CSV_AMOUNT_MODE_LABELS = Object.freeze({
	signed: 'Single amount column (+ in, − out)',
	'debit-credit': 'Separate Debit / Credit columns'
});

/**
 * @param {readonly string[]} header
 * @param {readonly RegExp[]} patterns
 * @returns {number | null}
 */
function guessColumn(header, patterns) {
	const index = header.findIndex((cell) => patterns.some((pattern) => pattern.test(cell.trim())));
	return index === -1 ? null : index;
}

/**
 * A best-effort starting mapping from the header row's own text, so the mapping screen opens with
 * plausible selections already made rather than every field blank — the user still confirms (or
 * corrects) every field before import.
 *
 * @param {readonly string[]} header
 * @returns {BankCsvMapping}
 */
export function guessBankCsvMapping(header) {
	const dateColumn = guessColumn(header, [/date/i]);
	const descriptionColumn = guessColumn(header, [
		/desc/i,
		/narrative/i,
		/detail/i,
		/merchant/i,
		/payee/i,
		/reference/i
	]);
	const amountColumn = guessColumn(header, [
		/^amount$/i,
		/amount/i,
		/^value$/i,
		/transaction value/i
	]);
	const debitColumn = guessColumn(header, [/debit/i, /money ?out/i, /paid ?out/i, /withdrawal/i]);
	const creditColumn = guessColumn(header, [/credit/i, /money ?in/i, /paid ?in/i, /deposit/i]);
	const categoryColumn = guessColumn(header, [/categor/i]);

	const amountMode = amountColumn !== null || debitColumn === null ? 'signed' : 'debit-credit';

	return {
		dateColumn,
		dateFormat: DEFAULT_DATE_FORMAT_ID,
		descriptionColumn,
		amountMode,
		amountColumn: amountMode === 'signed' ? amountColumn : null,
		debitColumn: amountMode === 'debit-credit' ? debitColumn : null,
		creditColumn: amountMode === 'debit-credit' ? creditColumn : null,
		categoryColumn
	};
}

/**
 * Whether every column a mapping's current `amountMode` actually needs has been chosen. The
 * mapping screen uses this to enable/disable its Import button; {@link parseBankCsvImport} checks
 * it again independently, since it never trusts a caller to have checked first.
 *
 * @param {BankCsvMapping} mapping
 * @returns {boolean}
 */
export function isBankCsvMappingComplete(mapping) {
	if (mapping.dateColumn === null || mapping.descriptionColumn === null) return false;
	if (mapping.amountMode === 'signed') return mapping.amountColumn !== null;
	return mapping.debitColumn !== null && mapping.creditColumn !== null;
}

/* -------------------------------------------------------------------------- */
/* Category matching                                                          */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} raw
 * @param {readonly BankCsvBudgetCategory[]} categories
 * @returns {string | null} The matching category's `id`, or `null` if blank or no category's
 *   `name` matches case-insensitively.
 */
function matchCategoryId(raw, categories) {
	const trimmed = raw.trim();
	if (trimmed === '') return null;
	const match = categories.find(
		(category) => category.name.trim().toLowerCase() === trimmed.toLowerCase()
	);
	return match ? match.id : null;
}

/* -------------------------------------------------------------------------- */
/* Row parsing                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * @param {readonly string[]} cells
 * @param {number} rowNumber 1-based, counting the header as row 1 — the first data row is row 2,
 *   matching how a spreadsheet would number it and how `csv-import.js` numbers its own rows.
 * @param {BankCsvMapping} mapping
 * @param {readonly BankCsvBudgetCategory[]} categories
 * @returns {{ ok: true, item: BankCsvBudgetLineItem, matchedCategory: boolean } | { ok: false, errors: BankCsvValidationError[] }}
 */
function parseBankCsvRow(cells, rowNumber, mapping, categories) {
	/** @type {BankCsvValidationError[]} */
	const errors = [];

	/** @param {number | null} column @returns {string} */
	const cellAt = (column) => (column !== null && column < cells.length ? cells[column] : '');

	/** Every column this mapping actually reads from, named for the error message. */
	const mappedColumns = /** @type {[string, number | null][]} */ ([
		['Date', mapping.dateColumn],
		['Description', mapping.descriptionColumn],
		['Amount', mapping.amountMode === 'signed' ? mapping.amountColumn : null],
		['Debit', mapping.amountMode === 'debit-credit' ? mapping.debitColumn : null],
		['Credit', mapping.amountMode === 'debit-credit' ? mapping.creditColumn : null],
		['Category', mapping.categoryColumn]
	]);
	for (const [label, column] of mappedColumns) {
		if (column !== null && column >= cells.length) {
			errors.push({
				path: `row ${rowNumber}`,
				message: `has no ${label} column (expected at least ${column + 1} columns, found ${cells.length})`
			});
		}
	}
	if (errors.length > 0) return { ok: false, errors };

	const dateResult = parseBankDateCell(cellAt(mapping.dateColumn), mapping.dateFormat);
	if (!dateResult.ok) errors.push({ path: `row ${rowNumber} (Date)`, message: dateResult.message });

	const description = cellAt(mapping.descriptionColumn).trim();
	if (description === '')
		errors.push({ path: `row ${rowNumber} (Description)`, message: 'must not be blank' });

	let amount = null;
	if (mapping.amountMode === 'signed') {
		const result = parseBankAmountCell(cellAt(mapping.amountColumn));
		if (!result.ok) errors.push({ path: `row ${rowNumber} (Amount)`, message: result.message });
		else if (result.value === null)
			errors.push({ path: `row ${rowNumber} (Amount)`, message: 'must not be blank' });
		else amount = Math.abs(result.value);
	} else {
		const debitResult = parseBankAmountCell(cellAt(mapping.debitColumn));
		const creditResult = parseBankAmountCell(cellAt(mapping.creditColumn));
		if (!debitResult.ok)
			errors.push({ path: `row ${rowNumber} (Debit)`, message: debitResult.message });
		if (!creditResult.ok)
			errors.push({ path: `row ${rowNumber} (Credit)`, message: creditResult.message });
		if (debitResult.ok && creditResult.ok) {
			const debitSet = debitResult.value !== null;
			const creditSet = creditResult.value !== null;
			if (debitSet && creditSet) {
				errors.push({
					path: `row ${rowNumber}`,
					message: 'has both a Debit and a Credit amount — expected exactly one per row'
				});
			} else if (!debitSet && !creditSet) {
				errors.push({
					path: `row ${rowNumber}`,
					message: 'has neither a Debit nor a Credit amount'
				});
			} else {
				amount = Math.abs(
					/** @type {number} */ (debitSet ? debitResult.value : creditResult.value)
				);
			}
		}
	}

	if (errors.length > 0) return { ok: false, errors };

	const categoryId =
		mapping.categoryColumn === null
			? null
			: matchCategoryId(cellAt(mapping.categoryColumn), categories);

	return {
		ok: true,
		item: createBudgetLineItem({
			name: description,
			amount: /** @type {number} */ (amount),
			category_id: categoryId,
			notes: dateResult.ok ? dateResult.value : ''
		}),
		matchedCategory: categoryId !== null
	};
}

/* -------------------------------------------------------------------------- */
/* The entry point                                                            */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} BankCsvImportSummary
 * @property {number} records How many transactions were imported.
 * @property {number} matchedCategories How many of them matched an existing `BudgetCategory` by
 *   name via the mapped category column.
 * @property {number} unmatchedCategories `records - matchedCategories` — imported with
 *   `category_id: null`, to be categorised later in the normal Budget UI.
 */

/**
 * @typedef {object} BankCsvImportSuccess
 * @property {true} ok
 * @property {BankCsvBudgetLineItem[]} lineItems Fresh records, ready to append to
 *   `budget.line_items` — never a replacement for what's already there.
 * @property {BankCsvImportSummary} summary
 */

/**
 * @typedef {object} BankCsvImportFailure
 * @property {false} ok
 * @property {'invalid-csv' | 'incomplete-mapping'} reason
 * @property {string} message A sentence safe to show the user as-is.
 * @property {BankCsvValidationError[]} errors One entry per cell/row that didn't parse
 *   (`invalid-csv`); empty for `incomplete-mapping`, which has nothing more specific to point at.
 */

/**
 * @typedef {BankCsvImportSuccess | BankCsvImportFailure} BankCsvImportResult
 */

/**
 * Parse every data row against `mapping` and turn it into a fresh `BudgetLineItem`. Never throws
 * and never mutates `dataRows`/`categories` — the caller only appends `lineItems` to
 * `budget.line_items` once this returns `ok: true`.
 *
 * @param {readonly string[][]} dataRows Every row *except* the header — i.e. what's left after
 *   `parseCsv(text)`'s first row is split off.
 * @param {BankCsvMapping} mapping
 * @param {readonly BankCsvBudgetCategory[]} categories `budget.categories`, for category-name
 *   matching. An empty list is fine — every row then imports with `category_id: null`.
 * @returns {BankCsvImportResult}
 */
export function parseBankCsvImport(dataRows, mapping, categories) {
	if (!isBankCsvMappingComplete(mapping)) {
		return {
			ok: false,
			reason: 'incomplete-mapping',
			message:
				'Choose a column for Date, Description and Amount (or Debit/Credit) before importing.',
			errors: []
		};
	}

	if (dataRows.length === 0) {
		return {
			ok: false,
			reason: 'invalid-csv',
			message: 'That file has a header row but no data rows to import.',
			errors: []
		};
	}

	/** @type {BankCsvValidationError[]} */
	const rowErrors = [];
	/** @type {BankCsvBudgetLineItem[]} */
	const lineItems = [];
	let matchedCategories = 0;

	dataRows.forEach((cells, index) => {
		const rowNumber = index + 2; // the header is row 1
		const parsed = parseBankCsvRow(cells, rowNumber, mapping, categories);
		if (parsed.ok) {
			lineItems.push(parsed.item);
			if (parsed.matchedCategory) matchedCategories += 1;
		} else {
			rowErrors.push(...parsed.errors);
		}
	});

	if (rowErrors.length > 0) {
		return {
			ok: false,
			reason: 'invalid-csv',
			message: `That file has ${rowErrors.length} problem${rowErrors.length === 1 ? '' : 's'} that can't be imported as-is — nothing has been changed.`,
			errors: rowErrors
		};
	}

	return {
		ok: true,
		lineItems,
		summary: {
			records: lineItems.length,
			matchedCategories,
			unmatchedCategories: lineItems.length - matchedCategories
		}
	};
}
