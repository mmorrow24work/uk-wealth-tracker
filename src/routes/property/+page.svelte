<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import PropertyTracker from '../../components/PropertyTracker.svelte';
	import {
		appData,
		createProfile,
		getPersistenceMode,
		hydrateAppData,
		syncState
	} from '$lib/index.js';

	// `properties` maps onto `AppData.properties` directly, so the store (#5) owns it — hydrated
	// from it on mount below, and — once `ready` — every local change is written back into the
	// store, whose own debounced sync then persists it to the Gist (or the localStorage fallback).
	// `ready` guards against the pre-hydrate `[]` this starts as overwriting whatever was actually
	// stored, the same pattern the pensions/dividends tabs' `+page.svelte` use for their own lists.
	/** @type {import('$lib/types.js').Property[]} */
	let properties = $state([]);
	// Read-only, never written back — `PropertyTracker`'s "until age" control (#248) needs
	// `profile.dob_year`/`dob_month` to turn a target age into a projection horizon, the same
	// seeding the pensions tab gives `StatePensionProjection`/`PensionTaxRelief`.
	/** @type {import('$lib/types.js').Profile} */
	let profile = $state(createProfile());
	let ready = $state(false);

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		properties = data.properties;
		profile = data.profile;
		ready = true;
	});

	$effect(() => {
		if (!ready) return;
		appData.update((data) => ({ ...data, properties }));
	});
</script>

<h1>🏠 Property</h1>
<p>
	Property tracking — primary residence, buy-to-let and holiday home types with value, outstanding
	mortgage, monthly payment, interest rate, mortgage type and deal expiry date, plus each property's
	equity, buy-to-let cashflow/yield and a toggle for whether its equity counts towards net worth. A
	mortgage deal expiry reminder flags any deal within 90 days of running out (amber) or already
	expired (red), and a 30-year equity growth projection chart is available per property.
</p>
<p class="text-sm text-muted-foreground">
	{getPersistenceMode() === 'gist' ? 'Synced to your GitHub Gist' : 'Saved to this browser only'}.
	{#if $syncState.syncing}Saving…{/if}
	{#if $syncState.error}<span class="text-red-600">Sync error: {$syncState.error}</span>{/if}
</p>

<div class="mt-6 max-w-2xl flex flex-col gap-6">
	{#if ready}
		<PropertyTracker bind:properties {profile} />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
