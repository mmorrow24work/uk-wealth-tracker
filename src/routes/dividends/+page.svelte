<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import DividendIncomePlanner from '../../components/DividendIncomePlanner.svelte';
	import DividendTaxSummary from '../../components/DividendTaxSummary.svelte';
	import DividendTracker from '../../components/DividendTracker.svelte';
	import {
		appData,
		createProfile,
		getPersistenceMode,
		hydrateAppData,
		syncState
	} from '$lib/index.js';

	// `dividends` maps onto `AppData.dividends` directly, so the store (#5) owns it — hydrated from
	// it on mount below, and — once `ready` — every local change is written back into the store,
	// whose own debounced sync then persists it to the Gist (or the localStorage fallback). `ready`
	// guards against the pre-hydrate `[]` this starts as overwriting whatever was actually stored,
	// the same pattern the pensions tab's `+page.svelte` uses for `pensions`.
	/** @type {import('$lib/types.js').Dividend[]} */
	let dividends = $state([]);
	// `DividendIncomePlanner` needs `profile.dob_year`/`dob_month`/`retirement_age` to seed the age
	// slider, the same read-only, not-written-back seeding the pensions tab gives `PensionTaxRelief`.
	/** @type {import('$lib/types.js').Profile} */
	let profile = $state(createProfile());
	let ready = $state(false);

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		dividends = data.dividends;
		profile = data.profile;
		ready = true;
	});

	$effect(() => {
		if (!ready) return;
		appData.update((data) => ({ ...data, dividends }));
	});
</script>

<h1>Dividends</h1>
<p>
	The dividend income planner — per-holding value, yield and strategy, what the £500/yr dividend
	allowance and the GIA dividend rates leave you with after tax, plus a building-phase (reinvest) vs
	income-phase (age slider) projection.
</p>
<p class="text-sm text-muted-foreground">
	{getPersistenceMode() === 'gist' ? 'Synced to your GitHub Gist' : 'Saved to this browser only'}.
	{#if $syncState.syncing}Saving…{/if}
	{#if $syncState.error}<span class="text-red-600">Sync error: {$syncState.error}</span>{/if}
</p>

<div class="mt-6 max-w-2xl flex flex-col gap-6">
	{#if ready}
		<DividendTracker bind:dividends />
		<DividendTaxSummary {dividends} {profile} />
		<DividendIncomePlanner {dividends} {profile} />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
