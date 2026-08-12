<script>
	/**
	 * Settings tab (issue #100) — storage mode switch, JSON export/import, all in
	 * `../../components/DataManager.svelte`. This page is only the hydrate-then-render wrapper every
	 * data-backed tab uses (see the tax/property tabs' `+page.svelte`): `DataManager` reads and
	 * writes `$lib/store.js`'s `appData` directly, so it needs a hydrated store to have anything real
	 * to show, same as the "delete all my data" panel on the connect page.
	 *
	 * `PartnerProfile` (issue #170) follows the same `pensions`/`monthlyEntries` shape the pensions
	 * and property tabs already use: hydrated into local state on mount, then written back into the
	 * store by the `$effect` below, guarded by `ready` so the pre-hydrate `null` default never
	 * overwrites whatever was actually stored.
	 */
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import DataManager from '../../components/DataManager.svelte';
	import PaletteSettings from '../../components/PaletteSettings.svelte';
	import PartnerProfile from '../../components/PartnerProfile.svelte';
	import ThemeSettings from '../../components/ThemeSettings.svelte';
	import TypographySettings from '../../components/TypographySettings.svelte';
	import { appData, hydrateAppData } from '$lib/index.js';

	let ready = $state(false);
	/** @type {import('$lib/types.js').Partner | null} */
	let partner = $state(null);

	onMount(async () => {
		await hydrateAppData();
		partner = get(appData).partner;
		ready = true;
	});

	$effect(() => {
		if (!ready) return;
		appData.update((data) => ({ ...data, partner }));
	});
</script>

<h1>⚙️ Settings</h1>
<p>
	Where your data lives, and how to move it: switch between browser-only storage and GitHub Gist
	sync, export everything as one JSON file, or replace what's stored here by importing one back in.
</p>

<div class="mt-6 max-w-2xl flex flex-col gap-6">
	<ThemeSettings />
	<PaletteSettings />
	<TypographySettings />

	{#if ready}
		<PartnerProfile bind:partner />
		<DataManager />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
