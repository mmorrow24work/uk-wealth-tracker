<script>
	/**
	 * Capital Gains Tax estimate panel — README.md → "Capital Gains Tax on Property (2026/27)"
	 * (issue #246; the engine it reads, `$lib/capital-gains.js`, is the previous issue in the
	 * milestone, #245).
	 *
	 * Lives on the Tax tab rather than the Property tab, per the user's own request. Unlike
	 * `StressTestPanel`/`IncomeShockPanel`/`MortgageRateRisePanel`, this isn't an overlay on a
	 * forecast — it's a standalone calculator card, so it follows `DividendTaxSummary`'s shape
	 * instead: a `Card`, an editable field seeded from the profile, stat tiles, a rate-by-rate table,
	 * and an illustrative-only footnote.
	 *
	 * The property picker only offers properties with both `purchase_price` and `purchase_date`
	 * recorded — the two fields the engine needs just to work out an ownership period at all — the
	 * same "filter the picker, don't render a broken answer" convention `MortgageRateRisePanel` uses
	 * for mortgaged properties. A property missing either is left off the list; the empty state below
	 * points at the Property tab rather than showing a zero.
	 *
	 * `saleDateInput`/`salePriceInput`/`otherIncomeInput` are seeded once and then belong to the user,
	 * the same idiom `DividendTaxSummary`'s own `otherIncome` field uses — nothing here is written
	 * back to `property` or `profile`. The `initialXxx` props exist for the same reason
	 * `MortgageRateRisePanel`'s dials have them: there's no browser test environment (see its own
	 * test file), so a server-rendered test needs a way to reach a non-default figure without a
	 * pointer to type one in.
	 */
	import { capitalGainsTaxOnPropertySale, CGT_TAX_YEAR } from '$lib/capital-gains.js';
	import { createProfile } from '$lib/model.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 * 	properties?: import('$lib/types.js').Property[],
	 * 	profile?: import('$lib/types.js').Profile,
	 * 	now?: Date,
	 * 	initialSaleDate?: string | null,
	 * 	initialSalePrice?: number | null,
	 * 	initialOtherIncome?: number | null
	 * }}
	 */
	let {
		properties = [],
		profile = createProfile(),
		now = new Date(),
		initialSaleDate = null,
		initialSalePrice = null,
		initialOtherIncome = null
	} = $props();

	// The two fields the engine needs just to place an ownership period on the calendar — without
	// both, `capitalGainsTaxOnPropertySale` can only report itself as inapplicable, which reads as a
	// broken tool rather than an honest "not enough recorded yet". Filtering the picker to properties
	// that actually carry both is the same convention `MortgageRateRisePanel` uses for a mortgage
	// balance.
	const eligibleProperties = $derived(
		properties.filter((property) => Boolean(property.purchase_date) && property.purchase_price > 0)
	);

	/** @type {string | null} */
	let propertyId = $state(null);

	// Keeps the picker pointed at a real eligible property — the same "fall back to the first item,
	// re-point if the one shown disappears" pattern `MortgageRateRisePanel`'s own property picker
	// uses.
	$effect(() => {
		if (eligibleProperties.length === 0) {
			propertyId = null;
			return;
		}
		if (!eligibleProperties.some((property) => property.id === propertyId)) {
			propertyId = eligibleProperties[0].id;
		}
	});

	// Falls back directly, not only through the `$effect` above: `$effect`s never run during server
	// rendering, so without this the initial render would show no property picked at all — the same
	// reason `MortgageRateRisePanel`'s own `property` is derived this way.
	const property = $derived(
		eligibleProperties.find((candidate) => candidate.id === propertyId) ??
			eligibleProperties[0] ??
			null
	);

	/** @param {Date} date @returns {string} ISO `YYYY-MM-DD`, in the local calendar day. */
	function todayIso(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	// Seeded once and then the user's own, same as `DividendTaxSummary`'s `otherIncome` field. The
	// sale price defaults to the property's current recorded value — a reasonable first guess at what
	// it would fetch — and the sale date to today.
	// svelte-ignore state_referenced_locally
	let saleDateInput = $state(initialSaleDate ?? todayIso(now));
	// svelte-ignore state_referenced_locally
	let salePriceInput = $state(String(initialSalePrice ?? property?.value ?? 0));
	// svelte-ignore state_referenced_locally
	let otherIncomeInput = $state(String(initialOtherIncome ?? profile.gross_salary ?? 0));

	/**
	 * @param {unknown} value
	 * @param {number} fallback
	 * @returns {number}
	 */
	function parseMoney(value, fallback) {
		if (value === null || value === undefined || value === '') return fallback;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	const salePrice = $derived(parseMoney(salePriceInput, 0));
	const otherIncome = $derived(parseMoney(otherIncomeInput, 0));

	const breakdown = $derived(
		property
			? capitalGainsTaxOnPropertySale({
					property,
					salePrice,
					saleDate: saleDateInput || null,
					otherIncome
				})
			: null
	);

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});
	const penceFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} amount */
	function formatExact(amount) {
		return penceFormatter.format(amount);
	}

	/** @param {number} fraction `0`…`1` @returns {string} e.g. "54.7%" */
	function formatFraction(fraction) {
		return `${Math.round(fraction * 1000) / 10}%`;
	}

	/**
	 * A whole number of days, in months, for legibility — the engine itself apportions relief in
	 * days, so this is a display-only conversion (average 30.4368-day month) layered on top of an
	 * already-exact fraction, not a second calculation.
	 *
	 * @param {number} days
	 */
	function formatMonthsApprox(days) {
		const months = Math.round(days / 30.4368);
		return `${months} month${months === 1 ? '' : 's'}`;
	}

	/**
	 * A CGT band's slice, as a range of taxable income — the same convention `DividendTaxSummary`
	 * uses for its own dividend bands: pounds of *income* (with the gain stacked on top), not pounds
	 * of gain.
	 *
	 * @param {import('$lib/capital-gains.js').CgtBandSlice} slice
	 */
	function formatBandRange(slice) {
		const from = formatMoney(slice.from);
		return slice.to === null ? `over ${from}` : `${from} – ${formatMoney(slice.to)}`;
	}

	/** @param {string | null} name */
	function propertyLabel(name) {
		return name || 'Unnamed property';
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Capital Gains Tax estimate, {CGT_TAX_YEAR}</h2>
	<p class="text-sm text-muted-foreground mb-4">
		What Capital Gains Tax would cost on a hypothetical property sale — nothing here is a record of
		an actual disposal. Pick a property, say what it would sell for and when, and this works out the
		gain, the Private Residence Relief and Annual Exempt Amount that reduce it, and the tax due on
		what's left.
	</p>

	{#if properties.length === 0}
		<p class="text-sm text-muted-foreground">
			No properties recorded yet — add one on the Property tab to estimate Capital Gains Tax on a
			sale.
		</p>
	{:else if eligibleProperties.length === 0}
		<p class="text-sm text-muted-foreground">
			None of your recorded properties have both a purchase price and a purchase date recorded, so
			Capital Gains Tax can't be estimated for any of them yet. Add those under the Capital Gains
			Tax fields on the Property tab to use this panel.
		</p>
	{:else}
		<div class="flex flex-wrap items-end gap-4 mb-4">
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="cgt-property">Property</label>
				<select
					id="cgt-property"
					bind:value={propertyId}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-56"
				>
					{#each eligibleProperties as p (p.id)}
						<option value={p.id}>{propertyLabel(p.name)}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="cgt-sale-date">Hypothetical sale date</label>
				<input
					id="cgt-sale-date"
					type="date"
					bind:value={saleDateInput}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="cgt-sale-price">Hypothetical sale price (£)</label>
				<input
					id="cgt-sale-price"
					type="number"
					min="0"
					step="1000"
					bind:value={salePriceInput}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-36"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="cgt-other-income">
					Your other taxable income (£/yr)
				</label>
				<input
					id="cgt-other-income"
					type="number"
					min="0"
					step="100"
					bind:value={otherIncomeInput}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-36"
				/>
				<span class="text-xs text-muted-foreground">
					Decides which CGT rate applies. Seeded from your profile; changing it here does not save
					it.
				</span>
			</div>
		</div>

		{#if !breakdown}
			<p class="text-sm text-muted-foreground">Nothing to estimate yet.</p>
		{:else if !breakdown.applicable}
			<p class="text-sm text-muted-foreground">{breakdown.warnings[0]}</p>
		{:else if breakdown.isLoss}
			<p class="text-sm mb-1">
				<span class="font-medium">
					Selling {propertyLabel(property?.name ?? null)} for {formatMoney(breakdown.salePrice)} would
					be a loss
				</span>
				— {formatMoney(Math.abs(breakdown.gain))} below the {formatMoney(breakdown.purchasePrice)} purchase
				price.
			</p>
			<p class="text-sm text-muted-foreground">
				A loss carries no Capital Gains Tax to pay, but this app doesn't record it as a loss to
				carry forward against a future gain — keep your own record with HMRC if this sale goes
				ahead.
			</p>
		{:else}
			<div class="flex flex-wrap gap-3 mb-4">
				<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
					<div class="text-sm font-medium">Gain before relief</div>
					<div class="text-xs text-muted-foreground mb-1">
						{formatMoney(breakdown.salePrice)} sale − {formatMoney(breakdown.purchasePrice)} purchase
					</div>
					<div class="text-xl font-semibold">{formatMoney(breakdown.chargeableGain)}</div>
				</div>

				<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
					<div class="text-sm font-medium">Private Residence Relief</div>
					<div class="text-xs text-muted-foreground mb-1">
						{formatMonthsApprox(breakdown.period.reliefDays)} of {formatMonthsApprox(
							breakdown.period.totalDays
						)} owned ({formatFraction(breakdown.period.reliefFraction)})
					</div>
					<div class="text-xl font-semibold">{formatMoney(breakdown.privateResidenceRelief)}</div>
				</div>

				<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
					<div class="text-sm font-medium">Annual Exempt Amount</div>
					<div class="text-xs text-muted-foreground mb-1">
						{formatExact(breakdown.annualExemptAmountUsed)} of {formatMoney(
							breakdown.annualExemptAmount
						)} used
					</div>
					<div class="text-xl font-semibold">
						{formatMoney(breakdown.annualExemptAmountRemaining)} left
					</div>
				</div>

				<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
					<div class="text-sm font-medium">Taxable gain</div>
					<div class="text-xs text-muted-foreground mb-1">after relief and the exempt amount</div>
					<div class="text-xl font-semibold">{formatMoney(breakdown.taxableGain)}</div>
				</div>

				<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
					<div class="text-sm font-medium">Tax due</div>
					<div class="text-xs text-muted-foreground mb-1">
						{formatFraction(breakdown.effectiveRate / 100)} of the gain before relief
					</div>
					<div class="text-xl font-semibold">{formatMoney(breakdown.totalTax)}</div>
				</div>

				<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
					<div class="text-sm font-medium">Net after tax</div>
					<div class="text-xs text-muted-foreground mb-1">gain minus the estimated tax</div>
					<div class="text-xl font-semibold">{formatMoney(breakdown.gainAfterTax)}</div>
				</div>
			</div>

			<p class="text-sm text-muted-foreground mb-4">
				{propertyLabel(property?.name ?? null)} was owned for {formatMonthsApprox(
					breakdown.period.totalDays
				)}, of which {formatMonthsApprox(breakdown.period.occupiedDays)} was lived in as the main residence{#if breakdown.period.finalPeriodDays > 0}
					and the final {formatMonthsApprox(breakdown.period.finalPeriodDays)} counts as deemed occupation
					whatever it was actually used for then{/if}. Together that relieves
				{formatFraction(breakdown.period.reliefFraction)} of the gain, worth {formatExact(
					breakdown.privateResidenceRelief
				)}, before the {formatMoney(breakdown.annualExemptAmount)} Annual Exempt Amount comes off the
				rest.
			</p>

			<h3 class="text-sm font-semibold mb-1">Rate by rate</h3>
			<p class="text-xs text-muted-foreground mb-2">
				The taxable gain is stacked on top of your other income, with {formatMoney(
					breakdown.taxableOtherIncome
				)} of taxable income already filling the bottom of the ladder — that leaves
				{formatMoney(breakdown.basicRateBandAvailable)} of the £37,700 basic rate band for this gain before
				the 24% rate takes over.
			</p>
			<table class="w-full text-sm border-collapse mb-4">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Rate</th>
						<th class="py-2 px-2 font-medium text-right">Charged at</th>
						<th class="py-2 px-2 font-medium">Applies to</th>
						<th class="py-2 px-2 font-medium text-right">Gain here</th>
						<th class="py-2 pl-2 font-medium text-right">Tax</th>
					</tr>
				</thead>
				<tbody>
					{#each breakdown.bands as band (band.id)}
						<tr
							class="border-b border-border/60 {band.amount === 0 ? 'text-muted-foreground' : ''}"
						>
							<td class="py-2 pr-2">{band.label}</td>
							<td class="py-2 px-2 text-right tabular-nums">{band.rate}%</td>
							<td class="py-2 px-2 text-muted-foreground">{formatBandRange(band)}</td>
							<td class="py-2 px-2 text-right tabular-nums">{formatExact(band.amount)}</td>
							<td class="py-2 pl-2 text-right tabular-nums font-medium">{formatExact(band.tax)}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr class="border-t border-border font-medium">
						<td class="py-2 pr-2" colspan="3">Total taxable gain</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatExact(breakdown.taxableGain)}</td>
						<td class="py-2 pl-2 text-right tabular-nums">{formatExact(breakdown.totalTax)}</td>
					</tr>
				</tfoot>
			</table>

			{#if breakdown.warnings.length > 0}
				<ul class="text-xs text-muted-foreground list-disc list-inside mb-3">
					{#each breakdown.warnings as warning (warning)}
						<li>{warning}</li>
					{/each}
				</ul>
			{/if}
		{/if}

		<p class="text-xs text-muted-foreground mt-3">
			Illustrative estimate, not tax advice. {CGT_TAX_YEAR} figures, on a hypothetical sale you type in
			here — nothing on this card is saved. Allowable costs (stamp duty, legal and agent fees, capital
			improvements), Letting Relief and joint ownership are not modelled, so a real bill for a jointly
			owned property, one with shared occupancy, or one with costs to deduct would be lower than this.
			The £3,000 Annual Exempt Amount is assumed wholly available to this one disposal, though in real
			life it's shared with any other gain in the same tax year.
		</p>
	{/if}
</Card>
