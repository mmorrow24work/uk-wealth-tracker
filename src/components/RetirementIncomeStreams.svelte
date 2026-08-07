<script>
	/**
	 * Retirement income stream builder — README.md → "Pension Tracker": "Retirement income stream
	 * builder: DB, annuity, SIPP drawdown, ISA withdrawals, GIA dividends, State Pension" (issue #33).
	 *
	 * Every card above this one answers a question about one pot. This is the card those pots exist
	 * for: what the whole recorded position would pay if it were drawn today, where each pound of it
	 * comes from, what HMRC takes, and whether what is left covers the income the user said they
	 * wanted.
	 *
	 * It reads `pensions`, the latest monthly snapshot's holdings, `dividends` and `profile` without
	 * binding — nothing here writes to the data model. The controls are deliberately component-local
	 * for the same reason `DefinedBenefitIncome`'s projection controls are: "I would annuitise a third
	 * of my pot at 6.5%" is a question being asked, not a fact about a pension, and `AppData` has no
	 * field to put it in.
	 *
	 * All the arithmetic is `$lib/retirement-income.js`'s; this file formats it.
	 */
	import { createProfile } from '$lib/model.js';
	import {
		DEFAULT_ANNUITY_RATE,
		PENSION_TAX_FREE_SHARE,
		RETIREMENT_INCOME_SOURCE_LABELS,
		RETIREMENT_INCOME_TAX_TREATMENT_LABELS,
		retirementIncomeSummary
	} from '$lib/retirement-income.js';
	import { MAX_QUALIFYING_YEARS, QUALIFYING_YEARS_FOR_FULL } from '$lib/state-pension.js';
	import { TAX_YEAR } from '$lib/tax.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 *   pensions?: import('$lib/types.js').Pension[],
	 *   monthlyEntries?: import('$lib/types.js').MonthlyEntry[],
	 *   dividends?: import('$lib/types.js').Dividend[],
	 *   profile?: import('$lib/types.js').Profile,
	 *   now?: Date
	 * }}
	 */
	let {
		pensions = [],
		monthlyEntries = [],
		dividends = [],
		profile = createProfile(),
		now = new Date()
	} = $props();

	let withdrawalRate = $state('4');
	let annuitisedShare = $state('0');
	let annuityRate = $state(String(DEFAULT_ANNUITY_RATE));
	let includeStatePension = $state(true);
	/** Blank means "use the NI record"; a typed count overrides it — the module's own `null`. */
	let statePensionYears = $state('');

	const summary = $derived(
		retirementIncomeSummary(
			{ pensions, monthlyEntries, dividends, profile },
			{
				withdrawalRate: Number(withdrawalRate) || 0,
				annuitisedShare: Number(annuitisedShare) || 0,
				annuityRate: Number(annuityRate) || 0,
				includeStatePension,
				statePensionYears: statePensionYears.trim() === '' ? null : Number(statePensionYears) || 0
			},
			{ now }
		)
	);

	/** Whether there is anything at all to show, or only the six empty rows. */
	const empty = $derived(summary.annualIncome === 0 && summary.totalCapital === 0);

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} rate @returns {string} e.g. "4%", "6.5%" */
	function formatRate(rate) {
		return `${Math.round(rate * 100) / 100}%`;
	}

	/** @param {number} share A fraction, `0`–`1`. @returns {string} e.g. "34%" */
	function formatShare(share) {
		return `${Math.round(share * 100)}%`;
	}

	/**
	 * The middle column: what the stream is a rate on, where it is one at all.
	 *
	 * @param {import('$lib/retirement-income.js').RetirementIncomeStream} entry
	 * @returns {string}
	 */
	function derivation(entry) {
		if (entry.id === 'db') {
			return entry.sourceCount === 0
				? 'no Defined Benefit scheme recorded'
				: `${entry.sourceCount} scheme${entry.sourceCount === 1 ? '' : 's'}, as promised`;
		}
		if (entry.id === 'state_pension') {
			if (!includeStatePension) return 'not counted in this plan';
			return summary.statePensionYears === 0
				? 'no National Insurance years recorded'
				: `${summary.statePensionYears} qualifying years of ${QUALIFYING_YEARS_FOR_FULL}`;
		}
		if (entry.capital === 0) return 'nothing recorded';
		if (entry.rate === null) return formatMoney(entry.capital);
		return `${formatMoney(entry.capital)} at ${formatRate(entry.rate)}`;
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Retirement income streams</h2>
	<p class="text-sm text-muted-foreground mb-4">
		What every pot you have recorded would pay if you drew on it today, stream by stream — a Defined
		Benefit pension and the State Pension as they are promised, and the rest as a rate applied to a
		pot. It is a position, not a projection: nothing is grown forward to a retirement date, and no
		stream is switched on or off by age.
	</p>

	<div class="flex flex-wrap items-end gap-3 mb-4">
		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="retirement-income-withdrawal-rate">
				Withdrawal rate (%)
			</label>
			<input
				id="retirement-income-withdrawal-rate"
				type="number"
				min="0.1"
				max="100"
				step="0.1"
				bind:value={withdrawalRate}
				class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
			/>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="retirement-income-annuitised-share">
				Annuitised (%)
			</label>
			<input
				id="retirement-income-annuitised-share"
				type="number"
				min="0"
				max="100"
				step="1"
				bind:value={annuitisedShare}
				class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
			/>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="retirement-income-annuity-rate">
				Annuity rate (%)
			</label>
			<input
				id="retirement-income-annuity-rate"
				type="number"
				min="0.1"
				max="100"
				step="0.1"
				bind:value={annuityRate}
				class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
			/>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="retirement-income-ni-years">NI years</label>
			<input
				id="retirement-income-ni-years"
				type="number"
				min="0"
				max={MAX_QUALIFYING_YEARS}
				step="1"
				bind:value={statePensionYears}
				placeholder={String(summary.statePensionYears)}
				class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
			/>
		</div>

		<label class="flex items-center gap-2 text-sm font-medium pb-1.5">
			<input type="checkbox" bind:checked={includeStatePension} class="size-4" />
			Count the State Pension
		</label>
	</div>

	{#if empty}
		<p class="text-sm">
			Nothing to build an income out of yet. Add a pension pot above, record a monthly snapshot with
			an ISA holding in it, or add a holding to the dividend planner, and each one will show up here
			as its own stream.
		</p>
	{:else}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-52 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Gross income</div>
				<div class="text-xs text-muted-foreground mb-1">
					before {TAX_YEAR} tax, across {summary.streams.filter((entry) => entry.present).length} stream{summary.streams.filter(
						(entry) => entry.present
					).length === 1
						? ''
						: 's'}
				</div>
				<div class="text-xl font-semibold">{formatMoney(summary.annualIncome)}/yr</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(summary.monthlyIncome)} a month
				</div>
			</div>

			<div class="flex-1 min-w-52 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">After tax</div>
				<div class="text-xs text-muted-foreground mb-1">
					{formatMoney(summary.totalTax)} of tax · {formatRate(summary.effectiveTaxRate)} of the total
				</div>
				<div class="text-xl font-semibold">{formatMoney(summary.netAnnualIncome)}/yr</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(summary.netMonthlyIncome)} a month
				</div>
			</div>

			<div class="flex-1 min-w-52 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Against your target</div>
				<div class="text-xs text-muted-foreground mb-1">
					{summary.targetIncome === 0
						? 'no retirement target set'
						: `${formatMoney(summary.targetIncome)} a year wanted`}
				</div>
				<div class="text-xl font-semibold {summary.coversTarget ? '' : 'text-amber-700'}">
					{summary.targetIncome === 0 ? '—' : formatShare(summary.targetShare)}
				</div>
				<div class="text-xs text-muted-foreground">
					{#if summary.targetIncome === 0}
						set one on the forecast tab
					{:else if summary.coversTarget}
						{formatMoney(summary.targetSurplus)} a year clear
					{:else}
						{formatMoney(summary.targetGap)} a year short
					{/if}
				</div>
			</div>
		</div>

		<h3 class="text-sm font-semibold mb-2">Stream by stream</h3>
		<table class="w-full text-sm border-collapse mb-4">
			<thead>
				<tr class="border-b border-border text-left">
					<th class="py-2 pr-2 font-medium">Stream</th>
					<th class="py-2 px-2 font-medium">Worked out as</th>
					<th class="py-2 px-2 font-medium text-right">Per year</th>
					<th class="py-2 px-2 font-medium text-right">Per month</th>
					<th class="py-2 pl-2 font-medium text-right">Share</th>
				</tr>
			</thead>
			<tbody>
				{#each summary.streams as entry (entry.id)}
					<tr class="border-b border-border/60 {entry.present ? '' : 'text-muted-foreground'}">
						<td class="py-2 pr-2">
							<div class="font-medium">{entry.label}</div>
							<div class="text-xs text-muted-foreground">
								{RETIREMENT_INCOME_SOURCE_LABELS[entry.source]} ·
								{RETIREMENT_INCOME_TAX_TREATMENT_LABELS[entry.taxTreatment]}
							</div>
						</td>
						<td class="py-2 px-2">
							{derivation(entry)}
							{#if entry.present && entry.taxFreeIncome > 0 && entry.taxableIncome > 0}
								<div class="text-xs text-muted-foreground">
									{formatMoney(entry.taxFreeIncome)} of it tax-free
								</div>
							{/if}
						</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatMoney(entry.annualIncome)}</td>
						<td class="py-2 px-2 text-right tabular-nums font-medium">
							{formatMoney(entry.monthlyIncome)}
						</td>
						<td class="py-2 pl-2 text-right tabular-nums">{formatShare(entry.share)}</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="border-t border-border font-medium">
					<td class="py-2 pr-2" colspan="2">Gross total</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatMoney(summary.annualIncome)}</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatMoney(summary.monthlyIncome)}</td>
					<td class="py-2 pl-2 text-right tabular-nums">100%</td>
				</tr>
			</tfoot>
		</table>

		<h3 class="text-sm font-semibold mb-1">What the taxman takes</h3>
		<p class="text-sm mb-3">
			{formatMoney(summary.taxFreeIncome)} of this arrives tax-free — ISA withdrawals in full, plus the
			{PENSION_TAX_FREE_SHARE}% tax-free quarter of everything drawn from a pension pot.
			{#if summary.earnedIncome > 0}
				{formatMoney(summary.earnedIncome)} is taxed as earned income against
				{formatMoney(summary.tax.personalAllowance)} of personal allowance, costing
				{formatMoney(summary.tax.incomeTax)}.
			{/if}
			{#if summary.dividendIncome > 0}
				{formatMoney(summary.dividendIncome)} of GIA dividends meets the dividend rates after
				{formatMoney(summary.tax.dividendAllowanceUsed)} of the dividend allowance, costing
				{formatMoney(summary.tax.dividendTax)}.
			{/if}
			{#if summary.tax.allowanceTapered}
				<span class="text-amber-700">
					An income this size is past £100,000, so the personal allowance is tapered — the two taxed
					halves share what is left of it, earned income first.
				</span>
			{/if}
		</p>

		{#if summary.promisedCapitalEquivalent > 0}
			<p class="text-sm mb-3">
				{formatMoney(summary.totalCapital)} of pots sits behind the streams that are drawn on. The Defined
				Benefit and State Pension income on top is promised rather than held — buying it with a pot at
				{formatRate(summary.input.withdrawalRate)} would take a further
				{formatMoney(summary.promisedCapitalEquivalent)}, which is a comparison and not money anyone
				has.
			</p>
		{/if}

		{#if summary.uncounted.length > 0}
			<h3 class="text-sm font-semibold mb-1">Not counted here</h3>
			<ul class="text-sm mb-3 flex flex-col gap-1">
				{#each summary.uncounted as slice (slice.id)}
					<li>
						<span class="font-medium">{slice.label} — {formatMoney(slice.value)}:</span>
						{slice.reason}.
					</li>
				{/each}
			</ul>
		{/if}
	{/if}

	<p class="text-xs text-muted-foreground">
		Illustrative only, not financial advice. Every figure is today's pots at today's values, in
		today's money — nothing is grown to a retirement date, and no allowance is made for inflation.
		Nothing here models <span class="font-medium">when</span> each stream starts: the State Pension
		age above is reported, not applied, and the minimum pension age, a Defined Benefit scheme's
		normal pension age and the reduction for drawing early are not modelled at all. An annuity rate
		here is an assumption, not a quote — a real one depends on your age, your health, gilt yields
		and whether the income escalates or covers a spouse. A withdrawal rate is a rate, not a promise:
		see the retirement tab for how long a pot actually lasts at one. Tax is {TAX_YEAR} income tax and
		dividend tax on the streams above and nothing else — no National Insurance is due on pension income,
		but nor is the lump sum allowance, the Money Purchase Annual Allowance or any other income you may
		have modelled here.
	</p>
</Card>
