<script>
	import { calculateMonthOnMonthChange, formatMonthOnMonthChange } from '$lib';

	let { entries = [] } = $props();

	let change = $derived.by(() => {
		if (!entries || !Array.isArray(entries) || entries.length < 2) {
			return null;
		}
		const current = entries[entries.length - 1];
		const previous = entries[entries.length - 2];
		return calculateMonthOnMonthChange(current, previous);
	});

	let formatted = $derived(formatMonthOnMonthChange(change));
</script>

<div class="month-on-month">
	{#if change}
		<div class="change-display">
			<div class="label">Month-on-month change</div>
			<div class="value">{formatted}</div>
		</div>
	{:else}
		<div class="placeholder">
			<div class="label">Month-on-month change</div>
			<div class="text">Not enough monthly entries to calculate change</div>
		</div>
	{/if}
</div>

<style>
	.month-on-month {
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 1rem;
		background-color: #f9fafb;
	}

	.change-display {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.placeholder {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		opacity: 0.6;
	}

	.label {
		font-weight: 500;
		color: #374151;
		font-size: 0.875rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.value {
		font-size: 1.25rem;
		font-weight: 700;
		color: #111827;
		font-variant-numeric: tabular-nums;
	}

	.text {
		font-size: 0.875rem;
		color: #6b7280;
	}
</style>
