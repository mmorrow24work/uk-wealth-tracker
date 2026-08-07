import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppData, createProfile } from './model.js';

/**
 * A minimal in-memory `localStorage` stand-in. Vitest's default environment is `node`, which has
 * no `localStorage` global at all — tests that need one stub it in with this; tests that want to
 * exercise the "no localStorage" path (e.g. SSR) just don't.
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
 * @param {unknown} body
 * @param {{ ok?: boolean, status?: number, json?: () => any, text?: () => any }} [overrides]
 */
function jsonResponse(body, overrides = {}) {
	return {
		ok: true,
		status: 200,
		json: async () => body,
		text: async () => JSON.stringify(body),
		...overrides
	};
}

/**
 * `createAppData()` mints a fresh random id for every milestone on every call, so two calls are
 * never `toEqual`. Strip `id` fields recursively before comparing "is this a fresh empty
 * document" — the ids themselves are never what these tests care about.
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
let fetchMock;

beforeEach(() => {
	vi.unstubAllEnvs();
	vi.stubGlobal('localStorage', createMemoryStorage());
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('isGistConfigured', () => {
	it('is false with no token', async () => {
		const { isGistConfigured } = await import('./gist.js');
		expect(isGistConfigured()).toBe(false);
	});

	it('is true once a token is set, regardless of gist id', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
		const { isGistConfigured } = await import('./gist.js');
		expect(isGistConfigured()).toBe(true);
	});
});

describe('no token configured', () => {
	// Storing the document in the browser is `browser-storage.js`'s job now, so this module no
	// longer has a "no token" mode to fall back into — `persistence.js` simply never routes here.
	it('loadAppData throws rather than silently reading from somewhere else', async () => {
		const { GistError, loadAppData } = await import('./gist.js');
		await expect(loadAppData()).rejects.toThrow(GistError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('saveAppData throws rather than silently writing somewhere else', async () => {
		const { GistError, saveAppData } = await import('./gist.js');
		await expect(saveAppData(createAppData())).rejects.toThrow(GistError);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(localStorage.getItem('uk-wealth-tracker:data')).toBeNull();
	});
});

describe('Gist reads (token configured)', () => {
	beforeEach(() => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
	});

	it('returns a fresh document without calling the API when no gist id is configured or cached', async () => {
		const { loadAppData } = await import('./gist.js');
		const data = await loadAppData();
		expect(withoutIds(data)).toEqual(withoutIds(createAppData()));
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('fetches the configured gist and normalises its file content', async () => {
		vi.stubEnv('VITE_GIST_ID', 'gist-123');
		const stored = createAppData({ profile: createProfile({ name: 'Grace' }) });
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				files: {
					'uk-wealth-tracker.json': { content: JSON.stringify(stored), truncated: false }
				}
			})
		);

		const { loadAppData } = await import('./gist.js');
		const data = await loadAppData();

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.github.com/gists/gist-123',
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
			})
		);
		expect(data.profile.name).toBe('Grace');
	});

	it('uses a gist id cached in localStorage from a prior create when none is configured', async () => {
		localStorage.setItem('uk-wealth-tracker:gist-id', 'gist-cached');
		fetchMock.mockResolvedValueOnce(jsonResponse({ files: {} }));

		const { loadAppData } = await import('./gist.js');
		await loadAppData();

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.github.com/gists/gist-cached',
			expect.anything()
		);
	});

	it('returns a fresh document when the gist exists but has no data file yet', async () => {
		vi.stubEnv('VITE_GIST_ID', 'gist-123');
		fetchMock.mockResolvedValueOnce(jsonResponse({ files: {} }));

		const { loadAppData } = await import('./gist.js');
		const data = await loadAppData();
		expect(withoutIds(data)).toEqual(withoutIds(createAppData()));
	});

	it('follows raw_url when the file content is truncated', async () => {
		vi.stubEnv('VITE_GIST_ID', 'gist-123');
		const stored = createAppData({ profile: createProfile({ name: 'Rosalind' }) });
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse({
					files: {
						'uk-wealth-tracker.json': {
							truncated: true,
							raw_url: 'https://gist.githubusercontent.com/raw/gist-123/uk-wealth-tracker.json'
						}
					}
				})
			)
			.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(stored) });

		const { loadAppData } = await import('./gist.js');
		const data = await loadAppData();

		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			'https://gist.githubusercontent.com/raw/gist-123/uk-wealth-tracker.json'
		);
		expect(data.profile.name).toBe('Rosalind');
	});

	it('throws GistError on a non-OK API response', async () => {
		vi.stubEnv('VITE_GIST_ID', 'gist-missing');
		fetchMock.mockResolvedValue(
			jsonResponse(
				{ message: 'Not Found' },
				{ ok: false, status: 404, text: async () => 'Not Found' }
			)
		);

		const { GistError, loadAppData } = await import('./gist.js');
		await expect(loadAppData()).rejects.toThrow(GistError);
		await expect(loadAppData()).rejects.toMatchObject({ status: 404 });
	});

	it('throws GistError when the network request itself fails', async () => {
		vi.stubEnv('VITE_GIST_ID', 'gist-123');
		fetchMock.mockRejectedValue(new Error('network down'));

		const { GistError, loadAppData } = await import('./gist.js');
		await expect(loadAppData()).rejects.toThrow(GistError);
	});

	it('throws GistError when the stored file is not valid JSON', async () => {
		vi.stubEnv('VITE_GIST_ID', 'gist-123');
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				files: { 'uk-wealth-tracker.json': { content: 'not json', truncated: false } }
			})
		);

		const { GistError, loadAppData } = await import('./gist.js');
		await expect(loadAppData()).rejects.toThrow(GistError);
	});
});

describe('Gist writes (token configured)', () => {
	beforeEach(() => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
	});

	it('creates a new private gist when none is configured or cached', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'gist-new' }, { status: 201 }));

		const { saveAppData } = await import('./gist.js');
		await saveAppData(createAppData());

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.github.com/gists',
			expect.objectContaining({ method: 'POST' })
		);
		const [, options] = fetchMock.mock.calls[0];
		const body = JSON.parse(options.body);
		expect(body.public).toBe(false);
		expect(body.files['uk-wealth-tracker.json'].content).toContain('schema_version');
		expect(localStorage.getItem('uk-wealth-tracker:gist-id')).toBe('gist-new');
	});

	it('PATCHes the configured gist directly, without creating a new one', async () => {
		vi.stubEnv('VITE_GIST_ID', 'gist-123');
		fetchMock.mockResolvedValueOnce(jsonResponse({}));

		const { saveAppData } = await import('./gist.js');
		await saveAppData(createAppData());

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.github.com/gists/gist-123',
			expect.objectContaining({ method: 'PATCH' })
		);
	});

	it('PATCHes a previously self-created gist using the cached id', async () => {
		localStorage.setItem('uk-wealth-tracker:gist-id', 'gist-cached');
		fetchMock.mockResolvedValueOnce(jsonResponse({}));

		const { saveAppData } = await import('./gist.js');
		await saveAppData(createAppData());

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.github.com/gists/gist-cached',
			expect.objectContaining({ method: 'PATCH' })
		);
	});

	it('throws GistError and does not cache anything when the write fails', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ message: 'Bad credentials' }, { ok: false, status: 401 })
		);

		const { GistError, saveAppData } = await import('./gist.js');
		await expect(saveAppData(createAppData())).rejects.toThrow(GistError);
		expect(localStorage.getItem('uk-wealth-tracker:gist-id')).toBeNull();
	});
});
