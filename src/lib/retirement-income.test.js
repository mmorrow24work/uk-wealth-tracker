import { describe, expect, it } from 'vitest';

import { DIVIDEND_ALLOWANCE, DIVIDEND_ORDINARY_RATE } from './dividend-tax.js';
import { DEFINED_CONTRIBUTION_PENSION_TYPES } from './enums.js';
import { fireNumber, sustainableIncome } from './fire.js';
import { createDividend, createInvestment, createMonthlyEntry, createPension } from './model.js';
import {
	DEFAULT_ANNUITY_RATE,
	DEFAULT_RETIREMENT_INCOME_INPUT,
	PENSION_TAX_FREE_SHARE,
	RETIREMENT_INCOME_STREAMS,
	RETIREMENT_INCOME_STREAM_LABELS,
	RETIREMENT_ISA_WRAPPERS,
	UNCOUNTED_CAPITAL_LABELS,
	UNSHELTERED_WRAPPERS,
	definedContributionPot,
	definedContributionPots,
	giaDividendIncome,
	isaPot,
	normaliseRetirementIncomeInput,
	retirementIncomeSummary,
	retirementIncomeTax,
	uncountedCapital
} from './retirement-income.js';
import { FULL_STATE_PENSION_ANNUAL, annualStatePension } from './state-pension.js';
import { PERSONAL_ALLOWANCE } from './tax.js';

/* -------------------------------------------------------------------------- */
/* A worked position                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The position every summary test below runs against, chosen so each of the six streams has
 * something behind it and each of the four uncounted slices holds exactly one record.
 *
 * At the default assumptions (4% withdrawal, nothing annuitised, 35 NI years):
 *
 * ```text
 * Defined Benefit    £10,000    stated on the scheme record
 * annuity                 £0    nothing annuitised by default
 * drawdown           £16,000    £400,000 of DC pots at 4%
 * ISA withdrawals     £6,000    £100,000 Stocks ISA + £50,000 LISA at 4%
 * GIA dividends       £2,000    £50,000 at a 4% yield
 * State Pension      £12,547.60 the full rate: £241.30 × 52
 * ```
 */
const pensions = [
	createPension({ name: 'Workplace', type: 'dc_workplace', value: 200_000 }),
	createPension({ name: 'SIPP', type: 'sipp', value: 200_000 }),
	createPension({ name: 'Legacy scheme', type: 'db_final_salary', db_annual_income: 10_000 }),
	createPension({ name: 'LISA', type: 'lisa', value: 50_000 }),
	createPension({ name: 'State Pension', type: 'state', ni_qualifying_years: 35 })
];

const investments = [
	createInvestment({ name: 'Global tracker', wrapper: 'isa_stocks_shares', value: 100_000 }),
	createInvestment({ name: "Child's ISA", wrapper: 'jisa', value: 9_000 }),
	createInvestment({ name: 'Old SIPP line', wrapper: 'sipp', value: 30_000 }),
	createInvestment({ name: 'Taxable account', wrapper: 'gia', value: 20_000 })
];

const dividends = [
	createDividend({ name: 'Income fund', wrapper: 'gia', value: 50_000, yield_pct: 4 }),
	createDividend({
		name: 'Sheltered fund',
		wrapper: 'isa_stocks_shares',
		value: 10_000,
		yield_pct: 3
	})
];

/**
 * A profile with no date of birth, so State Pension *timing* never varies with the wall clock.
 *
 * @type {Partial<import('./types.js').Profile>}
 */
const profile = { tax_region: 'england_wales_ni', retirement_target: 30_000 };

/**
 * @param {Partial<import('./retirement-income.js').RetirementIncomeInput>} [input]
 * @returns {import('./retirement-income.js').RetirementIncomeSummary}
 */
function summarise(input = {}) {
	return retirementIncomeSummary({ pensions, investments, dividends, profile }, input);
}

/**
 * @param {import('./retirement-income.js').RetirementIncomeSummary} summary
 * @param {import('./retirement-income.js').RetirementIncomeStreamId} id
 * @returns {import('./retirement-income.js').RetirementIncomeStream}
 */
function stream(summary, id) {
	return /** @type {import('./retirement-income.js').RetirementIncomeStream} */ (
		summary.streams.find((entry) => entry.id === id)
	);
}

/* -------------------------------------------------------------------------- */
/* The stream list                                                             */
/* -------------------------------------------------------------------------- */

describe('the six streams', () => {
	it('is the issue’s own list, in the issue’s own order', () => {
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

	it('reports all six even on an empty position — convention (1)', () => {
		const summary = retirementIncomeSummary();

		expect(summary.streams.map((entry) => entry.id)).toEqual([...RETIREMENT_INCOME_STREAMS]);
		expect(summary.streams.every((entry) => entry.annualIncome === 0)).toBe(true);
		expect(summary.streams.every((entry) => entry.present === false)).toBe(true);
		expect(summary.annualIncome).toBe(0);
		expect(summary.netAnnualIncome).toBe(0);
		expect(summary.effectiveTaxRate).toBe(0);
	});

	it('excludes the Junior ISA from the retirement ISA wrappers', () => {
		expect(RETIREMENT_ISA_WRAPPERS).not.toContain('jisa');
		expect(RETIREMENT_ISA_WRAPPERS).toHaveLength(5);
	});

	it('treats an unwrapped holding as unsheltered, exactly as a GIA', () => {
		expect([...UNSHELTERED_WRAPPERS]).toEqual(['gia', 'none']);
	});
});

/* -------------------------------------------------------------------------- */
/* The pots                                                                    */
/* -------------------------------------------------------------------------- */

describe('definedContributionPots', () => {
	it('takes DC workplace pensions and SIPPs, and nothing else', () => {
		const pots = definedContributionPots(pensions);

		expect(pots.map((pot) => pot.type)).toEqual([...DEFINED_CONTRIBUTION_PENSION_TYPES]);
		expect(definedContributionPot(pensions)).toBe(400_000);
	});

	it('leaves a Lifetime ISA out — it is drawn tax-free, so it is an ISA', () => {
		expect(definedContributionPots(pensions).some((pot) => pot.type === 'lisa')).toBe(false);
		expect(definedContributionPot([createPension({ type: 'lisa', value: 50_000 })])).toBe(0);
	});

	it('is tolerant of anything', () => {
		expect(definedContributionPot()).toBe(0);
		expect(definedContributionPot(/** @type {never} */ ('not a list'))).toBe(0);
		expect(definedContributionPot([/** @type {never} */ (null), { type: 'sipp' }])).toBe(0);
	});
});

describe('isaPot', () => {
	it('adds every ISA wrapper except a Junior ISA, plus any LISA pension pot', () => {
		expect(isaPot(investments, pensions)).toEqual({ value: 150_000, count: 2 });
	});

	it('ignores a holding excluded from net worth', () => {
		const excluded = [
			...investments,
			createInvestment({ wrapper: 'isa_cash', value: 5_000, exclude_from_net_worth: true })
		];

		expect(isaPot(excluded, pensions).value).toBe(150_000);
	});

	it('is empty when nothing is recorded', () => {
		expect(isaPot()).toEqual({ value: 0, count: 0 });
	});
});

describe('giaDividendIncome', () => {
	it('prices only the unsheltered holdings, at value × yield', () => {
		expect(giaDividendIncome(dividends)).toEqual({ income: 2_000, value: 50_000, count: 1 });
	});

	it('ignores a holding’s DRIP/income strategy — this view is drawing on it either way', () => {
		const drip = [
			createDividend({ wrapper: 'gia', value: 50_000, yield_pct: 4, strategy: 'drip' })
		];
		const income = [
			createDividend({ wrapper: 'gia', value: 50_000, yield_pct: 4, strategy: 'income' })
		];

		expect(giaDividendIncome(drip)).toEqual(giaDividendIncome(income));
	});

	it('is empty when nothing is recorded', () => {
		expect(giaDividendIncome()).toEqual({ income: 0, value: 0, count: 0 });
	});
});

/* -------------------------------------------------------------------------- */
/* Assumptions                                                                 */
/* -------------------------------------------------------------------------- */

describe('normaliseRetirementIncomeInput', () => {
	it('defaults to nothing annuitised and the State Pension counted', () => {
		expect(normaliseRetirementIncomeInput()).toEqual(DEFAULT_RETIREMENT_INCOME_INPUT);
		expect(DEFAULT_RETIREMENT_INCOME_INPUT.annuitisedShare).toBe(0);
		expect(DEFAULT_RETIREMENT_INCOME_INPUT.includeStatePension).toBe(true);
		expect(DEFAULT_RETIREMENT_INCOME_INPUT.annuityRate).toBe(DEFAULT_ANNUITY_RATE);
	});

	it('clamps the rates and the annuitised share into their bands', () => {
		const input = normaliseRetirementIncomeInput({
			withdrawalRate: 0,
			annuityRate: 500,
			annuitisedShare: 140,
			targetIncome: -1
		});

		expect(input.withdrawalRate).toBeGreaterThan(0);
		expect(input.annuityRate).toBe(100);
		expect(input.annuitisedShare).toBe(100);
		expect(input.targetIncome).toBe(0);
	});

	it('keeps `null` NI years as "read them off the record", and a number as an override', () => {
		expect(
			normaliseRetirementIncomeInput({ statePensionYears: null }).statePensionYears
		).toBeNull();
		expect(normaliseRetirementIncomeInput({ statePensionYears: 22 }).statePensionYears).toBe(22);
		expect(normaliseRetirementIncomeInput({ statePensionYears: -4 }).statePensionYears).toBe(0);
	});

	it('falls back to England/Wales/NI on an unknown region, and never throws on junk', () => {
		expect(
			normaliseRetirementIncomeInput({ taxRegion: /** @type {never} */ ('narnia') }).taxRegion
		).toBe('england_wales_ni');
		expect(
			normaliseRetirementIncomeInput({ withdrawalRate: /** @type {never} */ ('four') })
				.withdrawalRate
		).toBe(DEFAULT_RETIREMENT_INCOME_INPUT.withdrawalRate);
	});
});

/* -------------------------------------------------------------------------- */
/* Tax                                                                         */
/* -------------------------------------------------------------------------- */

describe('retirementIncomeTax', () => {
	it('gives the earned income the personal allowance first', () => {
		const tax = retirementIncomeTax({ earnedIncome: 20_000, dividendIncome: 0 });

		expect(tax.personalAllowance).toBe(PERSONAL_ALLOWANCE);
		expect(tax.allowanceUsedByEarnedIncome).toBe(PERSONAL_ALLOWANCE);
		expect(tax.taxableEarnedIncome).toBe(20_000 - PERSONAL_ALLOWANCE);
		expect(tax.incomeTax).toBeCloseTo((20_000 - PERSONAL_ALLOWANCE) * 0.2, 2);
		expect(tax.dividendTax).toBe(0);
	});

	it('gives the dividends whatever allowance the earned income left', () => {
		const tax = retirementIncomeTax({ earnedIncome: 8_000, dividendIncome: 6_000 });

		expect(tax.allowanceUsedByEarnedIncome).toBe(8_000);
		expect(tax.allowanceUsedByDividends).toBe(PERSONAL_ALLOWANCE - 8_000);
		expect(tax.incomeTax).toBe(0);
		// £6,000 of dividends, £4,570 covered by the leftover allowance, £500 by the nil rate,
		// £930 taxed at the ordinary rate.
		expect(tax.dividendAllowanceUsed).toBe(DIVIDEND_ALLOWANCE);
		expect(DIVIDEND_ORDINARY_RATE).toBe(10.75);
		expect(tax.dividendTax).toBe(99.98); // 930 × 10.75%, rounded to whole pence.
	});

	it('tapers one allowance on the combined total, not on either half alone', () => {
		// £70,000 of each: neither half reaches £100,000, but together they lose £10,000 of allowance.
		const tax = retirementIncomeTax({ earnedIncome: 70_000, dividendIncome: 70_000 });

		expect(tax.taxableTotal).toBe(140_000);
		expect(tax.personalAllowance).toBe(0);
		expect(tax.allowanceTapered).toBe(true);
		expect(tax.allowanceUsedByEarnedIncome).toBe(0);
		expect(tax.allowanceUsedByDividends).toBe(0);
		expect(tax.taxableEarnedIncome).toBe(70_000);
	});

	it('runs the earned income through the region’s own ladder', () => {
		const england = retirementIncomeTax({ earnedIncome: 60_000, region: 'england_wales_ni' });
		const scotland = retirementIncomeTax({ earnedIncome: 60_000, region: 'scotland' });

		expect(scotland.region).toBe('scotland');
		expect(scotland.incomeTax).not.toBe(england.incomeTax);
		expect(england.bands.length).toBeGreaterThan(0);
		expect(england.bands.reduce((total, band) => total + band.tax, 0)).toBeCloseTo(
			england.incomeTax,
			2
		);
	});

	it('adds the two taxes into one total, and never throws on junk', () => {
		const tax = retirementIncomeTax({
			earnedIncome: /** @type {never} */ ('lots'),
			dividendIncome: -5
		});

		expect(tax.earnedIncome).toBe(0);
		expect(tax.dividendIncome).toBe(0);
		expect(tax.totalTax).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* What no stream can use                                                      */
/* -------------------------------------------------------------------------- */

describe('uncountedCapital', () => {
	it('names every slice no stream could price, with its value', () => {
		const uncounted = uncountedCapital(investments, dividends);

		expect(uncounted.map((slice) => slice.id)).toEqual([
			'pension_wrapped_holdings',
			'unsheltered_holdings',
			'junior_isa_holdings',
			'sheltered_dividends'
		]);
		expect(uncounted.map((slice) => slice.value)).toEqual([30_000, 20_000, 9_000, 10_000]);
		for (const slice of uncounted) {
			expect(slice.label).toBe(UNCOUNTED_CAPITAL_LABELS[slice.id].label);
			expect(slice.reason).toBeTruthy();
		}
	});

	it('drops a slice that holds nothing rather than reporting a zero', () => {
		expect(
			uncountedCapital([createInvestment({ wrapper: 'isa_stocks_shares', value: 1 })])
		).toEqual([]);
		expect(uncountedCapital()).toEqual([]);
	});

	it('says nothing about a holding deliberately excluded from net worth', () => {
		const excluded = [
			createInvestment({ wrapper: 'gia', value: 20_000, exclude_from_net_worth: true })
		];

		expect(uncountedCapital(excluded)).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* The whole view                                                              */
/* -------------------------------------------------------------------------- */

describe('retirementIncomeSummary', () => {
	it('prices each stream off its own collection, at the default assumptions', () => {
		const summary = summarise();

		expect(stream(summary, 'db').annualIncome).toBe(10_000);
		expect(stream(summary, 'annuity').annualIncome).toBe(0);
		expect(stream(summary, 'sipp_drawdown').annualIncome).toBe(16_000);
		expect(stream(summary, 'isa_withdrawal').annualIncome).toBe(6_000);
		expect(stream(summary, 'gia_dividends').annualIncome).toBe(2_000);
		expect(stream(summary, 'state_pension').annualIncome).toBe(FULL_STATE_PENSION_ANNUAL);

		expect(summary.annualIncome).toBeCloseTo(46_547.6, 2);
		expect(summary.monthlyIncome).toBeCloseTo(3_878.97, 2);
	});

	it('names the collection behind each stream, and how many records fed it', () => {
		const summary = summarise();

		expect(stream(summary, 'db').source).toBe('pensions');
		expect(stream(summary, 'sipp_drawdown').source).toBe('pensions');
		expect(stream(summary, 'sipp_drawdown').sourceCount).toBe(2);
		expect(stream(summary, 'isa_withdrawal').source).toBe('monthly_entries');
		expect(stream(summary, 'gia_dividends').source).toBe('dividends');
		expect(stream(summary, 'state_pension').source).toBe('ni_record');
		expect(stream(summary, 'state_pension').sourceCount).toBe(1);
	});

	it('splits a quarter of every DC pound out tax-free — convention (5)', () => {
		const drawdown = stream(summarise(), 'sipp_drawdown');

		expect(drawdown.taxFreeIncome).toBe((16_000 * PENSION_TAX_FREE_SHARE) / 100);
		expect(drawdown.taxableIncome).toBe(12_000);
		expect(drawdown.taxFreeIncome + drawdown.taxableIncome).toBe(drawdown.annualIncome);
	});

	it('treats ISA withdrawals as tax-free in full and Defined Benefit as taxable in full', () => {
		const summary = summarise();

		expect(stream(summary, 'isa_withdrawal').taxableIncome).toBe(0);
		expect(stream(summary, 'isa_withdrawal').taxTreatment).toBe('tax_free');
		expect(stream(summary, 'db').taxFreeIncome).toBe(0);
		expect(stream(summary, 'db').taxTreatment).toBe('earned_income');
		expect(stream(summary, 'state_pension').taxTreatment).toBe('earned_income');
		expect(stream(summary, 'gia_dividends').taxTreatment).toBe('dividend');
	});

	it('taxes the earned streams and the dividends against one shared allowance', () => {
		const summary = summarise();

		expect(summary.taxFreeIncome).toBe(10_000);
		expect(summary.earnedIncome).toBeCloseTo(34_547.6, 2);
		expect(summary.dividendIncome).toBe(2_000);
		expect(summary.tax.taxableTotal).toBeCloseTo(36_547.6, 2);
		expect(summary.tax.personalAllowance).toBe(PERSONAL_ALLOWANCE);
		// £21,977.60 of basic-rate earned income, and £1,500 of dividend after the £500 nil rate.
		expect(summary.tax.incomeTax).toBeCloseTo(4_395.52, 2);
		expect(summary.tax.dividendTax).toBeCloseTo(161.25, 2);
		expect(summary.totalTax).toBeCloseTo(4_556.77, 2);
		expect(summary.netAnnualIncome).toBeCloseTo(41_990.83, 2);
		expect(summary.netMonthlyIncome).toBeCloseTo(3_499.24, 2);
		expect(summary.effectiveTaxRate).toBeCloseTo((4_556.77 / 46_547.6) * 100, 4);
	});

	it('never taxes the tax-free streams, however large they are', () => {
		const isaOnly = retirementIncomeSummary({
			investments: [createInvestment({ wrapper: 'isa_stocks_shares', value: 2_000_000 })]
		});

		expect(isaOnly.annualIncome).toBe(80_000);
		expect(isaOnly.totalTax).toBe(0);
		expect(isaOnly.netAnnualIncome).toBe(80_000);
	});

	it('gives every stream its share of the gross total, adding to one', () => {
		const summary = summarise();
		const shares = summary.streams.reduce((total, entry) => total + entry.share, 0);

		expect(shares).toBeCloseTo(1, 10);
		expect(stream(summary, 'sipp_drawdown').share).toBeCloseTo(16_000 / 46_547.6, 6);
	});

	it('splits one DC pot between the annuity and drawdown, never both in full', () => {
		const summary = summarise({ annuitisedShare: 25, annuityRate: 6.5 });

		expect(stream(summary, 'annuity').capital).toBe(100_000);
		expect(stream(summary, 'sipp_drawdown').capital).toBe(300_000);
		expect(stream(summary, 'annuity').annualIncome).toBe(sustainableIncome(100_000, 6.5));
		expect(stream(summary, 'sipp_drawdown').annualIncome).toBe(sustainableIncome(300_000, 4));
		expect(stream(summary, 'annuity').capital + stream(summary, 'sipp_drawdown').capital).toBe(
			400_000
		);
	});

	it('applies the withdrawal rate to drawdown and ISA withdrawals alike — convention (4)', () => {
		const summary = summarise({ withdrawalRate: 3 });

		expect(stream(summary, 'sipp_drawdown').rate).toBe(3);
		expect(stream(summary, 'isa_withdrawal').rate).toBe(3);
		expect(stream(summary, 'sipp_drawdown').annualIncome).toBe(12_000);
		expect(stream(summary, 'isa_withdrawal').annualIncome).toBe(4_500);
	});

	it('reports the dividend stream’s rate as the portfolio yield it came from', () => {
		expect(stream(summarise(), 'gia_dividends').rate).toBe(4);
	});

	it('counts real pots as capital and prices the two promises separately', () => {
		const summary = summarise();

		// £400,000 of DC pots + £150,000 of ISA/LISA + £50,000 of dividend holdings.
		expect(summary.totalCapital).toBe(600_000);
		expect(summary.promisedCapitalEquivalent).toBe(
			fireNumber(10_000, 4) + fireNumber(FULL_STATE_PENSION_ANNUAL, 4)
		);
	});

	it('measures the target against income after tax — convention (7)', () => {
		const summary = summarise();

		expect(summary.targetIncome).toBe(30_000);
		expect(summary.coversTarget).toBe(true);
		expect(summary.targetGap).toBe(0);
		expect(summary.targetSurplus).toBeCloseTo(11_990.83, 2);
		expect(summary.targetShare).toBeCloseTo(41_990.83 / 30_000, 6);
	});

	it('reports a shortfall against a target the income cannot reach', () => {
		const summary = summarise({ targetIncome: 60_000 });

		expect(summary.coversTarget).toBe(false);
		expect(summary.targetGap).toBeCloseTo(60_000 - 41_990.83, 2);
		expect(summary.targetSurplus).toBe(0);
	});

	it('treats no target at all as nothing left to reach', () => {
		const summary = retirementIncomeSummary({}, { targetIncome: 0 });

		expect(summary.targetShare).toBe(1);
		expect(summary.coversTarget).toBe(true);
	});

	it('reads the tax region and the target off the profile, and lets a caller override both', () => {
		const scottish = retirementIncomeSummary(
			{ pensions, investments, dividends, profile: { ...profile, tax_region: 'scotland' } },
			{}
		);

		expect(scottish.input.taxRegion).toBe('scotland');
		expect(scottish.tax.region).toBe('scotland');
		expect(summarise({ taxRegion: 'scotland' }).tax.region).toBe('scotland');
		expect(summarise({ targetIncome: 45_000 }).targetIncome).toBe(45_000);
	});

	it('lists what no stream could use', () => {
		expect(summarise().uncounted.map((slice) => slice.id)).toEqual([
			'pension_wrapped_holdings',
			'unsheltered_holdings',
			'junior_isa_holdings',
			'sheltered_dividends'
		]);
	});

	it('never counts a SIPP twice when it is recorded as both a pot and a holding', () => {
		const summary = summarise();
		const wrapped = summary.uncounted.find((slice) => slice.id === 'pension_wrapped_holdings');

		expect(stream(summary, 'sipp_drawdown').capital).toBe(400_000);
		expect(wrapped?.value).toBe(30_000);
	});
});

/* -------------------------------------------------------------------------- */
/* The State Pension                                                           */
/* -------------------------------------------------------------------------- */

describe('the State Pension stream', () => {
	it('is `state-pension.js`’s own arithmetic, off the `type: state` record', () => {
		const summary = summarise();

		expect(summary.statePensionRecorded).toBe(true);
		expect(summary.statePensionYears).toBe(35);
		expect(summary.statePension.projection.full).toBe(true);
		expect(stream(summary, 'state_pension').annualIncome).toBe(annualStatePension(35));
	});

	it('adds the years still expected to the years already earned', () => {
		const partial = [createPension({ type: 'state', ni_qualifying_years: 20, ni_future_years: 8 })];
		const summary = retirementIncomeSummary({ pensions: partial });

		expect(summary.statePensionYears).toBe(28);
		expect(stream(summary, 'state_pension').annualIncome).toBe(annualStatePension(28));
	});

	it('pays nothing below the ten-year cliff', () => {
		const summary = retirementIncomeSummary({
			pensions: [createPension({ type: 'state', ni_qualifying_years: 9 })]
		});

		expect(stream(summary, 'state_pension').annualIncome).toBe(0);
		expect(summary.statePension.projection.qualifies).toBe(false);
	});

	it('lets a typed count override the record, without adding the record’s future years', () => {
		const summary = retirementIncomeSummary(
			{ pensions: [createPension({ type: 'state', ni_qualifying_years: 20, ni_future_years: 8 })] },
			{ statePensionYears: 35 }
		);

		expect(summary.statePensionYears).toBe(35);
		expect(stream(summary, 'state_pension').annualIncome).toBe(FULL_STATE_PENSION_ANNUAL);
		// The override changes the figure, not the fact that a record exists.
		expect(summary.statePensionRecorded).toBe(true);
	});

	it('still says no record exists when the count was typed into the card instead', () => {
		const summary = retirementIncomeSummary({}, { statePensionYears: 35 });

		expect(summary.statePensionRecorded).toBe(false);
		expect(stream(summary, 'state_pension').sourceCount).toBe(0);
		expect(stream(summary, 'state_pension').annualIncome).toBe(FULL_STATE_PENSION_ANNUAL);
	});

	it('drops the stream entirely when the plan does not count it', () => {
		const on = summarise();
		const off = summarise({ includeStatePension: false });

		expect(stream(off, 'state_pension').annualIncome).toBe(0);
		expect(off.annualIncome).toBeCloseTo(on.annualIncome - FULL_STATE_PENSION_ANNUAL, 2);
		// Switching it off does not erase what the record says it would have been.
		expect(off.statePension.projection.annualIncome).toBe(FULL_STATE_PENSION_ANNUAL);
		expect(off.promisedCapitalEquivalent).toBe(fireNumber(10_000, 4));
	});

	it('reports when the State Pension starts, from the profile’s date of birth', () => {
		const summary = retirementIncomeSummary(
			{ pensions, profile: { ...profile, dob_year: 1990, dob_month: 6 } },
			{},
			{ now: new Date('2026-08-07T00:00:00Z') }
		);

		expect(summary.statePension.timing.available).toBe(true);
		expect(summary.statePension.timing.statePensionAge).toBe(68);
		expect(summary.statePension.timing.yearsRemaining).toBe(32);
	});
});

/* -------------------------------------------------------------------------- */
/* Reading a recorded position                                                 */
/* -------------------------------------------------------------------------- */

describe('reading the position', () => {
	it('draws ISA withdrawals from the latest monthly snapshot', () => {
		const entries = [
			createMonthlyEntry({
				month: 1,
				year: 2026,
				investments: [createInvestment({ wrapper: 'isa_stocks_shares', value: 40_000 })]
			}),
			createMonthlyEntry({
				month: 6,
				year: 2026,
				investments: [createInvestment({ wrapper: 'isa_stocks_shares', value: 100_000 })]
			})
		];
		const summary = retirementIncomeSummary({ monthlyEntries: entries });

		expect(stream(summary, 'isa_withdrawal').capital).toBe(100_000);
		expect(stream(summary, 'isa_withdrawal').annualIncome).toBe(4_000);
	});

	it('prefers holdings handed in directly over the recorded history', () => {
		const entries = [
			createMonthlyEntry({
				investments: [createInvestment({ wrapper: 'isa_stocks_shares', value: 40_000 })]
			})
		];
		const summary = retirementIncomeSummary({
			monthlyEntries: entries,
			investments: [createInvestment({ wrapper: 'isa_stocks_shares', value: 10_000 })]
		});

		expect(stream(summary, 'isa_withdrawal').capital).toBe(10_000);
	});

	it('survives a position of nothing but junk', () => {
		const summary = retirementIncomeSummary(
			/** @type {never} */ ({
				pensions: 'no',
				monthlyEntries: null,
				dividends: 42,
				profile: null
			})
		);

		expect(summary.annualIncome).toBe(0);
		expect(summary.streams).toHaveLength(6);
		expect(summary.uncounted).toEqual([]);
	});
});
