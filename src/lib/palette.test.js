import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Same in-memory `localStorage` stand-in `theme.test.js`, `typography.test.js` and
 * `github-auth.test.js` use — the `node` test environment has no `localStorage` global, and the
 * "there isn't one" path (SSR, blocked storage) is exercised by simply not stubbing it.
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
 * A minimal `document` stand-in, just enough to exercise the `palette-*` class this module swaps on
 * `<html>` — the `node` test environment has no DOM.
 */
function createFakeDocument() {
	/** @type {Set<string>} */
	const classes = new Set();
	return {
		classes,
		documentElement: {
			classList: {
				add: (/** @type {string} */ name) => classes.add(name),
				remove: (/** @type {string} */ name) => classes.delete(name),
				contains: (/** @type {string} */ name) => classes.has(name)
			}
		}
	};
}

const PALETTE_KEY = 'uk-wealth-tracker:palette';

beforeEach(() => {
	vi.unstubAllGlobals();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('PALETTES', () => {
	it('lists every palette the issue asked for, default first', async () => {
		const { PALETTES } = await import('./palette.js');
		expect(PALETTES.map((option) => option.value)).toEqual([
			'default',
			'male',
			'female',
			'football',
			'cricket',
			'beach',
			'country',
			'city'
		]);
	});

	it('gives every palette a label and a description for the Settings picker', async () => {
		const { PALETTES } = await import('./palette.js');
		for (const option of PALETTES) {
			expect(option.label.length).toBeGreaterThan(0);
			expect(option.description.length).toBeGreaterThan(0);
		}
	});
});

describe('isPalette', () => {
	it('accepts every listed palette', async () => {
		const { isPalette, PALETTES } = await import('./palette.js');
		for (const option of PALETTES) expect(isPalette(option.value)).toBe(true);
	});

	it('rejects anything else, including non-strings', async () => {
		const { isPalette } = await import('./palette.js');
		expect(isPalette('rugby')).toBe(false);
		expect(isPalette('')).toBe(false);
		expect(isPalette(null)).toBe(false);
		expect(isPalette(undefined)).toBe(false);
		expect(isPalette(1)).toBe(false);
	});

	it('is not fooled by inherited Object.prototype keys', async () => {
		const { isPalette } = await import('./palette.js');
		expect(isPalette('toString')).toBe(false);
		expect(isPalette('constructor')).toBe(false);
	});
});

describe('getStoredPalette', () => {
	it('is undefined with no localStorage at all', async () => {
		const { getStoredPalette } = await import('./palette.js');
		expect(getStoredPalette()).toBeUndefined();
	});

	it('is undefined when nothing has been chosen yet', async () => {
		vi.stubGlobal('localStorage', createMemoryStorage());
		const { getStoredPalette } = await import('./palette.js');
		expect(getStoredPalette()).toBeUndefined();
	});

	it('reads back a previously stored choice', async () => {
		const storage = createMemoryStorage();
		storage.setItem(PALETTE_KEY, 'cricket');
		vi.stubGlobal('localStorage', storage);
		const { getStoredPalette } = await import('./palette.js');
		expect(getStoredPalette()).toBe('cricket');
	});

	it('ignores a value written by a build that knew more palettes than this one', async () => {
		const storage = createMemoryStorage();
		storage.setItem(PALETTE_KEY, 'rugby');
		vi.stubGlobal('localStorage', storage);
		const { getStoredPalette } = await import('./palette.js');
		expect(getStoredPalette()).toBeUndefined();
	});
});

describe('resolvePalette', () => {
	it('falls back to the app’s original neutral scheme when nothing is stored', async () => {
		vi.stubGlobal('localStorage', createMemoryStorage());
		const { DEFAULT_PALETTE, resolvePalette } = await import('./palette.js');
		expect(resolvePalette()).toBe(DEFAULT_PALETTE);
		expect(DEFAULT_PALETTE).toBe('default');
	});

	it('prefers an explicit stored choice', async () => {
		const storage = createMemoryStorage();
		storage.setItem(PALETTE_KEY, 'beach');
		vi.stubGlobal('localStorage', storage);
		const { resolvePalette } = await import('./palette.js');
		expect(resolvePalette()).toBe('beach');
	});
});

describe('refreshPalette', () => {
	it('applies the resolved palette to <html> and publishes it to the store', async () => {
		const storage = createMemoryStorage();
		storage.setItem(PALETTE_KEY, 'football');
		vi.stubGlobal('localStorage', storage);
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);

		const { palette, refreshPalette } = await import('./palette.js');
		const resolved = refreshPalette();

		expect(resolved).toBe('football');
		expect(fakeDocument.classes.has('palette-football')).toBe(true);
		expect(get(palette)).toBe('football');
	});

	it('leaves <html> classless when the resolved palette is the default', async () => {
		const fakeDocument = createFakeDocument();
		fakeDocument.classes.add('palette-beach');
		vi.stubGlobal('document', fakeDocument);
		vi.stubGlobal('localStorage', createMemoryStorage());

		const { refreshPalette } = await import('./palette.js');
		refreshPalette();

		expect([...fakeDocument.classes]).toEqual([]);
	});

	it('does not disturb the dark-mode class it shares <html> with', async () => {
		const storage = createMemoryStorage();
		storage.setItem(PALETTE_KEY, 'city');
		vi.stubGlobal('localStorage', storage);
		const fakeDocument = createFakeDocument();
		fakeDocument.classes.add('dark');
		fakeDocument.classes.add('font-serif');
		vi.stubGlobal('document', fakeDocument);

		const { refreshPalette } = await import('./palette.js');
		refreshPalette();

		expect([...fakeDocument.classes].sort()).toEqual(['dark', 'font-serif', 'palette-city']);
	});
});

describe('setPalette', () => {
	it('applies, publishes and persists an explicit choice', async () => {
		const storage = createMemoryStorage();
		vi.stubGlobal('localStorage', storage);
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);

		const { palette, setPalette } = await import('./palette.js');
		const result = setPalette('country');

		expect(result).toBe('country');
		expect(fakeDocument.classes.has('palette-country')).toBe(true);
		expect(get(palette)).toBe('country');
		expect(storage.getItem(PALETTE_KEY)).toBe('country');
	});

	it('swaps the previous palette class rather than stacking a second one', async () => {
		vi.stubGlobal('localStorage', createMemoryStorage());
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);

		const { setPalette } = await import('./palette.js');
		setPalette('male');
		setPalette('female');

		expect([...fakeDocument.classes]).toEqual(['palette-female']);
	});

	it('removes the class again when going back to the default', async () => {
		const storage = createMemoryStorage();
		vi.stubGlobal('localStorage', storage);
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);

		const { setPalette } = await import('./palette.js');
		setPalette('cricket');
		setPalette('default');

		expect([...fakeDocument.classes]).toEqual([]);
		expect(storage.getItem(PALETTE_KEY)).toBe('default');
	});

	it('does not throw when there is nowhere to persist the choice', async () => {
		vi.stubGlobal('document', createFakeDocument());
		const { setPalette } = await import('./palette.js');
		expect(() => setPalette('beach')).not.toThrow();
	});

	it('does not throw when there is no document to apply it to (SSR)', async () => {
		vi.stubGlobal('localStorage', createMemoryStorage());
		const { setPalette } = await import('./palette.js');
		expect(() => setPalette('beach')).not.toThrow();
	});
});
