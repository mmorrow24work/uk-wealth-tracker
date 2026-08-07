/**
 * Server-rendered smoke tests for the dividend tax card (issue #35).
 *
 * As `DividendIncomePlanner.test.js` and every pension card's tests document: no browser test
 * environment, so `svelte/server`'s `render` covers the initial render only. The card's one input
 * (other taxable income) is seeded from `profile.gross_salary`, so the initial render is enough to
 * pin every path through it — the empty state, the sheltered/taxable split, the allowance line, the
 * rate ladder and the per-holding apportionment. The arithmetic itself is covered directly in
 * `$lib/dividend-tax.test.js`.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createDividend, createProfile } from '$lib/model.js';
import DividendTaxSummary from './DividendTaxSummary.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(DividendTaxSummary, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;/g, '’')
		.replace(/\s+/g, ' ');
}

describe('DividendTaxSummary', () => {
	it('shows the tax year and an empty state with no holdings', () => {
		const body = text();
		expect(body).toContain('Dividend tax, 2026/27');
		expect(body).toContain('No dividend holdings recorded yet');
	});

	it('explains the ISA/SIPP shelter and that dividend rates are UK-wide', () => {
		const body = text();
		expect(body).toContain('sheltered completely');
		expect(body).toContain("Scotland's own bands do not apply to dividends");
	});

	it('splits a portfolio into sheltered and taxable income', () => {
		const body = text({
			dividends: [
				createDividend({
					name: 'ISA fund',
					wrapper: 'isa_stocks_shares',
					value: 50_000,
					yield_pct: 4
				}),
				createDividend({ name: 'GIA fund', wrapper: 'gia', value: 60_000, yield_pct: 4 })
			],
			profile: createProfile({ gross_salary: 30_000 })
		});

		expect(body).toContain('£2,000/yr'); // sheltered
		expect(body).toContain('£2,400/yr'); // taxable
		expect(body).toContain('1 holding in an ISA/SIPP');
		expect(body).toContain('1 holding in a GIA or unwrapped');
	});

	it('taxes a basic-rate taxpayer’s GIA holding at the ordinary rate', () => {
		const body = text({
			dividends: [
				createDividend({ name: 'GIA fund', wrapper: 'gia', value: 60_000, yield_pct: 4 })
			],
			profile: createProfile({ gross_salary: 30_000 })
		});

		expect(body).toContain('Ordinary rate');
		expect(body).toContain('10.75%');
		expect(body).toContain('£204.25'); // (2,400 - 500) at 10.75%
		expect(body).toContain('£500.00 used'); // the whole dividend allowance
	});

	it('taxes a higher-rate taxpayer’s GIA holding at the upper rate', () => {
		const body = text({
			dividends: [
				createDividend({ name: 'GIA fund', wrapper: 'gia', value: 60_000, yield_pct: 4 })
			],
			profile: createProfile({ gross_salary: 80_000 })
		});

		expect(body).toContain('35.75%');
		expect(body).toContain('£679.25'); // (2,400 - 500) at 35.75%
		expect(body).toContain('next dividend pound taxed at 35.75%');
	});

	it('shows the allowance headroom while nothing is taxable yet', () => {
		const body = text({
			dividends: [
				createDividend({ name: 'Small GIA', wrapper: 'gia', value: 4_500, yield_pct: 4 })
			],
			profile: createProfile({ gross_salary: 30_000 })
		});

		expect(body).toContain('£180.00 used, £320.00 left');
		expect(body).toContain('£320.00 more in dividends outside a wrapper before any dividend tax');
	});

	it('reports the personal allowance covering dividends where other income is low', () => {
		const body = text({
			dividends: [
				createDividend({ name: 'GIA fund', wrapper: 'gia', value: 50_000, yield_pct: 4 })
			],
			profile: createProfile({ gross_salary: 0 })
		});

		expect(body).toContain('Your personal allowance covered');
		expect(body).toContain('Personal allowance');
	});

	it('prices what the ISA shelter is worth against an all-GIA portfolio', () => {
		const body = text({
			dividends: [
				createDividend({
					name: 'ISA fund',
					wrapper: 'isa_stocks_shares',
					value: 50_000,
					yield_pct: 4
				}),
				createDividend({ name: 'GIA fund', wrapper: 'gia', value: 60_000, yield_pct: 4 })
			],
			profile: createProfile({ gross_salary: 30_000 })
		});

		expect(body).toContain('saves £215 of tax this year');
		expect(body).toContain('would cost £419');
	});

	it('says the shelter is worth nothing yet where allowances would cover it all anyway', () => {
		const body = text({
			dividends: [
				createDividend({
					name: 'ISA fund',
					wrapper: 'isa_stocks_shares',
					value: 5_000,
					yield_pct: 4
				}),
				createDividend({ name: 'GIA fund', wrapper: 'gia', value: 5_000, yield_pct: 4 })
			],
			profile: createProfile({ gross_salary: 30_000 })
		});

		expect(body).toContain('ISA/SIPP shelter is worth nothing this year');
		expect(body).not.toContain('saves £0 of tax');
	});

	it('lists every holding with its wrapper and its share of the tax', () => {
		const body = text({
			dividends: [
				createDividend({
					name: 'ISA fund',
					wrapper: 'isa_stocks_shares',
					value: 50_000,
					yield_pct: 4
				}),
				createDividend({ name: 'Direct shares', wrapper: 'none', value: 20_000, yield_pct: 3 })
			],
			profile: createProfile({ gross_salary: 30_000 })
		});

		expect(body).toContain('ISA fund');
		expect(body).toContain('Stocks & Shares ISA · sheltered');
		expect(body).toContain('Direct shares');
		expect(body).toContain('Unwrapped');
	});

	it('says nothing is sheltered when every holding is taxable', () => {
		const body = text({
			dividends: [
				createDividend({ name: 'GIA fund', wrapper: 'gia', value: 60_000, yield_pct: 4 })
			],
			profile: createProfile({ gross_salary: 30_000 })
		});

		expect(body).toContain('Nothing here is sheltered');
	});

	it('leaves the allowance untouched on an all-sheltered portfolio', () => {
		const body = text({
			dividends: [
				createDividend({
					name: 'ISA fund',
					wrapper: 'isa_stocks_shares',
					value: 50_000,
					yield_pct: 4
				})
			],
			profile: createProfile({ gross_salary: 30_000 })
		});

		expect(body).toContain('every holding is sheltered');
		expect(body).not.toContain('Rate by rate');
	});

	it('warns when dividends have tapered the personal allowance away', () => {
		const body = text({
			dividends: [
				createDividend({ name: 'GIA fund', wrapper: 'gia', value: 200_000, yield_pct: 5 })
			],
			profile: createProfile({ gross_salary: 95_000 })
		});

		expect(body).toContain('personal allowance is tapered to');
		expect(body).toContain('dividends count towards that total');
	});
});
