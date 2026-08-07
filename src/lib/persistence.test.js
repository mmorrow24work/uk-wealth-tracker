import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppData, createProfile } from './model.js';

/**
 * Same in-memory `localStorage` stand-in `gist.test.js` and `browser-storage.test.js` use — the
 * `node` test environment has no `localStorage` global, and the "there isn't one" path (SSR) is
 * exercised by simply not stubbing it.
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

// Both backends are mocked down to their load/save pair — which one a mode routes to is all this
// module does. `isGistConfigured` is deliberately left real, since it reads the env var that
// decides whether Gist mode exists at all, which is exactly what these tests vary.
vi.mock('./gist.js', async () => {
	const actual = /** @type {typeof import('./gist.js')} */ (await vi.importActual('./gist.js'));
	return { ...actual, loadAppData: vi.fn(), saveAppData: vi.fn() };
});

vi.mock('./browser-storage.js', async () => {
	const actual = /** @type {typeof import('./browser-storage.js')} */ (
		await vi.importActual('./browser-storage.js')
	);
	return { ...actual, loadAppData: vi.fn(), saveAppData: vi.fn() };
});

const MODE_KEY = 'uk-wealth-tracker:persistence-mode';

/** @type {import('vitest').Mock} */
let gistLoad;
/** @type {import('vitest').Mock} */
let gistSave;
/** @type {import('vitest').Mock} */
let browserLoad;
/** @type {import('vitest').Mock} */
let browserSave;

beforeEach(async () => {
	vi.unstubAllEnvs();
	vi.stubGlobal('localStorage', createMemoryStorage());

	const gist = await import('./gist.js');
	const browser = await import('./browser-storage.js');
	gistLoad = /** @type {import('vitest').Mock} */ (gist.loadAppData);
	gistSave = /** @type {import('vitest').Mock} */ (gist.saveAppData);
	browserLoad = /** @type {import('vitest').Mock} */ (browser.loadAppData);
	browserSave = /** @type {import('vitest').Mock} */ (browser.saveAppData);
	gistLoad.mockReset().mockResolvedValue(createAppData());
	gistSave.mockReset().mockResolvedValue(undefined);
	browserLoad.mockReset().mockResolvedValue(createAppData());
	browserSave.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('availablePersistenceModes', () => {
	it('offers browser-only when no token is compiled in', async () => {
		const { availablePersistenceModes } = await import('./persistence.js');
		expect(availablePersistenceModes()).toEqual(['browser']);
	});

	it('offers both modes once a token is compiled in', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
		const { availablePersistenceModes } = await import('./persistence.js');
		expect(availablePersistenceModes()).toEqual(['gist', 'browser']);
	});

	it('reports which individual modes are available', async () => {
		const { isPersistenceModeAvailable } = await import('./persistence.js');
		expect(isPersistenceModeAvailable('browser')).toBe(true);
		expect(isPersistenceModeAvailable('gist')).toBe(false);
		expect(isPersistenceModeAvailable('carrier-pigeon')).toBe(false);
	});
});

describe('getPersistenceMode', () => {
	it('is browser-only with no token and no remembered choice', async () => {
		const { defaultPersistenceMode, getPersistenceMode } = await import('./persistence.js');
		expect(defaultPersistenceMode()).toBe('browser');
		expect(getPersistenceMode()).toBe('browser');
	});

	it('starts in gist mode on a build that carries a token', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
		const { defaultPersistenceMode, getPersistenceMode } = await import('./persistence.js');
		expect(defaultPersistenceMode()).toBe('gist');
		expect(getPersistenceMode()).toBe('gist');
	});

	it('honours a remembered browser-only choice over the token default', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
		localStorage.setItem(MODE_KEY, 'browser');

		const { getPersistenceMode, getRememberedPersistenceMode } = await import('./persistence.js');
		expect(getRememberedPersistenceMode()).toBe('browser');
		expect(getPersistenceMode()).toBe('browser');
	});

	it('ignores a remembered gist choice on a build that no longer has a token', async () => {
		localStorage.setItem(MODE_KEY, 'gist');

		const { getPersistenceMode, getRememberedPersistenceMode } = await import('./persistence.js');
		expect(getRememberedPersistenceMode()).toBeNull();
		expect(getPersistenceMode()).toBe('browser');
	});

	it('ignores a remembered value that is not a mode at all', async () => {
		localStorage.setItem(MODE_KEY, 'sqlite');
		const { getPersistenceMode } = await import('./persistence.js');
		expect(getPersistenceMode()).toBe('browser');
	});

	it('works with no localStorage at all (SSR / prerender)', async () => {
		vi.unstubAllGlobals();
		const { getPersistenceMode, getRememberedPersistenceMode } = await import('./persistence.js');
		expect(getRememberedPersistenceMode()).toBeNull();
		expect(getPersistenceMode()).toBe('browser');
	});
});

describe('setPersistenceMode', () => {
	it('remembers the choice for later sessions', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
		const { getPersistenceMode, setPersistenceMode } = await import('./persistence.js');

		expect(setPersistenceMode('browser')).toBe('browser');
		expect(localStorage.getItem(MODE_KEY)).toBe('browser');
		expect(getPersistenceMode()).toBe('browser');

		setPersistenceMode('gist');
		expect(getPersistenceMode()).toBe('gist');
	});

	it('refuses gist mode on a build with no token', async () => {
		const { setPersistenceMode } = await import('./persistence.js');
		expect(() => setPersistenceMode('gist')).toThrow(RangeError);
		expect(localStorage.getItem(MODE_KEY)).toBeNull();
	});

	it('refuses a mode that does not exist', async () => {
		const { setPersistenceMode } = await import('./persistence.js');
		expect(() =>
			setPersistenceMode(/** @type {'browser'} */ (/** @type {unknown} */ ('sqlite')))
		).toThrow(RangeError);
	});

	it('still applies the choice when localStorage cannot remember it', async () => {
		vi.unstubAllGlobals();
		const { setPersistenceMode } = await import('./persistence.js');
		expect(setPersistenceMode('browser')).toBe('browser');
	});
});

describe('clearPersistenceMode', () => {
	it('puts the app back on the default mode', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
		const { clearPersistenceMode, getPersistenceMode, setPersistenceMode } =
			await import('./persistence.js');

		setPersistenceMode('browser');
		expect(getPersistenceMode()).toBe('browser');

		expect(clearPersistenceMode()).toBe('gist');
		expect(localStorage.getItem(MODE_KEY)).toBeNull();
	});
});

describe('loadAppData / saveAppData routing', () => {
	it('uses browser storage by default, never touching the Gist backend', async () => {
		const stored = createAppData({ profile: createProfile({ name: 'Ada' }) });
		browserLoad.mockResolvedValue(stored);

		const { loadAppData, saveAppData } = await import('./persistence.js');

		expect(await loadAppData()).toBe(stored);
		await saveAppData(stored);

		expect(browserLoad).toHaveBeenCalledTimes(1);
		expect(browserSave).toHaveBeenCalledWith(stored);
		expect(gistLoad).not.toHaveBeenCalled();
		expect(gistSave).not.toHaveBeenCalled();
	});

	it('uses the Gist backend on a token-carrying build', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
		const stored = createAppData({ profile: createProfile({ name: 'Grace' }) });
		gistLoad.mockResolvedValue(stored);

		const { loadAppData, saveAppData } = await import('./persistence.js');

		expect(await loadAppData()).toBe(stored);
		await saveAppData(stored);

		expect(gistLoad).toHaveBeenCalledTimes(1);
		expect(gistSave).toHaveBeenCalledWith(stored);
		expect(browserLoad).not.toHaveBeenCalled();
		expect(browserSave).not.toHaveBeenCalled();
	});

	it('follows a mode switch made mid-session', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
		const { loadAppData, saveAppData, setPersistenceMode } = await import('./persistence.js');

		await saveAppData(createAppData());
		expect(gistSave).toHaveBeenCalledTimes(1);

		setPersistenceMode('browser');
		await saveAppData(createAppData());
		await loadAppData();

		expect(browserSave).toHaveBeenCalledTimes(1);
		expect(browserLoad).toHaveBeenCalledTimes(1);
		expect(gistSave).toHaveBeenCalledTimes(1);
	});

	it('lets the active backend’s own error surface to the caller', async () => {
		const { BrowserStorageError } = await import('./browser-storage.js');
		browserSave.mockRejectedValue(new BrowserStorageError('quota exceeded'));

		const { saveAppData } = await import('./persistence.js');
		await expect(saveAppData(createAppData())).rejects.toThrow(BrowserStorageError);
	});
});
