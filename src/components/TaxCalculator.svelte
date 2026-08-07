<script>
	/**
	 * UK income tax calculator — README.md → "UK Income Tax Calculator (2026/27)": the
	 * England/Wales/NI and Scotland bands, the band-by-band take-home calculation, and the 60%
	 * personal allowance taper (issue #23).
	 *
	 * A salary and a region drive `$lib/tax.js`, which answers the three things the spec asks for:
	 * how much tax is due, where each pound of it was charged, and what is left. The band table is
	 * the point of the tab — a single "you pay £X" figure hides the thing people actually want to
	 * see, which is the ladder their salary climbs and where the next raise would land on it.
	 *
	 * The salary and region are seeded from `profile.gross_salary`/`profile.tax_region` where the
	 * profile has them, then owned by the user for this page session only — nothing is written back,
	 * the same convention the forecast and retirement tabs' controls follow.
	 *
	 * "Take-home" here is gross less *income tax* only. National Insurance is not modelled (it
	 * appears nowhere in README.md's spec and has no issue in the tax milestone), and student loans
	 * (#26), salary sacrifice (#27) and Marriage Allowance (#25) are their own issues — so every
	 * figure is labelled for what it is rather than presented as net pay.
	 *
	 * The High Income Child Benefit Charge (#24) is rendered here as a second card rather than on the
	 * page beside this one, because it is assessed on the *same* adjusted net income: giving it its
	 * own salary field would let the tab hold two answers to one question. `ChildBenefitCharge`
	 * therefore takes the income and region as props and owns only what `tax.js` cannot know — how
	 * many children are claimed for, whether the payments are taken, and what a partner earns.
	 */
	import { TAX_REGION_LABELS, TAX_REGIONS } from '$lib/enums.js';
	import { createProfile } from '$lib/model.js';
	import {
		ALLOWANCE_EXHAUSTED_AT,
		ALLOWANCE_TAPER_THRESHOLD,
		compareRegions,
		PERSONAL_ALLOWANCE,
		TAX_YEAR,
		takeHomeBreakdown
	} from '$lib/tax.js';
	import Card from './ui/card.svelte';
	import ChildBenefitCharge from './ChildBenefitCharge.svelte';

	/** @type {{ profile?: import('$lib/types.js').Profile }} */
	let { profile = createProfile() } = $props();

	// Slider bounds are a UI convenience, not spec. `tax.js` copes with any income; this is only
	// where the drag handle lives, and it reaches past the £125,140 top-rate threshold on purpose.
	const INCOME_SLIDER_MAX = 200_000;

	/** A salary to open on when the profile has none, rather than an empty tab showing zeroes. */
	const FALLBACK_SALARY = 50_000;

	// svelte-ignore state_referenced_locally
	let income = $state(profile.gross_salary > 0 ? profile.gross_salary : FALLBACK_SALARY);
	// svelte-ignore state_referenced_locally
	let region = $state(profile.tax_region);

	/**
	 * `bind:value` on a number input hands back a number, or `null` once the field is cleared.
	 *
	 * @param {unknown} value
	 * @param {number} fallback
	 * @returns {number}
	 */
	function parse(value, fallback) {
		if (value === null || value === undefined || value === '') return fallback;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	const parsedIncome = $derived(parse(income, Number.NaN));
	const incomeIsValid = $derived(parsedIncome >= 0 && parsedIncome <= 1e9);

	const result = $derived(
		incomeIsValid ? takeHomeBreakdown({ income: parsedIncome, region }) : null
	);
	const comparison = $derived(incomeIsValid ? compareRegions(parsedIncome) : null);
	const otherRegion = $derived(region === 'scotland' ? 'england_wales_ni' : 'scotland');

	/**
	 * Scottish tax less English/Welsh/NI tax, signed so that a positive number always means "the
	 * region you are *not* in charges less". Reading it off `compareRegions` rather than recomputing
	 * keeps the sentence and the table on the same figures.
	 */
	const differenceHere = $derived(
		comparison === null ? 0 : region === 'scotland' ? comparison.difference : -comparison.difference
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

	/** @param {number} rate @returns {string} e.g. "20%", "67.5%" */
	function formatRate(rate) {
		return `${Math.round(rate * 100) / 100}%`;
	}

	/**
	 * A band's slice of taxable income, as a range — the numbers `tax.js` stores, which are pounds
	 * *after* the allowance, not gross salary.
	 *
	 * @param {import('$lib/tax.js').TaxBandSlice} slice
	 * @returns {string}
	 */
	function formatBandRange(slice) {
		const from = formatMoney(slice.from);
		return slice.to === null ? `over ${from}` : `${from} – ${formatMoney(slice.to)}`;
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Income tax &amp; take-home, {TAX_YEAR}</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Your salary climbs a ladder of bands, and each band taxes only the slice of income that lands
		inside it — so a raise into the higher rate never taxes the pounds below it any harder. Scotland
		sets its own rates and bands; the personal allowance is UK-wide.
	</p>

	<div class="flex flex-wrap items-end gap-4 mb-4">
		<div class="flex flex-col gap-1">
			<span id="tax-income-label" class="text-sm font-medium">Gross annual income (£)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="tax-income-label"
					min="0"
					max={INCOME_SLIDER_MAX}
					step="500"
					bind:value={income}
					class="w-40 accent-black"
				/>
				<input
					id="tax-income"
					type="number"
					aria-labelledby="tax-income-label"
					min="0"
					step="500"
					bind:value={income}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="tax-region">Where you live</label>
			<select
				id="tax-region"
				bind:value={region}
				class="border border-input rounded-md px-2 py-1.5 text-sm"
			>
				{#each TAX_REGIONS as value (value)}
					<option {value}>{TAX_REGION_LABELS[value]}</option>
				{/each}
			</select>
		</div>
	</div>

	{#if !incomeIsValid}
		<p class="text-sm text-red-600 mb-4">Enter a gross income of £0 or more.</p>
	{:else if result}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Income tax</div>
				<div class="text-xs text-muted-foreground mb-1">
					on {formatMoney(result.taxableIncome)} of taxable income
				</div>
				<div class="text-xl font-semibold">{formatMoney(result.totalTax)}</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(result.monthlyTax)} a month
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">After income tax</div>
				<div class="text-xs text-muted-foreground mb-1">before NI and any student loan</div>
				<div class="text-xl font-semibold">{formatMoney(result.takeHome)}</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(result.monthlyTakeHome)} a month, {formatMoney(result.weeklyTakeHome)} a week
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Effective rate</div>
				<div class="text-xs text-muted-foreground mb-1">tax over your whole income</div>
				<div class="text-xl font-semibold">{formatRate(result.effectiveRate)}</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(result.allowance.available) === formatMoney(PERSONAL_ALLOWANCE)
						? 'full personal allowance'
						: `${formatMoney(result.allowance.available)} allowance left`}
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Marginal rate</div>
				<div class="text-xs text-muted-foreground mb-1">on your next pound</div>
				<div class="text-xl font-semibold">{formatRate(result.marginalRate)}</div>
				<div class="text-xs text-muted-foreground">
					{result.allowance.inTaperBand ? 'the allowance taper band' : 'the band you are in'}
				</div>
			</div>
		</div>

		<h3 class="text-sm font-semibold mb-1">Band by band</h3>
		<p class="text-xs text-muted-foreground mb-2">
			Bands are measured on income <em>after</em> the personal allowance, which is how HMRC publishes
			them — so the first row below is the allowance itself, and every band range after it starts counting
			from zero again once the allowance has been taken off.
		</p>
		<table class="w-full text-sm border-collapse mb-3">
			<thead>
				<tr class="border-b border-border text-left">
					<th class="py-2 pr-2 font-medium">Band</th>
					<th class="py-2 px-2 font-medium text-right">Rate</th>
					<th class="py-2 px-2 font-medium">Applies to</th>
					<th class="py-2 px-2 font-medium text-right">Your income here</th>
					<th class="py-2 pl-2 font-medium text-right">Tax</th>
				</tr>
			</thead>
			<tbody>
				<tr
					class="border-b border-border/60 {result.allowance.used === 0
						? 'text-muted-foreground'
						: ''}"
				>
					<td class="py-2 pr-2">Personal allowance</td>
					<td class="py-2 px-2 text-right tabular-nums">0%</td>
					<td class="py-2 px-2 text-muted-foreground">
						{result.allowance.available === 0
							? 'none left'
							: `first ${formatMoney(result.allowance.available)}`}
						{#if result.allowance.tapered}
							<span class="text-xs">(tapered from {formatMoney(PERSONAL_ALLOWANCE)})</span>
						{/if}
					</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatExact(result.allowance.used)}</td>
					<td class="py-2 pl-2 text-right tabular-nums">{formatExact(0)}</td>
				</tr>
				{#each result.bands as band (band.id)}
					<tr class="border-b border-border/60 {band.amount === 0 ? 'text-muted-foreground' : ''}">
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
					<td class="py-2 pr-2" colspan="3">Total</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatExact(result.income)}</td>
					<td class="py-2 pl-2 text-right tabular-nums">{formatExact(result.totalTax)}</td>
				</tr>
			</tfoot>
		</table>

		{#if result.allowance.inTaperBand}
			<p class="text-sm mb-3">
				<span class="font-medium">You're inside the {formatRate(result.marginalRate)} band.</span>
				Between {formatMoney(ALLOWANCE_TAPER_THRESHOLD)} and {formatMoney(ALLOWANCE_EXHAUSTED_AT)} every
				extra £1 of income also costs you 50p of personal allowance, and that 50p is then taxed too —
				so the next pound is charged at half as much again as the headline rate. Your allowance is down
				to {formatMoney(result.allowance.available)}, from {formatMoney(PERSONAL_ALLOWANCE)}.
			</p>
		{:else if result.allowance.tapered}
			<p class="text-sm mb-3">
				<span class="font-medium">Your personal allowance has gone entirely.</span>
				It tapers away between {formatMoney(ALLOWANCE_TAPER_THRESHOLD)} and {formatMoney(
					ALLOWANCE_EXHAUSTED_AT
				)}, which is why the top band starts where it does — every pound you earn is now taxable.
			</p>
		{/if}

		{#if comparison}
			<p class="text-sm text-muted-foreground mb-3">
				{#if differenceHere === 0}
					On {formatMoney(result.income)} you'd pay exactly the same tax in {TAX_REGION_LABELS[
						otherRegion
					]}.
				{:else if differenceHere > 0}
					On {formatMoney(result.income)} you'd pay
					<span class="font-medium text-foreground">{formatExact(differenceHere)} less</span>
					a year in {TAX_REGION_LABELS[otherRegion]}.
				{:else}
					On {formatMoney(result.income)} you'd pay
					<span class="font-medium text-foreground">{formatExact(-differenceHere)} more</span>
					a year in {TAX_REGION_LABELS[otherRegion]}.
				{/if}
			</p>
		{/if}

		<p class="text-xs text-muted-foreground">
			Illustrative only, not financial advice. {TAX_YEAR} figures, from HMRC's published rates and allowances.
			This is income tax on earnings alone: National Insurance is not deducted, and neither are student
			loan repayments (#26), salary sacrifice or pension contributions (#27) — so "after income tax" is
			not your net pay. The High Income Child Benefit Charge is in the card below; Marriage Allowance
			(#25), savings and dividend income each land on their own issues. Enter income already net of any
			salary sacrifice if you want the allowance taper assessed correctly.
		</p>
	{/if}
</Card>

{#if incomeIsValid}
	<ChildBenefitCharge income={parsedIncome} {region} />
{/if}
