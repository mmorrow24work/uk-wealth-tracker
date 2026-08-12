<script>
	import { onMount } from 'svelte';

	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { githubConnection, refreshGitHubConnection } from '$lib/github-auth.js';
	import { NAV_GROUPS, NAV_TABS, isActiveTab } from '$lib/nav.js';
	import { COMMIT_SHA, COMMIT_DATE, CODENAME, formatCommitDate } from '$lib/version.js';
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

	// Issue #243: grouped left sidebar, built from #242's `NAV_GROUPS`/`NavTab.group` rather than
	// NAV_TABS' own display order, since a group's tabs aren't contiguous in that list. `settings`
	// carries `group: null` and is rendered separately, pinned outside the three named sections.
	const groupedTabs = NAV_GROUPS.map((group) => ({
		group,
		tabs: NAV_TABS.filter((tab) => tab.group === group)
	}));
	const settingsTab = /** @type {import('$lib/nav.js').NavTab} */ (
		NAV_TABS.find((tab) => tab.id === 'settings')
	);
	const settingsActive = $derived(isActiveTab(page.url.pathname, settingsTab.href));

	// Below `md:` the fixed sidebar has nowhere to go, so it collapses into a toggle-open drawer
	// that pushes the content down rather than overlaying it — simplest thing that can't overlap
	// content on a phone-width screen. Local page state: "is the drawer open" has no meaning
	// outside this one render, unlike theme/connection which are shared stores.
	let sidebarOpen = $state(false);

	// Issue #269: same date-formatting convention as ActivityLog.svelte/GitHubSignIn.svelte. The
	// empty/unparseable-COMMIT_DATE fallback (local dev without git, a shallow clone) lives in
	// `formatCommitDate` itself so it's unit-tested (version.test.js) rather than only reachable
	// through this component.
	const formattedCommitDate = $derived(formatCommitDate(COMMIT_DATE));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex flex-col min-h-screen">
	<header class="no-print flex items-center gap-3 px-4 py-3 border-b border-border flex-wrap">
		<button
			type="button"
			class="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-border text-sm hover:bg-accent hover:text-accent-foreground"
			onclick={() => (sidebarOpen = !sidebarOpen)}
			aria-expanded={sidebarOpen}
			aria-controls="sidebar-nav"
			title={sidebarOpen ? 'Close menu' : 'Open menu'}
		>
			<span aria-hidden="true">☰</span>
			<span class="sr-only">{sidebarOpen ? 'Close menu' : 'Open menu'}</span>
		</button>
		<span class="font-semibold text-foreground">uk-wealth-tracker</span>
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

	<div class="flex flex-1 flex-col md:flex-row">
		<nav
			id="sidebar-nav"
			aria-label="Main"
			class="{sidebarOpen
				? 'flex'
				: 'hidden'} md:flex flex-col gap-6 border-b border-border px-4 py-4 md:sticky md:top-0 md:max-h-screen md:w-56 md:shrink-0 md:self-start md:overflow-y-auto md:border-b-0 md:border-r md:py-6"
		>
			{#each groupedTabs as { group, tabs } (group)}
				<div>
					<h2 class="px-3 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{group}
					</h2>
					<ul class="flex flex-col gap-1 list-none m-0 p-0">
						{#each tabs as tab (tab.id)}
							{@const active = isActiveTab(page.url.pathname, tab.href)}
							<li>
								<a
									href={resolve(tab.href)}
									class:active
									aria-current={active ? 'page' : undefined}
									onclick={() => (sidebarOpen = false)}
									class="block px-3 py-1.5 rounded text-foreground no-underline text-sm hover:bg-accent hover:text-accent-foreground {active
										? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
										: ''}"
								>
									{tab.label}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}

			<div class="md:mt-auto border-t border-border pt-3">
				<ul class="flex flex-col gap-1 list-none m-0 p-0">
					<li>
						<a
							href={resolve(settingsTab.href)}
							class:active={settingsActive}
							aria-current={settingsActive ? 'page' : undefined}
							onclick={() => (sidebarOpen = false)}
							class="block px-3 py-1.5 rounded text-foreground no-underline text-sm hover:bg-accent hover:text-accent-foreground {settingsActive
								? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
								: ''}"
						>
							{settingsTab.label}
						</a>
					</li>
				</ul>
			</div>
		</nav>

		<main class="flex-1 min-w-0 px-4 py-6">
			{@render children()}
		</main>
	</div>

	<footer
		class="no-print px-4 py-3 border-t border-border text-xs text-muted-foreground flex items-center gap-2 flex-wrap"
	>
		<a
			href={resolve('/self-host')}
			aria-current={isActiveTab(page.url.pathname, '/self-host') ? 'page' : undefined}
			class="hover:text-foreground hover:underline"
			title="Fork this app and host your own copy"
		>
			🍴 Fork &amp; host your own copy
		</a>
		<span aria-hidden="true">·</span>
		<span>BETA</span>
		<span aria-hidden="true">·</span>
		<span>"{CODENAME}"</span>
		{#if COMMIT_SHA}
			<span aria-hidden="true">·</span>
			<a
				href="https://github.com/mmorrow24work/uk-wealth-tracker/commit/{COMMIT_SHA}"
				target="_blank"
				rel="noopener noreferrer"
				class="hover:text-foreground hover:underline"
				title="View this build's commit on GitHub"
			>
				{COMMIT_SHA}
			</a>
		{/if}
		{#if formattedCommitDate}
			<span aria-hidden="true">·</span>
			<span title="When this build's commit was made">updated {formattedCommitDate}</span>
		{/if}
	</footer>
</div>
