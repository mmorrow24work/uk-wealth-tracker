/**
 * Debt-to-investment (D/I) ratio — README.md → "Net Worth Tracking": "Debt tracking with D/I
 * ratio (debt-to-investment %; <14% healthy, >18% concern)".
 *
 * The ratio compares total outstanding debt against total investment value for one monthly
 * snapshot. Both totals respect each record's `exclude_from_net_worth` flag by default — the
 * same flag the mortgage toggle (README.md → "Mortgage debt toggle") sets on a mortgage once its
 * property equity is already tracked on the property tab. Without that toggle, a mortgaged
 * homeowner's debt would swamp the ratio and the <14%/>18% bands would never mean anything; with
 * it, the ratio reflects the same "what counts" set the net worth total already uses, rather than
 * this module inventing a second, competing notion of which debts are "real" leverage.
 */

/*
 * Not re-declared as local `@typedef {import('./types.js').Debt} Debt` (unlike most `$lib`
 * modules) because `index.js` re-exports every module with `export *`, and svelte-check treats
 * two same-named top-level typedefs across re-exported modules as an ambiguous export even though
 * only `model.js`'s is meant to be the public one — same reasoning as `gist.js`'s `AppDataDoc`.
 * Referenced inline below as `import('./types.js').Debt` / `import('./types.js').Investment`.
 */

/**
 * @param {readonly import('./types.js').Debt[]} debts
 * @param {{ includeExcluded?: boolean }} [options]
 * @returns {number} Total outstanding balance (£), summed over debts not excluded from net worth
 *   unless `includeExcluded` is set.
 */
export function sumDebtBalances(debts, { includeExcluded = false } = {}) {
	return debts
		.filter((debt) => includeExcluded || !debt.exclude_from_net_worth)
		.reduce((total, debt) => total + debt.balance, 0);
}

/**
 * @param {readonly import('./types.js').Investment[]} investments
 * @param {{ includeExcluded?: boolean }} [options]
 * @returns {number} Total value (£), summed over holdings not excluded from net worth unless
 *   `includeExcluded` is set.
 */
export function sumInvestmentValues(investments, { includeExcluded = false } = {}) {
	return investments
		.filter((investment) => includeExcluded || !investment.exclude_from_net_worth)
		.reduce((total, investment) => total + investment.value, 0);
}

/**
 * Debt as a percentage of investments. `null` when there is nothing to divide by — zero tracked
 * investment value makes the ratio mathematically undefined (and, per README.md's bands, not
 * classifiable as healthy or a concern either way) rather than `Infinity` or `0`.
 *
 * @param {readonly import('./types.js').Investment[]} investments
 * @param {readonly import('./types.js').Debt[]} debts
 * @returns {number | null}
 */
export function debtToInvestmentRatio(investments, debts) {
	const investmentTotal = sumInvestmentValues(investments);
	if (investmentTotal <= 0) return null;
	return (sumDebtBalances(debts) / investmentTotal) * 100;
}

/**
 * README.md's own thresholds, verbatim: below `healthy` is healthy, above `concern` is a
 * concern. Between the two (inclusive of both boundary values) is neither — "moderate" is this
 * module's label, not README.md's, since the spec names only the two outer bands.
 */
export const DEBT_TO_INVESTMENT_THRESHOLDS = Object.freeze({ healthy: 14, concern: 18 });

/** @typedef {'healthy' | 'moderate' | 'concern' | 'unknown'} DebtToInvestmentStatus */

/** @type {Record<DebtToInvestmentStatus, string>} */
export const DEBT_TO_INVESTMENT_STATUS_LABELS = Object.freeze({
	healthy: 'Healthy',
	moderate: 'Moderate',
	concern: 'Concern',
	unknown: 'Not enough data'
});

/**
 * @param {number | null} ratioPct Result of {@link debtToInvestmentRatio}.
 * @returns {DebtToInvestmentStatus}
 */
export function debtToInvestmentStatus(ratioPct) {
	if (ratioPct === null || !Number.isFinite(ratioPct)) return 'unknown';
	if (ratioPct < DEBT_TO_INVESTMENT_THRESHOLDS.healthy) return 'healthy';
	if (ratioPct > DEBT_TO_INVESTMENT_THRESHOLDS.concern) return 'concern';
	return 'moderate';
}
