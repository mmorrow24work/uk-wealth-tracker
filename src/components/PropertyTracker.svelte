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
	 * `mortgage_type` offers all six `MORTGAGE_TYPES`, not just the three the issue text names
	 * (fixed/tracker/SVR) — `none` already exists on the data model (#2) for a property owned outright,
	 * and a tracker that could not represent "no mortgage" would force every mortgage-free owner to
	 * lie in the interest rate and payment fields instead. `variable` (a discount-variable deal,
	 * distinct from `tracker`/`svr`) and `offset` were added later at the user's own request.
	 *
	 * `rental_income`, `running_costs` and `offset_savings_balance` are always-visible form fields,
	 * not shown/hidden by `type`/`mortgage_type` — the same restraint #36's own journal entry
	 * recorded for the rest of this form ("no existing tracker in this codebase conditionally
	 * shows/hides fields based on another field's value"). `offset_savings_balance` affects two
	 * things, both gated on `mortgage_type` being `'offset'` (`$lib/property.js`): the equity
	 * projection's maths, and — added once the user pointed out the savings pot is real owned money
	 * that should count towards net worth just as much as equity does — `propertyPortfolioSummary`'s
	 * totals via `propertyOffsetSavings`, shown below as "counts towards net worth" alongside
	 * equity rather than folded into it (equity keeps meaning "value minus mortgage" everywhere it's
	 * read). Leaving the field at `0` for every other mortgage type is harmless, same as leaving
	 * rent/running costs at `0` for a property that isn't let. The computed equity/cashflow/yield
	 * line in each row *is* conditional — see below.
	 *
	 * `rented_residence` (a home the user rents and lives in as a tenant, not an owner) is one more
	 * `PROPERTY_TYPE` for the same "no conditional fields" reason: rather than hiding the
	 * ownership/mortgage fields for it, the form stays exactly as it is and the user leaves them at
	 * their `0` defaults — the actual rent is expected to live in the Budget tab's recurring
	 * expenses instead, not be duplicated here.
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
	 * #38 extends this with the two pieces left out above: a deal expiry reminder — amber inside
	 * `DEAL_EXPIRY_WARNING_DAYS` (90) of `deal_expiry`, red once it has passed, read per-row off
	 * `$lib/property.js`'s {@link dealExpiryStatus} — and a per-property 30-year equity growth
	 * projection chart, `PropertyEquityChart.svelte`, chosen from a select beneath the list (a
	 * single chart rather than one per property, the same reasoning `NetWorthChart` gives for one
	 * dashboard chart rather than one per holding: thirty properties would mean thirty charts on
	 * screen at once for one that is ever being looked at).
	 *
	 * `now` is a prop, not read from the clock inside this component, purely so a server-rendered
	 * test can assert a specific amber/red boundary without the answer changing depending on what
	 * day the test happens to run — `dealExpiryStatus` itself takes the same parameter for the same
	 * reason.
	 *
	 * #248 adds a "until age" horizon control above the chart, expressed as a target age rather than
	 * a raw year count: `propertyProjectionYearsForTargetAge` (`$lib/property.js`, #241) turns it into
	 * the year count `PropertyEquityChart`'s `years` prop takes, using the same `now` prop above
	 * rather than reading the clock inline. `profile` is read-only here, never written back — the
	 * same seeding the pensions tab gives `StatePensionProjection`/`PensionTaxRelief`. With no
	 * `profile.dob_year` there is no age to convert from, so the control is hidden in favour of a
	 * line of muted text explaining why, and the chart stays on its fixed default.
	 *
	 * #279 adds a "Single property" / "All properties" toggle beside the picker: single mode is this
	 * component exactly as #38 left it (the picker, `PropertyEquityChart` unchanged); all mode hides
	 * the (now meaningless) picker and swaps in `PropertyPortfolioEquityChart`, which plots every
	 * property's equity line on one chart using #240's `chartSeriesColor`. Both modes are driven by
	 * the same `projectionYears`, so switching the toggle does not reset the horizon. `chartMode` is
	 * seeded from an `initialChartMode` prop the same way `NetWorthChart.svelte`'s `lens` is seeded
	 * from `initialLens` — purely so a server-rendered test can assert what "All properties" mode
	 * renders without a pointer to click the toggle with; every real caller leaves it unset.
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
		dealExpiryStatus,
		PROPERTY_PROJECTION_DEFAULT_TARGET_AGE,
		propertyCashflow,
		propertyEquity,
		propertyGrossYield,
		propertyPortfolioSummary,
		propertyProjectionYearsForTargetAge
	} from '$lib/property.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';
	import PropertyEquityChart from './PropertyEquityChart.svelte';
	import PropertyPortfolioEquityChart from './PropertyPortfolioEquityChart.svelte';

	/**
	 * @type {{
	 * 	properties?: import('$lib/types.js').Property[],
	 * 	profile?: import('$lib/types.js').Profile | null,
	 * 	now?: Date,
	 * 	initialChartMode?: 'single' | 'all'
	 * }}
	 */
	let {
		properties = $bindable([]),
		profile = null,
		now = new Date(),
		initialChartMode = 'single'
	} = $props();

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
	let offsetSavingsBalance = $state('');
	let dealExpiry = $state('');
	let purchasePrice = $state('');
	let purchaseDate = $state('');
	let letFrom = $state('');
	let rentalIncome = $state('');
	let runningCosts = $state('');
	let growthRate = $state('3');

	function resetForm() {
		editingId = null;
		name = '';
		type = 'primary_residence';
		value = '';
		mortgageBalance = '';
		monthlyPayment = '';
		interestRate = '';
		mortgageType = 'fixed';
		offsetSavingsBalance = '';
		dealExpiry = '';
		purchasePrice = '';
		purchaseDate = '';
		letFrom = '';
		rentalIncome = '';
		runningCosts = '';
		growthRate = '3';
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
			offset_savings_balance: Number(offsetSavingsBalance) || 0,
			deal_expiry: dealExpiry === '' ? null : dealExpiry,
			purchase_price: Number(purchasePrice) || 0,
			purchase_date: purchaseDate === '' ? null : purchaseDate,
			let_from: letFrom === '' ? null : letFrom,
			rental_income: Number(rentalIncome) || 0,
			running_costs: Number(runningCosts) || 0,
			growth_rate: Number(growthRate) || 0
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
		offsetSavingsBalance = String(property.offset_savings_balance);
		dealExpiry = property.deal_expiry ?? '';
		purchasePrice = String(property.purchase_price);
		purchaseDate = property.purchase_date ?? '';
		letFrom = property.let_from ?? '';
		rentalIncome = String(property.rental_income);
		runningCosts = String(property.running_costs);
		growthRate = String(property.growth_rate);
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

	/**
	 * Words + an inline colour for a deal expiry reminder — amber inside the warning window, red
	 * once expired. Colour is given inline as well as by class for the same reason `NetWorthChart`'s
	 * legend swatches are: `app.css` still ships Tailwind v3's `@tailwind` directives under
	 * Tailwind v4, so most utility classes never reach the page, and the one thing this feature
	 * cannot afford is a warning that silently renders in the body text colour.
	 *
	 * @param {import('$lib/property.js').DealExpiryStatus} deal
	 * @returns {{ text: string, color: string } | null}
	 */
	function dealExpiryReminder(deal) {
		if (deal.status === 'red') {
			return {
				text: `mortgage deal expired ${Math.abs(deal.daysRemaining ?? 0)} days ago`,
				color: 'hsl(var(--destructive))'
			};
		}
		if (deal.status === 'amber') {
			return {
				text:
					deal.daysRemaining === 0
						? 'mortgage deal expires today'
						: `mortgage deal expires in ${deal.daysRemaining} days`,
				color: '#b45309'
			};
		}
		return null;
	}

	/** @type {string | null} */
	let chartPropertyId = $state(null);

	// Keeps the select's bound value pointed at a real property: defaults to the first one once any
	// exist, and re-points itself if the one it was showing gets removed — the same "fall back to
	// the first item" a `<select>` does natively, made to also update the state that drives it.
	$effect(() => {
		if (properties.length === 0) {
			chartPropertyId = null;
			return;
		}
		if (!properties.some((p) => p.id === chartPropertyId)) {
			chartPropertyId = properties[0].id;
		}
	});

	const chartProperty = $derived(
		properties.find((p) => p.id === chartPropertyId) ?? properties[0] ?? null
	);

	// Seeded from `initialChartMode`, then owned by the toggle below — see the header comment for why.
	// svelte-ignore state_referenced_locally
	let chartMode = $state(initialChartMode);

	let targetAge = $state(String(PROPERTY_PROJECTION_DEFAULT_TARGET_AGE));

	const projectionYears = $derived(
		propertyProjectionYearsForTargetAge(
			Number(targetAge) || 0,
			profile?.dob_year,
			profile?.dob_month,
			now
		)
	);
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
				{#if summary.totalOffsetSavings > 0}
					Plus {formatMoney(summary.totalOffsetSavings)} in offset mortgage savings.
				{/if}
				{#if summary.excludedFromNetWorth.count > 0 || summary.totalOffsetSavings > 0}
					{formatMoney(summary.includedInNetWorth.netWorthValue)} of that counts towards net worth
					{#if summary.excludedFromNetWorth.count > 0}
						({summary.excludedFromNetWorth.count} propert{summary.excludedFromNetWorth.count === 1
							? 'y'
							: 'ies'} excluded)
					{/if}.
				{/if}
			</p>

			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each properties as property (property.id)}
					{@const cashflow = propertyCashflow(property)}
					{@const grossYield = propertyGrossYield(property)}
					{@const deal = dealExpiryStatus(property.deal_expiry, now)}
					{@const reminder = dealExpiryReminder(deal)}
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
								{#if property.mortgage_type === 'offset' && property.offset_savings_balance > 0}
									· {formatMoney(property.offset_savings_balance)} offset
								{/if}
								{#if property.deal_expiry}
									· deal expires {property.deal_expiry}
								{/if}
							</span>
							{#if reminder}
								<span
									class="text-xs font-medium"
									style="color: {reminder.color}"
									data-deal-status={deal.status}
								>
									⚠ {reminder.text}
								</span>
							{/if}
							<span class="text-xs text-muted-foreground">
								{formatMoney(propertyEquity(property))} equity
								{#if property.mortgage_type === 'offset' && property.offset_savings_balance > 0}
									+ {formatMoney(property.offset_savings_balance)} offset savings
								{/if}
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
				<label class="text-sm font-medium" for="property-offset-savings">
					Offset savings balance (£)
				</label>
				<input
					id="property-offset-savings"
					type="number"
					min="0"
					step="0.01"
					bind:value={offsetSavingsBalance}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
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

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-purchase-price">
					Purchase price (£)
				</label>
				<input
					id="property-purchase-price"
					type="number"
					min="0"
					step="0.01"
					bind:value={purchasePrice}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-purchase-date">Purchase date</label>
				<input
					id="property-purchase-date"
					type="date"
					bind:value={purchaseDate}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-let-from">
					Letting period start date
				</label>
				<input
					id="property-let-from"
					type="date"
					bind:value={letFrom}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="property-growth-rate">
					Assumed annual growth (%)
				</label>
				<input
					id="property-growth-rate"
					type="number"
					min="-100"
					max="100"
					step="0.1"
					bind:value={growthRate}
					placeholder="3"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>

			<Button type="submit" size="sm">{editingId === null ? 'Add property' : 'Save changes'}</Button
			>
			{#if editingId !== null}
				<Button variant="ghost" size="sm" type="button" onclick={resetForm}>Cancel</Button>
			{/if}
		</form>
	</Card>

	{#if properties.length > 0 && chartProperty}
		<Card className="p-4">
			<div class="flex flex-wrap items-center gap-2 mb-3">
				<div
					class="flex items-center gap-3 text-sm"
					style="display:flex; align-items:center; gap:0.75rem"
					role="radiogroup"
					aria-label="Property chart view"
				>
					<label
						class="flex items-center gap-1.5"
						style="display:flex; align-items:center; gap:0.375rem"
					>
						<input type="radio" name="property-chart-mode" value="single" bind:group={chartMode} />
						Single property
					</label>
					<label
						class="flex items-center gap-1.5"
						style="display:flex; align-items:center; gap:0.375rem"
					>
						<input type="radio" name="property-chart-mode" value="all" bind:group={chartMode} />
						All properties
					</label>
				</div>
				{#if chartMode === 'single'}
					<label class="text-sm font-medium" for="property-chart-select">
						Equity growth projection for
					</label>
					<select
						id="property-chart-select"
						bind:value={chartPropertyId}
						class="border border-input rounded-md px-2 py-1.5 text-sm"
					>
						{#each properties as property (property.id)}
							<option value={property.id}>{property.name || 'Unnamed property'}</option>
						{/each}
					</select>
				{/if}
				{#if profile?.dob_year != null}
					<label class="text-sm font-medium" for="property-chart-target-age">until age</label>
					<input
						id="property-chart-target-age"
						type="number"
						min="0"
						max="120"
						step="1"
						bind:value={targetAge}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-20"
					/>
				{:else}
					<span class="text-sm text-muted-foreground">
						Add your date of birth on the forecast tab to project this until a target age.
					</span>
				{/if}
			</div>
			{#if chartMode === 'single'}
				<PropertyEquityChart property={chartProperty} years={projectionYears ?? undefined} />
			{:else}
				<PropertyPortfolioEquityChart {properties} years={projectionYears ?? undefined} />
			{/if}
		</Card>
	{/if}
</div>
