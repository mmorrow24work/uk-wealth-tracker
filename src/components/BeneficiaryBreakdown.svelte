<script>
	/**
	 * The beneficiary list, its entry form, and who-gets-what priced against the net estate —
	 * README.md → "Estate & IHT Planning Suite": "Who-gets-what wishes per beneficiary" (issues #167
	 * and #191).
	 *
	 * Structured the same way `AssetsTracker.svelte`/`PropertyTracker.svelte`/`DividendTracker.svelte`
	 * handle their own flat lists: `beneficiaries[]` sits directly on `AppData` (`$lib/model.js`'s own
	 * `Beneficiary` typedef, landed by #140), one list the user adds to, edits and removes from,
	 * seeded from `createBeneficiary()` rather than hand-rolling an id.
	 *
	 * Each row shows the wish exactly as stated — name, relationship, wished share % and notes.
	 * Nothing here rescales or validates the shares against one another: a list that sums to 60% or
	 * 140% saves exactly as typed, since a half-drafted will is the normal case, not a validation
	 * failure.
	 *
	 * `netAfterTax` — `EstateSummary.svelte`'s own `$bindable` seam (#191's minimal groundwork for
	 * #202, built here because #191 needed the seam before #202 had landed) — is the net estate to
	 * price wishes against, read as a prop from the page rather than a second `estateSnapshot()` call.
	 * `estate-plan.js`'s `beneficiaryShares()` does the arithmetic; this component only renders what
	 * it returns — the £ figure behind each share, and, per its own documented convention 4, the
	 * `totalSharePct`/`unallocatedPct`/`unallocatedAmount`/`overAllocated` state of the list as a
	 * whole, stated rather than corrected. `netAfterTax` left `undefined` (its default, and what a
	 * standalone mount or an existing test gets) means there is nothing to price yet — #166's empty
	 * state on the page above already keeps this component off the page until there is an estate
	 * behind it, so a table of £0 shares presented as a finding never has a reason to render; the
	 * percentages #167 shows stand on their own until then.
	 */
	import { createBeneficiary } from '$lib/model.js';
	import { beneficiaryShares } from '$lib/estate-plan.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/**
	 * @type {{ beneficiaries?: import('$lib/types.js').Beneficiary[], netAfterTax?: number }}
	 */
	let { beneficiaries = $bindable([]), netAfterTax = undefined } = $props();

	const sharesResult = $derived(
		typeof netAfterTax === 'number' && Number.isFinite(netAfterTax)
			? beneficiaryShares(beneficiaries, netAfterTax)
			: null
	);
	const hasNetEstate = $derived(sharesResult !== null);
	const amountsById = $derived(
		new Map((sharesResult?.shares ?? []).map((share) => [share.id, share.amount]))
	);

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount @returns {string} */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} pct @returns {string} e.g. "12.5" — one decimal, matching the share input's own step. */
	function formatPct(pct) {
		return String(Math.round(pct * 10) / 10);
	}

	/** @type {string | null} */
	let editingId = $state(null);
	let name = $state('');
	let relationship = $state('');
	let sharePct = $state('');
	let notes = $state('');

	function resetForm() {
		editingId = null;
		name = '';
		relationship = '';
		sharePct = '';
		notes = '';
	}

	function formFields() {
		return {
			name: name.trim(),
			relationship: relationship.trim(),
			share_pct: Number(sharePct) || 0,
			notes: notes.trim()
		};
	}

	/** @param {import('$lib/types.js').Beneficiary} beneficiary */
	function startEdit(beneficiary) {
		editingId = beneficiary.id;
		name = beneficiary.name;
		relationship = beneficiary.relationship;
		sharePct = String(beneficiary.share_pct);
		notes = beneficiary.notes;
	}

	function addBeneficiary() {
		const fields = formFields();
		if (fields.name === '') return;

		beneficiaries = [...beneficiaries, createBeneficiary(fields)];
		resetForm();
	}

	function saveEdit() {
		if (editingId === null) return;
		const before = beneficiaries.find((b) => b.id === editingId);
		if (!before) return;

		const fields = formFields();
		if (fields.name === '') return;

		const after = { ...before, ...fields };
		beneficiaries = beneficiaries.map((b) => (b.id === editingId ? after : b));
		resetForm();
	}

	function submitForm() {
		if (editingId === null) addBeneficiary();
		else saveEdit();
	}

	/** @param {string} id */
	function removeBeneficiary(id) {
		beneficiaries = beneficiaries.filter((b) => b.id !== id);
		if (editingId === id) resetForm();
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-3">Beneficiaries</h2>

	{#if beneficiaries.length === 0}
		<p class="text-sm text-muted-foreground mb-4">
			No beneficiaries recorded yet — add who you'd like your estate to go to, and the share you'd
			like them to have.
		</p>
	{:else}
		<p class="text-sm text-muted-foreground mb-3">
			{beneficiaries.length} beneficiar{beneficiaries.length === 1 ? 'y' : 'ies'} recorded.
		</p>

		<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
			{#each beneficiaries as beneficiary (beneficiary.id)}
				<li
					class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
				>
					<div class="flex flex-col">
						<span class="font-medium">{beneficiary.name}</span>
						<span class="text-sm text-muted-foreground">
							{beneficiary.relationship || 'Relationship not recorded'} · {beneficiary.share_pct}%
							wished share
							{#if hasNetEstate}
								· {formatMoney(amountsById.get(beneficiary.id) ?? 0)}
							{/if}
						</span>
						{#if beneficiary.notes}
							<span class="text-xs text-muted-foreground">{beneficiary.notes}</span>
						{/if}
					</div>
					<div class="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							type="button"
							onclick={() => startEdit(beneficiary)}
						>
							Edit
						</Button>
						<Button
							variant="ghost"
							size="sm"
							type="button"
							onclick={() => removeBeneficiary(beneficiary.id)}
						>
							Remove
						</Button>
					</div>
				</li>
			{/each}
		</ul>

		{#if hasNetEstate && sharesResult}
			{#if sharesResult.overAllocated}
				<p class="text-sm text-amber-700 mb-4">
					Wishes add up to {formatPct(sharesResult.totalSharePct)}% of the estate — {formatPct(
						Math.abs(sharesResult.unallocatedPct)
					)}% ({formatMoney(Math.abs(sharesResult.unallocatedAmount))}) more than there is.
					Over-allocated: something here will need to change before the whole estate can be given
					away as wished.
				</p>
			{:else if sharesResult.totalSharePct < 100}
				<p class="text-sm text-muted-foreground mb-4">
					{formatPct(sharesResult.unallocatedPct)}% of the estate — {formatMoney(
						sharesResult.unallocatedAmount
					)} — isn't promised to anyone yet.
				</p>
			{/if}
		{/if}
	{/if}

	<form
		class="flex flex-wrap items-end gap-3"
		onsubmit={(event) => {
			event.preventDefault();
			submitForm();
		}}
	>
		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="beneficiary-name">Name</label>
			<input
				id="beneficiary-name"
				type="text"
				bind:value={name}
				placeholder="e.g. Jess"
				class="border border-input rounded-md px-2 py-1.5 text-sm"
				required
			/>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="beneficiary-relationship">Relationship</label>
			<input
				id="beneficiary-relationship"
				type="text"
				bind:value={relationship}
				placeholder="e.g. Spouse, Daughter, Charity"
				class="border border-input rounded-md px-2 py-1.5 text-sm"
			/>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="beneficiary-share-pct">Wished share (%)</label>
			<input
				id="beneficiary-share-pct"
				type="number"
				min="0"
				max="100"
				step="0.1"
				bind:value={sharePct}
				placeholder="0"
				class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
			/>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="beneficiary-notes">Notes</label>
			<input
				id="beneficiary-notes"
				type="text"
				bind:value={notes}
				placeholder="Optional"
				class="border border-input rounded-md px-2 py-1.5 text-sm"
			/>
		</div>

		<Button type="submit" size="sm">
			{editingId === null ? 'Add beneficiary' : 'Save changes'}
		</Button>
		{#if editingId !== null}
			<Button variant="ghost" size="sm" type="button" onclick={resetForm}>Cancel</Button>
		{/if}
	</form>
</Card>
