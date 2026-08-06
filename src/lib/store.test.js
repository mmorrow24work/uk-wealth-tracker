import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppData, createProfile } from './model.js';

/**
 * `createAppData()` mints a fresh random id for every milestone on every call, so two calls are
 * never `toEqual`. Strip `id` fields recursively before comparing "is this a fresh empty
 * document" — same helper `gist.test.js` uses for the same reason.
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

/** @type {import('vitest').Mock} */
let loadAppDataMock;
/** @type {import('vitest').Mock} */
let saveAppDataMock;
/** @type {typeof import('./gist.js').GistError} */
let GistError;

vi.mock('./gist.js', async () => {
	const actual = /** @type {typeof import('./gist.js')} */ (await vi.importActual('./gist.js'));
	return {
		...actual,
		loadAppData: vi.fn(),
		saveAppData: vi.fn()
	};
});

beforeEach(async () => {
	vi.useFakeTimers();
	const gist = await import('./gist.js');
	loadAppDataMock = /** @type {import('vitest').Mock} */ (gist.loadAppData);
	saveAppDataMock = /** @type {import('vitest').Mock} */ (gist.saveAppData);
	// The same `GistError` class store.js's own `import` sees — obtained through the mocked module
	// (which re-exports the real one via `...actual`), not a second `vi.importActual` call, since
	// `vi.resetModules()` between tests would otherwise make that a distinct class and break every
	// `instanceof` check in `describeError`.
	GistError = gist.GistError;
	loadAppDataMock.mockReset().mockResolvedValue(createAppData());
	saveAppDataMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.resetModules();
});

describe('appData / syncState initial values', () => {
	it('starts as a fresh empty document, unhydrated, with no pending sync', async () => {
		const { appData, syncState } = await import('./store.js');
		expect(withoutIds(get(appData))).toEqual(withoutIds(createAppData()));
		expect(get(syncState)).toEqual({ hydrated: false, syncing: false, error: null });
		expect(loadAppDataMock).not.toHaveBeenCalled();
		expect(saveAppDataMock).not.toHaveBeenCalled();
	});

	it('does not schedule a save for a change made before the first hydrate', async () => {
		const { appData, syncState } = await import('./store.js');
		appData.set(createAppData({ profile: createProfile({ name: 'Too early' }) }));

		await vi.advanceTimersByTimeAsync(10_000);

		expect(saveAppDataMock).not.toHaveBeenCalled();
		expect(get(syncState).syncing).toBe(false);
	});
});

describe('hydrateAppData', () => {
	it('replaces appData with the loaded document and marks syncState hydrated', async () => {
		const stored = createAppData({ profile: createProfile({ name: 'Ada' }) });
		loadAppDataMock.mockResolvedValue(stored);

		const { appData, hydrateAppData, syncState } = await import('./store.js');
		const returned = await hydrateAppData();

		expect(returned).toEqual(stored);
		expect(get(appData)).toEqual(stored);
		expect(get(syncState)).toEqual({ hydrated: true, syncing: false, error: null });
	});

	it('does not immediately re-save the document it just loaded', async () => {
		const { hydrateAppData } = await import('./store.js');
		await hydrateAppData();

		await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS_FOR_TESTS);

		expect(saveAppDataMock).not.toHaveBeenCalled();
	});

	it('shares one in-flight load across concurrent callers', async () => {
		/** @type {(value: import('./types.js').AppData) => void} */
		let resolveLoad = () => {};
		loadAppDataMock.mockReturnValue(
			new Promise((resolve) => {
				resolveLoad = resolve;
			})
		);

		const { hydrateAppData } = await import('./store.js');
		const first = hydrateAppData();
		const second = hydrateAppData();

		expect(loadAppDataMock).toHaveBeenCalledTimes(1);
		resolveLoad(createAppData());
		await Promise.all([first, second]);
	});

	it('on failure, leaves appData untouched and records the error without throwing', async () => {
		loadAppDataMock.mockRejectedValue(new GistError('bad token', { status: 401 }));

		const { appData, hydrateAppData, syncState } = await import('./store.js');
		const before = get(appData);

		const returned = await hydrateAppData();

		expect(returned).toEqual(before);
		expect(get(appData)).toEqual(before);
		const state = get(syncState);
		expect(state.hydrated).toBe(true);
		expect(state.error).toBe('bad token');
	});

	it('recovers from a failed hydrate on the next call', async () => {
		loadAppDataMock.mockRejectedValueOnce(new GistError('network down'));
		const stored = createAppData({ profile: createProfile({ name: 'Grace' }) });
		loadAppDataMock.mockResolvedValueOnce(stored);

		const { appData, hydrateAppData, syncState } = await import('./store.js');
		await hydrateAppData();
		expect(get(syncState).error).toBe('network down');

		await hydrateAppData();
		expect(get(appData)).toEqual(stored);
		expect(get(syncState).error).toBeNull();
	});
});

describe('debounced sync on change', () => {
	it('does not save before the debounce window elapses', async () => {
		const { appData, hydrateAppData } = await import('./store.js');
		await hydrateAppData();

		appData.set(createAppData({ profile: createProfile({ name: 'Rosalind' }) }));
		await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS_FOR_TESTS - 100);

		expect(saveAppDataMock).not.toHaveBeenCalled();
	});

	it('saves once the debounce window elapses, with the changed value', async () => {
		const { appData, hydrateAppData, syncState } = await import('./store.js');
		await hydrateAppData();

		const changed = createAppData({ profile: createProfile({ name: 'Rosalind' }) });
		appData.set(changed);
		await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS_FOR_TESTS);

		expect(saveAppDataMock).toHaveBeenCalledTimes(1);
		expect(saveAppDataMock).toHaveBeenCalledWith(changed);
		expect(get(syncState)).toEqual({ hydrated: true, syncing: false, error: null });
	});

	it('collapses a burst of changes into a single save of the latest value', async () => {
		const { appData, hydrateAppData } = await import('./store.js');
		await hydrateAppData();

		appData.set(createAppData({ profile: createProfile({ name: 'One' }) }));
		await vi.advanceTimersByTimeAsync(200);
		appData.set(createAppData({ profile: createProfile({ name: 'Two' }) }));
		await vi.advanceTimersByTimeAsync(200);
		const last = createAppData({ profile: createProfile({ name: 'Three' }) });
		appData.set(last);

		await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS_FOR_TESTS);

		expect(saveAppDataMock).toHaveBeenCalledTimes(1);
		expect(saveAppDataMock).toHaveBeenCalledWith(last);
	});

	it('records a save failure on syncState without throwing, and recovers on the next change', async () => {
		saveAppDataMock.mockRejectedValueOnce(new GistError('quota exceeded', { status: 403 }));

		const { appData, hydrateAppData, syncState } = await import('./store.js');
		await hydrateAppData();

		appData.set(createAppData({ profile: createProfile({ name: 'Fails' }) }));
		await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS_FOR_TESTS);
		expect(get(syncState).error).toBe('quota exceeded');

		appData.set(createAppData({ profile: createProfile({ name: 'Retried' }) }));
		await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS_FOR_TESTS);
		expect(get(syncState).error).toBeNull();
		expect(saveAppDataMock).toHaveBeenCalledTimes(2);
	});
});

describe('flushAppDataSync', () => {
	it('saves immediately without waiting for the debounce window', async () => {
		const { appData, flushAppDataSync, hydrateAppData } = await import('./store.js');
		await hydrateAppData();

		const changed = createAppData({ profile: createProfile({ name: 'Urgent' }) });
		appData.set(changed);
		await flushAppDataSync();

		expect(saveAppDataMock).toHaveBeenCalledTimes(1);
		expect(saveAppDataMock).toHaveBeenCalledWith(changed);
	});

	it('cancels a pending debounced save rather than saving twice', async () => {
		const { appData, flushAppDataSync, hydrateAppData } = await import('./store.js');
		await hydrateAppData();

		appData.set(createAppData({ profile: createProfile({ name: 'Flushed' }) }));
		await flushAppDataSync();
		await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS_FOR_TESTS + 100);

		expect(saveAppDataMock).toHaveBeenCalledTimes(1);
	});
});

// Kept as a plain constant (rather than importing `SYNC_DEBOUNCE_MS` before the module is
// dynamically imported per test, which `vi.resetModules()` would otherwise invalidate) — it must
// match `./store.js`'s own exported value, checked by the "matches the exported constant" test
// below so the two can never silently drift apart.
const SYNC_DEBOUNCE_MS_FOR_TESTS = 800;

describe('SYNC_DEBOUNCE_MS', () => {
	it('matches the exported constant', async () => {
		const { SYNC_DEBOUNCE_MS } = await import('./store.js');
		expect(SYNC_DEBOUNCE_MS).toBe(SYNC_DEBOUNCE_MS_FOR_TESTS);
	});
});
