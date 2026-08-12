/**
 * Server-rendered smoke tests for the "delete all my data" panel (issue #63).
 *
 * As every component test in this repo documents: there is no browser test environment here, so
 * `svelte/server`'s `render` covers the initial render only — what the panel says it would delete,
 * and that the destructive step is not reachable in one click. The click path itself
 * (`deleteAllAppData` → `deleteAllData` → `deleteGistData`) is covered at module level in
 * `$lib/gist.test.js`, `$lib/persistence.test.js` and `$lib/store.test.js`, and end-to-end by
 * driving the real page in a browser (see this issue's journal entry).
 *
 * The panel reads its state from `describeDeleteTarget()`, which is plain `localStorage` and the
 * build's env vars, so those are what these tests set.
 */
import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DeleteAllData from './DeleteAllData.svelte';

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
	return render(DeleteAllData).body;
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

/**
 * A rendered `<button …  disabled>`. Matched as an attribute rather than as the string `disabled`,
 * which every button carries anyway inside Tailwind's `disabled:pointer-events-none` class.
 */
const disabledButton = /<button[^>]*\sdisabled(?=[\s>=])/;

/** Sign this browser in, the way the connect page leaves it. */
function signIn() {
	localStorage.setItem('uk-wealth-tracker:github-token', 'ghp_valid');
	localStorage.setItem(
		'uk-wealth-tracker:github-account',
		JSON.stringify({ login: 'octocat', id: 1, scopes: ['gist'], scopes_known: true })
	);
}

beforeEach(() => {
	vi.unstubAllEnvs();
	vi.stubGlobal('localStorage', createMemoryStorage());
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('browser-only storage mode', () => {
	it('says it deletes this browser’s copy and reaches nothing else', () => {
		const body = text();
		expect(body).toContain('Delete all my data');
		expect(body).toContain('copy of your data stored in this browser');
		expect(body).toContain('no other device is reached');
	});

	it('is still offered — a wipe is irreversible for this device too', () => {
		expect(markup()).not.toMatch(disabledButton);
	});

	it('mentions exporting first, since there is no undo and no backup', () => {
		expect(text()).toContain('There is no undo and no backup');
	});
});

describe('Gist mode, signed in', () => {
	beforeEach(() => {
		signIn();
		localStorage.setItem('uk-wealth-tracker:gist-id', 'aa11bb22cc33');
	});

	it('names the Gist and the account whose data is about to go', () => {
		const body = text();
		expect(body).toContain('aa11bb22cc33');
		expect(body).toContain("on @octocat's account");
	});

	it('links to the Gist, so the user can check it before deleting it', () => {
		expect(markup()).toContain('https://gist.github.com/aa11bb22cc33');
	});
});

describe('Gist mode on a token compiled into the build', () => {
	beforeEach(() => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'build-token');
		vi.stubEnv('VITE_GIST_ID', 'aa11bb22cc33');
	});

	it('refuses the action and says why, rather than hiding it', () => {
		const body = text();
		expect(body).toContain('Sign in with GitHub first');
		expect(body).toContain('prove');
	});

	it('leaves the arming button disabled', () => {
		expect(markup()).toMatch(disabledButton);
	});
});

describe('the confirmation gate', () => {
	it('is not reachable in one click — the first button only arms it', () => {
		// Nothing that deletes is rendered until the panel is armed: no phrase field, no destructive
		// button. The one button on screen opens the confirmation step, and says so.
		const body = markup();
		expect(body).toContain('Delete all my data…');
		expect(body).not.toContain('id="delete-confirmation"');
		expect(body).not.toContain('Delete everything permanently');
		expect(text()).toContain('Asks you to confirm before anything is deleted');
	});
});
