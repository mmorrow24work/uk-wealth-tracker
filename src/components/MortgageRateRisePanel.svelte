<script>
	/**
	 * Mortgage rate rise overlay — README.md → "Advanced Scenarios": "Mortgage rate rise" (issue
	 * #134's engine, `$lib/mortgage-rate-rise.js`; the panel and property picker are #158; the
	 * rate/timing/keep-term controls are #184; the comparison tables and horizon bars below are
	 * #197).
	 *
	 * Unlike `StressTestPanel`/`IncomeShockPanel`, this scenario is per-property rather than
	 * whole-portfolio, so the property picker stays its own control. The three dials below patch
	 * straight into the one `normaliseMortgageRateRise({ ... })` call #158 left as the seam, the same
	 * way `IncomeShockPanel`'s dials patch into `normaliseIncomeShock`. The comparison output —
	 * per-scenario table, month-by-month rows at `offsets`, two horizon bars — is the same shape
	 * those siblings' own overlays already use, fed by `mortgageRateRiseImpacts`/
	 * `compareMortgageRateRise` rather than a second projector.
	 *
	 * It takes the baseline `Forecast` and the *position* that produced it, for the same reason its
	 * siblings do: the overlay is built from the baseline's own anchor, horizon and spread, so the
	 * growth/spread sliders above drive this projection too rather than a second, disagreeing set of
	 * assumptions. `properties` is the one prop neither sibling needs — this scenario has nothing to
	 * run without a real property carrying a real mortgage.
	 */
	import { FORECAST_SCENARIOS, FORECAST_SCENARIO_LABELS } from '$lib/forecast.js';
	import { ageAtPoint } from '$lib/milestones.js';
	import {
		DEFAULT_MORTGAGE_RATE_RISE,
		compareMortgageRateRise,
		findRateRiseProperty,
		mortgageRateRiseForecast,
		mortgageRateRiseImpact,
		mortgageRateRiseImpacts,
		normaliseMortgageRateRise
	} from '$lib/mortgage-rate-rise.js';

	/**
	 * @type {{
	 * 	forecast: import('$lib/forecast.js').Forecast,
	 * 	position: { investments: import('$lib/types.js').Investment[], debts?: import('$lib/types.js').Debt[] },
	 * 	properties?: import('$lib/types.js').Property[],
	 * 	options?: import('$lib/forecast.js').ForecastOptions,
	 * 	offsets?: number[] | null,
	 * 	dobYear?: number | null,
	 * 	dobMonth?: number | null,
	 * 	initialEnabled?: boolean,
	 * 	initialNewRatePct?: number,
	 * 	initialStartYears?: number,
	 * 	initialKeepTerm?: boolean
	 * }}
	 */
	let {
		forecast,
		position,
		properties = [],
		options = {},
		// The month-by-month comparison table follows whichever rows the forecast summary table is
		// showing, exactly as `StressTestPanel`/`IncomeShockPanel`'s own comparison tables do — so an
		// age zoom (#19) moves all of them together rather than this one disagreeing.
		offsets = null,
		dobYear = null,
		dobMonth = null,
		// Seed `enabled` and the three dials below, the same "prop seeds state once" idiom
		// `ForecastProjections` already uses for its own sliders and `NetWorthChart` added
		// (`initialLens`) specifically so a server-rendered test could assert a non-default choice —
		// `svelte/server`'s `render` has no pointer to tick a checkbox or drag a slider with, so this
		// is the only way a test reaches the headline these dials feed.
		initialEnabled = false,
		initialNewRatePct = DEFAULT_MORTGAGE_RATE_RISE.newRatePct,
		initialStartYears = DEFAULT_MORTGAGE_RATE_RISE.atMonth / 12,
		initialKeepTerm = DEFAULT_MORTGAGE_RATE_RISE.keepTerm
	} = $props();

	// Off by default, matching the sibling panels: the forecast tab's job is to show the plan, and a
	// scenario is something the user asks to see.
	// svelte-ignore state_referenced_locally
	let enabled = $state(initialEnabled);

	// The props seed the dials once; from then on the user owns them, same as
	// `ForecastProjections`'s `rate`/`spreadInput`/`horizon`.
	// svelte-ignore state_referenced_locally
	let newRatePctInput = $state(initialNewRatePct);
	// svelte-ignore state_referenced_locally
	let startYearsInput = $state(initialStartYears);
	// svelte-ignore state_referenced_locally
	let keepTerm = $state(initialKeepTerm);

	// Slider bounds are UI convenience, not spec — README.md gives no ranges for a mortgage rate
	// rise, matching every sibling panel's own note. `normaliseMortgageRateRise` still clamps
	// whatever the paired number field accepts to the full 0–100 range; this is only where the drag
	// handle lives, chosen to cover realistic UK mortgage rates (historically well under 15%) at a
	// whole-percent step, matching the config's own "whole-number percent" convention.
	const RATE_SLIDER_MIN = 0;
	const RATE_SLIDER_MAX = 15;

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

	// A rate rise has nothing to change on a property with nothing left owed on it — the picker only
	// ever offers properties that actually carry a mortgage, not the whole portfolio.
	const mortgagedProperties = $derived(
		properties.filter((property) => property.mortgage_balance > 0)
	);

	/** @type {string | null} */
	let propertyId = $state(null);

	// Keeps the picker pointed at a real mortgaged property: defaults to the first one once any
	// exist, and re-points itself if the property it was showing is removed or clears its mortgage —
	// the same "fall back to the first item" pattern `PropertyTracker`'s own chart property picker
	// uses.
	$effect(() => {
		if (mortgagedProperties.length === 0) {
			propertyId = null;
			return;
		}
		if (!mortgagedProperties.some((property) => property.id === propertyId)) {
			propertyId = mortgagedProperties[0].id;
		}
	});

	// Falls back to the first mortgaged property directly, rather than only through the `$effect`
	// above: `$effect`s never run during server rendering (no DOM to react to), so without this
	// fallback here too the initial server-rendered paint would show no property picked at all —
	// this keeps that render, and the interactive one after hydration, in agreement.
	const property = $derived(
		findRateRiseProperty(mortgagedProperties, propertyId ?? '') ?? mortgagedProperties[0] ?? null
	);

	// The one `normaliseMortgageRateRise` call every dial patches into — clamps and rounds whatever
	// the four controls (the picker above, the three below) currently hold into a config the engine
	// accepts, so a half-typed or emptied number field falls back rather than reaching the engine as
	// `NaN`.
	const config = $derived(
		normaliseMortgageRateRise({
			propertyId: propertyId ?? '',
			newRatePct: parse(newRatePctInput, DEFAULT_MORTGAGE_RATE_RISE.newRatePct),
			// Timing is typed in years because that is how a planning horizon is discussed, but the
			// model counts whole months. Round to the nearest month and never to the anchor itself:
			// offset 0 is the position the user is already in, which no scenario may restate — the
			// same guard `IncomeShockPanel`'s own `startYears` keeps.
			atMonth: Math.max(1, Math.round(parse(startYearsInput, 1) * 12)),
			keepTerm
		})
	);

	// Built from the baseline's own anchor/horizon/spread, so the two lines are the same projection
	// under two sets of events rather than two differently-shaped forecasts on one screen.
	const risen = $derived(
		enabled && property
			? mortgageRateRiseForecast(
					{
						investments: position.investments,
						debts: position.debts ?? [],
						start: forecast.start,
						months: forecast.months,
						spread: forecast.spread
					},
					options,
					config,
					properties
				)
			: null
	);

	const impact = $derived(risen ? mortgageRateRiseImpact(forecast, risen, property) : null);
	const byScenario = $derived(risen ? mortgageRateRiseImpacts(forecast, risen, property) : null);
	const rows = $derived(
		risen ? compareMortgageRateRise(forecast, risen, 'realistic', offsets) : []
	);

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

	/** @param {number} amount */
	function formatSignedMoney(amount) {
		return `${amount >= 0 ? '+' : '−'}${currencyFormatter.format(Math.abs(amount))}`;
	}

	/** @param {number | null} share */
	function formatShare(share) {
		return share === null ? '—' : percentFormatter.format(Math.abs(share));
	}

	/**
	 * `extraInterestOverRemainingTerm` is `null` whenever either term it's derived from has no finite
	 * answer (convention 1) — an honest non-answer, not a `£0` that would read as "this costs
	 * nothing".
	 *
	 * @param {number | null} amount
	 */
	function formatOptionalMoney(amount) {
		return amount === null ? '—' : formatMoney(amount);
	}

	/** @param {number} months @returns {string} e.g. "8 months", "3.5 years" */
	function formatDuration(months) {
		if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
		const years = Math.round((months / 12) * 10) / 10;
		return `${years} year${years === 1 ? '' : 's'}`;
	}

	/**
	 * Convention 1/2 of `mortgage-rate-rise.js`'s module doc: `null` is "no finite term exists" (an
	 * interest-only or underwater mortgage), an honest different answer from "0 months left", not a
	 * zero.
	 *
	 * @param {number | null} months
	 */
	function formatRemainingTerm(months) {
		if (months === null) return 'no fixed term to solve for';
		if (months === 0) return 'cleared by then';
		return `${formatDuration(months)} left`;
	}

	/** @param {string | null} name */
	function propertyLabel(name) {
		return name || 'Unnamed property';
	}

	/**
	 * Two bars at the horizon, scaled to whichever projection ends higher — the same shape
	 * `StressTestPanel`/`IncomeShockPanel`'s own horizon bars use, for the same reason: no chart yet
	 * (#12).
	 */
	const horizonBars = $derived(
		impact && impact.baselineFinal > 0 && impact.risenFinal > 0
			? [
					{
						key: 'baseline',
						label: 'No rate change',
						value: impact.baselineFinal,
						colour: '#0ea5e9'
					},
					{
						key: 'risen',
						label: 'With the new rate',
						value: impact.risenFinal,
						colour: '#f97316'
					}
				]
			: []
	);
	const barScale = $derived(Math.max(...horizonBars.map((bar) => bar.value), 1));
</script>

<div class="mt-5 pt-4 border-t border-border">
	<h3 class="text-sm font-semibold mb-1">Mortgage rate rise</h3>
	<p class="text-xs text-muted-foreground mb-3">
		The market above carries on exactly as assumed — this models something else: one property's
		mortgage renewing onto a different rate. Pick a mortgaged property, then say what it renews at,
		when that happens, and whether the remaining term or the monthly payment is the one that stays
		fixed.
	</p>

	{#if properties.length === 0}
		<p class="text-sm text-muted-foreground">
			No properties recorded yet — add one on the Property tab to model a mortgage rate rise.
		</p>
	{:else if mortgagedProperties.length === 0}
		<p class="text-sm text-muted-foreground">
			None of your recorded properties carry a mortgage, so there's nothing here for a rate rise to
			change. Add a mortgage balance on the Property tab to model one.
		</p>
	{:else}
		<label class="flex items-center gap-1.5 text-sm font-medium mb-3">
			<input type="checkbox" bind:checked={enabled} />
			Model a mortgage rate rise
		</label>

		<div class="flex flex-col gap-1 mb-4" class:opacity-50={!enabled}>
			<label class="text-xs font-medium" for="rate-rise-property">Property</label>
			<select
				id="rate-rise-property"
				disabled={!enabled}
				bind:value={propertyId}
				class="border border-input rounded-md px-2 py-1.5 text-sm w-64 disabled:opacity-50"
			>
				{#each mortgagedProperties as p (p.id)}
					<option value={p.id}>{propertyLabel(p.name)}</option>
				{/each}
			</select>
		</div>

		<div class="flex flex-wrap items-end gap-4 mb-4" class:opacity-50={!enabled}>
			<div class="flex flex-col gap-1">
				<span id="rate-rise-rate-label" class="text-xs font-medium">New rate (%)</span>
				<div class="flex items-center gap-2">
					<input
						type="range"
						aria-labelledby="rate-rise-rate-label"
						min={RATE_SLIDER_MIN}
						max={RATE_SLIDER_MAX}
						step="1"
						disabled={!enabled}
						bind:value={newRatePctInput}
						class="w-32 accent-black"
					/>
					<input
						id="rate-rise-rate"
						type="number"
						aria-labelledby="rate-rise-rate-label"
						min="0"
						max="100"
						step="1"
						disabled={!enabled}
						bind:value={newRatePctInput}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
					/>
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<span id="rate-rise-timing-label" class="text-xs font-medium">Takes effect in (years)</span>
				<div class="flex items-center gap-2">
					<input
						type="range"
						aria-labelledby="rate-rise-timing-label"
						min="0"
						max={Math.max(1, Math.round(horizonYears))}
						step="0.5"
						disabled={!enabled}
						bind:value={startYearsInput}
						class="w-32 accent-black"
					/>
					<input
						id="rate-rise-timing"
						type="number"
						aria-labelledby="rate-rise-timing-label"
						min="0"
						max="100"
						step="0.5"
						disabled={!enabled}
						bind:value={startYearsInput}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-20 disabled:opacity-50"
					/>
				</div>
			</div>

			<div
				class="flex flex-col gap-1"
				role="radiogroup"
				aria-label="Keep the term or keep the payment"
			>
				<span class="text-xs font-medium">When the rate changes…</span>
				<label class="flex items-center gap-1.5 text-sm">
					<input
						type="radio"
						name="rate-rise-keep-term"
						disabled={!enabled}
						value={true}
						bind:group={keepTerm}
					/>
					Keep the term — the payment rises to match
				</label>
				<label class="flex items-center gap-1.5 text-sm">
					<input
						type="radio"
						name="rate-rise-keep-term"
						disabled={!enabled}
						value={false}
						bind:group={keepTerm}
					/>
					Keep the payment — the term runs longer instead
				</label>
			</div>
		</div>

		{#if !enabled}
			<p class="text-xs text-muted-foreground">
				Tick the box to see {config.newRatePct}% land {formatDuration(config.atMonth)} from now on
				{propertyLabel(property?.name ?? null)}'s mortgage, {config.keepTerm
					? 'keeping the term'
					: 'keeping the payment'}.
			</p>
		{:else if !impact || !risen}
			<p class="text-sm text-muted-foreground">Nothing projected yet.</p>
		{:else if !impact.hasMortgage}
			<p class="text-sm text-muted-foreground">
				{propertyLabel(property?.name ?? null)} has no outstanding mortgage to change.
			</p>
		{:else if !impact.occurs}
			<p class="text-sm text-muted-foreground">
				The rate change is dated {formatDuration(config.atMonth)} out, past the end of this forecast's
				{formatDuration(forecast.months)} — there is nothing to overlay. Lengthen the horizon above to
				see it.
			</p>
		{:else}
			<p class="text-sm mb-1">
				<span class="font-medium">
					{propertyLabel(property?.name ?? null)}'s mortgage moves to {config.newRatePct}% from
					{formatDate(impact.date)}
				</span>
				— the payment {impact.delta > 0 ? 'rises' : impact.delta < 0 ? 'falls' : 'stays'} from
				{formatMoney(impact.oldPayment)} to {formatMoney(impact.newPayment)}/month ({formatSignedMoney(
					impact.delta
				)}/month), with {formatRemainingTerm(impact.newRemainingTermMonths)} on the mortgage.
			</p>

			<p class="text-sm text-muted-foreground mb-3">
				{#if impact.extraInterestOverRemainingTerm === null}
					That mortgage has no fixed term to solve for — interest-only, or currently underwater — so
					there's no finite total interest to compare either.
				{:else}
					<span class="font-medium text-foreground">
						{formatMoney(Math.abs(impact.extraInterestOverRemainingTerm))}
					</span>
					{impact.extraInterestOverRemainingTerm >= 0 ? 'more' : 'less'} interest paid over the remaining
					term than at the old rate.
				{/if}
			</p>

			<p class="text-sm text-muted-foreground mb-3">
				By {formatDuration(forecast.months)} that leaves the realistic scenario
				<span class="font-medium text-foreground">
					{formatMoney(Math.abs(impact.shortfall))} ({formatShare(impact.shortfallShare)})
				</span>
				{impact.shortfall >= 0 ? 'lower' : 'higher'} than the unchanged forecast — {formatMoney(
					impact.risenFinal
				)} projected net worth versus {formatMoney(impact.baselineFinal)}.
			</p>

			{#if !config.keepTerm}
				<p class="text-sm text-muted-foreground mb-3">
					Keeping the payment leaves monthly cashflow exactly as it was, so the bars and tables
					below are identical to the unchanged forecast in every scenario — that isn't this choice
					costing nothing, it's this forecast having no way to carry the extra interest above
					forward over the longer term instead of showing it here.
				</p>
			{/if}

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
							<th class="py-2 px-2 font-medium text-right">Extra interest</th>
							<th class="py-2 px-2 font-medium text-right">At the horizon</th>
							<th class="py-2 pl-2 font-medium text-right">vs no change</th>
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
									{formatOptionalMoney(byScenario[scenario].extraInterestOverRemainingTerm)}
								</td>
								<td class="py-2 px-2 text-right tabular-nums">
									{formatMoney(byScenario[scenario].risenFinal)}
								</td>
								<td class="py-2 pl-2 text-right tabular-nums">
									{formatMoney(-byScenario[scenario].shortfall)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="text-xs text-muted-foreground mb-4">
					The extra interest is a property of the mortgage, not the market, so it's the same figure
					in every scenario; what differs is how much the diverted contributions would themselves
					have compounded, which is why a stronger growth assumption doesn't shrink the pounds this
					costs even though it ends up further ahead overall.
				</p>
			{/if}

			{#if rows.length > 0}
				<table class="w-full text-sm border-collapse">
					<thead>
						<tr class="border-b border-border text-left">
							<th class="py-2 pr-2 font-medium">Horizon</th>
							<th class="py-2 px-2 font-medium text-right">No rate change</th>
							<th class="py-2 px-2 font-medium text-right">With the new rate</th>
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
								<td class="py-2 px-2 text-right tabular-nums">{formatMoney(row.risen)}</td>
								<td class="py-2 pl-2 text-right tabular-nums">
									{formatMoney(row.gap)}
									<span class="text-xs text-muted-foreground ml-1">{formatShare(row.gapShare)}</span
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="text-xs text-muted-foreground mt-3">
					Realistic scenario, at the same horizons as the tables above.
					{#if !config.keepTerm}
						Every row matches the baseline — keeping the payment leaves this forecast's cashflow
						unchanged, so only the extra interest above shows this choice's cost.
					{:else}
						Rows before {formatDate(impact.date)} are identical in both projections — nothing has happened
						yet.
					{/if}
				</p>
			{/if}
		{/if}
	{/if}
</div>
