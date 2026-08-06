/**
 * Net worth calculations for the net worth dashboard.
 *
 * @module
 */

/**
 * Calculate the net worth (total investments minus debts) for a monthly entry.
 *
 * @param {Partial<import('./types.js').MonthlyEntry> | null | undefined} entry - A monthly entry with investments and debts
 * @returns {number} The net worth in pounds
 */
export function calculateNetWorth(entry) {
	if (!entry) return 0;

	const investmentTotal = (entry.investments ?? []).reduce((sum, inv) => sum + (inv.value ?? 0), 0);
	const debtTotal = (entry.debts ?? []).reduce((sum, debt) => sum + (debt.balance ?? 0), 0);

	return investmentTotal - debtTotal;
}

/**
 * Transform monthly entries into a chart-friendly data series.
 * Each data point includes the date (as a sortable composite) and the net worth.
 *
 * @param {import('./types.js').MonthlyEntry[] | null | undefined} entries - Ordered oldest first
 * @returns {Array<{month: number, year: number, date: Date, netWorth: number}>}
 */
export function transformNetWorthData(entries) {
	return (entries ?? []).map((entry) => ({
		month: entry.month,
		year: entry.year,
		date: new Date(entry.year, entry.month - 1, 1),
		netWorth: calculateNetWorth(entry)
	}));
}
