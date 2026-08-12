import { describe, expect, it } from 'vitest';

import {
	curatedResources,
	dadJokeOfTheMonth,
	nuggetToPonder,
	worthKnowing
} from './worth-knowing.js';

describe('dadJokeOfTheMonth', () => {
	it('is deterministic -- the same month always gets the same joke', () => {
		const when = { month: 3, year: 2026 };
		expect(dadJokeOfTheMonth(when)).toBe(dadJokeOfTheMonth(when));
	});

	it('gives different months different jokes, spread across a real sample', () => {
		const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 2026 }));
		const jokes = new Set(months.map(dadJokeOfTheMonth));
		// Not asserting every month is unique (the bank is finite, collisions are expected
		// eventually) -- just that a year's worth of months don't all collapse onto one joke.
		expect(jokes.size).toBeGreaterThan(1);
	});

	it('returns a non-empty string', () => {
		const joke = dadJokeOfTheMonth({ month: 1, year: 2026 });
		expect(typeof joke).toBe('string');
		expect(joke.length).toBeGreaterThan(0);
	});

	it('defaults to the real current calendar month when called with no argument', () => {
		expect(() => dadJokeOfTheMonth()).not.toThrow();
		expect(typeof dadJokeOfTheMonth()).toBe('string');
	});

	it('distinguishes year, not just calendar month number', () => {
		const jokes = new Set([
			dadJokeOfTheMonth({ month: 6, year: 2025 }),
			dadJokeOfTheMonth({ month: 6, year: 2026 }),
			dadJokeOfTheMonth({ month: 6, year: 2027 }),
			dadJokeOfTheMonth({ month: 6, year: 2028 })
		]);
		expect(jokes.size).toBeGreaterThan(1);
	});
});

describe('nuggetToPonder', () => {
	it('is deterministic -- the same month always gets the same nugget', () => {
		const when = { month: 7, year: 2026 };
		expect(nuggetToPonder(when)).toBe(nuggetToPonder(when));
	});

	it('gives different months different nuggets, spread across a real sample', () => {
		const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 2026 }));
		const nuggets = new Set(months.map(nuggetToPonder));
		expect(nuggets.size).toBeGreaterThan(1);
	});

	it('returns a non-empty string', () => {
		const nugget = nuggetToPonder({ month: 1, year: 2026 });
		expect(typeof nugget).toBe('string');
		expect(nugget.length).toBeGreaterThan(0);
	});
});

describe('curatedResources', () => {
	it('returns a non-empty, fixed list', () => {
		const resources = curatedResources();
		expect(resources.length).toBeGreaterThan(0);
		expect(curatedResources()).toEqual(resources);
	});

	it('includes both YouTube channels and websites', () => {
		const types = new Set(curatedResources().map((resource) => resource.type));
		expect(types.has('youtube')).toBe(true);
		expect(types.has('website')).toBe(true);
	});

	it('every entry has a stable id, a valid https url, a name and a description', () => {
		for (const resource of curatedResources()) {
			expect(resource.id).toMatch(/^[a-z0-9-]+$/);
			expect(resource.url).toMatch(/^https:\/\//);
			expect(resource.name.length).toBeGreaterThan(0);
			expect(resource.description.length).toBeGreaterThan(0);
		}
	});

	it('has no duplicate ids', () => {
		const ids = curatedResources().map((resource) => resource.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('worthKnowing', () => {
	it('combines the joke, the nugget and the resources for one month', () => {
		const when = { month: 4, year: 2026 };
		const result = worthKnowing(when);

		expect(result.dadJoke).toBe(dadJokeOfTheMonth(when));
		expect(result.nugget).toBe(nuggetToPonder(when));
		expect(result.resources).toEqual(curatedResources());
	});

	it('defaults to the real current calendar month when called with no argument', () => {
		expect(() => worthKnowing()).not.toThrow();
	});
});
