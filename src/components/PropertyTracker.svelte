<script>
	/**
	 * Property tracking — README.md → "Property Tracker": "Types: Primary residence, Buy to let,
	 * Holiday home" and "Fields: value, outstanding mortgage, monthly payment, interest rate,
	 * mortgage type (fixed/tracker/SVR), deal expiry date" (issue #36's "types + core fields"),
	 * extended here with "Equity calculation: value minus mortgage", "BTL: rental income, running
	 * costs, net monthly cashflow, gross yield" and "Property equity toggle: include/exclude from
	 * net worth" (issue #37's exact scope).
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
	 * `rental_income` and `running_costs` are always-visible form fields, not shown/hidden by
	 * `type` — the same restraint #36's own journal entry recorded for the rest of this form ("no
	 * existing tracker in this codebase conditionally shows/hides fields based on another field's
	 * value"). The computed equity/cashflow/yield line in each row *is* conditional — see below.
	 *
	 * `include_in_net_worth` is a row-level instant toggle, not a form field — the same pattern
	 * `DebtTracker.svelte` uses for `exclude_from_net_worth` on a debt, rather than routing a
	 * boolean through the add/edit form and an extra "Save changes" click.
	 *
	 * `$lib/property.js` owns the maths (`propertyEquity`, `propertyCashflow`,
	 * `propertyGrossYield`, `propertyPortfolioSummary`); this component only reads it. The
	 * cashflow/yield line only renders when a property has rent or running costs recorded — the
	 * same "don't show a computed line for data that isn't there" rule already applied to
	 * `monthly_payment`/`deal_expiry` below.
	 *
	 * Deliberately still out of scope, left to #38: the deal expiry amber/red reminder and the
	 * equity growth projection chart (`growth_rate` sits on the record unused by this component).
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
	import {
		propertyCashflow,
		propertyEquity,
		propertyGrossYield,
		propertyPortfolioSummary
	} from '$lib/property.js';
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

	const summary = $derived(propertyPortfolioSummary(properties));

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
	let rentalIncome = $state('');
	let runningCosts = $state('');

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
		rentalIncome = '';
		runningCosts = '';
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
			deal_expiry: dealExpiry === '' ? null : dealExpiry,
			rental_income: Number(rentalIncome) || 0,
			running_costs: Number(runningCosts) || 0
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
		rentalIncome = String(property.rental_income);
		runningCosts = String(property.running_costs);
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

	/** @param {string} id */
	function toggleIncludeInNetWorth(id) {
		properties = properties.map((p) =>
			p.id === id ? { ...p, include_in_net_worth: !p.include_in_net_worth } : p
		);
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
					summary.totalValue
				)} of value with {formatMoney(summary.totalMortgageBalance)} outstanding mortgage — {formatMoney(
					summary.totalEquity
				)} equity.
				{#if summary.excludedFromNetWorth.count > 0}
					{formatMoney(summary.includedInNetWorth.equity)} of that counts towards net worth ({summary
						.excludedFromNetWorth.count} propert{summary.excludedFromNetWorth.count === 1
						? 'y'
						: 'ies'} excluded).
				{/if}
			</p>

			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each properties as property (property.id)}
					{@const cashflow = propertyCashflow(property)}
					{@const grossYield = propertyGrossYield(property)}
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
							<span class="text-xs text-muted-foreground">
								{formatMoney(propertyEquity(property))} equity
								{#if !property.include_in_net_worth}
									(excluded from net worth)
								{/if}
							</span>
							{#if property.rental_income > 0 || property.running_costs > 0}
								<span class="text-xs text-muted-foreground">
									{formatMoney(property.rental_income)}/mo rent · {formatMoney(cashflow)}/mo net
									cashflow
									{#if grossYield !== null}
										· {grossYield}% gross yield
									{/if}
								</span>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<label class="flex items-center gap-1.5 text-sm text-muted-foreground">
								<input
									type="checkbox"
									checked={property.include_in_net_worth}
									onchange={() => toggleIncludeInNetWorth(property.id)}
								/>
								Include in net worth
							</label>
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
				<label class="text-sm font-medium" for="property-rental-income">
					Monthly rental income (£)
				</label>
				<input
					id="property-rental-income"
					type="number"
					min="0"
					step="0.01"
					bind:value={rentalIncome}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-running-costs">
					Monthly running costs (£)
				</label>
				<input
					id="property-running-costs"
					type="number"
					min="0"
					step="0.01"
					bind:value={runningCosts}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
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
