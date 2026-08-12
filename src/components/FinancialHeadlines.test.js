/**
 * Server-rendered smoke tests for the Financial Headlines dashboard card (issue #264).
 *
 * Same approach as `InvestmentGuidance.test.js`: `svelte/server`'s `render` gives the card's markup
 * as first sent to the browser, which is enough to assert every headline sentence, tone glyph and
 * "Worth knowing" sub-section a user can read.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createDebt, createInvestment, createMonthlyEntry, createProfile } from '$lib/model.js';
import { nuggetToPonder, dadJokeOfTheMonth, curatedResources } from '$lib/worth-knowing.js';
import FinancialHeadlines from './FinancialHeadlines.svelte';

/**
 * @param {number} month
 * @param {number} year
 * @param {{ investments?: number[], debts?: number[] }} [contents]
 * @returns {import('$lib/types.js').MonthlyEntry}
 */
function entry(month, year, contents = {}) {
	const { investments = [], debts = [] } = contents;
	return createMonthlyEntry({
		month,
		year,
		investments: investments.map((value) => createInvestment({ value })),
		debts: debts.map((balance) => createDebt({ balance }))
	});
}

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props) {
	const { body } = render(FinancialHeadlines, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ');
}

describe('FinancialHeadlines', () => {
	it('renders the heading and card structure', () => {
		const body = text({ monthlyEntries: [] });
		expect(body).toContain('Financial Headlines');
		expect(body).toContain('Worth knowing');
	});

	describe('populated case', () => {
		const profile = createProfile({ retirement_target: 30_000 });
		const monthlyEntries = [
			entry(2, 2026, { investments: [1_144_500], debts: [50_000] }),
			entry(1, 2026, { investments: [1_011_167], debts: [60_000] })
		];

		it('shows every headline kind the engine currently produces', () => {
			const body = text({ monthlyEntries, profile });

			// Net worth delta
			expect(body).toContain('Net worth up');
			expect(body).toMatch(/this month\./);
			// Investments delta
			expect(body).toContain('Investments are up');
			expect(body).toContain('keep stacking');
			// Debts delta (falling, since 60,000 -> 50,000)
			expect(body).toContain('Debts are down');
			expect(body).toContain('nice work paying it down');
			// FIRE progress
			expect(body).toContain('of the way to your');
			expect(body).toContain('FI number');
		});

		it('says nothing about needing a second month once two are recorded', () => {
			const body = text({ monthlyEntries, profile });
			expect(body).not.toContain('Only one month is recorded');
		});
	});

	describe('empty/early states', () => {
		it('says plainly that nothing is recorded yet, with no monthly entries', () => {
			const body = text({ monthlyEntries: [] });
			expect(body).toContain('No monthly snapshot recorded yet');
			expect(body).not.toContain('Net worth');
			expect(body).not.toContain('£0');
		});

		it('says a second month is needed for deltas, with exactly one recorded month', () => {
			const body = text({ monthlyEntries: [entry(1, 2026, { investments: [750_000] })] });

			expect(body).toContain('Only one month is recorded so far');
			expect(body).not.toContain('Net worth up');
			expect(body).not.toContain('Net worth down');
		});

		it('still shows a FIRE progress headline from a single month when a target is set', () => {
			const profile = createProfile({ retirement_target: 30_000 });
			const body = text({
				monthlyEntries: [entry(1, 2026, { investments: [750_000] })],
				profile
			});

			expect(body).toContain('Only one month is recorded so far');
			expect(body).toContain('of the way to your');
			expect(body).toContain('FI number');
		});

		it('is an honest empty numeric section for a brand-new household with no FI target', () => {
			const profile = createProfile({ retirement_target: 0 });
			const body = text({
				monthlyEntries: [entry(1, 2026, { investments: [1_000] })],
				profile
			});

			expect(body).toContain('Only one month is recorded so far');
			expect(body).not.toContain('of the way to your');
		});
	});

	describe('"Worth knowing" section', () => {
		it('renders regardless of whether any numeric headlines exist', () => {
			const withNoEntries = text({ monthlyEntries: [] });
			const withHeadlines = text({
				monthlyEntries: [
					entry(2, 2026, { investments: [1_100_000] }),
					entry(1, 2026, { investments: [1_000_000] })
				]
			});

			for (const body of [withNoEntries, withHeadlines]) {
				expect(body).toContain('Worth knowing');
				expect(body).toContain(dadJokeOfTheMonth());
				expect(body).toContain(nuggetToPonder());
				expect(body).toContain('Worth a read or watch');
				for (const resource of curatedResources()) {
					expect(body).toContain(resource.name);
				}
			}
		});
	});
});
