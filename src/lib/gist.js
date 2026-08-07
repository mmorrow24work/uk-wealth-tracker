/**
 * GitHub Gist persistence — the opt-in, cross-device half of the storage layer (see `README.md` →
 * Persistence modes). The default mode is browser-only storage, `./browser-storage.js`;
 * `./persistence.js` picks between the two and is what `./store.js` actually calls.
 *
 * The whole app state is one `AppData` document (see `./types.js`). This module reads and writes
 * that document as a single JSON file inside a private GitHub Gist, authenticated with the user's
 * own personal access token.
 *
 * **Two things have to be known: who, and where.**
 *
 * - *Who* is `./github-auth.js`'s job. Since issue #62 the normal way to answer it is signing in
 *   from the app (the connect page), which keeps the token in this browser; a token compiled into
 *   the build as `VITE_GITHUB_TOKEN` still works as a fallback for deployments configured before
 *   that existed. Either way, no token means this mode does not exist: `isGistConfigured()` is
 *   false and `./persistence.js` never routes anything here.
 * - *Where* is this module's job. In precedence order: the Gist chosen (or created) in this browser
 *   and cached in `localStorage`, then the build's `VITE_GIST_ID`, and otherwise nowhere yet — in
 *   which case a new private Gist is created on the first save and its id cached. The in-browser id
 *   winning over the build's mirrors how `./persistence.js` lets a remembered mode choice win over
 *   the build's default: what the user picked in the app beats what was compiled in. (No browser
 *   can be carrying both from an earlier build — the cache was only ever written by the
 *   create-if-missing path, which only ran when `VITE_GIST_ID` was unset.)
 *
 * That id cache is the only thing this module keeps in the browser — storing the *document*
 * locally is `./browser-storage.js`'s job, and storing the *token* is `./github-auth.js`'s.
 *
 * The dependency on `./github-auth.js` is one-way: it never imports this module. So the two
 * operations that span both — signing in (which may invalidate a Gist id belonging to the account
 * being replaced) and signing out — compose here, as {@link connectGitHubAccount} and
 * {@link disconnectGitHubAccount}.
 *
 * Because `VITE_`-prefixed env vars are inlined into the client bundle, a build-configured token is
 * visible to anyone who can read the deployed JS. That was acceptable for a single-user,
 * self-hosted app (see `DESIGN.md` → Data Persistence) and still is, but it is exactly what in-app
 * sign-in avoids — a signed-in token never leaves the user's own browser.
 */

import {
	getGitHubToken,
	getStoredAccount,
	signInWithGitHubToken,
	signOutOfGitHub
} from './github-auth.js';
import { createAppData, normaliseAppData } from './model.js';

/**
 * Not re-declared as a local `@typedef` (unlike other `$lib` modules) because `index.js` re-
 * exports every module with `export *`, and TS treats two same-named JSDoc typedefs as an
 * ambiguous re-export even though only `model.js`'s is meant to be the public one.
 * @typedef {import('./types.js').AppData} AppDataDoc
 */

/** Name of the JSON file this app keeps inside the Gist. Fixed — never renamed at runtime. */
const GIST_FILENAME = 'uk-wealth-tracker.json';

/** Description shown on a Gist this app creates for itself. */
const GIST_DESCRIPTION = 'uk-wealth-tracker data — managed by the app, safe to edit by hand';

const GITHUB_API = 'https://api.github.com';

/**
 * `localStorage` key naming the Gist this browser is connected to — one this app created for
 * itself, or one the user pointed it at from the connect page.
 */
export const LOCAL_GIST_ID_KEY = 'uk-wealth-tracker:gist-id';

/**
 * `localStorage` key recording whose account {@link LOCAL_GIST_ID_KEY} belongs to. Not a security
 * boundary — it exists so that signing in as somebody else doesn't leave the app pointed at a Gist
 * that account cannot read (see {@link connectGitHubAccount}).
 */
export const LOCAL_GIST_OWNER_KEY = 'uk-wealth-tracker:gist-owner';

/** Where a Gist id can be opened on github.com. */
const GIST_WEB_BASE = 'https://gist.github.com';

/**
 * Raised for anything that goes wrong talking to a *configured* Gist (network failure, bad
 * token, missing Gist, invalid JSON in the file). Never raised for "no Gist created yet" — that is
 * the create-if-missing path, not an error.
 */
export class GistError extends Error {
	/**
	 * @param {string} message
	 * @param {{ status?: number, cause?: unknown }} [options]
	 */
	constructor(message, { status, cause } = {}) {
		super(message, cause !== undefined ? { cause } : undefined);
		this.name = 'GistError';
		/** HTTP status code, when the failure was an API response rather than e.g. a network error. */
		this.status = status;
	}
}

/**
 * @param {string} key
 * @returns {string | undefined}
 */
function getEnv(key) {
	const value = import.meta.env[key];
	return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The token to authenticate with — the signed-in one, or the build's, whichever
 * `./github-auth.js` says is active. This module never reads `VITE_GITHUB_TOKEN` itself.
 *
 * @returns {string | undefined}
 */
function getToken() {
	return getGitHubToken();
}

/** @returns {string | undefined} */
function getConfiguredGistId() {
	return getEnv('VITE_GIST_ID');
}

/**
 * Whether the app has a GitHub token at all, i.e. whether it should talk to the GitHub API. This is
 * the only gate — the Gist id is optional (see module docs, create-if-missing) — and it is
 * deliberately re-read on every call rather than captured at import: signing in from the connect
 * page makes Gist mode exist without a reload.
 *
 * @returns {boolean}
 */
export function isGistConfigured() {
	return getToken() !== undefined;
}

/* -------------------------------------------------------------------------- */
/* localStorage — the cache for a self-created Gist id                         */
/* -------------------------------------------------------------------------- */

/** @returns {boolean} */
function hasLocalStorage() {
	try {
		return typeof localStorage !== 'undefined' && localStorage !== null;
	} catch {
		return false;
	}
}

/** @returns {string | undefined} */
function getCachedGistId() {
	if (!hasLocalStorage()) return undefined;
	return localStorage.getItem(LOCAL_GIST_ID_KEY) ?? undefined;
}

/**
 * Whose Gist the cached id is, when that was known at the time it was cached. `undefined` covers
 * both "cached before this app recorded owners" and "cached while running on a build token, whose
 * owner this app never asked GitHub about" — neither can be re-derived, so both mean *don't
 * assume*, and {@link connectGitHubAccount} leaves such an id alone.
 *
 * @returns {string | undefined}
 */
function getCachedGistOwner() {
	if (!hasLocalStorage()) return undefined;
	return localStorage.getItem(LOCAL_GIST_OWNER_KEY) ?? undefined;
}

/**
 * @param {string} id
 * @param {string | undefined} [owner] The `login` this Gist belongs to, if known.
 */
function cacheGistId(id, owner = getStoredAccount()?.login) {
	if (!hasLocalStorage()) return;
	try {
		localStorage.setItem(LOCAL_GIST_ID_KEY, id);
		if (owner !== undefined) localStorage.setItem(LOCAL_GIST_OWNER_KEY, owner);
		else localStorage.removeItem(LOCAL_GIST_OWNER_KEY);
	} catch {
		// Storage full or blocked. The save that just happened still landed in the right Gist; only
		// the pointer back to it is lost, and the next save would create a second Gist rather than
		// fail. Not worth failing a successful write over.
	}
}

/**
 * The Gist id in use: the one chosen or created in this browser, else the build's `VITE_GIST_ID`,
 * else `undefined` (meaning: no Gist yet — one is created on first save).
 *
 * @returns {string | undefined}
 */
function getGistId() {
	return getCachedGistId() ?? getConfiguredGistId();
}

/**
 * Which Gist the app will read and write, for UI that has to tell the user *where* their data goes
 * — the second half of "which account/Gist is connected".
 *
 * @returns {{
 * 	id: string | undefined,
 * 	url: string | undefined,
 * 	owner: string | undefined,
 * 	source: 'browser' | 'build' | 'none'
 * }}
 */
export function describeGistTarget() {
	const chosen = getCachedGistId();
	if (chosen !== undefined) {
		return {
			id: chosen,
			url: gistWebUrl(chosen),
			owner: getCachedGistOwner(),
			source: 'browser'
		};
	}
	const configured = getConfiguredGistId();
	if (configured !== undefined) {
		return {
			id: configured,
			url: gistWebUrl(configured),
			owner: undefined,
			source: 'build'
		};
	}
	return { id: undefined, url: undefined, owner: undefined, source: 'none' };
}

/**
 * @param {string} id
 * @returns {string} Where that Gist can be opened on github.com.
 */
export function gistWebUrl(id) {
	return `${GIST_WEB_BASE}/${id}`;
}

/**
 * Accept either a bare Gist id or a Gist URL copied out of the browser's address bar — the id is
 * the last path segment of `https://gist.github.com/<login>/<id>`, and asking someone to extract it
 * by hand is exactly the kind of env-file-editing chore this issue exists to remove.
 *
 * @param {unknown} input
 * @returns {string} The bare id.
 * @throws {RangeError} If it is empty, or not the alphanumeric shape every Gist id has.
 */
export function normaliseGistId(input) {
	const trimmed = typeof input === 'string' ? input.trim() : '';
	if (trimmed === '') throw new RangeError('Enter a Gist id or the URL of a Gist.');

	const withoutQuery = trimmed.split(/[?#]/)[0].replace(/\/+$/, '');
	const id = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
	if (!/^[0-9a-zA-Z]+$/.test(id)) {
		throw new RangeError(
			`"${trimmed}" is not a Gist id. Copy the id from the end of your Gist's URL, or paste the whole URL.`
		);
	}
	return id;
}

/**
 * Point this browser at a specific Gist — an existing one the user already keeps their data in,
 * typically pasted on the connect page.
 *
 * Does **not** check that the Gist exists or is readable; that happens on the next load or save,
 * which is where a wrong id surfaces as a `GistError` the sync banner already shows.
 *
 * @param {unknown} input A Gist id, or the URL of a Gist.
 * @returns {string} The id now in use.
 * @throws {RangeError} As {@link normaliseGistId}.
 */
export function setActiveGistId(input) {
	const id = normaliseGistId(input);
	cacheGistId(id);
	return id;
}

/**
 * Forget which Gist this browser was pointed at. The Gist itself is untouched — deleting the data
 * in it is issue #63's job — so this means "stop syncing here", after which the next save falls
 * back to `VITE_GIST_ID` if the build has one, or creates a fresh private Gist if it doesn't.
 *
 * @returns {void}
 */
export function clearActiveGistId() {
	if (!hasLocalStorage()) return;
	try {
		localStorage.removeItem(LOCAL_GIST_ID_KEY);
		localStorage.removeItem(LOCAL_GIST_OWNER_KEY);
	} catch {
		// Storage blocked mid-session; nothing else to try.
	}
}

/* -------------------------------------------------------------------------- */
/* GitHub API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} path
 * @param {string} token
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
async function githubRequest(path, token, { method = 'GET', body } = {}) {
	/** @type {Response} */
	let response;
	try {
		response = await fetch(`${GITHUB_API}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
			},
			body: body !== undefined ? JSON.stringify(body) : undefined
		});
	} catch (cause) {
		throw new GistError(
			`Could not reach the GitHub API: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause }
		);
	}

	if (!response.ok) {
		let message = `GitHub API request failed with status ${response.status}`;
		try {
			const problem = await response.json();
			if (problem && typeof problem.message === 'string') message += `: ${problem.message}`;
		} catch {
			// Error body wasn't JSON — the generic message above is all we get.
		}
		throw new GistError(message, { status: response.status });
	}

	return response.status === 204 ? null : response.json();
}

/**
 * A Gist file's content, following `raw_url` when GitHub has truncated the inline `content`
 * (files over 1MB) — our documents are small today, but this keeps reads correct if that changes.
 *
 * @param {{ content?: string, truncated?: boolean, raw_url?: string }} file
 * @returns {Promise<string>}
 */
async function readFileContent(file) {
	if (!file.truncated) return file.content ?? '';

	let response;
	try {
		response = await fetch(/** @type {string} */ (file.raw_url));
	} catch (cause) {
		throw new GistError(
			`Could not fetch truncated Gist file content: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause }
		);
	}
	if (!response.ok) {
		throw new GistError(`Could not fetch truncated Gist file content (status ${response.status})`, {
			status: response.status
		});
	}
	return response.text();
}

/**
 * @param {string} token
 * @param {AppDataDoc} data
 * @returns {Promise<string>} The new Gist's id.
 */
async function createGist(token, data) {
	const created = await githubRequest('/gists', token, {
		method: 'POST',
		body: {
			description: GIST_DESCRIPTION,
			public: false,
			files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } }
		}
	});
	cacheGistId(created.id);
	return created.id;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The configured token, or a {@link GistError} explaining that this mode isn't set up. Reaching
 * here without a token means something bypassed `./persistence.js`'s mode check — an error worth
 * surfacing rather than silently doing nothing with the user's data.
 *
 * @returns {string}
 */
function requireToken() {
	const token = getToken();
	if (!token) {
		throw new GistError(
			'GitHub Gist sync is not connected: sign in with GitHub to use it, or stay in browser-only storage mode.'
		);
	}
	return token;
}

/**
 * Load the app's data from the Gist.
 *
 * With a token but no Gist created yet (neither `VITE_GIST_ID` nor a cached id from a prior save),
 * returns a fresh empty document without making a network request — there is nothing to load.
 * Otherwise reads the Gist; a Gist that exists but doesn't yet contain our file (e.g. a
 * hand-created empty Gist used as `VITE_GIST_ID`) also yields a fresh empty document — the file is
 * created on first save.
 *
 * Never throws for "nothing saved yet". Throws {@link GistError} if a Gist *is* configured/created
 * but can't actually be read (bad token, deleted Gist, network failure, invalid JSON in the file),
 * or if this is called at all with no token configured — `./persistence.js` only routes here in
 * Gist mode, which by definition means a token exists.
 *
 * @returns {Promise<AppDataDoc>}
 */
export async function loadAppData() {
	const token = requireToken();

	const gistId = getGistId();
	if (!gistId) return createAppData();

	const gist = await githubRequest(`/gists/${gistId}`, token);
	const file = gist.files?.[GIST_FILENAME];
	if (!file) return createAppData();

	const raw = await readFileContent(file);
	if (raw.trim() === '') return createAppData();

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new GistError(
			`Gist file "${GIST_FILENAME}" does not contain valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause }
		);
	}
	return normaliseAppData(parsed);
}

/**
 * Persist the app's data to the Gist — creating a new private Gist first if none is configured or
 * cached yet (create-if-missing), and relying on the Gist API to create the data file within an
 * existing Gist that doesn't have it (also create-if-missing, for the file rather than the whole
 * Gist).
 *
 * Throws {@link GistError} on any API failure, and if called with no token configured (see
 * {@link loadAppData}).
 *
 * @param {AppDataDoc} data
 * @returns {Promise<void>}
 */
export async function saveAppData(data) {
	const token = requireToken();

	const gistId = getGistId();
	if (!gistId) {
		await createGist(token, data);
		return;
	}

	await githubRequest(`/gists/${gistId}`, token, {
		method: 'PATCH',
		body: { files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } } }
	});
}

/* -------------------------------------------------------------------------- */
/* Connecting an account (the half that spans auth *and* the Gist pointer)     */
/* -------------------------------------------------------------------------- */

/**
 * Sign in and make this browser's Gist pointer consistent with who just signed in.
 *
 * A Gist cached here belongs to the account recorded beside it. If somebody *else* signs in, that
 * pointer is wrong for them: GitHub answers 404 on every read and write of a Gist you don't own,
 * which reads to the user as "my data has vanished" rather than "that Gist isn't yours". Clearing
 * it instead means their first save creates their own private Gist, and the previous account's Gist
 * is left untouched for them to come back to.
 *
 * The comparison is against the *Gist's* recorded owner rather than the previously signed-in
 * account, because the two differ in the ordinary case: signing out clears the account record
 * first, so by the time the next person signs in there is no "previous account" left to compare
 * against. An id with no recorded owner (cached by a build before this existed, or while running on
 * a build token) is left alone — unknown is not the same as different.
 *
 * A build-configured `VITE_GIST_ID` is never cleared either — the app cannot clear it, and a build
 * that names a Gist is naming it for whoever runs that build.
 *
 * @param {unknown} token A GitHub personal access token with the `gist` scope.
 * @returns {Promise<import('./github-auth.js').GitHubAccount>} The account now connected.
 * @throws {import('./github-auth.js').GitHubAuthError} If the token is empty, malformed, rejected
 *   by GitHub, without the `gist` scope, or this browser refuses to remember it.
 */
export async function connectGitHubAccount(token) {
	const owner = getCachedGistOwner();
	const account = await signInWithGitHubToken(token);
	if (owner !== undefined && owner !== account.login) clearActiveGistId();
	return account;
}

/**
 * Sign out of GitHub, keeping the Gist pointer.
 *
 * Deliberately *not* symmetrical with {@link connectGitHubAccount}: forgetting which Gist held the
 * data would mean signing back in as the same person created a second, empty Gist and silently
 * orphaned the first. The token is the secret worth dropping; the id is a bookmark, and the connect
 * page shows it either way so it is never a hidden one.
 *
 * @returns {import('./github-auth.js').GitHubConnection} The connection after signing out.
 */
export function disconnectGitHubAccount() {
	return signOutOfGitHub();
}
