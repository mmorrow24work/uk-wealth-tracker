<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import IsaAllowanceTracker from '../../components/IsaAllowanceTracker.svelte';
	import TaxCalculator from '../../components/TaxCalculator.svelte';
	import { appData, createProfile, hydrateAppData, positionFromEntries } from '$lib/index.js';

	// Read-only against the store (#5), same as the retirement tab: the calculator seeds its salary
	// and region from `profile.gross_salary`/`profile.tax_region` and writes nothing back, so what is
	// typed here is this page session's only. The panel waits for hydration rather than rendering
	// first, because `$state` initialisers run once — seeding from the default profile and re-seeding
	// afterwards would silently ignore a stored salary.
	/** @type {import('$lib/types.js').Profile} */
	let profile = $state(createProfile());
	// `IsaAllowanceTracker` (#28) seeds its per-wrapper contribution fields from the latest recorded
	// snapshot's holdings, the same "latest snapshot" read `ForecastProjections` uses — read-only
	// here too, since the tracker only annualises a pace, it never edits a holding.
	/** @type {import('$lib/types.js').MonthlyEntry[]} */
	let monthlyEntries = $state([]);
	let ready = $state(false);

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		profile = data.profile;
		monthlyEntries = data.monthly_entries;
		ready = true;
	});

	const latestInvestments = $derived(positionFromEntries(monthlyEntries)?.investments ?? []);
</script>

<h1>🧾 Tax</h1>
<p>
	Where each pound of your salary is taxed, for the 2026/27 tax year — the England, Wales &amp;
	Northern Ireland ladder and Scotland's six bands, with the personal allowance and its 60% taper
	between £100,000 and £125,140, what salary sacrifice is worth against that taper, and the High
	Income Child Benefit Charge that claws Child Benefit back between £60,000 and £80,000. Below that,
	the ISA allowance tracker covers all six wrappers against the £20,000 adult and £9,000 Junior ISA
	limits.
</p>

<div class="mt-6 flex max-w-3xl flex-col gap-6">
	{#if ready}
		<TaxCalculator {profile} />
		<IsaAllowanceTracker investments={latestInvestments} />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
