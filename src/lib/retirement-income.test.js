import { describe, expect, it } from 'vitest';

import { accrualRateFromDenominator } from './defined-benefit.js';
import { DEFINED_CONTRIBUTION_PENSION_TYPES } from './enums.js';
import { incomeTax } from './tax.js';
import {
	DEFAULT_ANNUITY_RATE,
	PENSION_TAX_FREE_SHARE,
	RETIREMENT_INCOME_STREAMS,
	RETIREMENT_INCOME_STREAM_LABELS,
	RETIREMENT_ISA_WRAPPERS,
	STATE_PENSION_FULL_YEARS,
	STATE_PENSION_MINIMUM_YEARS,
	UNCOUNTED_CAPITAL_LABELS,
	definedContributionPot,
	fullStatePension,
	giaDividendIncome,
	isaPot,
	normaliseRetirementIncomeInput,
	retirementIncomeSummary,
	statePensionIncome,
	statePensionYears,
	uncountedCapital
} from './retirement-income.js';
import {
	createDividend,
	createInvestment,
	createMonthlyEntry,
	createPension,
	createProfile
} from './model.js';

/** 1/60th, 25 years, £45,000 — £18,750 a year, the same scheme `defined-benefit.test.js` uses. */
const finalSalary = createPension({
	name: 'Legacy final salary scheme',
	type: 'db_final_salary',
	db_accrual_rate: accrualRateFromDenominator(60),
	db_years: 25,
	db_salary: 45_000
});

/** @param {Partial<import('./types.js').Pension>} [overrides] */
function sipp(overrides = {}) {
	return createPension({ name: 'Vanguard SIPP', type: 'sipp', value: 400_000, ...overrides });
}

/**
 * One recorded month holding whatever is passed in — the snapshot the ISA stream is read off.
 *
 * @param {import('./types.js').Investment[]} investments
 * @returns {import('./types.js').MonthlyEntry[]}
 */
function history(investments) {
	return [createMonthlyEntry({ month: 6, year: 2026, investments })];
}

/**
 * The worked example most of the totals below are checked against:
 *
 * - a £18,750 Defined Benefit pension
 * - a £400,000 DC pot, a quarter of it annuitised at 6% (£6,000) and the rest drawn at 4% (£12,000)
 * - a £200,000 Stocks & Shares ISA drawn at 4% (£8,000)
 * - £50,000 of GIA holdings yielding 4% (£2,000)
 * - a full State Pension on 35 NI years (£12,547.60)
 */
function worked() {
	return {
		pensions: [
			finalSalary,
			sipp(),
			createPension({ type: 'state', ni_qualifying_years: 30, ni_future_years: 5 })
		],
		monthlyEntries: history([
			createInvestment({ name: 'Global All Cap', wrapper: 'isa_stocks_shares', value: 200_000 })
		]),
		dividends: [
			createDividend({ name: 'Income fund', wrapper: 'gia', value: 50_000, yield_pct: 4 })
		],
		profile: createProfile({ retirement_target: 40_000 })
	};
}

const workedOptions = { annuitisedShare: 25 };

describe('the six streams', () => {
	it('names them in the order README.md and issue #33 do', () => {
		expect([...RETIREMENT_INCOME_STREAMS]).toEqual([
			'db',
			'annuity',
			'sipp_drawdown',
			'isa_withdrawal',
			'gia_dividends',
			'state_pension'
		]);
	});

	it('labels every one of them', () => {
		for (const id of RETIREMENT_INCOME_STREAMS) {
			expect(RETIREMENT_INCOME_STREAM_LABELS[id]).toBeTruthy();
		}
	});

	it('reports all six even when there is nothing recorded at all', () => {
		const summary = retirementIncomeSummary();

		expect(summary.streams.map((stream) => stream.id)).toEqual([...RETIREMENT_INCOME_STREAMS]);
		expect(summary.streams.every((stream) => stream.annualIncome === 0)).toBe(true);
		expect(summary.streams.every((stream) => stream.present === false)).toBe(true);
		expect(summary.annualIncome).toBe(0);
	});

	it('never divides by a zero total when working out each stream’s share', () => {
		expect(retirementIncomeSummary().streams.every((stream) => stream.share === 0)).toBe(true);
	});
});

describe('the pots behind the streams', () => {
	it('counts DC workplace pots and SIPPs as the drawdown pot', () => {
		expect(
			definedContributionPot([
				createPension({ type: 'dc_workplace', value: 120_000 }),
				sipp({ value: 80_000 })
			])
		).toBe(200_000);
	});

	it('leaves Defined Benefit and State pensions out of it — they have no pot', () => {
		expect(
			definedContributionPot([finalSalary, createPension({ type: 'state', value: 999 })])
		).toBe(0);
	});

	it('sends a Lifetime ISA pot to the ISA stream, not the pension pot', () => {
		const pensions = [createPension({ type: 'lisa', value: 30_000 })];

		expect(definedContributionPot(pensions)).toBe(0);
		expect(isaPot([], pensions)).toEqual({ value: 30_000, count: 1 });
		expect(DEFINED_CONTRIBUTION_PENSION_TYPES).not.toContain('lisa');
	});

	it('counts every ISA wrapper except the Junior ISA', () => {
		expect([...RETIREMENT_ISA_WRAPPERS]).not.toContain('jisa');

		const holdings = RETIREMENT_ISA_WRAPPERS.map((wrapper) =>
			createInvestment({ wrapper, value: 1_000 })
		);
		expect(isaPot([...holdings, createInvestment({ wrapper: 'jisa', value: 9_000 })])).toEqual({
			value: RETIREMENT_ISA_WRAPPERS.length * 1_000,
			count: RETIREMENT_ISA_WRAPPERS.length
		});
	});

	it('ignores holdings excluded from net worth', () => {
		expect(
			isaPot([
				createInvestment({ wrapper: 'isa_stocks_shares', value: 50_000 }),
				createInvestment({
					wrapper: 'isa_stocks_shares',
					value: 10_000,
					exclude_from_net_worth: true
				})
			])
		).toEqual({ value: 50_000, count: 1 });
	});

	it('prices unsheltered dividend holdings at value × yield', () => {
		expect(
			giaDividendIncome([
				createDividend({ wrapper: 'gia', value: 50_000, yield_pct: 4 }),
				createDividend({ wrapper: 'none', value: 10_000, yield_pct: 3.5 })
			])
		).toEqual({ income: 2_350, value: 60_000, count: 2 });
	});

	it('leaves sheltered dividend holdings out of the GIA stream', () => {
		expect(
			giaDividendIncome([
				createDividend({ wrapper: 'isa_stocks_shares', value: 80_000, yield_pct: 4 }),
				createDividend({ wrapper: 'sipp', value: 20_000, yield_pct: 4 })
			])
		).toEqual({ income: 0, value: 0, count: 0 });
	});
});

describe('the State Pension', () => {
	it('pays £241.30 a week — £12,547.60 a year — on a full record', () => {
		expect(fullStatePension()).toBe(12_547.6);
		expect(statePensionIncome(STATE_PENSION_FULL_YEARS)).toBe(12_547.6);
	});

	it('pays nothing below ten qualifying years', () => {
		expect(statePensionIncome(STATE_PENSION_MINIMUM_YEARS - 1)).toBe(0);
		expect(statePensionIncome(0)).toBe(0);
		expect(statePensionIncome(null)).toBe(0);
	});

	it('pays pro rata between ten years and thirty-five', () => {
		expect(statePensionIncome(STATE_PENSION_MINIMUM_YEARS)).toBe(3_585.03);
		expect(statePensionIncome(20)).toBe(7_170.06);
	});

	it('pays no more than the full rate however many years are recorded', () => {
		expect(statePensionIncome(60)).toBe(fullStatePension());
	});

	it('reads NI years as qualifying plus future', () => {
		expect(
			statePensionYears([createPension({ ni_qualifying_years: 22, ni_future_years: 8 })])
		).toBe(30);
	});

	it('does not add NI years up across records — they are one fact, not one per pot', () => {
		expect(
			statePensionYears([
				createPension({ name: 'Old note', ni_qualifying_years: 20 }),
				createPension({ name: 'Newer note', ni_qualifying_years: 30, ni_future_years: 5 })
			])
		).toBe(35);
	});

	it('says nothing is recorded rather than reporting zero years', () => {
		expect(statePensionYears([sipp(), finalSalary])).toBeNull();
		expect(statePensionYears([createPension({ ni_qualifying_years: 0 })])).toBe(0);
	});

	it('leaves the stream out entirely when the plan says to', () => {
		const summary = retirementIncomeSummary(worked(), {
			...workedOptions,
			includeStatePension: false
		});

		expect(streamOf(summary, 'state_pension').annualIncome).toBe(0);
		expect(summary.annualIncome).toBe(46_750);
	});

	it('lets a plan override the NI years on file', () => {
		const summary = retirementIncomeSummary(worked(), { ...workedOptions, statePensionYears: 20 });

		expect(summary.statePensionYears).toBe(20);
		expect(streamOf(summary, 'state_pension').annualIncome).toBe(7_170.06);
	});

	it('reports whether there is an NI record behind the figure', () => {
		expect(retirementIncomeSummary(worked()).statePensionRecorded).toBe(true);
		expect(retirementIncomeSummary({ pensions: [sipp()] }).statePensionRecorded).toBe(false);
	});
});

/**
 * @param {ReturnType<typeof retirementIncomeSummary>} summary
 * @param {import('./retirement-income.js').RetirementIncomeStreamId} id
 */
function streamOf(summary, id) {
	const stream = summary.streams.find((candidate) => candidate.id === id);
	if (!stream) throw new Error(`no ${id} stream`);
	return stream;
}

describe('splitting the DC pot between drawdown and an annuity', () => {
	it('draws the whole pot down when nothing is annuitised', () => {
		const summary = retirementIncomeSummary({ pensions: [sipp()] });

		expect(streamOf(summary, 'sipp_drawdown').capital).toBe(400_000);
		expect(streamOf(summary, 'sipp_drawdown').annualIncome).toBe(16_000);
		expect(streamOf(summary, 'annuity').capital).toBe(0);
		expect(streamOf(summary, 'annuity').annualIncome).toBe(0);
	});

	it('splits it at the share asked for, and prices each half at its own rate', () => {
		const summary = retirementIncomeSummary({ pensions: [sipp()] }, { annuitisedShare: 25 });

		expect(streamOf(summary, 'annuity').capital).toBe(100_000);
		expect(streamOf(summary, 'annuity').rate).toBe(DEFAULT_ANNUITY_RATE);
		expect(streamOf(summary, 'annuity').annualIncome).toBe(6_000);
		expect(streamOf(summary, 'sipp_drawdown').capital).toBe(300_000);
		expect(streamOf(summary, 'sipp_drawdown').annualIncome).toBe(12_000);
	});

	it('never lets the two halves total more than the pot', () => {
		const summary = retirementIncomeSummary({ pensions: [sipp()] }, { annuitisedShare: 100 });

		expect(streamOf(summary, 'annuity').capital).toBe(400_000);
		expect(streamOf(summary, 'sipp_drawdown').capital).toBe(0);
	});

	it('honours the withdrawal and annuity rates it is given', () => {
		const summary = retirementIncomeSummary(
			{ pensions: [sipp()] },
			{ annuitisedShare: 50, withdrawalRate: 3, annuityRate: 7 }
		);

		expect(streamOf(summary, 'annuity').annualIncome).toBe(14_000);
		expect(streamOf(summary, 'sipp_drawdown').annualIncome).toBe(6_000);
	});
});

describe('tax treatment', () => {
	const summary = retirementIncomeSummary(worked(), workedOptions);

	it('taxes a Defined Benefit pension and the State Pension in full as income', () => {
		expect(streamOf(summary, 'db').taxTreatment).toBe('earned_income');
		expect(streamOf(summary, 'db').taxFreeIncome).toBe(0);
		expect(streamOf(summary, 'state_pension').taxTreatment).toBe('earned_income');
		expect(streamOf(summary, 'state_pension').taxFreeIncome).toBe(0);
	});

	it('leaves a quarter of every DC pound tax-free', () => {
		expect(PENSION_TAX_FREE_SHARE).toBe(25);
		expect(streamOf(summary, 'sipp_drawdown').taxFreeIncome).toBe(3_000);
		expect(streamOf(summary, 'sipp_drawdown').taxableIncome).toBe(9_000);
		expect(streamOf(summary, 'annuity').taxFreeIncome).toBe(1_500);
		expect(streamOf(summary, 'annuity').taxableIncome).toBe(4_500);
	});

	it('takes ISA withdrawals tax-free in full', () => {
		expect(streamOf(summary, 'isa_withdrawal').taxTreatment).toBe('tax_free');
		expect(streamOf(summary, 'isa_withdrawal').taxFreeIncome).toBe(8_000);
		expect(streamOf(summary, 'isa_withdrawal').taxableIncome).toBe(0);
	});

	it('classifies GIA dividends as dividend income and keeps them out of the income tax figure', () => {
		expect(streamOf(summary, 'gia_dividends').taxTreatment).toBe('dividend');
		expect(summary.dividendIncome).toBe(2_000);
		expect(summary.earnedIncome).toBe(44_797.6);
		expect(summary.incomeTax).toBe(incomeTax(44_797.6));
	});

	it('taxes the earned streams once, against one personal allowance', () => {
		// £44,797.60 earned, less the £12,570 allowance, all inside the 20% band.
		expect(summary.incomeTax).toBe(6_445.52);
	});

	it('uses the region on the profile', () => {
		const scottish = retirementIncomeSummary(
			{ ...worked(), profile: createProfile({ tax_region: 'scotland' }) },
			workedOptions
		);

		expect(scottish.input.taxRegion).toBe('scotland');
		expect(scottish.incomeTax).toBe(incomeTax(44_797.6, 'scotland'));
		expect(scottish.incomeTax).not.toBe(summary.incomeTax);
	});
});

describe('the totals', () => {
	const summary = retirementIncomeSummary(worked(), workedOptions);

	it('adds every stream up, gross', () => {
		expect(summary.annualIncome).toBe(59_297.6);
		expect(summary.monthlyIncome).toBe(4_941.47);
	});

	it('reports each stream as a share of the total', () => {
		const shares = summary.streams.reduce((total, stream) => total + stream.share, 0);

		expect(shares).toBeCloseTo(1, 10);
		expect(streamOf(summary, 'db').share).toBeCloseTo(18_750 / 59_297.6, 10);
	});

	it('splits the total into tax-free, earned and dividend income', () => {
		expect(summary.taxFreeIncome).toBe(12_500);
		expect(summary.earnedIncome).toBe(44_797.6);
		expect(summary.dividendIncome).toBe(2_000);
		expect(summary.taxFreeIncome + summary.earnedIncome + summary.dividendIncome).toBeCloseTo(
			summary.annualIncome,
			10
		);
	});

	it('nets the income tax off', () => {
		expect(summary.netAnnualIncome).toBe(52_852.08);
		expect(summary.netMonthlyIncome).toBe(4_404.34);
		expect(summary.effectiveTaxRate).toBeCloseTo((6_445.52 / 59_297.6) * 100, 10);
	});

	it('adds up the real pots, keeping the Defined Benefit comparison figure separate', () => {
		expect(summary.totalCapital).toBe(650_000);
		// £18,750 a year at 4% is 25× — the same figure `fire.js` would quote for that target.
		expect(summary.definedBenefitCapitalEquivalent).toBe(468_750);
	});

	it('reports a rate of zero income on nothing without a NaN', () => {
		const empty = retirementIncomeSummary();

		expect(empty.effectiveTaxRate).toBe(0);
		expect(empty.netAnnualIncome).toBe(0);
		expect(empty.targetShare).toBe(1);
	});
});

describe('the target', () => {
	it('measures the target against income after tax', () => {
		const summary = retirementIncomeSummary(worked(), workedOptions);

		expect(summary.targetIncome).toBe(40_000);
		expect(summary.coversTarget).toBe(true);
		expect(summary.targetSurplus).toBe(12_852.08);
		expect(summary.targetGap).toBe(0);
		expect(summary.targetShare).toBeCloseTo(52_852.08 / 40_000, 10);
	});

	it('reports the shortfall when the streams do not reach it', () => {
		const summary = retirementIncomeSummary({
			...worked(),
			profile: createProfile({ retirement_target: 80_000 })
		});

		expect(summary.coversTarget).toBe(false);
		expect(summary.targetGap).toBeGreaterThan(0);
		expect(summary.targetSurplus).toBe(0);
	});

	it('takes a target from the plan over the profile', () => {
		const summary = retirementIncomeSummary(worked(), { ...workedOptions, targetIncome: 20_000 });

		expect(summary.targetIncome).toBe(20_000);
	});
});

describe('what no stream can use', () => {
	it('reports a snapshot holding sitting in a pension wrapper rather than counting it twice', () => {
		const uncounted = uncountedCapital([
			createInvestment({ wrapper: 'sipp', value: 400_000 }),
			createInvestment({ wrapper: 'workplace_pension', value: 60_000 })
		]);

		expect(uncounted).toHaveLength(1);
		expect(uncounted[0]).toMatchObject({
			id: 'pension_wrapped_holdings',
			count: 2,
			value: 460_000
		});
		expect(uncounted[0].reason).toContain('twice');
	});

	it('reports unwrapped holdings, a Junior ISA and sheltered dividend holdings', () => {
		const uncounted = uncountedCapital(
			[
				createInvestment({ wrapper: 'gia', value: 25_000 }),
				createInvestment({ wrapper: 'none', value: 5_000 }),
				createInvestment({ wrapper: 'jisa', value: 9_000 })
			],
			[createDividend({ wrapper: 'isa_stocks_shares', value: 80_000 })]
		);

		expect(uncounted.map((entry) => entry.id)).toEqual([
			'unsheltered_holdings',
			'junior_isa_holdings',
			'sheltered_dividends'
		]);
		expect(uncounted[0].value).toBe(30_000);
		expect(uncounted[1].value).toBe(9_000);
		expect(uncounted[2].value).toBe(80_000);
	});

	it('says nothing when everything recorded is in a stream', () => {
		expect(
			uncountedCapital(
				[createInvestment({ wrapper: 'isa_stocks_shares', value: 200_000 })],
				[createDividend({ wrapper: 'gia', value: 50_000 })]
			)
		).toEqual([]);
	});

	it('does not report a holding the user excluded from net worth on purpose', () => {
		expect(
			uncountedCapital([
				createInvestment({ wrapper: 'gia', value: 25_000, exclude_from_net_worth: true })
			])
		).toEqual([]);
	});

	it('labels and explains every slice it can report', () => {
		for (const [id, entry] of Object.entries(UNCOUNTED_CAPITAL_LABELS)) {
			expect(entry.label, id).toBeTruthy();
			expect(entry.reason, id).toBeTruthy();
		}
	});

	it('comes back on the summary', () => {
		const summary = retirementIncomeSummary({
			monthlyEntries: history([createInvestment({ wrapper: 'sipp', value: 400_000 })])
		});

		expect(summary.uncounted.map((entry) => entry.id)).toEqual(['pension_wrapped_holdings']);
	});
});

describe('reading the position', () => {
	it('draws on the latest recorded snapshot, not the first', () => {
		const summary = retirementIncomeSummary({
			monthlyEntries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ wrapper: 'isa_stocks_shares', value: 100_000 })]
				}),
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ wrapper: 'isa_stocks_shares', value: 150_000 })]
				})
			]
		});

		expect(streamOf(summary, 'isa_withdrawal').capital).toBe(150_000);
	});

	it('takes holdings handed to it directly over the recorded history', () => {
		const summary = retirementIncomeSummary({
			investments: [createInvestment({ wrapper: 'isa_stocks_shares', value: 10_000 })],
			monthlyEntries: history([createInvestment({ wrapper: 'isa_stocks_shares', value: 999_999 })])
		});

		expect(streamOf(summary, 'isa_withdrawal').capital).toBe(10_000);
	});

	it('names where each stream came from, and how many records fed it', () => {
		const summary = retirementIncomeSummary(worked(), workedOptions);

		expect(streamOf(summary, 'db').source).toBe('pensions');
		expect(streamOf(summary, 'db').sourceCount).toBe(1);
		expect(streamOf(summary, 'isa_withdrawal').source).toBe('monthly_entries');
		expect(streamOf(summary, 'gia_dividends').source).toBe('dividends');
		expect(streamOf(summary, 'state_pension').source).toBe('ni_record');
	});

	it('survives a document with nothing in it', () => {
		expect(() =>
			retirementIncomeSummary({ pensions: [], monthlyEntries: [], dividends: [] })
		).not.toThrow();
	});

	it('survives malformed records rather than throwing', () => {
		const summary = retirementIncomeSummary(
			/** @type {never} */ ({
				pensions: [null, { type: 'sipp', value: '90000' }, 'nonsense'],
				monthlyEntries: 'nope',
				dividends: [{ wrapper: 'gia', value: 10_000, yield_pct: null }]
			})
		);

		expect(summary.annualIncome).toBe(0);
		expect(summary.streams).toHaveLength(6);
	});
});

describe('normalising the assumptions', () => {
	it('defaults to drawdown at 4%, no annuity, and the State Pension included', () => {
		const input = normaliseRetirementIncomeInput();

		expect(input.withdrawalRate).toBe(4);
		expect(input.annuitisedShare).toBe(0);
		expect(input.annuityRate).toBe(DEFAULT_ANNUITY_RATE);
		expect(input.includeStatePension).toBe(true);
		expect(input.statePensionYears).toBeNull();
	});

	it('clamps rates and shares into a range that means something', () => {
		expect(normaliseRetirementIncomeInput({ withdrawalRate: 0 }).withdrawalRate).toBe(0.1);
		expect(normaliseRetirementIncomeInput({ withdrawalRate: 500 }).withdrawalRate).toBe(100);
		expect(normaliseRetirementIncomeInput({ annuityRate: -3 }).annuityRate).toBe(0.1);
		expect(normaliseRetirementIncomeInput({ annuitisedShare: 140 }).annuitisedShare).toBe(100);
		expect(normaliseRetirementIncomeInput({ annuitisedShare: -1 }).annuitisedShare).toBe(0);
	});

	it('falls back on anything that is not a number', () => {
		const input = normaliseRetirementIncomeInput(
			/** @type {never} */ ({ withdrawalRate: 'lots', targetIncome: null, taxRegion: 'narnia' })
		);

		expect(input.withdrawalRate).toBe(4);
		expect(input.targetIncome).toBe(0);
		expect(input.taxRegion).toBe('england_wales_ni');
	});

	it('keeps a recorded zero for NI years apart from “not recorded”', () => {
		expect(normaliseRetirementIncomeInput({ statePensionYears: 0 }).statePensionYears).toBe(0);
		expect(
			normaliseRetirementIncomeInput({ statePensionYears: null }).statePensionYears
		).toBeNull();
	});

	it('comes back on the summary, so every figure says what it was computed from', () => {
		const summary = retirementIncomeSummary(worked(), { annuitisedShare: 30, withdrawalRate: 3.5 });

		expect(summary.input.annuitisedShare).toBe(30);
		expect(summary.input.withdrawalRate).toBe(3.5);
	});
});
