<script>
	/**
	 * UK dividend allowance and GIA tax rates — README.md → "Dividend Income Planner": "UK dividend
	 * allowance: £500/yr tax-free (2026/27); ISA/SIPP fully sheltered" and "GIA tax rates: 10.75%
	 * basic, 35.75% higher rate" (issue #35's exact scope).
	 *
	 * `$lib/dividend-tax.js` does the maths; this card is where the wrapper split becomes visible.
	 * `DividendTracker.svelte` above already collects the one field that decides everything here —
	 * each holding's account wrapper — so nothing new is entered on this card except the taxpayer's
	 * *other* income, which dividend tax depends on entirely (dividends are taxed as the top slice
	 * of income, so the same £2,000 of dividends costs £161.25 or £536.25 depending on the salary
	 * underneath them).
	 *
	 * That other-income field is seeded from `profile.gross_salary` — the same read-only seeding
	 * `PensionTaxRelief.svelte` and `DividendIncomePlanner.svelte` do from the profile — but is
	 * editable and not written back, because the income a dividend portfolio is taxed against is
	 * often not today's salary (someone modelling the income phase is asking about a year in which
	 * the salary has stopped). Nothing on this card mutates `dividends` or `profile`.
	 *
	 * The figures are today's portfolio, not a projection: see the disclaimer at the foot of the
	 * card and the note in `$lib/dividend-tax.js`'s header for why the projected income the planner
	 * below shows is deliberately left gross.
	 */
	import {
		DIVIDEND_ALLOWANCE,
		DIVIDEND_TAX_YEAR,
		dividendPortfolioTax,
		taxFreeDividendHeadroom
	} from '$lib/dividend-tax.js';
	import { WRAPPER_LABELS } from '$lib/enums.js';
	import { createProfile } from '$lib/model.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 * 	dividends?: import('$lib/types.js').Dividend[],
	 * 	profile?: import('$lib/types.js').Profile
	 * }}
	 */
	let { dividends = [], profile = createProfile() } = $props();

	// svelte-ignore state_referenced_locally
	let otherIncome = $state(String(profile.gross_salary ?? 0));

	const parsedOtherIncome = $derived(Number(otherIncome) || 0);
	const result = $derived(dividendPortfolioTax(dividends, { otherIncome: parsedOtherIncome }));
	const headroom = $derived(
		taxFreeDividendHeadroom({
			dividendIncome: result.taxableWrapperIncome,
			otherIncome: parsedOtherIncome
		})
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

	/** @param {number} rate @returns {string} e.g. "10.75%" */
	function formatRate(rate) {
		return `${Math.round(rate * 100) / 100}%`;
	}

	/**
	 * A dividend band's slice, as a range of taxable income — the same convention `TaxCalculator`
	 * uses for `tax.js`'s bands: pounds *after* the personal allowance, not gross income.
	 *
	 * @param {import('$lib/dividend-tax.js').DividendBandSlice} slice
	 * @returns {string}
	 */
	function formatBandRange(slice) {
		const from = formatMoney(slice.from);
		return slice.to === null ? `over ${from}` : `${from} – ${formatMoney(slice.to)}`;
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Dividend tax, {DIVIDEND_TAX_YEAR}</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Dividends inside an ISA, a SIPP or a workplace pension are sheltered completely — they are never
		taxed and never touch any allowance. Everything held in a General Investment Account or
		unwrapped is taxable: the first {formatMoney(DIVIDEND_ALLOWANCE)} a year is covered by the dividend
		allowance, and the rest is charged at the dividend rates, which are lower than income tax rates and
		are the same across the whole UK — Scotland's own bands do not apply to dividends. Dividends sit on
		top of your other income, so what you earn elsewhere decides which rate they meet.
	</p>

	<div class="flex flex-wrap items-end gap-4 mb-4">
		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="dividend-other-income">
				Your other taxable income (£/yr)
			</label>
			<input
				id="dividend-other-income"
				type="number"
				min="0"
				step="100"
				bind:value={otherIncome}
				class="border border-input rounded-md px-2 py-1.5 text-sm w-36"
			/>
			<span class="text-xs text-muted-foreground">
				Salary, pension income, rent — everything but these dividends. Seeded from your profile;
				changing it here does not save it.
			</span>
		</div>
	</div>

	{#if result.count === 0}
		<p class="text-sm text-muted-foreground">
			No dividend holdings recorded yet. Add one above and the allowance and tax due will work out
			here.
		</p>
	{:else}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Sheltered</div>
				<div class="text-xs text-muted-foreground mb-1">
					{result.shelteredCount} holding{result.shelteredCount === 1 ? '' : 's'} in an ISA/SIPP
				</div>
				<div class="text-xl font-semibold">{formatMoney(result.shelteredIncome)}/yr</div>
				<div class="text-xs text-muted-foreground">no tax, no allowance used</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Taxable</div>
				<div class="text-xs text-muted-foreground mb-1">
					{result.taxableCount} holding{result.taxableCount === 1 ? '' : 's'} in a GIA or unwrapped
				</div>
				<div class="text-xl font-semibold">{formatMoney(result.taxableWrapperIncome)}/yr</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(result.breakdown.taxableDividendIncome)} of it after allowances
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Tax due</div>
				<div class="text-xs text-muted-foreground mb-1">
					{formatRate(result.effectiveRate)} of everything the portfolio pays
				</div>
				<div class="text-xl font-semibold">{formatMoney(result.totalTax)}/yr</div>
				<div class="text-xs text-muted-foreground">
					next dividend pound taxed at {formatRate(result.breakdown.marginalRate)}
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Net income</div>
				<div class="text-xs text-muted-foreground mb-1">sheltered and taxable together</div>
				<div class="text-xl font-semibold">{formatMoney(result.netIncome)}/yr</div>
				<div class="text-xs text-muted-foreground">{formatMoney(result.monthlyNetIncome)}/mo</div>
			</div>
		</div>

		<div class="rounded-md border border-border px-3 py-2 mb-4">
			<div class="text-sm font-medium mb-1">
				{formatMoney(DIVIDEND_ALLOWANCE)} dividend allowance
			</div>
			{#if result.taxableWrapperIncome === 0}
				<p class="text-sm text-muted-foreground">
					Nothing taxable yet — every holding is sheltered, so the allowance is untouched and all {formatMoney(
						DIVIDEND_ALLOWANCE
					)} of it is still there for anything you hold outside a wrapper.
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					{formatExact(result.breakdown.dividendAllowanceUsed)} used, {formatExact(
						result.breakdown.dividendAllowanceRemaining
					)} left.
					{#if result.breakdown.personalAllowance.usedByDividends > 0}
						Your personal allowance covered {formatExact(
							result.breakdown.personalAllowance.usedByDividends
						)} of these dividends first — it applies to your other income before dividends, and what is
						left over shelters dividends ahead of the {formatMoney(DIVIDEND_ALLOWANCE)} allowance.
					{/if}
					{#if headroom > 0}
						You could take {formatExact(headroom)} more in dividends outside a wrapper before any dividend
						tax is due.
					{/if}
				</p>
			{/if}
			{#if result.breakdown.personalAllowance.tapered}
				<p class="text-xs text-muted-foreground mt-1">
					Your personal allowance is tapered to {formatMoney(
						result.breakdown.personalAllowance.available
					)} because total income is over £100,000 — dividends count towards that total. The extra tax
					the lost allowance costs on your other income is on the Tax tab, not in the figures here.
				</p>
			{/if}
		</div>

		{#if result.taxableWrapperIncome > 0}
			<h3 class="text-sm font-semibold mb-1">Rate by rate</h3>
			<p class="text-xs text-muted-foreground mb-2">
				Dividends are taxed as the top slice of income, so the ranges below are measured on income
				after the personal allowance, with your other income already filling the bottom of the
				ladder. The {formatMoney(DIVIDEND_ALLOWANCE)} allowance is charged at 0% but still uses up band
				space, which is why it can push the pounds above it into the next rate.
			</p>
			<table class="w-full text-sm border-collapse mb-4">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Rate</th>
						<th class="py-2 px-2 font-medium text-right">Charged at</th>
						<th class="py-2 px-2 font-medium">Applies to</th>
						<th class="py-2 px-2 font-medium text-right">Your dividends here</th>
						<th class="py-2 pl-2 font-medium text-right">Tax</th>
					</tr>
				</thead>
				<tbody>
					<tr
						class="border-b border-border/60 {result.breakdown.personalAllowance.usedByDividends ===
						0
							? 'text-muted-foreground'
							: ''}"
					>
						<td class="py-2 pr-2">Personal allowance</td>
						<td class="py-2 px-2 text-right tabular-nums">0%</td>
						<td class="py-2 px-2 text-muted-foreground">whatever your other income left unused</td>
						<td class="py-2 px-2 text-right tabular-nums">
							{formatExact(result.breakdown.personalAllowance.usedByDividends)}
						</td>
						<td class="py-2 pl-2 text-right tabular-nums">{formatExact(0)}</td>
					</tr>
					<tr
						class="border-b border-border/60 {result.breakdown.dividendAllowanceUsed === 0
							? 'text-muted-foreground'
							: ''}"
					>
						<td class="py-2 pr-2">Dividend allowance</td>
						<td class="py-2 px-2 text-right tabular-nums">0%</td>
						<td class="py-2 px-2 text-muted-foreground">
							first {formatMoney(DIVIDEND_ALLOWANCE)} after the personal allowance
						</td>
						<td class="py-2 px-2 text-right tabular-nums">
							{formatExact(result.breakdown.dividendAllowanceUsed)}
						</td>
						<td class="py-2 pl-2 text-right tabular-nums">{formatExact(0)}</td>
					</tr>
					{#each result.breakdown.bands as band (band.id)}
						<tr
							class="border-b border-border/60 {band.amount === 0 ? 'text-muted-foreground' : ''}"
						>
							<td class="py-2 pr-2">{band.label}</td>
							<td class="py-2 px-2 text-right tabular-nums">{formatRate(band.rate)}</td>
							<td class="py-2 px-2 text-muted-foreground">{formatBandRange(band)}</td>
							<td class="py-2 px-2 text-right tabular-nums">{formatExact(band.amount)}</td>
							<td class="py-2 pl-2 text-right tabular-nums font-medium">{formatExact(band.tax)}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr class="border-t border-border font-medium">
						<td class="py-2 pr-2" colspan="3">Total taxable-wrapper dividends</td>
						<td class="py-2 px-2 text-right tabular-nums">
							{formatExact(result.taxableWrapperIncome)}
						</td>
						<td class="py-2 pl-2 text-right tabular-nums">{formatExact(result.totalTax)}</td>
					</tr>
				</tfoot>
			</table>
		{/if}

		<h3 class="text-sm font-semibold mb-1">Holding by holding</h3>
		<p class="text-xs text-muted-foreground mb-2">
			Dividend tax is charged on your total dividend income against one set of bands, so no single
			holding has a rate of its own — a second GIA holding can push the first one's income into a
			higher rate. Each taxable holding below carries its share of the total, in proportion to what
			it pays.
		</p>
		<table class="w-full text-sm border-collapse mb-3">
			<thead>
				<tr class="border-b border-border text-left">
					<th class="py-2 pr-2 font-medium">Holding</th>
					<th class="py-2 px-2 font-medium">Wrapper</th>
					<th class="py-2 px-2 font-medium text-right">Gross</th>
					<th class="py-2 px-2 font-medium text-right">Tax</th>
					<th class="py-2 pl-2 font-medium text-right">Net</th>
				</tr>
			</thead>
			<tbody>
				{#each result.holdings as holding (holding.id)}
					<tr class="border-b border-border/60">
						<td class="py-2 pr-2">{holding.name}</td>
						<td class="py-2 px-2 text-muted-foreground">
							{holding.wrapper === null ? 'Unwrapped' : WRAPPER_LABELS[holding.wrapper]}
							{#if holding.sheltered}<span class="text-xs">· sheltered</span>{/if}
						</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatExact(holding.grossIncome)}</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatExact(holding.tax)}</td>
						<td class="py-2 pl-2 text-right tabular-nums font-medium">
							{formatExact(holding.netIncome)}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="border-t border-border font-medium">
					<td class="py-2 pr-2" colspan="2">Total</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatExact(result.grossIncome)}</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatExact(result.totalTax)}</td>
					<td class="py-2 pl-2 text-right tabular-nums">{formatExact(result.netIncome)}</td>
				</tr>
			</tfoot>
		</table>

		{#if result.shelterSaving > 0}
			<p class="text-sm text-muted-foreground">
				Holding {formatMoney(result.shelteredIncome)}/yr of this income inside an ISA or SIPP saves {formatMoney(
					result.shelterSaving
				)} of tax this year — the same portfolio held entirely in a General Investment Account would cost
				{formatMoney(result.taxIfNothingSheltered)}.
			</p>
		{:else if result.shelteredIncome > 0}
			<p class="text-sm text-muted-foreground">
				The ISA/SIPP shelter is worth nothing this year: even with every holding in a General
				Investment Account, the whole {formatMoney(result.grossIncome)} would still fit inside your allowances.
				It starts paying for itself as the portfolio grows.
			</p>
		{:else if result.totalTax > 0}
			<p class="text-sm text-muted-foreground">
				Nothing here is sheltered. Moving these holdings into an ISA or SIPP — subject to the
				£20,000 annual ISA allowance — would remove the {formatMoney(result.totalTax)} of tax above entirely.
			</p>
		{/if}

		<p class="text-xs text-muted-foreground mt-3">
			Illustrative only, not financial advice. {DIVIDEND_TAX_YEAR} figures, on today's portfolio at today's
			yields — the projection below stays gross, since neither the allowance nor the rates can be assumed
			to hold for the decades it covers. Dividend tax is worked out here on its own: National Insurance
			is never charged on dividends, and the income tax on your other income is on the Tax tab.
		</p>
	{/if}
</Card>
