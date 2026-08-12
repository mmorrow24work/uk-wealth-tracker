import { describe, expect, it } from 'vitest';

import {
	BANK_CSV_DATE_FORMATS,
	guessBankCsvMapping,
	isBankCsvMappingComplete,
	parseBankCsvImport
} from './bank-csv-import.js';
import { parseCsv } from './csv-import.js';
import { createBudgetCategory } from './model.js';

/** @param {string} text @returns {{ header: string[], dataRows: string[][] }} */
function split(text) {
	const [header, ...dataRows] = parseCsv(text);
	return { header, dataRows };
}

/** @type {import('./bank-csv-import.js').BankCsvMapping} */
const SIGNED_MAPPING = {
	dateColumn: 0,
	dateFormat: 'DD/MM/YYYY',
	descriptionColumn: 1,
	amountMode: 'signed',
	amountColumn: 2,
	debitColumn: null,
	creditColumn: null,
	categoryColumn: null
};

describe('guessBankCsvMapping', () => {
	it('guesses a Date/Description/Amount header', () => {
		const mapping = guessBankCsvMapping(['Date', 'Description', 'Amount']);
		expect(mapping).toEqual({
			dateColumn: 0,
			dateFormat: 'DD/MM/YYYY',
			descriptionColumn: 1,
			amountMode: 'signed',
			amountColumn: 2,
			debitColumn: null,
			creditColumn: null,
			categoryColumn: null
		});
	});

	it('guesses debit/credit mode when there is no single amount column', () => {
		const mapping = guessBankCsvMapping(['Date', 'Narrative', 'Money out', 'Money in']);
		expect(mapping.amountMode).toBe('debit-credit');
		expect(mapping.debitColumn).toBe(2);
		expect(mapping.creditColumn).toBe(3);
		expect(mapping.amountColumn).toBeNull();
	});

	it('guesses a category column when present', () => {
		const mapping = guessBankCsvMapping(['Date', 'Description', 'Amount', 'Category']);
		expect(mapping.categoryColumn).toBe(3);
	});

	it('leaves fields unguessable from an unrecognised header as null', () => {
		const mapping = guessBankCsvMapping(['Col A', 'Col B']);
		expect(mapping.dateColumn).toBeNull();
		expect(mapping.descriptionColumn).toBeNull();
		expect(mapping.amountColumn).toBeNull();
		expect(mapping.categoryColumn).toBeNull();
	});
});

describe('isBankCsvMappingComplete', () => {
	it('is false with no columns chosen', () => {
		expect(
			isBankCsvMappingComplete({
				dateColumn: null,
				dateFormat: 'DD/MM/YYYY',
				descriptionColumn: null,
				amountMode: 'signed',
				amountColumn: null,
				debitColumn: null,
				creditColumn: null,
				categoryColumn: null
			})
		).toBe(false);
	});

	it('is true once date/description/amount are chosen in signed mode', () => {
		expect(isBankCsvMappingComplete(SIGNED_MAPPING)).toBe(true);
	});

	it('requires both debit and credit columns in debit-credit mode', () => {
		/** @type {import('./bank-csv-import.js').BankCsvMapping} */
		const mapping = {
			dateColumn: 0,
			dateFormat: 'DD/MM/YYYY',
			descriptionColumn: 1,
			amountMode: 'debit-credit',
			amountColumn: null,
			debitColumn: 2,
			creditColumn: null,
			categoryColumn: null
		};
		expect(isBankCsvMappingComplete(mapping)).toBe(false);
		expect(isBankCsvMappingComplete({ ...mapping, creditColumn: 3 })).toBe(true);
	});
});

describe('parseBankCsvImport — signed amount column', () => {
	it('imports a well-formed row as a fresh BudgetLineItem', () => {
		const { dataRows } = split('Date,Description,Amount\r\n31/03/2026,Tesco,-45.67\r\n');
		const result = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.lineItems).toHaveLength(1);
		const [item] = result.lineItems;
		expect(item.name).toBe('Tesco');
		expect(item.amount).toBe(45.67);
		expect(item.category_id).toBeNull();
		expect(item.notes).toBe('2026-03-31');
		expect(typeof item.id).toBe('string');
		expect(item.id).not.toBe('');
	});

	it('takes the absolute value of a positive amount too', () => {
		const { dataRows } = split('Date,Description,Amount\r\n01/01/2026,Salary,2000.00\r\n');
		const result = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.lineItems[0].amount).toBe(2000);
	});

	it('strips a currency symbol and thousands separator', () => {
		const { dataRows } = split('Date,Description,Amount\r\n01/01/2026,Rent,"-£1,234.56"\r\n');
		const result = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.lineItems[0].amount).toBe(1234.56);
	});

	it('reads a parenthesised amount as negative', () => {
		const { dataRows } = split('Date,Description,Amount\r\n01/01/2026,Fee,(12.50)\r\n');
		const result = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.lineItems[0].amount).toBe(12.5);
	});

	it('reports a per-row error for an unparseable amount, without throwing', () => {
		const { dataRows } = split('Date,Description,Amount\r\n01/01/2026,Tesco,not-a-number\r\n');
		const result = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('invalid-csv');
		expect(result.errors).toEqual([expect.objectContaining({ path: 'row 2 (Amount)' })]);
	});

	it('reports a per-row error for a blank amount in signed mode', () => {
		const { dataRows } = split('Date,Description,Amount\r\n01/01/2026,Tesco,\r\n');
		const result = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0].message).toMatch(/must not be blank/);
	});

	it('reports a per-row error for an invalid date', () => {
		const { dataRows } = split('Date,Description,Amount\r\n31/02/2026,Tesco,10\r\n');
		const result = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toEqual([expect.objectContaining({ path: 'row 2 (Date)' })]);
		}
	});

	it('reports a per-row error for a blank description', () => {
		const { dataRows } = split('Date,Description,Amount\r\n01/01/2026,,10\r\n');
		const result = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0].message).toMatch(/must not be blank/);
	});

	it('collects every problem across multiple rows rather than stopping at the first', () => {
		const { dataRows } = split(
			'Date,Description,Amount\r\n01/01/2026,,10\r\n02/01/2026,Coffee,oops\r\n'
		);
		const result = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors).toHaveLength(2);
	});

	it('parses every supported date format', () => {
		const cases = [
			['YYYY-MM-DD', '2026-03-31'],
			['MM/DD/YYYY', '03/31/2026'],
			['DD-MM-YYYY', '31-03-2026'],
			['DD.MM.YYYY', '31.03.2026']
		];
		for (const [dateFormat, raw] of cases) {
			const { dataRows } = split(`Date,Description,Amount\r\n${raw},Tesco,10\r\n`);
			const result = parseBankCsvImport(dataRows, { ...SIGNED_MAPPING, dateFormat }, []);
			expect(result.ok, `${dateFormat} should parse`).toBe(true);
			if (result.ok) expect(result.lineItems[0].notes).toBe('2026-03-31');
		}
	});

	it('exposes exactly the documented set of date formats', () => {
		expect(BANK_CSV_DATE_FORMATS.map((format) => format.id)).toEqual([
			'DD/MM/YYYY',
			'YYYY-MM-DD',
			'MM/DD/YYYY',
			'DD-MM-YYYY',
			'DD.MM.YYYY'
		]);
	});
});

describe('parseBankCsvImport — debit/credit columns', () => {
	/** @type {import('./bank-csv-import.js').BankCsvMapping} */
	const mapping = {
		dateColumn: 0,
		dateFormat: 'DD/MM/YYYY',
		descriptionColumn: 1,
		amountMode: 'debit-credit',
		amountColumn: null,
		debitColumn: 2,
		creditColumn: 3,
		categoryColumn: null
	};

	it('imports a debit-only row as a positive amount', () => {
		const { dataRows } = split('Date,Description,Debit,Credit\r\n01/01/2026,Tesco,45.67,\r\n');
		const result = parseBankCsvImport(dataRows, mapping, []);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.lineItems[0].amount).toBe(45.67);
	});

	it('imports a credit-only row the same way', () => {
		const { dataRows } = split('Date,Description,Debit,Credit\r\n01/01/2026,Refund,,20.00\r\n');
		const result = parseBankCsvImport(dataRows, mapping, []);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.lineItems[0].amount).toBe(20);
	});

	it('rejects a row with both a debit and a credit amount', () => {
		const { dataRows } = split('Date,Description,Debit,Credit\r\n01/01/2026,Odd,5,5\r\n');
		const result = parseBankCsvImport(dataRows, mapping, []);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0].message).toMatch(/both a Debit and a Credit/);
	});

	it('rejects a row with neither a debit nor a credit amount', () => {
		const { dataRows } = split('Date,Description,Debit,Credit\r\n01/01/2026,Odd,,\r\n');
		const result = parseBankCsvImport(dataRows, mapping, []);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0].message).toMatch(/neither a Debit nor a Credit/);
	});
});

describe('parseBankCsvImport — category matching', () => {
	/** @type {import('./bank-csv-import.js').BankCsvMapping} */
	const mapping = { ...SIGNED_MAPPING, categoryColumn: 3 };
	const categories = [createBudgetCategory({ id: 'cat_groceries', name: 'Groceries' })];

	it('matches an existing category by name, case-insensitively', () => {
		const { dataRows } = split(
			'Date,Description,Amount,Category\r\n01/01/2026,Tesco,10,groceries\r\n'
		);
		const result = parseBankCsvImport(dataRows, mapping, categories);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.lineItems[0].category_id).toBe('cat_groceries');
			expect(result.summary).toEqual({ records: 1, matchedCategories: 1, unmatchedCategories: 0 });
		}
	});

	it('leaves category_id null when the text does not match any category', () => {
		const { dataRows } = split(
			'Date,Description,Amount,Category\r\n01/01/2026,Tesco,10,Petrol\r\n'
		);
		const result = parseBankCsvImport(dataRows, mapping, categories);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.lineItems[0].category_id).toBeNull();
			expect(result.summary.unmatchedCategories).toBe(1);
		}
	});

	it('leaves category_id null when no category column is mapped at all', () => {
		const { dataRows } = split('Date,Description,Amount\r\n01/01/2026,Tesco,10\r\n');
		const result = parseBankCsvImport(dataRows, SIGNED_MAPPING, categories);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.lineItems[0].category_id).toBeNull();
	});
});

describe('parseBankCsvImport — edge cases', () => {
	it('rejects an incomplete mapping without inspecting any rows', () => {
		const { dataRows } = split('Date,Description,Amount\r\n01/01/2026,Tesco,10\r\n');
		const incomplete = { ...SIGNED_MAPPING, amountColumn: null };
		const result = parseBankCsvImport(dataRows, incomplete, []);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('incomplete-mapping');
	});

	it('rejects a header-only file with no data rows', () => {
		const result = parseBankCsvImport([], SIGNED_MAPPING, []);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('invalid-csv');
			expect(result.message).toMatch(/no data rows/);
		}
	});

	it('reports a specific error for a row shorter than the mapped columns need', () => {
		const dataRows = [['01/01/2026', 'Tesco']]; // no third column for Amount
		const result = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(result.errors[0].message).toMatch(/expected at least 3 columns, found 2/);
	});

	it('imports multiple rows and appends nothing else — pure function, no shared state', () => {
		const { dataRows } = split(
			'Date,Description,Amount\r\n01/01/2026,Tesco,10\r\n02/01/2026,Shell,20\r\n'
		);
		const first = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		const second = parseBankCsvImport(dataRows, SIGNED_MAPPING, []);
		expect(first.ok && second.ok).toBe(true);
		if (first.ok && second.ok) {
			expect(first.lineItems.map((item) => item.name)).toEqual(['Tesco', 'Shell']);
			// Fresh ids each call — re-running an import never collides with a previous run's ids.
			expect(first.lineItems[0].id).not.toBe(second.lineItems[0].id);
		}
	});

	it('does not mutate the dataRows or categories arguments', () => {
		const { dataRows } = split('Date,Description,Amount\r\n01/01/2026,Tesco,10\r\n');
		const categories = [createBudgetCategory({ name: 'Groceries' })];
		const dataRowsCopy = JSON.parse(JSON.stringify(dataRows));
		const categoriesCopy = JSON.parse(JSON.stringify(categories));
		parseBankCsvImport(dataRows, { ...SIGNED_MAPPING, categoryColumn: 3 }, categories);
		expect(dataRows).toEqual(dataRowsCopy);
		expect(categories).toEqual(categoriesCopy);
	});
});
