<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import BudgetTracker from '../../components/BudgetTracker.svelte';
	import HouseholdCashFlow from '../../components/HouseholdCashFlow.svelte';
	import {
		appData,
		createProfile,
		getPersistenceMode,
		hydrateAppData,
		syncState
	} from '$lib/index.js';

	// `budget` maps onto `AppData.budget` directly, so the store (#5) owns it — hydrated from it on
	// mount below, and — once `ready` — every local change is written back into the store, whose own
	// debounced sync then persists it to the Gist (or the localStorage fallback). `ready` guards
	// against the pre-hydrate default this starts as overwriting whatever was actually stored, the
	// same pattern every other tab's `+page.svelte` uses.
	/** @type {import('$lib/types.js').Budget} */
	let budget = $state({ categories: [], bills: [], line_items: [] });
	// `HouseholdCashFlow` is read-only over both of these — profile/partner are owned by Settings
	// (and #170's still-unbuilt partner entry form), never written back from this tab.
	/** @type {import('$lib/types.js').Profile} */
	let profile = $state(createProfile());
	/** @type {import('$lib/types.js').Partner | null} */
	let partner = $state(null);
	let ready = $state(false);

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		budget = data.budget;
		profile = data.profile;
		partner = data.partner;
		ready = true;
	});

	$effect(() => {
		if (!ready) return;
		appData.update((data) => ({ ...data, budget }));
	});
</script>

<h1>📅 Budget</h1>
<p>
	Monthly spend categories with optional ONS UK household average benchmarks, recurring bills and
	one-off line items, and — combining this budget with your (and your partner's, if recorded)
	take-home income — a household cash flow figure. Manual entry only; there is no bank feed.
</p>
<p class="text-sm text-muted-foreground">
	{getPersistenceMode() === 'gist' ? 'Synced to your GitHub Gist' : 'Saved to this browser only'}.
	{#if $syncState.syncing}Saving…{/if}
	{#if $syncState.error}<span class="text-red-600">Sync error: {$syncState.error}</span>{/if}
</p>

<div class="mt-6 max-w-2xl flex flex-col gap-6">
	{#if ready}
		<HouseholdCashFlow {profile} {partner} {budget} />
		<BudgetTracker bind:budget />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
