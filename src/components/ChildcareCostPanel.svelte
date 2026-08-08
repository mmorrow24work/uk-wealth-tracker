<script>
	/**
	 * Childcare cost overlay — README.md → "Advanced Scenarios": "Childcare cost modelling"
	 * (issue #135).
	 *
	 * Five controls describe the bill; `$lib/childcare-cost.js` projects the same position the panel
	 * above projects, with contributions reduced by the stated monthly cost, and this component shows
	 * the two lines against each other — the same shape as `IncomeShockPanel`, just for a recurring
	 * cost eating into contribution capacity instead of a contribution-percentage drop.
	 *
	 * It takes the baseline `Forecast` and the *position* that produced it, rather than deriving its
	 * own, for the same reason `IncomeShockPanel` does: the overlay is built from the baseline's own
	 * anchor, horizon and spread, so the growth/spread/horizon controls above drive both lines and
	 * there is no second set of assumptions on the tab that could disagree with the first.
	 *
	 * This models a flat or stepped £-per-month figure only — not UK Tax-Free Childcare, free hours
	 * entitlement, or any other means-tested scheme (see `childcare-cost.js`'s module doc for why that
	 * is an explicit non-goal, not an oversight).
	 */
	import { FORECAST_SCENARIOS, FORECAST_SCENARIO_LABELS } from '$lib/forecast.js';
	import {
		DEFAULT_CHILDCARE_COST,
		childcareCostForecast,
		childcareCostImpact,
		childcareCostImpacts,
		compareChildcareCost,
		normaliseChildcareCost
	} from '$lib/childcare-cost.js';
	import { ageAtPoint } from '$lib/milestones.js';

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

	// Off by default, matching IncomeShockPanel: the forecast tab's job is to show the plan, and a
	// childcare bill is something the user asks to see. Every dial starts at `childcare-cost.js`'s
	// own defaults.
	let enabled = $state(false);
	let monthlyCost = $state(DEFAULT_CHILDCARE_COST.monthlyCost);
	let startYears = $state(DEFAULT_CHILDCARE_COST.atMonth / 12);
	let durationMonths = $state(DEFAULT_CHILDCARE_COST.durationMonths);
	let hasSecondStage = $state(false);
	let stepMonthlyCost = $state(DEFAULT_CHILDCARE_COST.stepMonthlyCost);
	let stepDurationMonths = $state(84);

	// Slider bounds are UI convenience, not spec — README.md gives no ranges. `normaliseChildcareCost`
	// still clamps whatever the paired number field accepts: a bill up to a sanity backstop, a start
	// inside the next decade, a first stage up to a decade of childcare and a second stage the same.
	const MONTHLY_COST_MAX = 3_000;
	const DURATION_MONTHS_MAX = 120;

	/**
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

	const cost = $derived(
		normaliseChildcareCost({
			monthlyCost: parse(monthlyCost, DEFAULT_CHILDCARE_COST.monthlyCost),
			// Timing is typed in years because that is how a planning horizon is discussed, but the
			// model counts months. Round to the nearest month and never to the anchor itself: offset 0
			// is the position the user is already in, which no forecast may restate.
			atMonth: Math.max(1, Math.round(parse(startYears, 1) * 12)),
			durationMonths: parse(durationMonths, DEFAULT_CHILDCARE_COST.durationMonths),
			stepMonthlyCost: hasSecondStage
				? parse(stepMonthlyCost, DEFAULT_CHILDCARE_COST.stepMonthlyCost)
				: 0,
			stepDurationMonths: hasSecondStage ? parse(stepDurationMonths, 0) : 0
		})
	);

	// Built from the baseline's own anchor/horizon/spread, so the two lines are the same projection
	// under two sets of events rather than two differently-shaped forecasts on one screen.
	const costed = $derived(
		enabled
			? childcareCostForecast(
					{
						investments: position.investments,
						debts: position.debts ?? [],
						start: forecast.start,
						months: forecast.months,
						spread: forecast.spread
					},
					options,
					cost
				)
			: null
	);

	const impact = $derived(costed ? childcareCostImpact(forecast, costed) : null);
	const byScenario = $derived(costed ? childcareCostImpacts(forecast, costed) : null);
	const rows = $derived(costed ? compareChildcareCost(forecast, costed, 'realistic', offsets) : []);

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
	 * `IncomeShockPanel`'s horizon bars use, for the same reason: no chart yet (#12).
	 */
	const horizonBars = $derived(
		impact && impact.baselineFinal > 0 && impact.costedFinal > 0
			? [
					{
						key: 'baseline',
						label: 'No childcare cost',
						value: impact.baselineFinal,
						colour: '#0ea5e9'
					},
					{
						key: 'costed',
						label: 'With the cost',
						value: impact.costedFinal,
						colour: '#f97316'
					}
				]
			: []
	);
	const barScale = $derived(Math.max(...horizonBars.map((bar) => bar.value), 1));
</script>

<div class="mt-5 pt-4 border-t border-border">
	<h3 class="text-sm font-semibold mb-1">Childcare costs</h3>
	<p class="text-xs text-muted-foreground mb-3">
		The market above carries on exactly as assumed — this models something else: a recurring monthly
		bill (nursery, then wraparound care) that eats into what's left to contribute for a stated date
		range. This is a flat or stepped £-a-month figure you type in — it doesn't model Tax-Free
		Childcare, free hours or any other means-tested scheme, so enter your own net cost.
	</p>

	<label class="flex items-center gap-1.5 text-sm font-medium mb-3">
		<input type="checkbox" bind:checked={enabled} />
		Model a childcare cost
	</label>

	<div class="flex flex-wrap items-end gap-4 mb-3" class:opacity-50={!enabled}>
		<div class="flex flex-col gap-1">
			<span id="childcare-cost-label" class="text-xs font-medium">Monthly cost (£)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="childcare-cost-label"
					min="0"
					max={MONTHLY_COST_MAX}
					step="10"
					disabled={!enabled}
					bind:value={monthlyCost}
					class="w-32 accent-black"
				/>
				<input
					id="childcare-cost"
					type="number"
					aria-labelledby="childcare-cost-label"
					min="0"
					max={100_000}
					step="10"
					disabled={!enabled}
					bind:value={monthlyCost}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24 disabled:opacity-50"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="childcare-timing-label" class="text-xs font-medium">Starts in (years)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="childcare-timing-label"
					min="0"
					max={Math.max(1, Math.round(horizonYears))}
					step="0.5"
					disabled={!enabled}
					bind:value={startYears}
					class="w-32 accent-black"
				/>
				<input
					id="childcare-timing"
					type="number"
					aria-labelledby="childcare-timing-label"
					min="0"
					max="100"
					step="0.5"
					disabled={!enabled}
					bind:value={startYears}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="childcare-duration-label" class="text-xs font-medium">Lasts (months)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="childcare-duration-label"
					min="0"
					max={DURATION_MONTHS_MAX}
					step="1"
					disabled={!enabled}
					bind:value={durationMonths}
					class="w-32 accent-black"
				/>
				<input
					id="childcare-duration"
					type="number"
					aria-labelledby="childcare-duration-label"
					min="0"
					max="1200"
					step="1"
					disabled={!enabled}
					bind:value={durationMonths}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
				/>
			</div>
		</div>
	</div>

	<label
		class="flex items-center gap-1.5 text-xs text-muted-foreground mb-3"
		class:opacity-50={!enabled}
	>
		<input type="checkbox" disabled={!enabled} bind:checked={hasSecondStage} />
		Cost steps down afterwards (e.g. nursery, then before/after-school club)
	</label>

	{#if hasSecondStage}
		<div class="flex flex-wrap items-end gap-4 mb-4" class:opacity-50={!enabled}>
			<div class="flex flex-col gap-1">
				<span id="childcare-step-cost-label" class="text-xs font-medium">Second-stage cost (£)</span
				>
				<div class="flex items-center gap-2">
					<input
						type="range"
						aria-labelledby="childcare-step-cost-label"
						min="0"
						max={MONTHLY_COST_MAX}
						step="10"
						disabled={!enabled}
						bind:value={stepMonthlyCost}
						class="w-32 accent-black"
					/>
					<input
						id="childcare-step-cost"
						type="number"
						aria-labelledby="childcare-step-cost-label"
						min="0"
						max={100_000}
						step="10"
						disabled={!enabled}
						bind:value={stepMonthlyCost}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-24 disabled:opacity-50"
					/>
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<span id="childcare-step-duration-label" class="text-xs font-medium"
					>Second stage lasts (months)</span
				>
				<div class="flex items-center gap-2">
					<input
						type="range"
						aria-labelledby="childcare-step-duration-label"
						min="0"
						max={DURATION_MONTHS_MAX}
						step="1"
						disabled={!enabled}
						bind:value={stepDurationMonths}
						class="w-32 accent-black"
					/>
					<input
						id="childcare-step-duration"
						type="number"
						aria-labelledby="childcare-step-duration-label"
						min="0"
						max="1200"
						step="1"
						disabled={!enabled}
						bind:value={stepDurationMonths}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
					/>
				</div>
			</div>
		</div>
	{/if}

	{#if !enabled}
		<p class="text-xs text-muted-foreground">
			Tick the box to overlay a {formatMoney(cost.monthlyCost)}/month childcare cost {cost.atMonth ===
			12
				? 'a year'
				: formatDuration(cost.atMonth)} from now on the projection above.
		</p>
	{:else if !impact || !costed}
		<p class="text-sm text-muted-foreground">Nothing projected yet.</p>
	{:else if cost.monthlyCost === 0 && (cost.stepDurationMonths === 0 || cost.stepMonthlyCost === 0)}
		<p class="text-sm text-muted-foreground">
			A £0 cost is no overlay: the projection above is unchanged. Raise the monthly cost to see one.
		</p>
	{:else if !impact.occurs}
		<p class="text-sm text-muted-foreground">
			The cost is dated {formatDuration(cost.atMonth)} out, past the end of this forecast's
			{formatDuration(forecast.months)} — there is nothing to overlay. Bring it forward, or lengthen the
			horizon above.
		</p>
	{:else}
		<p class="text-sm mb-3">
			<span class="font-medium">
				A {formatMoney(cost.monthlyCost)}/month childcare cost from {formatDate(impact.date)}
			</span>
			{#if cost.stepDurationMonths > 0}
				runs for {formatDuration(cost.durationMonths)}, then steps to {formatMoney(
					cost.stepMonthlyCost
				)}/month for {formatDuration(cost.stepDurationMonths)}, ending
				{formatDate(impact.stepStageEndsDate)}.
			{:else}
				runs for {formatDuration(cost.durationMonths)}, ending {formatDate(
					impact.stepStageEndsDate
				)}.
			{/if}
		</p>

		<p class="text-sm text-muted-foreground mb-3">
			<span class="font-medium text-foreground">{formatMoney(impact.contributionsForgone)}</span>
			in contributions never gets paid in — nothing is made up once the cost stops. By
			{formatDuration(forecast.months)} that gap has grown to
			<span class="font-medium text-foreground">
				{formatMoney(impact.shortfall)} ({formatShare(impact.shortfallShare)})
			</span>
			less net worth than the forecast without the cost — {formatMoney(impact.compoundingLoss)} of that
			is growth the reduced contributions would themselves have earned.
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
						<th class="py-2 px-2 font-medium text-right">Contributions forgone</th>
						<th class="py-2 px-2 font-medium text-right">At the horizon</th>
						<th class="py-2 pl-2 font-medium text-right">vs no cost</th>
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
								{formatMoney(byScenario[scenario].contributionsForgone)}
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
				The same cost, on the same dates, in each scenario — a stronger growth assumption also means
				more foregone growth on the reduced contributions, so the optimistic scenario can lose more
				in pounds even though it ends up further ahead overall.
			</p>
		{/if}

		{#if rows.length > 0}
			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Horizon</th>
						<th class="py-2 px-2 font-medium text-right">No cost</th>
						<th class="py-2 px-2 font-medium text-right">With the cost</th>
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
				Realistic scenario, at the same horizons as the tables above. Rows before
				{formatDate(impact.date)} are identical in both projections — nothing has happened yet.
			</p>
		{/if}
	{/if}
</div>
