import { describe, expect, it } from 'vitest';

import { CONTRIBUTION_FREQUENCIES } from './enums.js';
import { createDebt, createInvestment, createMonthlyEntry, monthlyEntryKey } from './model.js';
import {
	CONTRIBUTION_PERIOD_MONTHS,
	DEFAULT_GROWTH_RATE,
	MAX_FILL_MONTHS,
	addMonths,
	autoFilledEntries,
	contributionForOffset,
	fillMissingMonths,
	findMissingMonths,
	monthlyGrowthRate,
	monthsBetween,
	netAnnualGrowthRate,
	projectHoldingValue,
	stripAutoFilledEntries
} from './auto-invest.js';

/** Values are money, so compare to the penny rather than to floating-point exactness. */
const PENNY = 0.005;

/* -------------------------------------------------------------------------- */
/* Calendar arithmetic                                                         */
/* -------------------------------------------------------------------------- */

describe('addMonths', () => {
	it('moves within a year', () => {
		expect(addMonths({ month: 3, year: 2026 }, 2)).toEqual({ month: 5, year: 2026 });
	});

	it('rolls over the year boundary', () => {
		expect(addMonths({ month: 11, year: 2026 }, 3)).toEqual({ month: 2, year: 2027 });
	});

	it('rolls backwards over the year boundary', () => {
		expect(addMonths({ month: 2, year: 2026 }, -3)).toEqual({ month: 11, year: 2025 });
	});

	it('handles a whole number of years', () => {
		expect(addMonths({ month: 6, year: 2026 }, 24)).toEqual({ month: 6, year: 2028 });
	});

	it('is a no-op for zero', () => {
		expect(addMonths({ month: 6, year: 2026 }, 0)).toEqual({ month: 6, year: 2026 });
	});
});

describe('monthsBetween', () => {
	it('is 1 for consecutive months', () => {
		expect(monthsBetween({ month: 1, year: 2026 }, { month: 2, year: 2026 })).toBe(1);
	});

	it('is 0 for the same month', () => {
		expect(monthsBetween({ month: 7, year: 2026 }, { month: 7, year: 2026 })).toBe(0);
	});

	it('counts across a year boundary', () => {
		expect(monthsBetween({ month: 11, year: 2025 }, { month: 2, year: 2026 })).toBe(3);
	});

	it('is negative when the second month is earlier', () => {
		expect(monthsBetween({ month: 5, year: 2026 }, { month: 2, year: 2026 })).toBe(-3);
	});
});

describe('findMissingMonths', () => {
	/** @param {[number, number][]} months `[month, year]` pairs. */
	const entriesFor = (months) => months.map(([month, year]) => createMonthlyEntry({ month, year }));

	it('finds a single skipped month', () => {
		const missing = findMissingMonths(
			entriesFor([
				[1, 2026],
				[3, 2026]
			])
		);
		expect(missing).toEqual([{ month: 2, year: 2026 }]);
	});

	it('finds every month of a multi-month gap, oldest first', () => {
		const missing = findMissingMonths(
			entriesFor([
				[11, 2025],
				[3, 2026]
			])
		);
		expect(missing).toEqual([
			{ month: 12, year: 2025 },
			{ month: 1, year: 2026 },
			{ month: 2, year: 2026 }
		]);
	});

	it('finds gaps in unsorted input', () => {
		const missing = findMissingMonths(
			entriesFor([
				[4, 2026],
				[1, 2026],
				[2, 2026]
			])
		);
		expect(missing).toEqual([{ month: 3, year: 2026 }]);
	});

	it('returns nothing for a continuous history', () => {
		const missing = findMissingMonths(
			entriesFor([
				[1, 2026],
				[2, 2026],
				[3, 2026]
			])
		);
		expect(missing).toEqual([]);
	});

	it('returns nothing for fewer than two entries', () => {
		expect(findMissingMonths([])).toEqual([]);
		expect(findMissingMonths(entriesFor([[1, 2026]]))).toEqual([]);
	});

	it('never reports a month outside the recorded range', () => {
		const missing = findMissingMonths(
			entriesFor([
				[6, 2026],
				[8, 2026]
			])
		);
		expect(missing).toEqual([{ month: 7, year: 2026 }]);
	});

	it('counts auto-filled entries as present', () => {
		const entries = [
			createMonthlyEntry({ month: 1, year: 2026 }),
			createMonthlyEntry({ month: 2, year: 2026, auto_filled: true }),
			createMonthlyEntry({ month: 3, year: 2026 })
		];
		expect(findMissingMonths(entries)).toEqual([]);
		expect(findMissingMonths(stripAutoFilledEntries(entries))).toEqual([{ month: 2, year: 2026 }]);
	});
});

/* -------------------------------------------------------------------------- */
/* Compounding                                                                 */
/* -------------------------------------------------------------------------- */

describe('monthlyGrowthRate', () => {
	it('compounds to exactly the annual rate over twelve months', () => {
		const monthly = monthlyGrowthRate(5);
		expect((1 + monthly) ** 12 - 1).toBeCloseTo(0.05, 12);
	});

	it('is the geometric rate, not annual/12', () => {
		// 1.05^(1/12) - 1 = 0.4074%/month, against the 0.4167% a naive division would give.
		expect(monthlyGrowthRate(5)).toBeCloseTo(0.004074, 6);
		expect(monthlyGrowthRate(5)).toBeLessThan(5 / 100 / 12);
	});

	it('is zero for no growth', () => {
		expect(monthlyGrowthRate(0)).toBe(0);
	});

	it('handles a negative annual rate', () => {
		const monthly = monthlyGrowthRate(-12);
		expect(monthly).toBeLessThan(0);
		expect((1 + monthly) ** 12 - 1).toBeCloseTo(-0.12, 12);
	});

	it('returns -1 rather than NaN for a total loss', () => {
		expect(monthlyGrowthRate(-100)).toBe(-1);
		expect(monthlyGrowthRate(-150)).toBe(-1);
	});
});

describe('netAnnualGrowthRate', () => {
	it('compounds the fee against growth rather than subtracting it', () => {
		// (1.05 × 0.9978) - 1 = 4.769%, not 5 - 0.22 = 4.78%.
		expect(netAnnualGrowthRate(5, 0.22)).toBeCloseTo(4.769, 6);
		expect(netAnnualGrowthRate(5, 0.22)).toBeLessThan(5 - 0.22);
	});

	it('is the gross rate when there is no fee', () => {
		expect(netAnnualGrowthRate(7, 0)).toBeCloseTo(7, 12);
	});

	it('is always below the gross rate for a positive fee', () => {
		expect(netAnnualGrowthRate(5, 1)).toBeLessThan(5);
	});
});

describe('contributionForOffset', () => {
	it('pays a monthly holding every month', () => {
		const investment = createInvestment({
			monthly_contribution: 250,
			contribution_frequency: 'monthly'
		});
		expect([1, 2, 3, 4].map((n) => contributionForOffset(investment, n))).toEqual([
			250, 250, 250, 250
		]);
	});

	it('pays a quarterly holding its full amount every third month', () => {
		const investment = createInvestment({
			monthly_contribution: 900,
			contribution_frequency: 'quarterly'
		});
		expect([1, 2, 3, 4, 5, 6].map((n) => contributionForOffset(investment, n))).toEqual([
			0, 0, 900, 0, 0, 900
		]);
	});

	it('pays an annual holding once every twelve months', () => {
		const investment = createInvestment({
			monthly_contribution: 20_000,
			contribution_frequency: 'annually'
		});
		expect(contributionForOffset(investment, 11)).toBe(0);
		expect(contributionForOffset(investment, 12)).toBe(20_000);
		expect(contributionForOffset(investment, 24)).toBe(20_000);
	});

	it('never repeats a one-off contribution', () => {
		const investment = createInvestment({
			monthly_contribution: 5_000,
			contribution_frequency: 'one_off'
		});
		expect([1, 2, 3, 12, 60].map((n) => contributionForOffset(investment, n))).toEqual([
			0, 0, 0, 0, 0
		]);
	});

	it('pays nothing at the anchor month itself', () => {
		const investment = createInvestment({ monthly_contribution: 250 });
		expect(contributionForOffset(investment, 0)).toBe(0);
	});

	it('has a period defined for every contribution frequency', () => {
		for (const frequency of CONTRIBUTION_FREQUENCIES) {
			expect(CONTRIBUTION_PERIOD_MONTHS[frequency]).toBeGreaterThan(0);
		}
	});
});

describe('projectHoldingValue', () => {
	it('grows then contributes, so a contribution earns nothing in the month it is paid', () => {
		const investment = createInvestment({
			value: 10_000,
			monthly_contribution: 500,
			fund_fee: 0
		});
		// 10,000 × 1.05^(1/12) + 500
		expect(projectHoldingValue(investment, 1, { growthRate: 5 })).toBeCloseTo(10_540.74, 2);
	});

	it('applies no growth at all at 0%', () => {
		const investment = createInvestment({ value: 10_000, monthly_contribution: 100, fund_fee: 0 });
		expect(projectHoldingValue(investment, 1, { growthRate: 0 })).toBe(10_100);
	});

	it('deducts the fund fee by default', () => {
		const investment = createInvestment({ value: 10_000, fund_fee: 0.5 });
		const gross = projectHoldingValue(investment, 1, { growthRate: 5, applyFundFees: false });
		expect(projectHoldingValue(investment, 1, { growthRate: 5 })).toBeLessThan(gross);
	});

	it('ignores the fund fee when applyFundFees is false', () => {
		const withFee = createInvestment({ value: 10_000, fund_fee: 0.75 });
		const withoutFee = createInvestment({ value: 10_000, fund_fee: 0 });
		expect(projectHoldingValue(withFee, 1, { growthRate: 5, applyFundFees: false })).toBe(
			projectHoldingValue(withoutFee, 1, { growthRate: 5, applyFundFees: false })
		);
	});

	it('defaults to the profile default growth rate', () => {
		const investment = createInvestment({ value: 1_000, fund_fee: 0 });
		expect(projectHoldingValue(investment, 1)).toBe(
			projectHoldingValue(investment, 1, { growthRate: DEFAULT_GROWTH_RATE })
		);
	});

	it('rounds to whole pence', () => {
		const investment = createInvestment({ value: 3_333.33, fund_fee: 0 });
		const value = projectHoldingValue(investment, 1, { growthRate: 5 });
		expect(value).toBe(Math.round(value * 100) / 100);
	});

	it('shrinks a holding at a negative growth rate', () => {
		const investment = createInvestment({ value: 10_000, fund_fee: 0 });
		expect(projectHoldingValue(investment, 1, { growthRate: -20 })).toBeLessThan(10_000);
	});

	it('never returns a negative value', () => {
		const investment = createInvestment({ value: 10_000, fund_fee: 0 });
		expect(projectHoldingValue(investment, 1, { growthRate: -100 })).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Filling                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * @param {number} month
 * @param {number} year
 * @param {Partial<import('./types.js').MonthlyEntry>} [overrides]
 */
function entry(month, year, overrides = {}) {
	return createMonthlyEntry({ month, year, ...overrides });
}

/** A single holding with no fee, so test arithmetic stays readable. */
function holding(overrides = {}) {
	return createInvestment({ name: 'Global All Cap', value: 10_000, fund_fee: 0, ...overrides });
}

describe('stripAutoFilledEntries / autoFilledEntries', () => {
	const entries = [entry(1, 2026), entry(2, 2026, { auto_filled: true }), entry(3, 2026)];

	it('keeps only recorded entries', () => {
		expect(stripAutoFilledEntries(entries).map(monthlyEntryKey)).toEqual(['2026-01', '2026-03']);
	});

	it('selects only generated entries', () => {
		expect(autoFilledEntries(entries).map(monthlyEntryKey)).toEqual(['2026-02']);
	});

	it('does not mutate the input', () => {
		const original = [...entries];
		stripAutoFilledEntries(entries);
		autoFilledEntries(entries);
		expect(entries).toEqual(original);
	});
});

describe('fillMissingMonths', () => {
	it('returns an empty list when there is nothing recorded', () => {
		expect(fillMissingMonths([])).toEqual([]);
	});

	it('leaves a single snapshot alone', () => {
		const only = entry(6, 2026, { investments: [holding()] });
		expect(fillMissingMonths([only])).toEqual([only]);
	});

	it('leaves a continuous history alone', () => {
		const entries = [entry(1, 2026), entry(2, 2026), entry(3, 2026)];
		const filled = fillMissingMonths(entries);
		expect(filled.map(monthlyEntryKey)).toEqual(['2026-01', '2026-02', '2026-03']);
		expect(autoFilledEntries(filled)).toEqual([]);
	});

	it('bridges a one-month gap', () => {
		const filled = fillMissingMonths([
			entry(1, 2026, { investments: [holding()] }),
			entry(3, 2026, { investments: [holding({ value: 11_000 })] })
		]);
		expect(filled.map(monthlyEntryKey)).toEqual(['2026-01', '2026-02', '2026-03']);
		expect(filled[1].auto_filled).toBe(true);
		expect(filled[0].auto_filled).toBe(false);
		expect(filled[2].auto_filled).toBe(false);
	});

	it('bridges a gap that spans a year boundary', () => {
		const filled = fillMissingMonths([entry(11, 2025), entry(2, 2026)]);
		expect(filled.map(monthlyEntryKey)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
	});

	it('sorts unsorted input before filling', () => {
		const filled = fillMissingMonths([entry(4, 2026), entry(1, 2026)]);
		expect(filled.map(monthlyEntryKey)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
	});

	it('fills several separate gaps', () => {
		const filled = fillMissingMonths([entry(1, 2026), entry(3, 2026), entry(6, 2026)]);
		expect(filled.map(monthlyEntryKey)).toEqual([
			'2026-01',
			'2026-02',
			'2026-03',
			'2026-04',
			'2026-05',
			'2026-06'
		]);
		expect(autoFilledEntries(filled).map(monthlyEntryKey)).toEqual([
			'2026-02',
			'2026-04',
			'2026-05'
		]);
	});

	it('never alters the recorded snapshot that closes a gap', () => {
		const march = entry(3, 2026, { investments: [holding({ value: 7_500 })] });
		const filled = fillMissingMonths([entry(1, 2026, { investments: [holding()] }), march]);
		expect(filled.at(-1)).toEqual(march);
	});

	it('does not mutate the entries it was given', () => {
		const entries = [entry(1, 2026, { investments: [holding()] }), entry(3, 2026)];
		const snapshot = structuredClone(entries);
		fillMissingMonths(entries);
		expect(entries).toEqual(snapshot);
	});

	it('gives each filled month its own holding records', () => {
		const filled = fillMissingMonths([
			entry(1, 2026, { investments: [holding({ monthly_contribution: 100 })] }),
			entry(4, 2026)
		]);
		const february = filled[1].investments[0];
		const march = filled[2].investments[0];
		expect(february).not.toBe(march);
		expect(march.value).toBeGreaterThan(february.value);
	});

	/* ---------------------------------------------------------------------- */
	/* The arithmetic itself                                                   */
	/* ---------------------------------------------------------------------- */

	it('compounds month on month rather than applying growth once', () => {
		const filled = fillMissingMonths(
			[entry(1, 2026, { investments: [holding({ monthly_contribution: 0 })] }), entry(5, 2026)],
			{ growthRate: 5 }
		);
		const monthly = 1.05 ** (1 / 12);
		expect(filled[1].investments[0].value).toBeCloseTo(10_000 * monthly, 2);
		expect(filled[2].investments[0].value).toBeCloseTo(10_000 * monthly ** 2, PENNY);
		expect(filled[3].investments[0].value).toBeCloseTo(10_000 * monthly ** 3, PENNY);
	});

	it('reproduces the annual rate exactly over twelve filled months', () => {
		const filled = fillMissingMonths(
			[
				entry(1, 2026, { investments: [holding({ monthly_contribution: 0 })] }),
				entry(2, 2027, { investments: [holding()] })
			],
			{ growthRate: 5 }
		);
		// The last *filled* month is 2027-01: twelve months of growth on £10,000 = £10,500.
		expect(filled.at(-2)?.investments[0].value).toBeCloseTo(10_500, PENNY);
	});

	it('adds the monthly contribution after growth, not before', () => {
		const filled = fillMissingMonths(
			[entry(1, 2026, { investments: [holding({ monthly_contribution: 500 })] }), entry(3, 2026)],
			{ growthRate: 12 }
		);
		const monthly = 1.12 ** (1 / 12);
		expect(filled[1].investments[0].value).toBeCloseTo(10_000 * monthly + 500, PENNY);
		// Paying at the start of the month would have grown the £500 too.
		expect(filled[1].investments[0].value).toBeLessThan(10_500 * monthly);
	});

	it('pays a quarterly holding only in the third filled month', () => {
		const filled = fillMissingMonths(
			[
				entry(1, 2026, {
					investments: [holding({ monthly_contribution: 900, contribution_frequency: 'quarterly' })]
				}),
				entry(6, 2026)
			],
			{ growthRate: 0 }
		);
		expect(filled.slice(1, 5).map((e) => e.investments[0].value)).toEqual([
			10_000, 10_000, 10_900, 10_900
		]);
	});

	it('never pays a one-off contribution into a filled month', () => {
		const filled = fillMissingMonths(
			[
				entry(1, 2026, {
					investments: [holding({ monthly_contribution: 5_000, contribution_frequency: 'one_off' })]
				}),
				entry(5, 2026)
			],
			{ growthRate: 0 }
		);
		expect(filled.slice(1, 4).every((e) => e.investments[0].value === 10_000)).toBe(true);
	});

	it('nets each holding’s own fund fee off the shared growth rate', () => {
		const filled = fillMissingMonths(
			[
				entry(1, 2026, {
					investments: [
						holding({ name: 'Cheap tracker', fund_fee: 0.07, monthly_contribution: 0 }),
						holding({ name: 'Expensive fund', fund_fee: 1.5, monthly_contribution: 0 })
					]
				}),
				entry(3, 2026)
			],
			{ growthRate: 5 }
		);
		const [cheap, expensive] = filled[1].investments;
		expect(cheap.value).toBeGreaterThan(expensive.value);
	});

	it('treats every holding identically when applyFundFees is false', () => {
		const filled = fillMissingMonths(
			[
				entry(1, 2026, {
					investments: [
						holding({ fund_fee: 0.07, monthly_contribution: 0 }),
						holding({ fund_fee: 1.5, monthly_contribution: 0 })
					]
				}),
				entry(3, 2026)
			],
			{ growthRate: 5, applyFundFees: false }
		);
		const [cheap, expensive] = filled[1].investments;
		expect(cheap.value).toBe(expensive.value);
	});

	it('defaults to the profile default growth rate when none is given', () => {
		const entries = [
			entry(1, 2026, { investments: [holding({ monthly_contribution: 0 })] }),
			entry(3, 2026)
		];
		expect(fillMissingMonths(entries)[1].investments[0].value).toBe(
			fillMissingMonths(entries, { growthRate: DEFAULT_GROWTH_RATE })[1].investments[0].value
		);
	});

	/* ---------------------------------------------------------------------- */
	/* What is carried forward                                                 */
	/* ---------------------------------------------------------------------- */

	it('carries every holding field but the value forward unchanged', () => {
		const original = holding({
			name: 'Vanguard FTSE Global All Cap',
			type: 'stocks_isa',
			wrapper: 'isa_stocks_shares',
			bought_for: 8_000,
			year_purchased: 2021,
			notes: 'core holding',
			ownership_pct: 50
		});
		const filled = fillMissingMonths([entry(1, 2026, { investments: [original] }), entry(3, 2026)]);
		expect(filled[1].investments[0]).toEqual({
			...original,
			value: filled[1].investments[0].value
		});
	});

	it('carries debt balances forward untouched', () => {
		const debts = [createDebt({ name: 'Halifax mortgage', type: 'mortgage', balance: 180_000 })];
		const filled = fillMissingMonths([entry(1, 2026, { debts }), entry(3, 2026)]);
		expect(filled[1].debts).toEqual(debts);
		expect(filled[1].debts[0]).not.toBe(debts[0]);
	});

	it('fills a gap that has no holdings at all', () => {
		const filled = fillMissingMonths([entry(1, 2026), entry(3, 2026)]);
		expect(filled[1].investments).toEqual([]);
	});

	it('gives each filled month a fresh id', () => {
		const filled = fillMissingMonths([entry(1, 2026), entry(4, 2026)]);
		const ids = filled.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('does not carry forward a holding that only appears after the gap', () => {
		const filled = fillMissingMonths([
			entry(1, 2026, { investments: [holding({ name: 'Old' })] }),
			entry(3, 2026, { investments: [holding({ name: 'Old' }), holding({ name: 'New' })] })
		]);
		expect(filled[1].investments.map((i) => i.name)).toEqual(['Old']);
	});

	/* ---------------------------------------------------------------------- */
	/* Idempotence and re-filling                                              */
	/* ---------------------------------------------------------------------- */

	it('is idempotent — filling twice gives the same series', () => {
		const entries = [
			entry(1, 2026, { investments: [holding({ monthly_contribution: 250 })] }),
			entry(5, 2026)
		];
		const once = fillMissingMonths(entries, { growthRate: 6 });
		const twice = fillMissingMonths(once, { growthRate: 6 });
		expect(twice.map(monthlyEntryKey)).toEqual(once.map(monthlyEntryKey));
		expect(twice.map((e) => e.investments[0]?.value)).toEqual(
			once.map((e) => e.investments[0]?.value)
		);
	});

	it('recomputes rather than trusting existing filled months when the rate changes', () => {
		const entries = [
			entry(1, 2026, { investments: [holding({ monthly_contribution: 0 })] }),
			entry(4, 2026)
		];
		const slow = fillMissingMonths(entries, { growthRate: 2 });
		const fast = fillMissingMonths(slow, { growthRate: 10 });
		expect(fast).toHaveLength(slow.length);
		expect(fast[1].investments[0].value).toBeGreaterThan(slow[1].investments[0].value);
	});

	it('lets a snapshot recorded inside a filled gap win', () => {
		const filled = fillMissingMonths([entry(1, 2026), entry(4, 2026)]);
		const recorded = entry(2, 2026, { investments: [holding({ value: 42_000 })] });
		const refilled = fillMissingMonths([...filled, recorded]);

		expect(refilled.map(monthlyEntryKey)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
		expect(refilled[1]).toEqual(recorded);
		// March is now projected from February's real £42,000, not from January.
		expect(refilled[2].auto_filled).toBe(true);
		expect(refilled[2].investments[0].value).toBeGreaterThan(41_000);
	});

	it('leaves no gaps behind', () => {
		const filled = fillMissingMonths([entry(9, 2025), entry(2, 2026), entry(7, 2026)]);
		expect(findMissingMonths(filled)).toEqual([]);
	});

	/* ---------------------------------------------------------------------- */
	/* Trailing months (`through`)                                             */
	/* ---------------------------------------------------------------------- */

	it('stops at the last recorded month by default', () => {
		const filled = fillMissingMonths([entry(1, 2026), entry(3, 2026)]);
		expect(filled.at(-1)?.month).toBe(3);
	});

	it('projects up to and including `through` when asked', () => {
		const filled = fillMissingMonths([entry(1, 2026), entry(3, 2026)], {
			through: { month: 6, year: 2026 }
		});
		expect(filled.map(monthlyEntryKey)).toEqual([
			'2026-01',
			'2026-02',
			'2026-03',
			'2026-04',
			'2026-05',
			'2026-06'
		]);
		expect(autoFilledEntries(filled).map(monthlyEntryKey)).toEqual([
			'2026-02',
			'2026-04',
			'2026-05',
			'2026-06'
		]);
	});

	it('ignores a `through` month at or before the last recorded month', () => {
		const entries = [entry(1, 2026), entry(3, 2026)];
		expect(
			fillMissingMonths(entries, { through: { month: 3, year: 2026 } }).map(monthlyEntryKey)
		).toEqual(['2026-01', '2026-02', '2026-03']);
		expect(
			fillMissingMonths(entries, { through: { month: 2, year: 2026 } }).map(monthlyEntryKey)
		).toEqual(['2026-01', '2026-02', '2026-03']);
	});

	it('drops trailing filled months when re-filled without `through`', () => {
		const filled = fillMissingMonths([entry(1, 2026)], { through: { month: 4, year: 2026 } });
		expect(filled).toHaveLength(4);
		expect(fillMissingMonths(filled).map(monthlyEntryKey)).toEqual(['2026-01']);
	});

	/* ---------------------------------------------------------------------- */
	/* Guards                                                                  */
	/* ---------------------------------------------------------------------- */

	it('leaves an absurdly long gap unfilled rather than inventing thousands of months', () => {
		const filled = fillMissingMonths([entry(1, 1900), entry(1, 2100)]);
		expect(filled.map(monthlyEntryKey)).toEqual(['1900-01', '2100-01']);
	});

	it('fills a gap right up to the limit', () => {
		const start = { month: 1, year: 2000 };
		const end = addMonths(start, MAX_FILL_MONTHS + 1);
		const filled = fillMissingMonths([entry(start.month, start.year), entry(end.month, end.year)]);
		expect(filled).toHaveLength(MAX_FILL_MONTHS + 2);
	});

	it('tolerates duplicate months without inventing anything', () => {
		const filled = fillMissingMonths([entry(2, 2026), entry(2, 2026)]);
		expect(filled.map(monthlyEntryKey)).toEqual(['2026-02', '2026-02']);
		expect(autoFilledEntries(filled)).toEqual([]);
	});
});
