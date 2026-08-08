import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Same in-memory `localStorage` stand-in `theme.test.js`, `github-auth.test.js`, `gist.test.js`
 * and `browser-storage.test.js` use.
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
 * A minimal `document` stand-in, just enough to exercise the classes the typography module
 * toggles on `<html>` -- the `node` test environment has no DOM. Same shape as `theme.test.js`'s,
 * but tracks add/remove calls too since {@link applyClass} always removes every managed class
 * before adding the active one.
 */
function createFakeDocument() {
	const classes = new Set();
	return {
		classes,
		documentElement: {
			classList: {
				contains: (/** @type {string} */ name) => classes.has(name),
				add: (/** @type {string} */ name) => {
					classes.add(name);
				},
				remove: (/** @type {string} */ name) => {
					classes.delete(name);
				}
			}
		}
	};
}

const FONT_FAMILY_KEY = 'uk-wealth-tracker:font-family';
const TEXT_SIZE_KEY = 'uk-wealth-tracker:text-size';

beforeEach(() => {
	vi.unstubAllGlobals();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('getStoredFontFamily', () => {
	it('is undefined with no localStorage at all', async () => {
		const { getStoredFontFamily } = await import('./typography.js');
		expect(getStoredFontFamily()).toBeUndefined();
	});

	it('is undefined when nothing has been chosen yet', async () => {
		vi.stubGlobal('localStorage', createMemoryStorage());
		const { getStoredFontFamily } = await import('./typography.js');
		expect(getStoredFontFamily()).toBeUndefined();
	});

	it('reads back a previously stored choice', async () => {
		const storage = createMemoryStorage();
		storage.setItem(FONT_FAMILY_KEY, 'serif');
		vi.stubGlobal('localStorage', storage);
		const { getStoredFontFamily } = await import('./typography.js');
		expect(getStoredFontFamily()).toBe('serif');
	});

	it('ignores a corrupt stored value rather than returning it', async () => {
		const storage = createMemoryStorage();
		storage.setItem(FONT_FAMILY_KEY, 'comic-sans');
		vi.stubGlobal('localStorage', storage);
		const { getStoredFontFamily } = await import('./typography.js');
		expect(getStoredFontFamily()).toBeUndefined();
	});
});

describe('getStoredTextSize', () => {
	it('is undefined with no localStorage at all', async () => {
		const { getStoredTextSize } = await import('./typography.js');
		expect(getStoredTextSize()).toBeUndefined();
	});

	it('reads back a previously stored choice', async () => {
		const storage = createMemoryStorage();
		storage.setItem(TEXT_SIZE_KEY, 'large');
		vi.stubGlobal('localStorage', storage);
		const { getStoredTextSize } = await import('./typography.js');
		expect(getStoredTextSize()).toBe('large');
	});

	it('ignores a corrupt stored value rather than returning it', async () => {
		const storage = createMemoryStorage();
		storage.setItem(TEXT_SIZE_KEY, 'huge');
		vi.stubGlobal('localStorage', storage);
		const { getStoredTextSize } = await import('./typography.js');
		expect(getStoredTextSize()).toBeUndefined();
	});
});

describe('resolveFontFamily', () => {
	it('defaults to sans with no stored choice -- there is no OS preference to fall back to', async () => {
		vi.stubGlobal('localStorage', createMemoryStorage());
		const { resolveFontFamily } = await import('./typography.js');
		expect(resolveFontFamily()).toBe('sans');
	});

	it('prefers an explicit stored choice', async () => {
		const storage = createMemoryStorage();
		storage.setItem(FONT_FAMILY_KEY, 'rounded');
		vi.stubGlobal('localStorage', storage);
		const { resolveFontFamily } = await import('./typography.js');
		expect(resolveFontFamily()).toBe('rounded');
	});
});

describe('resolveTextSize', () => {
	it('defaults to medium with no stored choice', async () => {
		vi.stubGlobal('localStorage', createMemoryStorage());
		const { resolveTextSize } = await import('./typography.js');
		expect(resolveTextSize()).toBe('medium');
	});

	it('prefers an explicit stored choice', async () => {
		const storage = createMemoryStorage();
		storage.setItem(TEXT_SIZE_KEY, 'small');
		vi.stubGlobal('localStorage', storage);
		const { resolveTextSize } = await import('./typography.js');
		expect(resolveTextSize()).toBe('small');
	});
});

describe('refreshTypography', () => {
	it('applies both resolved preferences to <html> and publishes them to the stores', async () => {
		const storage = createMemoryStorage();
		storage.setItem(FONT_FAMILY_KEY, 'serif');
		storage.setItem(TEXT_SIZE_KEY, 'large');
		vi.stubGlobal('localStorage', storage);
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);

		const { refreshTypography, fontFamily, textSize } = await import('./typography.js');
		const resolved = refreshTypography();

		expect(resolved).toEqual({ fontFamily: 'serif', textSize: 'large' });
		expect(fakeDocument.classes.has('font-serif')).toBe(true);
		expect(fakeDocument.classes.has('text-scale-large')).toBe(true);
		expect(get(fontFamily)).toBe('serif');
		expect(get(textSize)).toBe('large');
	});

	it('applies no class for the sans/medium defaults', async () => {
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);
		vi.stubGlobal('localStorage', createMemoryStorage());

		const { refreshTypography } = await import('./typography.js');
		refreshTypography();

		expect(fakeDocument.classes.size).toBe(0);
	});
});

describe('setFontFamily', () => {
	it('applies, publishes and persists an explicit choice', async () => {
		const storage = createMemoryStorage();
		vi.stubGlobal('localStorage', storage);
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);

		const { setFontFamily, fontFamily } = await import('./typography.js');
		const result = setFontFamily('rounded');

		expect(result).toBe('rounded');
		expect(fakeDocument.classes.has('font-rounded')).toBe(true);
		expect(get(fontFamily)).toBe('rounded');
		expect(storage.getItem(FONT_FAMILY_KEY)).toBe('rounded');
	});

	it('removes the previous class when switching back to sans', async () => {
		const storage = createMemoryStorage();
		vi.stubGlobal('localStorage', storage);
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);

		const { setFontFamily } = await import('./typography.js');
		setFontFamily('serif');
		expect(fakeDocument.classes.has('font-serif')).toBe(true);

		setFontFamily('sans');
		expect(fakeDocument.classes.has('font-serif')).toBe(false);
		expect(fakeDocument.classes.has('font-rounded')).toBe(false);
	});

	it('does not throw when there is nowhere to persist the choice', async () => {
		vi.stubGlobal('document', createFakeDocument());
		const { setFontFamily } = await import('./typography.js');
		expect(() => setFontFamily('serif')).not.toThrow();
	});
});

describe('setTextSize', () => {
	it('applies, publishes and persists an explicit choice', async () => {
		const storage = createMemoryStorage();
		vi.stubGlobal('localStorage', storage);
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);

		const { setTextSize, textSize } = await import('./typography.js');
		const result = setTextSize('small');

		expect(result).toBe('small');
		expect(fakeDocument.classes.has('text-scale-small')).toBe(true);
		expect(get(textSize)).toBe('small');
		expect(storage.getItem(TEXT_SIZE_KEY)).toBe('small');
	});

	it('removes the previous class when switching back to medium', async () => {
		const storage = createMemoryStorage();
		vi.stubGlobal('localStorage', storage);
		const fakeDocument = createFakeDocument();
		vi.stubGlobal('document', fakeDocument);

		const { setTextSize } = await import('./typography.js');
		setTextSize('large');
		expect(fakeDocument.classes.has('text-scale-large')).toBe(true);

		setTextSize('medium');
		expect(fakeDocument.classes.has('text-scale-small')).toBe(false);
		expect(fakeDocument.classes.has('text-scale-large')).toBe(false);
	});

	it('does not throw when there is nowhere to persist the choice', async () => {
		vi.stubGlobal('document', createFakeDocument());
		const { setTextSize } = await import('./typography.js');
		expect(() => setTextSize('large')).not.toThrow();
	});
});
