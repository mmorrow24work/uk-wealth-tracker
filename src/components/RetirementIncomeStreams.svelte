<script>
	/**
	 * The retirement income stream builder — README.md → "Pension Tracker": "Retirement income stream
	 * builder: DB, annuity, SIPP drawdown, ISA withdrawals, GIA dividends, State Pension" (issue #33).
	 *
	 * `PensionTracker` records the pots and `DefinedBenefitIncome` prices the promises; this is the
	 * card that answers what they all pay *together*, and the three things no single pot can say: what
	 * arrives each month once income tax is off, which streams it arrives from, and how much of the
	 * income you said you wanted that covers.
	 *
	 * It reads `pensions`, `monthlyEntries`, `dividends` and `profile` without binding — nothing here
	 * writes to the data model. The controls are deliberately component-local: "I would annuitise a
	 * third of the pot at 6%" is a plan being sketched, not a fact about a pension, and `AppData` has
	 * no field to put it in. The NI years box is the same, with one twist — leaving it empty means "use
	 * the qualifying years recorded against a pension", so it stops being an override the moment the
	 * State Pension projection (#31) gives those years a home of their own.
	 *
	 * All the arithmetic is `$lib/retirement-income.js`'s; this file formats it and states the
	 * assumptions on screen.
	 */
	import {
		DEFAULT_ANNUITY_RATE,
		MAX_ANNUITY_RATE,
		MIN_ANNUITY_RATE,
		RETIREMENT_INCOME_SOURCE_LABELS,
		RETIREMENT_INCOME_TAX_TREATMENT_LABELS,
		STATE_PENSION_FULL_YEARS,
		retirementIncomeSummary,
		statePensionYears
	} from '$lib/retirement-income.js';
	import { DEFAULT_WITHDRAWAL_RATE, MAX_WITHDRAWAL_RATE, MIN_WITHDRAWAL_RATE } from '$lib/fire.js';
	import { TAX_REGION_LABELS } from '$lib/enums.js';
	import { TAX_YEAR } from '$lib/tax.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 *   pensions?: import('$lib/types.js').Pension[],
	 *   monthlyEntries?: import('$lib/types.js').MonthlyEntry[],
	 *   dividends?: import('$lib/types.js').Dividend[],
	 *   profile?: Partial<import('$lib/types.js').Profile>
	 * }}
	 */
	let { pensions = [], monthlyEntries = [], dividends = [], profile = {} } = $props();

	/** Slider bounds are a UI convenience, not spec: `retirement-income.js` does the real clamping. */
	const WITHDRAWAL_SLIDER_MAX = 10;
	const ANNUITY_SLIDER_MAX = 12;

	let withdrawalRate = $state(DEFAULT_WITHDRAWAL_RATE);
	let annuityRate = $state(DEFAULT_ANNUITY_RATE);
	let annuitisedShare = $state(0);
	let includeStatePension = $state(true);
	/** Empty means "use the NI years recorded against a pension" — see the header. */
	let niYears = $state('');

	/**
	 * A number input bound with `bind:value` carries a number, but it carries `null` the moment the box
	 * is cleared — and `Number(null)` is `0`, which would read as a deliberate 0% rather than as a box
	 * mid-edit. So an empty box falls back to the default instead of to zero.
	 *
	 * @param {unknown} value
	 * @param {number} fallback
	 * @returns {number}
	 */
	function entered(value, fallback) {
		if (value === '' || value === null || value === undefined) return fallback;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	const recordedYears = $derived(statePensionYears(pensions));

	/** `null` — "use whatever the pension records say" — until a number is actually typed. */
	const enteredYears = $derived(
		niYears === '' || niYears === null || niYears === undefined ? null : entered(niYears, 0)
	);

	const summary = $derived(
		retirementIncomeSummary(
			{ pensions, monthlyEntries, dividends, profile },
			{
				withdrawalRate: entered(withdrawalRate, DEFAULT_WITHDRAWAL_RATE),
				annuityRate: entered(annuityRate, DEFAULT_ANNUITY_RATE),
				annuitisedShare: entered(annuitisedShare, 0),
				includeStatePension,
				statePensionYears: enteredYears
			}
		)
	);

	/** Nothing to add up: no pot, no promise, no dividend anywhere in the document. */
	const empty = $derived(
		summary.annualIncome === 0 && summary.totalCapital === 0 && !summary.statePensionRecorded
	);

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} rate @returns {string} e.g. "4%", "3.5%" */
	function formatRate(rate) {
		return `${Math.round(rate * 100) / 100}%`;
	}

	/** @param {number} share A fraction, `0.25` → "25%". */
	function formatShare(share) {
		return `${Math.round(share * 100)}%`;
	}

	/**
	 * Where a stream's money comes from, in one line — the pot and the rate applied to it, or what is
	 * missing when there is nothing behind it yet.
	 *
	 * @param {import('$lib/retirement-income.js').RetirementIncomeStream} stream
	 * @returns {string}
	 */
	function basis(stream) {
		switch (stream.id) {
			case 'db':
				return stream.present
					? `${stream.sourceCount} scheme${stream.sourceCount === 1 ? '' : 's'}, paid for life`
					: 'No Defined Benefit scheme costed yet';
			case 'annuity':
				return stream.capital === 0
					? 'Nothing annuitised — move the slider to buy an income for life'
					: `${formatMoney(stream.capital)} handed over at ${formatRate(
							/** @type {number} */ (stream.rate)
						)}`;
			case 'sipp_drawdown':
				return stream.capital === 0
					? 'No DC workplace pension or SIPP pot recorded'
					: `${formatMoney(stream.capital)} drawn at ${formatRate(
							/** @type {number} */ (stream.rate)
						)}`;
			case 'isa_withdrawal':
				return stream.capital === 0
					? 'No ISA holdings in your latest snapshot'
					: `${formatMoney(stream.capital)} drawn at ${formatRate(
							/** @type {number} */ (stream.rate)
						)}`;
			case 'gia_dividends':
				return stream.capital === 0
					? 'No unwrapped holdings in the dividend planner'
					: `${formatMoney(stream.capital)} yielding ${formatRate(
							/** @type {number} */ (stream.rate)
						)}`;
			case 'state_pension':
				if (!includeStatePension) return 'Left out of this plan';
				if (!summary.statePensionRecorded && enteredYears === null) {
					return 'No NI record yet — enter your qualifying years above';
				}
				return `${summary.statePensionYears} of ${STATE_PENSION_FULL_YEARS} qualifying NI years`;
			default:
				return '';
		}
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Retirement income streams</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Every pot and promise you have recorded, drawn at once: a Defined Benefit pension, an annuity,
		SIPP drawdown, ISA withdrawals, dividends from unwrapped holdings and the State Pension. Gross
		figures in today's money, income tax taken off at the end — this is the position as things stand
		now, not a projection to your retirement date.
	</p>

	{#if empty}
		<p class="text-sm">
			Nothing to draw on yet. Add a pension pot above, record a monthly snapshot with an ISA holding
			in it, or add an unwrapped holding to the dividend planner, and it will show up here.
		</p>
	{:else}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Gross income</div>
				<div class="text-xs text-muted-foreground mb-1">before any tax</div>
				<div class="text-xl font-semibold">{formatMoney(summary.annualIncome)}/yr</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(summary.monthlyIncome)} a month
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">After income tax</div>
				<div class="text-xs text-muted-foreground mb-1">
					{formatMoney(summary.incomeTax)} a year, {formatRate(summary.effectiveTaxRate)} of the total
				</div>
				<div class="text-xl font-semibold">{formatMoney(summary.netAnnualIncome)}/yr</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(summary.netMonthlyIncome)} a month
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Against your target</div>
				<div class="text-xs text-muted-foreground mb-1">
					{summary.targetIncome === 0
						? 'no target income set on your profile'
						: `${formatMoney(summary.targetIncome)} a year wanted`}
				</div>
				<div class="text-xl font-semibold">
					{summary.targetIncome === 0 ? '—' : formatShare(summary.targetShare)}
				</div>
				<div class="text-xs text-muted-foreground">
					{#if summary.targetIncome === 0}
						set one on the forecast tab to measure against
					{:else if summary.coversTarget}
						{formatMoney(summary.targetSurplus)} a year clear
					{:else}
						{formatMoney(summary.targetGap)} a year short
					{/if}
				</div>
			</div>
		</div>

		<div class="mb-4 rounded-md border border-border bg-muted/40 p-3">
			<p class="text-sm text-muted-foreground mb-3">
				How you would take it. The withdrawal rate applies to both the drawdown pot and the ISA;
				anything you annuitise leaves the drawdown pot and buys an income for life instead.
			</p>
			<div class="flex flex-wrap items-end gap-4">
				<div class="flex flex-col gap-1">
					<span id="income-withdrawal-label" class="text-sm font-medium">Withdrawal rate (%)</span>
					<div class="flex items-center gap-2">
						<input
							type="range"
							aria-labelledby="income-withdrawal-label"
							min={MIN_WITHDRAWAL_RATE}
							max={WITHDRAWAL_SLIDER_MAX}
							step="0.1"
							bind:value={withdrawalRate}
							class="w-32 accent-black"
						/>
						<input
							id="income-withdrawal"
							type="number"
							aria-labelledby="income-withdrawal-label"
							min={MIN_WITHDRAWAL_RATE}
							max={MAX_WITHDRAWAL_RATE}
							step="0.1"
							bind:value={withdrawalRate}
							class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
						/>
					</div>
				</div>

				<div class="flex flex-col gap-1">
					<span id="income-annuitised-label" class="text-sm font-medium">Pot annuitised (%)</span>
					<div class="flex items-center gap-2">
						<input
							type="range"
							aria-labelledby="income-annuitised-label"
							min="0"
							max="100"
							step="5"
							bind:value={annuitisedShare}
							class="w-32 accent-black"
						/>
						<input
							id="income-annuitised"
							type="number"
							aria-labelledby="income-annuitised-label"
							min="0"
							max="100"
							step="5"
							bind:value={annuitisedShare}
							class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
						/>
					</div>
				</div>

				<div class="flex flex-col gap-1">
					<span id="income-annuity-rate-label" class="text-sm font-medium">Annuity rate (%)</span>
					<div class="flex items-center gap-2">
						<input
							type="range"
							aria-labelledby="income-annuity-rate-label"
							min={MIN_ANNUITY_RATE}
							max={ANNUITY_SLIDER_MAX}
							step="0.1"
							bind:value={annuityRate}
							class="w-32 accent-black"
						/>
						<input
							id="income-annuity-rate"
							type="number"
							aria-labelledby="income-annuity-rate-label"
							min={MIN_ANNUITY_RATE}
							max={MAX_ANNUITY_RATE}
							step="0.1"
							bind:value={annuityRate}
							class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
						/>
					</div>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="income-ni-years">NI years</label>
					<input
						id="income-ni-years"
						type="number"
						min="0"
						max="60"
						step="1"
						placeholder={recordedYears === null ? 'not recorded' : String(recordedYears)}
						bind:value={niYears}
						disabled={!includeStatePension}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-28 disabled:opacity-50"
					/>
				</div>

				<label class="flex items-center gap-2 text-sm font-medium pb-1.5">
					<input type="checkbox" bind:checked={includeStatePension} class="accent-black" />
					Include the State Pension
				</label>
			</div>
		</div>

		<h3 class="text-sm font-semibold mb-2">Stream by stream</h3>
		<table class="w-full text-sm border-collapse mb-2">
			<thead>
				<tr class="border-b border-border text-left">
					<th class="py-2 pr-2 font-medium">Stream</th>
					<th class="py-2 px-2 font-medium">Where it comes from</th>
					<th class="py-2 px-2 font-medium">Tax</th>
					<th class="py-2 px-2 font-medium text-right">Per year</th>
					<th class="py-2 pl-2 font-medium text-right">Per month</th>
				</tr>
			</thead>
			<tbody>
				{#each summary.streams as stream (stream.id)}
					<tr class="border-b border-border/60 {stream.present ? '' : 'text-muted-foreground'}">
						<td class="py-2 pr-2">
							<div class="font-medium">{stream.label}</div>
							<div class="text-xs text-muted-foreground">
								{RETIREMENT_INCOME_SOURCE_LABELS[stream.source]}
							</div>
						</td>
						<td class="py-2 px-2">
							{basis(stream)}
							{#if stream.present}
								<div class="mt-1 h-1.5 w-full max-w-32 rounded bg-muted" aria-hidden="true">
									<div
										class="h-1.5 rounded bg-foreground/70"
										style="width: {Math.max(2, stream.share * 100)}%"
									></div>
								</div>
								<div class="text-xs text-muted-foreground">
									{formatShare(stream.share)} of the total
								</div>
							{/if}
						</td>
						<td class="py-2 px-2">
							{RETIREMENT_INCOME_TAX_TREATMENT_LABELS[stream.taxTreatment]}
							{#if stream.taxFreeIncome > 0 && stream.taxableIncome > 0}
								<div class="text-xs text-muted-foreground">
									{formatMoney(stream.taxFreeIncome)} of it tax-free
								</div>
							{/if}
						</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatMoney(stream.annualIncome)}</td>
						<td class="py-2 pl-2 text-right tabular-nums font-medium">
							{formatMoney(stream.monthlyIncome)}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="border-t border-border font-medium">
					<td class="py-2 pr-2" colspan="3">Total, gross</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatMoney(summary.annualIncome)}</td>
					<td class="py-2 pl-2 text-right tabular-nums">{formatMoney(summary.monthlyIncome)}</td>
				</tr>
			</tfoot>
		</table>

		<p class="text-sm mb-4">
			Of {formatMoney(summary.annualIncome)} a year,
			<span class="font-medium">{formatMoney(summary.taxFreeIncome)} arrives tax-free</span>
			— ISA withdrawals and the tax-free quarter of every pension pound — and
			{formatMoney(summary.earnedIncome)} is taxed as income, costing
			{formatMoney(summary.incomeTax)} in {TAX_REGION_LABELS[summary.input.taxRegion]}
			({TAX_YEAR} rates).
			{#if summary.dividendIncome > 0}
				The remaining {formatMoney(summary.dividendIncome)} of dividends is taxed at dividend rates against
				the dividend allowance, which is not worked out here yet — so the figure above is a little optimistic
				if you lean on them.
			{/if}
		</p>

		{#if summary.uncounted.length > 0}
			<h3 class="text-sm font-semibold mb-1">Not counted here</h3>
			<ul class="text-sm text-muted-foreground mb-4 flex flex-col gap-1">
				{#each summary.uncounted as entry (entry.id)}
					<li>
						<span class="font-medium text-foreground">{entry.label}</span>
						({entry.count}, {formatMoney(entry.value)}) — {entry.reason}.
					</li>
				{/each}
			</ul>
		{/if}
	{/if}

	<p class="text-xs text-muted-foreground">
		Illustrative only, not financial advice. Nothing here models <em>when</em> each stream starts — State
		Pension age, the minimum pension age, or a scheme's normal pension age and the reduction for drawing
		early — so it assumes every stream is available at once. Withdrawal rates are a rule of thumb, not
		a guarantee: see the retirement tab for how long a pot actually lasts. An annuity rate here is a percentage
		of the pot, not a quote — a real one depends on your age, health, and whether the income rises with
		inflation or covers a spouse. Nothing is inflation-linked, National Insurance is not due on any of
		it, and dividend tax is not yet calculated.
	</p>
</Card>
