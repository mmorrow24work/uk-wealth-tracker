/**
 * XLSX export of the whole document (issue #64) — a client-side `.xlsx` workbook built with
 * SheetJS (`xlsx`), no backend involved, same as the JSON export planned for issue #100. Six
 * sheets, one per collection: Net Worth History, Holdings, Debts, Pensions, Properties, Physical
 * Assets — the exact list the issue names, in that order.
 *
 * Split in two for testability, the same reason `$lib/store.js` keeps its debounced-save timer
 * separate from `persist()`: {@link buildWorkbook} is pure — `AppData` in, a SheetJS `WorkBook`
 * out — and is exercised directly in `xlsx-export.test.js` by reading cells back with
 * `XLSX.utils.sheet_to_json`. {@link downloadWorkbook} is the one function that touches
 * `Blob`/`URL`/`document`, which this repo's tests cannot drive (see `GitHubSignIn.test.js`'s own
 * note on there being no browser test environment here) — it stays a thin, unit-untestable shell
 * around `buildWorkbook`'s output.
 *
 * **Holdings and Debts are the latest recorded month's snapshot**, not one row per month per
 * holding — `monthly_entries` re-states every holding fresh each month (`$lib/model.js`'s own
 * convention), so a full-history export of those two sheets would mean one row per holding per
 * month it was ever recorded, most of them identical. The Net Worth History sheet already covers
 * the time series; Holdings/Debts cover today's detail the way `InvestmentHoldings`/`DebtTracker`
 * do on screen. Every holding/debt is listed, not just the ones counted towards net worth — same
 * as those two components — with an "Excluded from net worth" column for the ones that are not.
 *
 * **Numbers are formatted, not raw** (the issue's own words): money columns carry a `£#,##0.00`
 * cell format, percentage columns (which this app stores as whole numbers — `5` means 5%, see
 * `$lib/types.js`'s units convention) carry a custom `0.00"%"` format that displays the stored
 * number with a percent sign rather than dividing by 100 into Excel's own percentage type, and
 * date columns are real dates (not date strings) formatted `dd/mm/yyyy`. All three are Excel
 * *display* formats over the same values the app already stores — nothing is transformed on the
 * way in, so a figure in the spreadsheet always matches the one in the app.
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
import { netWorthSeries } from './net-worth.js';
import { propertyEquity } from './property.js';

/** Cell number formats for {@link buildSheet}'s `format` column option. */
const CELL_FORMATS = Object.freeze({
	currency: '"£"#,##0.00',
	percent: '0.00"%"',
	date: 'dd/mm/yyyy',
	month: 'mmm yyyy'
});

/**
 * @typedef {object} SheetColumn
 * @property {string} header Column heading, row 1.
 * @property {string} key Property of each row object this column reads.
 * @property {keyof typeof CELL_FORMATS} [format] Number format to apply to every data cell in the
 *   column. Omitted for plain text/number columns Excel can format on its own.
 * @property {number} [width] Column width, in characters. Defaults to a readable 14.
 */

/**
 * `null`/`undefined` in, empty string out — every non-money, non-date column funnels its blanks
 * through this so a missing value renders as an empty cell rather than the literal text "null".
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function orBlank(value) {
	return value === null || value === undefined ? '' : value;
}

/**
 * @param {boolean} value
 * @returns {'Yes' | 'No'}
 */
function yesNo(value) {
	return value ? 'Yes' : 'No';
}

/**
 * One worksheet: a header row plus one row per record, with each {@link SheetColumn}'s format
 * applied down its data cells and a `!cols` width hint set for the whole sheet.
 *
 * @param {readonly SheetColumn[]} columns
 * @param {readonly Record<string, unknown>[]} rows
 * @returns {XLSX.WorkSheet}
 */
function buildSheet(columns, rows) {
	const header = columns.map((column) => column.header);
	const aoa = [header, ...rows.map((row) => columns.map((column) => row[column.key]))];
	const sheet = XLSX.utils.aoa_to_sheet(aoa);

	columns.forEach((column, colIndex) => {
		const format = column.format && CELL_FORMATS[column.format];
		if (!format) return;
		for (let r = 1; r <= rows.length; r += 1) {
			const cell = sheet[XLSX.utils.encode_cell({ r, c: colIndex })];
			if (cell) cell.z = format;
		}
	});

	sheet['!cols'] = columns.map((column) => ({ wch: column.width ?? 14 }));
	return sheet;
}

/**
 * The latest recorded month, oldest-first order's last entry — `null` when nothing is recorded
 * yet. Shared by the Holdings and Debts sheets so both read the same "today" (see module doc).
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} monthlyEntries
 * @returns {import('./types.js').MonthlyEntry | null}
 */
function latestMonthlyEntry(monthlyEntries) {
	if (monthlyEntries.length === 0) return null;
	return [...monthlyEntries].sort(compareMonthlyEntries).at(-1) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Sheets                                                                      */
/* -------------------------------------------------------------------------- */

/** @type {readonly SheetColumn[]} */
const NET_WORTH_HISTORY_COLUMNS = [
	{ header: 'Month', key: 'month', format: 'month', width: 12 },
	{ header: 'Investments (£)', key: 'investments', format: 'currency' },
	{ header: 'Debts (£)', key: 'debts', format: 'currency' },
	{ header: 'Net Worth (£)', key: 'net_worth', format: 'currency' },
	{ header: 'Auto-filled', key: 'auto_filled', width: 12 }
];

/**
 * @param {readonly import('./types.js').MonthlyEntry[]} monthlyEntries
 * @returns {XLSX.WorkSheet}
 */
function netWorthHistorySheet(monthlyEntries) {
	const rows = netWorthSeries(monthlyEntries).map((point) => ({
		month: point.date,
		investments: point.investments,
		debts: point.debts,
		net_worth: point.net_worth,
		auto_filled: yesNo(point.auto_filled)
	}));
	return buildSheet(NET_WORTH_HISTORY_COLUMNS, rows);
}

/** @type {readonly SheetColumn[]} */
const HOLDINGS_COLUMNS = [
	{ header: 'Name', key: 'name', width: 28 },
	{ header: 'Type', key: 'type', width: 16 },
	{ header: 'Wrapper', key: 'wrapper', width: 22 },
	{ header: 'Value (£)', key: 'value', format: 'currency' },
	{ header: 'Bought for (£)', key: 'bought_for', format: 'currency' },
	{ header: 'Year purchased', key: 'year_purchased', width: 12 },
	{
		header: 'Monthly contribution (£)',
		key: 'monthly_contribution',
		format: 'currency',
		width: 18
	},
	{ header: 'Contribution frequency', key: 'contribution_frequency', width: 18 },
	{ header: 'Fund fee (%)', key: 'fund_fee', format: 'percent' },
	{ header: 'Ownership (%)', key: 'ownership_pct', format: 'percent' },
	{ header: 'Excluded from net worth', key: 'excluded', width: 18 },
	{ header: 'Notes', key: 'notes', width: 30 }
];

/**
 * @param {readonly import('./types.js').MonthlyEntry[]} monthlyEntries
 * @returns {XLSX.WorkSheet}
 */
function holdingsSheet(monthlyEntries) {
	const entry = latestMonthlyEntry(monthlyEntries);
	const rows = (entry?.investments ?? []).map((investment) => ({
		name: investment.name,
		type: INVESTMENT_TYPE_LABELS[investment.type] ?? investment.type,
		wrapper: WRAPPER_LABELS[investment.wrapper] ?? investment.wrapper,
		value: investment.value,
		bought_for: orBlank(investment.bought_for),
		year_purchased: orBlank(investment.year_purchased),
		monthly_contribution: investment.monthly_contribution,
		contribution_frequency:
			CONTRIBUTION_FREQUENCY_LABELS[investment.contribution_frequency] ??
			investment.contribution_frequency,
		fund_fee: investment.fund_fee,
		ownership_pct: investment.ownership_pct,
		excluded: yesNo(investment.exclude_from_net_worth),
		notes: orBlank(investment.notes)
	}));
	return buildSheet(HOLDINGS_COLUMNS, rows);
}

/** @type {readonly SheetColumn[]} */
const DEBTS_COLUMNS = [
	{ header: 'Name', key: 'name', width: 28 },
	{ header: 'Type', key: 'type', width: 16 },
	{ header: 'Balance (£)', key: 'balance', format: 'currency' },
	{ header: 'Excluded from net worth', key: 'excluded', width: 18 },
	{ header: 'Notes', key: 'notes', width: 30 }
];

/**
 * @param {readonly import('./types.js').MonthlyEntry[]} monthlyEntries
 * @returns {XLSX.WorkSheet}
 */
function debtsSheet(monthlyEntries) {
	const entry = latestMonthlyEntry(monthlyEntries);
	const rows = (entry?.debts ?? []).map((debt) => ({
		name: debt.name,
		type: DEBT_TYPE_LABELS[debt.type] ?? debt.type,
		balance: debt.balance,
		excluded: yesNo(debt.exclude_from_net_worth),
		notes: orBlank(debt.notes)
	}));
	return buildSheet(DEBTS_COLUMNS, rows);
}

/** @type {readonly SheetColumn[]} */
const PENSIONS_COLUMNS = [
	{ header: 'Name', key: 'name', width: 28 },
	{ header: 'Type', key: 'type', width: 24 },
	{ header: 'Value (£)', key: 'value', format: 'currency' },
	{ header: 'Own contribution (%)', key: 'contribution_pct', format: 'percent', width: 16 },
	{ header: 'Employer contribution (%)', key: 'employer_pct', format: 'percent', width: 18 },
	{ header: 'Fund fee (%)', key: 'fund_fee', format: 'percent' },
	{ header: 'DB accrual rate (%)', key: 'db_accrual_rate', format: 'percent', width: 16 },
	{ header: 'DB years of service', key: 'db_years', width: 16 },
	{ header: 'DB pensionable salary (£)', key: 'db_salary', format: 'currency', width: 18 },
	{ header: 'DB annual income (£)', key: 'db_annual_income', format: 'currency', width: 16 },
	{ header: 'NI qualifying years', key: 'ni_qualifying_years', width: 16 },
	{ header: 'NI future years', key: 'ni_future_years', width: 14 }
];

/**
 * @param {readonly import('./types.js').Pension[]} pensions
 * @returns {XLSX.WorkSheet}
 */
function pensionsSheet(pensions) {
	const rows = pensions.map((pension) => ({
		name: pension.name,
		type: PENSION_TYPE_LABELS[pension.type] ?? pension.type,
		value: pension.value,
		contribution_pct: pension.contribution_pct,
		employer_pct: pension.employer_pct,
		fund_fee: pension.fund_fee,
		db_accrual_rate: orBlank(pension.db_accrual_rate),
		db_years: orBlank(pension.db_years),
		db_salary: orBlank(pension.db_salary),
		db_annual_income: orBlank(pension.db_annual_income),
		ni_qualifying_years: orBlank(pension.ni_qualifying_years),
		ni_future_years: orBlank(pension.ni_future_years)
	}));
	return buildSheet(PENSIONS_COLUMNS, rows);
}

/** @type {readonly SheetColumn[]} */
const PROPERTIES_COLUMNS = [
	{ header: 'Name', key: 'name', width: 28 },
	{ header: 'Type', key: 'type', width: 18 },
	{ header: 'Value (£)', key: 'value', format: 'currency' },
	{ header: 'Mortgage balance (£)', key: 'mortgage_balance', format: 'currency', width: 18 },
	{ header: 'Equity (£)', key: 'equity', format: 'currency' },
	{ header: 'Monthly payment (£)', key: 'monthly_payment', format: 'currency', width: 16 },
	{ header: 'Interest rate (%)', key: 'interest_rate', format: 'percent', width: 14 },
	{ header: 'Mortgage type', key: 'mortgage_type', width: 16 },
	{ header: 'Deal expiry', key: 'deal_expiry', format: 'date', width: 14 },
	{ header: 'Rental income (£/mo)', key: 'rental_income', format: 'currency', width: 18 },
	{ header: 'Running costs (£/mo)', key: 'running_costs', format: 'currency', width: 18 },
	{ header: 'Growth rate (%)', key: 'growth_rate', format: 'percent', width: 14 },
	{ header: 'Included in net worth', key: 'included', width: 16 }
];

/**
 * @param {readonly import('./types.js').Property[]} properties
 * @returns {XLSX.WorkSheet}
 */
function propertiesSheet(properties) {
	const rows = properties.map((property) => ({
		name: property.name,
		type: PROPERTY_TYPE_LABELS[property.type] ?? property.type,
		value: property.value,
		mortgage_balance: property.mortgage_balance,
		equity: propertyEquity(property),
		monthly_payment: property.monthly_payment,
		interest_rate: property.interest_rate,
		mortgage_type: MORTGAGE_TYPE_LABELS[property.mortgage_type] ?? property.mortgage_type,
		deal_expiry: property.deal_expiry ? new Date(`${property.deal_expiry}T00:00:00Z`) : '',
		rental_income: property.rental_income,
		running_costs: property.running_costs,
		growth_rate: property.growth_rate,
		included: yesNo(property.include_in_net_worth)
	}));
	return buildSheet(PROPERTIES_COLUMNS, rows);
}

/** @type {readonly SheetColumn[]} */
const ASSETS_COLUMNS = [
	{ header: 'Name', key: 'name', width: 28 },
	{ header: 'Category', key: 'category', width: 20 },
	{ header: 'Purchase price (£)', key: 'purchase_price', format: 'currency', width: 16 },
	{ header: 'Current value (£)', key: 'current_value', format: 'currency', width: 16 },
	{ header: 'Purchase date', key: 'purchase_date', format: 'date', width: 14 },
	{ header: 'Expected growth (%)', key: 'expected_growth', format: 'percent', width: 16 },
	{ header: 'Holding cost (£/yr)', key: 'holding_cost', format: 'currency', width: 16 },
	{ header: 'Included in net worth', key: 'included', width: 16 }
];

/**
 * @param {readonly import('./types.js').Asset[]} assets
 * @returns {XLSX.WorkSheet}
 */
function assetsSheet(assets) {
	const rows = assets.map((asset) => ({
		name: asset.name,
		category: ASSET_CATEGORY_LABELS[asset.category] ?? asset.category,
		purchase_price: asset.purchase_price,
		current_value: asset.current_value,
		purchase_date: asset.purchase_date ? new Date(`${asset.purchase_date}T00:00:00Z`) : '',
		expected_growth: asset.expected_growth,
		holding_cost: asset.holding_cost,
		included: yesNo(asset.include_in_net_worth)
	}));
	return buildSheet(ASSETS_COLUMNS, rows);
}

/* -------------------------------------------------------------------------- */
/* Workbook                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build the whole export workbook from the live document — pure, and the thing
 * `xlsx-export.test.js` exercises directly. Six sheets in the order the issue lists them.
 *
 * @param {import('./types.js').AppData} appData
 * @returns {XLSX.WorkBook}
 */
export function buildWorkbook(appData) {
	const workbook = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(
		workbook,
		netWorthHistorySheet(appData.monthly_entries),
		'Net Worth History'
	);
	XLSX.utils.book_append_sheet(workbook, holdingsSheet(appData.monthly_entries), 'Holdings');
	XLSX.utils.book_append_sheet(workbook, debtsSheet(appData.monthly_entries), 'Debts');
	XLSX.utils.book_append_sheet(workbook, pensionsSheet(appData.pensions), 'Pensions');
	XLSX.utils.book_append_sheet(workbook, propertiesSheet(appData.properties), 'Properties');
	XLSX.utils.book_append_sheet(workbook, assetsSheet(appData.assets), 'Physical Assets');
	return workbook;
}

/**
 * `YYYY-MM-DD`, for the default export filename — matches the ISO dates the rest of the data
 * model already uses (`$lib/types.js`'s units convention), not a locale-dependent format.
 *
 * @param {Date} date
 * @returns {string}
 */
function isoDateStamp(date) {
	return date.toISOString().slice(0, 10);
}

/**
 * Default export filename, stamped with today's date so successive exports do not overwrite one
 * another in a Downloads folder.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function defaultXlsxFilename(now = new Date()) {
	return `uk-wealth-tracker-export-${isoDateStamp(now)}.xlsx`;
}

/**
 * Build the workbook and hand it straight to the browser as a file download — the sole
 * `Blob`/`URL`/`document` touchpoint in this module (see the module doc for why the rest is kept
 * pure and separate). A no-op outside a browser (SSR, tests): every route in this app is
 * prerendered, so this must not throw when it runs at build time with no `document` to hand.
 *
 * @param {import('./types.js').AppData} appData
 * @param {string} [filename]
 */
export function exportAppDataToXlsx(appData, filename = defaultXlsxFilename()) {
	if (typeof document === 'undefined') return;

	const workbook = buildWorkbook(appData);
	const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
	const blob = new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
	const url = URL.createObjectURL(blob);
	try {
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	} finally {
		URL.revokeObjectURL(url);
	}
}
