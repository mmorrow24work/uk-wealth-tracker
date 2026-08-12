<script>
	/**
	 * "Delete all my data" (issue #63) — the one irreversible action in the app, and the only
	 * component whose job is mostly to make itself hard to trigger.
	 *
	 * Two things the issue asks for, and how this answers them:
	 *
	 * 1. **Hard to misclick.** Nothing deletes on a single click. The first button only *reveals* a
	 *    confirmation panel, which names exactly what is about to go (the Gist id, the account, this
	 *    browser's copy) and requires the phrase `DELETE` typed into a field before the destructive
	 *    button stops being disabled. The panel is not a form, so Enter does not submit it, and
	 *    Cancel puts everything back with the typed phrase discarded.
	 * 2. **Scoped to the signed-in user's own Gist.** The component never sees, holds or passes a Gist
	 *    id — `$lib/store.js`'s `deleteAllAppData` takes no arguments, and the ownership proof happens
	 *    in `$lib/gist.js` where the token is. All this component can do is ask; it cannot aim.
	 *
	 * What it deletes depends on the storage mode, which is what `describeDeleteTarget()` reports and
	 * what the panel renders in full before asking:
	 *
	 * - **Gist mode** — the signed-in account's own Gist, plus this browser's copy of it.
	 * - **Browser-only mode** — this browser's copy, and nothing else. Still irreversible for this
	 *   device, so it gets the same confirmation rather than a lesser one.
	 *
	 * Not offered at all when the app is in Gist mode on a token compiled into the build: nobody has
	 * verified whose account that is, so no Gist can be proved to belong to the person clicking.
	 * `describeDeleteTarget().blocked` says so on screen instead of hiding the section.
	 *
	 * What it would delete is re-read whenever the `githubConnection` store changes, because this
	 * panel and the sign-in panel share the connect page: signing in, signing out or pointing at a
	 * different Gist happens a few centimetres above without any navigation, and a panel still
	 * offering to delete "this browser's copy" after the user has just connected a Gist would be
	 * describing the wrong deletion. That store is the one thing every such change refreshes.
	 */
	import {
		DELETE_CONFIRMATION_PHRASE,
		describeDeleteTarget,
		isDeleteConfirmed
	} from '$lib/persistence.js';
	import { githubConnection } from '$lib/github-auth.js';
	import { deleteAllAppData } from '$lib/store.js';
	import Button from './ui/button.svelte';
	import Card from './ui/card.svelte';

	let target = $state(describeDeleteTarget());

	/** `idle` → the arming button only; `confirming` → the panel that can actually delete. */
	let phase = $state(/** @type {'idle' | 'confirming'} */ ('idle'));

	let confirmation = $state('');
	let busy = $state(false);
	let error = $state('');
	let done = $state('');

	const armed = $derived(isDeleteConfirmed(confirmation) && !busy);

	$effect(() => {
		// Runs on mount (storage is unreadable while prerendering, so the initial value above is only
		// ever a placeholder) and again on every sign-in, sign-out or change of Gist.
		void $githubConnection;
		target = describeDeleteTarget();
	});

	function arm() {
		error = '';
		done = '';
		confirmation = '';
		phase = 'confirming';
	}

	function cancel() {
		confirmation = '';
		phase = 'idle';
	}

	/**
	 * @param {import('$lib/persistence.js').DeleteResult} result
	 * @returns {string}
	 */
	function describeOutcome(result) {
		if (result.mode !== 'gist' || !result.gist) {
			return "Deleted. This browser's copy of your data is gone. Any other device still has its own copy — this action could not reach it.";
		}
		const { outcome, gistId, owner, buildIdRemains } = result.gist;
		const local = "This browser's copy has been cleared too.";
		const buildNote = buildIdRemains
			? ` This build still names that Gist in VITE_GIST_ID, which the app cannot unset — rebuild without it, or your next save will fail against an id that no longer exists.`
			: '';

		if (outcome === 'gist-deleted') {
			return `Deleted. Gist ${gistId} is gone from @${owner}'s account, along with every earlier revision of it. ${local}${buildNote}`;
		}
		if (outcome === 'file-deleted') {
			return (
				`Deleted. uk-wealth-tracker.json has been removed from Gist ${gistId}, which holds other files of yours — those were left alone. ${local} ` +
				`Earlier revisions of that Gist still contain your data: delete the whole Gist on github.com if you want those gone as well.`
			);
		}
		return `Deleted. There was nothing of yours stored in a Gist. ${local}`;
	}

	async function confirmDelete() {
		if (!armed) return;
		error = '';
		done = '';
		busy = true;
		try {
			const result = await deleteAllAppData();
			done = describeOutcome(result);
			phase = 'idle';
			confirmation = '';
			target = describeDeleteTarget();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
</script>

<Card className="p-4 border-red-200">
	<h2 class="text-lg font-semibold mb-1">Delete all my data</h2>

	{#if target.scope === 'gist'}
		<p class="text-sm text-muted-foreground mb-3">
			Permanently deletes the data this app keeps in
			{#if target.gist}
				Gist <a
					class="underline"
					href="https://gist.github.com/{target.gist.id}"
					target="_blank"
					rel="noreferrer noopener">{target.gist.id}</a
				>
			{:else}
				your GitHub Gist
			{/if}
			{#if target.account}
				on @{target.account}'s account{/if}, and the copy stored in this browser. There is no undo
			and no backup — export your data as JSON first if you might want it back.
		</p>
	{:else}
		<p class="text-sm text-muted-foreground mb-3">
			Permanently deletes the copy of your data stored in this browser. That is everywhere this app
			has put it in browser-only storage mode — nothing was ever sent anywhere else, and no other
			device is reached. There is no undo and no backup — export your data as JSON first if you
			might want it back.
		</p>
	{/if}

	{#if target.blocked}
		<p class="text-sm text-red-600 mb-3">{target.blocked}</p>
	{/if}

	{#if done}
		<p class="text-sm text-green-700 mb-3" role="status">{done}</p>
	{/if}

	{#if phase === 'idle'}
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="border-red-300 text-red-700 hover:bg-red-50"
			disabled={busy || target.blocked !== null}
			onclick={arm}
		>
			Delete all my data…
		</Button>
		<p class="text-xs text-muted-foreground mt-2">
			Asks you to confirm before anything is deleted.
		</p>
	{:else}
		<div class="border border-red-300 rounded-md p-3">
			<p class="text-sm font-medium mb-1">This cannot be undone. It will delete:</p>
			<ul class="text-sm list-disc pl-5 mb-3">
				{#if target.scope === 'gist'}
					<li>
						{#if target.gist}
							Gist {target.gist.id}{#if target.account}, on @{target.account}'s GitHub account{/if} —
							the whole Gist, including its revision history, unless it holds files this app did not write,
							in which case only <code>uk-wealth-tracker.json</code> is removed.
						{:else}
							nothing in a Gist — this browser has not synced with one yet
						{/if}
					</li>
				{/if}
				<li>
					this browser's copy: every monthly entry, pension, property, asset and dividend record
				</li>
			</ul>
			<p class="text-xs text-muted-foreground mb-3">
				{#if target.scope === 'gist'}
					Your GitHub sign-in is kept — this deletes data, it does not sign you out or revoke your
					token. Other devices signed into the same Gist will find it gone.
				{:else}
					Your storage mode and any GitHub sign-in are kept — this deletes data, nothing else.
				{/if}
			</p>

			<label class="text-sm font-medium block mb-1" for="delete-confirmation">
				Type <code>{DELETE_CONFIRMATION_PHRASE}</code> to confirm
			</label>
			<div class="flex flex-wrap items-center gap-2">
				<input
					id="delete-confirmation"
					type="text"
					autocomplete="off"
					spellcheck="false"
					placeholder={DELETE_CONFIRMATION_PHRASE}
					bind:value={confirmation}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-40"
				/>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					disabled={!armed}
					onclick={confirmDelete}
				>
					{busy ? 'Deleting…' : 'Delete everything permanently'}
				</Button>
				<Button type="button" variant="outline" size="sm" disabled={busy} onclick={cancel}>
					Cancel
				</Button>
			</div>
		</div>
	{/if}

	{#if error}<p class="text-sm text-red-600 mt-3" role="alert">{error}</p>{/if}
</Card>
