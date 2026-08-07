<script>
	import { onMount } from 'svelte';

	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { githubConnection, refreshGitHubConnection } from '$lib/github-auth.js';
	import { NAV_TABS, isActiveTab } from '$lib/nav.js';
	import '../app.css';

	let { children } = $props();

	// Issue #62 asks for the connected GitHub account to be obvious, not buried on one screen — so the
	// shell carries it on every tab. `githubConnection` starts signed-out because storage cannot be
	// read while prerendering; this is the one read that turns it into the truth for this browser.
	onMount(refreshGitHubConnection);

	const connectionLabel = $derived.by(() => {
		const { signedIn, account, source } = $githubConnection;
		if (signedIn) return account ? `@${account.login}` : 'GitHub connected';
		if (source === 'build') return 'GitHub: build token';
		return 'Connect GitHub';
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex flex-col min-h-screen">
	<header class="flex items-center gap-6 px-4 py-3 border-b border-gray-200 flex-wrap">
		<span class="font-semibold">uk-wealth-tracker</span>
		<nav aria-label="Main">
			<ul class="flex flex-wrap gap-1 list-none m-0 p-0">
				{#each NAV_TABS as tab (tab.id)}
					{@const active = isActiveTab(page.url.pathname, tab.href)}
					<li>
						<a
							href={resolve(tab.href)}
							class:active
							aria-current={active ? 'page' : undefined}
							class="inline-block px-3 py-1.5 rounded text-gray-900 no-underline text-sm hover:bg-gray-100 {active
								? 'bg-black text-white'
								: ''}"
						>
							{tab.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
		<a
			href={resolve('/connect')}
			aria-current={isActiveTab(page.url.pathname, '/connect') ? 'page' : undefined}
			class="ml-auto inline-block px-3 py-1.5 rounded text-sm no-underline border border-gray-200 text-gray-900 hover:bg-gray-100"
			title="GitHub sign-in for Gist sync — where your data is stored"
		>
			{connectionLabel}
		</a>
	</header>

	<main class="flex-1 px-4 py-6">
		{@render children()}
	</main>
</div>
