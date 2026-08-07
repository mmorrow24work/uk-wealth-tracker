/**
 * Server-rendered smoke test for the XLSX export button (issue #64) — as `GitHubSignIn.test.js`
 * documents, there is no browser test environment here, so `svelte/server`'s `render` covers the
 * initial render only. The click path itself (`exportAppDataToXlsx` building a workbook and
 * handing it to the browser as a download) is covered at the module level by
 * `$lib/xlsx-export.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import DataExport from './DataExport.svelte';

describe('DataExport', () => {
	it('offers a button naming the file type it downloads', () => {
		const { body } = render(DataExport);
		expect(body).toContain('Export to Excel (.xlsx)');
	});

	it('names every sheet the workbook will contain', () => {
		const { body } = render(DataExport);
		expect(body).toContain('net worth history');
		expect(body).toContain('holdings');
		expect(body).toContain('debts');
		expect(body).toContain('pensions');
		expect(body).toContain('properties');
		expect(body).toContain('physical assets');
	});

	it('says the export happens entirely in the browser', () => {
		const { body } = render(DataExport);
		expect(body).toContain('nothing is sent anywhere');
	});
});
