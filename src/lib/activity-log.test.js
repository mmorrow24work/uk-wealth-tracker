import { describe, expect, it } from 'vitest';

import { createDebt, createInvestment } from './model.js';
import {
	describeActivityLogEntry,
	isRevertible,
	logEntityAdded,
	logEntityRemoved,
	logEntityUpdated,
	revertEntityRemoval
} from './activity-log.js';

describe('logEntityAdded', () => {
	it('prepends an added entry for the entity', () => {
		const debt = createDebt({ id: 'debt_1', name: 'Halifax mortgage' });
		const log = logEntityAdded([], 'debt', debt);

		expect(log).toHaveLength(1);
		expect(log[0]).toMatchObject({
			action: 'added',
			entity_type: 'debt',
			entity_id: 'debt_1',
			entity_name: 'Halifax mortgage',
			snapshot: null,
			reverted: false
		});
		expect(log[0].id).not.toBe('');
		expect(Number.isNaN(Date.parse(log[0].timestamp))).toBe(false);
	});

	it('puts new entries first, ahead of existing history', () => {
		const first = logEntityAdded([], 'debt', createDebt({ id: 'debt_1', name: 'First' }));
		const both = logEntityAdded(first, 'debt', createDebt({ id: 'debt_2', name: 'Second' }));

		expect(both.map((entry) => entry.entity_name)).toEqual(['Second', 'First']);
	});

	it('does not mutate the log passed in', () => {
		/** @type {import('./types.js').ActivityLogEntry[]} */
		const original = [];
		logEntityAdded(original, 'debt', createDebt({ id: 'debt_1', name: 'Halifax' }));
		expect(original).toEqual([]);
	});
});

describe('logEntityRemoved', () => {
	it('records a removed entry carrying the full entity as a snapshot', () => {
		const debt = createDebt({ id: 'debt_1', name: 'Old card', balance: 500 });
		const log = logEntityRemoved([], 'debt', debt);

		expect(log[0]).toMatchObject({
			action: 'removed',
			entity_type: 'debt',
			entity_id: 'debt_1',
			entity_name: 'Old card',
			reverted: false
		});
		expect(log[0].snapshot).toEqual(debt);
	});
});

describe('logEntityUpdated', () => {
	it('records an updated entry with the pre-edit record as the snapshot', () => {
		const before = createInvestment({ id: 'inv_1', name: 'ISA', value: 1000 });
		const after = { ...before, value: 1500 };
		const log = logEntityUpdated([], 'investment', before, after);

		expect(log[0]).toMatchObject({
			action: 'updated',
			entity_type: 'investment',
			entity_id: 'inv_1',
			entity_name: 'ISA'
		});
		expect(log[0].snapshot).toEqual(before);
	});
});

describe('isRevertible', () => {
	it('is true for a removed entry with a snapshot that has not been reverted', () => {
		const log = logEntityRemoved([], 'debt', createDebt({ id: 'debt_1', name: 'Card' }));
		expect(isRevertible(log[0])).toBe(true);
	});

	it('is false for an added entry', () => {
		const log = logEntityAdded([], 'debt', createDebt({ id: 'debt_1', name: 'Card' }));
		expect(isRevertible(log[0])).toBe(false);
	});

	it('is false for an updated entry', () => {
		const debt = createDebt({ id: 'debt_1', name: 'Card' });
		const log = logEntityUpdated([], 'debt', debt, debt);
		expect(isRevertible(log[0])).toBe(false);
	});

	it('is false once a removed entry has already been reverted', () => {
		const log = logEntityRemoved([], 'debt', createDebt({ id: 'debt_1', name: 'Card' }));
		const { log: reverted } = revertEntityRemoval(log, log[0].id);
		expect(isRevertible(reverted[0])).toBe(false);
	});

	it('is false for a removed entry with no snapshot', () => {
		expect(
			isRevertible({
				id: 'log_1',
				timestamp: new Date().toISOString(),
				action: 'removed',
				entity_type: 'debt',
				entity_id: 'debt_1',
				entity_name: 'Card',
				snapshot: null,
				reverted: false
			})
		).toBe(false);
	});
});

describe('revertEntityRemoval', () => {
	it('returns the snapshot and marks the entry reverted', () => {
		const debt = createDebt({ id: 'debt_1', name: 'Card', balance: 250 });
		const log = logEntityRemoved([], 'debt', debt);

		const result = revertEntityRemoval(log, log[0].id);

		expect(result.entity).toEqual(debt);
		expect(result.log[0].reverted).toBe(true);
		expect(result.log[0].id).toBe(log[0].id);
	});

	it('leaves every other entry untouched', () => {
		let log = logEntityAdded([], 'debt', createDebt({ id: 'debt_1', name: 'Kept' }));
		log = logEntityRemoved(log, 'debt', createDebt({ id: 'debt_2', name: 'Removed' }));

		const removedEntryId = log[0].id;
		const result = revertEntityRemoval(log, removedEntryId);

		const untouched = result.log.find((entry) => entry.entity_name === 'Kept');
		expect(untouched).toEqual(log[1]);
	});

	it('is a no-op for an unknown log entry id', () => {
		const log = logEntityRemoved([], 'debt', createDebt({ id: 'debt_1', name: 'Card' }));
		const result = revertEntityRemoval(log, 'log_does_not_exist');

		expect(result.entity).toBeNull();
		expect(result.log).toEqual(log);
	});

	it('is a no-op for an added entry (nothing to revert)', () => {
		const log = logEntityAdded([], 'debt', createDebt({ id: 'debt_1', name: 'Card' }));
		const result = revertEntityRemoval(log, log[0].id);

		expect(result.entity).toBeNull();
		expect(result.log).toEqual(log);
	});

	it('is a no-op reverting an already-reverted entry a second time', () => {
		const log = logEntityRemoved([], 'debt', createDebt({ id: 'debt_1', name: 'Card' }));
		const firstRevert = revertEntityRemoval(log, log[0].id);
		const secondRevert = revertEntityRemoval(firstRevert.log, log[0].id);

		expect(secondRevert.entity).toBeNull();
		expect(secondRevert.log).toEqual(firstRevert.log);
	});

	it('does not mutate the log passed in', () => {
		const log = logEntityRemoved([], 'debt', createDebt({ id: 'debt_1', name: 'Card' }));
		const snapshotBefore = JSON.parse(JSON.stringify(log));

		revertEntityRemoval(log, log[0].id);

		expect(log).toEqual(snapshotBefore);
	});

	it('is a no-op when expectedEntityType does not match the entry', () => {
		const log = logEntityRemoved([], 'debt', createDebt({ id: 'debt_1', name: 'Card' }));
		const result = revertEntityRemoval(log, log[0].id, 'investment');

		expect(result.entity).toBeNull();
		expect(result.log).toEqual(log);
	});

	it('reverts as normal when expectedEntityType matches the entry', () => {
		const investment = createInvestment({ id: 'inv_1', name: 'Vanguard ISA' });
		const log = logEntityRemoved([], 'investment', investment);

		const result = revertEntityRemoval(log, log[0].id, 'investment');

		expect(result.entity).toEqual(investment);
		expect(result.log[0].reverted).toBe(true);
	});
});

describe('describeActivityLogEntry', () => {
	it('describes an added debt', () => {
		const log = logEntityAdded([], 'debt', createDebt({ id: 'debt_1', name: 'Halifax mortgage' }));
		expect(describeActivityLogEntry(log[0])).toBe('Added debt "Halifax mortgage"');
	});

	it('describes a removed investment', () => {
		const log = logEntityRemoved(
			[],
			'investment',
			createInvestment({ id: 'inv_1', name: 'Vanguard ISA' })
		);
		expect(describeActivityLogEntry(log[0])).toBe('Removed investment "Vanguard ISA"');
	});

	it('falls back to a generic label for an unnamed record', () => {
		const log = logEntityAdded([], 'debt', createDebt({ id: 'debt_1', name: '' }));
		expect(describeActivityLogEntry(log[0])).toBe('Added debt an unnamed record');
	});
});
