<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import DefinedBenefitIncome from '../../components/DefinedBenefitIncome.svelte';
	import PensionTaxRelief from '../../components/PensionTaxRelief.svelte';
	import PensionTracker from '../../components/PensionTracker.svelte';
	import RetirementIncomeStreams from '../../components/RetirementIncomeStreams.svelte';
	import StatePensionProjection from '../../components/StatePensionProjection.svelte';
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
	// `RetirementIncomeStreams` (#33) is the one card here that reaches outside `pensions[]`: ISA
	// withdrawals come from the latest monthly snapshot's holdings and the GIA dividend stream from
	// the dividend planner. Both are read-only and never written back — this tab owns `pensions` and
	// nothing else, so the dashboard and the Dividends tab stay the only places those two are edited.
	/** @type {import('$lib/types.js').MonthlyEntry[]} */
	let monthlyEntries = $state([]);
	/** @type {import('$lib/types.js').Dividend[]} */
	let dividends = $state([]);
	// `PensionTaxRelief` (#32) needs `profile.gross_salary`/`profile.tax_region` to work out a pot's
	// relief, and `StatePensionProjection` (#31) needs `profile.dob_month`/`dob_year` to date State
	// Pension age — the same read-only, not-written-back seeding the tax tab gives `TaxCalculator`.
	/** @type {import('$lib/types.js').Profile} */
	let profile = $state(createProfile());
	let ready = $state(false);

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
	pots, the income your Defined Benefit schemes will pay, the tax relief each pot's own contribution
	attracts, what your National Insurance record projects to as a State Pension, and — at the bottom
	— every one of those streams added together into a single retirement income, after tax and against
	your target.
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
		<StatePensionProjection bind:pensions {profile} />
		<PensionTaxRelief {pensions} {profile} />
		<RetirementIncomeStreams {pensions} {monthlyEntries} {dividends} {profile} />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
