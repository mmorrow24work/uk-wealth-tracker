<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import AutoInvestFill from '../components/AutoInvestFill.svelte';
	import DebtTracker from '../components/DebtTracker.svelte';
	import { appData, getPersistenceMode, hydrateAppData, syncState } from '$lib/index.js';

	// Investment holding entry (README.md → "Monthly snapshot entry") is issue #8's monthly
	// snapshot form and isn't wired up yet, so the ratio has nothing to divide by until then.
	// `investments`/`debts` also have no top-level home in `AppData` — the schema only nests them
	// per month inside `monthly_entries` (see `$lib/types.js`) — so, unlike the two fields below,
	// they stay session-only local state until #8 gives them a real per-month shape to write into
	// the store.
	/** @type {import('$lib/types.js').Investment[]} */
	let investments = $state([]);
	/** @type {import('$lib/types.js').Debt[]} */
	let debts = $state([]);

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
	The full net worth dashboard — monthly snapshot entry and tracked/forecast chart — lands in a
	later build. Debt tracking, the debt-to-investment ratio, the auto-invest fill for skipped months
	and the activity log are below.
</p>
<p class="text-sm text-muted-foreground">
	{getPersistenceMode() === 'gist' ? 'Synced to your GitHub Gist' : 'Saved to this browser only'}.
	{#if $syncState.syncing}Saving…{/if}
	{#if $syncState.error}<span class="text-red-600">Sync error: {$syncState.error}</span>{/if}
</p>

<div class="mt-6 flex max-w-2xl flex-col gap-6">
	<DebtTracker {investments} bind:debts bind:activityLog />
	<AutoInvestFill bind:monthlyEntries growthRate={5} />
</div>
