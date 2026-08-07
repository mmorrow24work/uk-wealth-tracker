import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
	createAppData,
	createAsset,
	createDebt,
	createInvestment,
	createMonthlyEntry,
	createPension,
	createProperty
} from './model.js';
import { buildWorkbook, defaultXlsxFilename, exportAppDataToXlsx } from './xlsx-export.js';

/**
 * @param {XLSX.WorkBook} workbook
 * @param {string} name
 * @returns {Record<string, unknown>[]}
 */
function rowsOf(workbook, name) {
	const sheet = workbook.Sheets[name];
	expect(sheet).toBeDefined();
	return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

describe('buildWorkbook', () => {
	it('has the six sheets the issue asks for, in order', () => {
		const workbook = buildWorkbook(createAppData());
		expect(workbook.SheetNames).toEqual([
			'Net Worth History',
			'Holdings',
			'Debts',
			'Pensions',
			'Properties',
			'Physical Assets'
		]);
	});

	it('every sheet is header-only for a brand new, empty document', () => {
		const workbook = buildWorkbook(createAppData());
		for (const name of workbook.SheetNames) {
			expect(rowsOf(workbook, name)).toEqual([]);
		}
	});

	describe('Net Worth History', () => {
		it('one row per recorded month, oldest first, with investments/debts/net worth totalled', () => {
			const appData = createAppData({
				monthly_entries: [
					createMonthlyEntry({
						month: 2,
						year: 2026,
						investments: [createInvestment({ value: 12_000 })],
						debts: [createDebt({ balance: 2_000 })]
					}),
					createMonthlyEntry({
						month: 1,
						year: 2026,
						investments: [createInvestment({ value: 10_000 })],
						debts: [createDebt({ balance: 1_000 })]
					})
				]
			});
			const rows = rowsOf(buildWorkbook(appData), 'Net Worth History');
			expect(rows).toHaveLength(2);
			expect(rows[0]).toMatchObject({
				'Investments (£)': 10_000,
				'Debts (£)': 1_000,
				'Net Worth (£)': 9_000,
				'Auto-filled': 'No'
			});
			expect(rows[1]).toMatchObject({
				'Investments (£)': 12_000,
				'Debts (£)': 2_000,
				'Net Worth (£)': 10_000
			});
		});

		it('drops a holding or debt flagged excluded from net worth, same as the chart', () => {
			const appData = createAppData({
				monthly_entries: [
					createMonthlyEntry({
						month: 1,
						year: 2026,
						investments: [
							createInvestment({ value: 10_000 }),
							createInvestment({ value: 5_000, exclude_from_net_worth: true })
						],
						debts: []
					})
				]
			});
			const rows = rowsOf(buildWorkbook(appData), 'Net Worth History');
			expect(rows[0]['Investments (£)']).toBe(10_000);
		});

		it('marks an auto-filled month', () => {
			const appData = createAppData({
				monthly_entries: [createMonthlyEntry({ month: 1, year: 2026, auto_filled: true })]
			});
			const rows = rowsOf(buildWorkbook(appData), 'Net Worth History');
			expect(rows[0]['Auto-filled']).toBe('Yes');
		});
	});

	describe('Holdings', () => {
		it('lists the latest recorded month’s holdings, not every month’s', () => {
			const appData = createAppData({
				monthly_entries: [
					createMonthlyEntry({
						month: 1,
						year: 2026,
						investments: [createInvestment({ name: 'January holding', value: 1_000 })]
					}),
					createMonthlyEntry({
						month: 2,
						year: 2026,
						investments: [createInvestment({ name: 'February holding', value: 2_000 })]
					})
				]
			});
			const rows = rowsOf(buildWorkbook(appData), 'Holdings');
			expect(rows).toHaveLength(1);
			expect(rows[0].Name).toBe('February holding');
		});

		it('renders enum codes as their label and lists an excluded holding too', () => {
			const appData = createAppData({
				monthly_entries: [
					createMonthlyEntry({
						month: 1,
						year: 2026,
						investments: [
							createInvestment({
								name: 'Vanguard FTSE Global All Cap',
								type: 'stocks_isa',
								wrapper: 'isa_stocks_shares',
								value: 15_000,
								fund_fee: 0.22,
								ownership_pct: 100,
								exclude_from_net_worth: true
							})
						]
					})
				]
			});
			const rows = rowsOf(buildWorkbook(appData), 'Holdings');
			expect(rows[0]).toMatchObject({
				Name: 'Vanguard FTSE Global All Cap',
				Type: 'Stocks ISA',
				Wrapper: 'Stocks & Shares ISA',
				'Value (£)': 15_000,
				'Fund fee (%)': 0.22,
				'Excluded from net worth': 'Yes'
			});
		});
	});

	describe('Debts', () => {
		it('lists the latest month’s debts with their type label', () => {
			const appData = createAppData({
				monthly_entries: [
					createMonthlyEntry({
						month: 1,
						year: 2026,
						debts: [createDebt({ name: 'Halifax mortgage', type: 'mortgage', balance: 180_000 })]
					})
				]
			});
			const rows = rowsOf(buildWorkbook(appData), 'Debts');
			expect(rows[0]).toMatchObject({
				Name: 'Halifax mortgage',
				Type: 'Mortgage',
				'Balance (£)': 180_000,
				'Excluded from net worth': 'No'
			});
		});
	});

	describe('Pensions', () => {
		it('carries DC and DB fields through, blank where not recorded', () => {
			const appData = createAppData({
				pensions: [
					createPension({ name: 'Workplace DC', type: 'dc_workplace', value: 40_000 }),
					createPension({
						name: 'Final salary scheme',
						type: 'db_final_salary',
						value: 0,
						db_accrual_rate: 1.6667,
						db_years: 12,
						db_salary: 55_000
					})
				]
			});
			const rows = rowsOf(buildWorkbook(appData), 'Pensions');
			expect(rows[0]).toMatchObject({
				Name: 'Workplace DC',
				Type: 'DC Workplace',
				'Value (£)': 40_000
			});
			expect(rows[0]['DB accrual rate (%)']).toBe('');
			expect(rows[1]).toMatchObject({
				Name: 'Final salary scheme',
				Type: 'Defined Benefit (Final Salary)',
				'DB accrual rate (%)': 1.6667,
				'DB years of service': 12,
				'DB pensionable salary (£)': 55_000
			});
		});
	});

	describe('Properties', () => {
		it('derives equity as value minus mortgage balance and formats the deal expiry as a date', () => {
			const appData = createAppData({
				properties: [
					createProperty({
						name: 'Home',
						type: 'primary_residence',
						value: 350_000,
						mortgage_balance: 200_000,
						deal_expiry: '2027-03-01'
					})
				]
			});
			const rows = rowsOf(buildWorkbook(appData), 'Properties');
			expect(rows[0]).toMatchObject({
				Name: 'Home',
				Type: 'Primary residence',
				'Value (£)': 350_000,
				'Mortgage balance (£)': 200_000,
				'Equity (£)': 150_000,
				'Included in net worth': 'Yes'
			});
			expect(rows[0]['Deal expiry']).toBeTypeOf('number'); // Excel serial date, not a string.
		});

		it('leaves deal expiry blank when not recorded', () => {
			const appData = createAppData({ properties: [createProperty({ deal_expiry: null })] });
			const rows = rowsOf(buildWorkbook(appData), 'Properties');
			expect(rows[0]['Deal expiry']).toBe('');
		});
	});

	describe('Physical Assets', () => {
		it('lists a physical asset with its category label and purchase date', () => {
			const appData = createAppData({
				assets: [
					createAsset({
						name: 'Rolex Submariner',
						category: 'watches_jewellery',
						purchase_price: 8_000,
						current_value: 11_000,
						purchase_date: '2022-06-15',
						include_in_net_worth: false
					})
				]
			});
			const rows = rowsOf(buildWorkbook(appData), 'Physical Assets');
			expect(rows[0]).toMatchObject({
				Name: 'Rolex Submariner',
				Category: 'Watches & Jewellery',
				'Purchase price (£)': 8_000,
				'Current value (£)': 11_000,
				'Included in net worth': 'No'
			});
			expect(rows[0]['Purchase date']).toBeTypeOf('number');
		});
	});
});

describe('defaultXlsxFilename', () => {
	it('is stamped with the given date as an ISO day, not a locale-dependent format', () => {
		expect(defaultXlsxFilename(new Date('2026-08-07T12:00:00.000Z'))).toBe(
			'uk-wealth-tracker-export-2026-08-07.xlsx'
		);
	});
});

describe('exportAppDataToXlsx', () => {
	it('is a no-op outside a browser rather than throwing — every route here is prerendered', () => {
		expect(() => exportAppDataToXlsx(createAppData())).not.toThrow();
	});
});
