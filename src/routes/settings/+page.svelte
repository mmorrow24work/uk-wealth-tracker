<script>
	/**
	 * Settings tab (issue #100) — storage mode switch, JSON export/import, all in
	 * `../../components/DataManager.svelte`. This page is only the hydrate-then-render wrapper every
	 * data-backed tab uses (see the tax/property tabs' `+page.svelte`): `DataManager` reads and
	 * writes `$lib/store.js`'s `appData` directly, so it needs a hydrated store to have anything real
	 * to show, same as the "delete all my data" panel on the connect page.
	 */
	import { onMount } from 'svelte';

	import DataManager from '../../components/DataManager.svelte';
	import PaletteSettings from '../../components/PaletteSettings.svelte';
	import ThemeSettings from '../../components/ThemeSettings.svelte';
	import TypographySettings from '../../components/TypographySettings.svelte';
	import { hydrateAppData } from '$lib/index.js';

	let ready = $state(false);

	onMount(async () => {
		await hydrateAppData();
		ready = true;
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
		<DataManager />
	{:else}
		<p class="text-sm text-muted-foreground">Loading your saved data…</p>
	{/if}
</div>
