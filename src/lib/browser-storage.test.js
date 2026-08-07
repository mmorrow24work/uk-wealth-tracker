import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppData, createProfile, SCHEMA_VERSION } from './model.js';

/**
 * A minimal in-memory `localStorage` stand-in. Vitest's default environment is `node`, which has
 * no `localStorage` global at all — tests that need one stub it in with this; tests that want to
 * exercise the "no localStorage" path (e.g. SSR) just don't. Same helper `gist.test.js` uses.
 *
 * @param {{ setItemThrows?: boolean }} [options]
 * @returns {Storage}
 */
function createMemoryStorage({ setItemThrows = false } = {}) {
	/** @type {Map<string, string>} */
	const store = new Map();
	return /** @type {Storage} */ ({
		getItem: (key) => (store.has(key) ? /** @type {string} */ (store.get(key)) : null),
		setItem: (key, value) => {
			if (setItemThrows) throw new Error('QuotaExceededError');
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
 * A minimal in-memory IndexedDB stand-in — `node` has no `indexedDB` global either, and the real
 * thing is far more machinery than this module touches (one database, one object store, one
 * record, `get`/`put`). Callbacks fire asynchronously, as the real API's do, so the module's
 * promise wrappers are genuinely exercised rather than resolving before their handlers are even
 * attached.
 *
 * @param {{ fault?: 'open-throws' | 'open-errors' | 'blocked' | 'transaction-throws' | 'read-fails' | 'write-fails' }} [options]
 * @returns {{ indexedDB: IDBFactory, records: Map<string, unknown> }}
 */
function createMemoryIndexedDb({ fault } = {}) {
	/** @type {Map<string, unknown>} */
	const records = new Map();
	let storeExists = false;

	const db = {
		objectStoreNames: {
			contains: (/** @type {string} */ name) => storeExists && name === 'app-data'
		},
		createObjectStore: () => {
			storeExists = true;
			return {};
		},
		/**
		 * @param {string} _name
		 * @param {IDBTransactionMode} [txMode]
		 */
		transaction(_name, txMode = 'readonly') {
			if (fault === 'transaction-throws') throw new Error('transaction refused');

			/** @type {any} */
			const transaction = {
				oncomplete: null,
				onerror: null,
				onabort: null,
				error: new Error('transaction failed'),
				objectStore: () => ({
					/** @param {string} key */
					get(key) {
						/** @type {any} */
						const request = { onsuccess: null, onerror: null, result: undefined, error: null };
						queueMicrotask(() => {
							if (fault === 'read-fails') {
								request.error = new Error('read failed');
								request.onerror?.();
								return;
							}
							request.result = records.get(key);
							request.onsuccess?.();
						});
						return request;
					},
					/**
					 * @param {unknown} value
					 * @param {string} key
					 */
					put(value, key) {
						if (fault !== 'write-fails') records.set(key, value);
						/** @type {any} */
						const request = { onsuccess: null, onerror: null, result: key, error: null };
						queueMicrotask(() => request.onsuccess?.());
						return request;
					}
				})
			};

			if (txMode === 'readwrite') {
				// Two microtasks out: after whatever request the caller queues on this transaction.
				queueMicrotask(() =>
					queueMicrotask(() =>
						fault === 'write-fails' ? transaction.onerror?.() : transaction.oncomplete?.()
					)
				);
			}
			return transaction;
		}
	};

	const indexedDB = /** @type {IDBFactory} */ (
		/** @type {unknown} */ ({
			open: () => {
				if (fault === 'open-throws') throw new Error('SecurityError: storage is disabled');
				/** @type {any} */
				const request = {
					onsuccess: null,
					onerror: null,
					onupgradeneeded: null,
					onblocked: null,
					result: db,
					error: null
				};
				queueMicrotask(() => {
					if (fault === 'open-errors') {
						request.error = new Error('open failed');
						request.onerror?.();
						return;
					}
					if (fault === 'blocked') {
						request.onblocked?.();
						return;
					}
					if (!storeExists) request.onupgradeneeded?.();
					request.onsuccess?.();
				});
				return request;
			}
		})
	);

	return { indexedDB, records };
}

/**
 * `createAppData()` mints a fresh random id for every milestone on every call, so two calls are
 * never `toEqual`. Strip `id` fields recursively before comparing "is this a fresh empty
 * document" — same helper `gist.test.js` and `store.test.js` use, for the same reason.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function withoutIds(value) {
	if (Array.isArray(value)) return value.map(withoutIds);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key]) => key !== 'id')
				.map(([key, v]) => [key, withoutIds(v)])
		);
	}
	return value;
}

const LOCAL_DATA_KEY = 'uk-wealth-tracker:data';
const DOCUMENT_KEY = 'document';

beforeEach(() => {
	vi.stubGlobal('localStorage', createMemoryStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('browserStorageBackend', () => {
	it('is indexeddb when IndexedDB opens', async () => {
		vi.stubGlobal('indexedDB', createMemoryIndexedDb().indexedDB);
		const { browserStorageBackend } = await import('./browser-storage.js');
		expect(await browserStorageBackend()).toBe('indexeddb');
	});

	it('is localstorage when there is no IndexedDB at all', async () => {
		const { browserStorageBackend } = await import('./browser-storage.js');
		expect(typeof indexedDB).toBe('undefined');
		expect(await browserStorageBackend()).toBe('localstorage');
	});

	it('is none when neither backend exists (e.g. during SSR)', async () => {
		vi.unstubAllGlobals();
		const { browserStorageBackend } = await import('./browser-storage.js');
		expect(await browserStorageBackend()).toBe('none');
	});
});

describe('IndexedDB (primary backend)', () => {
	/** @type {Map<string, unknown>} */
	let records;

	beforeEach(() => {
		const fake = createMemoryIndexedDb();
		records = fake.records;
		vi.stubGlobal('indexedDB', fake.indexedDB);
	});

	it('loadAppData returns a fresh document when nothing is stored', async () => {
		const { loadAppData } = await import('./browser-storage.js');
		expect(withoutIds(await loadAppData())).toEqual(withoutIds(createAppData()));
	});

	it('saveAppData then loadAppData round-trips, without touching localStorage', async () => {
		const { loadAppData, saveAppData } = await import('./browser-storage.js');
		await saveAppData(createAppData({ profile: createProfile({ name: 'Ada' }) }));

		expect(String(records.get(DOCUMENT_KEY))).toContain('Ada');
		expect(localStorage.getItem(LOCAL_DATA_KEY)).toBeNull();
		expect((await loadAppData()).profile.name).toBe('Ada');
	});

	it('stores the same JSON shape the Gist file holds', async () => {
		const { saveAppData } = await import('./browser-storage.js');
		await saveAppData(createAppData());

		const stored = records.get(DOCUMENT_KEY);
		expect(typeof stored).toBe('string');
		const parsed = JSON.parse(/** @type {string} */ (stored));
		expect(parsed.schema_version).toBe(SCHEMA_VERSION);
		expect(parsed).toHaveProperty('monthly_entries');
	});

	it('migrates what it reads back, so an older or hand-edited document still loads', async () => {
		records.set(DOCUMENT_KEY, JSON.stringify({ profile: { name: 'Grace' }, pensions: 'nonsense' }));

		const { loadAppData } = await import('./browser-storage.js');
		const data = await loadAppData();

		expect(data.profile.name).toBe('Grace');
		expect(data.schema_version).toBe(SCHEMA_VERSION);
		expect(data.pensions).toEqual([]);
		expect(data.budget).toBeDefined();
	});

	it('starts fresh rather than failing when the stored record is not valid JSON', async () => {
		records.set(DOCUMENT_KEY, '{not valid json');

		const { loadAppData } = await import('./browser-storage.js');
		expect(withoutIds(await loadAppData())).toEqual(withoutIds(createAppData()));
	});

	it('adopts a document an earlier build left in localStorage', async () => {
		localStorage.setItem(
			LOCAL_DATA_KEY,
			JSON.stringify(createAppData({ profile: createProfile({ name: 'Rosalind' }) }))
		);

		const { loadAppData, saveAppData } = await import('./browser-storage.js');
		const data = await loadAppData();
		expect(data.profile.name).toBe('Rosalind');

		// ...and the next save promotes it into IndexedDB.
		await saveAppData(data);
		expect(String(records.get(DOCUMENT_KEY))).toContain('Rosalind');
	});
});

describe('localStorage fallback (IndexedDB unavailable)', () => {
	it('round-trips through localStorage when there is no IndexedDB at all', async () => {
		const { loadAppData, saveAppData } = await import('./browser-storage.js');

		expect(withoutIds(await loadAppData())).toEqual(withoutIds(createAppData()));
		await saveAppData(createAppData({ profile: createProfile({ name: 'Ada' }) }));

		expect(localStorage.getItem(LOCAL_DATA_KEY)).toContain('Ada');
		expect((await loadAppData()).profile.name).toBe('Ada');
	});

	it.each(
		/** @type {const} */ ([
			['open() throws (private browsing)', 'open-throws'],
			['the open request errors', 'open-errors'],
			['the open request is blocked by another tab', 'blocked']
		])
	)('falls back when %s', async (_label, fault) => {
		vi.stubGlobal('indexedDB', createMemoryIndexedDb({ fault }).indexedDB);

		const { browserStorageBackend, loadAppData, saveAppData } =
			await import('./browser-storage.js');
		expect(await browserStorageBackend()).toBe('localstorage');

		await saveAppData(createAppData({ profile: createProfile({ name: 'Hedy' }) }));
		expect(localStorage.getItem(LOCAL_DATA_KEY)).toContain('Hedy');
		expect((await loadAppData()).profile.name).toBe('Hedy');
	});

	it('starts fresh rather than failing on corrupt localStorage content', async () => {
		localStorage.setItem(LOCAL_DATA_KEY, '{not valid json');

		const { loadAppData } = await import('./browser-storage.js');
		expect(withoutIds(await loadAppData())).toEqual(withoutIds(createAppData()));
	});

	it('falls back for a failed IndexedDB read rather than blocking the app', async () => {
		vi.stubGlobal('indexedDB', createMemoryIndexedDb({ fault: 'read-fails' }).indexedDB);
		localStorage.setItem(
			LOCAL_DATA_KEY,
			JSON.stringify(createAppData({ profile: createProfile({ name: 'Katherine' }) }))
		);

		const { loadAppData } = await import('./browser-storage.js');
		expect((await loadAppData()).profile.name).toBe('Katherine');
	});

	it('falls back for a failed IndexedDB write', async () => {
		vi.stubGlobal('indexedDB', createMemoryIndexedDb({ fault: 'write-fails' }).indexedDB);

		const { saveAppData } = await import('./browser-storage.js');
		await saveAppData(createAppData({ profile: createProfile({ name: 'Mary' }) }));

		expect(localStorage.getItem(LOCAL_DATA_KEY)).toContain('Mary');
	});

	it('falls back when the transaction itself is refused', async () => {
		vi.stubGlobal('indexedDB', createMemoryIndexedDb({ fault: 'transaction-throws' }).indexedDB);

		const { saveAppData } = await import('./browser-storage.js');
		await saveAppData(createAppData({ profile: createProfile({ name: 'Joan' }) }));

		expect(localStorage.getItem(LOCAL_DATA_KEY)).toContain('Joan');
	});
});

describe('BrowserStorageError — genuine failures only', () => {
	it('is thrown when an IndexedDB read fails and there is no localStorage to fall back to', async () => {
		vi.unstubAllGlobals();
		vi.stubGlobal('indexedDB', createMemoryIndexedDb({ fault: 'read-fails' }).indexedDB);

		const { BrowserStorageError, loadAppData } = await import('./browser-storage.js');
		await expect(loadAppData()).rejects.toThrow(BrowserStorageError);
	});

	it('is thrown when localStorage rejects the write (quota exceeded)', async () => {
		vi.stubGlobal('localStorage', createMemoryStorage({ setItemThrows: true }));

		const { BrowserStorageError, saveAppData } = await import('./browser-storage.js');
		await expect(saveAppData(createAppData())).rejects.toThrow(BrowserStorageError);
	});

	it('is thrown when no browser storage exists at all', async () => {
		vi.unstubAllGlobals();

		const { BrowserStorageError, saveAppData } = await import('./browser-storage.js');
		await expect(saveAppData(createAppData())).rejects.toThrow(BrowserStorageError);
	});

	it('is not thrown for a first visit with nothing stored anywhere', async () => {
		vi.unstubAllGlobals();

		const { loadAppData } = await import('./browser-storage.js');
		expect(withoutIds(await loadAppData())).toEqual(withoutIds(createAppData()));
	});

	it('carries the underlying failure as its cause', async () => {
		vi.stubGlobal('localStorage', createMemoryStorage({ setItemThrows: true }));

		const { saveAppData } = await import('./browser-storage.js');
		await expect(saveAppData(createAppData())).rejects.toMatchObject({
			name: 'BrowserStorageError',
			cause: expect.any(Error)
		});
	});
});

describe('hasLocalStorage', () => {
	it('is false when accessing localStorage throws (blocked by browser policy)', async () => {
		vi.unstubAllGlobals();
		vi.stubGlobal('localStorage', undefined);

		const { hasLocalStorage } = await import('./browser-storage.js');
		expect(hasLocalStorage()).toBe(false);
	});

	it('is true with a working localStorage', async () => {
		const { hasLocalStorage } = await import('./browser-storage.js');
		expect(hasLocalStorage()).toBe(true);
	});
});
