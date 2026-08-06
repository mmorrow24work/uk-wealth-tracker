<script>
	/**
	 * Three-scenario forecast UI — README.md → "Forecast": "Three-scenario projections: pessimistic /
	 * realistic / optimistic" (issue #16).
	 *
	 * Projects the latest recorded position forward under three growth assumptions ($lib/forecast.js)
	 * and shows where each scenario lands at a handful of horizons. Until the monthly snapshot entry
	 * form (#8) exists there is nothing recorded to project, so the panel falls back to a starting
	 * position typed in here — an assumption, held for this page session only and never written to
	 * `monthly_entries`, so the tab is usable today without pretending to be history.
	 *
	 * Growth rate and spread are draggable sliders (#17) paired with a precise number field, both
	 * bound to the same state so either control moves the other and the scenarios below recompute on
	 * every input event — there is no "apply" step. The chart and its confidence band (#12) is a
	 * separate, not-yet-built issue, so the milestone pills and retirement marker (#18) below are
	 * rendered as a list rather than plotted on a chart; `$lib/milestones.js` is written against
	 * `Forecast`, not against any chart library, so #12 can read it once the chart lands instead of
	 * this issue inventing chart-pill placement math twice. The age filter (#19), the
	 * contributions-vs-growth panel (#20) and the stress test overlay (#21) are separate issues;
	 * `forecastBand()` and each point's `contributions`/`growth` split are already computed here for
	 * them to read.
	 */
	import {
		DEFAULT_SCENARIO_SPREAD,
		FORECAST_SCENARIOS,
		FORECAST_SCENARIO_LABELS,
		forecastFromEntries,
		forecastScenarios,
		summariseForecast
	} from '$lib/forecast.js';
	import { milestoneCrossings, retirementMarker } from '$lib/milestones.js';
	import { createInvestment, createProfile } from '$lib/model.js';
	import Card from './ui/card.svelte';

	// Slider ranges are an invented UI convenience, not spec — README.md gives no bounds for either
	// assumption. `forecast.js` itself still validates and accepts the full -100..100 / 0..100 range
	// via the paired number field; these are just where the drag handle lives, chosen to cover
	// realistic UK planning scenarios (equities ~5-8%, cash ~1-3%) at a step fine enough to feel
	// live without a stray decimal on every drag.
	const GROWTH_SLIDER_MIN = -10;
	const GROWTH_SLIDER_MAX = 15;
	const GROWTH_SLIDER_STEP = 0.1;
	const SPREAD_SLIDER_MIN = 0;
	const SPREAD_SLIDER_MAX = 10;
	const SPREAD_SLIDER_STEP = 0.5;

	/**
	 * @type {{
	 * 	monthlyEntries?: import('$lib/types.js').MonthlyEntry[],
	 * 	growthRate?: number,
	 * 	spread?: number,
	 * 	years?: number,
	 * 	dobYear?: number | null,
	 * 	dobMonth?: number | null,
	 * 	retirementAge?: number
	 * }}
	 */
	let {
		monthlyEntries = [],
		growthRate = 5,
		spread = DEFAULT_SCENARIO_SPREAD,
		years = 30,
		dobYear: dobYearProp = null,
		dobMonth: dobMonthProp = null,
		retirementAge: retirementAgeProp = 67
	} = $props();

	// The props seed the assumptions once; from then on the user owns them.
	// svelte-ignore state_referenced_locally
	let rate = $state(growthRate);
	// svelte-ignore state_referenced_locally
	let spreadInput = $state(spread);
	// svelte-ignore state_referenced_locally
	let horizon = $state(years);
	let deductFees = $state(true);

	// Fallback position, used only while no snapshot exists to project from.
	let startingValue = $state(10_000);
	let monthlyContribution = $state(500);

	// Fallback for the milestone/retirement markers: `Profile` has no form to feed this from until
	// the store (#5) lands, so birth year/month and retirement age are typed in here too, same as
	// the starting position above.
	// svelte-ignore state_referenced_locally
	let dobYear = $state(dobYearProp);
	// svelte-ignore state_referenced_locally
	let dobMonth = $state(dobMonthProp);
	// svelte-ignore state_referenced_locally
	let retirementAgeInput = $state(retirementAgeProp);

	/**
	 * `bind:value` on a numeric input hands back a number, or `null` once the field is cleared — but
	 * the seeded values above and a prop passed as a string both have to survive the same helper.
	 *
	 * @param {unknown} value
	 * @param {number} fallback What an empty or unparseable field counts as.
	 * @returns {number}
	 */
	function parse(value, fallback) {
		if (value === null || value === undefined || value === '') return fallback;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	/**
	 * Birth year/month have no sensible fallback — an empty or invalid field means "unknown", not
	 * "assume some default age", so this returns `null` instead of a fallback number the way
	 * {@link parse} does.
	 *
	 * @param {unknown} value
	 * @returns {number | null}
	 */
	function parseOptionalInt(value) {
		if (value === null || value === undefined || value === '') return null;
		const parsed = Number(value);
		return Number.isInteger(parsed) ? parsed : null;
	}

	const parsedRate = $derived(parse(rate, Number.NaN));
	const parsedSpread = $derived(parse(spreadInput, Number.NaN));
	const parsedYears = $derived(parse(horizon, Number.NaN));

	const rateIsValid = $derived(parsedRate >= -100 && parsedRate <= 100);
	const spreadIsValid = $derived(parsedSpread >= 0 && parsedSpread <= 100);
	const yearsIsValid = $derived(parsedYears >= 1 && parsedYears <= 100);
	const assumptionsAreValid = $derived(rateIsValid && spreadIsValid && yearsIsValid);

	const parsedDobYear = $derived(parseOptionalInt(dobYear));
	const parsedDobMonthRaw = $derived(parseOptionalInt(dobMonth));
	const parsedDobMonth = $derived(
		parsedDobMonthRaw !== null && parsedDobMonthRaw >= 1 && parsedDobMonthRaw <= 12
			? parsedDobMonthRaw
			: null
	);
	const parsedRetirementAge = $derived(parse(retirementAgeInput, 67));
	const retirementAgeIsValid = $derived(parsedRetirementAge >= 16 && parsedRetirementAge <= 120);

	// Only what `retirementMarker` reads — a real Profile has many more fields this panel doesn't
	// collect and shouldn't invent values for.
	const markerProfile = $derived(
		createProfile({
			dob_year: parsedDobYear,
			dob_month: parsedDobMonth,
			retirement_age: retirementAgeIsValid ? parsedRetirementAge : 67
		})
	);

	const hasHistory = $derived(monthlyEntries.length > 0);

	// Position projected when there is no recorded history: one synthetic holding standing in for
	// "everything I own today", with the contribution the user expects to keep paying in.
	const assumedHoldings = $derived([
		createInvestment({
			id: 'inv_assumed_start',
			name: 'Assumed starting position',
			value: Math.max(0, parse(startingValue, 0)),
			monthly_contribution: Math.max(0, parse(monthlyContribution, 0))
		})
	]);

	const forecast = $derived.by(() => {
		if (!assumptionsAreValid) return null;
		const input = { months: Math.round(parsedYears * 12), spread: parsedSpread };
		const options = { growthRate: parsedRate, applyFundFees: deductFees };

		return hasHistory
			? forecastFromEntries(monthlyEntries, input, options)
			: forecastScenarios({ ...input, investments: assumedHoldings }, options);
	});

	const rows = $derived(forecast ? summariseForecast(forecast) : []);
	const anchor = $derived(forecast?.series.realistic[0] ?? null);
	const finalRow = $derived(rows.at(-1) ?? null);

	const milestones = $derived(forecast ? milestoneCrossings(forecast) : []);
	const retirement = $derived(forecast ? retirementMarker(forecast, markerProfile) : null);

	const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });
	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {{ month: number, year: number }} value */
	function formatMonth({ month, year }) {
		return monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
	}

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} value */
	function formatYears(value) {
		const rounded = Math.round(value * 10) / 10;
		return `${rounded} year${rounded === 1 ? '' : 's'}`;
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Three-scenario forecast</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Your holdings and contributions carried forward under three growth assumptions. Pessimistic and
		optimistic are the same long-run average shifted down and up — not a crash and not a boom.
	</p>

	<div class="flex flex-wrap items-end gap-4 mb-4">
		<div class="flex flex-col gap-1">
			<span id="forecast-growth-label" class="text-sm font-medium">Annual growth (%)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="forecast-growth-label"
					min={GROWTH_SLIDER_MIN}
					max={GROWTH_SLIDER_MAX}
					step={GROWTH_SLIDER_STEP}
					bind:value={rate}
					class="w-32 accent-black"
				/>
				<input
					id="forecast-growth"
					type="number"
					aria-labelledby="forecast-growth-label"
					min="-100"
					max="100"
					step="0.1"
					bind:value={rate}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="forecast-spread-label" class="text-sm font-medium">Scenario spread (± pp)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="forecast-spread-label"
					min={SPREAD_SLIDER_MIN}
					max={SPREAD_SLIDER_MAX}
					step={SPREAD_SLIDER_STEP}
					bind:value={spreadInput}
					class="w-32 accent-black"
				/>
				<input
					id="forecast-spread"
					type="number"
					aria-labelledby="forecast-spread-label"
					min="0"
					max="100"
					step="0.5"
					bind:value={spreadInput}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="forecast-years">Years</label>
			<input
				id="forecast-years"
				type="number"
				min="1"
				max="100"
				step="1"
				bind:value={horizon}
				class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
			/>
		</div>

		<label class="flex items-center gap-1.5 text-sm text-muted-foreground pb-2">
			<input type="checkbox" bind:checked={deductFees} />
			Deduct each holding's fund fee
		</label>
	</div>

	{#if !assumptionsAreValid}
		<p class="text-sm text-red-600 mb-4">
			Enter a growth rate between -100% and 100%, a spread of 0–100 percentage points, and a horizon
			of 1–100 years.
		</p>
	{/if}

	{#if hasHistory && anchor}
		<p class="text-sm text-muted-foreground mb-4">
			Projected from your {formatMonth(anchor)} snapshot: {formatMoney(anchor.investments)} invested
			{#if anchor.debts > 0}
				less {formatMoney(anchor.debts)} of debt
			{/if}
			— {formatMoney(anchor.net_worth)} net worth today.
		</p>
	{:else}
		<div class="mb-4 rounded-md border border-border bg-muted/40 p-3">
			<p class="text-sm text-muted-foreground mb-3">
				No monthly snapshots recorded yet — the snapshot entry form is still to come. Until then,
				describe your starting position here. These two figures are assumptions for this forecast
				only; nothing is saved.
			</p>
			<div class="flex flex-wrap items-end gap-4">
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="forecast-start-value">Invested today (£)</label>
					<input
						id="forecast-start-value"
						type="number"
						min="0"
						step="100"
						bind:value={startingValue}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-36"
					/>
				</div>
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="forecast-contribution">
						Monthly contribution (£)
					</label>
					<input
						id="forecast-contribution"
						type="number"
						min="0"
						step="50"
						bind:value={monthlyContribution}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-36"
					/>
				</div>
			</div>
		</div>
	{/if}

	{#if forecast}
		<div class="flex flex-wrap gap-3 mb-4">
			{#each FORECAST_SCENARIOS as scenario (scenario)}
				<div class="flex-1 min-w-40 rounded-md border border-border px-3 py-2">
					<div class="text-sm font-medium">{FORECAST_SCENARIO_LABELS[scenario]}</div>
					<div class="text-xs text-muted-foreground mb-1">
						{forecast.rates[scenario]}% a year
					</div>
					<div class="text-xl font-semibold">
						{formatMoney(forecast.series[scenario].at(-1)?.net_worth ?? 0)}
					</div>
					<div class="text-xs text-muted-foreground">
						in {formatYears(forecast.months / 12)}
					</div>
				</div>
			{/each}
		</div>

		{#if rows.length > 0}
			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Horizon</th>
						{#each FORECAST_SCENARIOS as scenario (scenario)}
							<th class="py-2 px-2 font-medium text-right">
								{FORECAST_SCENARIO_LABELS[scenario]}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.offset)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-2">
								<span class="font-medium">{formatYears(row.years)}</span>
								<span class="text-xs text-muted-foreground ml-1">
									{formatMonth(row)}
								</span>
							</td>
							{#each FORECAST_SCENARIOS as scenario (scenario)}
								<td class="py-2 px-2 text-right tabular-nums">
									{formatMoney(row.net_worth[scenario])}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>

			{#if finalRow}
				<p class="text-xs text-muted-foreground mt-3">
					{formatMoney(finalRow.contributions)} of that is contributions you still have to pay in — the
					same in every scenario, since only growth differs between them.
				</p>
			{/if}
		{/if}

		<div class="mt-5 pt-4 border-t border-border">
			<h3 class="text-sm font-semibold mb-1">Milestones &amp; retirement</h3>
			<p class="text-xs text-muted-foreground mb-3">
				Realistic-scenario crossing dates, with the range across pessimistic and optimistic in
				brackets. Birth year/month and retirement age aren't collected anywhere yet (there's no
				profile form until #5 lands), so they're typed in here for this forecast only — nothing is
				saved.
			</p>

			<div class="flex flex-wrap items-end gap-4 mb-3">
				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium" for="forecast-dob-year">Birth year</label>
					<input
						id="forecast-dob-year"
						type="number"
						min="1900"
						max="2200"
						step="1"
						placeholder="e.g. 1990"
						bind:value={dobYear}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
					/>
				</div>
				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium" for="forecast-dob-month">Birth month</label>
					<input
						id="forecast-dob-month"
						type="number"
						min="1"
						max="12"
						step="1"
						placeholder="1–12, optional"
						bind:value={dobMonth}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
					/>
				</div>
				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium" for="forecast-retirement-age">Retirement age</label>
					<input
						id="forecast-retirement-age"
						type="number"
						min="16"
						max="120"
						step="1"
						bind:value={retirementAgeInput}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
					/>
				</div>
			</div>

			{#if !retirementAgeIsValid}
				<p class="text-sm text-red-600 mb-3">Retirement age must be between 16 and 120.</p>
			{/if}

			<div class="flex flex-wrap gap-2 mb-3">
				{#each milestones as milestone (milestone.amount)}
					<span
						class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs {milestone.achieved
							? 'border-green-300 bg-green-50 text-green-800'
							: 'border-border'}"
					>
						<span class="font-semibold">{milestone.label}</span>
						{#if milestone.achieved}
							Already reached
						{:else if milestone.realistic}
							{formatMonth(milestone.realistic)}
							{#if milestone.optimistic && milestone.pessimistic}
								<span class="text-muted-foreground">
									({formatMonth(milestone.optimistic)}–{formatMonth(milestone.pessimistic)})
								</span>
							{/if}
						{:else}
							<span class="text-muted-foreground">
								beyond {formatYears(forecast.months / 12)}
							</span>
						{/if}
					</span>
				{/each}
			</div>

			{#if retirement}
				<p class="text-sm text-muted-foreground">
					{#if !retirement.available}
						Add your birth year above to see when you reach retirement age {retirement.retirementAge}.
					{:else if retirement.alreadyReached}
						You've already reached retirement age {retirement.retirementAge}.
					{:else if retirement.point && retirement.netWorth}
						<span class="font-medium text-foreground">Retirement</span>
						at age {retirement.retirementAge} falls in {formatMonth(retirement.point)}, projected
						net worth {formatMoney(retirement.netWorth.realistic)}
						(range {formatMoney(retirement.netWorth.pessimistic)}–{formatMoney(
							retirement.netWorth.optimistic
						)}).
					{:else}
						Retirement age {retirement.retirementAge} falls beyond this {formatYears(
							forecast.months / 12
						)} horizon.
					{/if}
				</p>
			{/if}
		</div>
	{/if}

	{#if hasHistory && anchor && anchor.investments === 0}
		<p class="text-sm text-muted-foreground mt-3">
			Your latest snapshot holds nothing that counts towards net worth, so there is nothing to
			compound — every scenario is the same flat line.
		</p>
	{/if}
</Card>
