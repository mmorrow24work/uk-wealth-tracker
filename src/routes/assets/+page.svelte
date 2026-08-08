<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import AssetsTracker from '../../components/AssetsTracker.svelte';
	import { appData, getPersistenceMode, hydrateAppData, syncState } from '$lib/index.js';

	// `assets` maps onto `AppData.assets` directly, so the store (#5) owns it — hydrated from it on
	// mount below, and — once `ready` — every local change is written back into the store, whose own
	// debounced sync then persists it to the Gist (or the localStorage fallback). `ready` guards
	// against the pre-hydrate `[]` this starts as overwriting whatever was actually stored, the same
	// pattern `routes/property/+page.svelte` uses for its own list.
	/** @type {import('$lib/types.js').Asset[]} */
	let assets = $state([]);
	let ready = $state(false);

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		assets = data.assets;
		ready = true;
	});

	$effect(() => {
		if (!ready) return;
		appData.update((data) => ({ ...data, assets }));
	});
</script>

<h1>💎 Assets</h1>
<p>
	Physical asset tracking — watches & jewellery, art & collectables, classic/collector cars, wine &
	whisky, precious metals and other categories, with purchase price, current value, purchase date,
	expected annual change and annual holding cost. Each asset shows its gain/loss, annualised CAGR
	and net position after holding costs, plus a toggle for whether it counts towards net worth and a
	future value projection chart.
</p>
<p class="text-sm text-muted-foreground">
	{getPersistenceMode() === 'gist' ? 'Synced to your GitHub Gist' : 'Saved to this browser only'}.
	{#if $syncState.syncing}Saving…{/if}
	{#if $syncState.error}<span class="text-red-600">Sync error: {$syncState.error}</span>{/if}
</p>

<div class="mt-6 max-w-2xl flex flex-col gap-6">
	{#if ready}
		<AssetsTracker bind:assets />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
