import { describe, expect, it } from 'vitest';

import { exportDebtsCsv, exportHoldingsCsv, exportNetWorthHistoryCsv } from './csv-export.js';
import { detectCsvDataset, parseCsv, parseCsvImport } from './csv-import.js';
import { DEBT_TYPE_LABELS, INVESTMENT_TYPE_LABELS, WRAPPER_LABELS } from './enums.js';
import { createAppData, createDebt, createInvestment, createMonthlyEntry } from './model.js';

const HOLDINGS_HEADER =
	'Month,Name,Type,Wrapper,Value,Bought For,Year Purchased,Monthly Contribution,Contribution Frequency,Fund Fee,Ownership %,Included in Net Worth,Notes';
const DEBTS_HEADER = 'Month,Name,Type,Balance,Included in Net Worth,Notes';
const NET_WORTH_HISTORY_HEADER = 'Month,Investments,Debts,Net Worth';

describe('parseCsv', () => {
	it('parses a simple header + row', () => {
		expect(parseCsv('Name,Amount\r\nISA,100\r\n')).toEqual([
			['Name', 'Amount'],
			['ISA', '100']
		]);
	});

	it('strips a leading UTF-8 BOM', () => {
		expect(parseCsv('﻿Name,Amount\r\nISA,100\r\n')).toEqual([
			['Name', 'Amount'],
			['ISA', '100']
		]);
	});

	it('handles bare \\n line endings, not just \\r\\n', () => {
		expect(parseCsv('Name,Amount\nISA,100\n')).toEqual([
			['Name', 'Amount'],
			['ISA', '100']
		]);
	});

	it('drops a trailing blank line rather than reading it as a one-column row', () => {
		expect(parseCsv('Name\r\nISA\r\n')).toEqual([['Name'], ['ISA']]);
	});

	it('reads a file with no trailing line break at all', () => {
		expect(parseCsv('Name\r\nISA')).toEqual([['Name'], ['ISA']]);
	});

	it('reads a genuine blank line in the middle of the file as a one-cell row', () => {
		expect(parseCsv('Name\r\n\r\nISA\r\n')).toEqual([['Name'], [''], ['ISA']]);
	});

	it('unescapes a doubled double-quote inside a quoted field', () => {
		expect(parseCsv('Notes\r\n"The ""emergency"" fund"\r\n')).toEqual([
			['Notes'],
			['The "emergency" fund']
		]);
	});

	it('keeps a comma inside a quoted field as part of the same cell', () => {
		expect(parseCsv('Name,Amount\r\n"Halifax, joint account",100\r\n')).toEqual([
			['Name', 'Amount'],
			['Halifax, joint account', '100']
		]);
	});

	it('keeps a line break inside a quoted field as part of the same cell', () => {
		expect(parseCsv('Notes\r\n"Line one\nLine two"\r\n')).toEqual([
			['Notes'],
			['Line one\nLine two']
		]);
	});

	it('throws on an unterminated quoted field', () => {
		expect(() => parseCsv('Notes\r\n"unterminated')).toThrow(/never closed/);
	});
});

describe('detectCsvDataset', () => {
	it('recognises the Holdings header', () => {
		expect(detectCsvDataset(HOLDINGS_HEADER.split(','))).toBe('holdings');
	});

	it('recognises the Debts header', () => {
		expect(detectCsvDataset(DEBTS_HEADER.split(','))).toBe('debts');
	});

	it('recognises the Net Worth History header', () => {
		expect(detectCsvDataset(NET_WORTH_HISTORY_HEADER.split(','))).toBe('net-worth-history');
	});

	it('reports an unrelated header as unrecognised', () => {
		expect(detectCsvDataset(['Foo', 'Bar'])).toBe('unrecognised');
	});

	it('reports a header missing a column as unrecognised', () => {
		expect(detectCsvDataset(DEBTS_HEADER.split(',').slice(0, -1))).toBe('unrecognised');
	});
});

describe('parseCsvImport — round trip against csv-export.js', () => {
	it('round-trips a holding exported and re-imported into an empty document', () => {
		const isa = createInvestment({
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
		const exported = createAppData({
			monthly_entries: [createMonthlyEntry({ month: 3, year: 2026, investments: [isa] })]
		});
		const { csv } = exportHoldingsCsv(exported);

		const result = parseCsvImport(csv, createAppData());

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.dataset).toBe('holdings');
		expect(result.summary).toEqual({ records: 1, months: 1, newMonths: 1, updatedMonths: 0 });

		const entry = result.data.monthly_entries.find((e) => e.month === 3 && e.year === 2026);
		expect(entry).toBeDefined();
		if (!entry) return;
		expect(entry.investments).toHaveLength(1);
		const imported = entry.investments[0];
		expect(imported.id).not.toBe(isa.id);
		expect({ ...imported, id: undefined }).toEqual({ ...isa, id: undefined });
	});

	it('round-trips a debt exported and re-imported', () => {
		const mortgage = createDebt({
			name: 'Halifax mortgage',
			type: 'mortgage',
			balance: 200000,
			notes: 'Fixed until 2028',
			exclude_from_net_worth: true
		});
		const exported = createAppData({
			monthly_entries: [createMonthlyEntry({ month: 1, year: 2026, debts: [mortgage] })]
		});
		const { csv } = exportDebtsCsv(exported);

		const result = parseCsvImport(csv, createAppData());

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.dataset).toBe('debts');
		const entry = result.data.monthly_entries[0];
		const imported = entry.debts[0];
		expect(imported.id).not.toBe(mortgage.id);
		expect({ ...imported, id: undefined }).toEqual({ ...mortgage, id: undefined });
	});

	it('round-trips a null bought_for/year_purchased back to null, not 0', () => {
		const investment = createInvestment({ bought_for: null, year_purchased: null });
		const exported = createAppData({
			monthly_entries: [createMonthlyEntry({ month: 1, year: 2026, investments: [investment] })]
		});
		const { csv } = exportHoldingsCsv(exported);

		const result = parseCsvImport(csv, createAppData());

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const imported = result.data.monthly_entries[0].investments[0];
		expect(imported.bought_for).toBeNull();
		expect(imported.year_purchased).toBeNull();
	});

	it('round-trips a name/notes field containing a comma and a quote', () => {
		const investment = createInvestment({
			name: 'ISA, joint',
			notes: 'Top-up, then "hold"'
		});
		const exported = createAppData({
			monthly_entries: [createMonthlyEntry({ month: 1, year: 2026, investments: [investment] })]
		});
		const { csv } = exportHoldingsCsv(exported);

		const result = parseCsvImport(csv, createAppData());

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const imported = result.data.monthly_entries[0].investments[0];
		expect(imported.name).toBe('ISA, joint');
		expect(imported.notes).toBe('Top-up, then "hold"');
	});

	it('round-trips every enum label back to its stored code', () => {
		const investment = createInvestment({
			type: 'crypto',
			wrapper: 'sipp',
			contribution_frequency: 'quarterly'
		});
		const exported = createAppData({
			monthly_entries: [createMonthlyEntry({ month: 1, year: 2026, investments: [investment] })]
		});
		const { csv } = exportHoldingsCsv(exported);

		const result = parseCsvImport(csv, createAppData());

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const imported = result.data.monthly_entries[0].investments[0];
		expect(imported.type).toBe('crypto');
		expect(imported.wrapper).toBe('sipp');
		expect(imported.contribution_frequency).toBe('quarterly');
	});

	it('round-trips several holdings across several months, oldest first', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ value: 100 })]
				}),
				createMonthlyEntry({
					month: 2,
					year: 2026,
					investments: [createInvestment({ value: 200 })]
				})
			]
		});
		const { csv } = exportHoldingsCsv(data);

		const result = parseCsvImport(csv, createAppData());

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.summary).toEqual({ records: 2, months: 2, newMonths: 2, updatedMonths: 0 });
		expect(result.data.monthly_entries.map((e) => e.month)).toEqual([1, 2]);
	});
});

describe('parseCsvImport — rejection reasons', () => {
	it('rejects garbage text as invalid-csv', () => {
		const result = parseCsvImport('not,a,valid\nfile at all', createAppData());
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(['invalid-csv', 'unrecognised-csv']).toContain(result.reason);
	});

	it('rejects an empty file as invalid-csv', () => {
		const result = parseCsvImport('', createAppData());
		expect(result).toMatchObject({ ok: false, reason: 'invalid-csv' });
	});

	it('rejects a header that matches no known export as unrecognised-csv', () => {
		const result = parseCsvImport('Foo,Bar\r\n1,2\r\n', createAppData());
		expect(result).toMatchObject({ ok: false, reason: 'unrecognised-csv' });
		if (result.ok) return;
		expect(result.errors).toEqual([]);
	});

	it('rejects a Net Worth History export as read-only-dataset, with a specific message', () => {
		const { csv } = exportNetWorthHistoryCsv(
			createAppData({
				monthly_entries: [createMonthlyEntry({ month: 1, year: 2026 })]
			})
		);
		const result = parseCsvImport(csv, createAppData());
		expect(result).toMatchObject({ ok: false, reason: 'read-only-dataset' });
		if (result.ok) return;
		expect(result.message).toMatch(/Net Worth History/);
		expect(result.message).toMatch(/Holdings or Debts/);
	});

	it('rejects a row with the wrong number of columns as invalid-csv', () => {
		const csv = `${HOLDINGS_HEADER}\r\n2026-01-01,Too,Few,Columns\r\n`;
		const result = parseCsvImport(csv, createAppData());
		expect(result).toMatchObject({ ok: false, reason: 'invalid-csv' });
		if (result.ok) return;
		expect(result.errors[0].path).toBe('row 2');
	});

	it('rejects a malformed Month cell with a row-and-column-named reason', () => {
		const csv = `${DEBTS_HEADER}\r\nnot-a-date,Mortgage,${DEBT_TYPE_LABELS.mortgage},1000,Yes,\r\n`;
		const result = parseCsvImport(csv, createAppData());
		expect(result).toMatchObject({ ok: false, reason: 'invalid-csv' });
		if (result.ok) return;
		expect(result.errors).toEqual([
			{ path: 'row 2 (Month)', message: expect.stringContaining('ISO date') }
		]);
	});

	it('rejects a malformed currency cell', () => {
		const csv = `${DEBTS_HEADER}\r\n2026-01-01,Mortgage,${DEBT_TYPE_LABELS.mortgage},not-a-number,Yes,\r\n`;
		const result = parseCsvImport(csv, createAppData());
		expect(result).toMatchObject({ ok: false, reason: 'invalid-csv' });
		if (result.ok) return;
		expect(result.errors).toEqual([
			{ path: 'row 2 (Balance)', message: expect.stringContaining('number') }
		]);
	});

	it('rejects a malformed percentage cell', () => {
		const csv = `${HOLDINGS_HEADER}\r\n2026-01-01,ISA,${INVESTMENT_TYPE_LABELS.stocks_isa},${WRAPPER_LABELS.isa_stocks_shares},100.00,,,0.00,Monthly,not-a-percent,100.00%,Yes,\r\n`;
		const result = parseCsvImport(csv, createAppData());
		expect(result).toMatchObject({ ok: false, reason: 'invalid-csv' });
		if (result.ok) return;
		expect(result.errors).toEqual([
			{ path: 'row 2 (Fund Fee)', message: expect.stringContaining('percentage') }
		]);
	});

	it('rejects an unrecognised enum label', () => {
		const csv = `${DEBTS_HEADER}\r\n2026-01-01,Mortgage,Not A Real Type,1000,Yes,\r\n`;
		const result = parseCsvImport(csv, createAppData());
		expect(result).toMatchObject({ ok: false, reason: 'invalid-csv' });
		if (result.ok) return;
		expect(result.errors[0].path).toBe('row 2 (Type)');
	});

	it('rejects an unrecognised Yes/No value', () => {
		const csv = `${DEBTS_HEADER}\r\n2026-01-01,Mortgage,${DEBT_TYPE_LABELS.mortgage},1000,Maybe,\r\n`;
		const result = parseCsvImport(csv, createAppData());
		expect(result).toMatchObject({ ok: false, reason: 'invalid-csv' });
		if (result.ok) return;
		expect(result.errors[0].path).toBe('row 2 (Included in Net Worth)');
	});

	it('reports every bad row, not just the first', () => {
		const csv = `${DEBTS_HEADER}\r\nnot-a-date,Mortgage,${DEBT_TYPE_LABELS.mortgage},1000,Yes,\r\n2026-02-01,Loan,${DEBT_TYPE_LABELS.loan},not-a-number,Yes,\r\n`;
		const result = parseCsvImport(csv, createAppData());
		expect(result).toMatchObject({ ok: false, reason: 'invalid-csv' });
		if (result.ok) return;
		expect(result.errors).toHaveLength(2);
		expect(result.errors[0].path).toBe('row 2 (Month)');
		expect(result.errors[1].path).toBe('row 3 (Balance)');
	});

	it('rejects a structurally valid row that fails business-rule validation as invalid-data', () => {
		// 150% is a valid percentage string, but out of validateAppData's 0-100% range.
		const csv = `${HOLDINGS_HEADER}\r\n2026-01-01,ISA,${INVESTMENT_TYPE_LABELS.stocks_isa},${WRAPPER_LABELS.isa_stocks_shares},100.00,,,0.00,Monthly,150.00%,100.00%,Yes,\r\n`;
		const result = parseCsvImport(csv, createAppData());
		expect(result).toMatchObject({ ok: false, reason: 'invalid-data' });
		if (result.ok) return;
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0]).toMatchObject({ path: expect.stringContaining('fund_fee') });
	});
});

describe('parseCsvImport — merge semantics', () => {
	it('creates a new MonthlyEntry for a month the current document has none of', () => {
		const current = createAppData();
		const { csv } = exportHoldingsCsv(
			createAppData({
				monthly_entries: [
					createMonthlyEntry({ month: 6, year: 2026, investments: [createInvestment()] })
				]
			})
		);

		const result = parseCsvImport(csv, current);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.summary.newMonths).toBe(1);
		expect(result.summary.updatedMonths).toBe(0);
		expect(result.data.monthly_entries).toHaveLength(1);
	});

	it('replaces investments wholesale on a month that already has an entry, leaving its debts untouched', () => {
		const existingDebt = createDebt({ name: 'Existing debt', balance: 500 });
		const oldInvestment = createInvestment({ name: 'Old holding', value: 1 });
		const current = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 3,
					year: 2026,
					investments: [oldInvestment],
					debts: [existingDebt]
				})
			]
		});
		const newInvestment = createInvestment({ name: 'New holding', value: 2 });
		const { csv } = exportHoldingsCsv(
			createAppData({
				monthly_entries: [
					createMonthlyEntry({ month: 3, year: 2026, investments: [newInvestment] })
				]
			})
		);

		const result = parseCsvImport(csv, current);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.summary).toEqual({ records: 1, months: 1, newMonths: 0, updatedMonths: 1 });

		const entry = result.data.monthly_entries[0];
		expect(entry.investments).toHaveLength(1);
		expect(entry.investments[0].name).toBe('New holding');
		expect(entry.debts).toEqual([existingDebt]);
	});

	it('leaves a month the file does not mention completely untouched', () => {
		const untouchedEntry = createMonthlyEntry({
			month: 1,
			year: 2026,
			investments: [createInvestment({ name: 'Untouched' })]
		});
		const current = createAppData({ monthly_entries: [untouchedEntry] });
		const { csv } = exportHoldingsCsv(
			createAppData({
				monthly_entries: [
					createMonthlyEntry({ month: 2, year: 2026, investments: [createInvestment()] })
				]
			})
		);

		const result = parseCsvImport(csv, current);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const entry = result.data.monthly_entries.find((e) => e.month === 1 && e.year === 2026);
		expect(entry).toEqual(untouchedEntry);
	});

	it('resets auto_filled to false on a touched entry that was previously auto-filled', () => {
		const current = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 4,
					year: 2026,
					investments: [createInvestment()],
					auto_filled: true
				})
			]
		});
		const { csv } = exportHoldingsCsv(
			createAppData({
				monthly_entries: [
					createMonthlyEntry({
						month: 4,
						year: 2026,
						investments: [createInvestment({ value: 999 })]
					})
				]
			})
		);

		const result = parseCsvImport(csv, current);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.monthly_entries[0].auto_filled).toBe(false);
	});

	it('does not mutate the current document passed in', () => {
		const current = createAppData({
			monthly_entries: [
				createMonthlyEntry({ month: 1, year: 2026, investments: [createInvestment()] })
			]
		});
		const snapshot = JSON.parse(JSON.stringify(current));
		const { csv } = exportHoldingsCsv(
			createAppData({
				monthly_entries: [
					createMonthlyEntry({
						month: 1,
						year: 2026,
						investments: [createInvestment({ value: 42 })]
					})
				]
			})
		);

		parseCsvImport(csv, current);

		expect(current).toEqual(snapshot);
	});
});
