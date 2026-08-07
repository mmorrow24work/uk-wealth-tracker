import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { DEBT_TYPE_LABELS, INVESTMENT_TYPE_LABELS, WRAPPER_LABELS } from './enums.js';
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
	it("looks up a code's label from an enums.js *_LABELS map", () => {
		expect(enumLabel(INVESTMENT_TYPE_LABELS, 'sipp')).toBe('SIPP');
		expect(enumLabel(WRAPPER_LABELS, 'gia')).toBe('General Investment Account');
		expect(enumLabel(DEBT_TYPE_LABELS, 'mortgage')).toBe('Mortgage');
	});
});

describe('percentFraction', () => {
	it('divides a stored whole-number percent by 100', () => {
		expect(percentFraction(5)).toBe(0.05);
		expect(percentFraction(100)).toBe(1);
		expect(percentFraction(0)).toBe(0);
	});

	it('passes a null through as null rather than 0', () => {
		expect(percentFraction(null)).toBeNull();
	});
});

describe('suggestXlsxExportFilename', () => {
	it('carries the date, matching data-transfer.js JSON export filenames but with .xlsx', () => {
		expect(suggestXlsxExportFilename(EXPORTED_AT)).toBe('uk-wealth-tracker-export-2026-08-07.xlsx');
	});
});

describe('exportFinancialDataXlsx', () => {
	it('produces a workbook with the net worth history, holdings and debts sheets, in order', () => {
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

describe('exportFinancialDataXlsx — Holdings sheet', () => {
	const HOLDINGS_HEADER = [
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
		'Included in Net Worth',
		'Notes'
	];

	it('writes a header-only sheet when there is no recorded history', () => {
		const { bytes } = exportFinancialDataXlsx(createAppData(), { exportedAt: EXPORTED_AT });
		const sheet = readBack(bytes).Sheets[HOLDINGS_SHEET_NAME];
		expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([HOLDINGS_HEADER]);
	});

	it('writes one row per holding per recorded month, not one row per distinct holding', () => {
		const isa = createInvestment({
			id: 'inv-isa',
			name: 'Vanguard FTSE Global All Cap',
			type: 'stocks_isa',
			wrapper: 'isa_stocks_shares',
			value: 10000,
			bought_for: 9000,
			year_purchased: 2022,
			monthly_contribution: 250,
			contribution_frequency: 'monthly',
			fund_fee: 0.22,
			ownership_pct: 100,
			notes: 'Core holding',
			exclude_from_net_worth: false
		});
		const isaNextMonth = { ...isa, value: 10500 };
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({ month: 2, year: 2026, investments: [isaNextMonth] }),
				createMonthlyEntry({ month: 1, year: 2026, investments: [isa] })
			]
		});

		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const sheet = readBack(bytes, { cellDates: true }).Sheets[HOLDINGS_SHEET_NAME];
		const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

		expect(rows).toHaveLength(3);
		// Oldest month first, matching compareMonthlyEntries — not the input order above.
		expect(rows[1][0]).toEqual(new Date(Date.UTC(2026, 0, 1)));
		expect(rows[1][4]).toBe(10000);
		expect(rows[2][0]).toEqual(new Date(Date.UTC(2026, 1, 1)));
		expect(rows[2][4]).toBe(10500);
	});

	it('sums rows across every recorded month, not the count of distinct holdings', () => {
		// Two distinct holdings, but `isa` is recorded in both months — 3 rows, not 2.
		const isa = createInvestment({ id: 'inv-isa' });
		const cash = createInvestment({ id: 'inv-cash' });
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({ month: 1, year: 2026, investments: [isa, cash] }),
				createMonthlyEntry({ month: 2, year: 2026, investments: [isa] })
			]
		});

		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const sheet = readBack(bytes).Sheets[HOLDINGS_SHEET_NAME];
		const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
		expect(rows).toHaveLength(1 + 3);
	});

	it('writes enum fields as their enums.js label, not the stored code', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [
						createInvestment({
							type: 'sipp',
							wrapper: 'gia',
							contribution_frequency: 'quarterly'
						})
					]
				})
			]
		});

		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const sheet = readBack(bytes).Sheets[HOLDINGS_SHEET_NAME];
		const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
		expect(rows[1][2]).toBe('SIPP');
		expect(rows[1][3]).toBe('General Investment Account');
		expect(rows[1][8]).toBe('Quarterly');
	});

	it('leaves a null bought_for/year_purchased as a blank cell, not 0', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ bought_for: null, year_purchased: null })]
				})
			]
		});

		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const sheet = readBack(bytes).Sheets[HOLDINGS_SHEET_NAME];
		expect(sheet.F2).toBeUndefined();
		expect(sheet.G2).toBeUndefined();
	});

	it('writes fund_fee and ownership_pct as a fraction under the true percent format', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ fund_fee: 0.22, ownership_pct: 50 })]
				})
			]
		});

		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		// `cellNF: true` is what makes `XLSX.read` restore each cell's format string onto `.z` —
		// without it the reader keeps only a style index, and this assertion would see `undefined`
		// even though the workbook on disk carries the format `buildSheet` stamped on write.
		const sheet = readBack(bytes, { cellNF: true }).Sheets[HOLDINGS_SHEET_NAME];
		expect(sheet.J2.v).toBeCloseTo(0.0022);
		expect(sheet.J2.z).toBe(XLSX_NUMBER_FORMATS.percent);
		expect(sheet.K2.v).toBeCloseTo(0.5);
		expect(sheet.K2.z).toBe(XLSX_NUMBER_FORMATS.percent);
	});

	it('does not stamp a number format on year_purchased, unlike the integer preset', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ year_purchased: 1996 })]
				})
			]
		});

		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const sheet = readBack(bytes).Sheets[HOLDINGS_SHEET_NAME];
		expect(sheet.G2.v).toBe(1996);
		expect(sheet.G2.z).toBeUndefined();
	});

	it('renders exclude_from_net_worth as a readable Yes/No column, keeping the row', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [
						createInvestment({ name: 'Kept', exclude_from_net_worth: false }),
						createInvestment({ name: 'Excluded', exclude_from_net_worth: true })
					]
				})
			]
		});

		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const sheet = readBack(bytes).Sheets[HOLDINGS_SHEET_NAME];
		const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
		expect(rows).toHaveLength(3);
		expect(rows[1][1]).toBe('Kept');
		expect(rows[1][11]).toBe('Yes');
		expect(rows[2][1]).toBe('Excluded');
		expect(rows[2][11]).toBe('No');
	});
});

describe('exportFinancialDataXlsx — Debts sheet', () => {
	const DEBTS_HEADER = ['Month', 'Name', 'Type', 'Balance', 'Included in Net Worth', 'Notes'];

	it('writes a header-only sheet when there is no recorded history', () => {
		const { bytes } = exportFinancialDataXlsx(createAppData(), { exportedAt: EXPORTED_AT });
		const sheet = readBack(bytes).Sheets[DEBTS_SHEET_NAME];
		expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([DEBTS_HEADER]);
	});

	it('writes one row per debt per recorded month', () => {
		const mortgage = createDebt({ id: 'debt-mortgage', name: 'Halifax mortgage', balance: 200000 });
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({ month: 2, year: 2026, debts: [{ ...mortgage, balance: 198500 }] }),
				createMonthlyEntry({ month: 1, year: 2026, debts: [mortgage] })
			]
		});

		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const sheet = readBack(bytes, { cellDates: true }).Sheets[DEBTS_SHEET_NAME];
		const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

		expect(rows).toHaveLength(3);
		expect(rows[1][0]).toEqual(new Date(Date.UTC(2026, 0, 1)));
		expect(rows[1][3]).toBe(200000);
		expect(rows[2][0]).toEqual(new Date(Date.UTC(2026, 1, 1)));
		expect(rows[2][3]).toBe(198500);
	});

	it('writes the debt type as its enums.js label, not the stored code', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({ month: 1, year: 2026, debts: [createDebt({ type: 'mortgage' })] })
			]
		});

		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const sheet = readBack(bytes).Sheets[DEBTS_SHEET_NAME];
		const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
		expect(rows[1][2]).toBe('Mortgage');
	});

	it('renders exclude_from_net_worth as a readable Yes/No column, keeping the row', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					debts: [
						createDebt({ name: 'Kept', exclude_from_net_worth: false }),
						createDebt({
							name: 'Mortgage (equity tracked elsewhere)',
							exclude_from_net_worth: true
						})
					]
				})
			]
		});

		const { bytes } = exportFinancialDataXlsx(data, { exportedAt: EXPORTED_AT });
		const sheet = readBack(bytes).Sheets[DEBTS_SHEET_NAME];
		const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
		expect(rows).toHaveLength(3);
		expect(rows[1][4]).toBe('Yes');
		expect(rows[2][4]).toBe('No');
	});
});
