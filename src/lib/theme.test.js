import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Same in-memory `localStorage` stand-in `github-auth.test.js`, `gist.test.js` and
 * `browser-storage.test.js` use — the `node` test environment has no `localStorage` global, and
 * the "there isn't one" path (SSR, blocked storage) is exercised by simply not stubbing it.
 *
 * @returns {Storage}
 */
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

/**
 * A minimal `document` stand-in, just enough to exercise the `.dark` class the theme module
 * toggles on `<html>` — the `node` test environment has no DOM.
 */
function createFakeDocument() {
	const classes = new Set();
	return {
		classes,
		documentElement: {
			classList: {
				contains: (/** @type {string} */ name) => classes.has(name),
				toggle: (/** @type {string} */ name, /** @type {boolean | undefined} */ force) => {
					const next = force === undefined ? !classes.has(name) : force;
					if (next) classes.add(name);
					else classes.delete(name);
					return next;
				}
			}
		}
	};
}

/** @param {boolean} matches */
function createMatchMedia(matches) {
	return (/** @type {string} */ query) => ({ matches, media: query });
}

const THEME_KEY = 'uk-wealth-tracker:theme';

beforeEach(() => {
	vi.unstubAllGlobals();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('getStoredTheme', () => {
	it('is undefined with no localStorage at all', async () => {
		const { getStoredTheme } = await import('./theme.js');
		expect(getStoredTheme()).toBeUndefined();
	});

	it('is undefined when nothing has been chosen yet', async () => {
		vi.stubGlobal('localStorage', createMemoryStorage());
		const { getStoredTheme } = await import('./theme.js');
		expect(getStoredTheme()).toBeUndefined();
	});

	it('reads back a previously stored choice', async () => {
		const storage = createMemoryStorage();
		storage.setItem(THEME_KEY, 'dark');
		vi.stubGlobal('localStorage', storage);
		const { getStoredTheme } = await import('./theme.js');
		expect(getStoredTheme()).toBe('dark');
	});

	it('ignores a corrupt stored value rather than returning it', async () => {
		const storage = createMemoryStorage();
		storage.setItem(THEME_KEY, 'purple');
		vi.stubGlobal('localStorage', storage);
		const { getStoredTheme } = await import('./theme.js');
		expect(getStoredTheme()).toBeUndefined();
	});
});

describe('getSystemTheme', () => {
	it('is light with no matchMedia at all (SSR)', async () => {
		const { getSystemTheme } = await import('./theme.js');
		expect(getSystemTheme()).toBe('light');
	});

	it("follows the OS's dark preference", async () => {
		vi.stubGlobal('matchMedia', createMatchMedia(true));
		const { getSystemTheme } = await import('./theme.js');
		expect(getSystemTheme()).toBe('dark');
	});

	it("follows the OS's light preference", async () => {
		vi.stubGlobal('matchMedia', createMatchMedia(false));
		const { getSystemTheme } = await import('./theme.js');
		expect(getSystemTheme()).toBe('light');
	});
});

describe('resolveTheme', () => {
	it('defaults new visitors to their system preference, not always light', async () => {
		vi.stubGlobal('localStorage', createMemoryStorage());
		vi.stubGlobal('matchMedia', createMatchMedia(true));
		const { resolveTheme } = await import('./theme.js');
		expect(resolveTheme()).toBe('dark');
	});

	it('prefers an explicit stored choice over the system preference', async () => {
		const storage = createMemoryStorage();
		storage.setItem(THEME_KEY, 'light');
		vi.stubGlobal('localStorage', storage);
		vi.stubGlobal('matchMedia', createMatchMedia(true));
		const { resolveTheme } = await import('./theme.js');
		expect(resolveTheme()).toBe('light');
	});
});

describe('refreshTheme', () => {
	it('applies the resolved theme to <html> and publishes it to the store', async () => {
		const storage = createMemoryStorage();
		storage.setItem(THEME_KEY, 'dark');
		vi.stubGlobal('localStorage', storage);
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);

		const { refreshTheme, theme } = await import('./theme.js');
		const resolved = refreshTheme();

		expect(resolved).toBe('dark');
		expect(fakeDocument.classes.has('dark')).toBe(true);
		expect(get(theme)).toBe('dark');
	});

	it('removes the class when the resolved theme is light', async () => {
		const fakeDocument = createFakeDocument();
		fakeDocument.classes.add('dark');
		vi.stubGlobal('document', fakeDocument);
		vi.stubGlobal('localStorage', createMemoryStorage());
		vi.stubGlobal('matchMedia', createMatchMedia(false));

		const { refreshTheme } = await import('./theme.js');
		refreshTheme();

		expect(fakeDocument.classes.has('dark')).toBe(false);
	});
});

describe('setTheme', () => {
	it('applies, publishes and persists an explicit choice', async () => {
		const storage = createMemoryStorage();
		vi.stubGlobal('localStorage', storage);
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);

		const { setTheme, theme } = await import('./theme.js');
		const result = setTheme('dark');

		expect(result).toBe('dark');
		expect(fakeDocument.classes.has('dark')).toBe(true);
		expect(get(theme)).toBe('dark');
		expect(storage.getItem(THEME_KEY)).toBe('dark');
	});

	it('does not throw when there is nowhere to persist the choice', async () => {
		vi.stubGlobal('document', createFakeDocument());
		const { setTheme } = await import('./theme.js');
		expect(() => setTheme('dark')).not.toThrow();
	});
});

describe('toggleTheme', () => {
	it('flips from whatever the store currently holds', async () => {
		const storage = createMemoryStorage();
		storage.setItem(THEME_KEY, 'light');
		vi.stubGlobal('localStorage', storage);
		vi.stubGlobal('document', createFakeDocument());

		const { refreshTheme, toggleTheme, theme } = await import('./theme.js');
		refreshTheme();
		expect(get(theme)).toBe('light');

		expect(toggleTheme()).toBe('dark');
		expect(get(theme)).toBe('dark');
		expect(storage.getItem(THEME_KEY)).toBe('dark');

		expect(toggleTheme()).toBe('light');
		expect(get(theme)).toBe('light');
	});
});
