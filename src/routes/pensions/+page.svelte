<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import DefinedBenefitIncome from '../../components/DefinedBenefitIncome.svelte';
	import PensionTracker from '../../components/PensionTracker.svelte';
	import RetirementIncomeStreams from '../../components/RetirementIncomeStreams.svelte';
	import {
		appData,
		createProfile,
		getPersistenceMode,
		hydrateAppData,
		syncState
	} from '$lib/index.js';

	// `pensions` maps onto `AppData.pensions` directly, so the store (#5) owns it — hydrated from it
	// on mount below, and — once `ready` — every local change is written back into the store, whose
	// own debounced sync then persists it to the Gist (or the localStorage fallback). `ready` guards
	// against the pre-hydrate `[]` this starts as overwriting whatever was actually stored, the same
	// pattern the dashboard's `+page.svelte` uses for `monthlyEntries`/`activityLog`.
	/** @type {import('$lib/types.js').Pension[]} */
	let pensions = $state([]);
	let ready = $state(false);

	// Read-only, for the income stream builder (#33): the ISA half of a retirement income comes off
	// the latest monthly snapshot, the GIA half off the dividend planner, and the tax region and
	// target income off the profile. This tab never writes any of the three back, so they are held
	// apart from `pensions` above rather than being pushed through the same `$effect`.
	/** @type {import('$lib/types.js').MonthlyEntry[]} */
	let monthlyEntries = $state([]);
	/** @type {import('$lib/types.js').Dividend[]} */
	let dividends = $state([]);
	/** @type {import('$lib/types.js').Profile} */
	let profile = $state(createProfile());

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		pensions = data.pensions;
		monthlyEntries = data.monthly_entries;
		dividends = data.dividends;
		profile = data.profile;
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
	pots, the income your Defined Benefit schemes will pay, and every retirement income stream —
	Defined Benefit, annuity, SIPP drawdown, ISA withdrawals, GIA dividends and the State Pension —
	added up in one place. The full State Pension projection from your NI record (#31) and the tax
	relief display (#32) land in later builds.
</p>
<p class="text-sm text-muted-foreground">
	{getPersistenceMode() === 'gist' ? 'Synced to your GitHub Gist' : 'Saved to this browser only'}.
	{#if $syncState.syncing}Saving…{/if}
	{#if $syncState.error}<span class="text-red-600">Sync error: {$syncState.error}</span>{/if}
</p>

<!-- Wider than the 2xl the tracker alone needed: the income stream table below carries five columns. -->
<div class="mt-6 max-w-3xl flex flex-col gap-6">
	{#if ready}
		<PensionTracker bind:pensions />
		<DefinedBenefitIncome {pensions} />
		<RetirementIncomeStreams {pensions} {monthlyEntries} {dividends} {profile} />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
