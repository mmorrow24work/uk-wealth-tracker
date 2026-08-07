/**
 * GitHub sign-in for Gist persistence mode (issue #62) — the credential and the identity behind it.
 *
 * Gist sync used to be configurable only by writing `VITE_GITHUB_TOKEN` into `.env.local` and
 * rebuilding, which on a GitHub Pages deployment means editing a file and pushing a commit to
 * change who the app is signed in as. This module replaces that with an in-app sign-in: the user
 * pastes a personal access token once, the app verifies it against the GitHub API, and both the
 * token and the account it belongs to are kept **in this browser only**.
 *
 * Division of labour:
 *
 * - This module owns the *credential* (`uk-wealth-tracker:github-token`) and the *identity* it
 *   resolves to (`uk-wealth-tracker:github-account`). It knows nothing about Gists.
 * - `./gist.js` owns *which Gist* the data lives in, and asks this module for a token. The
 *   dependency is one-way — this module never imports `./gist.js` — so the two sign-in composites
 *   that need both halves (`connectGitHubAccount`/`disconnectGitHubAccount`) live there, not here.
 *
 * **Why a pasted token and not the OAuth device flow**, which the issue offers as the first option:
 * GitHub's device-flow endpoints (`https://github.com/login/device/code` and
 * `/login/oauth/access_token`) send no `Access-Control-Allow-Origin` header, so a browser cannot
 * call them from a page at all — the exchange has to happen on a server. This app is a static
 * GitHub Pages build with no backend by design (`DESIGN.md` → Hosting), and standing one up to
 * proxy the token exchange would undo that. The issue anticipates this and allows "at minimum a PAT
 * -entry screen"; that is what this is.
 *
 * **Where the token lives, and what that does and doesn't protect.** `localStorage`, same origin as
 * the app, never a cookie and never sent to any host but `api.github.com`. That means:
 *
 * - It survives a reload and a closed tab (a `sessionStorage` token would have to be re-pasted
 *   every session, for a personal app used on the user's own devices).
 * - It is readable by any script running on this origin — i.e. an XSS on this app is a token
 *   disclosure. There is no client-only storage that isn't; the mitigation is the token's own
 *   scope (`gist` alone, which reaches nothing else in the account) and the user being able to
 *   revoke it from GitHub at any time.
 * - It is *not* logged. Nothing here writes the token to the console, and {@link redactToken}
 *   scrubs it out of every error message this module raises before that message can reach a UI or
 *   an error report.
 *
 * A token compiled into the build via `VITE_GITHUB_TOKEN` still works — existing deployments keep
 * running — but it is now the *fallback*, used only when nobody has signed in on this browser.
 *
 * SSR-safe: nothing here touches `localStorage` at import time (the GitHub Pages build prerenders
 * every route). {@link githubConnection} therefore starts signed-out on both server and client;
 * call {@link refreshGitHubConnection} from `onMount` to read the real state in.
 */

import { writable } from 'svelte/store';

/** `localStorage` key holding the signed-in user's personal access token. */
export const GITHUB_TOKEN_KEY = 'uk-wealth-tracker:github-token';

/** `localStorage` key holding the account that token was verified as belonging to. */
export const GITHUB_ACCOUNT_KEY = 'uk-wealth-tracker:github-account';

/** The one OAuth scope this app needs: read/write access to the signed-in user's own Gists. */
export const GIST_SCOPE = 'gist';

const GITHUB_API = 'https://api.github.com';

/**
 * Raised for anything that stops a token being accepted: an empty or malformed paste, GitHub
 * rejecting it, a token without the `gist` scope, an unreachable API, or a browser that won't let
 * the app remember it. Its `message` is always safe to show a user and never contains the token
 * itself (see {@link redactToken}).
 */
export class GitHubAuthError extends Error {
	/**
	 * @param {string} message
	 * @param {{ status?: number, cause?: unknown }} [options]
	 */
	constructor(message, { status, cause } = {}) {
		super(message, cause !== undefined ? { cause } : undefined);
		this.name = 'GitHubAuthError';
		/** HTTP status code, when the failure was an API response rather than e.g. a network error. */
		this.status = status;
	}
}

/**
 * @typedef {object} GitHubAccount
 * @property {string} login The `@handle` — what the UI shows as "who is connected".
 * @property {number} id GitHub's own numeric user id, stable across a rename of `login`.
 * @property {string | null} name Display name, if the account has one set.
 * @property {string[]} scopes Scopes GitHub reported for the token; empty when it didn't report any.
 * @property {boolean} scopes_known Whether GitHub reported scopes at all — fine-grained tokens
 *   don't, so an empty `scopes` means "not stated", not "none". See {@link verifyGitHubToken}.
 * @property {string} connected_at ISO timestamp of the sign-in that stored this record.
 */

/**
 * @typedef {object} GitHubConnection
 * @property {'browser' | 'build' | 'none'} source Where the active token comes from: pasted into
 *   this browser, compiled into the build via `VITE_GITHUB_TOKEN`, or nowhere.
 * @property {boolean} hasToken Whether there is a usable token at all, from either source.
 * @property {boolean} signedIn Whether that token came from an in-app sign-in specifically.
 * @property {GitHubAccount | null} account The verified account, known only for `source: 'browser'`
 *   (a build token was never presented to GitHub by this app, so nobody has checked whose it is).
 */

/** @type {GitHubConnection} */
const SIGNED_OUT = { source: 'none', hasToken: false, signedIn: false, account: null };

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Accessing `localStorage` can *throw* rather than be undefined (Safari's "block all cookies",
 * some enterprise policies), so this is a try/catch rather than a `typeof` check alone — the same
 * guard `./browser-storage.js` uses.
 *
 * @returns {boolean}
 */
function hasLocalStorage() {
	try {
		return typeof localStorage !== 'undefined' && localStorage !== null;
	} catch {
		return false;
	}
}

/**
 * @param {string} key
 * @returns {string | undefined}
 */
function readKey(key) {
	if (!hasLocalStorage()) return undefined;
	try {
		return localStorage.getItem(key) ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * The token pasted into this browser, if any. Not the build's `VITE_GITHUB_TOKEN` — that is
 * {@link getBuildToken}, and {@link getGitHubToken} is the one nearly everything wants.
 *
 * @returns {string | undefined}
 */
export function getStoredToken() {
	const token = readKey(GITHUB_TOKEN_KEY);
	return token !== undefined && token !== '' ? token : undefined;
}

/**
 * The token compiled into this build, if any. `VITE_`-prefixed env vars are inlined into the client
 * bundle, so this is visible to anyone who can read the deployed JS — which is precisely why
 * in-app sign-in exists and this is only the fallback.
 *
 * @returns {string | undefined}
 */
export function getBuildToken() {
	const value = import.meta.env.VITE_GITHUB_TOKEN;
	return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The token the app should actually authenticate with: the signed-in one, else the build's.
 *
 * @returns {string | undefined}
 */
export function getGitHubToken() {
	return getStoredToken() ?? getBuildToken();
}

/**
 * The account record stored at sign-in, or `null` if nobody is signed in (or the record is
 * unreadable — corrupt JSON is treated as "not signed in" rather than crashing the page).
 *
 * @returns {GitHubAccount | null}
 */
export function getStoredAccount() {
	const raw = readKey(GITHUB_ACCOUNT_KEY);
	if (raw === undefined || raw === '') return null;
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed.login !== 'string') return null;
		return {
			login: parsed.login,
			id: typeof parsed.id === 'number' ? parsed.id : 0,
			name: typeof parsed.name === 'string' ? parsed.name : null,
			scopes: Array.isArray(parsed.scopes)
				? parsed.scopes.filter((/** @type {unknown} */ scope) => typeof scope === 'string')
				: [],
			scopes_known: parsed.scopes_known === true,
			connected_at: typeof parsed.connected_at === 'string' ? parsed.connected_at : ''
		};
	} catch {
		return null;
	}
}

/** @returns {boolean} Whether a token was pasted into this browser (as opposed to compiled in). */
export function isGitHubSignedIn() {
	return getStoredToken() !== undefined;
}

/** @returns {boolean} Whether the app has a token from either source. */
export function hasGitHubToken() {
	return getGitHubToken() !== undefined;
}

/**
 * A snapshot of who is connected right now, read straight from storage. Synchronous, so a template
 * can render the header's "Connect GitHub" vs "@octocat" without awaiting anything.
 *
 * @returns {GitHubConnection}
 */
export function describeGitHubConnection() {
	if (isGitHubSignedIn()) {
		return { source: 'browser', hasToken: true, signedIn: true, account: getStoredAccount() };
	}
	if (getBuildToken() !== undefined) {
		return { source: 'build', hasToken: true, signedIn: false, account: null };
	}
	return SIGNED_OUT;
}

/**
 * The connection as a store, so the nav shell and the connect page both re-render the moment
 * someone signs in or out. Starts signed-out (storage isn't readable during SSR/prerender) — call
 * {@link refreshGitHubConnection} once on mount, which every sign-in/sign-out below also does.
 *
 * @type {import('svelte/store').Writable<GitHubConnection>}
 */
export const githubConnection = writable(SIGNED_OUT);

/**
 * Re-read storage into {@link githubConnection}.
 *
 * @returns {GitHubConnection} The snapshot now in the store.
 */
export function refreshGitHubConnection() {
	const connection = describeGitHubConnection();
	githubConnection.set(connection);
	return connection;
}

/* -------------------------------------------------------------------------- */
/* Verification against the GitHub API                                         */
/* -------------------------------------------------------------------------- */

/**
 * Strip a token out of a message before it is ever shown, logged or reported. GitHub's own error
 * bodies don't echo credentials back, but a `TypeError` from `fetch` — or some future caller — may
 * well include whatever it was handed, and "the token must never be logged" is only true if it is
 * true of the unhappy paths too.
 *
 * @param {string} message
 * @param {string} token
 * @returns {string}
 */
export function redactToken(message, token) {
	return token === '' ? message : message.split(token).join('[redacted token]');
}

/**
 * Reject a paste that cannot be a token before spending a network round-trip on it. Deliberately
 * shape-agnostic beyond "non-empty, no whitespace": GitHub has shipped at least three token formats
 * (40-char hex, `ghp_…`, `github_pat_…`) and a regex over the current ones would reject the next.
 *
 * @param {unknown} token
 * @returns {string} The trimmed token.
 * @throws {GitHubAuthError}
 */
function requireTokenShape(token) {
	const trimmed = typeof token === 'string' ? token.trim() : '';
	if (trimmed === '') {
		throw new GitHubAuthError('Enter a GitHub personal access token.');
	}
	if (/\s/.test(trimmed)) {
		throw new GitHubAuthError(
			'That token contains spaces or line breaks — paste just the token itself.'
		);
	}
	return trimmed;
}

/**
 * Scopes GitHub reported for a token, from the `X-OAuth-Scopes` response header.
 *
 * Absent header → `known: false`. Fine-grained personal access tokens carry permissions rather than
 * OAuth scopes and GitHub sends no such header for them, so "no header" must not be read as "no
 * access" — the app finds out for real when it first reads or writes the Gist.
 *
 * @param {Headers | undefined} headers
 * @returns {{ scopes: string[], known: boolean }}
 */
function readScopes(headers) {
	const raw = headers?.get?.('x-oauth-scopes');
	if (raw === null || raw === undefined) return { scopes: [], known: false };
	return {
		scopes: raw
			.split(',')
			.map((scope) => scope.trim())
			.filter((scope) => scope !== ''),
		known: true
	};
}

/**
 * Ask GitHub who a token belongs to, and whether it can touch Gists.
 *
 * The only request this app makes with a token it hasn't accepted yet, and the only one that reads
 * response *headers* — which is why it doesn't share `./gist.js`'s request helper.
 *
 * @param {unknown} token
 * @returns {Promise<Omit<GitHubAccount, 'connected_at'>>}
 * @throws {GitHubAuthError} Token empty/malformed, rejected by GitHub, missing the `gist` scope, or
 *   the API unreachable.
 */
export async function verifyGitHubToken(token) {
	const trimmed = requireTokenShape(token);

	/** @type {Response} */
	let response;
	try {
		response = await fetch(`${GITHUB_API}/user`, {
			headers: {
				Authorization: `Bearer ${trimmed}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28'
			}
		});
	} catch (cause) {
		throw new GitHubAuthError(
			redactToken(
				`Could not reach the GitHub API: ${cause instanceof Error ? cause.message : String(cause)}`,
				trimmed
			),
			{ cause }
		);
	}

	if (response.status === 401) {
		throw new GitHubAuthError(
			'GitHub rejected that token. Check it was copied in full and has not expired or been revoked.',
			{ status: 401 }
		);
	}
	if (!response.ok) {
		let message = `GitHub would not confirm that token (status ${response.status})`;
		try {
			const problem = await response.json();
			if (problem && typeof problem.message === 'string') message += `: ${problem.message}`;
		} catch {
			// Error body wasn't JSON — the generic message above is all we get.
		}
		throw new GitHubAuthError(redactToken(message, trimmed), { status: response.status });
	}

	let user;
	try {
		user = await response.json();
	} catch (cause) {
		throw new GitHubAuthError('GitHub returned something that was not an account.', { cause });
	}
	if (!user || typeof user.login !== 'string') {
		throw new GitHubAuthError('GitHub returned something that was not an account.');
	}

	const { scopes, known } = readScopes(response.headers);
	if (known && !scopes.includes(GIST_SCOPE)) {
		throw new GitHubAuthError(
			`That token does not have the "${GIST_SCOPE}" scope, so it cannot read or write your Gists. Create a new token with that scope ticked.`
		);
	}

	return {
		login: user.login,
		id: typeof user.id === 'number' ? user.id : 0,
		name: typeof user.name === 'string' ? user.name : null,
		scopes,
		scopes_known: known
	};
}

/* -------------------------------------------------------------------------- */
/* Sign in / sign out                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Verify a token and, only if GitHub accepts it, remember it and the account it belongs to in this
 * browser. Nothing is stored for a token that failed verification — a bad paste leaves the previous
 * sign-in (if any) exactly as it was.
 *
 * Callers should generally use `connectGitHubAccount` in `./gist.js` instead, which does this *and*
 * handles the Gist pointer when the account changes.
 *
 * @param {unknown} token
 * @returns {Promise<GitHubAccount>}
 * @throws {GitHubAuthError} As {@link verifyGitHubToken}, plus when this browser refuses to store
 *   anything (a sign-in that cannot be remembered is not a sign-in).
 */
export async function signInWithGitHubToken(token) {
	const trimmed = requireTokenShape(token);
	const verified = await verifyGitHubToken(trimmed);

	/** @type {GitHubAccount} */
	const account = { ...verified, connected_at: new Date().toISOString() };

	if (!hasLocalStorage()) {
		throw new GitHubAuthError(
			'This browser will not let the app store anything, so it cannot stay signed in. Enable site data (or leave private browsing) and try again.'
		);
	}
	try {
		localStorage.setItem(GITHUB_TOKEN_KEY, trimmed);
		localStorage.setItem(GITHUB_ACCOUNT_KEY, JSON.stringify(account));
	} catch (cause) {
		// Half-written state would leave a token with no account beside it; clear both back out.
		try {
			localStorage.removeItem(GITHUB_TOKEN_KEY);
			localStorage.removeItem(GITHUB_ACCOUNT_KEY);
		} catch {
			// Nothing further to try — the throw below is the honest outcome either way.
		}
		throw new GitHubAuthError(
			`Could not save the sign-in to this browser: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause }
		);
	}

	refreshGitHubConnection();
	return account;
}

/**
 * Forget the token and the account record. Local only — it does not revoke the token at GitHub
 * (only the user can, from https://github.com/settings/tokens) and it deletes no data, in the Gist
 * or in this browser. Deleting stored data is issue #63's job.
 *
 * @returns {GitHubConnection} The connection after signing out.
 */
export function signOutOfGitHub() {
	if (hasLocalStorage()) {
		try {
			localStorage.removeItem(GITHUB_TOKEN_KEY);
			localStorage.removeItem(GITHUB_ACCOUNT_KEY);
		} catch {
			// Storage blocked mid-session. Nothing readable was left behind that we could remove.
		}
	}
	return refreshGitHubConnection();
}
