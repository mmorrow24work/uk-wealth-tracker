/**
 * Net worth calculations and analytics.
 *
 * Computes aggregates and month-on-month change (£ and %) between consecutive snapshots.
 * Re-exports {@link sumInvestmentValues} and {@link sumDebtBalances} from `./debt.js`.
 */

import { sumInvestmentValues, sumDebtBalances } from './debt.js';

// Re-export debt aggregation functions from this module so tests can import them alongside
// calculateNetWorth and calculateMonthOnMonthChange.
export { sumInvestmentValues, sumDebtBalances };

/**
 * Calculate net worth for a monthly snapshot: total investment value minus total debt.
 *
 * @param {Pick<import('./types.js').MonthlyEntry, 'investments' | 'debts'>} entry
 * @returns {number} Net worth in pounds.
 */
export function calculateNetWorth(entry) {
	return sumInvestmentValues(entry.investments) - sumDebtBalances(entry.debts);
}

/**
 * Month-on-month net worth change: absolute (£) and percentage.
 *
 * Returns `null` if there is no previous entry or previous net worth is zero
 * (percentage is undefined in that case).
 *
 * @typedef {object} MonthOnMonthChange
 * @property {number} currentNetWorth Net worth at the current snapshot (£).
 * @property {number} previousNetWorth Net worth at the prior snapshot (£).
 * @property {number} changeInPounds Absolute change (£). Positive = growth, negative = decline.
 * @property {number | null} changePercent Percentage change (%). `null` if previousNetWorth is 0.
 */

/**
 * Calculate month-on-month change between two consecutive monthly entries.
 *
 * @param {Pick<import('./types.js').MonthlyEntry, 'investments' | 'debts'>} currentEntry
 * @param {Pick<import('./types.js').MonthlyEntry, 'investments' | 'debts'>} [previousEntry]
 * @returns {MonthOnMonthChange | null} null if previousEntry is missing.
 */
export function calculateMonthOnMonthChange(currentEntry, previousEntry) {
	if (!previousEntry) return null;

	const currentNetWorth = calculateNetWorth(currentEntry);
	const previousNetWorth = calculateNetWorth(previousEntry);
	const changeInPounds = currentNetWorth - previousNetWorth;

	let changePercent = null;
	if (previousNetWorth !== 0) {
		changePercent = (changeInPounds / Math.abs(previousNetWorth)) * 100;
	}

	return {
		currentNetWorth,
		previousNetWorth,
		changeInPounds,
		changePercent
	};
}

/**
 * Format a month-on-month change for display: "£+1,234.56 (+5.2%)" or "£-500 (no change)".
 *
 * @param {MonthOnMonthChange | null} change
 * @param {object} [options]
 * @param {number} [options.decimalPlaces=2] Decimal places for percentage.
 * @param {string} [options.currencySymbol='£'] Currency prefix.
 * @returns {string | null} null if change is null.
 */
export function formatMonthOnMonthChange(change, options = {}) {
	if (!change) return null;

	const { decimalPlaces = 2, currencySymbol = '£' } = options;
	const amount = change.changeInPounds.toLocaleString('en-GB', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2
	});

	if (change.changePercent === null) {
		const amountSign = change.changeInPounds >= 0 ? '+' : '';
		return `${currencySymbol}${amountSign}${amount} (no previous data)`;
	}

	const percent = change.changePercent.toFixed(decimalPlaces);
	const amountSign = change.changeInPounds >= 0 ? '+' : '';
	const percentSign = change.changePercent >= 0 ? '+' : '';
	return `${currencySymbol}${amountSign}${amount} (${percentSign}${percent}%)`;
}
