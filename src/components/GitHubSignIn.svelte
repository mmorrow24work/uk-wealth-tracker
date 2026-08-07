<script>
	/**
	 * GitHub sign-in for Gist persistence mode (issue #62) — the whole in-app replacement for
	 * hand-editing `VITE_GITHUB_TOKEN` into `.env.local` and redeploying.
	 *
	 * Three things live here, in the order someone needs them:
	 *
	 * 1. **Who is connected** — the account (`$lib/github-auth.js`) and the Gist
	 *    (`$lib/gist.js`'s `describeGistTarget`), always both, because "signed in as @me" says
	 *    nothing about *which* Gist the data is going into and the issue asks for both.
	 * 2. **Signing in** — paste a token with the `gist` scope; it is verified against the GitHub API
	 *    before anything is stored, so a typo fails here rather than silently on the next save.
	 * 3. **Choosing the Gist** — paste an existing Gist (id or URL) to sync into, or leave it and let
	 *    the first save create a private one.
	 *
	 * Reads its state from the `githubConnection` store rather than props so the nav shell's
	 * indicator and this page never disagree; `describeGistTarget()` is re-read into local state
	 * after every change instead, since the Gist pointer is plain `localStorage` with no store
	 * behind it and only this component ever changes it.
	 *
	 * The token itself is never rendered back: the input is `type="password"`, `autocomplete="off"`,
	 * and it is cleared the instant sign-in succeeds — after that the component holds no secret at
	 * all, only the account record.
	 *
	 * Signing in, signing out and re-pointing at a different Gist all re-hydrate the store
	 * (`$lib/store.js`), because each of them changes *which document is the live one*. Without that,
	 * the in-memory document would still be the previous backend's, and the next keystroke anywhere
	 * in the app would debounce-save it into the new one.
	 */
	import { onMount } from 'svelte';

	import {
		clearActiveGistId,
		connectGitHubAccount,
		describeGistTarget,
		disconnectGitHubAccount,
		setActiveGistId
	} from '$lib/gist.js';
	import {
		GIST_SCOPE,
		getBuildToken,
		githubConnection,
		refreshGitHubConnection,
		verifyGitHubToken
	} from '$lib/github-auth.js';
	import { getPersistenceMode, setPersistenceMode } from '$lib/persistence.js';
	import { hydrateAppData } from '$lib/store.js';
	import Button from './ui/button.svelte';
	import Card from './ui/card.svelte';

	let target = $state(describeGistTarget());
	let mode = $state(getPersistenceMode());

	const account = $derived($githubConnection.account);

	let token = $state('');
	let gistInput = $state('');

	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let gistError = $state('');

	/** Whose the build's compiled-in token is — unknown until someone asks GitHub. */
	let buildAccount = $state(/** @type {string | null} */ (null));
	let buildError = $state('');

	const dateFormatter = new Intl.DateTimeFormat('en-GB', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	/** @param {string} iso */
	function formatConnectedAt(iso) {
		const at = new Date(iso);
		return Number.isNaN(at.getTime()) ? '' : dateFormatter.format(at);
	}

	/** @param {unknown} cause */
	function messageOf(cause) {
		return cause instanceof Error ? cause.message : String(cause);
	}

	/** Everything that has to be re-read after any change to who/where we are connected. */
	function refreshAll() {
		refreshGitHubConnection();
		target = describeGistTarget();
		mode = getPersistenceMode();
	}

	onMount(refreshAll);

	async function connect() {
		error = '';
		notice = '';
		busy = true;
		try {
			const account = await connectGitHubAccount(token);
			// The secret has been stored by the module that owns it; nothing here needs it any more.
			token = '';
			// Signing in *is* the opt-in to Gist sync, per README.md → Persistence modes.
			setPersistenceMode('gist');
			refreshAll();
			await hydrateAppData();
			notice = `Connected as @${account.login}. This browser now syncs to your GitHub Gist.`;
		} catch (cause) {
			error = messageOf(cause);
		} finally {
			busy = false;
		}
	}

	async function disconnect() {
		error = '';
		notice = '';
		busy = true;
		try {
			disconnectGitHubAccount();
			refreshAll();
			// Gist mode is no longer available, so the app has already fallen back to browser-only
			// storage — reload the document that mode actually holds.
			await hydrateAppData();
			notice = 'Signed out. This browser is back on browser-only storage.';
		} finally {
			busy = false;
		}
	}

	async function useGist() {
		gistError = '';
		notice = '';
		busy = true;
		try {
			const id = setActiveGistId(gistInput);
			gistInput = '';
			refreshAll();
			await hydrateAppData();
			notice = `Now syncing with Gist ${id}.`;
		} catch (cause) {
			gistError = messageOf(cause);
		} finally {
			busy = false;
		}
	}

	async function forgetGist() {
		gistError = '';
		notice = '';
		busy = true;
		try {
			clearActiveGistId();
			refreshAll();
			await hydrateAppData();
			notice = 'Forgotten. Your next save starts a new private Gist — the old one is untouched.';
		} finally {
			busy = false;
		}
	}

	async function checkBuildToken() {
		buildError = '';
		busy = true;
		try {
			const account = await verifyGitHubToken(getBuildToken());
			buildAccount = account.login;
		} catch (cause) {
			buildError = messageOf(cause);
		} finally {
			busy = false;
		}
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">GitHub connection</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Gist sync keeps your data in one private Gist on your own GitHub account, so you can open this
		app on another device and pick up where you left off. Browser-only storage — the default — needs
		none of this.
	</p>

	<div class="border border-border rounded-md p-3 mb-4">
		{#if $githubConnection.signedIn && account}
			<p class="text-sm">
				<span class="font-medium">Signed in as @{account.login}</span>
				{#if account.name}<span class="text-muted-foreground"> ({account.name})</span>{/if}
			</p>
			<p class="text-xs text-muted-foreground mt-1">
				{#if account.connected_at}Connected {formatConnectedAt(account.connected_at)}.{/if}
				{#if account.scopes_known}
					Token scopes: {account.scopes.join(', ') || 'none'}.
				{:else}
					GitHub reported no scopes for this token — normal for a fine-grained token, which uses
					per-repository permissions instead.
				{/if}
			</p>
		{:else if $githubConnection.source === 'build'}
			<p class="text-sm font-medium">Using a token compiled into this build</p>
			<p class="text-xs text-muted-foreground mt-1">
				This deployment carries a <code>VITE_GITHUB_TOKEN</code>, so Gist sync already works — but
				anyone who can read the deployed JavaScript can read that token. Signing in below replaces
				it for this browser with one that never leaves your device.
			</p>
			{#if buildAccount}
				<p class="text-xs text-muted-foreground mt-1">That token belongs to @{buildAccount}.</p>
			{:else}
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="mt-2"
					disabled={busy}
					onclick={checkBuildToken}
				>
					Check whose token it is
				</Button>
			{/if}
			{#if buildError}<p class="text-xs text-red-600 mt-1">{buildError}</p>{/if}
		{:else}
			<p class="text-sm font-medium">Not signed in</p>
			<p class="text-xs text-muted-foreground mt-1">
				Your data is saved in this browser only. Sign in below to sync it to a private Gist as well.
			</p>
		{/if}

		<p class="text-xs text-muted-foreground mt-2">
			Storage mode right now:
			<span class="font-medium"
				>{mode === 'gist' ? 'Synced to your GitHub Gist' : 'Saved to this browser only'}</span
			>.
		</p>

		<p class="text-xs text-muted-foreground mt-1">
			{#if target.id}
				Data Gist:
				<a
					class="underline"
					href="https://gist.github.com/{target.id}"
					target="_blank"
					rel="noreferrer noopener">{target.id}</a
				>{target.source === 'build' ? ' (set by this build)' : ''}.
			{:else}
				No Gist chosen yet — the first save creates a private one for you.
			{/if}
		</p>
	</div>

	{#if notice}<p class="text-sm text-green-700 mb-3">{notice}</p>{/if}

	{#if $githubConnection.signedIn}
		<div class="flex flex-wrap items-center gap-2 mb-4">
			<Button type="button" variant="outline" size="sm" disabled={busy} onclick={disconnect}>
				Sign out
			</Button>
			<span class="text-xs text-muted-foreground">
				Forgets the token in this browser and goes back to browser-only storage. Nothing is deleted
				— not the Gist, not this browser's copy — and the token stays valid until you revoke it at
				<a
					class="underline"
					href="https://github.com/settings/tokens"
					target="_blank"
					rel="noreferrer noopener">github.com/settings/tokens</a
				>.
			</span>
		</div>
	{:else}
		<form
			class="flex flex-col gap-2 mb-4"
			onsubmit={(event) => {
				event.preventDefault();
				void connect();
			}}
		>
			<label class="text-sm font-medium" for="github-token">
				GitHub personal access token (<code>{GIST_SCOPE}</code> scope)
			</label>
			<div class="flex flex-wrap items-center gap-2">
				<input
					id="github-token"
					type="password"
					autocomplete="off"
					spellcheck="false"
					placeholder="ghp_…"
					bind:value={token}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-72"
				/>
				<Button type="submit" size="sm" disabled={busy || token.trim() === ''}>
					{busy ? 'Checking…' : 'Connect GitHub'}
				</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				<a
					class="underline"
					href="https://github.com/settings/tokens/new?scopes=gist&description=uk-wealth-tracker"
					target="_blank"
					rel="noreferrer noopener"
				>
					Create one on GitHub
				</a>
				— the <code>{GIST_SCOPE}</code> scope is enough, and it reaches nothing else in your account.
				The token is checked with GitHub before it is stored.
			</p>
		</form>
	{/if}

	{#if error}<p class="text-sm text-red-600 mb-4">{error}</p>{/if}

	<h3 class="text-sm font-semibold mb-1">Which Gist</h3>
	<p class="text-xs text-muted-foreground mb-2">
		Leave this alone and the app creates a private Gist on your first save. Paste an existing one
		(its id, or the whole URL) to carry on with data you already have — that is how a second device
		joins the same Gist.
	</p>
	<div class="flex flex-wrap items-center gap-2 mb-1">
		<input
			id="gist-id"
			type="text"
			spellcheck="false"
			placeholder="https://gist.github.com/you/…"
			aria-label="Gist id or URL"
			bind:value={gistInput}
			class="border border-input rounded-md px-2 py-1.5 text-sm w-72"
		/>
		<Button type="button" size="sm" disabled={busy || gistInput.trim() === ''} onclick={useGist}>
			Use this Gist
		</Button>
		{#if target.source === 'browser'}
			<Button type="button" variant="outline" size="sm" disabled={busy} onclick={forgetGist}>
				Forget this Gist
			</Button>
		{/if}
	</div>
	{#if gistError}<p class="text-sm text-red-600 mb-1">{gistError}</p>{/if}

	<p class="text-xs text-muted-foreground mt-4">
		Your token is kept in this browser's own storage and sent to nowhere but
		<code>api.github.com</code>. It is never written to the console, never included in an error
		message, and never stored in the Gist itself. A "secret" Gist is unlisted rather than
		access-controlled, so treat its id as private too — see README.md → Persistence modes.
	</p>
</Card>
