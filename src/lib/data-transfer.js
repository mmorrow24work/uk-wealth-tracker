/**
 * JSON export/import — the manual bridge between the two persistence modes (issue #100), and a
 * backup mechanism either way (`README.md` → Persistence modes).
 *
 * Pure logic only: this module never touches `localStorage`, IndexedDB or the network, and never
 * reads or writes `$lib/store.js`. `src/components/DataManager.svelte` is the DOM wiring around it
 * — the file picker, the `Blob` download, the confirm step.
 *
 * **Export** wraps the current `AppData` (`./model.js`) with two extra top-level fields — an `app`
 * marker and an `exported_at` stamp — and serialises it. Everything else is the same document
 * `./browser-storage.js` and `./gist.js` already store, `schema_version` included, so a re-import
 * only ever needs `migrateAppData` over it.
 *
 * **Import** is checked in full before anything is reported as usable:
 * 1. Reject anything that isn't valid JSON.
 * 2. Reject anything that isn't a uk-wealth-tracker export — the `app` marker exists for exactly
 *    this, because `normaliseAppData` alone cannot tell "an export" from "arbitrary JSON that
 *    happens to parse": it defaults every missing field, so `{}` would otherwise "normalise"
 *    successfully into an empty-but-valid document.
 * 3. Run `migrateAppData` then `validateAppData` over what is left, and reject with every offending
 *    field listed if that document is not actually valid — a stray out-of-range percentage or a
 *    duplicate id is exactly what `normaliseAppData` alone would silently paper over.
 *
 * `parseImportDocument` returns a result rather than throwing, and never mutates anything — the
 * caller decides when (and whether) to actually replace the current document, so a rejected file
 * leaves it byte-identical.
 */

import { migrateAppData, validateAppData } from './model.js';

/**
 * Named `TransferAppData`/`TransferValidationError` rather than the more obvious `AppDataDoc`/
 * `ValidationError` because `index.js` re-exports every module with `export *`, and TS treats two
 * same-named JSDoc typedefs as an ambiguous re-export — `persistence.js` already claims
 * `AppDataDoc` and `model.js` already claims `ValidationError`, the same reason `store.js` names
 * its own alias `StoreAppData` instead of reusing either.
 * @typedef {import('./types.js').AppData} TransferAppData
 * @typedef {import('./types.js').ValidationError} TransferValidationError
 */

/** Marks a JSON document as one this app wrote, so import can reject arbitrary JSON up front. */
export const EXPORT_MARKER = 'uk-wealth-tracker';

/**
 * @param {TransferAppData} data
 * @param {string} exportedAt ISO date-time. Parameterised (rather than read from `Date` here) so
 *   tests can assert on it and so a caller stamping a batch of exports can use one consistent time.
 * @returns {Record<string, unknown>}
 */
export function createExportDocument(data, exportedAt) {
	return { app: EXPORT_MARKER, exported_at: exportedAt, ...data };
}

/**
 * A filename carrying today's date, so a browser's downloads folder sorts exports chronologically
 * and a second export the same day doesn't silently overwrite the first without at least the
 * browser's own "(1)" disambiguation kicking in.
 *
 * @param {string} exportedAt ISO date-time, the same one stamped into the document.
 * @returns {string}
 */
export function suggestExportFilename(exportedAt) {
	const datePart = exportedAt.slice(0, 10);
	return `uk-wealth-tracker-export-${datePart || 'unknown-date'}.json`;
}

/**
 * @param {TransferAppData} data
 * @param {{ exportedAt?: string }} [options] `exportedAt` defaults to now; only ever overridden by
 *   tests.
 * @returns {{ json: string, filename: string }}
 */
export function exportAppData(data, { exportedAt = new Date().toISOString() } = {}) {
	const document = createExportDocument(data, exportedAt);
	return { json: JSON.stringify(document, null, 2), filename: suggestExportFilename(exportedAt) };
}

/**
 * @typedef {object} ImportSuccess
 * @property {true} ok
 * @property {TransferAppData} data The document to replace the current one with, already
 *   normalised and confirmed valid.
 */

/**
 * @typedef {object} ImportFailure
 * @property {false} ok
 * @property {'invalid-json' | 'not-an-export' | 'invalid-data'} reason
 * @property {string} message A sentence safe to show the user as-is.
 * @property {TransferValidationError[]} errors The offending fields, only ever populated for
 *   `invalid-data`.
 */

/**
 * @typedef {ImportSuccess | ImportFailure} ImportResult
 */

/**
 * Parse and fully validate an imported export. Never throws, never mutates anything — the file
 * currently open is decided on by the caller, only after this returns `ok: true`.
 *
 * @param {string} raw File contents, as text.
 * @returns {ImportResult}
 */
export function parseImportDocument(raw) {
	/** @type {unknown} */
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		return {
			ok: false,
			reason: 'invalid-json',
			message: `That file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
			errors: []
		};
	}

	const isExport =
		typeof parsed === 'object' &&
		parsed !== null &&
		!Array.isArray(parsed) &&
		/** @type {Record<string, unknown>} */ (parsed).app === EXPORT_MARKER;
	if (!isExport) {
		return {
			ok: false,
			reason: 'not-an-export',
			message:
				'That file is not a uk-wealth-tracker export — it is missing the marker every file this app exports carries. Choose a file created with "Export data as JSON".',
			errors: []
		};
	}

	const data = migrateAppData(parsed);
	const { valid, errors } = validateAppData(data);
	if (!valid) {
		return {
			ok: false,
			reason: 'invalid-data',
			message: `That file has ${errors.length} problem${errors.length === 1 ? '' : 's'} that can't be imported as-is — nothing has been changed.`,
			errors
		};
	}

	return { ok: true, data };
}
