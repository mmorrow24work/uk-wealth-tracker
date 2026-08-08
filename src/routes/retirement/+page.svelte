<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import FireCalculator from '../../components/FireCalculator.svelte';
	import MonteCarloSimulator from '../../components/MonteCarloSimulator.svelte';
	import { appData, createProfile, hydrateAppData } from '$lib/index.js';

	// Read-only against the store (#5): the FIRE tab projects the recorded history and seeds its
	// sliders from the profile, but writes nothing back — its assumptions are this page session's,
	// the same convention the forecast tab's sliders follow. `profile.retirement_target`,
	// `growth_rate`, `inflation_rate` and `retirement_age` are the fields it reads.
	// `MonteCarloSimulator` (#132) is read-only against the store too — `pensions` is only fetched
	// here for it, since `FireCalculator` above has no use for pension pots.
	/** @type {import('$lib/types.js').MonthlyEntry[]} */
	let monthlyEntries = $state([]);
	/** @type {import('$lib/types.js').Pension[]} */
	let pensions = $state([]);
	/** @type {import('$lib/types.js').Profile} */
	let profile = $state(createProfile());
	let ready = $state(false);

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		monthlyEntries = data.monthly_entries;
		pensions = data.pensions;
		profile = data.profile;
		ready = true;
	});
</script>

<h1>🏖️ Retirement</h1>
<p>
	Your magic number, your Coast FIRE number, and how long the pot lasts once you start spending it —
	live as you drag the target income, monthly saving, growth and withdrawal-rate sliders below.
	Everything is in today's money, so the pot you see and the income you asked for are in the same
	pounds. Below that, a Monte Carlo simulation of the same plan against 5,000 different orders good
	and bad years could arrive in, since no market actually delivers the same return every year.
</p>

<div class="mt-6 flex max-w-3xl flex-col gap-6">
	{#if ready}
		<FireCalculator {monthlyEntries} {profile} />
		<MonteCarloSimulator {profile} {pensions} {monthlyEntries} />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
