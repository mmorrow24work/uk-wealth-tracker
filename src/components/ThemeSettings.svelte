<script>
	/**
	 * Settings tab's "Appearance" section (issue #116) — the fuller Light/Dark picker, styled the
	 * same two-button-group way `DataManager.svelte`'s storage-mode switcher is. `./ThemeToggleButton
	 * .svelte` is the nav header's compact version of the same toggle; both read/write `$lib/theme.js`'s
	 * store, so this stays in sync with it with no wiring of its own.
	 *
	 * Not gated behind Settings' `hydrateAppData()` readiness check the way `DataManager` is — the
	 * theme choice lives in `localStorage` only (see `$lib/theme.js`'s module doc for why it's kept
	 * out of the synced `AppData` document), not in the store that hydration fills in, so there is
	 * nothing here to wait for.
	 */
	import { onMount } from 'svelte';

	import { setTheme, theme, refreshTheme } from '$lib/theme.js';
	import Button from './ui/button.svelte';
	import Card from './ui/card.svelte';

	onMount(refreshTheme);

	/** @type {{ value: import('$lib/theme.js').Theme, label: string }[]} */
	const OPTIONS = [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Appearance</h2>
	<p class="text-sm text-muted-foreground mb-3">
		Theme right now: <span class="font-medium">{$theme === 'dark' ? 'Dark' : 'Light'}</span>.
		Defaults to your browser's colour scheme on first visit; choosing one here remembers it in this
		browser from then on.
	</p>
	<div class="flex flex-wrap gap-2">
		{#each OPTIONS as option (option.value)}
			<Button
				type="button"
				variant={option.value === $theme ? 'default' : 'outline'}
				size="sm"
				onclick={() => setTheme(option.value)}
			>
				{option.label}
			</Button>
		{/each}
	</div>
</Card>
