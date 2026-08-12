<script>
	/**
	 * The GitHub connection page (issue #62).
	 *
	 * Deliberately not one of `$lib/nav.js`'s `NAV_TABS`: those are the feature tabs README.md's
	 * "Project Structure" lists, and this is a setup screen most users visit once. It is reached from
	 * the connection indicator in the nav shell's header instead, which is also what makes "who is
	 * connected" visible from every tab rather than only from here.
	 *
	 * Issue #100 adds a Settings tab (storage-mode switch, JSON export/import, data management). When
	 * it lands, this page is the obvious thing for it to absorb or link to; until then it is the only
	 * place Gist sync can be turned on without editing `.env.local` and redeploying — and, since #63,
	 * the only place data can be deleted, which is why the page is about the data as a whole rather
	 * than only about signing in.
	 */
	import DeleteAllData from '../../components/DeleteAllData.svelte';
	import GitHubSignIn from '../../components/GitHubSignIn.svelte';
</script>

<h1>Connect GitHub</h1>
<p>
	Sync this app's data to a private Gist on your own GitHub account, so the same figures are there
	on your phone as on your laptop. Optional: without it, everything stays in this browser, which
	needs no account and no setup at all. Either way, this is also where you can delete the lot.
</p>

<div class="mt-6 max-w-2xl flex flex-col gap-6">
	<GitHubSignIn />
	<DeleteAllData />
</div>
