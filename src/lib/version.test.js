import { describe, expect, it } from 'vitest';
import { codenameForSha } from './version.js';

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
