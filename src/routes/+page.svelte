<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import AutoInvestFill from '../components/AutoInvestFill.svelte';
	import DataExport from '../components/DataExport.svelte';
	import DebtTracker from '../components/DebtTracker.svelte';
	import InvestmentHoldings from '../components/InvestmentHoldings.svelte';
	import NetWorthChart from '../components/NetWorthChart.svelte';
	import { appData, getPersistenceMode, hydrateAppData, syncState } from '$lib/index.js';

	// `activityLog` and `monthlyEntries` map onto `AppData.activity_log`/`.monthly_entries` directly,
	// so the store (#5) owns them: hydrated from it on mount below, and — once `ready` — every local
	// change is written back into the store, whose own debounced sync then persists it to the Gist
	// (or the localStorage fallback). `ready` guards against the pre-hydrate `[]` these start as
	// overwriting whatever was actually stored.
	//
	// `debts` has no top-level home in `AppData` any more than `investments` does — both nest per
	// month inside `monthly_entries` (see `$lib/types.js`) — so `InvestmentHoldings` (#8) and
	// `DebtTracker` (#68) both bind straight to `monthlyEntries` below rather than either taking its
	// own top-level array prop.
	/** @type {import('$lib/types.js').ActivityLogEntry[]} */
	let activityLog = $state([]);
	/** @type {import('$lib/types.js').MonthlyEntry[]} */
	let monthlyEntries = $state([]);
	let ready = $state(false);

	// Read-only here, and read from the store rather than typed in: the net worth chart's forecast
	// overlay (#81) projects at the user's own growth assumption, which lives on `Profile`. Nothing
	// on this page writes it back — the forecast tab's sliders are where an assumption gets changed.
	let growthRate = $state(5);

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		activityLog = data.activity_log;
		monthlyEntries = data.monthly_entries;
		growthRate = data.profile.growth_rate;
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
	Your recorded net worth history is charted below, with the three forecast scenarios and their
	confidence band projected on from your latest snapshot. Hover a month to read its figures back.
	Monthly snapshot entry for investment holdings, debt tracking, the debt-to-investment ratio, the
	auto-invest fill for skipped months and the activity log are below it.
</p>
<p class="text-sm text-muted-foreground">
	{getPersistenceMode() === 'gist' ? 'Synced to your GitHub Gist' : 'Saved to this browser only'}.
	{#if $syncState.syncing}Saving…{/if}
	{#if $syncState.error}<span class="text-red-600">Sync error: {$syncState.error}</span>{/if}
</p>

<div class="mt-6 flex max-w-2xl flex-col gap-6">
	<NetWorthChart {monthlyEntries} {growthRate} />
	<InvestmentHoldings bind:monthlyEntries bind:activityLog />
	<DebtTracker bind:monthlyEntries bind:activityLog />
	<AutoInvestFill bind:monthlyEntries growthRate={5} />
	<DataExport />
</div>
