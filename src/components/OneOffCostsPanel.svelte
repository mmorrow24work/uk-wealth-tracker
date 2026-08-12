<script>
	/**
	 * One-off large costs overlay — README.md → "Advanced Scenarios": "One-off large costs"
	 * (issue #161, the panel half of #136).
	 *
	 * `$lib/one-off-costs.js` projects the same position the panel above projects, with a lump sum
	 * taken out on each configured cost's own date, and this component shows the two lines against
	 * each other — the same shape as `StressTestPanel`/`IncomeShockPanel`, just for a withdrawal
	 * event instead of a market move or a standing-order change. Unlike those two, the config is a
	 * *list*: the issue is explicit that real use is rarely just one cost, so this panel is an
	 * editable list of named rows (what for, starts in how many years, how much) rather than a fixed
	 * set of dials.
	 *
	 * It takes the baseline `Forecast` and the *position* that produced it, rather than deriving its
	 * own, for the same reason `StressTestPanel`/`IncomeShockPanel` do: the overlay is built from the
	 * baseline's own anchor, horizon and spread, so the growth/spread/horizon controls above drive
	 * both lines and there is no second set of assumptions on the tab that could disagree with the
	 * first.
	 *
	 * Nothing here is persisted — the list lives as component state for the page session, matching
	 * every sibling scenario panel: there is no slot for a planning scenario on `AppData` yet, and
	 * this is a what-if dial, not tracked data.
	 */
	import { FORECAST_SCENARIOS, FORECAST_SCENARIO_LABELS } from '$lib/forecast.js';
	import { ageAtPoint } from '$lib/milestones.js';
	import {
		DEFAULT_ONE_OFF_COST,
		compareOneOffCosts,
		createOneOffCost,
		oneOffCostsForecast,
		oneOffCostsImpact,
		oneOffCostsImpacts
	} from '$lib/one-off-costs.js';
	import Button from './ui/button.svelte';

	/**
	 * @type {{
	 * 	forecast: import('$lib/forecast.js').Forecast,
	 * 	position: { investments: import('$lib/types.js').Investment[], debts?: import('$lib/types.js').Debt[] },
	 * 	options?: import('$lib/forecast.js').ForecastOptions,
	 * 	offsets?: number[] | null,
	 * 	dobYear?: number | null,
	 * 	dobMonth?: number | null
	 * }}
	 */
	let {
		forecast,
		position,
		options = {},
		offsets = null,
		dobYear = null,
		dobMonth = null
	} = $props();

	// Off by default, matching StressTestPanel/IncomeShockPanel: the forecast tab's job is to show
	// the plan, and a cost overlay is something the user asks to see.
	let enabled = $state(false);

	/**
	 * One editable row. Timing is kept in years here — how a planning horizon is discussed — and
	 * converted to `one-off-costs.js`'s whole-month `atMonth` at the `normalisedCosts` boundary
	 * below, the same split `IncomeShockPanel`'s own `startYears` keeps against `income-shock.js`.
	 *
	 * @typedef {{ id: string, name: string, startYears: number, amount: number }} CostRow
	 */
	/** @type {CostRow[]} */
	let costs = $state([]);

	function addCost() {
		const seed = createOneOffCost();
		costs.push({
			id: seed.id,
			name: seed.name,
			startYears: seed.atMonth / 12,
			amount: seed.amount
		});
	}

	/** @param {string} id */
	function removeCost(id) {
		costs = costs.filter((row) => row.id !== id);
	}

	/**
	 * `bind:value` on a numeric input hands back a number, or `null` once the field is cleared.
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

	const horizonYears = $derived(forecast.months / 12);

	const normalisedCosts = $derived(
		costs.map((row) => ({
			id: row.id,
			name: row.name,
			atMonth: Math.max(1, Math.round(parse(row.startYears, 1) * 12)),
			amount: Math.max(0, parse(row.amount, DEFAULT_ONE_OFF_COST.amount))
		}))
	);

	// Built from the baseline's own anchor/horizon/spread, so the two lines are the same projection
	// under two sets of events rather than two differently-shaped forecasts on one screen.
	const costed = $derived(
		enabled && costs.length > 0
			? oneOffCostsForecast(
					{
						investments: position.investments,
						debts: position.debts ?? [],
						start: forecast.start,
						months: forecast.months,
						spread: forecast.spread
					},
					options,
					normalisedCosts
				)
			: null
	);

	const impact = $derived(costed ? oneOffCostsImpact(forecast, costed) : null);
	const byScenario = $derived(costed ? oneOffCostsImpacts(forecast, costed) : null);
	const rows = $derived(costed ? compareOneOffCosts(forecast, costed, 'realistic', offsets) : []);
	const occurringCount = $derived(impact ? impact.costs.filter((cost) => cost.occurs).length : 0);

	const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });
	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});
	const percentFormatter = new Intl.NumberFormat('en-GB', {
		style: 'percent',
		maximumFractionDigits: 0
	});

	/** @param {{ month: number, year: number }} value */
	function formatMonth({ month, year }) {
		return monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
	}

	/** @param {{ month: number, year: number } | null} value */
	function formatDate(value) {
		if (!value) return '—';
		const age = dobYear !== null ? ` (age ${ageAtPoint(dobYear, dobMonth, value)})` : '';
		return `${formatMonth(value)}${age}`;
	}

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number | null} share */
	function formatShare(share) {
		return share === null ? '—' : percentFormatter.format(share);
	}

	/** @param {number} months @returns {string} e.g. "8 months", "3.5 years" */
	function formatDuration(months) {
		if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
		const years = Math.round((months / 12) * 10) / 10;
		return `${years} year${years === 1 ? '' : 's'}`;
	}

	/**
	 * Two bars at the horizon, scaled to whichever projection ends higher — the same shape
	 * `StressTestPanel`/`IncomeShockPanel`'s horizon bars use, for the same reason: no chart yet
	 * (#12).
	 */
	const horizonBars = $derived(
		impact && impact.baselineFinal > 0 && impact.costedFinal > 0
			? [
					{ key: 'baseline', label: 'No costs', value: impact.baselineFinal, colour: '#0ea5e9' },
					{
						key: 'costed',
						label: 'With the costs',
						value: impact.costedFinal,
						colour: '#f97316'
					}
				]
			: []
	);
	const barScale = $derived(Math.max(...horizonBars.map((bar) => bar.value), 1));
</script>

<div class="mt-5 pt-4 border-t border-border">
	<h3 class="text-sm font-semibold mb-1">One-off large costs</h3>
	<p class="text-xs text-muted-foreground mb-3">
		The market above carries on exactly as assumed — this models something else: a lump sum you take
		out on a stated date. A wedding, a car, a home renovation — add as many as you like, each with
		its own date and amount; two due in the same month simply add together.
	</p>

	<label class="flex items-center gap-1.5 text-sm font-medium mb-3">
		<input type="checkbox" bind:checked={enabled} />
		Model one-off costs
	</label>

	<div class:opacity-50={!enabled}>
		{#if costs.length > 0}
			<ul class="flex flex-col gap-2 mb-3 list-none p-0 m-0">
				{#each costs as row (row.id)}
					<li class="flex flex-wrap items-end gap-3 border border-border rounded-md px-3 py-2">
						<div class="flex flex-col gap-1">
							<label class="text-xs font-medium" for="cost-name-{row.id}">What for</label>
							<input
								id="cost-name-{row.id}"
								type="text"
								disabled={!enabled}
								bind:value={row.name}
								placeholder="e.g. Wedding"
								class="border border-input rounded-md px-2 py-1.5 text-sm w-40 disabled:opacity-50"
							/>
						</div>
						<div class="flex flex-col gap-1">
							<label class="text-xs font-medium" for="cost-start-{row.id}">Starts in (years)</label>
							<input
								id="cost-start-{row.id}"
								type="number"
								min="0"
								max={Math.max(1, Math.round(horizonYears))}
								step="0.5"
								disabled={!enabled}
								bind:value={row.startYears}
								class="border border-input rounded-md px-2 py-1.5 text-sm w-24 disabled:opacity-50"
							/>
						</div>
						<div class="flex flex-col gap-1">
							<label class="text-xs font-medium" for="cost-amount-{row.id}">Amount (£)</label>
							<input
								id="cost-amount-{row.id}"
								type="number"
								min="0"
								step="100"
								disabled={!enabled}
								bind:value={row.amount}
								class="border border-input rounded-md px-2 py-1.5 text-sm w-28 disabled:opacity-50"
							/>
						</div>
						<Button
							variant="ghost"
							size="sm"
							type="button"
							disabled={!enabled}
							onclick={() => removeCost(row.id)}
						>
							Remove
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
		<Button variant="outline" size="sm" type="button" disabled={!enabled} onclick={addCost}>
			+ Add a cost
		</Button>
	</div>

	{#if !enabled}
		<p class="text-xs text-muted-foreground mt-3">
			Tick the box to overlay {costs.length > 0
				? `${costs.length} one-off cost${costs.length === 1 ? '' : 's'}`
				: 'one-off costs you add'} on the projection above.
		</p>
	{:else if costs.length === 0}
		<p class="text-sm text-muted-foreground mt-3">Add a cost above to see its effect.</p>
	{:else if !impact || !costed}
		<p class="text-sm text-muted-foreground mt-3">Nothing projected yet.</p>
	{:else if impact.totalConfigured === 0}
		<p class="text-sm text-muted-foreground mt-3">
			None of your costs has an amount yet — the overlay is the forecast above, unchanged.
		</p>
	{:else if impact.totalOccurring === 0}
		<p class="text-sm text-muted-foreground mt-3">
			None of your configured costs fall within this forecast's {formatDuration(forecast.months)}
			horizon — there is nothing to overlay. Bring one forward, or lengthen the horizon above.
		</p>
	{:else}
		<table class="w-full text-sm border-collapse mt-3 mb-3">
			<thead>
				<tr class="border-b border-border text-left">
					<th class="py-2 pr-2 font-medium">Cost</th>
					<th class="py-2 px-2 font-medium">Date</th>
					<th class="py-2 pl-2 font-medium text-right">Amount</th>
				</tr>
			</thead>
			<tbody>
				{#each impact.costs as cost (cost.id)}
					<tr class="border-b border-border/60">
						<td class="py-2 pr-2">{cost.name || 'Unnamed cost'}</td>
						<td class="py-2 px-2">
							{#if cost.occurs}
								{formatDate(cost.date)}
							{:else}
								<span class="text-muted-foreground">beyond horizon</span>
							{/if}
						</td>
						<td class="py-2 pl-2 text-right tabular-nums">{formatMoney(cost.amount)}</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<p class="text-sm text-muted-foreground mb-3">
			<span class="font-medium text-foreground">{formatMoney(impact.totalOccurring)}</span>
			across {occurringCount} one-off cost{occurringCount === 1 ? '' : 's'} taken out of the projection
			above{#if impact.totalOccurring !== impact.totalConfigured}
				({formatMoney(impact.totalConfigured - impact.totalOccurring)} more is configured beyond the
				{formatDuration(forecast.months)} horizon){/if}. By {formatDuration(forecast.months)} that has
			grown to
			<span class="font-medium text-foreground">
				{formatMoney(impact.shortfall)} ({formatShare(impact.shortfallShare)})
			</span>
			less net worth than the no-costs forecast — {formatMoney(
				impact.shortfall - impact.totalOccurring
			)} of that is growth the withdrawn money would themselves have earned.
		</p>

		{#if horizonBars.length === 2}
			<div class="mb-4 flex flex-col gap-1.5">
				{#each horizonBars as bar (bar.key)}
					<div class="flex items-center gap-2 text-xs">
						<span
							class="w-28 text-muted-foreground"
							style="display: inline-block; width: 7rem; margin-right: 0.5rem"
						>
							{bar.label}
						</span>
						<span
							class="h-3 rounded-sm"
							style="display: inline-block; height: 0.75rem; border-radius: 0.125rem; margin-right: 0.5rem; width: {(bar.value /
								barScale) *
								70}%; background-color: {bar.colour}"
							title="{bar.label}: {formatMoney(bar.value)}"
						></span>
						<span class="font-medium tabular-nums">{formatMoney(bar.value)}</span>
					</div>
				{/each}
				<p class="text-xs text-muted-foreground">
					Realistic scenario at {formatDuration(forecast.months)}.
				</p>
			</div>
		{/if}

		{#if byScenario}
			<table class="w-full text-sm border-collapse mb-4">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Scenario</th>
						<th class="py-2 px-2 font-medium text-right">Costs taken out</th>
						<th class="py-2 px-2 font-medium text-right">At the horizon</th>
						<th class="py-2 pl-2 font-medium text-right">vs no costs</th>
					</tr>
				</thead>
				<tbody>
					{#each FORECAST_SCENARIOS as scenario (scenario)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-2">
								<span class="font-medium">{FORECAST_SCENARIO_LABELS[scenario]}</span>
								<span class="text-xs text-muted-foreground ml-1">
									{forecast.rates[scenario]}% a year
								</span>
							</td>
							<td class="py-2 px-2 text-right tabular-nums">
								{formatMoney(byScenario[scenario].totalOccurring)}
							</td>
							<td class="py-2 px-2 text-right tabular-nums">
								{formatMoney(byScenario[scenario].costedFinal)}
							</td>
							<td class="py-2 pl-2 text-right tabular-nums">
								{formatMoney(-byScenario[scenario].shortfall)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-muted-foreground mb-4">
				The same costs, on the same dates, in each scenario — a stronger growth assumption also
				means more foregone growth on the withdrawn pounds, so the optimistic scenario can lose more
				in pounds even though it ends up further ahead overall.
			</p>
		{/if}

		{#if rows.length > 0}
			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Horizon</th>
						<th class="py-2 px-2 font-medium text-right">No costs</th>
						<th class="py-2 px-2 font-medium text-right">With the costs</th>
						<th class="py-2 pl-2 font-medium text-right">Difference</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.offset)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-2">
								<span class="font-medium">{formatDuration(row.offset)}</span>
								<span class="text-xs text-muted-foreground ml-1">{formatDate(row)}</span>
							</td>
							<td class="py-2 px-2 text-right tabular-nums">{formatMoney(row.baseline)}</td>
							<td class="py-2 px-2 text-right tabular-nums">{formatMoney(row.costed)}</td>
							<td class="py-2 pl-2 text-right tabular-nums">
								{formatMoney(row.gap)}
								<span class="text-xs text-muted-foreground ml-1">{formatShare(row.gapShare)}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-muted-foreground mt-3">
				Realistic scenario, at the same horizons as the tables above.
			</p>
		{/if}
	{/if}
</div>
