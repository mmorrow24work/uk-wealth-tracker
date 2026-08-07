<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import FireCalculator from '../../components/FireCalculator.svelte';
	import { appData, createProfile, hydrateAppData } from '$lib/index.js';

	// Read-only against the store (#5): the FIRE tab projects the recorded history and seeds its
	// sliders from the profile, but writes nothing back — its assumptions are this page session's,
	// the same convention the forecast tab's sliders follow. `profile.retirement_target`,
	// `growth_rate`, `inflation_rate` and `retirement_age` are the fields it reads.
	/** @type {import('$lib/types.js').MonthlyEntry[]} */
	let monthlyEntries = $state([]);
	/** @type {import('$lib/types.js').Profile} */
	let profile = $state(createProfile());
	let ready = $state(false);

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		monthlyEntries = data.monthly_entries;
		profile = data.profile;
		ready = true;
	});
</script>

<h1>Retirement</h1>
<p>
	Your magic number, your Coast FIRE number, and how long the pot lasts once you start spending it —
	live as you drag the target income, monthly saving, growth and withdrawal-rate sliders below.
	Everything is in today's money, so the pot you see and the income you asked for are in the same
	pounds.
</p>

<div class="mt-6 flex max-w-3xl flex-col gap-6">
	{#if ready}
		<FireCalculator {monthlyEntries} {profile} />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
