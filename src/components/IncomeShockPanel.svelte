<script>
	/**
	 * Income shock overlay — README.md → "Advanced Scenarios": "Income shock (job loss, illness)"
	 * (issue #133).
	 *
	 * Four controls describe the shock; `$lib/income-shock.js` projects the same position the panel
	 * above projects, with contributions cut for the stated window, and this component shows the two
	 * lines against each other — the same shape as `StressTestPanel`, just for a standing-order event
	 * instead of a market event.
	 *
	 * It takes the baseline `Forecast` and the *position* that produced it, rather than deriving its
	 * own, for the same reason `StressTestPanel` does: the overlay is built from the baseline's own
	 * anchor, horizon and spread, so the growth/spread/horizon controls above drive both lines and there
	 * is no second set of assumptions on the tab that could disagree with the first.
	 */
	import { FORECAST_SCENARIOS, FORECAST_SCENARIO_LABELS } from '$lib/forecast.js';
	import {
		DEFAULT_INCOME_SHOCK,
		compareIncomeShock,
		incomeShockForecast,
		incomeShockImpact,
		incomeShockImpacts,
		normaliseIncomeShock
	} from '$lib/income-shock.js';
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

	// Off by default, matching StressTestPanel: the forecast tab's job is to show the plan, and a
	// shock is something the user asks to see. Every dial starts at `income-shock.js`'s own defaults.
	let enabled = $state(false);
	let dropPct = $state(DEFAULT_INCOME_SHOCK.dropPct);
	let startYears = $state(DEFAULT_INCOME_SHOCK.atMonth / 12);
	let durationMonths = $state(DEFAULT_INCOME_SHOCK.durationMonths);
	let rampMonths = $state(DEFAULT_INCOME_SHOCK.rampMonths);

	// Slider bounds are UI convenience, not spec — README.md gives no ranges. `normaliseIncomeShock`
	// still clamps whatever the paired number field accepts: a drop up to contributions stopping
	// entirely, a start inside the next decade, a spell out of work up to three years, and a taper of
	// up to two years for an illness that recovers gradually.
	const DROP_MAX = 100;
	const DURATION_MONTHS_MAX = 36;
	const RAMP_MONTHS_MAX = 24;

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

	const shock = $derived(
		normaliseIncomeShock({
			dropPct: parse(dropPct, DEFAULT_INCOME_SHOCK.dropPct),
			// Timing is typed in years because that is how a planning horizon is discussed, but the
			// model counts months. Round to the nearest month and never to the anchor itself: offset 0
			// is the position the user is already in, which no forecast may restate.
			atMonth: Math.max(1, Math.round(parse(startYears, 1) * 12)),
			durationMonths: parse(durationMonths, DEFAULT_INCOME_SHOCK.durationMonths),
			rampMonths: parse(rampMonths, DEFAULT_INCOME_SHOCK.rampMonths)
		})
	);

	// Built from the baseline's own anchor/horizon/spread, so the two lines are the same projection
	// under two sets of events rather than two differently-shaped forecasts on one screen.
	const shocked = $derived(
		enabled
			? incomeShockForecast(
					{
						investments: position.investments,
						debts: position.debts ?? [],
						start: forecast.start,
						months: forecast.months,
						spread: forecast.spread
					},
					options,
					shock
				)
			: null
	);

	const impact = $derived(shocked ? incomeShockImpact(forecast, shocked) : null);
	const byScenario = $derived(shocked ? incomeShockImpacts(forecast, shocked) : null);
	const rows = $derived(shocked ? compareIncomeShock(forecast, shocked, 'realistic', offsets) : []);

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
	 * `StressTestPanel`'s horizon bars use, for the same reason: no chart yet (#12).
	 */
	const horizonBars = $derived(
		impact && impact.baselineFinal > 0 && impact.shockedFinal > 0
			? [
					{ key: 'baseline', label: 'No shock', value: impact.baselineFinal, colour: '#0ea5e9' },
					{
						key: 'shocked',
						label: 'With the shock',
						value: impact.shockedFinal,
						colour: '#f97316'
					}
				]
			: []
	);
	const barScale = $derived(Math.max(...horizonBars.map((bar) => bar.value), 1));
</script>

<div class="mt-5 pt-4 border-t border-border">
	<h3 class="text-sm font-semibold mb-1">Income shock: job loss or illness</h3>
	<p class="text-xs text-muted-foreground mb-3">
		The market above carries on exactly as assumed — this models something else: your ability to pay
		in stopping or shrinking for a while, then resuming. Say how much of your contributions go
		missing, for how long, starting when, and — for an illness that gets better gradually rather
		than a job loss that ends cleanly — how long it takes to taper back to normal.
	</p>

	<label class="flex items-center gap-1.5 text-sm font-medium mb-3">
		<input type="checkbox" bind:checked={enabled} />
		Model an income shock
	</label>

	<div class="flex flex-wrap items-end gap-4 mb-4" class:opacity-50={!enabled}>
		<div class="flex flex-col gap-1">
			<span id="shock-drop-label" class="text-xs font-medium">Contribution drop (%)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="shock-drop-label"
					min="0"
					max={DROP_MAX}
					step="1"
					disabled={!enabled}
					bind:value={dropPct}
					class="w-32 accent-black"
				/>
				<input
					id="shock-drop"
					type="number"
					aria-labelledby="shock-drop-label"
					min="0"
					max="100"
					step="1"
					disabled={!enabled}
					bind:value={dropPct}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="shock-timing-label" class="text-xs font-medium">Starts in (years)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="shock-timing-label"
					min="0"
					max={Math.max(1, Math.round(horizonYears))}
					step="0.5"
					disabled={!enabled}
					bind:value={startYears}
					class="w-32 accent-black"
				/>
				<input
					id="shock-timing"
					type="number"
					aria-labelledby="shock-timing-label"
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
			<span id="shock-duration-label" class="text-xs font-medium">Lasts (months)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="shock-duration-label"
					min="0"
					max={DURATION_MONTHS_MAX}
					step="1"
					disabled={!enabled}
					bind:value={durationMonths}
					class="w-32 accent-black"
				/>
				<input
					id="shock-duration"
					type="number"
					aria-labelledby="shock-duration-label"
					min="0"
					max="1200"
					step="1"
					disabled={!enabled}
					bind:value={durationMonths}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="shock-ramp-label" class="text-xs font-medium">Recovery ramp (months)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="shock-ramp-label"
					min="0"
					max={RAMP_MONTHS_MAX}
					step="1"
					disabled={!enabled}
					bind:value={rampMonths}
					class="w-32 accent-black"
				/>
				<input
					id="shock-ramp"
					type="number"
					aria-labelledby="shock-ramp-label"
					min="0"
					max="1200"
					step="1"
					disabled={!enabled}
					bind:value={rampMonths}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
				/>
			</div>
		</div>
	</div>

	{#if !enabled}
		<p class="text-xs text-muted-foreground">
			Tick the box to overlay a {shock.dropPct}% contribution drop {shock.atMonth === 12
				? 'a year'
				: formatDuration(shock.atMonth)} from now on the projection above.
		</p>
	{:else if !impact || !shocked}
		<p class="text-sm text-muted-foreground">Nothing projected yet.</p>
	{:else if shock.dropPct === 0}
		<p class="text-sm text-muted-foreground">
			A 0% drop is no shock: the overlay is the forecast above, unchanged. Raise the drop to see
			one.
		</p>
	{:else if !impact.occurs}
		<p class="text-sm text-muted-foreground">
			The shock is dated {formatDuration(shock.atMonth)} out, past the end of this forecast's
			{formatDuration(forecast.months)} — there is nothing to overlay. Bring it forward, or lengthen the
			horizon above.
		</p>
	{:else}
		<p class="text-sm mb-3">
			<span class="font-medium">
				A {shock.dropPct}% contribution drop from {formatDate(impact.date)}
			</span>
			{#if shock.rampMonths > 0}
				runs for {formatDuration(shock.durationMonths)}, then tapers back to normal over
				{formatDuration(shock.rampMonths)}, reaching full contributions again by
				{formatDate(impact.rampEndsDate)}.
			{:else}
				runs for {formatDuration(shock.durationMonths)} before contributions resume in full from
				{formatDate(impact.rampEndsDate)}.
			{/if}
		</p>

		<p class="text-sm text-muted-foreground mb-3">
			<span class="font-medium text-foreground">{formatMoney(impact.contributionsForgone)}</span>
			in contributions never gets paid in — nothing is made up once contributions resume. By
			{formatDuration(forecast.months)} that gap has grown to
			<span class="font-medium text-foreground">
				{formatMoney(impact.shortfall)} ({formatShare(impact.shortfallShare)})
			</span>
			less net worth than the unshocked forecast — {formatMoney(impact.compoundingLoss)} of that is growth
			the missing contributions would themselves have earned.
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
						<th class="py-2 pl-2 font-medium text-right">vs no shock</th>
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
								{formatMoney(byScenario[scenario].shockedFinal)}
							</td>
							<td class="py-2 pl-2 text-right tabular-nums">
								{formatMoney(-byScenario[scenario].shortfall)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-muted-foreground mb-4">
				The same shock, on the same date, in each scenario — a stronger growth assumption also means
				more foregone growth on the missing contributions, so the optimistic scenario can lose more
				in pounds even though it ends up further ahead overall.
			</p>
		{/if}

		{#if rows.length > 0}
			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Horizon</th>
						<th class="py-2 px-2 font-medium text-right">No shock</th>
						<th class="py-2 px-2 font-medium text-right">With the shock</th>
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
							<td class="py-2 px-2 text-right tabular-nums">{formatMoney(row.shocked)}</td>
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
