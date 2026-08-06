<script>
	/**
	 * Stress test overlay — README.md → "Forecast": "Stress test overlay: crash magnitude, timing,
	 * recovery rate, recovery duration" (issue #21).
	 *
	 * Four controls describe a crash; `$lib/stress-test.js` projects the same position the panel above
	 * projects, with that crash in it, and this component shows the two lines against each other.
	 *
	 * It takes the baseline `Forecast` and the *position* that produced it, rather than deriving its
	 * own: the overlay is built from the baseline's own anchor, horizon and spread (`forecast.start` /
	 * `.months` / `.spread`), so the growth, spread and horizon controls above drive both lines and
	 * there is no second set of assumptions on the tab that could disagree with the first. `offsets`
	 * is passed in for the same reason `CompoundingPanel` takes it — the comparison table follows
	 * whichever rows the scenario summary table is showing, so an age zoom (#19) moves all three
	 * tables together.
	 *
	 * There is still no chart (#12, LayerChart integration, remains open), so "overlay" here is a
	 * comparison table plus a two-bar horizon comparison rather than a second line drawn over the
	 * forecast. `stressForecast` returns an ordinary `Forecast`, so #12 can hand its stressed series
	 * straight to the same chart component that draws the baseline once it exists.
	 */
	import { FORECAST_SCENARIOS, FORECAST_SCENARIO_LABELS } from '$lib/forecast.js';
	import { ageAtPoint } from '$lib/milestones.js';
	import {
		DEFAULT_STRESS_TEST,
		compareStressed,
		normaliseStressTest,
		stressForecast,
		stressImpact,
		stressImpacts
	} from '$lib/stress-test.js';

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

	// Off by default: the forecast tab's job is to show the plan, and the crash is something the user
	// asks to see. Every dial starts at `stress-test.js`'s own documented defaults.
	let enabled = $state(false);
	let magnitude = $state(DEFAULT_STRESS_TEST.magnitude);
	let crashYears = $state(DEFAULT_STRESS_TEST.atMonth / 12);
	let recoveryRate = $state(DEFAULT_STRESS_TEST.recoveryRate);
	let recoveryMonths = $state(DEFAULT_STRESS_TEST.recoveryMonths);

	// Slider bounds are UI convenience, not spec — README.md gives no ranges. `normaliseStressTest`
	// still clamps whatever the paired number field accepts, so these are only where the drag handle
	// lives: falls up to a total wipeout, a crash inside the next decade, a rebound between a lost
	// decade and a violent one, and a recovery window of up to five years.
	const MAGNITUDE_MAX = 100;
	const RECOVERY_RATE_MIN = -20;
	const RECOVERY_RATE_MAX = 30;
	const RECOVERY_MONTHS_MAX = 60;

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

	const stress = $derived(
		normaliseStressTest({
			magnitude: parse(magnitude, DEFAULT_STRESS_TEST.magnitude),
			// Timing is typed in years because that is how a planning horizon is discussed, but the
			// model counts months. Round to the nearest month and never to the anchor itself: offset 0
			// is the position the user is already in, which no forecast may restate.
			atMonth: Math.max(1, Math.round(parse(crashYears, 1) * 12)),
			recoveryRate: parse(recoveryRate, DEFAULT_STRESS_TEST.recoveryRate),
			recoveryMonths: parse(recoveryMonths, DEFAULT_STRESS_TEST.recoveryMonths)
		})
	);

	// Built from the baseline's own anchor/horizon/spread, so the two lines are the same projection
	// under two sets of events rather than two differently-shaped forecasts on one screen.
	const stressed = $derived(
		enabled
			? stressForecast(
					{
						investments: position.investments,
						debts: position.debts ?? [],
						start: forecast.start,
						months: forecast.months,
						spread: forecast.spread
					},
					options,
					stress
				)
			: null
	);

	const impact = $derived(stressed ? stressImpact(forecast, stressed) : null);
	const byScenario = $derived(stressed ? stressImpacts(forecast, stressed) : null);
	const rows = $derived(stressed ? compareStressed(forecast, stressed, 'realistic', offsets) : []);

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
	 * Two bars at the horizon, scaled to whichever projection ends higher. Colours are inline for the
	 * same reason `CompoundingPanel`'s are: Tailwind's utilities are inert app-wide today, and a bar
	 * with no colour is not a smaller bar, it is no bar at all.
	 */
	const horizonBars = $derived(
		impact && impact.baselineFinal > 0 && impact.stressedFinal > 0
			? [
					{ key: 'baseline', label: 'No crash', value: impact.baselineFinal, colour: '#0ea5e9' },
					{
						key: 'stressed',
						label: 'With the crash',
						value: impact.stressedFinal,
						colour: '#f97316'
					}
				]
			: []
	);
	const barScale = $derived(Math.max(...horizonBars.map((bar) => bar.value), 1));
</script>

<div class="mt-5 pt-4 border-t border-border">
	<h3 class="text-sm font-semibold mb-1">Stress test overlay</h3>
	<p class="text-xs text-muted-foreground mb-3">
		The three scenarios above are the same long-run average shifted up and down — none of them is a
		crash. This one is: the market falls by the amount you name, in the month you name, then
		rebounds at its own rate for as long as you say before ordinary growth resumes. Contributions
		carry on throughout, buying in at the lower prices.
	</p>

	<label class="flex items-center gap-1.5 text-sm font-medium mb-3">
		<input type="checkbox" bind:checked={enabled} />
		Model a market crash
	</label>

	<div class="flex flex-wrap items-end gap-4 mb-4" class:opacity-50={!enabled}>
		<div class="flex flex-col gap-1">
			<span id="stress-magnitude-label" class="text-xs font-medium">Crash magnitude (%)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="stress-magnitude-label"
					min="0"
					max={MAGNITUDE_MAX}
					step="1"
					disabled={!enabled}
					bind:value={magnitude}
					class="w-32 accent-black"
				/>
				<input
					id="stress-magnitude"
					type="number"
					aria-labelledby="stress-magnitude-label"
					min="0"
					max="100"
					step="1"
					disabled={!enabled}
					bind:value={magnitude}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="stress-timing-label" class="text-xs font-medium">Crash in (years)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="stress-timing-label"
					min="0"
					max={Math.max(1, Math.round(horizonYears))}
					step="0.5"
					disabled={!enabled}
					bind:value={crashYears}
					class="w-32 accent-black"
				/>
				<input
					id="stress-timing"
					type="number"
					aria-labelledby="stress-timing-label"
					min="0"
					max="100"
					step="0.5"
					disabled={!enabled}
					bind:value={crashYears}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="stress-recovery-rate-label" class="text-xs font-medium">Recovery rate (%/yr)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="stress-recovery-rate-label"
					min={RECOVERY_RATE_MIN}
					max={RECOVERY_RATE_MAX}
					step="0.5"
					disabled={!enabled}
					bind:value={recoveryRate}
					class="w-32 accent-black"
				/>
				<input
					id="stress-recovery-rate"
					type="number"
					aria-labelledby="stress-recovery-rate-label"
					min="-100"
					max="100"
					step="0.5"
					disabled={!enabled}
					bind:value={recoveryRate}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="stress-recovery-months-label" class="text-xs font-medium">
				Recovery lasts (months)
			</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="stress-recovery-months-label"
					min="0"
					max={RECOVERY_MONTHS_MAX}
					step="1"
					disabled={!enabled}
					bind:value={recoveryMonths}
					class="w-32 accent-black"
				/>
				<input
					id="stress-recovery-months"
					type="number"
					aria-labelledby="stress-recovery-months-label"
					min="0"
					max="1200"
					step="1"
					disabled={!enabled}
					bind:value={recoveryMonths}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
				/>
			</div>
		</div>
	</div>

	{#if !enabled}
		<p class="text-xs text-muted-foreground">
			Tick the box to overlay a {stress.magnitude}% crash {stress.atMonth === 12
				? 'a year'
				: formatDuration(stress.atMonth)} from now on the projection above.
		</p>
	{:else if !impact || !stressed}
		<p class="text-sm text-muted-foreground">Nothing projected yet.</p>
	{:else if stress.magnitude === 0}
		<p class="text-sm text-muted-foreground">
			A 0% crash is no crash: the overlay is the forecast above, unchanged. Raise the magnitude to
			see one.
		</p>
	{:else if !impact.occurs}
		<p class="text-sm text-muted-foreground">
			The crash is dated {formatDuration(stress.atMonth)} out, past the end of this forecast's
			{formatDuration(forecast.months)} — there is nothing to overlay. Bring it forward, or lengthen the
			horizon above.
		</p>
	{:else}
		<p class="text-sm mb-3">
			<span class="font-medium">
				A {stress.magnitude}% crash in {formatDate(impact.date)}
			</span>
			takes {formatMoney(impact.drop)} off a {formatMoney(impact.before)} position, leaving
			{formatMoney(impact.after)}.
			{#if stress.recoveryMonths > 0}
				It then rebounds at {stress.recoveryRate}% a year for {formatDuration(
					stress.recoveryMonths
				)} before your {forecast.rates.realistic}% assumption resumes.
			{:else}
				There is no rebound: your {forecast.rates.realistic}% assumption resumes the month after.
			{/if}
		</p>

		<p class="text-sm text-muted-foreground mb-3">
			{#if impact.recoveredAt !== null && impact.monthsToRecover !== null}
				<span class="font-medium text-foreground">Back to {formatMoney(impact.before)}</span>
				in {formatDate(impact.recoveredDate)} — {formatDuration(impact.monthsToRecover)} after the crash,
				contributions included.
			{:else}
				You never get back to {formatMoney(impact.before)} within this forecast's {formatDuration(
					forecast.months
				)}.
			{/if}
			{#if impact.caughtUpAt !== null}
				The rebound is strong enough that the stressed projection catches the unstressed one up by
				{formatDate(stressed.series.realistic[impact.caughtUpAt])}.
			{:else if impact.shortfall > 0}
				Getting back to where you were is not the same as catching up: at the horizon you land
				<span class="font-medium text-foreground">
					{formatMoney(impact.shortfall)} ({formatShare(impact.shortfallShare)}) short
				</span>
				of the unstressed forecast, because the pounds the crash took never earned anything after it.
			{/if}
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
						<th class="py-2 px-2 font-medium text-right">Crash costs</th>
						<th class="py-2 px-2 font-medium text-right">Back to pre-crash</th>
						<th class="py-2 px-2 font-medium text-right">At the horizon</th>
						<th class="py-2 pl-2 font-medium text-right">vs no crash</th>
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
								{formatMoney(byScenario[scenario].drop)}
							</td>
							<td class="py-2 px-2 text-right">
								{#if byScenario[scenario].recoveredDate}
									{formatMonth(
										/** @type {{ month: number, year: number }} */ (
											byScenario[scenario].recoveredDate
										)
									)}
								{:else}
									<span class="text-muted-foreground">never</span>
								{/if}
							</td>
							<td class="py-2 px-2 text-right tabular-nums">
								{formatMoney(byScenario[scenario].stressedFinal)}
							</td>
							<td class="py-2 pl-2 text-right tabular-nums">
								{formatMoney(-byScenario[scenario].shortfall)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-muted-foreground mb-4">
				The same crash, on the same date, in each scenario — the recovery rate takes the scenario's
				own ±{forecast.spread}pp spread too, so the band survives the crash rather than collapsing
				onto one line.
			</p>
		{/if}

		{#if rows.length > 0}
			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Horizon</th>
						<th class="py-2 px-2 font-medium text-right">No crash</th>
						<th class="py-2 px-2 font-medium text-right">With the crash</th>
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
							<td class="py-2 px-2 text-right tabular-nums">{formatMoney(row.stressed)}</td>
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
