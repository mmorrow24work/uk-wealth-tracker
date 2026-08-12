/**
 * Server-rendered smoke tests for the Settings tab's data management panel (issue #100).
 *
 * As every component test in this repo documents: there is no browser test environment here, so
 * `svelte/server`'s `render` covers the initial render only. The click/file-picker paths
 * (`switchMode`, `exportData`, `onFileChosen`/`confirmImport`, and #150's `onCsvFileChosen`/
 * `confirmCsvImport`) are covered at module level by `$lib/data-transfer.test.js`,
 * `$lib/csv-import.test.js`, `$lib/persistence.test.js` and `$lib/store.test.js`, which this
 * component composes but adds no new logic on top of — and end-to-end by driving the real page in a
 * browser (see this issue's journal entry).
 *
 * The panel reads `getPersistenceMode()`/`availablePersistenceModes()`, which are plain
 * `localStorage` and the build's env vars, so those are what these tests set — the same pattern
 * `DeleteAllData.test.js` and `GitHubSignIn.test.js` use.
 */
import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DataManager from './DataManager.svelte';

/** @returns {Storage} */
function createMemoryStorage() {
	/** @type {Map<string, string>} */
	const store = new Map();
	return /** @type {Storage} */ ({
		getItem: (key) => (store.has(key) ? /** @type {string} */ (store.get(key)) : null),
		setItem: (key, value) => {
			store.set(key, String(value));
		},
		removeItem: (key) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		}
	});
}

/** @returns {string} The raw markup, for asserting on attributes rather than visible text. */
function markup() {
	return render(DataManager).body;
}

/** @returns {string} */
function text() {
	return markup()
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ');
}

beforeEach(() => {
	vi.unstubAllEnvs();
	vi.stubGlobal('localStorage', createMemoryStorage());
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('storage mode, browser-only build (no GitHub token at all)', () => {
	it('reports browser-only as the active mode', () => {
		expect(text()).toContain('Storage mode right now: This browser only');
	});

	it('explains that Gist sync is not available rather than offering a switch that cannot work', () => {
		const body = text();
		expect(body).toContain("GitHub Gist sync isn't available yet on this browser");
		expect(body).toContain('Connect GitHub');
	});

	it('does not render a switch button for the unavailable mode', () => {
		expect(text()).not.toContain('GitHub Gist sync</');
		expect(markup()).not.toMatch(/>GitHub Gist sync<\/button>/);
	});
});

describe('storage mode, signed in to GitHub', () => {
	beforeEach(() => {
		localStorage.setItem('uk-wealth-tracker:github-token', 'ghp_valid');
		localStorage.setItem(
			'uk-wealth-tracker:github-account',
			JSON.stringify({ login: 'octocat', id: 1, scopes: ['gist'], scopes_known: true })
		);
	});

	it('offers both modes as switch buttons', () => {
		const body = markup();
		expect(body).toContain('This browser only');
		expect(body).toContain('GitHub Gist sync');
	});

	it('explains what switching does before it is clicked', () => {
		expect(text()).toContain('Switching copies the data you have open right now');
	});
});

describe('export section', () => {
	it('offers a JSON export button', () => {
		expect(text()).toContain('Export data as JSON');
	});
});

describe('XLSX export section', () => {
	it('offers an Excel export button', () => {
		expect(text()).toContain('Export data as Excel (.xlsx)');
	});

	it('makes clear this is read-only, not an Import source', () => {
		expect(text()).toContain("can't be brought back in via Import");
	});
});

describe('import section', () => {
	it('shows a file picker, not the confirm step, before any file is chosen', () => {
		const body = markup();
		expect(body).toContain('id="import-file"');
		expect(body).not.toContain('Replace my data with this file');
	});

	it('explains the file is checked in full before anything changes', () => {
		expect(text()).toContain('The file is checked in full before anything changes');
	});
});

describe('CSV export section', () => {
	it('says Net Worth History stays read-only but Holdings/Debts round-trip via CSV import', () => {
		const body = text();
		expect(body).toContain('Net Worth History is read-only');
		expect(body).toContain('Holdings and Debts can be brought back in via "Import data from CSV"');
	});
});

describe('CSV import section', () => {
	it('shows a file picker, not the confirm step, before any file is chosen', () => {
		const body = markup();
		expect(body).toContain('id="import-csv-file"');
		expect(body).not.toContain('Merge this file into my data');
	});

	it('accepts CSV files only', () => {
		expect(markup()).toContain('accept="text/csv,.csv"');
	});

	it('explains this is a merge, not a replace, unlike JSON import', () => {
		const body = text();
		expect(body).toContain('this is a merge, not a replace');
		expect(body).toContain('everything else currently stored is left exactly as it was');
	});

	it('explains Net Worth History cannot be re-imported this way', () => {
		expect(text()).toContain("Net Worth History can't be re-imported this way");
	});
});
