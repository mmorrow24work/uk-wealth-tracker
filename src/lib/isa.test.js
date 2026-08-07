/**
 * ISA allowance tracker, 2026/27 — issue #28.
 *
 * Three things worth pinning independently: the shared-vs-separate shape of the allowances (the
 * five adult wrappers pool one £20,000 limit; the JISA has its own, unrelated £9,000; the Lifetime
 * ISA has a second £4,000 cap *inside* the adult pool rather than beside it), the annualisation of
 * a holding's recorded contribution pace, and the tax-year day count clamping sensibly outside its
 * own boundaries.
 */
import { describe, expect, it } from 'vitest';

import { createInvestment } from './model.js';
import {
	ADULT_ISA_ALLOWANCE,
	ADULT_ISA_WRAPPERS,
	ISA_TAX_YEAR,
	ISA_TAX_YEAR_END,
	ISA_TAX_YEAR_START,
	isaAllowanceSummary,
	isaContributionPace,
	isaTaxYearProgress,
	JISA_ALLOWANCE,
	LISA_ANNUAL_SUBLIMIT
} from './isa.js';

/**
 * `Array.prototype.find` types its result as possibly `undefined`; every call site here knows the
 * wrapper it asks for is always present (all six are always returned), so this narrows that away
 * rather than repeating a null check in every test.
 *
 * @template T
 * @param {readonly T[]} array
 * @param {(item: T) => boolean} predicate
 * @returns {T}
 */
function findOrThrow(array, predicate) {
	const found = array.find(predicate);
	if (!found) throw new Error('Expected to find a matching item, found none.');
	return found;
}

describe('the 2026/27 figures', () => {
	it('pins the three limits from README.md', () => {
		expect(ADULT_ISA_ALLOWANCE).toBe(20_000);
		expect(JISA_ALLOWANCE).toBe(9_000);
		expect(LISA_ANNUAL_SUBLIMIT).toBe(4_000);
		expect(ISA_TAX_YEAR).toBe('2026/27');
	});

	it('lists every ISA wrapper except the JISA as sharing the adult allowance', () => {
		expect(ADULT_ISA_WRAPPERS).toEqual([
			'isa_stocks_shares',
			'isa_cash',
			'lisa',
			'ifisa',
			'htb_isa'
		]);
	});

	it('is labelled with the tax year on every summary', () => {
		expect(isaAllowanceSummary({}).taxYear).toBe('2026/27');
	});
});

describe('isaAllowanceSummary — the shared adult allowance', () => {
	it('reports the full £20,000 free with nothing contributed', () => {
		const result = isaAllowanceSummary({});

		expect(result.adult).toEqual({
			contributed: 0,
			limit: 20_000,
			remaining: 20_000,
			overLimit: 0
		});
		expect(result.jisa).toEqual({ contributed: 0, limit: 9_000, remaining: 9_000, overLimit: 0 });
	});

	it('pools contributions across every adult wrapper against one £20,000 limit', () => {
		const result = isaAllowanceSummary({ isa_stocks_shares: 12_000, isa_cash: 5_000 });

		expect(result.adult.contributed).toBe(17_000);
		expect(result.adult.remaining).toBe(3_000);
		// Neither wrapper has its own separate cap, so both see the same £3,000 left.
		const stocksAndShares = findOrThrow(result.wrappers, (w) => w.wrapper === 'isa_stocks_shares');
		const cash = findOrThrow(result.wrappers, (w) => w.wrapper === 'isa_cash');
		expect(stocksAndShares.remaining).toBe(3_000);
		expect(cash.remaining).toBe(3_000);
	});

	it('flags the adult allowance as exceeded once contributions pass £20,000', () => {
		const result = isaAllowanceSummary({ isa_stocks_shares: 21_000 });

		expect(result.adult.overLimit).toBe(1_000);
		expect(result.adult.remaining).toBe(0);
		const stocksAndShares = findOrThrow(result.wrappers, (w) => w.wrapper === 'isa_stocks_shares');
		expect(stocksAndShares.overLimit).toBe(true);
		expect(stocksAndShares.overBy).toBe(1_000);
	});

	it('never lets remaining or overLimit go negative in the other direction', () => {
		const result = isaAllowanceSummary({ isa_cash: 5_000 });

		expect(result.adult.overLimit).toBe(0);
	});

	it('treats a missing or negative entry as zero', () => {
		const result = isaAllowanceSummary({ isa_cash: -500 });

		expect(result.adult.contributed).toBe(0);
	});
});

describe('isaAllowanceSummary — the Junior ISA', () => {
	it('keeps the JISA allowance completely separate from the adult total', () => {
		const result = isaAllowanceSummary({ jisa: 9_000, isa_cash: 20_000 });

		expect(result.jisa.remaining).toBe(0);
		expect(result.adult.remaining).toBe(0);
		expect(result.adult.contributed).toBe(20_000);
		// The JISA contribution does not count towards the adult total, or vice versa.
		const jisa = findOrThrow(result.wrappers, (w) => w.wrapper === 'jisa');
		expect(jisa.group).toBe('jisa');
	});

	it('flags the JISA as exceeded past £9,000 without touching the adult allowance', () => {
		const result = isaAllowanceSummary({ jisa: 10_000 });

		const jisa = findOrThrow(result.wrappers, (w) => w.wrapper === 'jisa');
		expect(jisa.overLimit).toBe(true);
		expect(jisa.overBy).toBe(1_000);
		expect(jisa.remaining).toBe(0);
		expect(result.adult.overLimit).toBe(0);
	});
});

describe('isaAllowanceSummary — the Lifetime ISA sub-limit', () => {
	it('caps the Lifetime ISA at £4,000 even with adult headroom to spare', () => {
		const result = isaAllowanceSummary({ lisa: 4_000 });

		const lisa = findOrThrow(result.wrappers, (w) => w.wrapper === 'lisa');
		expect(lisa.remaining).toBe(0);
		expect(lisa.overLimit).toBe(false);
		expect(result.adult.remaining).toBe(16_000);
	});

	it('flags the Lifetime ISA as over its own sub-limit even though the adult total is fine', () => {
		const result = isaAllowanceSummary({ lisa: 5_000 });

		expect(result.lisaSublimit.overLimit).toBe(1_000);
		expect(result.adult.overLimit).toBe(0);
		const lisa = findOrThrow(result.wrappers, (w) => w.wrapper === 'lisa');
		expect(lisa.overLimit).toBe(true);
		expect(lisa.overBy).toBe(1_000);
		expect(lisa.remaining).toBe(0);
	});

	it('reports the adult overage for the Lifetime ISA when that is the tighter breach', () => {
		// £4,000 in the LISA (within its own sub-limit) plus £17,000 elsewhere blows the shared
		// £20,000 adult total by £1,000, even though the LISA sub-limit itself is untouched.
		const result = isaAllowanceSummary({ lisa: 4_000, isa_cash: 17_000 });

		const lisa = findOrThrow(result.wrappers, (w) => w.wrapper === 'lisa');
		expect(result.lisaSublimit.overLimit).toBe(0);
		expect(result.adult.overLimit).toBe(1_000);
		expect(lisa.overLimit).toBe(true);
		expect(lisa.overBy).toBe(1_000);
	});

	it("caps the Lifetime ISA's remaining allowance at whichever of the two limits is tighter", () => {
		// £17,000 already used elsewhere in the adult pool leaves only £3,000 of adult headroom,
		// tighter than the LISA's own £4,000 sub-limit (untouched).
		const result = isaAllowanceSummary({ isa_cash: 17_000 });

		const lisa = findOrThrow(result.wrappers, (w) => w.wrapper === 'lisa');
		expect(lisa.remaining).toBe(3_000);
	});
});

describe('isaAllowanceSummary — Help to Buy ISA', () => {
	it('flags Help to Buy as closed to new accounts, unlike every other wrapper', () => {
		const result = isaAllowanceSummary({});

		for (const w of result.wrappers) {
			expect(w.closedToNewAccounts).toBe(w.wrapper === 'htb_isa');
		}
	});
});

describe('isaAllowanceSummary — totals', () => {
	it('sums the adult and JISA totals as an informational figure only', () => {
		const result = isaAllowanceSummary({ isa_cash: 10_000, jisa: 4_000 });

		expect(result.totalContributed).toBe(14_000);
	});

	it('lists all six wrappers in ISA_WRAPPERS order', () => {
		const result = isaAllowanceSummary({});

		expect(result.wrappers.map((w) => w.wrapper)).toEqual([
			'isa_stocks_shares',
			'isa_cash',
			'lisa',
			'jisa',
			'ifisa',
			'htb_isa'
		]);
	});
});

describe('isaContributionPace', () => {
	it('annualises a monthly ISA contribution at 12x', () => {
		const investment = createInvestment({
			wrapper: 'isa_stocks_shares',
			monthly_contribution: 500,
			contribution_frequency: 'monthly'
		});

		const pace = isaContributionPace([investment]);

		expect(pace.isa_stocks_shares).toBe(6_000);
	});

	it('annualises a quarterly ISA contribution the same way fire.js does', () => {
		const investment = createInvestment({
			wrapper: 'isa_cash',
			monthly_contribution: 300,
			contribution_frequency: 'quarterly'
		});

		const pace = isaContributionPace([investment]);

		// £300 every 3 months = £100/month equivalent = £1,200/year.
		expect(pace.isa_cash).toBe(1_200);
	});

	it('sums multiple holdings in the same wrapper', () => {
		const holdings = [
			createInvestment({
				wrapper: 'lisa',
				monthly_contribution: 200,
				contribution_frequency: 'monthly'
			}),
			createInvestment({
				wrapper: 'lisa',
				monthly_contribution: 100,
				contribution_frequency: 'monthly'
			})
		];

		const pace = isaContributionPace(holdings);

		expect(pace.lisa).toBe(3_600);
	});

	it('ignores holdings in non-ISA wrappers, e.g. a GIA or SIPP', () => {
		const holdings = [
			createInvestment({
				wrapper: 'gia',
				monthly_contribution: 1_000,
				contribution_frequency: 'monthly'
			}),
			createInvestment({
				wrapper: 'sipp',
				monthly_contribution: 500,
				contribution_frequency: 'monthly'
			})
		];

		const pace = isaContributionPace(holdings);

		expect(Object.values(pace).every((v) => v === 0)).toBe(true);
	});

	it('returns all six wrappers at 0 with no holdings', () => {
		const pace = isaContributionPace([]);

		expect(pace).toEqual({
			isa_stocks_shares: 0,
			isa_cash: 0,
			lisa: 0,
			jisa: 0,
			ifisa: 0,
			htb_isa: 0
		});
	});
});

describe('isaTaxYearProgress', () => {
	it('names 2026/27 as a 365-day tax year', () => {
		expect(ISA_TAX_YEAR_START).toBe('2026-04-06');
		expect(ISA_TAX_YEAR_END).toBe('2027-04-05');
		expect(isaTaxYearProgress(new Date('2026-04-06T00:00:00Z')).daysTotal).toBe(365);
	});

	it('reports the full year remaining on the first day', () => {
		const result = isaTaxYearProgress(new Date('2026-04-06T00:00:00Z'));

		expect(result.daysRemaining).toBe(365);
		expect(result.fractionElapsed).toBe(0);
	});

	it('reports one day remaining on the last day', () => {
		const result = isaTaxYearProgress(new Date('2027-04-05T18:00:00Z'));

		expect(result.daysRemaining).toBe(1);
	});

	it('counts down correctly for a date partway through the year', () => {
		const result = isaTaxYearProgress(new Date('2026-08-07T09:00:00Z'));

		expect(result.daysRemaining).toBe(242);
		expect(result.daysTotal).toBe(365);
		expect(result.fractionElapsed).toBeCloseTo(123 / 365, 3);
	});

	it('clamps to the full year for a date before the tax year starts', () => {
		const result = isaTaxYearProgress(new Date('2026-01-01T00:00:00Z'));

		expect(result.daysRemaining).toBe(365);
		expect(result.fractionElapsed).toBe(0);
	});

	it('clamps to zero remaining for a date after the tax year ends', () => {
		const result = isaTaxYearProgress(new Date('2027-06-01T00:00:00Z'));

		expect(result.daysRemaining).toBe(0);
		expect(result.fractionElapsed).toBe(1);
	});
});
