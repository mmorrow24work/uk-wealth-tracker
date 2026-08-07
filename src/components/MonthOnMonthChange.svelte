<script>
	import { calculateNetWorth, calculateMonthlyChange, findPreviousMonth } from '$lib/index.js';
	import Card from './ui/card.svelte';

	let { monthlyEntries } = $props();

	const change = $derived.by(() => {
		if (monthlyEntries.length === 0) {
			return { change_pounds: null, change_percent: null, currentNetWorth: null };
		}

		const sorted = [...monthlyEntries].sort((a, b) => {
			const keyA = `${a.year}-${String(a.month).padStart(2, '0')}`;
			const keyB = `${b.year}-${String(b.month).padStart(2, '0')}`;
			return keyA.localeCompare(keyB);
		});

		const current = sorted[sorted.length - 1];
		const previous = findPreviousMonth(sorted, current);
		const currentNetWorth = calculateNetWorth(current);
		const monthlyChange = calculateMonthlyChange(previous, current);

		return {
			change_pounds: monthlyChange.change_pounds,
			change_percent: monthlyChange.change_percent,
			currentNetWorth
		};
	});

	/**
	 * @param {number | null | undefined} value
	 */
	function formatCurrency(value) {
		if (value === null || value === undefined) return 'N/A';
		return new Intl.NumberFormat('en-GB', {
			style: 'currency',
			currency: 'GBP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(value);
	}

	/**
	 * @param {number | null | undefined} value
	 */
	function formatPercent(value) {
		if (value === null || value === undefined) return 'N/A';
		const sign = value >= 0 ? '+' : '';
		return sign + value.toFixed(2) + '%';
	}

	/**
	 * @param {number | null | undefined} value
	 */
	function getChangeStyle(value) {
		if (value === null || value === undefined) return '';
		if (value > 0) return 'color: rgb(22, 163, 74);';
		if (value < 0) return 'color: rgb(220, 38, 38);';
		return 'color: rgb(75, 85, 99);';
	}
</script>

<Card>
	<div class="space-y-4">
		<div>
			<h3 class="text-sm font-medium text-muted-foreground">Net Worth</h3>
			<p class="text-2xl font-bold">
				{formatCurrency(change.currentNetWorth)}
			</p>
		</div>

		<div class="grid grid-cols-2 gap-4">
			<div>
				<p class="text-xs text-muted-foreground">Month-on-month change (£)</p>
				<p class="text-lg font-semibold" style={getChangeStyle(change.change_pounds)}>
					{formatCurrency(change.change_pounds)}
				</p>
			</div>
			<div>
				<p class="text-xs text-muted-foreground">Month-on-month change (%)</p>
				<p class="text-lg font-semibold" style={getChangeStyle(change.change_percent)}>
					{formatPercent(change.change_percent)}
				</p>
			</div>
		</div>
	</div>
</Card>
