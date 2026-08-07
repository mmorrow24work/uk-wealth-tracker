/**
 * Server-rendered smoke tests for the GitHub connection panel (issue #62).
 *
 * As every other component test in this repo documents: there is no browser test environment here,
 * so `svelte/server`'s `render` covers the initial render only — which state the panel is showing,
 * and that it names both halves of "who and where" the issue asks to be made clear. The sign-in
 * click path itself (`connectGitHubAccount` → `setPersistenceMode` → `hydrateAppData`) is covered
 * by `$lib/github-auth.test.js` and `$lib/gist.test.js` at the module level, and by driving the
 * real page in a browser (see this issue's journal entry).
 *
 * The panel reads its state from the `githubConnection` store rather than props, so these tests set
 * that store — the same thing `refreshGitHubConnection()` does in the app — instead of stubbing
 * `localStorage` for the connection half. The *Gist* half is plain `localStorage`, so that half is
 * stubbed.
 */
import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { githubConnection } from '$lib/github-auth.js';
import GitHubSignIn from './GitHubSignIn.svelte';

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

/** @returns {string} */
function text() {
	const { body } = render(GitHubSignIn);
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, ' ');
}

/** @returns {string} The raw markup, for asserting on attributes rather than visible text. */
function markup() {
	return render(GitHubSignIn).body;
}

beforeEach(() => {
	vi.stubGlobal('localStorage', createMemoryStorage());
	githubConnection.set({ source: 'none', hasToken: false, signedIn: false, account: null });
});

afterEach(() => {
	vi.unstubAllGlobals();
	githubConnection.set({ source: 'none', hasToken: false, signedIn: false, account: null });
});

describe('signed out', () => {
	it('offers a token entry form and says where the data is going meanwhile', () => {
		const body = text();
		expect(body).toContain('Not signed in');
		expect(body).toContain('GitHub personal access token');
		expect(body).toContain('Connect GitHub');
		expect(body).toContain('Saved to this browser only');
	});

	it('links to a pre-scoped token creation page rather than making the user find the scope', () => {
		expect(markup()).toContain(
			'https://github.com/settings/tokens/new?scopes=gist&amp;description=uk-wealth-tracker'
		);
	});

	it('never renders the token in a readable field', () => {
		// The one input that takes a secret is a password field with autocomplete off, and nothing
		// echoes it back — the panel holds no token at all once sign-in succeeds.
		const body = markup();
		expect(body).toContain('id="github-token"');
		expect(body).toContain('type="password"');
		expect(body).toContain('autocomplete="off"');
	});

	it('says the app has no Gist yet', () => {
		expect(text()).toContain('No Gist chosen yet');
	});
});

describe('signed in', () => {
	beforeEach(() => {
		githubConnection.set({
			source: 'browser',
			hasToken: true,
			signedIn: true,
			account: {
				login: 'octocat',
				id: 583231,
				name: 'The Octocat',
				scopes: ['gist'],
				scopes_known: true,
				connected_at: '2026-08-07T09:00:00.000Z'
			}
		});
	});

	it('names the connected account, which is the whole point of the issue', () => {
		const body = text();
		expect(body).toContain('Signed in as @octocat');
		expect(body).toContain('The Octocat');
		expect(body).toContain('Token scopes: gist');
	});

	it('offers signing out instead of signing in', () => {
		const body = text();
		expect(body).toContain('Sign out');
		expect(body).not.toContain('GitHub personal access token');
	});

	it('explains that signing out deletes nothing', () => {
		expect(text()).toContain('Nothing is deleted');
	});

	it('names the connected Gist and links to it', () => {
		localStorage.setItem('uk-wealth-tracker:gist-id', 'aa11bb22cc33');
		const body = markup();
		expect(body).toContain('https://gist.github.com/aa11bb22cc33');
		expect(body).toContain('aa11bb22cc33');
	});

	it('says so plainly when GitHub reported no scopes (a fine-grained token)', () => {
		githubConnection.set({
			source: 'browser',
			hasToken: true,
			signedIn: true,
			account: {
				login: 'ada',
				id: 7,
				name: null,
				scopes: [],
				scopes_known: false,
				connected_at: '2026-08-07T09:00:00.000Z'
			}
		});
		expect(text()).toContain('GitHub reported no scopes for this token');
	});
});

describe('a build with a token compiled in', () => {
	it('says the token is the build’s, and that signing in replaces it', () => {
		githubConnection.set({ source: 'build', hasToken: true, signedIn: false, account: null });
		const body = text();
		expect(body).toContain('Using a token compiled into this build');
		expect(body).toContain('anyone who can read the deployed JavaScript can read that token');
		expect(body).toContain('Check whose token it is');
	});
});

describe('the security note', () => {
	it('states where the token lives and where it is sent', () => {
		const body = text();
		expect(body).toContain("kept in this browser's own storage");
		expect(body).toContain('api.github.com');
		expect(body).toContain('never written to the console');
	});
});
