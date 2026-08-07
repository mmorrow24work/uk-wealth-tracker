/**
 * One load/save API over both storage backends (see `README.md` → Persistence modes).
 *
 * Two modes, identical JSON document either way:
 *
 * - **`browser`** — `./browser-storage.js`: IndexedDB, `localStorage` fallback. No token, no
 *   network, no setup. The default, and on a build with no `VITE_GITHUB_TOKEN` compiled in, the
 *   only mode there is.
 * - **`gist`** — `./gist.js`: a JSON file in a private GitHub Gist, for cross-device access.
 *   Available only when a token *is* compiled in — configuring that token is itself the opt-in, so
 *   a build that has one starts in Gist mode.
 *
 * The user's choice (which #100's Settings UI sets) is remembered in `localStorage` and wins over
 * that default whenever it names a mode this build can actually use — so a token-carrying build
 * can be put back into browser-only mode, while a remembered `gist` on a build that no longer has
 * a token silently falls back to `browser` rather than failing every save.
 *
 * `./store.js` talks to this module and never to a backend directly; the backends know nothing
 * about each other or about modes.
 *
 * SSR-safe: nothing here touches `localStorage` at import time (the GitHub Pages build prerenders).
 */

import { loadAppData as loadFromBrowser, saveAppData as saveToBrowser } from './browser-storage.js';
import {
	isGistConfigured,
	loadAppData as loadFromGist,
	saveAppData as saveToGist
} from './gist.js';

/**
 * Not re-declared as a local `@typedef` (unlike other `$lib` modules) because `index.js` re-exports
 * modules with `export *`, and TS treats two same-named JSDoc typedefs as an ambiguous re-export
 * even though only `model.js`'s is meant to be the public one — the same workaround `gist.js` uses.
 * @typedef {import('./types.js').AppData} AppDataDoc
 */

/**
 * @typedef {'browser' | 'gist'} PersistenceMode
 */

/** Every mode that exists, whether or not this build can use it. */
export const PERSISTENCE_MODES = /** @type {const} */ (['browser', 'gist']);

/** `localStorage` key holding the user's remembered mode choice. */
export const PERSISTENCE_MODE_KEY = 'uk-wealth-tracker:persistence-mode';

/** @returns {boolean} */
function hasLocalStorage() {
	try {
		return typeof localStorage !== 'undefined' && localStorage !== null;
	} catch {
		return false;
	}
}

/**
 * Modes this build can actually use, in preference order. `browser` is always one of them — it
 * needs nothing configured, which is the whole point of it being the default.
 *
 * @returns {PersistenceMode[]}
 */
export function availablePersistenceModes() {
	return isGistConfigured() ? ['gist', 'browser'] : ['browser'];
}

/**
 * @param {unknown} mode
 * @returns {mode is PersistenceMode}
 */
export function isPersistenceModeAvailable(mode) {
	return (
		typeof mode === 'string' &&
		availablePersistenceModes().includes(/** @type {PersistenceMode} */ (mode))
	);
}

/**
 * The mode used when the user has never chosen one: Gist sync on a build that carries a token
 * (configuring the token is the opt-in), browser-only otherwise.
 *
 * @returns {PersistenceMode}
 */
export function defaultPersistenceMode() {
	return isGistConfigured() ? 'gist' : 'browser';
}

/**
 * The remembered choice, or `null` if there isn't a usable one — never read directly by the rest
 * of the app, which wants {@link getPersistenceMode} (this without the fallback).
 *
 * @returns {PersistenceMode | null}
 */
export function getRememberedPersistenceMode() {
	if (!hasLocalStorage()) return null;
	/** @type {string | null} */
	let stored;
	try {
		stored = localStorage.getItem(PERSISTENCE_MODE_KEY);
	} catch {
		return null;
	}
	return isPersistenceModeAvailable(stored) ? stored : null;
}

/**
 * Which mode the app is in right now: the remembered choice if this build can honour it, otherwise
 * {@link defaultPersistenceMode}. Synchronous, so a template can render "Saved to this browser
 * only" vs "Synced to your GitHub Gist" without awaiting anything.
 *
 * @returns {PersistenceMode}
 */
export function getPersistenceMode() {
	return getRememberedPersistenceMode() ?? defaultPersistenceMode();
}

/**
 * Remember a mode choice for this browser. Switching mode does **not** move any data — both modes
 * speak the same JSON document, and moving it between them is JSON export/import's job (#100).
 *
 * @param {PersistenceMode} mode
 * @returns {PersistenceMode} The mode now in effect.
 * @throws {RangeError} If the mode doesn't exist, or this build can't use it (asking for `gist`
 *   with no `VITE_GITHUB_TOKEN` compiled in) — the UI should only offer
 *   {@link availablePersistenceModes}.
 */
export function setPersistenceMode(mode) {
	if (!PERSISTENCE_MODES.includes(/** @type {PersistenceMode} */ (mode))) {
		throw new RangeError(`Unknown persistence mode "${mode}"`);
	}
	if (!isPersistenceModeAvailable(mode)) {
		throw new RangeError(
			`Persistence mode "${mode}" is not available in this build (no VITE_GITHUB_TOKEN configured)`
		);
	}
	if (hasLocalStorage()) {
		try {
			localStorage.setItem(PERSISTENCE_MODE_KEY, mode);
		} catch {
			// Storage full or blocked — the mode still applies for this session, it just won't be
			// remembered next time. Not worth failing the switch the user just asked for.
		}
	}
	return mode;
}

/**
 * Forget the remembered choice, putting this browser back on {@link defaultPersistenceMode}.
 *
 * @returns {PersistenceMode} The mode now in effect.
 */
export function clearPersistenceMode() {
	if (hasLocalStorage()) {
		try {
			localStorage.removeItem(PERSISTENCE_MODE_KEY);
		} catch {
			// Same as above — nothing useful to do if the browser won't let us write.
		}
	}
	return getPersistenceMode();
}

/**
 * Load the app's data from whichever backend the active mode names.
 *
 * Never throws for "nothing saved yet" — a first visit in either mode is a fresh empty document.
 * Throws the active backend's own error (`GistError` / `BrowserStorageError`) when a load was
 * genuinely attempted and failed.
 *
 * @returns {Promise<AppDataDoc>}
 */
export function loadAppData() {
	return getPersistenceMode() === 'gist' ? loadFromGist() : loadFromBrowser();
}

/**
 * Persist the app's data to whichever backend the active mode names.
 *
 * @param {AppDataDoc} data
 * @returns {Promise<void>}
 */
export function saveAppData(data) {
	return getPersistenceMode() === 'gist' ? saveToGist(data) : saveToBrowser(data);
}
