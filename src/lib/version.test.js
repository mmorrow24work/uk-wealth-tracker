import { describe, expect, it } from 'vitest';
import { codenameForSha, formatCommitDate } from './version.js';

describe('codenameForSha', () => {
	it('is deterministic -- the same SHA always gets the same name', () => {
		expect(codenameForSha('b3a0925')).toBe(codenameForSha('b3a0925'));
	});

	it('is "adjective noun", both lowercase, single space between', () => {
		const name = codenameForSha('b3a0925');
		expect(name).toMatch(/^[a-z]+ [a-z]+$/);
	});

	it('gives different SHAs different names, spread across a real sample', () => {
		const shas = [
			'b3a0925',
			'5b38977',
			'34e1be7',
			'd6d0f5e',
			'8d3c7da',
			'72c9c5f',
			'7097b54',
			'34dd519'
		];
		const names = new Set(shas.map(codenameForSha));
		// Not asserting every one is unique (the word lists are finite, collisions are expected
		// eventually) -- just that a handful of real commit SHAs don't all collapse onto one name.
		expect(names.size).toBeGreaterThan(1);
	});

	it('resolves a missing/empty SHA to a stable name rather than throwing', () => {
		expect(() => codenameForSha('')).not.toThrow();
		expect(codenameForSha('')).toBe(codenameForSha(''));
	});
});

describe('formatCommitDate', () => {
	it('formats a valid ISO 8601 commit timestamp as a readable local date + time', () => {
		// Not asserting an exact clock value -- the formatter renders in the runner's own local
		// timezone (same as ActivityLog.svelte/GitHubSignIn.svelte's identical convention), which
		// varies between dev machines and CI. Assert the "12 Aug 2026, 14:03"-shaped output instead.
		expect(formatCommitDate('2026-08-12T14:03:21+01:00')).toMatch(
			/^\d{1,2} \w{3} \d{4}, \d{2}:\d{2}$/
		);
	});

	it('returns "" for a missing commit date (local dev without git, a shallow clone)', () => {
		expect(formatCommitDate('')).toBe('');
	});

	it('returns "" rather than "Invalid Date" for an unparseable commit date', () => {
		expect(formatCommitDate('not-a-date')).toBe('');
	});
});
