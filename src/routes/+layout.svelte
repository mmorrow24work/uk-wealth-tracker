<script>
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { NAV_TABS, isActiveTab } from '$lib/nav.js';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-shell">
	<header class="app-header">
		<span class="app-title">uk-wealth-tracker</span>
		<nav aria-label="Main">
			<ul class="tabs">
				{#each NAV_TABS as tab (tab.id)}
					{@const active = isActiveTab(page.url.pathname, tab.href)}
					<li>
						<a href={resolve(tab.href)} class:active aria-current={active ? 'page' : undefined}>
							{tab.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	</header>

	<main class="app-main">
		{@render children()}
	</main>
</div>

<style>
	.app-shell {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	.app-header {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #ddd;
		flex-wrap: wrap;
	}

	.app-title {
		font-weight: 600;
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.tabs a {
		display: inline-block;
		padding: 0.4rem 0.75rem;
		border-radius: 0.375rem;
		color: inherit;
		text-decoration: none;
		font-size: 0.9rem;
	}

	.tabs a:hover {
		background: #f0f0f0;
	}

	.tabs a.active {
		background: #1a1a1a;
		color: #fff;
	}

	.app-main {
		flex: 1;
		padding: 1.5rem 1rem;
	}
</style>
