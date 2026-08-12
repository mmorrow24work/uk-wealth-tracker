import { describe, expect, it } from 'vitest';

import { definedBenefitTotals } from './defined-benefit.js';
import {
	createAppData,
	createDebt,
	createInvestment,
	createMonthlyEntry,
	createPension,
	createProfile
} from './model.js';
import { pensionReliefSummary } from './pension-relief.js';
import { buildReport, reportNetWorth, reportPensions, reportTax } from './report.js';
import { definedContributionPot, definedContributionPots } from './retirement-income.js';
import { statePensionOutlook } from './state-pension.js';
import { takeHomeBreakdown } from './tax.js';

describe('reportNetWorth', () => {
	it('reports no data when there are no monthly entries', () => {
		const report = reportNetWorth([]);
		expect(report.hasData).toBe(false);
		expect(report.asOf).toBeNull();
		expect(report.holdings).toEqual([]);
		expect(report.debts).toEqual([]);
		expect(report.investmentTotal).toBe(0);
		expect(report.debtTotal).toBe(0);
		expect(report.netWorth).toBe(0);
		expect(report.holdingsByType).toEqual([]);
	});

	it('distinguishes a genuinely zero net worth from no data at all', () => {
		const entry = createMonthlyEntry({
			month: 3,
			year: 2026,
			investments: [createInvestment({ value: 1000 })],
			debts: [createDebt({ balance: 1000 })]
		});

		const report = reportNetWorth([entry]);
		expect(report.hasData).toBe(true);
		expect(report.netWorth).toBe(0);
	});

	it('anchors on the latest recorded snapshot, not the first or the largest', () => {
		const older = createMonthlyEntry({
			month: 1,
			year: 2026,
			investments: [createInvestment({ value: 500_000 })]
		});
		const latest = createMonthlyEntry({
			month: 6,
			year: 2026,
			investments: [createInvestment({ value: 10_000 })]
		});

		const report = reportNetWorth([older, latest]);
		expect(report.asOf).toEqual({ month: 6, year: 2026 });
		expect(report.investmentTotal).toBe(10_000);
	});

	it('sums investments and debts into a net worth total', () => {
		const entry = createMonthlyEntry({
			investments: [createInvestment({ value: 100_000 }), createInvestment({ value: 20_000 })],
			debts: [createDebt({ balance: 15_000 })]
		});

		const report = reportNetWorth([entry]);
		expect(report.investmentTotal).toBe(120_000);
		expect(report.debtTotal).toBe(15_000);
		expect(report.netWorth).toBe(105_000);
	});

	it('excludes a holding or debt flagged exclude_from_net_worth from the totals', () => {
		const entry = createMonthlyEntry({
			investments: [
				createInvestment({ value: 300_000, type: 'property', exclude_from_net_worth: true }),
				createInvestment({ value: 5_000 })
			],
			debts: [
				createDebt({ balance: 200_000, type: 'mortgage', exclude_from_net_worth: true }),
				createDebt({ balance: 1_000 })
			]
		});

		const report = reportNetWorth([entry]);
		expect(report.investmentTotal).toBe(5_000);
		expect(report.debtTotal).toBe(1_000);
	});

	it('still lists an excluded holding or debt, even though it is not in the totals', () => {
		const entry = createMonthlyEntry({
			investments: [createInvestment({ value: 300_000, exclude_from_net_worth: true })],
			debts: [createDebt({ balance: 200_000, exclude_from_net_worth: true })]
		});

		const report = reportNetWorth([entry]);
		expect(report.holdings).toHaveLength(1);
		expect(report.debts).toHaveLength(1);
	});

	it('groups counted holdings by investment type, in INVESTMENT_TYPES order', () => {
		const entry = createMonthlyEntry({
			investments: [
				createInvestment({ type: 'cash', value: 5_000 }),
				createInvestment({ type: 'stocks_isa', value: 40_000 }),
				createInvestment({ type: 'stocks_isa', value: 10_000 })
			]
		});

		const report = reportNetWorth([entry]);
		expect(report.holdingsByType.map((group) => group.type)).toEqual(['stocks_isa', 'cash']);
		const isaGroup = report.holdingsByType.find((group) => group.type === 'stocks_isa');
		expect(isaGroup).toBeDefined();
		if (!isaGroup) return;
		expect(isaGroup.label).toBe('Stocks ISA');
		expect(isaGroup.total).toBe(50_000);
		expect(isaGroup.holdings).toHaveLength(2);
	});

	it('omits investment types with no counted holdings', () => {
		const entry = createMonthlyEntry({ investments: [createInvestment({ type: 'crypto' })] });
		const report = reportNetWorth([entry]);
		expect(report.holdingsByType.map((group) => group.type)).toEqual(['crypto']);
	});

	it('excludes a holding from its type group when flagged exclude_from_net_worth', () => {
		const entry = createMonthlyEntry({
			investments: [
				createInvestment({ type: 'property', value: 300_000, exclude_from_net_worth: true })
			]
		});

		const report = reportNetWorth([entry]);
		expect(report.holdingsByType).toEqual([]);
	});

	it('group totals sum back to the overall investment total', () => {
		const entry = createMonthlyEntry({
			investments: [
				createInvestment({ type: 'sipp', value: 80_000 }),
				createInvestment({ type: 'cash', value: 12_000 }),
				createInvestment({ type: 'property', value: 250_000, exclude_from_net_worth: true })
			]
		});

		const report = reportNetWorth([entry]);
		const groupTotal = report.holdingsByType.reduce((total, group) => total + group.total, 0);
		expect(groupTotal).toBe(report.investmentTotal);
	});
});

describe('reportTax', () => {
	it('reports no data when no salary has been recorded', () => {
		const report = reportTax(createProfile());
		expect(report.hasData).toBe(false);
		expect(report.breakdown).toBeNull();
	});

	it('reports no data for a salary of exactly £0, same as an unrecorded one', () => {
		const report = reportTax(createProfile({ gross_salary: 0 }));
		expect(report.hasData).toBe(false);
		expect(report.breakdown).toBeNull();
	});

	it('builds a take-home breakdown from a recorded salary and region', () => {
		const profile = createProfile({ gross_salary: 60_000, tax_region: 'england_wales_ni' });
		const report = reportTax(profile);
		expect(report.hasData).toBe(true);
		expect(report.breakdown).toEqual(
			takeHomeBreakdown({ income: 60_000, region: 'england_wales_ni' })
		);
	});

	it('honours the Scottish band ladder', () => {
		const profile = createProfile({ gross_salary: 60_000, tax_region: 'scotland' });
		const report = reportTax(profile);
		expect(report.hasData).toBe(true);
		expect(report.breakdown).toEqual(takeHomeBreakdown({ income: 60_000, region: 'scotland' }));
		if (!report.breakdown) return;
		expect(report.breakdown.region).toBe('scotland');
	});
});

describe('reportPensions', () => {
	it('reports no data when no pensions are recorded', () => {
		const report = reportPensions([]);
		expect(report.hasData).toBe(false);
		expect(report.dcPots).toEqual([]);
		expect(report.dcPotCount).toBe(0);
		expect(report.dcPotTotal).toBe(0);
		expect(report.definedBenefit.annualIncome).toBe(0);
		expect(report.statePension.projection.annualIncome).toBe(0);
		expect(report.statePension.projection.totalYears).toBe(0);
		expect(report.pensionRelief.totalRelief).toBe(0);
		expect(report.pensionRelief.count).toBe(0);
	});

	it('defaults to no data when called with nothing at all', () => {
		expect(reportPensions().hasData).toBe(false);
	});

	it('reports the DC pot count and total value, from retirement-income.js', () => {
		const pensions = [
			createPension({ type: 'dc_workplace', value: 80_000 }),
			createPension({ type: 'sipp', value: 40_000 }),
			createPension({ type: 'db_final_salary', db_annual_income: 10_000 })
		];

		const report = reportPensions(pensions);
		expect(report.hasData).toBe(true);
		expect(report.dcPots).toEqual(definedContributionPots(pensions));
		expect(report.dcPotCount).toBe(2);
		expect(report.dcPotTotal).toBe(definedContributionPot(pensions));
		expect(report.dcPotTotal).toBe(120_000);
	});

	it('reports the guaranteed Defined Benefit income, from defined-benefit.js', () => {
		const pensions = [
			createPension({ type: 'db_final_salary', db_annual_income: 12_000 }),
			createPension({ type: 'db_care', db_annual_income: 6_000 })
		];

		const report = reportPensions(pensions);
		expect(report.definedBenefit).toEqual(definedBenefitTotals(pensions));
		expect(report.definedBenefit.annualIncome).toBe(18_000);
	});

	it('reads hasData: true with a zero Defined Benefit income for a household with DC pensions only', () => {
		const pensions = [createPension({ type: 'dc_workplace', value: 50_000 })];

		const report = reportPensions(pensions);
		expect(report.hasData).toBe(true);
		expect(report.definedBenefit.annualIncome).toBe(0);
		expect(report.definedBenefit.count).toBe(0);
	});

	it('reads hasData: true with a zero DC pot total for a household with a Defined Benefit scheme only', () => {
		const pensions = [createPension({ type: 'db_final_salary', db_annual_income: 15_000 })];

		const report = reportPensions(pensions);
		expect(report.hasData).toBe(true);
		expect(report.dcPotCount).toBe(0);
		expect(report.dcPotTotal).toBe(0);
	});

	it('reports the State Pension projection, from state-pension.js, dated against the injected clock', () => {
		const now = new Date(Date.UTC(2026, 3, 1));
		const profile = createProfile({ dob_year: 1970, dob_month: 6 });
		const pensions = [
			createPension({ type: 'state', ni_qualifying_years: 20, ni_future_years: 5 })
		];

		const report = reportPensions(pensions, profile, { now });
		expect(report.statePension).toEqual(statePensionOutlook(pensions, profile, { now }));
		expect(report.statePension.projection.totalYears).toBe(25);
		expect(report.statePension.projection.annualIncome).toBeGreaterThan(0);
	});

	it('reads hasData: true with a zero State Pension projection for a household with no NI years recorded', () => {
		const pensions = [createPension({ type: 'dc_workplace', value: 50_000 })];

		const report = reportPensions(pensions, createProfile());
		expect(report.hasData).toBe(true);
		expect(report.statePension.projection.recorded).toBe(false);
		expect(report.statePension.projection.annualIncome).toBe(0);
	});

	it('reports pension tax relief, from pension-relief.js', () => {
		const profile = createProfile({ gross_salary: 80_000 });
		const pensions = [createPension({ type: 'sipp', contribution_pct: 5 })];

		const report = reportPensions(pensions, profile);
		expect(report.pensionRelief).toEqual(pensionReliefSummary(pensions, profile));
		expect(report.pensionRelief.count).toBe(1);
		expect(report.pensionRelief.totalRelief).toBeGreaterThan(0);
	});

	it('reads hasData: true with a zero pension tax relief total for a household with no salary recorded', () => {
		const pensions = [createPension({ type: 'sipp', contribution_pct: 5 })];

		const report = reportPensions(pensions, createProfile());
		expect(report.hasData).toBe(true);
		expect(report.pensionRelief.netContribution).toBe(0);
		expect(report.pensionRelief.totalRelief).toBe(0);
	});
});

describe('buildReport', () => {
	it('returns a netWorth section built from AppData.monthly_entries', () => {
		const appData = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					investments: [createInvestment({ value: 10_000 })],
					debts: [createDebt({ balance: 2_000 })]
				})
			]
		});

		const report = buildReport(appData);
		expect(report.netWorth.hasData).toBe(true);
		expect(report.netWorth.netWorth).toBe(8_000);
	});

	it('reports no data for a fresh AppData with no monthly entries', () => {
		const report = buildReport(createAppData());
		expect(report.netWorth.hasData).toBe(false);
	});

	it('returns a tax section built from AppData.profile', () => {
		const appData = createAppData({ profile: createProfile({ gross_salary: 45_000 }) });
		const report = buildReport(appData);
		expect(report.tax.hasData).toBe(true);
		if (!report.tax.breakdown) return;
		expect(report.tax.breakdown.income).toBe(45_000);
	});

	it('reports no tax data for a fresh AppData with no salary recorded', () => {
		const report = buildReport(createAppData());
		expect(report.tax.hasData).toBe(false);
	});

	it('returns a pensions section built from AppData.pensions', () => {
		const appData = createAppData({
			pensions: [createPension({ type: 'dc_workplace', value: 30_000 })]
		});

		const report = buildReport(appData);
		expect(report.pensions.hasData).toBe(true);
		expect(report.pensions.dcPotTotal).toBe(30_000);
	});

	it('reports no pensions data for a fresh AppData with no pensions recorded', () => {
		const report = buildReport(createAppData());
		expect(report.pensions.hasData).toBe(false);
	});

	it('threads AppData.profile and options.now down to the State Pension projection', () => {
		const now = new Date(Date.UTC(2026, 3, 1));
		const appData = createAppData({
			profile: createProfile({ dob_year: 1970, dob_month: 6 }),
			pensions: [createPension({ type: 'state', ni_qualifying_years: 30 })]
		});

		const report = buildReport(appData, { now });
		expect(report.pensions.statePension).toEqual(
			statePensionOutlook(appData.pensions, appData.profile, { now })
		);
		expect(report.pensions.statePension.timing.available).toBe(true);
	});

	it('threads AppData.profile down to pension tax relief', () => {
		const appData = createAppData({
			profile: createProfile({ gross_salary: 100_000 }),
			pensions: [createPension({ type: 'dc_workplace', contribution_pct: 5 })]
		});

		const report = buildReport(appData);
		expect(report.pensions.pensionRelief).toEqual(
			pensionReliefSummary(appData.pensions, appData.profile)
		);
		expect(report.pensions.pensionRelief.totalRelief).toBeGreaterThan(0);
	});
});
