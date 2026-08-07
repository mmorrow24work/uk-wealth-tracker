/**
 * Net worth calculation and month-on-month change tracking.
 *
 * Net worth is the sum of all investment values minus all debt balances for a given
 * month, respecting each record's `exclude_from_net_worth` flag. This module also
 * computes the change between two months in both absolute (£) and percentage terms.
 */

import { sumDebtBalances, sumInvestmentValues } from './debt.js';

/**
 * Calculate the net worth for a single monthly entry.
 *
 * @param {import('./types.js').MonthlyEntry} entry
 * @param {{ includeExcluded?: boolean }} [options]
 * @returns {number} Net worth in pounds (investments - debts)
 */
export function calculateNetWorth(entry, { includeExcluded = false } = {}) {
	const investments = sumInvestmentValues(entry.investments, { includeExcluded });
	const debts = sumDebtBalances(entry.debts, { includeExcluded });
	return investments - debts;
}

/**
 * Calculate month-on-month net worth change.
 *
 * @param {import('./types.js').MonthlyEntry | null} previousEntry The previous month's entry, or null if none
 * @param {import('./types.js').MonthlyEntry} currentEntry The current month's entry
 * @returns {{ change_pounds: number | null, change_percent: number | null }} Change in £ and %, or null if previous unavailable
 */
export function calculateMonthlyChange(previousEntry, currentEntry) {
	if (!previousEntry) {
		return { change_pounds: null, change_percent: null };
	}

	const previousNetWorth = calculateNetWorth(previousEntry);
	const currentNetWorth = calculateNetWorth(currentEntry);
	const change_pounds = currentNetWorth - previousNetWorth;

	let change_percent = null;
	if (previousNetWorth !== 0) {
		change_percent = (change_pounds / previousNetWorth) * 100;
	} else if (change_pounds !== 0) {
		// If previous net worth is zero but current is not, the change is technically
		// infinite; report null instead of Infinity
		change_percent = null;
	}

	return { change_pounds, change_percent };
}

/**
 * Find the previous month's entry relative to a given month.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries All monthly entries, sorted
 * @param {import('./types.js').MonthlyEntry} target The entry to find the previous month for
 * @returns {import('./types.js').MonthlyEntry | null}
 */
export function findPreviousMonth(entries, target) {
	const sortedEntries = [...entries].sort((a, b) => {
		const keyA = `${a.year}-${String(a.month).padStart(2, '0')}`;
		const keyB = `${b.year}-${String(b.month).padStart(2, '0')}`;
		return keyA.localeCompare(keyB);
	});

	const targetKey = `${target.year}-${String(target.month).padStart(2, '0')}`;
	let previousEntry = null;

	for (const entry of sortedEntries) {
		const key = `${entry.year}-${String(entry.month).padStart(2, '0')}`;
		if (key >= targetKey) {
			break;
		}
		previousEntry = entry;
	}

	return previousEntry;
}
