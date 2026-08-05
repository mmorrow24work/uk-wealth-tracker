/**
 * GitHub Gist persistence — the app's only storage layer (see `CLAUDE.md` → Architecture).
 *
 * The whole app state is one `AppData` document (see `./types.js`). This module reads and
 * writes that document as a single JSON file inside a private GitHub Gist, authenticated with a
 * personal access token. Two env vars configure it (see `.env.example`):
 *
 * - `VITE_GITHUB_TOKEN` — a token with the `gist` scope.
 * - `VITE_GIST_ID` — an existing Gist to use. Optional: if a token is set but this isn't, a new
 *   private Gist is created on first save and its id cached in `localStorage` so later sessions
 *   in the same browser reuse it (Vite env vars are build-time, so the app has no other way to
 *   remember an id it generated itself).
 *
 * With no token configured at all (typical local dev without Gist setup), everything falls back
 * to `localStorage` so the app is fully usable without any GitHub setup.
 *
 * Because `VITE_`-prefixed env vars are inlined into the client bundle, the token is visible to
 * anyone who can read the deployed JS — acceptable here because this is a single-user,
 * self-hosted, personal-use app (see `DESIGN.md` → Data Persistence), not a design to reuse for
 * anything multi-tenant.
 */

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

/** `localStorage` key for the fallback copy of the document. */
const LOCAL_DATA_KEY = 'uk-wealth-tracker:data';

/** `localStorage` key caching a Gist id this app created (when `VITE_GIST_ID` isn't set). */
const LOCAL_GIST_ID_KEY = 'uk-wealth-tracker:gist-id';

/**
 * Raised for anything that goes wrong talking to a *configured* Gist (network failure, bad
 * token, missing Gist, invalid JSON in the file). Never raised for "nothing configured yet" —
 * that is the `localStorage`/create-if-missing path, not an error.
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

/** @returns {string | undefined} */
function getToken() {
	return getEnv('VITE_GITHUB_TOKEN');
}

/** @returns {string | undefined} */
function getConfiguredGistId() {
	return getEnv('VITE_GIST_ID');
}

/**
 * Whether a token is configured, i.e. the app should talk to the GitHub API at all. This is the
 * only gate — `VITE_GIST_ID` is optional (see module docs, create-if-missing).
 *
 * @returns {boolean}
 */
export function isGistConfigured() {
	return getToken() !== undefined;
}

/**
 * Which storage this module is currently backed by — for UI that wants to show the user where
 * their data lives (e.g. a "synced to Gist" vs "saved locally only" indicator).
 *
 * @returns {'gist' | 'local'}
 */
export function getPersistenceMode() {
	return isGistConfigured() ? 'gist' : 'local';
}

/* -------------------------------------------------------------------------- */
/* localStorage — fallback storage, and the cache for a self-created Gist id  */
/* -------------------------------------------------------------------------- */

/** @returns {boolean} */
function hasLocalStorage() {
	try {
		return typeof localStorage !== 'undefined';
	} catch {
		return false;
	}
}

/** @returns {AppDataDoc} */
function loadFromLocalStorage() {
	const raw = hasLocalStorage() ? localStorage.getItem(LOCAL_DATA_KEY) : null;
	if (!raw) return createAppData();
	try {
		return normaliseAppData(JSON.parse(raw));
	} catch {
		// Corrupt localStorage (hand-edited, truncated write, old format) — start fresh rather
		// than blocking the app from loading at all.
		return createAppData();
	}
}

/** @param {AppDataDoc} data */
function saveToLocalStorage(data) {
	if (!hasLocalStorage()) return;
	localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(data));
}

/** @returns {string | undefined} */
function getCachedGistId() {
	if (!hasLocalStorage()) return undefined;
	return localStorage.getItem(LOCAL_GIST_ID_KEY) ?? undefined;
}

/** @param {string} id */
function cacheGistId(id) {
	if (!hasLocalStorage()) return;
	localStorage.setItem(LOCAL_GIST_ID_KEY, id);
}

/**
 * The Gist id to use: the configured one if set, otherwise one this app previously created for
 * itself, otherwise `undefined` (meaning: not created yet).
 *
 * @returns {string | undefined}
 */
function getGistId() {
	return getConfiguredGistId() ?? getCachedGistId();
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
 * Load the app's data.
 *
 * With no token configured, reads from `localStorage`. With a token but no Gist created yet
 * (neither `VITE_GIST_ID` nor a cached id from a prior save), returns a fresh empty document
 * without making a network request — there is nothing to load. Otherwise reads the Gist; a Gist
 * that exists but doesn't yet contain our file (e.g. a hand-created empty Gist used as
 * `VITE_GIST_ID`) also yields a fresh empty document — the file is created on first save.
 *
 * Never throws for "nothing saved yet". Throws {@link GistError} if a Gist *is* configured/created
 * but can't actually be read (bad token, deleted Gist, network failure, invalid JSON in the file).
 *
 * @returns {Promise<AppDataDoc>}
 */
export async function loadAppData() {
	const token = getToken();
	if (!token) return loadFromLocalStorage();

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
 * Persist the app's data.
 *
 * With no token configured, writes to `localStorage`. With a token, writes to the Gist —
 * creating a new private Gist first if none is configured or cached yet (create-if-missing), and
 * relying on the Gist API to create the data file within an existing Gist that doesn't have it
 * (also create-if-missing, for the file rather than the whole Gist).
 *
 * @param {AppDataDoc} data
 * @returns {Promise<void>}
 */
export async function saveAppData(data) {
	const token = getToken();
	if (!token) {
		saveToLocalStorage(data);
		return;
	}

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
