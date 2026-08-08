<script>
	import { onMount } from 'svelte';

	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { githubConnection, refreshGitHubConnection } from '$lib/github-auth.js';
	import { NAV_TABS, isActiveTab } from '$lib/nav.js';
	import ThemeToggleButton from '../components/ThemeToggleButton.svelte';
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
	<header class="flex items-center gap-6 px-4 py-3 border-b border-border flex-wrap">
		<span class="font-semibold text-foreground">uk-wealth-tracker</span>
		<nav aria-label="Main">
			<ul class="flex flex-wrap gap-1 list-none m-0 p-0">
				{#each NAV_TABS as tab (tab.id)}
					{@const active = isActiveTab(page.url.pathname, tab.href)}
					<li>
						<a
							href={resolve(tab.href)}
							class:active
							aria-current={active ? 'page' : undefined}
							class="inline-block px-3 py-1.5 rounded text-foreground no-underline text-sm hover:bg-accent hover:text-accent-foreground {active
								? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
								: ''}"
						>
							{tab.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
		<div class="ml-auto flex items-center gap-2">
			<a
				href="https://github.com/mmorrow24work/uk-wealth-tracker"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border text-sm hover:bg-accent hover:text-accent-foreground"
				title="View source code on GitHub"
			>
				<span aria-hidden="true">🔗</span>
				<span class="sr-only">GitHub repository</span>
			</a>
			<a
				href={resolve('/connect')}
				aria-current={isActiveTab(page.url.pathname, '/connect') ? 'page' : undefined}
				class="inline-block px-3 py-1.5 rounded text-sm no-underline border border-border text-foreground hover:bg-accent hover:text-accent-foreground"
				title="GitHub sign-in for Gist sync — where your data is stored"
			>
				{connectionLabel}
			</a>
			<ThemeToggleButton />
		</div>
	</header>

	<main class="flex-1 px-4 py-6">
		{@render children()}
	</main>
</div>
