<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import AutoInvestFill from '../components/AutoInvestFill.svelte';
	import DebtTracker from '../components/DebtTracker.svelte';
	import InvestmentHoldings from '../components/InvestmentHoldings.svelte';
	import {
		appData,
		compareMonthlyEntries,
		getPersistenceMode,
		hydrateAppData,
		syncState
	} from '$lib/index.js';

	// `activityLog` and `monthlyEntries` map onto `AppData.activity_log`/`.monthly_entries` directly,
	// so the store (#5) owns them: hydrated from it on mount below, and — once `ready` — every local
	// change is written back into the store, whose own debounced sync then persists it to the Gist
	// (or the localStorage fallback). `ready` guards against the pre-hydrate `[]` these start as
	// overwriting whatever was actually stored.
	/** @type {import('$lib/types.js').ActivityLogEntry[]} */
	let activityLog = $state([]);
	/** @type {import('$lib/types.js').MonthlyEntry[]} */
	let monthlyEntries = $state([]);
	let ready = $state(false);

	// `debts` has no top-level home in `AppData` — the schema only nests it per month inside
	// `monthly_entries` (see `$lib/types.js`) — so, unlike `monthlyEntries` above, it stays
	// session-only local state until #68 (debt entry, kept separate from this issue's investment
	// holdings form) gives it a real per-month shape to write into the store.
	/** @type {import('$lib/types.js').Debt[]} */
	let debts = $state([]);

	// The D/I ratio (`DebtTracker`) compares debts against the *latest recorded* month's holdings —
	// `InvestmentHoldings` (issue #8) writes those straight into `monthlyEntries` above, so this is
	// derived rather than its own state.
	/** @type {import('$lib/types.js').Investment[]} */
	const investments = $derived(
		[...monthlyEntries].sort(compareMonthlyEntries).at(-1)?.investments ?? []
	);

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		activityLog = data.activity_log;
		monthlyEntries = data.monthly_entries;
		ready = true;
	});

	$effect(() => {
		if (!ready) return;
		appData.update((data) => ({ ...data, activity_log: activityLog }));
	});

	$effect(() => {
		if (!ready) return;
		appData.update((data) => ({ ...data, monthly_entries: monthlyEntries }));
	});
</script>

<h1>Net Worth</h1>
<p>Personal UK net worth, tax and retirement planning app. Not financial advice.</p>
<p>
	The full net worth dashboard — tracked/forecast chart — lands in a later build. Monthly snapshot
	entry for investment holdings, debt tracking, the debt-to-investment ratio, the auto-invest fill
	for skipped months and the activity log are below.
</p>
<p class="text-sm text-muted-foreground">
	{getPersistenceMode() === 'gist' ? 'Synced to your GitHub Gist' : 'Saved to this browser only'}.
	{#if $syncState.syncing}Saving…{/if}
	{#if $syncState.error}<span class="text-red-600">Sync error: {$syncState.error}</span>{/if}
</p>

<div class="mt-6 flex max-w-2xl flex-col gap-6">
	<InvestmentHoldings bind:monthlyEntries bind:activityLog />
	<DebtTracker {investments} bind:debts bind:activityLog />
	<AutoInvestFill bind:monthlyEntries growthRate={5} />
</div>
