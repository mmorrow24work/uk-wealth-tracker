<script>
	/**
	 * Defined Benefit income across every scheme recorded — README.md → "Pension Tracker": "DB
	 * pension: accrual rate, years of service, expected salary, or direct annual income input"
	 * (issue #30).
	 *
	 * `PensionTracker` above this collects the four `db_*` fields and shows each scheme's own income
	 * on its row; this card is what those figures add up to, and the three things a single row cannot
	 * say: what the guaranteed income is in total, what a DC pot would have to be worth to buy the
	 * same thing, and what staying in a scheme for more years would add.
	 *
	 * It reads `pensions` without binding — nothing here writes to the data model. The projection
	 * controls are deliberately component-local: "another eight years at 3% a year" is a question
	 * being asked, not a fact about the scheme, and `Pension` has no field to put it in. The scheme
	 * picker exists because that question is only ever about *one* scheme — you accrue in the job you
	 * are in, while deferred schemes sit still — so applying one "extra years" figure across every
	 * scheme at once would quietly overstate the total.
	 *
	 * All the arithmetic is `$lib/defined-benefit.js`'s; this file formats it. Feeding this income
	 * into the retirement income stream builder alongside a SIPP drawdown, an annuity and the State
	 * Pension is #33's job, not this one's.
	 */
	import {
		DEFINED_BENEFIT_INPUT_LABELS,
		definedBenefitTotals,
		projectDefinedBenefit
	} from '$lib/defined-benefit.js';
	import { PENSION_TYPE_LABELS } from '$lib/enums.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 *   pensions?: import('$lib/types.js').Pension[],
	 *   withdrawalRate?: number
	 * }}
	 */
	let { pensions = [], withdrawalRate = 4 } = $props();

	const totals = $derived(definedBenefitTotals(pensions, withdrawalRate));

	/** Only a scheme on the accrual route has anything to project — a stated income is already final. */
	const projectable = $derived(totals.schemes.filter((scheme) => scheme.source === 'accrual'));

	let selectedId = $state('');
	let extraYears = $state('0');
	let salaryGrowth = $state('0');

	/** Falls back to the first projectable scheme, so the card is useful before anything is picked. */
	const selected = $derived(
		projectable.find((scheme) => scheme.id === selectedId) ?? projectable[0] ?? null
	);

	const projection = $derived(
		selected === null
			? null
			: projectDefinedBenefit(pensions.find((pension) => pension.id === selected.id) ?? null, {
					extraYears: Number(extraYears) || 0,
					salaryGrowthRate: Number(salaryGrowth) || 0
				})
	);

	/**
	 * The rest of the projection sentence, built as one string rather than as `{#if}` blocks in the
	 * markup: the assumptions in the middle are conditional but the punctuation around them is not,
	 * and interleaving the two leaves a stray space before the comma whenever a clause drops out.
	 */
	const projectionTail = $derived.by(() => {
		if (projection === null) return '';

		/** @type {string[]} */
		const assumptions = [];
		if (projection.years !== null) assumptions.push(`${formatYears(projection.years)} of service`);
		if (projection.salaryGrowthRate > 0 && projection.salary !== null) {
			assumptions.push(`a salary of ${formatMoney(projection.salary)} by then`);
		}

		const on = assumptions.length === 0 ? '' : ` on ${assumptions.join(' and ')}`;
		const monthly = formatMoney(projection.monthlyIncome);
		return `— ${monthly} a month —${on}, up ${formatMoney(projection.uplift)} a year on what it is worth today.`;
	});

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} rate @returns {string} e.g. "4%", "41.67%" */
	function formatRate(rate) {
		return `${Math.round(rate * 100) / 100}%`;
	}

	/** @param {number} years @returns {string} e.g. "25 years", "1 year" */
	function formatYears(years) {
		return `${Math.round(years * 100) / 100} ${years === 1 ? 'year' : 'years'}`;
	}

	/**
	 * "accrual rate and pensionable salary" — the fields still to enter, named the way the form above
	 * labels them.
	 *
	 * @param {readonly string[]} fields
	 * @returns {string}
	 */
	function listMissing(fields) {
		const labels = fields.map((field) => DEFINED_BENEFIT_INPUT_LABELS[field] ?? field);
		if (labels.length <= 1) return labels.join('');
		return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
	}

	/** @param {import('$lib/defined-benefit.js').DefinedBenefitBreakdown} scheme */
	function derivation(scheme) {
		if (scheme.source === 'stated') return 'from your annual benefit statement';
		const rate = scheme.accrualFraction || formatRate(/** @type {number} */ (scheme.accrualRate));
		return `${rate} × ${formatYears(/** @type {number} */ (scheme.years))} × ${formatMoney(
			/** @type {number} */ (scheme.salary)
		)}`;
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Defined Benefit income</h2>
	<p class="text-sm text-muted-foreground mb-4">
		A Defined Benefit scheme has no pot to draw down — it promises an income, worked out as
		<span class="font-medium">accrual rate × pensionable salary × years of service</span>. This is
		what every Defined Benefit scheme above pays between them, before tax.
	</p>

	{#if totals.count === 0}
		<p class="text-sm">
			No Defined Benefit schemes recorded. Add one above — pick
			<span class="font-medium">{PENSION_TYPE_LABELS.db_final_salary}</span>
			or <span class="font-medium">{PENSION_TYPE_LABELS.db_care}</span> as the type — and its income will
			be worked out here.
		</p>
	{:else}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Guaranteed income</div>
				<div class="text-xs text-muted-foreground mb-1">
					{totals.completeCount} of {totals.count} scheme{totals.count === 1 ? '' : 's'} costed
				</div>
				<div class="text-xl font-semibold">{formatMoney(totals.annualIncome)}/yr</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(totals.monthlyIncome)} a month, for life
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Worth as a pot</div>
				<div class="text-xs text-muted-foreground mb-1">
					at a {formatRate(totals.withdrawalRate)} withdrawal rate
				</div>
				<div class="text-xl font-semibold">{formatMoney(totals.capitalEquivalent)}</div>
				<div class="text-xs text-muted-foreground">
					what a DC pot would need to be to buy the same income
				</div>
			</div>
		</div>

		<h3 class="text-sm font-semibold mb-2">Scheme by scheme</h3>
		<table class="w-full text-sm border-collapse mb-4">
			<thead>
				<tr class="border-b border-border text-left">
					<th class="py-2 pr-2 font-medium">Scheme</th>
					<th class="py-2 px-2 font-medium">Worked out as</th>
					<th class="py-2 px-2 font-medium text-right">Per year</th>
					<th class="py-2 pl-2 font-medium text-right">Per month</th>
				</tr>
			</thead>
			<tbody>
				{#each totals.schemes as scheme (scheme.id)}
					<tr class="border-b border-border/60">
						<td class="py-2 pr-2">
							<div class="font-medium">{scheme.name}</div>
							<div class="text-xs text-muted-foreground">
								{scheme.type === null ? '' : PENSION_TYPE_LABELS[scheme.type]}
							</div>
						</td>
						<td class="py-2 px-2">
							{#if scheme.complete}
								{derivation(scheme)}
								{#if scheme.replacementRate !== null}
									<div class="text-xs text-muted-foreground">
										{formatRate(scheme.replacementRate)} of pensionable salary
									</div>
								{/if}
							{:else}
								<span class="text-amber-700">
									Needs {listMissing(scheme.missingInputs)}
								</span>
							{/if}
						</td>
						<td class="py-2 px-2 text-right tabular-nums">{formatMoney(scheme.annualIncome)}</td>
						<td class="py-2 pl-2 text-right tabular-nums font-medium">
							{formatMoney(scheme.monthlyIncome)}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="border-t border-border font-medium">
					<td class="py-2 pr-2" colspan="2">Total</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatMoney(totals.annualIncome)}</td>
					<td class="py-2 pl-2 text-right tabular-nums">{formatMoney(totals.monthlyIncome)}</td>
				</tr>
			</tfoot>
		</table>

		{#each totals.schemes.filter((scheme) => scheme.routeDifference !== null && Math.abs(scheme.routeDifference) >= 1) as scheme (scheme.id)}
			<p class="text-sm text-amber-700 mb-3">
				<span class="font-medium">{scheme.name}: the two routes disagree.</span>
				Your statement says {formatMoney(/** @type {number} */ (scheme.statedIncome))} a year; the accrual
				rate, service and salary you entered come to {formatMoney(
					/** @type {number} */ (scheme.accruedIncome)
				)}. The statement is what counts here — but a gap that size usually means one of the three
				inputs is mistyped.
			</p>
		{/each}

		{#if selected !== null && projection !== null}
			<h3 class="text-sm font-semibold mb-1">If you keep accruing</h3>
			<p class="text-xs text-muted-foreground mb-2">
				Years of service above should be the total you expect at retirement, which is not what a
				benefit statement's "service to date" gives you. This works the difference out: pick the
				scheme you are still building up in and add the years you have left.
			</p>
			<div class="flex flex-wrap items-end gap-3 mb-2">
				{#if projectable.length > 1}
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium" for="db-projection-scheme">Scheme</label>
						<select
							id="db-projection-scheme"
							bind:value={selectedId}
							class="border border-input rounded-md px-2 py-1.5 text-sm"
						>
							{#each projectable as scheme (scheme.id)}
								<option value={scheme.id}>{scheme.name}</option>
							{/each}
						</select>
					</div>
				{/if}

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="db-projection-years">Further years</label>
					<input
						id="db-projection-years"
						type="number"
						min="0"
						max="100"
						step="1"
						bind:value={extraYears}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="db-projection-growth">Salary growth (%/yr)</label>
					<input
						id="db-projection-growth"
						type="number"
						min="0"
						max="100"
						step="0.1"
						bind:value={salaryGrowth}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
					/>
				</div>
			</div>

			<p class="text-sm mb-3">
				{#if projection.uplift === 0}
					<span class="font-medium">{selected.name}</span> pays
					{formatMoney(projection.annualIncome)} a year as entered. Add the years you have left to run
					and it will grow.
				{:else}
					<span class="font-medium"
						>{selected.name} would pay {formatMoney(projection.annualIncome)} a year</span
					>
					{projectionTail}
				{/if}
			</p>
		{/if}
	{/if}

	<p class="text-xs text-muted-foreground">
		Illustrative only, not financial advice. Gross figures, at the scheme's normal pension age, in
		the money the salary was entered in. Drawing early cuts the pension (commonly around 4% for each
		year early) and drawing late raises it; nothing here models that, nor revaluation before
		retirement, inflation increases in payment, a lump sum taken instead of income, a spouse's
		pension, or the income tax a Defined Benefit pension is fully liable to as earned income. The
		"worth as a pot" figure is a comparison, not a transfer value — only your scheme can quote one.
		A CARE scheme's income is the sum of each year's own revalued slice, so a single salary figure
		can only approximate it.
	</p>
</Card>
