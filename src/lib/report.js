/**
 * Printable report — README.md → Phase 2 "PDF Reports": "Printable summaries: net worth,
 * investments, tax, pensions" "Useful for adviser meetings or mortgage applications" (issue #147).
 *
 * Net worth, investments, tax and all four pension figures are covered: the DC pot count/value and
 * guaranteed Defined Benefit income (#195), plus the State Pension projection and pension tax relief
 * (#221) in the same `pensions` section. In this app's data model "net worth" and "investments" are
 * the same underlying collection — a holding *is* an investment (`MonthlyEntry.investments`,
 * README.md → "Investment types") — so one function, {@link reportNetWorth}, covers both: the net
 * worth totals a mortgage adviser wants and the per-type investment breakdown that backs them.
 *
 * Two conventions decide what the numbers mean:
 *
 * 1. **Nothing here is re-derived.** The latest position comes from `forecast.js`'s own
 *    {@link import('./forecast.js').positionFromEntries} (the same anchor the Forecast tab
 *    projects from), and every total goes through `debt.js`'s
 *    {@link import('./debt.js').sumInvestmentValues}/{@link import('./debt.js').sumDebtBalances} —
 *    the same functions the Net Worth dashboard's D/I ratio already uses, honouring
 *    `exclude_from_net_worth` the same way. Likewise {@link reportTax} hands `profile.gross_salary`
 *    and `profile.tax_region` straight to `tax.js`'s own
 *    {@link import('./tax.js').takeHomeBreakdown} rather than re-summing bands here, and
 *    {@link reportPensions} hands the recorded pensions straight to `retirement-income.js`'s own
 *    {@link import('./retirement-income.js').definedContributionPots}/
 *    {@link import('./retirement-income.js').definedContributionPot}, `defined-benefit.js`'s own
 *    {@link import('./defined-benefit.js').definedBenefitTotals}, `state-pension.js`'s own
 *    {@link import('./state-pension.js').statePensionOutlook} (the same projection
 *    `StatePensionProjection.svelte` reads from) and `pension-relief.js`'s own
 *    {@link import('./pension-relief.js').pensionReliefSummary}. A printed report and its source
 *    tab can never disagree about a figure, because they share the arithmetic, not just the inputs.
 * 2. **"Nothing recorded yet" is not "zero."** `reportNetWorth([])` (no monthly entries at all)
 *    returns `hasData: false`; a household whose latest snapshot genuinely nets to £0 (or whose
 *    only holdings are all `exclude_from_net_worth`) returns `hasData: true` with `netWorth: 0`.
 *    `reportTax` follows the same rule for `profile.gross_salary`: the data model has no separate
 *    "salary recorded" flag, so, exactly like `TaxCalculator.svelte`'s own salary field falling
 *    back to a placeholder figure when `profile.gross_salary` is its default zero, a salary of `0`
 *    reads as "not recorded" rather than as a real income of nothing — nobody's take-home pay is
 *    genuinely zero. `reportPensions` follows the same rule again, one level up: `hasData` reflects
 *    whether *any* pension has been recorded at all, not whether any individual figure is non-zero —
 *    a household with pensions recorded but no Defined Benefit scheme, no NI qualifying years or no
 *    salary recorded still reads `hasData: true` with those particular figures at `0`, because that
 *    zero is a real fact about their pensions rather than a sign there is nothing to report. The
 *    report page uses `hasData` to print "nothing recorded yet" rather than a report that confidently
 *    states £0.
 *
 * Everything here is pure: `AppData`/`MonthlyEntry[]`/`Profile`/`Pension[]` in, plain report objects
 * out, nothing mutated, no `Date.now()`, no bare `new Date()` — "as of" is the latest recorded
 * month, not today (the report page prints today's date itself, for when the report was generated,
 * next to this). `statePensionOutlook` is the one figure here that is dated against "now" (State
 * Pension age is worked out from a birth date), so `buildReport`/`reportPensions` accept an explicit
 * `options.now`, the same "presentation supplies the clock" shape `StatePensionProjection.svelte` and
 * `retirement-income.js`'s `retirementIncomeSummary` already use — the report page passes the `Date`
 * it stamps "Generated on" with, so both dates on the printed page agree.
 */

import { definedBenefitTotals } from './defined-benefit.js';
import { sumDebtBalances, sumInvestmentValues } from './debt.js';
import { INVESTMENT_TYPES, INVESTMENT_TYPE_LABELS } from './enums.js';
import { positionFromEntries } from './forecast.js';
import { pensionReliefSummary } from './pension-relief.js';
import { definedContributionPot, definedContributionPots } from './retirement-income.js';
import { statePensionOutlook } from './state-pension.js';
import { takeHomeBreakdown } from './tax.js';

/*
 * As in `debt.js`/`forecast.js`: types are referenced inline as `import('./types.js').X` rather
 * than re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *`
 * and svelte-check reads two same-named top-level typedefs as an ambiguous export.
 */

/**
 * One investment type's slice of the latest snapshot — the row a printed "Investments" table
 * groups by. Only holdings counted towards net worth are grouped (convention 1 above), so a
 * group's `total` always matches what {@link sumInvestmentValues} would report for the same
 * holdings, and every group's `total` sums back to {@link NetWorthReport.investmentTotal}.
 *
 * @typedef {object} ReportHoldingGroup
 * @property {import('./enums.js').InvestmentType} type
 * @property {string} label
 * @property {number} total
 * @property {import('./types.js').Investment[]} holdings
 */

/**
 * @typedef {object} NetWorthReport
 * @property {boolean} hasData Whether any monthly snapshot has ever been recorded — `false` means
 *   there is nothing to report, not that the household is worth nothing (convention 2 above).
 * @property {{ month: number, year: number } | null} asOf The latest recorded snapshot this report
 *   is built from, `null` when `hasData` is `false`.
 * @property {import('./types.js').Investment[]} holdings Every holding in the latest snapshot,
 *   including any flagged `exclude_from_net_worth` — a report should show what exists even where a
 *   total doesn't count it, same as the Net Worth tab's own holdings list does.
 * @property {import('./types.js').Debt[]} debts Every debt in the latest snapshot, same rule.
 * @property {number} investmentTotal Sum of holding values counted towards net worth.
 * @property {number} debtTotal Sum of debt balances counted towards net worth.
 * @property {number} netWorth `investmentTotal - debtTotal`.
 * @property {ReportHoldingGroup[]} holdingsByType Counted holdings only, grouped by
 *   {@link import('./enums.js').InvestmentType}, in `INVESTMENT_TYPES` order, empty groups omitted.
 */

/**
 * Not `Object.freeze`d on its array properties (only the object itself): `NetWorthReport.holdings`
 * etc are typed as plain mutable arrays, matching every other array `$lib` hands back to a caller
 * (a caller is free to sort/filter a *copy*, same as any other module here), and a frozen empty
 * array is a `readonly never[]` to svelte-check — a type `NetWorthReport` itself doesn't declare.
 *
 * @type {NetWorthReport}
 */
const EMPTY_NET_WORTH_REPORT = Object.freeze({
	hasData: false,
	asOf: null,
	holdings: [],
	debts: [],
	investmentTotal: 0,
	debtTotal: 0,
	netWorth: 0,
	holdingsByType: []
});

/**
 * The net worth & investments section of the printable report — README.md's first two of "net
 * worth, investments, tax, pensions".
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} monthlyEntries Any order, as
 *   {@link import('./forecast.js').positionFromEntries} accepts.
 * @returns {NetWorthReport}
 */
export function reportNetWorth(monthlyEntries) {
	const position = positionFromEntries(monthlyEntries);
	if (!position) return EMPTY_NET_WORTH_REPORT;

	const { investments, debts } = position;
	const counted = investments.filter((investment) => !investment.exclude_from_net_worth);

	const holdingsByType = INVESTMENT_TYPES.map((type) => {
		const holdings = counted.filter((investment) => investment.type === type);
		return holdings.length === 0
			? null
			: {
					type,
					label: INVESTMENT_TYPE_LABELS[type],
					total: sumInvestmentValues(holdings),
					holdings
				};
	}).filter((group) => group !== null);

	const investmentTotal = sumInvestmentValues(investments);
	const debtTotal = sumDebtBalances(debts);

	return {
		hasData: true,
		asOf: position.start,
		holdings: investments,
		debts,
		investmentTotal,
		debtTotal,
		netWorth: investmentTotal - debtTotal,
		holdingsByType
	};
}

/**
 * @typedef {object} TaxReport
 * @property {boolean} hasData Whether a salary has been recorded on the profile — see convention 2
 *   above. `false` means there is nothing to report, not that the household's take-home pay is £0.
 * @property {import('./tax.js').TakeHomeBreakdown | null} breakdown `null` when `hasData` is
 *   `false`.
 */

/** @type {TaxReport} */
const EMPTY_TAX_REPORT = Object.freeze({ hasData: false, breakdown: null });

/**
 * The tax section of the printable report — README.md's third of "net worth, investments, tax,
 * pensions".
 *
 * @param {import('./types.js').Profile} profile
 * @returns {TaxReport}
 */
export function reportTax(profile) {
	if (!(profile.gross_salary > 0)) return EMPTY_TAX_REPORT;

	return {
		hasData: true,
		breakdown: takeHomeBreakdown({ income: profile.gross_salary, region: profile.tax_region })
	};
}

/**
 * @typedef {object} PensionsReport
 * @property {boolean} hasData Whether any pension has been recorded at all — see convention 2 above.
 *   `false` means there is nothing to report, not that the figures below total zero.
 * @property {Partial<import('./types.js').Pension>[]} dcPots Every Defined Contribution pot (DC
 *   workplace pension, SIPP) as recorded — `retirement-income.js`'s own
 *   {@link import('./retirement-income.js').definedContributionPots}.
 * @property {number} dcPotCount `dcPots.length`.
 * @property {number} dcPotTotal What those pots are worth between them (£) —
 *   {@link import('./retirement-income.js').definedContributionPot}.
 * @property {import('./defined-benefit.js').DefinedBenefitTotals} definedBenefit The guaranteed
 *   Defined Benefit income across every scheme recorded, at `fire.js`'s default withdrawal rate —
 *   same figure `DefinedBenefitIncome.svelte`'s own "Guaranteed income" starts from before a reader
 *   moves its rate slider. `annualIncome` is `0`, not missing, for a household with DC pensions
 *   recorded but no Defined Benefit scheme.
 * @property {import('./state-pension.js').StatePensionOutlook} statePension The State Pension
 *   projected from the household's `type: 'state'` record (if any) and `profile`'s date of birth —
 *   `state-pension.js`'s own {@link import('./state-pension.js').statePensionOutlook}, dated against
 *   whatever clock `reportPensions`/`buildReport` were called with. `projection.annualIncome` and
 *   `projection.totalYears` are `0` for a household with no NI qualifying years recorded, same as
 *   `StatePensionProjection.svelte` shows before anything is entered.
 * @property {import('./pension-relief.js').PensionReliefSummary} pensionRelief Tax relief on
 *   relief-eligible pots (DC workplace, SIPP) — `pension-relief.js`'s own
 *   {@link import('./pension-relief.js').pensionReliefSummary}. `totalRelief` is `0` for a household
 *   with no `profile.gross_salary` recorded or no relief-eligible pots, same reasoning as
 *   `definedBenefit` above.
 */

/**
 * The pensions section of the printable report — README.md's fourth of "net worth, investments,
 * tax, pensions". Four figures: the DC pot count/value, the guaranteed Defined Benefit income, the
 * State Pension projection and pension tax relief.
 *
 * @param {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @param {import('./types.js').Profile | null} [profile] Needed for the State Pension (date of
 *   birth/NI record) and pension tax relief (salary, marginal rate) — unlike `dcPots`/`definedBenefit`
 *   these two figures can't be worked out from `pensions` alone.
 * @param {object} [options]
 * @param {Date} [options.now] The clock `statePensionOutlook` dates State Pension age against —
 *   see this module's own doc comment on why `reportPensions` takes one rather than calling
 *   `new Date()` itself.
 * @returns {PensionsReport}
 */
export function reportPensions(pensions = [], profile = null, options = {}) {
	const list = Array.isArray(pensions) ? pensions : [];
	const statePension = statePensionOutlook(list, profile, { now: options.now });
	const pensionRelief = pensionReliefSummary(list, profile);

	if (list.length === 0) {
		return {
			hasData: false,
			dcPots: [],
			dcPotCount: 0,
			dcPotTotal: 0,
			definedBenefit: definedBenefitTotals([]),
			statePension,
			pensionRelief
		};
	}

	const dcPots = definedContributionPots(list);

	return {
		hasData: true,
		dcPots,
		dcPotCount: dcPots.length,
		dcPotTotal: definedContributionPot(list),
		definedBenefit: definedBenefitTotals(list),
		statePension,
		pensionRelief
	};
}

/**
 * @typedef {object} Report
 * @property {NetWorthReport} netWorth
 * @property {TaxReport} tax
 * @property {PensionsReport} pensions
 */

/**
 * The report page's single entry point — one call, one object with every section the page renders.
 *
 * @param {import('./types.js').AppData} appData
 * @param {object} [options]
 * @param {Date} [options.now] Threaded down to {@link reportPensions}'s State Pension projection —
 *   the report page supplies the same `Date` it stamps "Generated on" with.
 * @returns {Report}
 */
export function buildReport(appData, options = {}) {
	return {
		netWorth: reportNetWorth(appData.monthly_entries),
		tax: reportTax(appData.profile),
		pensions: reportPensions(appData.pensions, appData.profile, options)
	};
}
