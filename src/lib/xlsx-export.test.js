import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
	CONTRIBUTION_FREQUENCY_LABELS,
	DEBT_TYPE_LABELS,
	INVESTMENT_TYPE_LABELS,
	WRAPPER_LABELS
} from './enums.js';
import { createAppData, createDebt, createInvestment, createMonthlyEntry } from './model.js';
import { netWorthSeries } from './net-worth.js';
import {
	DEBTS_SHEET_NAME,
	HOLDINGS_SHEET_NAME,
	NET_WORTH_HISTORY_SHEET_NAME,
	XLSX_NUMBER_FORMATS,
	buildSheet,
	buildWorkbook,
	enumLabel,
	exportFinancialDataXlsx,
	percentFraction,
	suggestXlsxExportFilename
} from './xlsx-export.js';

const EXPORTED_AT = '2026-08-07T12:34:56.000Z';

/**
 * `XLSX.read` is used only here, in tests, to check what {@link exportFinancialDataXlsx} actually
 * wrote — the module under test never calls it (see its module doc comment on the SheetJS
 * advisories). Reading our own freshly-written bytes back is the only way to confirm the workbook
 * is a real, well-formed `.xlsx` rather than bytes that merely look plausible.
 *
 * @param {ArrayBuffer} bytes
 * @param {import('xlsx').ParsingOptions} [opts]
 */
function readBack(bytes, opts = {}) {
	return XLSX.read(bytes, { type: 'array', ...opts });
}

describe('buildSheet', () => {
	/** @type {import('./xlsx-export.js').XlsxColumn[]} */
	const columns = [
		{ header: 'Name', value: (row) => row.name },
		{ header: 'Amount', value: (row) => row.amount, format: 'currency' }
	];
	const rows = [
		{ name: 'ISA', amount: 1234.5 },
		{ name: 'GIA', amount: 0 }
	];

	it('writes a header row followed by one row per record', () => {
		const worksheet = buildSheet(columns, rows);
		expect(worksheet.A1.v).toBe('Name');
		expect(worksheet.B1.v).toBe('Amount');
		expect(worksheet.A2.v).toBe('ISA');
		expect(worksheet.B2.v).toBe(1234.5);
		expect(worksheet.A3.v).toBe('GIA');
		expect(worksheet.B3.v).toBe(0);
	});

	it('stamps the number format onto data cells only, not the header', () => {
		const worksheet = buildSheet(columns, rows);
		expect(worksheet.B1.z).toBeUndefined();
		expect(worksheet.B2.z).toBe(XLSX_NUMBER_FORMATS.currency);
		expect(worksheet.B3.z).toBe(XLSX_NUMBER_FORMATS.currency);
		expect(worksheet.A2.z).toBeUndefined();
	});

	it('lets a column override the format with an explicit numFmt', () => {
		const worksheet = buildSheet(
			[{ header: 'Month', value: () => new Date(Date.UTC(2026, 2, 1)), numFmt: 'mmm yyyy' }],
			[{}]
		);
		expect(worksheet.A2.z).toBe('mmm yyyy');
		expect(worksheet.A2.v).toBeInstanceOf(Date);
	});

	it('leaves a null cell value unformatted rather than writing a blank formatted cell', () => {
		/** @type {import('./xlsx-export.js').XlsxColumn[]} */
		const nullColumns = [{ header: 'Amount', value: () => null, format: 'currency' }];
		const worksheet = buildSheet(nullColumns, [{}]);
		expect(worksheet.A2).toBeUndefined();
	});

	it('sets a column width, defaulting to 14 characters when none is given', () => {
		/** @type {import('./xlsx-export.js').XlsxColumn[]} */
		const widthColumns = [
			{ header: 'Name', value: (row) => row.name, width: 20 },
			{ header: 'Amount', value: (row) => row.amount }
		];
		const worksheet = buildSheet(widthColumns, rows);
		expect(worksheet['!cols']).toEqual([{ wch: 20 }, { wch: 14 }]);
	});

	it('produces a header-only sheet for an empty record set', () => {
		const worksheet = buildSheet(columns, []);
		expect(worksheet.A1.v).toBe('Name');
		expect(worksheet.A2).toBeUndefined();
	});
});

describe('buildWorkbook', () => {
	it('appends every sheet under its given name, in order', () => {
		const one = buildSheet([{ header: 'A', value: () => 'x' }], [{}]);
		const two = buildSheet([{ header: 'B', value: () => 'y' }], [{}]);
		const workbook = buildWorkbook([
			{ name: 'First', worksheet: one },
			{ name: 'Second', worksheet: two }
		]);
		expect(workbook.SheetNames).toEqual(['First', 'Second']);
		expect(workbook.Sheets.First).toBe(one);
		expect(workbook.Sheets.Second).toBe(two);
	});
});

describe('enumLabel', () => {
	it('looks up the label for a given code', () => {
		expect(enumLabel({ gia: 'General Investment Account', sipp: 'SIPP' }, 'gia')).toBe(
			'General Investment Account'
		);
	});
});

describe('percentFraction', () => {
	it('divides a whole-number percent by 100 for the 0.00% format', () => {
		expect(percentFraction(5)).toBe(0.05);
		expect(percentFraction(0)).toBe(0);
	});

	it('passes null through unchanged, rather than producing 0', () => {
		expect(percentFraction(null)).toBeNull();
	});
});

describe('suggestXlsxExportFilename', () => {
	it('carries the date, matching data-transfer.js JSON export filenames but with .xlsx', () => {
		expect(suggestXlsxExportFilename(EXPORTED_AT)).toBe('uk-wealth-tracker-export-2026-08-07.xlsx');
	});
});

describe('exportFinancialDataXlsx', () => {
	it('produces a workbook with the net worth history, holdings and debts sheets, in that order', () => {
		const { bytes, filename } = exportFinancialDataXlsx(createAppData(), {
			exportedAt: EXPORTED_AT
		});
		expect(filename).toBe('uk-wealth-tracker-export-2026-08-07.xlsx');

		const workbook = readBack(bytes);
		expect(workbook.SheetNames).toEqual([
			NET_WORTH_HISTORY_SHEET_NAME,
			HOLDINGS_SHEET_NAME,
			DEBTS_SHEET_NAME
		]);
	});

	it('defaults exported_at to now when not given', () => {
		const { filename } = exportFinancialDataXlsx(createAppData());
		expect(filename).toMatch(/^uk-wealth-tracker-export-\d{4}-\d{2}-\d{2}\.xlsx$/);
	});

	it('restates netWorthSeries as rows, agreeing with the chart to the penny', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ value: 10000 })],
					debts: [createDebt({ balance: 2500 })]
				}),
				createMonthlyEntry({
					month: 2,
					year: 2026,
					investments: [createInvestment({ value: 10500 })],
					debts: [createDebt({ balance: 2400 })]
				})
			]
		});
		const points = netWorthSeries(data.monthly_entries);

		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes);
		const sheet = workbook.Sheets[NET_WORTH_HISTORY_SHEET_NAME];
		const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

		expect(rows[0]).toEqual(['Month', 'Investments', 'Debts', 'Net Worth']);
		expect(rows).toHaveLength(points.length + 1);
		points.forEach((point, index) => {
			const row = rows[index + 1];
			expect(row[1]).toBe(point.investments);
			expect(row[2]).toBe(point.debts);
			expect(row[3]).toBe(point.net_worth);
		});
	});

	it('writes the month column as a real date cell, not a string', () => {
		const data = createAppData({
			monthly_entries: [createMonthlyEntry({ month: 3, year: 2026 })]
		});
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes, { cellDates: true });
		const sheet = workbook.Sheets[NET_WORTH_HISTORY_SHEET_NAME];
		expect(sheet.A2.t).toBe('d');
	});

	it('produces a header-only sheet when there is no recorded history', () => {
		const { bytes } = exportFinancialDataXlsx(createAppData(), { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes);
		const sheet = workbook.Sheets[NET_WORTH_HISTORY_SHEET_NAME];
		const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
		expect(rows).toEqual([['Month', 'Investments', 'Debts', 'Net Worth']]);
	});
});

describe('the Holdings sheet', () => {
	const isa = createInvestment({
		name: 'Vanguard FTSE Global All Cap',
		type: 'stocks_isa',
		wrapper: 'isa_stocks_shares',
		value: 12000,
		bought_for: 10000,
		year_purchased: 2020,
		monthly_contribution: 250,
		contribution_frequency: 'monthly',
		fund_fee: 5,
		notes: 'Core index tracker',
		exclude_from_net_worth: false,
		ownership_pct: 100
	});
	const gia = createInvestment({
		name: 'Property fund',
		type: 'property',
		wrapper: 'gia',
		value: 5000,
		bought_for: null,
		year_purchased: null,
		fund_fee: 0,
		exclude_from_net_worth: true,
		ownership_pct: 50
	});
	const data = createAppData({
		monthly_entries: [
			createMonthlyEntry({ month: 2, year: 2026, investments: [isa, gia] }),
			createMonthlyEntry({ month: 1, year: 2026, investments: [isa] })
		]
	});

	it('writes the header row in Investment field order', () => {
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes);
		const rows = XLSX.utils.sheet_to_json(workbook.Sheets[HOLDINGS_SHEET_NAME], { header: 1 });
		expect(rows[0]).toEqual([
			'Month',
			'Name',
			'Type',
			'Wrapper',
			'Value',
			'Bought For',
			'Year Purchased',
			'Monthly Contribution',
			'Contribution Frequency',
			'Fund Fee',
			'Ownership %',
			'Notes',
			'Included in Net Worth'
		]);
	});

	it('expands to one row per holding per month, oldest month first, summed across every month', () => {
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes, { cellDates: true });
		const rows = XLSX.utils.sheet_to_json(workbook.Sheets[HOLDINGS_SHEET_NAME], { header: 1 });

		// 1 holding in January + 2 holdings in February = 3 rows, not 2 (the distinct-holding count).
		expect(rows).toHaveLength(4);
		expect(rows[1][0]).toEqual(new Date(Date.UTC(2026, 0, 1)));
		expect(rows[1][1]).toBe('Vanguard FTSE Global All Cap');
		expect(rows[2][0]).toEqual(new Date(Date.UTC(2026, 1, 1)));
		expect(rows[2][1]).toBe('Vanguard FTSE Global All Cap');
		expect(rows[3][0]).toEqual(new Date(Date.UTC(2026, 1, 1)));
		expect(rows[3][1]).toBe('Property fund');
	});

	it('writes enum fields as their enums.js label, not the stored code', () => {
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes);
		const rows = XLSX.utils.sheet_to_json(workbook.Sheets[HOLDINGS_SHEET_NAME], { header: 1 });
		const isaRow = rows[1];
		expect(isaRow[2]).toBe(INVESTMENT_TYPE_LABELS.stocks_isa);
		expect(isaRow[3]).toBe(WRAPPER_LABELS.isa_stocks_shares);
		expect(isaRow[8]).toBe(CONTRIBUTION_FREQUENCY_LABELS.monthly);
	});

	it('leaves a null bought_for/year_purchased as a blank cell, not zero', () => {
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes);
		const sheet = workbook.Sheets[HOLDINGS_SHEET_NAME];
		// Row 4 is the GIA property fund, recorded only in February.
		expect(sheet.F4).toBeUndefined();
		expect(sheet.G4).toBeUndefined();
	});

	it('writes fund_fee and ownership_pct as a fraction under the true percent format', () => {
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes, { cellNF: true });
		const sheet = workbook.Sheets[HOLDINGS_SHEET_NAME];
		// Row 2 is the ISA's January entry: fund_fee 5%, ownership_pct 100%.
		expect(sheet.J2.v).toBe(0.05);
		expect(sheet.J2.z).toBe(XLSX_NUMBER_FORMATS.percent);
		expect(sheet.K2.v).toBe(1);
		expect(sheet.K2.z).toBe(XLSX_NUMBER_FORMATS.percent);
	});

	it('gives year_purchased no number format, so a four-digit year prints plain', () => {
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes, { cellNF: true });
		const sheet = workbook.Sheets[HOLDINGS_SHEET_NAME];
		expect(sheet.G2.v).toBe(2020);
		expect(sheet.G2.z).toBe('General');
	});

	it('restates exclude_from_net_worth as a readable Yes/No column', () => {
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes);
		const rows = XLSX.utils.sheet_to_json(workbook.Sheets[HOLDINGS_SHEET_NAME], { header: 1 });
		expect(rows[1][12]).toBe('Yes'); // ISA, exclude_from_net_worth: false
		expect(rows[3][12]).toBe('No'); // Property fund, exclude_from_net_worth: true
	});

	it('produces a header-only sheet when there are no holdings', () => {
		const { bytes } = exportFinancialDataXlsx(createAppData(), { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes);
		const rows = XLSX.utils.sheet_to_json(workbook.Sheets[HOLDINGS_SHEET_NAME], { header: 1 });
		expect(rows).toHaveLength(1);
	});
});

describe('the Debts sheet', () => {
	const mortgage = createDebt({
		name: 'Halifax mortgage',
		type: 'mortgage',
		balance: 200000,
		notes: 'Repayment, 25yr term',
		exclude_from_net_worth: true
	});
	const creditCard = createDebt({
		name: 'Amex',
		type: 'credit_card',
		balance: 500,
		exclude_from_net_worth: false
	});
	const data = createAppData({
		monthly_entries: [
			createMonthlyEntry({ month: 2, year: 2026, debts: [mortgage, creditCard] }),
			createMonthlyEntry({ month: 1, year: 2026, debts: [mortgage] })
		]
	});

	it('writes the header row in Debt field order', () => {
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes);
		const rows = XLSX.utils.sheet_to_json(workbook.Sheets[DEBTS_SHEET_NAME], { header: 1 });
		expect(rows[0]).toEqual(['Month', 'Name', 'Type', 'Balance', 'Notes', 'Included in Net Worth']);
	});

	it('expands to one row per debt per month, oldest month first', () => {
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes, { cellDates: true });
		const rows = XLSX.utils.sheet_to_json(workbook.Sheets[DEBTS_SHEET_NAME], { header: 1 });

		// 1 debt in January + 2 debts in February = 3 rows, not 2 (the distinct-debt count).
		expect(rows).toHaveLength(4);
		expect(rows[1][0]).toEqual(new Date(Date.UTC(2026, 0, 1)));
		expect(rows[1][1]).toBe('Halifax mortgage');
		expect(rows[2][1]).toBe('Halifax mortgage');
		expect(rows[3][1]).toBe('Amex');
	});

	it('writes the debt type as its enums.js label, and the balance under the currency format', () => {
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes, { cellNF: true });
		const sheet = workbook.Sheets[DEBTS_SHEET_NAME];
		expect(sheet.C2.v).toBe(DEBT_TYPE_LABELS.mortgage);
		expect(sheet.D2.v).toBe(200000);
		expect(sheet.D2.z).toBe(XLSX_NUMBER_FORMATS.currency);
	});

	it('restates exclude_from_net_worth as a readable Yes/No column', () => {
		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes);
		const rows = XLSX.utils.sheet_to_json(workbook.Sheets[DEBTS_SHEET_NAME], { header: 1 });
		expect(rows[1][5]).toBe('No'); // Halifax mortgage, exclude_from_net_worth: true
		expect(rows[3][5]).toBe('Yes'); // Amex, exclude_from_net_worth: false
	});

	it('produces a header-only sheet when there are no debts', () => {
		const { bytes } = exportFinancialDataXlsx(createAppData(), { exportedAt: EXPORTED_AT });
		const workbook = readBack(bytes);
		const rows = XLSX.utils.sheet_to_json(workbook.Sheets[DEBTS_SHEET_NAME], { header: 1 });
		expect(rows).toHaveLength(1);
	});
});
