<script>
	/**
	 * Life insurance tracker — issue #253, the UI half of the `LifeInsurance` data model #252 added
	 * to `$lib/model.js`. Lives on the Estate tab (`routes/estate/+page.svelte`) alongside
	 * Beneficiaries/EstateSummary rather than a standalone nav tab, since it's estate-planning-adjacent
	 * and that's where the user asked for it.
	 *
	 * Structured the same add/edit/remove-a-row shape as `PensionTracker.svelte`/`AssetsTracker.svelte`:
	 * `life_insurance[]` sits directly on `AppData`, one flat list the user adds to, edits and removes
	 * from — a policy is a point-in-time fact, not a monthly snapshot line.
	 *
	 * Form scope is deliberately the three facts the issue names — policy name, provider, sum assured —
	 * plus the "In trust" checkbox. `current_value` and `notes` are already on the data model (#252) for
	 * future use but have no form field yet; they stay at their factory defaults (0 / `''`) for policies
	 * added here.
	 *
	 * No Estate valuation change here — this is data entry only. The next issue in this milestone wires
	 * `life_insurance` into `estateValuation()`/`EstateSummary.svelte`.
	 */
	import { createLifeInsurance } from '$lib/model.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/**
	 * @type {{ policies?: import('$lib/types.js').LifeInsurance[] }}
	 */
	let { policies = $bindable([]) } = $props();

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	const totalSumAssured = $derived(policies.reduce((sum, policy) => sum + policy.sum_assured, 0));

	/** @type {string | null} */
	let editingId = $state(null);
	let name = $state('');
	let provider = $state('');
	let sumAssured = $state('');
	let inTrust = $state(false);

	function resetForm() {
		editingId = null;
		name = '';
		provider = '';
		sumAssured = '';
		inTrust = false;
	}

	function formFields() {
		return {
			name: name.trim(),
			provider: provider.trim(),
			sum_assured: Number(sumAssured) || 0,
			in_trust: inTrust
		};
	}

	/** @param {import('$lib/types.js').LifeInsurance} policy */
	function startEdit(policy) {
		editingId = policy.id;
		name = policy.name;
		provider = policy.provider;
		sumAssured = String(policy.sum_assured);
		inTrust = policy.in_trust;
	}

	function addPolicy() {
		const fields = formFields();
		if (fields.name === '') return;

		policies = [...policies, createLifeInsurance(fields)];
		resetForm();
	}

	function saveEdit() {
		if (editingId === null) return;
		const before = policies.find((policy) => policy.id === editingId);
		if (!before) return;

		const fields = formFields();
		if (fields.name === '') return;

		const after = { ...before, ...fields };
		policies = policies.map((policy) => (policy.id === editingId ? after : policy));
		resetForm();
	}

	function submitForm() {
		if (editingId === null) addPolicy();
		else saveEdit();
	}

	/** @param {string} id */
	function removePolicy(id) {
		policies = policies.filter((policy) => policy.id !== id);
		if (editingId === id) resetForm();
	}
</script>

<div class="flex flex-col gap-6">
	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Life insurance</h2>

		{#if policies.length === 0}
			<p class="text-sm text-muted-foreground mb-4">
				No life insurance policies recorded yet. Add one below.
			</p>
		{:else}
			<p class="text-sm text-muted-foreground mb-3">
				{policies.length} polic{policies.length === 1 ? 'y' : 'ies'} recorded, totalling {formatMoney(
					totalSumAssured
				)} of sum assured.
			</p>

			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each policies as policy (policy.id)}
					<li
						class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
					>
						<div class="flex flex-col">
							<span class="font-medium">{policy.name}</span>
							<span class="text-sm text-muted-foreground">{policy.provider}</span>
							<span class="text-xs text-muted-foreground">
								{formatMoney(policy.sum_assured)} sum assured
								{#if policy.in_trust}
									· in trust
								{/if}
							</span>
						</div>
						<div class="flex items-center gap-2">
							<Button variant="outline" size="sm" type="button" onclick={() => startEdit(policy)}>
								Edit
							</Button>
							<Button
								variant="ghost"
								size="sm"
								type="button"
								onclick={() => removePolicy(policy.id)}
							>
								Remove
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			class="flex flex-wrap items-end gap-3"
			onsubmit={(event) => {
				event.preventDefault();
				submitForm();
			}}
		>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="life-insurance-name">Policy name</label>
				<input
					id="life-insurance-name"
					type="text"
					bind:value={name}
					placeholder="e.g. Level-term £500k to age 60"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
					required
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="life-insurance-provider">Provider</label>
				<input
					id="life-insurance-provider"
					type="text"
					bind:value={provider}
					placeholder="e.g. Zurich"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="life-insurance-sum-assured">Sum assured (£)</label>
				<input
					id="life-insurance-sum-assured"
					type="number"
					min="0"
					step="0.01"
					bind:value={sumAssured}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<div class="flex flex-col gap-1 max-w-xs">
				<label class="flex items-center gap-1.5 text-sm font-medium" for="life-insurance-in-trust">
					<input id="life-insurance-in-trust" type="checkbox" bind:checked={inTrust} />
					In trust
				</label>
				<p class="text-xs text-muted-foreground">
					A policy written in trust pays out to your beneficiaries directly and sits outside your
					estate for Inheritance Tax.
				</p>
			</div>

			<Button type="submit" size="sm">{editingId === null ? 'Add policy' : 'Save changes'}</Button>
			{#if editingId !== null}
				<Button variant="ghost" size="sm" type="button" onclick={resetForm}>Cancel</Button>
			{/if}
		</form>
	</Card>
</div>
