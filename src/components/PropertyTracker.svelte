<script>
	/**
	 * Property tracking — README.md → "Property Tracker": "Types: Primary residence, Buy to let,
	 * Holiday home" and "Fields: value, outstanding mortgage, monthly payment, interest rate,
	 * mortgage type (fixed/tracker/SVR), deal expiry date" (issue #36's exact scope — "types + core
	 * fields").
	 *
	 * Structured the same way `DividendTracker.svelte`/`PensionTracker.svelte` handle their own flat
	 * lists: `properties[]` sits directly on `AppData` (`$lib/model.js`'s own `Property` typedef),
	 * one list the user adds to, edits and removes from — a property is a point-in-time fact, not a
	 * monthly snapshot line the way `InvestmentHoldings` treats `monthly_entries[].investments`.
	 *
	 * `mortgage_type` offers all four `MORTGAGE_TYPES`, not just the three the issue text names
	 * (fixed/tracker/SVR) — `none` already exists on the data model (#2) for a property owned outright,
	 * and a tracker that could not represent "no mortgage" would force every mortgage-free owner to
	 * lie in the interest rate and payment fields instead.
	 *
	 * Deliberately out of scope here, left to their own later issues: equity (`value -
	 * mortgage_balance`), buy-to-let rental income/running costs/cashflow/yield (#37), and the deal
	 * expiry amber/red reminder plus equity growth projection chart (#38). This component only
	 * collects the core fields and shows them back, the same way `DividendTracker.svelte` collects a
	 * holding's fields without itself computing the DRIP projection `DividendIncomePlanner.svelte`
	 * builds from them.
	 *
	 * No activity log: `$lib/enums.js`'s `ACTIVITY_LOG_ENTITY_TYPES` covers `investment`/`debt` only
	 * (issue #14's own scope), and properties were never in it — same as pensions and dividends.
	 */
	import {
		MORTGAGE_TYPES,
		MORTGAGE_TYPE_LABELS,
		PROPERTY_TYPES,
		PROPERTY_TYPE_LABELS
	} from '$lib/enums.js';
	import { createProperty } from '$lib/model.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/**
	 * @type {{ properties?: import('$lib/types.js').Property[] }}
	 */
	let { properties = $bindable([]) } = $props();

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	const totalValue = $derived(properties.reduce((sum, p) => sum + p.value, 0));
	const totalMortgageBalance = $derived(properties.reduce((sum, p) => sum + p.mortgage_balance, 0));

	/** @type {string | null} */
	let editingId = $state(null);
	let name = $state('');
	/** @type {import('$lib/enums.js').PropertyType} */
	let type = $state('primary_residence');
	let value = $state('');
	let mortgageBalance = $state('');
	let monthlyPayment = $state('');
	let interestRate = $state('');
	/** @type {import('$lib/enums.js').MortgageType} */
	let mortgageType = $state('fixed');
	let dealExpiry = $state('');

	function resetForm() {
		editingId = null;
		name = '';
		type = 'primary_residence';
		value = '';
		mortgageBalance = '';
		monthlyPayment = '';
		interestRate = '';
		mortgageType = 'fixed';
		dealExpiry = '';
	}

	function formFields() {
		return {
			name: name.trim(),
			type,
			value: Number(value) || 0,
			mortgage_balance: Number(mortgageBalance) || 0,
			monthly_payment: Number(monthlyPayment) || 0,
			interest_rate: Number(interestRate) || 0,
			mortgage_type: mortgageType,
			deal_expiry: dealExpiry === '' ? null : dealExpiry
		};
	}

	/** @param {import('$lib/types.js').Property} property */
	function startEdit(property) {
		editingId = property.id;
		name = property.name;
		type = property.type;
		value = String(property.value);
		mortgageBalance = String(property.mortgage_balance);
		monthlyPayment = String(property.monthly_payment);
		interestRate = String(property.interest_rate);
		mortgageType = property.mortgage_type;
		dealExpiry = property.deal_expiry ?? '';
	}

	function addProperty() {
		const fields = formFields();
		if (fields.name === '') return;

		properties = [...properties, createProperty(fields)];
		resetForm();
	}

	function saveEdit() {
		if (editingId === null) return;
		const before = properties.find((p) => p.id === editingId);
		if (!before) return;

		const fields = formFields();
		if (fields.name === '') return;

		const after = { ...before, ...fields };
		properties = properties.map((p) => (p.id === editingId ? after : p));
		resetForm();
	}

	function submitForm() {
		if (editingId === null) addProperty();
		else saveEdit();
	}

	/** @param {string} id */
	function removeProperty(id) {
		properties = properties.filter((p) => p.id !== id);
		if (editingId === id) resetForm();
	}
</script>

<div class="flex flex-col gap-6">
	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Properties</h2>

		{#if properties.length === 0}
			<p class="text-sm text-muted-foreground mb-4">No properties recorded yet. Add one below.</p>
		{:else}
			<p class="text-sm text-muted-foreground mb-3">
				{properties.length} propert{properties.length === 1 ? 'y' : 'ies'} recorded, totalling {formatMoney(
					totalValue
				)} of value with {formatMoney(totalMortgageBalance)} outstanding mortgage.
			</p>

			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each properties as property (property.id)}
					<li
						class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
					>
						<div class="flex flex-col">
							<span class="font-medium">{property.name}</span>
							<span class="text-sm text-muted-foreground">
								{PROPERTY_TYPE_LABELS[property.type]} · {MORTGAGE_TYPE_LABELS[
									property.mortgage_type
								]}
							</span>
							<span class="text-xs text-muted-foreground">
								{formatMoney(property.value)} value · {formatMoney(property.mortgage_balance)} mortgage
								at {property.interest_rate}%
								{#if property.monthly_payment > 0}
									· {formatMoney(property.monthly_payment)}/mo
								{/if}
								{#if property.deal_expiry}
									· deal expires {property.deal_expiry}
								{/if}
							</span>
						</div>
						<div class="flex items-center gap-2">
							<Button variant="outline" size="sm" type="button" onclick={() => startEdit(property)}>
								Edit
							</Button>
							<Button
								variant="ghost"
								size="sm"
								type="button"
								onclick={() => removeProperty(property.id)}
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
				<label class="text-sm font-medium" for="property-name">Property name</label>
				<input
					id="property-name"
					type="text"
					bind:value={name}
					placeholder="e.g. 12 Oak Avenue"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
					required
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-type">Type</label>
				<select
					id="property-type"
					bind:value={type}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				>
					{#each PROPERTY_TYPES as t (t)}
						<option value={t}>{PROPERTY_TYPE_LABELS[t]}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-value">Value (£)</label>
				<input
					id="property-value"
					type="number"
					min="0"
					step="0.01"
					bind:value
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-mortgage-balance">
					Outstanding mortgage (£)
				</label>
				<input
					id="property-mortgage-balance"
					type="number"
					min="0"
					step="0.01"
					bind:value={mortgageBalance}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-monthly-payment">
					Monthly payment (£)
				</label>
				<input
					id="property-monthly-payment"
					type="number"
					min="0"
					step="0.01"
					bind:value={monthlyPayment}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-interest-rate">Interest rate (%)</label>
				<input
					id="property-interest-rate"
					type="number"
					min="0"
					max="100"
					step="0.01"
					bind:value={interestRate}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-mortgage-type">Mortgage type</label>
				<select
					id="property-mortgage-type"
					bind:value={mortgageType}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				>
					{#each MORTGAGE_TYPES as m (m)}
						<option value={m}>{MORTGAGE_TYPE_LABELS[m]}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-deal-expiry">Deal expiry date</label>
				<input
					id="property-deal-expiry"
					type="date"
					bind:value={dealExpiry}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				/>
			</div>

			<Button type="submit" size="sm">{editingId === null ? 'Add property' : 'Save changes'}</Button
			>
			{#if editingId !== null}
				<Button variant="ghost" size="sm" type="button" onclick={resetForm}>Cancel</Button>
			{/if}
		</form>
	</Card>
</div>
