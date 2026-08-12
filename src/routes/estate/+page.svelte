<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import {
		appData,
		createIhtSettings,
		getPersistenceMode,
		hydrateAppData,
		syncState
	} from '$lib/index.js';
	import EstateSummary from '../../components/EstateSummary.svelte';
	import BeneficiaryBreakdown from '../../components/BeneficiaryBreakdown.svelte';
	import LifeInsuranceTracker from '../../components/LifeInsuranceTracker.svelte';

	// Read-only against the store (#5) for the valuation lists, same hydrate-then-render pattern as
	// every other tab. `beneficiaries` (#167), `iht_settings` (#199) and `life_insurance` (#253) are
	// this tab's writes — hydrated and written back below, behind the same `ready` flag, the same
	// pattern every sibling route's own list uses (`routes/assets/+page.svelte`'s own `assets`).
	// `ready` guards against the pre-hydrate `[]`/`undefined` below overwriting what was actually
	// stored.
	/** @type {import('$lib/types.js').MonthlyEntry[]} */
	let monthlyEntries = $state([]);
	/** @type {import('$lib/types.js').Property[]} */
	let properties = $state([]);
	/** @type {import('$lib/types.js').Asset[]} */
	let assets = $state([]);
	/** @type {import('$lib/types.js').Pension[]} */
	let pensions = $state([]);
	/** @type {import('$lib/lifetime-gifts.js').Gift[]} */
	let gifts = $state([]);
	// Never actually rendered pre-hydrate (`EstateSummary` only mounts once `ready`), but typed as a
	// real `IhtSettings` rather than `| undefined` so the write-back below matches `AppData`'s own
	// non-nullable field — the same reason `beneficiaries` above starts at `[]` rather than `undefined`.
	/** @type {import('$lib/types.js').IhtSettings} */
	let ihtSettings = $state(createIhtSettings());
	/** @type {import('$lib/types.js').Beneficiary[]} */
	let beneficiaries = $state([]);
	/** @type {import('$lib/types.js').LifeInsurance[]} */
	let lifeInsurance = $state([]);
	let ready = $state(false);

	// `EstateSummary`'s own $bindable seam (#191's groundwork for #202): the net estate left after
	// Inheritance Tax, off the one estateSnapshot() call that component already makes. Threaded
	// straight down to BeneficiaryBreakdown below rather than run a second estateSnapshot() here.
	let netAfterTax = $state(0);

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		monthlyEntries = data.monthly_entries;
		properties = data.properties;
		assets = data.assets;
		pensions = data.pensions;
		gifts = data.gifts;
		ihtSettings = data.iht_settings;
		beneficiaries = data.beneficiaries;
		lifeInsurance = data.life_insurance;
		ready = true;
	});

	$effect(() => {
		if (!ready) return;
		appData.update((data) => ({
			...data,
			beneficiaries,
			iht_settings: ihtSettings,
			life_insurance: lifeInsurance
		}));
	});

	// What the empty state below checks for, and what #189's summary card will value an estate from.
	// `lifeInsurance` joined the list with #254, which is what made a recorded policy something the
	// valuation actually counts — a document holding only policies has an estate worth showing, so
	// "nothing to value yet" would be untrue (and, since the tracker itself lives behind this gate,
	// would leave a user who deleted everything else unable to reach their own policies again).
	const hasEstateData = $derived(
		monthlyEntries.length > 0 ||
			properties.length > 0 ||
			assets.length > 0 ||
			lifeInsurance.length > 0
	);
</script>

<h1>🏛️ Estate</h1>
<p>
	Your estate, valued from what's already recorded on the Net Worth, Property and Assets tabs, plus
	any life insurance recorded below — no re-entry. The Inheritance Tax bill, nil-rate bands and
	spouse transferable allowances land on top of that valuation, then who gets what per beneficiary.
</p>
<p class="text-sm text-muted-foreground">
	{getPersistenceMode() === 'gist' ? 'Synced to your GitHub Gist' : 'Saved to this browser only'}.
	{#if $syncState.syncing}Saving…{/if}
	{#if $syncState.error}<span class="text-red-600">Sync error: {$syncState.error}</span>{/if}
</p>

<div class="mt-6 max-w-2xl flex flex-col gap-6">
	{#if !ready}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{:else if !hasEstateData}
		<p class="text-sm text-muted-foreground">
			Nothing to value yet — add a monthly snapshot on the Net Worth tab, or a property or asset on
			the Property or Assets tabs, and your estate will be built from those automatically.
		</p>
	{:else}
		<EstateSummary
			{monthlyEntries}
			{properties}
			{assets}
			{pensions}
			{lifeInsurance}
			{gifts}
			bind:ihtSettings
			bind:netAfterTax
		/>
		<BeneficiaryBreakdown bind:beneficiaries {netAfterTax} />
		<LifeInsuranceTracker bind:policies={lifeInsurance} />
	{/if}
</div>
