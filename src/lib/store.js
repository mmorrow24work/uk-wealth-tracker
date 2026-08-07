/**
 * Global reactive app state (see `CLAUDE.md` → Architecture): one Svelte store holding the whole
 * `AppData` document, hydrated from `./persistence.js` on load and written back to it — debounced
 * — on every change. Which backend that is (browser storage or a GitHub Gist) is entirely
 * `./persistence.js`'s business; this module only knows "load" and "save". Every feature tab is
 * meant to read and write this store rather than keep its own local copy of persisted data, per
 * CLAUDE.md's "extend the shared data model rather than introducing separate storage" rule.
 *
 * Two things this module deliberately does *not* do:
 * - Validate on every change. `validateAppData` (`./model.js`) reports problems a form should
 *   surface to the user as they type; running it here would mean a mid-edit invalid value (an
 *   empty "balance" field, say) blocks the debounced save of everything else in the document too.
 *   Callers that care about validity check it themselves before or after updating the store.
 * - Merge concurrent writers. This is a single-user, single-tab-at-a-time app (`DESIGN.md` →
 *   Data Persistence); the store always saves whatever it currently holds, last write wins.
 *
 * @module
 */

import { get, writable } from 'svelte/store';

import { BrowserStorageError } from './browser-storage.js';
import { GistError } from './gist.js';
import { createAppData } from './model.js';
import { loadAppData, saveAppData } from './persistence.js';

/**
 * Not re-declared as a local `@typedef` (unlike most `$lib` modules) because `index.js` re-exports
 * every module with `export *`, and `svelte-check` treats two same-named JSDoc typedefs as an
 * ambiguous re-export even though only `model.js`'s is meant to be the public one — the same
 * workaround `gist.js` already uses.
 * @typedef {import('./types.js').AppData} StoreAppData
 */

/**
 * How long to wait after the most recent change before writing to `./persistence.js`. Long enough that a
 * burst of edits (typing a name, dragging a slider) becomes one write instead of one per
 * keystroke; short enough that closing the tab a couple of seconds after the last edit rarely
 * loses it.
 */
export const SYNC_DEBOUNCE_MS = 800;

/**
 * The whole persisted document. Starts as a fresh empty one so every tab has something to render
 * before {@link hydrateAppData} resolves; call that once (typically from the root layout's
 * `onMount`) to replace it with whatever is actually stored.
 *
 * @type {import('svelte/store').Writable<StoreAppData>}
 */
export const appData = writable(createAppData());

/**
 * @typedef {object} SyncState
 * @property {boolean} hydrated Whether {@link hydrateAppData} has completed at least once.
 * @property {boolean} syncing Whether a debounced write to `./persistence.js` is in flight right now.
 * @property {string | null} error The most recent load or save failure, or `null` once one
 *   succeeds. Never set for "nothing saved yet" — only for a load/save that was attempted and
 *   failed (see `GistError` in `./gist.js` and `BrowserStorageError` in `./browser-storage.js`).
 */

/** @type {import('svelte/store').Writable<SyncState>} */
export const syncState = writable({ hydrated: false, syncing: false, error: null });

/**
 * @param {unknown} cause
 * @param {string} fallbackVerb
 * @returns {string}
 */
function describeError(cause, fallbackVerb) {
	// Both backends' own errors already read as a sentence aimed at the user; anything else is an
	// unexpected failure that needs the "could not save/load" framing adding.
	if (cause instanceof GistError || cause instanceof BrowserStorageError) return cause.message;
	return `Could not ${fallbackVerb}: ${cause instanceof Error ? cause.message : String(cause)}`;
}

/**
 * While `true`, changes to {@link appData} do not schedule a save. Set around every
 * {@link appData}.set() this module makes on the *read* path — hydrating shouldn't immediately
 * re-save the very thing it just loaded — but left `false` for changes callers make themselves,
 * which is exactly the "on change" this module exists to persist. Starts `true` so a caller that
 * mutates the store before ever hydrating (a stray update before the root layout's `onMount` has
 * run) doesn't overwrite real stored data with a change made against the placeholder default.
 */
let suppressSync = true;

/** @type {ReturnType<typeof setTimeout> | undefined} */
let saveTimer;

appData.subscribe(() => {
	if (suppressSync) return;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveTimer = undefined;
		void persist();
	}, SYNC_DEBOUNCE_MS);
});

/**
 * Writes the store's *current* value, not whatever it held when the debounce timer was scheduled
 * — the sole point of debouncing is that only the latest state after a burst of edits ever reaches
 * `./persistence.js`.
 *
 * @returns {Promise<void>}
 */
async function persist() {
	syncState.update((state) => ({ ...state, syncing: true }));
	try {
		await saveAppData(get(appData));
		syncState.update((state) => ({ ...state, syncing: false, error: null }));
	} catch (cause) {
		syncState.update((state) => ({
			...state,
			syncing: false,
			error: describeError(cause, 'save')
		}));
	}
}

/** @type {Promise<StoreAppData> | undefined} */
let hydratePromise;

/**
 * Loads the document from `./persistence.js` (browser storage, or a configured Gist) and
 * replaces {@link appData} with it. Concurrent calls share one in-flight load rather than firing
 * a second request — useful since both a root layout's `onMount` and an explicit "sync now"
 * action can reasonably call this.
 *
 * Never throws: a failed load leaves {@link appData} at whatever it already held (the initial
 * empty document, on first call) and records the failure on {@link syncState} instead, so a
 * caller can render an error banner rather than crashing the page over a network blip.
 *
 * @returns {Promise<StoreAppData>} The document now held by {@link appData}.
 */
export function hydrateAppData() {
	if (hydratePromise) return hydratePromise;

	hydratePromise = (async () => {
		try {
			const loaded = await loadAppData();
			suppressSync = true;
			appData.set(loaded);
			suppressSync = false;
			syncState.update((state) => ({ ...state, hydrated: true, error: null }));
			return loaded;
		} catch (cause) {
			suppressSync = false;
			syncState.update((state) => ({
				...state,
				hydrated: true,
				error: describeError(cause, 'load')
			}));
			return get(appData);
		} finally {
			hydratePromise = undefined;
		}
	})();

	return hydratePromise;
}

/**
 * Saves the current value of {@link appData} immediately, bypassing the debounce timer — e.g. for
 * a "save now" action, or before navigating away with a change still pending. Cancels any
 * already-scheduled debounced save rather than leaving it to fire redundantly afterwards.
 *
 * @returns {Promise<void>}
 */
export function flushAppDataSync() {
	if (saveTimer) {
		clearTimeout(saveTimer);
		saveTimer = undefined;
	}
	return persist();
}
