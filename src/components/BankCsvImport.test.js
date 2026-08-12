/**
 * Server-rendered smoke test for the bank statement CSV import card (issue #267).
 *
 * As `DataManager.test.js` documents for its own JSON/CSV import sections: no browser test
 * environment, so `svelte/server`'s `render` covers the initial (`idle`) render only. The
 * file-picker → mapping → confirm flow itself is `onFileChosen`/`continueMapping`/`confirmImport`
 * event-handler logic wired directly onto `$lib/bank-csv-import.js`, which is exhaustively covered
 * at module level by `bank-csv-import.test.js` — this component adds no parsing/merge logic of its
 * own on top of it.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import BankCsvImport from './BankCsvImport.svelte';

/** @returns {string} The raw markup, for asserting on attributes. */
function markup() {
	return render(BankCsvImport).body;
}

/** @returns {string} */
function text() {
	return markup()
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('BankCsvImport', () => {
	it('shows a file picker before any file is chosen', () => {
		const body = markup();
		expect(body).toContain('id="bank-csv-file"');
		expect(body).not.toContain('Continue</');
		expect(body).not.toContain('Add these transactions');
	});

	it('accepts CSV files only', () => {
		expect(markup()).toContain('accept="text/csv,.csv"');
	});

	it('explains that this maps columns rather than assuming a fixed bank format', () => {
		expect(text()).toContain('map its columns to date, description and amount yourself');
	});

	it('explains that import is additive, not a replacement', () => {
		expect(text()).toContain('added as one-off items below, on top of whatever is already there');
	});
});
