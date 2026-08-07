/**
 * Browser-only persistence — the app's default storage mode (see `DESIGN.md` → Data Persistence).
 *
 * Reads and writes the same `AppData` document (`./types.js`) `gist.js` does, but entirely on the
 * device: **IndexedDB** as the primary store, **`localStorage`** as the fallback for the browsers
 * and modes where IndexedDB isn't there or refuses to open (private browsing, storage disabled by
 * policy, older browsers). No token, no network, no setup — which is why this, not Gist sync, is
 * the mode a fresh visitor lands in (`./persistence.js` decides).
 *
 * The document is stored as a **JSON string** in both backends, not as a structured-clone object:
 * it's the same bytes the Gist file would hold, so a document can move between modes (and through
 * JSON export/import) unchanged, and nothing in the document ever has to be structured-cloneable.
 *
 * Everything read back goes through `migrateAppData` (`./model.js`) — a document written by an
 * older build, or hand-edited in devtools, still loads.
 *
 * SSR-safe: no `window`, `localStorage` or `indexedDB` is touched at import time, only inside the
 * functions below (the GitHub Pages build prerenders every route).
 */

import { createAppData, migrateAppData } from './model.js';

/**
 * Not re-declared as a local `@typedef` (unlike other `$lib` modules) because `index.js` re-exports
 * modules with `export *`, and TS treats two same-named JSDoc typedefs as an ambiguous re-export
 * even though only `model.js`'s is meant to be the public one — the same workaround `gist.js` uses.
 * @typedef {import('./types.js').AppData} AppDataDoc
 */

/** IndexedDB database this app keeps its document in. */
const DB_NAME = 'uk-wealth-tracker';

/** Bump only alongside an `onupgradeneeded` step that migrates the *store layout*, not the document. */
const DB_VERSION = 1;

/** Object store within {@link DB_NAME}. One store, one record — this is a document, not a table. */
const STORE_NAME = 'app-data';

/** Key of the single record inside {@link STORE_NAME}. */
const DOCUMENT_KEY = 'document';

/**
 * `localStorage` key for the fallback copy. Deliberately the same key `gist.js` used for its own
 * (now removed) local fallback, so a browser that already has data saved by an earlier build keeps
 * it: the first load here finds nothing in IndexedDB, adopts this copy, and the next save promotes
 * it into IndexedDB.
 */
export const LOCAL_DATA_KEY = 'uk-wealth-tracker:data';

/**
 * Raised when browser storage genuinely fails — a write neither backend would accept (quota
 * exceeded, storage disabled mid-session), or a read that errored with no fallback left to try.
 * Never raised for "nothing stored yet": a first visit is an empty document, not an error.
 */
export class BrowserStorageError extends Error {
	/**
	 * @param {string} message
	 * @param {{ cause?: unknown }} [options]
	 */
	constructor(message, { cause } = {}) {
		super(message, cause !== undefined ? { cause } : undefined);
		this.name = 'BrowserStorageError';
	}
}

/* -------------------------------------------------------------------------- */
/* localStorage — the fallback backend                                         */
/* -------------------------------------------------------------------------- */

/**
 * Accessing `localStorage` can *throw* rather than be undefined (Safari's "block all cookies",
 * some enterprise policies), so this is a try/catch rather than a `typeof` check alone.
 *
 * @returns {boolean}
 */
export function hasLocalStorage() {
	try {
		return typeof localStorage !== 'undefined' && localStorage !== null;
	} catch {
		return false;
	}
}

/**
 * @param {string} raw
 * @returns {AppDataDoc}
 */
function parseDocument(raw) {
	if (raw.trim() === '') return createAppData();
	try {
		return migrateAppData(JSON.parse(raw));
	} catch {
		// Corrupt storage (hand-edited in devtools, a truncated write, a half-cleared origin) —
		// start fresh rather than blocking the app from loading at all. `migrateAppData` itself
		// never throws, so only `JSON.parse` gets here.
		return createAppData();
	}
}

/** @returns {AppDataDoc} */
function loadFromLocalStorage() {
	if (!hasLocalStorage()) return createAppData();
	/** @type {string | null} */
	let raw;
	try {
		raw = localStorage.getItem(LOCAL_DATA_KEY);
	} catch {
		return createAppData();
	}
	return raw === null ? createAppData() : parseDocument(raw);
}

/**
 * @param {string} raw Serialised document.
 * @returns {boolean} Whether it was stored — `false` means there is no `localStorage` here at all.
 * @throws {BrowserStorageError} If `localStorage` exists but rejected the write (quota).
 */
function saveToLocalStorage(raw) {
	if (!hasLocalStorage()) return false;
	try {
		localStorage.setItem(LOCAL_DATA_KEY, raw);
		return true;
	} catch (cause) {
		throw new BrowserStorageError(
			`Could not save to localStorage: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause }
		);
	}
}

/* -------------------------------------------------------------------------- */
/* IndexedDB — the primary backend                                             */
/* -------------------------------------------------------------------------- */

/**
 * Cached open attempt, so a burst of saves doesn't reopen the database each time. Holds the
 * *promise*, including one that resolved to `null` (IndexedDB unavailable) — re-probing an
 * environment that already refused once would fail identically every time.
 *
 * @type {Promise<IDBDatabase | null> | undefined}
 */
let databasePromise;

/**
 * Open (and if needed create) the database, resolving to `null` — never rejecting — whenever
 * IndexedDB can't be used, so every caller falls through to `localStorage` instead. Covers: no
 * `indexedDB` global at all (SSR, ancient browsers), `open()` throwing synchronously (Firefox
 * private windows raise `SecurityError`), the request erroring, and the request being blocked by
 * another tab holding an older version open.
 *
 * @returns {Promise<IDBDatabase | null>}
 */
function openDatabase() {
	if (databasePromise) return databasePromise;

	databasePromise = new Promise((resolve) => {
		/** @type {IDBOpenDBRequest} */
		let request;
		try {
			if (typeof indexedDB === 'undefined' || indexedDB === null) {
				resolve(null);
				return;
			}
			request = indexedDB.open(DB_NAME, DB_VERSION);
		} catch {
			resolve(null);
			return;
		}

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
		// Another tab is holding an older version open and won't let this upgrade through. Falling
		// back to `localStorage` keeps that tab working rather than hanging on a request that may
		// never settle.
		request.onblocked = () => resolve(null);
	});

	return databasePromise;
}

/**
 * @param {IDBDatabase} db
 * @returns {Promise<string | null>} The stored JSON, or `null` when nothing is stored yet.
 */
function readFromDatabase(db) {
	return new Promise((resolve, reject) => {
		let request;
		try {
			request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(DOCUMENT_KEY);
		} catch (cause) {
			reject(cause);
			return;
		}
		request.onsuccess = () => {
			const value = request.result;
			resolve(
				typeof value === 'string'
					? value
					: value === undefined || value === null
						? null
						: String(value)
			);
		};
		request.onerror = () => reject(request.error);
	});
}

/**
 * Resolves once the write is *committed*, not merely queued — `transaction.oncomplete` rather than
 * `request.onsuccess`, so a caller that closes the tab right after `await` isn't racing a
 * transaction that hasn't landed.
 *
 * @param {IDBDatabase} db
 * @param {string} raw Serialised document.
 * @returns {Promise<void>}
 */
function writeToDatabase(db, raw) {
	return new Promise((resolve, reject) => {
		/** @type {IDBTransaction} */
		let transaction;
		try {
			transaction = db.transaction(STORE_NAME, 'readwrite');
			transaction.objectStore(STORE_NAME).put(raw, DOCUMENT_KEY);
		} catch (cause) {
			reject(cause);
			return;
		}
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}

/**
 * Remove the record, resolving on `transaction.oncomplete` for the same reason {@link writeToDatabase}
 * does — "deleted" has to mean committed, not queued, or a wipe followed by closing the tab could
 * leave the document behind.
 *
 * @param {IDBDatabase} db
 * @returns {Promise<void>}
 */
function deleteFromDatabase(db) {
	return new Promise((resolve, reject) => {
		/** @type {IDBTransaction} */
		let transaction;
		try {
			transaction = db.transaction(STORE_NAME, 'readwrite');
			transaction.objectStore(STORE_NAME).delete(DOCUMENT_KEY);
		} catch (cause) {
			reject(cause);
			return;
		}
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}

/* -------------------------------------------------------------------------- */
/* Public API — the same load/save contract `gist.js` exposes                  */
/* -------------------------------------------------------------------------- */

/**
 * Which backend this browser will actually use. For UI that wants to tell the user where their
 * data lives, and for tests. Asynchronous because "is IndexedDB usable" can only be answered by
 * trying to open it.
 *
 * @returns {Promise<'indexeddb' | 'localstorage' | 'none'>}
 */
export async function browserStorageBackend() {
	if (await openDatabase()) return 'indexeddb';
	return hasLocalStorage() ? 'localstorage' : 'none';
}

/**
 * Load the app's data from this browser.
 *
 * Reads IndexedDB; if there is no record yet, falls back to the `localStorage` copy (which is both
 * the fallback backend and where builds before this one kept their data), and to a fresh empty
 * document when neither has anything. Nothing stored yet is never an error.
 *
 * A read that *fails* (rather than finds nothing) falls back to `localStorage` too rather than
 * blocking the app; {@link BrowserStorageError} is thrown only when there is no fallback to try.
 *
 * @returns {Promise<AppDataDoc>}
 */
export async function loadAppData() {
	const db = await openDatabase();
	if (!db) return loadFromLocalStorage();

	/** @type {string | null} */
	let raw;
	try {
		raw = await readFromDatabase(db);
	} catch (cause) {
		if (!hasLocalStorage()) {
			throw new BrowserStorageError(
				`Could not read from IndexedDB: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause }
			);
		}
		return loadFromLocalStorage();
	}

	return raw === null ? loadFromLocalStorage() : parseDocument(raw);
}

/**
 * Persist the app's data to this browser.
 *
 * Writes to IndexedDB, falling back to `localStorage` when IndexedDB is unavailable or the write
 * fails. Throws {@link BrowserStorageError} when neither backend took it — a genuine "your data
 * was not saved", which the store surfaces to the user rather than swallowing.
 *
 * @param {AppDataDoc} data
 * @returns {Promise<void>}
 */
export async function saveAppData(data) {
	const raw = JSON.stringify(data, null, 2);

	const db = await openDatabase();
	if (db) {
		try {
			await writeToDatabase(db, raw);
			return;
		} catch (cause) {
			if (saveToLocalStorage(raw)) return;
			throw new BrowserStorageError(
				`Could not save to IndexedDB: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause }
			);
		}
	}

	if (saveToLocalStorage(raw)) return;
	throw new BrowserStorageError(
		'No browser storage is available: neither IndexedDB nor localStorage could be used to save your data.'
	);
}

/**
 * Delete this browser's copy of the document — the local half of "delete all my data" (issue #63),
 * and the whole of it in browser-only mode, where there is nowhere else the data has been.
 *
 * Both backends are cleared, always, whichever one the last save happened to use: a document can be
 * in `localStorage` because IndexedDB was unavailable at the time, or because a pre-#61 build wrote
 * it there, and a wipe that cleared only the primary would leave that copy sitting one key over —
 * which the *next* load would then adopt as the user's data, undoing the deletion. For the same
 * reason neither failure short-circuits the other: both are attempted, and only then does this
 * throw.
 *
 * Irreversible, and the caller is expected to have confirmed it — see `./persistence.js`'s
 * `deleteAllData` and `DELETE_CONFIRMATION_PHRASE`. Deleting nothing (a browser with no document
 * stored yet) is a success, not an error.
 *
 * Leaves everything that isn't the document alone: the persistence-mode choice, the GitHub token and
 * account (`./github-auth.js`) and the Gist pointer (`./gist.js`) are all separate keys with their
 * own owners, and signing out is a different action from deleting data.
 *
 * @returns {Promise<void>}
 * @throws {BrowserStorageError} If a backend that *has* the document refused to delete it.
 */
export async function deleteAppData() {
	/** @type {unknown} */
	let databaseFailure;
	const db = await openDatabase();
	if (db) {
		try {
			await deleteFromDatabase(db);
		} catch (cause) {
			databaseFailure = cause;
		}
	}

	/** @type {unknown} */
	let localFailure;
	if (hasLocalStorage()) {
		try {
			localStorage.removeItem(LOCAL_DATA_KEY);
		} catch (cause) {
			localFailure = cause;
		}
	}

	if (databaseFailure === undefined && localFailure === undefined) return;

	const failures = [
		databaseFailure !== undefined ? 'IndexedDB' : undefined,
		localFailure !== undefined ? 'localStorage' : undefined
	].filter((where) => where !== undefined);
	const cause = databaseFailure ?? localFailure;
	throw new BrowserStorageError(
		`Could not delete this browser's copy of your data from ${failures.join(' or ')}: ${
			cause instanceof Error ? cause.message : String(cause)
		}`,
		{ cause }
	);
}
