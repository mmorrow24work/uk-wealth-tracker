/**
 * Activity log — README.md → "Net Worth Tracking": "Activity log with revert support for deleted
 * entries" (issue #14). A flat list of {@link ActivityLogEntry} records describing every
 * add/remove/update made to an investment or debt, newest first. Revert support only exists for
 * `removed` entries, per the issue's own wording — undoing an `updated`/`added` entry is out of
 * scope here.
 *
 * The log itself is a plain array threaded through by the caller (a component today, e.g.
 * `DebtTracker.svelte`; the shared store once #5 lands) — these functions never mutate in place,
 * matching the rest of `$lib`'s "normalise once, then work with plain immutable data" style.
 * `ActivityLogEntry` records themselves are created via `createActivityLogEntry` in `./model.js`
 * (alongside every other `create*` factory), not here.
 */

import { ACTIVITY_LOG_ACTION_LABELS } from './enums.js';
import { createActivityLogEntry } from './model.js';

/*
 * Not re-declared as a local `@typedef` (same reasoning as `debt.js`): `index.js` re-exports every
 * module with `export *`, and svelte-check flags two same-named top-level typedefs across
 * re-exported modules as an ambiguous export even though only `model.js`'s is meant to be public.
 */

/**
 * Record that an entity was added, returning a new log with the entry prepended (newest first).
 *
 * @param {readonly import('./types.js').ActivityLogEntry[]} log
 * @param {import('./enums.js').ActivityLogEntityType} entityType
 * @param {{ id: string, name: string }} entity
 * @returns {import('./types.js').ActivityLogEntry[]}
 */
export function logEntityAdded(log, entityType, entity) {
	return [
		createActivityLogEntry({
			action: 'added',
			entity_type: entityType,
			entity_id: entity.id,
			entity_name: entity.name
		}),
		...log
	];
}

/**
 * Record that an entity was removed, capturing a full snapshot so the deletion can later be
 * reverted via {@link revertEntityRemoval}.
 *
 * @param {readonly import('./types.js').ActivityLogEntry[]} log
 * @param {import('./enums.js').ActivityLogEntityType} entityType
 * @param {Record<string, unknown> & { id: string, name: string }} entity The full record as it
 *   stood immediately before removal.
 * @returns {import('./types.js').ActivityLogEntry[]}
 */
export function logEntityRemoved(log, entityType, entity) {
	return [
		createActivityLogEntry({
			action: 'removed',
			entity_type: entityType,
			entity_id: entity.id,
			entity_name: entity.name,
			snapshot: entity
		}),
		...log
	];
}

/**
 * Record that an entity was edited in place. Keeps the pre-edit record as `snapshot` for context,
 * but — unlike `removed` — an `updated` entry is never revertible; {@link isRevertible} always
 * returns false for it, since issue #14 scopes revert support to deletions only.
 *
 * @param {readonly import('./types.js').ActivityLogEntry[]} log
 * @param {import('./enums.js').ActivityLogEntityType} entityType
 * @param {Record<string, unknown> & { id: string, name: string }} before
 * @param {{ id: string, name: string }} after
 * @returns {import('./types.js').ActivityLogEntry[]}
 */
export function logEntityUpdated(log, entityType, before, after) {
	return [
		createActivityLogEntry({
			action: 'updated',
			entity_type: entityType,
			entity_id: after.id,
			entity_name: after.name,
			snapshot: before
		}),
		...log
	];
}

/**
 * Whether a log entry's deletion can still be undone: it must record a `removed` action, carry the
 * snapshot revert needs, and not already have been reverted once.
 *
 * @param {import('./types.js').ActivityLogEntry} entry
 * @returns {boolean}
 */
export function isRevertible(entry) {
	return entry.action === 'removed' && !entry.reverted && entry.snapshot !== null;
}

/**
 * Undo a deletion. Returns the log untouched and a null `entity` when `logEntryId` does not name a
 * revertible entry (not found, wrong action, already reverted) — callers should treat that as a
 * no-op, since the "Revert" control that triggers this is only ever shown once {@link isRevertible}
 * has already been checked, and a log entry going missing between render and click is not
 * exceptional enough to throw over.
 *
 * @param {readonly import('./types.js').ActivityLogEntry[]} log
 * @param {string} logEntryId
 * @returns {{ log: import('./types.js').ActivityLogEntry[], entity: Record<string, unknown> | null }}
 */
export function revertEntityRemoval(log, logEntryId) {
	const target = log.find((entry) => entry.id === logEntryId);
	if (!target || !isRevertible(target)) {
		return { log: [...log], entity: null };
	}
	return {
		log: log.map((entry) => (entry.id === logEntryId ? { ...entry, reverted: true } : entry)),
		entity: target.snapshot
	};
}

/**
 * A human-readable one-line description for the log UI, e.g. `Removed debt "Halifax mortgage"`.
 *
 * @param {import('./types.js').ActivityLogEntry} entry
 * @returns {string}
 */
export function describeActivityLogEntry(entry) {
	const name = entry.entity_name.trim() === '' ? 'an unnamed record' : `"${entry.entity_name}"`;
	return `${ACTIVITY_LOG_ACTION_LABELS[entry.action]} ${entry.entity_type} ${name}`;
}
