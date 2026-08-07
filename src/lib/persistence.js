/**
 * One load/save API over both storage backends (see `README.md` → Persistence modes).
 *
 * Two modes, identical JSON document either way:
 *
 * - **`browser`** — `./browser-storage.js`: IndexedDB, `localStorage` fallback. No token, no
 *   network, no setup. The default, and on a build with no `VITE_GITHUB_TOKEN` compiled in, the
 *   only mode there is.
 * - **`gist`** — `./gist.js`: a JSON file in a private GitHub Gist, for cross-device access.
 *   Available only once the app has a GitHub token: since #62 that normally means the user signed
 *   in from the connect page (`./github-auth.js`), and signing in is itself the opt-in, so it
 *   switches this browser to Gist mode. A token compiled in as `VITE_GITHUB_TOKEN` also counts, and
 *   a build carrying one starts in Gist mode as it always did.
 *
 * The user's choice (set by the connect page, and by #100's Settings UI) is remembered in
 * `localStorage` and wins over that default whenever it names a mode this build can actually use —
 * so a signed-in browser can be put back into browser-only mode, while a remembered `gist` after
 * signing out silently falls back to `browser` rather than failing every save.
 *
 * `./store.js` talks to this module and never to a backend directly; the backends know nothing
 * about each other or about modes. The same is true of the one destructive operation, `deleteAllData`
 * (#63): what "all" means differs by mode — a Gist plus this browser's copy, or just this browser's
 * copy — and deciding that is this module's job, exactly as it is for load and save.
 *
 * SSR-safe: nothing here touches `localStorage` at import time (the GitHub Pages build prerenders).
 */

import {
	deleteAppData as deleteFromBrowser,
	loadAppData as loadFromBrowser,
	saveAppData as saveToBrowser
} from './browser-storage.js';
import {
	deleteGistData,
	describeGistTarget,
	isGistConfigured,
	loadAppData as loadFromGist,
	saveAppData as saveToGist
} from './gist.js';
import { describeGitHubConnection } from './github-auth.js';

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
 * The mode used when the user has never chosen one: Gist sync whenever the app has a GitHub token
 * (signing in, or configuring one at build time, is the opt-in), browser-only otherwise.
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
 *   while signed out of GitHub, on a build with no `VITE_GITHUB_TOKEN`) — the UI should only offer
 *   {@link availablePersistenceModes}.
 */
export function setPersistenceMode(mode) {
	if (!PERSISTENCE_MODES.includes(/** @type {PersistenceMode} */ (mode))) {
		throw new RangeError(`Unknown persistence mode "${mode}"`);
	}
	if (!isPersistenceModeAvailable(mode)) {
		throw new RangeError(
			`Persistence mode "${mode}" is not available yet (sign in with GitHub to use Gist sync)`
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

/* -------------------------------------------------------------------------- */
/* Deleting everything (issue #63)                                             */
/* -------------------------------------------------------------------------- */

/**
 * The phrase a user has to type, exactly, before the app will delete anything. Lives here rather
 * than in the component so that every UI that ever offers the wipe (the connect page today, #100's
 * Settings tab later) asks for the *same* phrase — a confirmation that varies by screen is one users
 * learn to click through.
 *
 * Case-sensitive on purpose: "delete" is a word people type by reflex, `DELETE` is one they have to
 * mean.
 */
export const DELETE_CONFIRMATION_PHRASE = 'DELETE';

/**
 * Whether what the user typed matches {@link DELETE_CONFIRMATION_PHRASE}. Surrounding whitespace is
 * forgiven (it is invisible, and a paste can carry it); nothing else is.
 *
 * @param {unknown} input
 * @returns {boolean}
 */
export function isDeleteConfirmed(input) {
	return typeof input === 'string' && input.trim() === DELETE_CONFIRMATION_PHRASE;
}

/**
 * @typedef {object} DeleteTarget
 * @property {PersistenceMode} mode The mode the wipe would run in.
 * @property {'gist' | 'browser'} scope What it would reach: in Gist mode the Gist *and* this
 *   browser's copy, in browser-only mode this browser's copy alone.
 * @property {string | null} account The signed-in account the Gist would be deleted as, if any.
 * @property {{ id: string, url: string | undefined, source: 'browser' | 'build' }| null} gist The
 *   Gist that would be deleted, if this browser has one.
 * @property {string | null} blocked Why the Gist half cannot run, or `null` if it can. Never blocks
 *   the browser-copy half, which needs nothing configured.
 */

/**
 * What {@link deleteAllData} would actually delete, for a confirmation step that has to say so in
 * specific terms — "your Gist aa11bb22 and this browser's copy", not "your data". Synchronous, so
 * the panel can render it without awaiting.
 *
 * @returns {DeleteTarget}
 */
export function describeDeleteTarget() {
	const mode = getPersistenceMode();
	if (mode !== 'gist') {
		return { mode, scope: 'browser', account: null, gist: null, blocked: null };
	}

	const connection = describeGitHubConnection();
	const target = describeGistTarget();
	return {
		mode,
		scope: 'gist',
		account: connection.account?.login ?? null,
		gist:
			target.id === undefined
				? null
				: {
						id: target.id,
						url: target.url,
						source: target.source === 'build' ? 'build' : 'browser'
					},
		blocked: connection.signedIn
			? null
			: 'Sign in with GitHub first. This app only deletes a Gist it can prove belongs to the signed-in account, and a token compiled into the build proves nothing about whose it is.'
	};
}

/**
 * @typedef {object} DeleteResult
 * @property {PersistenceMode} mode The mode the wipe ran in.
 * @property {import('./gist.js').GistDeletion | null} gist What happened at GitHub, or `null` in
 *   browser-only mode, where nothing remote is touched.
 */

/**
 * Delete everything this app has stored — issue #63's action, and the only irreversible thing in the
 * codebase. Callers are expected to have gated it behind {@link isDeleteConfirmed}; nothing here
 * re-asks, because a confirmation the API enforces would only be a second copy of a decision the UI
 * has already made.
 *
 * In **Gist mode**: the signed-in user's own Gist first (`./gist.js`'s `deleteGistData`, which
 * proves ownership before it deletes anything and takes no id from the caller), then this browser's
 * copy — the "any local cache of it" half of the issue. Remote first on purpose: if GitHub refuses,
 * this throws with the local copy still intact and the user can retry, rather than having deleted
 * the only copy they could have exported.
 *
 * In **browser-only mode**: this browser's copy, and nothing else. No token is involved, no request
 * is made, and a Gist that some other browser syncs with is none of this mode's business.
 *
 * Neither mode signs the user out, forgets their mode choice, or touches their GitHub token: those
 * are separate actions with separate buttons, and a wipe that also logged you out would make "start
 * again from empty" needlessly harder than it is.
 *
 * @returns {Promise<DeleteResult>}
 * @throws {import('./gist.js').GistError | import('./browser-storage.js').BrowserStorageError} If
 *   either half failed. A Gist failure means nothing was deleted at all.
 */
export async function deleteAllData() {
	const mode = getPersistenceMode();
	const gist = mode === 'gist' ? await deleteGistData() : null;
	await deleteFromBrowser();
	return { mode, gist };
}
