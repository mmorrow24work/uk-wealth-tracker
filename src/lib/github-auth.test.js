import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Same in-memory `localStorage` stand-in `gist.test.js`, `browser-storage.test.js` and
 * `persistence.test.js` use — the `node` test environment has no `localStorage` global, and the
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
 * A `GET /user` response. `headers` matters as much as the body here: the `gist` scope is only
 * knowable from `X-OAuth-Scopes`.
 *
 * @param {unknown} body
 * @param {{ ok?: boolean, status?: number, scopes?: string | null }} [overrides]
 */
function userResponse(body, { ok = true, status = 200, scopes = 'gist' } = {}) {
	return {
		ok,
		status,
		headers: new Headers(scopes === null ? {} : { 'x-oauth-scopes': scopes }),
		json: async () => body
	};
}

const TOKEN_KEY = 'uk-wealth-tracker:github-token';
const ACCOUNT_KEY = 'uk-wealth-tracker:github-account';

const OCTOCAT = { login: 'octocat', id: 583231, name: 'The Octocat' };

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

describe('which token is active', () => {
	it('has no token at all when nothing is signed in or compiled in', async () => {
		const { getGitHubToken, hasGitHubToken, isGitHubSignedIn } = await import('./github-auth.js');
		expect(getGitHubToken()).toBeUndefined();
		expect(hasGitHubToken()).toBe(false);
		expect(isGitHubSignedIn()).toBe(false);
	});

	it('falls back to the build token when nobody has signed in', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'build-token');
		const { getGitHubToken, hasGitHubToken, isGitHubSignedIn } = await import('./github-auth.js');
		expect(getGitHubToken()).toBe('build-token');
		expect(hasGitHubToken()).toBe(true);
		// A compiled-in token is not a sign-in: nobody chose it in this browser.
		expect(isGitHubSignedIn()).toBe(false);
	});

	it('prefers the signed-in token over the build token', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'build-token');
		localStorage.setItem(TOKEN_KEY, 'browser-token');
		const { getBuildToken, getGitHubToken, getStoredToken, isGitHubSignedIn } =
			await import('./github-auth.js');
		expect(getStoredToken()).toBe('browser-token');
		expect(getBuildToken()).toBe('build-token');
		expect(getGitHubToken()).toBe('browser-token');
		expect(isGitHubSignedIn()).toBe(true);
	});

	it('treats an empty stored token as no token', async () => {
		localStorage.setItem(TOKEN_KEY, '');
		const { getGitHubToken, isGitHubSignedIn } = await import('./github-auth.js');
		expect(getGitHubToken()).toBeUndefined();
		expect(isGitHubSignedIn()).toBe(false);
	});

	it('reads nothing and throws nothing when there is no localStorage at all (SSR)', async () => {
		vi.unstubAllGlobals();
		vi.stubGlobal('fetch', fetchMock);
		const { describeGitHubConnection, getStoredAccount, getStoredToken } =
			await import('./github-auth.js');
		expect(getStoredToken()).toBeUndefined();
		expect(getStoredAccount()).toBeNull();
		expect(describeGitHubConnection()).toEqual({
			source: 'none',
			hasToken: false,
			signedIn: false,
			account: null
		});
	});
});

describe('the stored account record', () => {
	it('reads back what sign-in stored', async () => {
		localStorage.setItem(TOKEN_KEY, 'browser-token');
		localStorage.setItem(
			ACCOUNT_KEY,
			JSON.stringify({
				login: 'octocat',
				id: 583231,
				name: 'The Octocat',
				scopes: ['gist'],
				scopes_known: true,
				connected_at: '2026-08-07T09:00:00.000Z'
			})
		);
		const { getStoredAccount } = await import('./github-auth.js');
		expect(getStoredAccount()).toEqual({
			login: 'octocat',
			id: 583231,
			name: 'The Octocat',
			scopes: ['gist'],
			scopes_known: true,
			connected_at: '2026-08-07T09:00:00.000Z'
		});
	});

	it('treats a corrupt or loginless record as nobody, rather than throwing', async () => {
		localStorage.setItem(ACCOUNT_KEY, '{not json');
		const { getStoredAccount } = await import('./github-auth.js');
		expect(getStoredAccount()).toBeNull();

		localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ id: 1 }));
		expect(getStoredAccount()).toBeNull();
	});
});

describe('describeGitHubConnection', () => {
	it('reports nobody connected on a build with no token', async () => {
		const { describeGitHubConnection } = await import('./github-auth.js');
		expect(describeGitHubConnection()).toEqual({
			source: 'none',
			hasToken: false,
			signedIn: false,
			account: null
		});
	});

	it('reports a build token as a token whose owner is unknown', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'build-token');
		const { describeGitHubConnection } = await import('./github-auth.js');
		expect(describeGitHubConnection()).toEqual({
			source: 'build',
			hasToken: true,
			signedIn: false,
			account: null
		});
	});

	it('reports the signed-in account, build token or not', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'build-token');
		localStorage.setItem(TOKEN_KEY, 'browser-token');
		localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ login: 'ada', id: 7, scopes: ['gist'] }));
		const { describeGitHubConnection } = await import('./github-auth.js');
		const connection = describeGitHubConnection();
		expect(connection.source).toBe('browser');
		expect(connection.signedIn).toBe(true);
		expect(connection.account?.login).toBe('ada');
	});
});

describe('githubConnection store', () => {
	it('starts signed out, so prerendering never touches storage', async () => {
		localStorage.setItem(TOKEN_KEY, 'browser-token');
		const { githubConnection } = await import('./github-auth.js');
		expect(get(githubConnection).signedIn).toBe(false);
	});

	it('picks up the real state once refreshed', async () => {
		localStorage.setItem(TOKEN_KEY, 'browser-token');
		localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ login: 'ada', id: 7 }));
		const { githubConnection, refreshGitHubConnection } = await import('./github-auth.js');
		const connection = refreshGitHubConnection();
		expect(connection.account?.login).toBe('ada');
		expect(get(githubConnection).account?.login).toBe('ada');
	});
});

describe('verifyGitHubToken', () => {
	it('rejects an empty paste without calling the API', async () => {
		const { GitHubAuthError, verifyGitHubToken } = await import('./github-auth.js');
		await expect(verifyGitHubToken('   ')).rejects.toThrow(GitHubAuthError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects a paste with whitespace in it without calling the API', async () => {
		const { GitHubAuthError, verifyGitHubToken } = await import('./github-auth.js');
		await expect(verifyGitHubToken('ghp_one two')).rejects.toThrow(GitHubAuthError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('asks api.github.com who the token belongs to, and nothing else', async () => {
		fetchMock.mockResolvedValueOnce(userResponse(OCTOCAT));
		const { verifyGitHubToken } = await import('./github-auth.js');
		const account = await verifyGitHubToken('  ghp_valid  ');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.github.com/user',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer ghp_valid' })
			})
		);
		expect(account).toEqual({
			login: 'octocat',
			id: 583231,
			name: 'The Octocat',
			scopes: ['gist'],
			scopes_known: true
		});
	});

	it('accepts a token whose scopes include gist among others', async () => {
		fetchMock.mockResolvedValueOnce(userResponse(OCTOCAT, { scopes: 'repo, gist, read:user' }));
		const { verifyGitHubToken } = await import('./github-auth.js');
		const account = await verifyGitHubToken('ghp_valid');
		expect(account.scopes).toEqual(['repo', 'gist', 'read:user']);
	});

	it('refuses a classic token without the gist scope', async () => {
		fetchMock.mockResolvedValue(userResponse(OCTOCAT, { scopes: 'repo' }));
		const { GitHubAuthError, verifyGitHubToken } = await import('./github-auth.js');
		await expect(verifyGitHubToken('ghp_wrong_scope')).rejects.toThrow(/gist/);
		await expect(verifyGitHubToken('ghp_wrong_scope')).rejects.toBeInstanceOf(GitHubAuthError);
	});

	it('refuses a classic token with no scopes at all', async () => {
		fetchMock.mockResolvedValue(userResponse(OCTOCAT, { scopes: '' }));
		const { verifyGitHubToken } = await import('./github-auth.js');
		await expect(verifyGitHubToken('ghp_no_scopes')).rejects.toThrow(/gist/);
	});

	it('accepts a fine-grained token, which GitHub reports no scopes for at all', async () => {
		// An absent X-OAuth-Scopes header means "not stated", not "no access" — fine-grained tokens
		// carry per-resource permissions instead, and whether this one can reach Gists is only
		// answered by actually reading or writing one.
		fetchMock.mockResolvedValueOnce(userResponse(OCTOCAT, { scopes: null }));
		const { verifyGitHubToken } = await import('./github-auth.js');
		const account = await verifyGitHubToken('github_pat_fine_grained');
		expect(account.scopes_known).toBe(false);
		expect(account.scopes).toEqual([]);
	});

	it('reports a rejected token as a bad credential, not a crash', async () => {
		fetchMock.mockResolvedValue(
			userResponse({ message: 'Bad credentials' }, { ok: false, status: 401 })
		);
		const { GitHubAuthError, verifyGitHubToken } = await import('./github-auth.js');
		await expect(verifyGitHubToken('ghp_revoked')).rejects.toBeInstanceOf(GitHubAuthError);
		await expect(verifyGitHubToken('ghp_revoked')).rejects.toMatchObject({ status: 401 });
		await expect(verifyGitHubToken('ghp_revoked')).rejects.toThrow(/rejected that token/);
	});

	it('surfaces any other API failure with its status and message', async () => {
		fetchMock.mockResolvedValue(
			userResponse({ message: 'API rate limit exceeded' }, { ok: false, status: 403 })
		);
		const { verifyGitHubToken } = await import('./github-auth.js');
		await expect(verifyGitHubToken('ghp_limited')).rejects.toMatchObject({ status: 403 });
		await expect(verifyGitHubToken('ghp_limited')).rejects.toThrow(/rate limit/);
	});

	it('surfaces a network failure as an unreachable API', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		const { verifyGitHubToken } = await import('./github-auth.js');
		await expect(verifyGitHubToken('ghp_valid')).rejects.toThrow(/Could not reach the GitHub API/);
	});

	it('never puts the token itself into an error message', async () => {
		// The one realistic way a credential leaks into a log: a thrown error that quotes what it was
		// handed. `redactToken` covers every message this module raises.
		fetchMock.mockRejectedValue(new Error('request to https://api.github.com failed: ghp_secret'));
		const { verifyGitHubToken } = await import('./github-auth.js');

		const raised = await verifyGitHubToken('ghp_secret').catch((cause) => cause);
		expect(raised.message).toContain('[redacted token]');
		expect(raised.message).not.toContain('ghp_secret');
	});

	it('rejects a 200 that is not an account', async () => {
		fetchMock.mockResolvedValueOnce(userResponse({ nothing: true }));
		const { verifyGitHubToken } = await import('./github-auth.js');
		await expect(verifyGitHubToken('ghp_valid')).rejects.toThrow(/not an account/);
	});
});

describe('redactToken', () => {
	it('replaces every occurrence of the token', async () => {
		const { redactToken } = await import('./github-auth.js');
		expect(redactToken('ghp_x failed; retried ghp_x', 'ghp_x')).toBe(
			'[redacted token] failed; retried [redacted token]'
		);
	});

	it('leaves a message alone when there is no token to redact', async () => {
		const { redactToken } = await import('./github-auth.js');
		expect(redactToken('nothing to see', '')).toBe('nothing to see');
	});
});

describe('signInWithGitHubToken', () => {
	it('stores the token and the verified account, and updates the store', async () => {
		fetchMock.mockResolvedValueOnce(userResponse(OCTOCAT));
		const { githubConnection, signInWithGitHubToken } = await import('./github-auth.js');

		const account = await signInWithGitHubToken('  ghp_valid  ');

		expect(account.login).toBe('octocat');
		expect(typeof account.connected_at).toBe('string');
		expect(localStorage.getItem(TOKEN_KEY)).toBe('ghp_valid');
		expect(JSON.parse(/** @type {string} */ (localStorage.getItem(ACCOUNT_KEY))).login).toBe(
			'octocat'
		);
		expect(get(githubConnection)).toMatchObject({ source: 'browser', signedIn: true });
	});

	it('stores nothing when GitHub rejects the token', async () => {
		localStorage.setItem(TOKEN_KEY, 'existing-token');
		localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ login: 'ada', id: 7 }));
		fetchMock.mockResolvedValueOnce(
			userResponse({ message: 'Bad credentials' }, { ok: false, status: 401 })
		);

		const { signInWithGitHubToken } = await import('./github-auth.js');
		await expect(signInWithGitHubToken('ghp_bad')).rejects.toThrow();

		// The previous sign-in is left exactly as it was — a bad paste must not sign anyone out.
		expect(localStorage.getItem(TOKEN_KEY)).toBe('existing-token');
		expect(JSON.parse(/** @type {string} */ (localStorage.getItem(ACCOUNT_KEY))).login).toBe('ada');
	});

	it('refuses when this browser will not store anything', async () => {
		vi.unstubAllGlobals();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValue(userResponse(OCTOCAT));

		const { GitHubAuthError, signInWithGitHubToken } = await import('./github-auth.js');
		await expect(signInWithGitHubToken('ghp_valid')).rejects.toThrow(GitHubAuthError);
		await expect(signInWithGitHubToken('ghp_valid')).rejects.toThrow(/stay signed in/);
	});

	it('leaves nothing half-written when storage rejects the write', async () => {
		// The account write is the second of the two, so this is the "token stored, account not"
		// half-state the rollback exists for.
		const storage = createMemoryStorage();
		vi.stubGlobal('localStorage', {
			getItem: (/** @type {string} */ key) => storage.getItem(key),
			setItem: (/** @type {string} */ key, /** @type {string} */ value) => {
				if (key === ACCOUNT_KEY) throw new Error('QuotaExceededError');
				storage.setItem(key, value);
			},
			removeItem: (/** @type {string} */ key) => storage.removeItem(key)
		});
		fetchMock.mockResolvedValueOnce(userResponse(OCTOCAT));

		const { signInWithGitHubToken } = await import('./github-auth.js');
		await expect(signInWithGitHubToken('ghp_valid')).rejects.toThrow(/Could not save the sign-in/);
		expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
		expect(localStorage.getItem(ACCOUNT_KEY)).toBeNull();
	});
});

describe('signOutOfGitHub', () => {
	it('forgets the token and the account, and updates the store', async () => {
		localStorage.setItem(TOKEN_KEY, 'browser-token');
		localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ login: 'ada', id: 7 }));

		const { githubConnection, refreshGitHubConnection, signOutOfGitHub } =
			await import('./github-auth.js');
		refreshGitHubConnection();

		const connection = signOutOfGitHub();

		expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
		expect(localStorage.getItem(ACCOUNT_KEY)).toBeNull();
		expect(connection.signedIn).toBe(false);
		expect(get(githubConnection).signedIn).toBe(false);
	});

	it('falls back to the build token rather than leaving the app with none', async () => {
		vi.stubEnv('VITE_GITHUB_TOKEN', 'build-token');
		localStorage.setItem(TOKEN_KEY, 'browser-token');

		const { getGitHubToken, signOutOfGitHub } = await import('./github-auth.js');
		const connection = signOutOfGitHub();

		expect(connection.source).toBe('build');
		expect(getGitHubToken()).toBe('build-token');
	});

	it('does not throw when there is no storage to clear', async () => {
		vi.unstubAllGlobals();
		const { signOutOfGitHub } = await import('./github-auth.js');
		expect(signOutOfGitHub().signedIn).toBe(false);
	});
});
