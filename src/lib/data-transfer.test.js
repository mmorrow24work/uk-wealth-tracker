import { describe, expect, it } from 'vitest';

import {
	EXPORT_MARKER,
	createExportDocument,
	exportAppData,
	parseImportDocument,
	suggestExportFilename
} from './data-transfer.js';
import { SCHEMA_VERSION, createAppData, createInvestment, createMonthlyEntry } from './model.js';

const EXPORTED_AT = '2026-08-07T12:34:56.000Z';

describe('createExportDocument', () => {
	it('carries the app marker, the exported_at stamp, and the whole document', () => {
		const data = createAppData();
		const document = createExportDocument(data, EXPORTED_AT);
		expect(document.app).toBe(EXPORT_MARKER);
		expect(document.exported_at).toBe(EXPORTED_AT);
		expect(document.schema_version).toBe(SCHEMA_VERSION);
		expect(document.profile).toEqual(data.profile);
	});
});

describe('suggestExportFilename', () => {
	it('carries the date so exports sort chronologically', () => {
		expect(suggestExportFilename(EXPORTED_AT)).toBe('uk-wealth-tracker-export-2026-08-07.json');
	});
});

describe('exportAppData', () => {
	it('serialises a document that reparses back into an export document', () => {
		const data = createAppData();
		const { json, filename } = exportAppData(data, { exportedAt: EXPORTED_AT });
		expect(filename).toBe('uk-wealth-tracker-export-2026-08-07.json');
		expect(JSON.parse(json)).toMatchObject({ app: EXPORT_MARKER, exported_at: EXPORTED_AT });
	});

	it('defaults exported_at to now when not given', () => {
		const { json } = exportAppData(createAppData());
		const parsed = JSON.parse(json);
		expect(Number.isNaN(Date.parse(parsed.exported_at))).toBe(false);
	});
});

describe('parseImportDocument', () => {
	it('round-trips a real export back into an equivalent document', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 3,
					year: 2026,
					investments: [createInvestment({ name: 'Vanguard FTSE Global All Cap', value: 12000 })]
				})
			]
		});
		const { json } = exportAppData(data, { exportedAt: EXPORTED_AT });

		const result = parseImportDocument(json);

		expect(result.ok).toBe(true);
		expect(result.ok && result.data).toEqual(data);
	});

	it('rejects a file that is not valid JSON', () => {
		const result = parseImportDocument('{not json');
		expect(result).toMatchObject({ ok: false, reason: 'invalid-json' });
		expect(result.ok || result.message).toContain('not valid JSON');
	});

	it('rejects JSON that is not a uk-wealth-tracker export', () => {
		const result = parseImportDocument(JSON.stringify({ hello: 'world' }));
		expect(result).toMatchObject({ ok: false, reason: 'not-an-export' });
		expect(result.ok || result.message).toContain('not a uk-wealth-tracker export');
	});

	it('rejects an export-shaped array or primitive rather than throwing', () => {
		expect(parseImportDocument('[]')).toMatchObject({ ok: false, reason: 'not-an-export' });
		expect(parseImportDocument('null')).toMatchObject({ ok: false, reason: 'not-an-export' });
		expect(parseImportDocument('"just a string"')).toMatchObject({
			ok: false,
			reason: 'not-an-export'
		});
	});

	it('rejects a document with the marker but data out of range, listing the offending fields', () => {
		const data = createAppData({
			monthly_entries: [createMonthlyEntry({ month: 13, year: 2026 })]
		});
		const { json } = exportAppData(data, { exportedAt: EXPORTED_AT });

		const result = parseImportDocument(json);

		expect(result.ok).toBe(false);
		expect(result.ok || result.reason).toBe('invalid-data');
		expect(result.ok || result.errors.some((error) => error.path.includes('.month'))).toBe(true);
		expect(result.ok || result.message).toContain('problem');
	});

	it('rejects a document stamped with a newer schema version than this build understands', () => {
		const data = createAppData({ schema_version: SCHEMA_VERSION + 1 });
		const { json } = exportAppData(data, { exportedAt: EXPORTED_AT });

		const result = parseImportDocument(json);

		expect(result.ok).toBe(false);
		expect(result.ok || result.errors.some((error) => error.path === 'schema_version')).toBe(true);
	});

	it('drops the app marker and exported_at stamp from the returned document', () => {
		const { json } = exportAppData(createAppData(), { exportedAt: EXPORTED_AT });
		const result = parseImportDocument(json);
		expect(result.ok).toBe(true);
		expect(result.ok && result.data).not.toHaveProperty('app');
		expect(result.ok && result.data).not.toHaveProperty('exported_at');
	});
});
