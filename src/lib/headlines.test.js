import { describe, expect, it } from 'vitest';

import {
	createDebt,
	createInvestment,
	createMonthlyEntry,
	createPension,
	createProfile
} from './model.js';
import {
	concentrationHeadline,
	debtsDeltaHeadline,
	financialHeadlines,
	fireProgressHeadline,
	investmentsDeltaHeadline,
	milestoneHeadlines,
	monthOverMonthDeltas,
	netWorthDeltaHeadline,
	newHoldingHeadlines,
	pensionCompositionHeadline
} from './headlines.js';

/**
 * @param {number} month
 * @param {number} year
 * @param {{ investments?: number[], debts?: number[] }} [contents]
 * @returns {import('./types.js').MonthlyEntry}
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
 * As {@link entry}, but for tests that need full holding shapes (name, wrapper, exclusion) rather
 * than just a bare value.
 *
 * @param {number} month
 * @param {number} year
 * @param {Partial<import('./types.js').Investment>[]} [holdings]
 * @returns {import('./types.js').MonthlyEntry}
 */
function holdingEntry(month, year, holdings = []) {
	return createMonthlyEntry({
		month,
		year,
		investments: holdings.map((holding) => createInvestment(holding))
	});
}

describe('monthOverMonthDeltas', () => {
	it('is null with fewer than two recorded months', () => {
		expect(monthOverMonthDeltas([])).toBeNull();
		expect(monthOverMonthDeltas([entry(1, 2026, { investments: [1000] })])).toBeNull();
	});

	it('computes £ and % change in net worth, investments and debts', () => {
		const deltas = monthOverMonthDeltas([
			entry(3, 2026, { investments: [1_100_000], debts: [100_000] }),
			entry(2, 2026, { investments: [1_000_000], debts: [90_000] })
		]);

		expect(deltas).not.toBeNull();
		expect(deltas?.investments).toEqual({
			current: 1_100_000,
			previous: 1_000_000,
			absolute: 100_000,
			percentage: 10
		});
		expect(deltas?.debts).toEqual({
			current: 100_000,
			previous: 90_000,
			absolute: 10_000,
			percentage: expect.closeTo(11.111, 3)
		});
		expect(deltas?.netWorth.absolute).toBe(90_000);
	});

	it('compares the two most recent months by calendar order, not array order', () => {
		const deltas = monthOverMonthDeltas([
			entry(2, 2026, { investments: [1_100_000] }),
			entry(12, 2025, { investments: [900_000] }),
			entry(1, 2026, { investments: [1_000_000] })
		]);

		expect(deltas).not.toBeNull();
		expect(deltas?.investments).toMatchObject({ current: 1_100_000, previous: 1_000_000 });
	});

	it('gives NaN percentage when the previous month is zero, not a division error', () => {
		const deltas = monthOverMonthDeltas([
			entry(2, 2026, { investments: [5_000] }),
			entry(1, 2026, { investments: [] })
		]);

		expect(deltas).not.toBeNull();
		expect(deltas?.investments.absolute).toBe(5_000);
		expect(deltas?.investments.percentage).toBeNaN();
	});
});

describe('netWorthDeltaHeadline', () => {
	it("matches the user's own example for a rise", () => {
		const deltas = monthOverMonthDeltas([
			entry(2, 2026, { investments: [1_140_600] }),
			entry(1, 2026, { investments: [1_040_600] })
		]);

		const headline = netWorthDeltaHeadline(deltas);
		expect(headline).not.toBeNull();
		expect(headline?.text).toBe('Net worth up £100,000 (9.6%) this month.');
		expect(headline?.tone).toBe('positive');
		expect(headline?.id).toBe('net-worth-delta');
	});

	it('reports a fall as down, with negative tone', () => {
		const deltas = monthOverMonthDeltas([
			entry(2, 2026, { investments: [900_000] }),
			entry(1, 2026, { investments: [1_000_000] })
		]);

		const headline = netWorthDeltaHeadline(deltas);
		expect(headline).not.toBeNull();
		expect(headline?.text).toBe('Net worth down £100,000 (10.0%) this month.');
		expect(headline?.tone).toBe('negative');
	});

	it('reports no change as unchanged, with neutral tone and no percentage', () => {
		const deltas = monthOverMonthDeltas([
			entry(2, 2026, { investments: [500_000] }),
			entry(1, 2026, { investments: [500_000] })
		]);

		const headline = netWorthDeltaHeadline(deltas);
		expect(headline).not.toBeNull();
		expect(headline?.text).toBe('Net worth unchanged this month.');
		expect(headline?.tone).toBe('neutral');
	});

	it('omits the percentage clause when the previous month was zero', () => {
		const deltas = monthOverMonthDeltas([
			entry(2, 2026, { investments: [5_000] }),
			entry(1, 2026, { investments: [] })
		]);

		expect(netWorthDeltaHeadline(deltas)?.text).toBe('Net worth up £5,000 this month.');
	});

	it('is null with nothing to compare against', () => {
		expect(netWorthDeltaHeadline(null)).toBeNull();
	});
});

describe('investmentsDeltaHeadline', () => {
	it("matches the user's own example", () => {
		const deltas = monthOverMonthDeltas([
			entry(2, 2026, { investments: [1_100_000] }),
			entry(1, 2026, { investments: [1_000_000] })
		]);

		const headline = investmentsDeltaHeadline(deltas);
		expect(headline).not.toBeNull();
		expect(headline?.text).toBe('Investments are up £100,000 — keep stacking.');
		expect(headline?.tone).toBe('positive');
	});

	it('reports a fall with negative tone', () => {
		const deltas = monthOverMonthDeltas([
			entry(2, 2026, { investments: [900_000] }),
			entry(1, 2026, { investments: [1_000_000] })
		]);

		const headline = investmentsDeltaHeadline(deltas);
		expect(headline).not.toBeNull();
		expect(headline?.text).toBe('Investments are down £100,000 — markets have off months too.');
		expect(headline?.tone).toBe('negative');
	});

	it('is null when there have never been any investments to report on', () => {
		const deltas = monthOverMonthDeltas([entry(2, 2026), entry(1, 2026)]);

		expect(investmentsDeltaHeadline(deltas)).toBeNull();
	});

	it('is null with nothing to compare against', () => {
		expect(investmentsDeltaHeadline(null)).toBeNull();
	});
});

describe('debtsDeltaHeadline', () => {
	it('reports falling debt as positive tone', () => {
		const deltas = monthOverMonthDeltas([
			entry(2, 2026, { debts: [80_000] }),
			entry(1, 2026, { debts: [90_000] })
		]);

		const headline = debtsDeltaHeadline(deltas);
		expect(headline).not.toBeNull();
		expect(headline?.text).toBe('Debts are down £10,000 — nice work paying it down.');
		expect(headline?.tone).toBe('positive');
	});

	it('reports rising debt as negative tone', () => {
		const deltas = monthOverMonthDeltas([
			entry(2, 2026, { debts: [95_000] }),
			entry(1, 2026, { debts: [90_000] })
		]);

		const headline = debtsDeltaHeadline(deltas);
		expect(headline).not.toBeNull();
		expect(headline?.text).toBe('Debts are up £5,000 this month.');
		expect(headline?.tone).toBe('negative');
	});

	it('is null for a debt-free household in both months', () => {
		const deltas = monthOverMonthDeltas([
			entry(2, 2026, { investments: [1_000] }),
			entry(1, 2026, { investments: [900] })
		]);

		expect(debtsDeltaHeadline(deltas)).toBeNull();
	});
});

describe('fireProgressHeadline', () => {
	it("matches the user's own example", () => {
		const profile = createProfile({ retirement_target: 30_000 });
		const entries = [
			entry(2, 2026, { investments: [1_144_500] }),
			entry(1, 2026, { investments: [1_011_167] })
		];

		// FI number at the default 4% withdrawal rate: £30,000 * 25 = £750,000.
		const headline = fireProgressHeadline(profile, entries);
		expect(headline).not.toBeNull();
		expect(headline?.text).toBe(
			'152.6% of the way to your £750,000 FI number — added 17.78% this month.'
		);
		expect(headline?.tone).toBe('positive');
		expect(headline?.id).toBe('fire-progress');
	});

	it('reports a fall in progress with negative tone', () => {
		const profile = createProfile({ retirement_target: 30_000 });
		const entries = [
			entry(2, 2026, { investments: [600_000] }),
			entry(1, 2026, { investments: [750_000] })
		];

		const headline = fireProgressHeadline(profile, entries);
		expect(headline).not.toBeNull();
		expect(headline?.text).toBe(
			'80.0% of the way to your £750,000 FI number — down 20.00% this month.'
		);
		expect(headline?.tone).toBe('negative');
	});

	it('has no month-over-month clause with only one recorded month', () => {
		const profile = createProfile({ retirement_target: 30_000 });
		const headline = fireProgressHeadline(profile, [entry(1, 2026, { investments: [750_000] })]);

		expect(headline).not.toBeNull();
		expect(headline?.text).toBe('100.0% of the way to your £750,000 FI number.');
		expect(headline?.tone).toBe('neutral');
	});

	it('is null with no FI target set', () => {
		const profile = createProfile({ retirement_target: 0 });
		expect(fireProgressHeadline(profile, [entry(1, 2026, { investments: [750_000] })])).toBeNull();
	});

	it('is null with no recorded months', () => {
		const profile = createProfile({ retirement_target: 30_000 });
		expect(fireProgressHeadline(profile, [])).toBeNull();
	});

	it('accepts an override withdrawal rate', () => {
		const profile = createProfile({ retirement_target: 40_000 });
		const headline = fireProgressHeadline(profile, [entry(1, 2026, { investments: [1_000_000] })], {
			withdrawalRate: 4
		});

		// FI number at 4%: £40,000 * 25 = £1,000,000.
		expect(headline).not.toBeNull();
		expect(headline?.text).toBe('100.0% of the way to your £1,000,000 FI number.');
	});
});

describe('newHoldingHeadlines', () => {
	it('is empty with fewer than two recorded months', () => {
		expect(newHoldingHeadlines([])).toEqual([]);
		expect(
			newHoldingHeadlines([holdingEntry(1, 2026, [{ name: 'AJBell', value: 100_000 }])])
		).toEqual([]);
	});

	it("matches the user's own example for a holding that appears this month", () => {
		const headlines = newHoldingHeadlines([
			holdingEntry(2, 2026, [{ name: 'AJBell', value: 100_000 }]),
			holdingEntry(1, 2026, [])
		]);

		expect(headlines).toEqual([
			{ id: 'new-holding-ajbell-gia', text: 'New holding: AJBell at £100,000.', tone: 'neutral' }
		]);
	});

	it('does not flag a holding that was already present last month, only revalued', () => {
		const headlines = newHoldingHeadlines([
			holdingEntry(2, 2026, [{ name: 'AJBell', value: 110_000 }]),
			holdingEntry(1, 2026, [{ name: 'AJBell', value: 100_000 }])
		]);

		expect(headlines).toEqual([]);
	});

	it('does not re-flag a holding in the month after it first appeared', () => {
		const headlines = newHoldingHeadlines([
			holdingEntry(3, 2026, [{ name: 'AJBell', value: 120_000 }]),
			holdingEntry(2, 2026, [{ name: 'AJBell', value: 100_000 }]),
			holdingEntry(1, 2026, [])
		]);

		expect(headlines).toEqual([]);
	});

	it('treats the same name in a different wrapper as a new holding', () => {
		const headlines = newHoldingHeadlines([
			holdingEntry(2, 2026, [{ name: 'AJBell', value: 50_000, wrapper: 'isa_stocks_shares' }]),
			holdingEntry(1, 2026, [{ name: 'AJBell', value: 50_000, wrapper: 'gia' }])
		]);

		expect(headlines).toHaveLength(1);
		expect(headlines[0].text).toBe('New holding: AJBell at £50,000.');
	});

	it('ignores a holding excluded from net worth', () => {
		const headlines = newHoldingHeadlines([
			holdingEntry(2, 2026, [
				{ name: 'House deposit', value: 20_000, exclude_from_net_worth: true }
			]),
			holdingEntry(1, 2026, [])
		]);

		expect(headlines).toEqual([]);
	});

	it('skips a holding with no name recorded', () => {
		const headlines = newHoldingHeadlines([
			holdingEntry(2, 2026, [{ name: '', value: 20_000 }]),
			holdingEntry(1, 2026, [])
		]);

		expect(headlines).toEqual([]);
	});

	it('reports every new holding in the same month, each with its own id', () => {
		const headlines = newHoldingHeadlines([
			holdingEntry(2, 2026, [
				{ name: 'AJBell', value: 100_000 },
				{ name: 'Vanguard FTSE Global All Cap', value: 50_000 }
			]),
			holdingEntry(1, 2026, [])
		]);

		expect(headlines).toHaveLength(2);
		expect(headlines.map((headline) => headline.id)).toEqual([
			'new-holding-ajbell-gia',
			'new-holding-vanguard-ftse-global-all-cap-gia'
		]);
	});
});

describe('concentrationHeadline', () => {
	it('is null with no recorded month', () => {
		expect(concentrationHeadline([])).toBeNull();
	});

	it('is null with nothing counted towards net worth', () => {
		expect(
			concentrationHeadline([
				holdingEntry(1, 2026, [
					{ name: 'House deposit', value: 20_000, exclude_from_net_worth: true }
				])
			])
		).toBeNull();
	});

	it('is null for a well-diversified portfolio', () => {
		const headline = concentrationHeadline([
			holdingEntry(1, 2026, [
				{ name: 'A', value: 25_000, wrapper: 'isa_stocks_shares' },
				{ name: 'B', value: 25_000, wrapper: 'sipp' },
				{ name: 'C', value: 25_000, wrapper: 'gia' },
				{ name: 'D', value: 25_000, wrapper: 'isa_cash' }
			])
		]);

		expect(headline).toBeNull();
	});

	it("matches the user's own example for a wrapper making up the whole portfolio", () => {
		const headline = concentrationHeadline([
			holdingEntry(1, 2026, [{ name: 'Marcus Cash ISA', value: 40_000, wrapper: 'isa_cash' }])
		]);

		expect(headline).toEqual({
			id: 'concentration',
			text: 'Cash ISA is 100% of your portfolio — concentrated. Worth a diversification check.',
			tone: 'neutral'
		});
	});

	it('reports a holding that dominates across wrappers even though no single wrapper does', () => {
		const headline = concentrationHeadline([
			holdingEntry(1, 2026, [
				{ name: 'Fund X', value: 40_000, wrapper: 'isa_stocks_shares' },
				{ name: 'Fund X', value: 40_000, wrapper: 'sipp' },
				{ name: 'Fund Y', value: 20_000, wrapper: 'gia' }
			])
		]);

		// Fund X: 80,000 / 100,000 = 80% combined, even though its largest single wrapper is 40%.
		expect(headline).toEqual({
			id: 'concentration',
			text: 'Fund X is 80% of your portfolio — concentrated. Worth a diversification check.',
			tone: 'neutral'
		});
	});

	it('reads from the latest recorded month only', () => {
		const headline = concentrationHeadline([
			holdingEntry(2, 2026, [
				{ name: 'A', value: 25_000, wrapper: 'isa_stocks_shares' },
				{ name: 'B', value: 25_000, wrapper: 'sipp' },
				{ name: 'C', value: 25_000, wrapper: 'gia' },
				{ name: 'D', value: 25_000, wrapper: 'isa_cash' }
			]),
			holdingEntry(1, 2026, [{ name: 'A', value: 100_000, wrapper: 'isa_stocks_shares' }])
		]);

		expect(headline).toBeNull();
	});
});

describe('milestoneHeadlines', () => {
	it('is empty with no recorded month', () => {
		expect(milestoneHeadlines([])).toEqual([]);
	});

	it("matches the user's own example for investments crossing £5,000 for the first time", () => {
		const headlines = milestoneHeadlines([
			holdingEntry(2, 2026, [{ name: 'AJBell', value: 5_200 }]),
			holdingEntry(1, 2026, [{ name: 'AJBell', value: 4_800 }])
		]);

		expect(headlines).toContainEqual({
			id: 'milestone-investments-5000',
			text: 'First month above £5,000 in investments. Quietly significant.',
			tone: 'positive'
		});
	});

	it('is empty when nothing crosses a band this month', () => {
		const headlines = milestoneHeadlines([
			holdingEntry(2, 2026, [{ name: 'AJBell', value: 5_300 }]),
			holdingEntry(1, 2026, [{ name: 'AJBell', value: 5_200 }])
		]);

		expect(headlines).toEqual([]);
	});

	it('does not re-fire once a band has been crossed, even after dipping back under it', () => {
		const headlines = milestoneHeadlines([
			holdingEntry(3, 2026, [{ name: 'AJBell', value: 5_100 }]),
			holdingEntry(2, 2026, [{ name: 'AJBell', value: 4_900 }]),
			holdingEntry(1, 2026, [{ name: 'AJBell', value: 5_200 }])
		]);

		expect(headlines).toEqual([]);
	});

	it('reports only the highest band crossed, not every one passed through', () => {
		const headlines = milestoneHeadlines([
			holdingEntry(2, 2026, [{ name: 'AJBell', value: 120_000 }]),
			holdingEntry(1, 2026, [{ name: 'AJBell', value: 900 }])
		]);

		expect(headlines).toContainEqual({
			id: 'milestone-investments-100000',
			text: 'First month above £100,000 in investments. Quietly significant.',
			tone: 'positive'
		});
		expect(
			headlines.filter((headline) => headline.id.startsWith('milestone-investments-'))
		).toHaveLength(1);
	});

	it('reports a net worth crossing separately from an investments crossing', () => {
		const headlines = milestoneHeadlines([
			entry(2, 2026, { investments: [12_000], debts: [1_000] }),
			entry(1, 2026, { investments: [9_000], debts: [1_000] })
		]);

		expect(headlines).toContainEqual({
			id: 'milestone-net-worth-10000',
			text: 'First month above £10,000 in net worth. Quietly significant.',
			tone: 'positive'
		});
		expect(headlines).toContainEqual({
			id: 'milestone-investments-10000',
			text: 'First month above £10,000 in investments. Quietly significant.',
			tone: 'positive'
		});
	});

	it('reports a single holding crossing a band even when the investments total already crossed it', () => {
		const headlines = milestoneHeadlines([
			holdingEntry(2, 2026, [
				{ name: 'AJBell', value: 5_500 },
				{ name: 'Vanguard', value: 100_000 }
			]),
			holdingEntry(1, 2026, [
				{ name: 'AJBell', value: 4_500 },
				{ name: 'Vanguard', value: 100_000 }
			])
		]);

		expect(headlines).toContainEqual({
			id: 'milestone-holding-ajbell-gia-5000',
			text: 'First month above £5,000 in AJBell. Quietly significant.',
			tone: 'positive'
		});
	});

	it('lets the very first recorded month cross a band, since there is no history to compare against', () => {
		const headlines = milestoneHeadlines([
			holdingEntry(1, 2026, [{ name: 'AJBell', value: 5_200 }])
		]);

		expect(headlines).toContainEqual({
			id: 'milestone-investments-5000',
			text: 'First month above £5,000 in investments. Quietly significant.',
			tone: 'positive'
		});
	});
});

describe('pensionCompositionHeadline', () => {
	it('is null with no recorded month', () => {
		expect(pensionCompositionHeadline([createPension({ value: 500_000 })], [])).toBeNull();
	});

	it('is null with no DC pension pot recorded', () => {
		const entries = [entry(1, 2026, { investments: [500_000] })];
		expect(pensionCompositionHeadline([], entries)).toBeNull();
	});

	it("matches the user's own example", () => {
		const pensions = [createPension({ type: 'dc_workplace', value: 618_017 })];
		const entries = [entry(1, 2026, { investments: [526_000], debts: [0] })];

		// Net worth £526,000 + pension £618,017 = £1,144,017; pension share 54.0%.
		const headline = pensionCompositionHeadline(pensions, entries);
		expect(headline).toEqual({
			id: 'pension-composition',
			text: 'Your pension is £618,017 — 54% of your net worth.',
			tone: 'neutral'
		});
	});

	it('is null when the pension is not a majority of the combined total', () => {
		const pensions = [createPension({ type: 'dc_workplace', value: 100_000 })];
		const entries = [entry(1, 2026, { investments: [500_000] })];

		expect(pensionCompositionHeadline(pensions, entries)).toBeNull();
	});

	it('ignores Defined Benefit and State pensions, which have no pot value', () => {
		const pensions = [
			createPension({ type: 'db_final_salary', value: 0, db_annual_income: 20_000 }),
			createPension({ type: 'state', value: 0, ni_qualifying_years: 35 })
		];
		const entries = [entry(1, 2026, { investments: [500_000] })];

		expect(pensionCompositionHeadline(pensions, entries)).toBeNull();
	});
});

describe('financialHeadlines', () => {
	it('combines every rule, in order, dropping anything with nothing to say', () => {
		const profile = createProfile({ retirement_target: 30_000 });
		const entries = [
			holdingEntry(2, 2026, [
				{ name: 'A', value: 230_000, wrapper: 'isa_stocks_shares' },
				{ name: 'B', value: 230_000, wrapper: 'sipp' },
				{ name: 'C', value: 230_000, wrapper: 'gia' },
				{ name: 'D', value: 230_000, wrapper: 'isa_cash' }
			]),
			holdingEntry(1, 2026, [
				{ name: 'A', value: 200_000, wrapper: 'isa_stocks_shares' },
				{ name: 'B', value: 200_000, wrapper: 'sipp' },
				{ name: 'C', value: 200_000, wrapper: 'gia' },
				{ name: 'D', value: 200_000, wrapper: 'isa_cash' }
			])
		];
		entries[0].debts = [createDebt({ balance: 50_000 })];
		entries[1].debts = [createDebt({ balance: 60_000 })];

		const headlines = financialHeadlines({ profile, entries });

		// Both months stay diversified (25% a side, well under the concentration threshold), and
		// neither net worth nor investments crosses a milestone band — so only the four original
		// delta/FIRE rules have anything to say.
		expect(headlines.map((headline) => headline.id)).toEqual([
			'net-worth-delta',
			'investments-delta',
			'debts-delta',
			'fire-progress'
		]);
		expect(headlines.every((headline) => typeof headline.text === 'string')).toBe(true);
	});

	it('is an empty array for a brand-new, well-diversified household with no FI target', () => {
		const profile = createProfile({ retirement_target: 0 });
		const entries = [
			holdingEntry(1, 2026, [
				{ name: 'A', value: 100, wrapper: 'isa_stocks_shares' },
				{ name: 'B', value: 100, wrapper: 'sipp' },
				{ name: 'C', value: 100, wrapper: 'gia' },
				{ name: 'D', value: 100, wrapper: 'isa_cash' }
			])
		];

		expect(financialHeadlines({ profile, entries })).toEqual([]);
	});

	it('appends new-holding, milestone, concentration and pension-composition headlines', () => {
		const profile = createProfile({ retirement_target: 0 });
		const pensions = [createPension({ type: 'dc_workplace', value: 900_000 })];
		const entries = [
			holdingEntry(2, 2026, [
				{ name: 'AJBell', value: 100_000, wrapper: 'isa_stocks_shares' },
				{ name: 'Cash', value: 5_200, wrapper: 'isa_cash' }
			]),
			holdingEntry(1, 2026, [{ name: 'Cash', value: 4_800, wrapper: 'isa_cash' }])
		];

		const headlines = financialHeadlines({ profile, entries, pensions });

		expect(headlines.map((headline) => headline.id)).toEqual(
			expect.arrayContaining([
				'new-holding-ajbell-isa-stocks-shares',
				'milestone-investments-100000',
				'concentration',
				'pension-composition'
			])
		);
	});

	it('defaults pensions to empty, so pension-composition never runs without them', () => {
		const profile = createProfile({ retirement_target: 0 });
		const entries = [entry(1, 2026, { investments: [500_000] })];

		expect(financialHeadlines({ profile, entries })).not.toContainEqual(
			expect.objectContaining({ id: 'pension-composition' })
		);
	});
});
