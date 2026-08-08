import { describe, expect, it } from 'vitest';

import { csvEscapeField, columnsToCsv, formatCsvValue } from './csv-export.js';
import {
	CSV_MIME_TYPE,
	exportDebtsCsv,
	exportHoldingsCsv,
	exportNetWorthHistoryCsv
} from './csv-export.js';
import { DEBT_TYPE_LABELS, INVESTMENT_TYPE_LABELS, WRAPPER_LABELS } from './enums.js';
import { createAppData, createDebt, createInvestment, createMonthlyEntry } from './model.js';
import { netWorthSeries } from './net-worth.js';

const EXPORTED_AT = '2026-08-07T12:34:56.000Z';
const BOM = '﻿';

describe('formatCsvValue', () => {
	it('writes null/undefined as an empty string', () => {
		expect(formatCsvValue({ header: 'X', value: () => null }, null)).toBe('');
		expect(formatCsvValue({ header: 'X', value: () => null }, undefined)).toBe('');
	});

	it('writes a Date as an ISO YYYY-MM-DD string', () => {
		const column = { header: 'Month', value: () => null };
		expect(formatCsvValue(column, new Date(Date.UTC(2026, 2, 1)))).toBe('2026-03-01');
	});

	it('writes a currency-formatted value fixed to 2dp, with no currency symbol', () => {
		const column = {
			header: 'Value',
			value: () => null,
			format: /** @type {const} */ ('currency')
		};
		expect(formatCsvValue(column, 1234.5)).toBe('1234.50');
		expect(formatCsvValue(column, 0)).toBe('0.00');
	});

	it('writes a percent-formatted fraction back out as a percentage, suffixed %', () => {
		const column = { header: 'Fee', value: () => null, format: /** @type {const} */ ('percent') };
		expect(formatCsvValue(column, 0.0022)).toBe('0.22%');
		expect(formatCsvValue(column, 0.5)).toBe('50.00%');
	});

	it('writes any other value with plain String()', () => {
		const column = { header: 'Name', value: () => null };
		expect(formatCsvValue(column, 'Vanguard FTSE')).toBe('Vanguard FTSE');
		expect(formatCsvValue(column, 1996)).toBe('1996');
	});
});

describe('csvEscapeField', () => {
	it('leaves a plain field unquoted', () => {
		expect(csvEscapeField('Vanguard FTSE Global All Cap')).toBe('Vanguard FTSE Global All Cap');
	});

	it('quotes a field containing a comma', () => {
		expect(csvEscapeField('Halifax, joint account')).toBe('"Halifax, joint account"');
	});

	it('quotes a field containing a double quote, doubling it', () => {
		expect(csvEscapeField('The "emergency" fund')).toBe('"The ""emergency"" fund"');
	});

	it('quotes a field containing a line break', () => {
		expect(csvEscapeField('Line one\nLine two')).toBe('"Line one\nLine two"');
	});
});

describe('columnsToCsv', () => {
	/** @type {import('./xlsx-export.js').XlsxColumn[]} */
	const columns = [
		{ header: 'Name', value: (row) => row.name },
		{ header: 'Amount', value: (row) => row.amount, format: 'currency' }
	];

	it('writes a header row followed by one row per record, CRLF-terminated', () => {
		const csv = columnsToCsv(columns, [{ name: 'ISA', amount: 1234.5 }]);
		expect(csv).toBe('Name,Amount\r\nISA,1234.50\r\n');
	});

	it('produces a header-only CSV for an empty record set', () => {
		expect(columnsToCsv(columns, [])).toBe('Name,Amount\r\n');
	});

	it('escapes a field that needs it, leaving the rest of the row untouched', () => {
		const csv = columnsToCsv(columns, [{ name: 'Halifax, joint account', amount: 100 }]);
		expect(csv).toBe('Name,Amount\r\n"Halifax, joint account",100.00\r\n');
	});
});

describe('exportNetWorthHistoryCsv', () => {
	it('starts with a UTF-8 BOM', () => {
		const { csv } = exportNetWorthHistoryCsv(createAppData(), { exportedAt: EXPORTED_AT });
		expect(csv.startsWith(BOM)).toBe(true);
	});

	it('names the file with the net-worth-history slug and the export date', () => {
		const { filename } = exportNetWorthHistoryCsv(createAppData(), { exportedAt: EXPORTED_AT });
		expect(filename).toBe('uk-wealth-tracker-export-net-worth-history-2026-08-07.csv');
	});

	it('defaults exported_at to now when not given', () => {
		const { filename } = exportNetWorthHistoryCsv(createAppData());
		expect(filename).toMatch(/^uk-wealth-tracker-export-net-worth-history-\d{4}-\d{2}-\d{2}\.csv$/);
	});

	it('produces a header-only file when there is no recorded history', () => {
		const { csv } = exportNetWorthHistoryCsv(createAppData(), { exportedAt: EXPORTED_AT });
		expect(csv).toBe(`${BOM}Month,Investments,Debts,Net Worth\r\n`);
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

		const { csv } = exportNetWorthHistoryCsv(data, { exportedAt: EXPORTED_AT });
		const lines = csv.slice(BOM.length).trimEnd().split('\r\n');

		expect(lines[0]).toBe('Month,Investments,Debts,Net Worth');
		expect(lines).toHaveLength(points.length + 1);
		points.forEach((point, index) => {
			expect(lines[index + 1]).toBe(
				`${point.date.toISOString().slice(0, 10)},${point.investments.toFixed(2)},${point.debts.toFixed(2)},${point.net_worth.toFixed(2)}`
			);
		});
	});
});

describe('exportHoldingsCsv', () => {
	const HOLDINGS_HEADER =
		'Month,Name,Type,Wrapper,Value,Bought For,Year Purchased,Monthly Contribution,Contribution Frequency,Fund Fee,Ownership %,Included in Net Worth,Notes';

	it('names the file with the holdings slug', () => {
		const { filename } = exportHoldingsCsv(createAppData(), { exportedAt: EXPORTED_AT });
		expect(filename).toBe('uk-wealth-tracker-export-holdings-2026-08-07.csv');
	});

	it('writes a header-only file when there is no recorded history', () => {
		const { csv } = exportHoldingsCsv(createAppData(), { exportedAt: EXPORTED_AT });
		expect(csv).toBe(`${BOM}${HOLDINGS_HEADER}\r\n`);
	});

	it('writes one row per holding per recorded month, oldest first', () => {
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

		const { csv } = exportHoldingsCsv(data, { exportedAt: EXPORTED_AT });
		const lines = csv.slice(BOM.length).trimEnd().split('\r\n');

		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe(HOLDINGS_HEADER);
		expect(lines[1]).toBe(
			[
				'2026-01-01',
				'Vanguard FTSE Global All Cap',
				INVESTMENT_TYPE_LABELS.stocks_isa,
				WRAPPER_LABELS.isa_stocks_shares,
				'10000.00',
				'9000.00',
				'2022',
				'250.00',
				'Monthly',
				'0.22%',
				'100.00%',
				'Yes',
				'Core holding'
			].join(',')
		);
		expect(lines[2].startsWith('2026-02-01,')).toBe(true);
	});

	it('leaves a null bought_for/year_purchased as an empty field, not 0', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ bought_for: null, year_purchased: null })]
				})
			]
		});

		const { csv } = exportHoldingsCsv(data, { exportedAt: EXPORTED_AT });
		const fields = csv.slice(BOM.length).trimEnd().split('\r\n')[1].split(',');
		expect(fields[5]).toBe('');
		expect(fields[6]).toBe('');
	});

	it('quotes a name or notes field containing a comma', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ name: 'ISA, joint', notes: 'Top-up, then hold' })]
				})
			]
		});

		const { csv } = exportHoldingsCsv(data, { exportedAt: EXPORTED_AT });
		expect(csv).toContain('"ISA, joint"');
		expect(csv).toContain('"Top-up, then hold"');
	});
});

describe('exportDebtsCsv', () => {
	const DEBTS_HEADER = 'Month,Name,Type,Balance,Included in Net Worth,Notes';

	it('names the file with the debts slug', () => {
		const { filename } = exportDebtsCsv(createAppData(), { exportedAt: EXPORTED_AT });
		expect(filename).toBe('uk-wealth-tracker-export-debts-2026-08-07.csv');
	});

	it('writes a header-only file when there is no recorded history', () => {
		const { csv } = exportDebtsCsv(createAppData(), { exportedAt: EXPORTED_AT });
		expect(csv).toBe(`${BOM}${DEBTS_HEADER}\r\n`);
	});

	it('writes one row per debt per recorded month, with the enums.js type label', () => {
		const mortgage = createDebt({
			id: 'debt-mortgage',
			name: 'Halifax mortgage',
			type: 'mortgage',
			balance: 200000,
			exclude_from_net_worth: false
		});
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({ month: 2, year: 2026, debts: [{ ...mortgage, balance: 198500 }] }),
				createMonthlyEntry({ month: 1, year: 2026, debts: [mortgage] })
			]
		});

		const { csv } = exportDebtsCsv(data, { exportedAt: EXPORTED_AT });
		const lines = csv.slice(BOM.length).trimEnd().split('\r\n');

		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe(DEBTS_HEADER);
		expect(lines[1]).toBe(
			`2026-01-01,Halifax mortgage,${DEBT_TYPE_LABELS.mortgage},200000.00,Yes,`
		);
		expect(lines[2]).toBe(
			`2026-02-01,Halifax mortgage,${DEBT_TYPE_LABELS.mortgage},198500.00,Yes,`
		);
	});
});

describe('CSV_MIME_TYPE', () => {
	it('is a UTF-8 text/csv MIME type', () => {
		expect(CSV_MIME_TYPE).toBe('text/csv;charset=utf-8');
	});
});
