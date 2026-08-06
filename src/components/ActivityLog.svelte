<script>
	/**
	 * Activity log display — README.md → "Net Worth Tracking": "Activity log with revert support
	 * for deleted entries" (issue #14). Purely presentational: renders `entries` (newest first,
	 * as `$lib/activity-log.js`'s `logEntity*` helpers produce them) and calls `onRevert` with a
	 * log entry's id when its "Revert" button is clicked. It does not mutate `entries` itself or
	 * decide what reverting means for the underlying record — the owner (e.g. `DebtTracker.svelte`)
	 * calls `revertEntityRemoval` and restores the entity into its own list.
	 */
	import { describeActivityLogEntry, isRevertible } from '$lib/activity-log.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/**
	 * @type {{
	 * 	entries?: import('$lib/types.js').ActivityLogEntry[],
	 * 	onRevert?: (logEntryId: string) => void
	 * }}
	 */
	let { entries = [], onRevert = () => {} } = $props();

	const timeFormatter = new Intl.DateTimeFormat('en-GB', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	/** @param {string} timestamp */
	function formatTimestamp(timestamp) {
		const date = new Date(timestamp);
		return Number.isNaN(date.getTime()) ? timestamp : timeFormatter.format(date);
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-3">Activity log</h2>

	{#if entries.length === 0}
		<p class="text-sm text-muted-foreground">No changes recorded yet.</p>
	{:else}
		<ul class="flex flex-col gap-2 list-none p-0 m-0">
			{#each entries as entry (entry.id)}
				<li
					class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
				>
					<div class="flex flex-col">
						<span class="text-sm">
							{describeActivityLogEntry(entry)}
							{#if entry.action === 'removed' && entry.reverted}
								<span class="text-muted-foreground">— restored</span>
							{/if}
						</span>
						<span class="text-xs text-muted-foreground">{formatTimestamp(entry.timestamp)}</span>
					</div>
					{#if isRevertible(entry)}
						<Button variant="outline" size="sm" type="button" onclick={() => onRevert(entry.id)}>
							Revert
						</Button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Card>
