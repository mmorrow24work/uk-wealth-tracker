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

/**
 * A `GET /user` response, for the sign-in half — `github-auth.js` verifies a token against this
 * before `connectGitHubAccount` stores anything. Its own tests cover the verification itself; here
 * it is only ever the happy path, so that what these tests assert is the *Gist* side of connecting.
 *
 * @param {string} login
 */
function verifiedUser(login) {
	return {
		ok: true,
		status: 200,
		headers: new Headers({ 'x-oauth-scopes': 'gist' }),
		json: async () => ({ login, id: 1, name: null })
	};
}

const TOKEN_KEY = 'uk-wealth-tracker:github-token';
const ACCOUNT_KEY = 'uk-wealth-tracker:github-account';
const GIST_ID_KEY = 'uk-wealth-tracker:gist-id';
const OWNER_KEY = 'uk-wealth-tracker:gist-owner';

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

	it('is true once someone has signed in, on a build with no token of its own', async () => {
		localStorage.setItem(TOKEN_KEY, 'signed-in-token');
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

describe('authenticating with the signed-in token', () => {
	it('uses the token pasted into this browser, with no build token anywhere', async () => {
		localStorage.setItem(TOKEN_KEY, 'signed-in-token');
		localStorage.setItem(GIST_ID_KEY, 'gist-mine');
		fetchMock.mockResolvedValueOnce(jsonResponse({ files: {} }));

		const { loadAppData } = await import('./gist.js');
		await loadAppData();

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.github.com/gists/gist-mine',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer signed-in-token' })
			})
		);
	});

	it('prefers the signed-in token over one compiled into the build', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'build-token');
		vi.stubEnv('VITE_GIST_ID', 'gist-123');
		localStorage.setItem(TOKEN_KEY, 'signed-in-token');
		fetchMock.mockResolvedValueOnce(jsonResponse({ files: {} }));

		const { loadAppData } = await import('./gist.js');
		await loadAppData();

		const [, options] = fetchMock.mock.calls[0];
		expect(options.headers.Authorization).toBe('Bearer signed-in-token');
	});
});

describe('which gist is connected', () => {
	it('is nothing at all before one is chosen or created', async () => {
		const { describeGistTarget } = await import('./gist.js');
		expect(describeGistTarget()).toEqual({ id: undefined, url: undefined, source: 'none' });
	});

	it('reports the build gist when only VITE_GIST_ID is set', async () => {
		vi.stubEnv('VITE_GIST_ID', 'gist-123');
		const { describeGistTarget } = await import('./gist.js');
		expect(describeGistTarget()).toEqual({
			id: 'gist-123',
			url: 'https://gist.github.com/gist-123',
			source: 'build'
		});
	});

	it('lets a gist chosen in the app win over the build one', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
		vi.stubEnv('VITE_GIST_ID', 'gist-from-build');
		fetchMock.mockResolvedValueOnce(jsonResponse({ files: {} }));

		const { describeGistTarget, loadAppData, setActiveGistId } = await import('./gist.js');
		setActiveGistId('gistchosen');

		expect(describeGistTarget().source).toBe('browser');
		await loadAppData();
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.github.com/gists/gistchosen',
			expect.anything()
		);
	});

	it('falls back to the build gist once the chosen one is forgotten', async () => {
		vi.stubEnv('VITE_GIST_ID', 'gist-from-build');
		const { clearActiveGistId, describeGistTarget, setActiveGistId } = await import('./gist.js');

		setActiveGistId('gistchosen');
		clearActiveGistId();

		expect(describeGistTarget()).toMatchObject({ id: 'gist-from-build', source: 'build' });
	});

	it('starts a fresh gist on the next save once the chosen one is forgotten and there is no build one', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'test-token');
		fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'gist-new' }, { status: 201 }));

		const { clearActiveGistId, saveAppData, setActiveGistId } = await import('./gist.js');
		setActiveGistId('gistchosen');
		clearActiveGistId();
		await saveAppData(createAppData());

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.github.com/gists',
			expect.objectContaining({ method: 'POST' })
		);
		expect(localStorage.getItem(GIST_ID_KEY)).toBe('gist-new');
	});
});

describe('normaliseGistId', () => {
	it('accepts a bare id', async () => {
		const { normaliseGistId } = await import('./gist.js');
		expect(normaliseGistId('  aa11bb22cc33  ')).toBe('aa11bb22cc33');
	});

	it('accepts a gist URL, which is what people actually have to hand', async () => {
		const { normaliseGistId } = await import('./gist.js');
		expect(normaliseGistId('https://gist.github.com/octocat/aa11bb22cc33')).toBe('aa11bb22cc33');
		expect(normaliseGistId('https://gist.github.com/octocat/aa11bb22cc33/')).toBe('aa11bb22cc33');
		expect(normaliseGistId('https://gist.github.com/octocat/aa11bb22cc33#file-x')).toBe(
			'aa11bb22cc33'
		);
	});

	it('rejects an empty entry and anything that is not an id', async () => {
		const { normaliseGistId } = await import('./gist.js');
		expect(() => normaliseGistId('   ')).toThrow(RangeError);
		expect(() => normaliseGistId('not an id')).toThrow(RangeError);
		expect(() => normaliseGistId('https://gist.github.com/octocat/nope!')).toThrow(RangeError);
	});

	it('is what setActiveGistId enforces, so a bad paste never becomes the sync target', async () => {
		const { setActiveGistId } = await import('./gist.js');
		expect(() => setActiveGistId('nope!')).toThrow(RangeError);
		expect(localStorage.getItem(GIST_ID_KEY)).toBeNull();
		expect(setActiveGistId('https://gist.github.com/octocat/aa11bb22cc33')).toBe('aa11bb22cc33');
		expect(localStorage.getItem(GIST_ID_KEY)).toBe('aa11bb22cc33');
	});
});

describe('connecting and disconnecting a GitHub account', () => {
	it('signs in and keeps the gist this browser was already using', async () => {
		localStorage.setItem(GIST_ID_KEY, 'gist-mine');
		fetchMock.mockResolvedValueOnce(verifiedUser('octocat'));

		const { connectGitHubAccount, describeGistTarget } = await import('./gist.js');
		const account = await connectGitHubAccount('ghp_valid');

		expect(account.login).toBe('octocat');
		expect(localStorage.getItem(TOKEN_KEY)).toBe('ghp_valid');
		expect(describeGistTarget().id).toBe('gist-mine');
	});

	it('records whose gist it is when one is chosen', async () => {
		localStorage.setItem(TOKEN_KEY, 'ghp_valid');
		localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ login: 'octocat', id: 1 }));

		const { describeGistTarget, setActiveGistId } = await import('./gist.js');
		setActiveGistId('aa11bb22cc33');

		expect(describeGistTarget()).toMatchObject({ id: 'aa11bb22cc33', owner: 'octocat' });
		expect(localStorage.getItem(OWNER_KEY)).toBe('octocat');
	});

	it('records whose gist it is when the app creates one on first save', async () => {
		localStorage.setItem(TOKEN_KEY, 'ghp_valid');
		localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ login: 'octocat', id: 1 }));
		fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'created11gist' }, { status: 201 }));

		const { saveAppData } = await import('./gist.js');
		await saveAppData(createAppData());

		expect(localStorage.getItem(GIST_ID_KEY)).toBe('created11gist');
		expect(localStorage.getItem(OWNER_KEY)).toBe('octocat');
	});

	it('keeps the gist when the same account signs in again', async () => {
		localStorage.setItem(GIST_ID_KEY, 'gist-mine');
		localStorage.setItem(OWNER_KEY, 'octocat');
		fetchMock.mockResolvedValueOnce(verifiedUser('octocat'));

		const { connectGitHubAccount, describeGistTarget } = await import('./gist.js');
		await connectGitHubAccount('ghp_valid');

		expect(describeGistTarget().id).toBe('gist-mine');
	});

	it('forgets the gist when a different account signs in', async () => {
		// That gist belongs to the account recorded beside it; GitHub would 404 every read and write
		// of it for anyone else, which reads as "my data vanished" rather than "not yours".
		localStorage.setItem(GIST_ID_KEY, 'gist-belonging-to-octocat');
		localStorage.setItem(OWNER_KEY, 'octocat');
		fetchMock.mockResolvedValueOnce(verifiedUser('ada'));

		const { connectGitHubAccount, describeGistTarget } = await import('./gist.js');
		await connectGitHubAccount('ghp_ada');

		expect(describeGistTarget().id).toBeUndefined();
		expect(localStorage.getItem(GIST_ID_KEY)).toBeNull();
		expect(localStorage.getItem(OWNER_KEY)).toBeNull();
	});

	it('forgets it even though signing out cleared the previous account record first', async () => {
		// The realistic way two accounts share a browser: sign out, then sign in as someone else. By
		// then there is no "previous account" left to compare against — only the owner beside the id.
		localStorage.setItem(TOKEN_KEY, 'ghp_octocat');
		localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ login: 'octocat', id: 1 }));
		localStorage.setItem(GIST_ID_KEY, 'gist-belonging-to-octocat');
		localStorage.setItem(OWNER_KEY, 'octocat');
		fetchMock.mockResolvedValueOnce(verifiedUser('ada'));

		const { connectGitHubAccount, disconnectGitHubAccount } = await import('./gist.js');
		disconnectGitHubAccount();
		await connectGitHubAccount('ghp_ada');

		expect(localStorage.getItem(GIST_ID_KEY)).toBeNull();
	});

	it('leaves a gist whose owner was never recorded alone — unknown is not different', async () => {
		// An id cached by a build before owners were recorded, or while running on a build token whose
		// owner this app never asked about. Clearing it would orphan real data on a guess.
		localStorage.setItem(GIST_ID_KEY, 'gist-from-an-older-build');
		fetchMock.mockResolvedValueOnce(verifiedUser('ada'));

		const { connectGitHubAccount, describeGistTarget } = await import('./gist.js');
		await connectGitHubAccount('ghp_ada');

		expect(describeGistTarget().id).toBe('gist-from-an-older-build');
	});

	it('changes nothing when the token is rejected', async () => {
		localStorage.setItem(GIST_ID_KEY, 'gist-mine');
		localStorage.setItem(OWNER_KEY, 'octocat');
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 401,
			headers: new Headers(),
			json: async () => ({ message: 'Bad credentials' })
		});

		const { connectGitHubAccount, describeGistTarget } = await import('./gist.js');
		await expect(connectGitHubAccount('ghp_bad')).rejects.toThrow();

		expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
		expect(describeGistTarget().id).toBe('gist-mine');
	});

	it('signing out drops the token but keeps the gist pointer', async () => {
		// Forgetting it would mean signing back in created a second, empty gist and orphaned the
		// first — the token is the secret worth dropping, the id is a bookmark.
		localStorage.setItem(TOKEN_KEY, 'ghp_valid');
		localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ login: 'octocat', id: 1 }));
		localStorage.setItem(GIST_ID_KEY, 'gist-mine');

		const { describeGistTarget, disconnectGitHubAccount, isGistConfigured } =
			await import('./gist.js');
		const connection = disconnectGitHubAccount();

		expect(connection.signedIn).toBe(false);
		expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
		expect(localStorage.getItem(ACCOUNT_KEY)).toBeNull();
		expect(describeGistTarget().id).toBe('gist-mine');
		expect(isGistConfigured()).toBe(false);
	});
});
