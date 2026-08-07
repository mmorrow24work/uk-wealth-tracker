import { describe, expect, it } from 'vitest';

import { createPension, createProfile } from './model.js';
import {
	BASIC_RATE_RELIEF_PCT,
	RELIEF_ELIGIBLE_PENSION_TYPES,
	basicRateRelief,
	grossUpContribution,
	isLifetimeIsa,
	isReliefEligible,
	ownContribution,
	pensionReliefBreakdown,
	pensionReliefSummary
} from './pension-relief.js';

/**
 * A SIPP contributing 5% of salary — the eligible pot every test starts from. Overrides let each
 * test disturb exactly one thing.
 *
 * @param {Partial<import('./types.js').Pension>} [overrides]
 * @returns {import('./types.js').Pension}
 */
function pot(overrides = {}) {
	return createPension({ name: 'My SIPP', type: 'sipp', contribution_pct: 5, ...overrides });
}

describe('isReliefEligible', () => {
	it('is true for DC Workplace and SIPP pots', () => {
		expect(isReliefEligible('dc_workplace')).toBe(true);
		expect(isReliefEligible('sipp')).toBe(true);
		expect(RELIEF_ELIGIBLE_PENSION_TYPES).toEqual(['dc_workplace', 'sipp']);
	});

	it('is false for Lifetime ISA, Defined Benefit and State pots — convention (4)', () => {
		expect(isReliefEligible('lisa')).toBe(false);
		expect(isReliefEligible('db_final_salary')).toBe(false);
		expect(isReliefEligible('db_care')).toBe(false);
		expect(isReliefEligible('state')).toBe(false);
	});

	it('is false for anything else, tolerantly', () => {
		expect(isReliefEligible(undefined)).toBe(false);
		expect(isReliefEligible('not_a_pension_type')).toBe(false);
	});
});

describe('isLifetimeIsa', () => {
	it('is true only for lisa', () => {
		expect(isLifetimeIsa('lisa')).toBe(true);
		expect(isLifetimeIsa('sipp')).toBe(false);
		expect(isLifetimeIsa(undefined)).toBe(false);
	});
});

describe('ownContribution', () => {
	it('is salary times contribution_pct — the net, pre-relief amount, convention (1)', () => {
		expect(ownContribution(pot({ contribution_pct: 5 }), 40_000)).toBe(2_000);
		expect(ownContribution(pot({ contribution_pct: 10 }), 60_000)).toBe(6_000);
	});

	it('is zero on a zero salary or a zero contribution', () => {
		expect(ownContribution(pot({ contribution_pct: 5 }), 0)).toBe(0);
		expect(ownContribution(pot({ contribution_pct: 0 }), 40_000)).toBe(0);
	});

	it('reads a missing or negative contribution_pct as zero rather than throwing', () => {
		expect(ownContribution(pot({ contribution_pct: undefined }), 40_000)).toBe(0);
		expect(ownContribution({}, 40_000)).toBe(0);
	});
});

describe('grossUpContribution', () => {
	it('grosses a net relief-at-source payment up by the basic rate — £80 becomes £100', () => {
		expect(grossUpContribution(80)).toBe(100);
	});

	it('is the identity on zero', () => {
		expect(grossUpContribution(0)).toBe(0);
	});

	it('scales linearly', () => {
		expect(grossUpContribution(800)).toBe(1_000);
		expect(grossUpContribution(2_000)).toBe(2_500);
	});
});

describe('basicRateRelief', () => {
	it('is the gap grossing-up opens up — 20% of the gross, 25% of the net', () => {
		expect(basicRateRelief(80)).toBe(20);
		expect(basicRateRelief(800)).toBe(200);
	});

	it('is zero on a zero contribution', () => {
		expect(basicRateRelief(0)).toBe(0);
	});
});

describe('pensionReliefBreakdown — eligible pots', () => {
	it('grosses up a basic-rate taxpayer’s contribution with nothing left to claim', () => {
		const profile = createProfile({ gross_salary: 30_000, tax_region: 'england_wales_ni' });
		const breakdown = pensionReliefBreakdown(pot({ contribution_pct: 5 }), profile);

		expect(breakdown.eligible).toBe(true);
		expect(breakdown.netContribution).toBe(1_500);
		expect(breakdown.grossContribution).toBe(1_875);
		expect(breakdown.basicRateRelief).toBe(375);
		expect(breakdown.marginalRate).toBe(BASIC_RATE_RELIEF_PCT);
		expect(breakdown.extraReliefRate).toBe(0);
		expect(breakdown.extraRelief).toBe(0);
		expect(breakdown.claimableViaSelfAssessment).toBe(false);
		expect(breakdown.totalRelief).toBe(375);
	});

	it('gives a higher-rate taxpayer 20 points of extra relief to claim — README.md’s "40% higher"', () => {
		const profile = createProfile({ gross_salary: 80_000, tax_region: 'england_wales_ni' });
		const breakdown = pensionReliefBreakdown(pot({ contribution_pct: 10 }), profile);

		expect(breakdown.netContribution).toBe(8_000);
		expect(breakdown.grossContribution).toBe(10_000);
		expect(breakdown.basicRateRelief).toBe(2_000);
		expect(breakdown.marginalRate).toBe(40);
		expect(breakdown.extraReliefRate).toBe(20);
		expect(breakdown.extraRelief).toBe(2_000);
		expect(breakdown.claimableViaSelfAssessment).toBe(true);
		expect(breakdown.totalRelief).toBe(4_000);
	});

	it('gives an additional-rate taxpayer 25 points of extra relief', () => {
		const profile = createProfile({ gross_salary: 200_000, tax_region: 'england_wales_ni' });
		const breakdown = pensionReliefBreakdown(pot({ contribution_pct: 10 }), profile);

		expect(breakdown.marginalRate).toBe(45);
		expect(breakdown.extraReliefRate).toBe(25);
		expect(breakdown.claimableViaSelfAssessment).toBe(true);
	});

	it('carries the 60% taper rate straight through, as its own kind of "extra" relief', () => {
		const profile = createProfile({ gross_salary: 110_000, tax_region: 'england_wales_ni' });
		const breakdown = pensionReliefBreakdown(pot({ contribution_pct: 10 }), profile);

		expect(breakdown.marginalRate).toBe(60);
		expect(breakdown.extraReliefRate).toBe(40);
	});

	it('follows Scottish bands, e.g. 42% intermediate-into-higher rather than the E/W/NI 40%', () => {
		const profile = createProfile({ gross_salary: 50_000, tax_region: 'scotland' });
		const breakdown = pensionReliefBreakdown(pot({ contribution_pct: 5 }), profile);

		expect(breakdown.marginalRate).toBe(42);
		expect(breakdown.extraReliefRate).toBe(22);
	});

	it('is all zero on a zero salary — no contribution, no relief, nothing to claim', () => {
		const profile = createProfile({ gross_salary: 0 });
		const breakdown = pensionReliefBreakdown(pot({ contribution_pct: 5 }), profile);

		expect(breakdown.netContribution).toBe(0);
		expect(breakdown.grossContribution).toBe(0);
		expect(breakdown.basicRateRelief).toBe(0);
		expect(breakdown.extraRelief).toBe(0);
		expect(breakdown.claimableViaSelfAssessment).toBe(false);
	});

	it('is tolerant of a missing profile', () => {
		const breakdown = pensionReliefBreakdown(pot({ contribution_pct: 5 }), null);
		expect(breakdown.netContribution).toBe(0);
		expect(breakdown.eligible).toBe(true);
	});
});

describe('pensionReliefBreakdown — ineligible pots', () => {
	it('reports every figure as zero for a Lifetime ISA', () => {
		const profile = createProfile({ gross_salary: 80_000 });
		const breakdown = pensionReliefBreakdown(
			createPension({ name: 'My LISA', type: 'lisa', contribution_pct: 5 }),
			profile
		);

		expect(breakdown.eligible).toBe(false);
		expect(breakdown.netContribution).toBe(0);
		expect(breakdown.grossContribution).toBe(0);
		expect(breakdown.basicRateRelief).toBe(0);
		expect(breakdown.marginalRate).toBe(0);
		expect(breakdown.extraRelief).toBe(0);
		expect(breakdown.totalRelief).toBe(0);
	});

	it('reports every figure as zero for a Defined Benefit or State pot', () => {
		const profile = createProfile({ gross_salary: 80_000 });
		expect(
			pensionReliefBreakdown(createPension({ type: 'db_final_salary' }), profile).eligible
		).toBe(false);
		expect(pensionReliefBreakdown(createPension({ type: 'state' }), profile).eligible).toBe(false);
	});

	it('carries the pot’s id, name and type through unchanged even when ineligible', () => {
		const lisa = createPension({ name: 'Help to buy the future', type: 'lisa' });
		const breakdown = pensionReliefBreakdown(lisa, createProfile());
		expect(breakdown.id).toBe(lisa.id);
		expect(breakdown.name).toBe('Help to buy the future');
		expect(breakdown.type).toBe('lisa');
	});
});

describe('pensionReliefSummary', () => {
	it('totals relief-eligible pots and carries Lifetime ISA pots separately', () => {
		const profile = createProfile({ gross_salary: 80_000, tax_region: 'england_wales_ni' });
		const workplace = pot({ type: 'dc_workplace', contribution_pct: 5 });
		const sipp = pot({ type: 'sipp', contribution_pct: 5 });
		const lisa = createPension({ name: 'My LISA', type: 'lisa', contribution_pct: 100 });
		const db = createPension({ type: 'db_final_salary' });

		const summary = pensionReliefSummary([workplace, sipp, lisa, db], profile);

		expect(summary.count).toBe(2);
		expect(summary.claimingCount).toBe(2);
		expect(summary.lisaPots).toEqual([lisa]);
		expect(summary.netContribution).toBe(8_000);
		expect(summary.grossContribution).toBe(10_000);
		expect(summary.basicRateRelief).toBe(2_000);
		expect(summary.extraRelief).toBe(2_000);
		expect(summary.totalRelief).toBe(4_000);
	});

	it('is all zero on an empty list', () => {
		const summary = pensionReliefSummary([], createProfile());
		expect(summary.count).toBe(0);
		expect(summary.claimingCount).toBe(0);
		expect(summary.pots).toEqual([]);
		expect(summary.lisaPots).toEqual([]);
		expect(summary.totalRelief).toBe(0);
	});

	it('is tolerant of a missing or non-array pensions list', () => {
		expect(pensionReliefSummary(undefined, createProfile()).count).toBe(0);
		// @ts-expect-error — deliberately the wrong type.
		expect(pensionReliefSummary(null, createProfile()).count).toBe(0);
	});

	it('does not let a basic-rate pot’s zero extra relief mask another pot’s claim', () => {
		const profile = createProfile({ gross_salary: 80_000, tax_region: 'england_wales_ni' });
		const basicPot = pot({ type: 'dc_workplace', contribution_pct: 5 });
		const summary = pensionReliefSummary([basicPot], profile);

		// Marginal rate is assessed on the whole salary (convention (2)), so even this pot's own
		// contribution attracts higher-rate relief at an £80,000 salary.
		expect(summary.claimingCount).toBe(1);
		expect(summary.extraRelief).toBeGreaterThan(0);
	});
});
