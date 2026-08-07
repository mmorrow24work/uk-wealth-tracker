import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { createAppData, createDebt, createInvestment, createMonthlyEntry } from './model.js';
import { netWorthSeries } from './net-worth.js';
import {
	NET_WORTH_HISTORY_SHEET_NAME,
	XLSX_NUMBER_FORMATS,
	buildSheet,
	buildWorkbook,
	exportFinancialDataXlsx,
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

describe('suggestXlsxExportFilename', () => {
	it('carries the date, matching data-transfer.js JSON export filenames but with .xlsx', () => {
		expect(suggestXlsxExportFilename(EXPORTED_AT)).toBe('uk-wealth-tracker-export-2026-08-07.xlsx');
	});
});

describe('exportFinancialDataXlsx', () => {
	it('produces a workbook with only the net worth history sheet', () => {
		const { bytes, filename } = exportFinancialDataXlsx(createAppData(), {
			exportedAt: EXPORTED_AT
		});
		expect(filename).toBe('uk-wealth-tracker-export-2026-08-07.xlsx');

		const workbook = readBack(bytes);
		expect(workbook.SheetNames).toEqual([NET_WORTH_HISTORY_SHEET_NAME]);
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
