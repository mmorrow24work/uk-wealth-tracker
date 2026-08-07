<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import DefinedBenefitIncome from '../../components/DefinedBenefitIncome.svelte';
	import PensionTracker from '../../components/PensionTracker.svelte';
	import { appData, getPersistenceMode, hydrateAppData, syncState } from '$lib/index.js';

	// `pensions` maps onto `AppData.pensions` directly, so the store (#5) owns it — hydrated from it
	// on mount below, and — once `ready` — every local change is written back into the store, whose
	// own debounced sync then persists it to the Gist (or the localStorage fallback). `ready` guards
	// against the pre-hydrate `[]` this starts as overwriting whatever was actually stored, the same
	// pattern the dashboard's `+page.svelte` uses for `monthlyEntries`/`activityLog`.
	/** @type {import('$lib/types.js').Pension[]} */
	let pensions = $state([]);
	let ready = $state(false);

	onMount(async () => {
		await hydrateAppData();
		pensions = get(appData).pensions;
		ready = true;
	});

	$effect(() => {
		if (!ready) return;
		appData.update((data) => ({ ...data, pensions }));
	});
</script>

<h1>Pensions</h1>
<p>
	Pension pot tracking for DC Workplace, SIPP, Defined Benefit (Final Salary/CARE) and Lifetime ISA
	pots, and the income your Defined Benefit schemes will pay. The State Pension projection (#31),
	tax relief display (#32) and the retirement income stream builder (#33) land in later builds.
</p>
<p class="text-sm text-muted-foreground">
	{getPersistenceMode() === 'gist' ? 'Synced to your GitHub Gist' : 'Saved to this browser only'}.
	{#if $syncState.syncing}Saving…{/if}
	{#if $syncState.error}<span class="text-red-600">Sync error: {$syncState.error}</span>{/if}
</p>

<div class="mt-6 max-w-2xl flex flex-col gap-6">
	{#if ready}
		<PensionTracker bind:pensions />
		<DefinedBenefitIncome {pensions} />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
