<script>
	/**
	 * Building phase vs income phase, with an age slider — README.md → "Dividend Income Planner":
	 * "Building phase (reinvest) vs income phase with age slider" and "DRIP compounding projection
	 * vs income-taken chart" (issue #34's exact scope).
	 *
	 * `$lib/dividends.js`'s `dividendIncomePlan` does the maths: from now to the switch age, every
	 * holding compounds under its own recorded `strategy` (`DividendTracker.svelte` collects that
	 * per holding, this component does not let it be overridden) — that is the building phase, and
	 * the "DRIP compounding projection". From the switch age on, every holding is treated as taking
	 * its dividend as income, whatever its own strategy was recorded as — the income phase, and the
	 * "income-taken chart". One age slider moves the boundary between the two, the same shape
	 * `FireCalculator.svelte`'s own retirement-age slider gives the FIRE tab's accumulation/drawdown
	 * split.
	 *
	 * The current age is read off `profile.dob_year`/`dob_month` where it is on file, the same
	 * fallback-to-a-typed-in-value pattern `FireCalculator.svelte` uses — nothing else on this page
	 * collects an age, so there is nowhere else for it to come from.
	 *
	 * As `FireCalculator.svelte` also does (its own #12 note), the projections here are shown as
	 * sampled tables rather than plotted on a chart — consistent with how every other forecast-style
	 * panel in this app (`CompoundingPanel`, `StressTestPanel`) renders its own series today.
	 */
	import { DIVIDEND_TAX_YEAR } from '$lib/dividend-tax.js';
	import { dividendIncomePlan, dividendPortfolioSummary } from '$lib/dividends.js';
	import { currentCalendarMonth } from '$lib/forecast.js';
	import { ageAtPoint } from '$lib/milestones.js';
	import { createProfile } from '$lib/model.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 * 	dividends?: import('$lib/types.js').Dividend[],
	 * 	profile?: import('$lib/types.js').Profile
	 * }}
	 */
	let { dividends = [], profile = createProfile() } = $props();

	const SWITCH_AGE_MIN = 18;
	const SWITCH_AGE_MAX = 100;
	/** How far past the switch date the income-phase table runs — 30 years, `fire.js`'s own default. */
	const INCOME_PHASE_YEARS = 30;

	const anchorMonth = currentCalendarMonth();

	// svelte-ignore state_referenced_locally
	let currentAge = $state(
		profile.dob_year === null ? 40 : ageAtPoint(profile.dob_year, profile.dob_month, anchorMonth)
	);
	// svelte-ignore state_referenced_locally
	let switchAge = $state(profile.retirement_age >= SWITCH_AGE_MIN ? profile.retirement_age : 65);

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

	const parsedCurrentAge = $derived(parse(currentAge, Number.NaN));
	const parsedSwitchAge = $derived(parse(switchAge, Number.NaN));

	const assumptionsAreValid = $derived(
		parsedCurrentAge >= 0 &&
			parsedCurrentAge <= 120 &&
			parsedSwitchAge >= 0 &&
			parsedSwitchAge <= 120
	);

	const today = $derived(dividendPortfolioSummary(dividends));
	const alreadySwitched = $derived(assumptionsAreValid && parsedSwitchAge <= parsedCurrentAge);

	const plan = $derived(
		assumptionsAreValid
			? dividendIncomePlan(dividends, {
					currentAge: parsedCurrentAge,
					switchAge: parsedSwitchAge,
					incomePhaseMonths: INCOME_PHASE_YEARS * 12,
					start: anchorMonth
				})
			: null
	);

	/**
	 * A series sampled every `step` offsets, always including the first and last point — the same
	 * shape `FireCalculator.svelte`'s own `sample` gives its accumulation/drawdown tables, kept
	 * local here since it is not shared between the two components.
	 *
	 * @template {{ offset: number }} T
	 * @param {readonly T[]} points
	 * @param {number} step
	 * @returns {T[]}
	 */
	function sample(points, step) {
		if (points.length === 0) return [];
		const last = points.at(-1)?.offset ?? 0;
		const wanted = [0, last];
		for (let offset = step; offset < last; offset += step) wanted.push(offset);

		/** @type {T[]} */
		const rows = [];
		for (const offset of wanted.sort((a, b) => a - b)) {
			if (rows.at(-1)?.offset === offset) continue;
			const point = points.find((candidate) => candidate.offset === offset);
			if (point) rows.push(point);
		}
		return rows;
	}

	const buildingRows = $derived(plan ? sample(plan.building.points, 12) : []);
	const incomeRows = $derived(plan ? sample(plan.income.points, 60) : []);

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});
	const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {{ month: number, year: number }} value */
	function formatMonth({ month, year }) {
		return monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
	}

	/** Age at a month offset from today, for the building-phase table. */
	function ageAtBuildingOffset(/** @type {number} */ offset) {
		return Math.round(parsedCurrentAge + offset / 12);
	}

	/** Age at a month offset from the switch date, for the income-phase table. */
	function ageAtIncomeOffset(/** @type {number} */ offset) {
		return Math.round(parsedSwitchAge + offset / 12);
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Building phase vs income phase</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Before the age below, every holding does what its own strategy says: a DRIP holding reinvests
		its dividend and compounds, an income-strategy holding pays it out already. From that age on,
		every holding switches to taking its dividend as income — the plan draws only the yield, never
		the capital, so once switched the income shown below keeps paying indefinitely.
	</p>

	<div class="flex flex-wrap gap-3 mb-4">
		<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
			<div class="text-sm font-medium">Portfolio today</div>
			<div class="text-xs text-muted-foreground mb-1">
				{today.count} holding{today.count === 1 ? '' : 's'} at {today.weightedYield}% blended yield
			</div>
			<div class="text-xl font-semibold">{formatMoney(today.totalValue)}</div>
			<div class="text-xs text-muted-foreground">
				{formatMoney(today.annualIncome)}/yr if taken as income today
			</div>
		</div>
	</div>

	<div class="flex flex-wrap items-end gap-4 mb-4">
		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="dividend-current-age">Your age now</label>
			<input
				id="dividend-current-age"
				type="number"
				min="0"
				max="120"
				step="1"
				bind:value={currentAge}
				class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
			/>
		</div>

		<div class="flex flex-col gap-1">
			<span id="dividend-switch-age-label" class="text-sm font-medium">
				Switch to income at age
			</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="dividend-switch-age-label"
					min={SWITCH_AGE_MIN}
					max={SWITCH_AGE_MAX}
					step="1"
					bind:value={switchAge}
					class="w-40 accent-black"
				/>
				<input
					id="dividend-switch-age"
					type="number"
					aria-labelledby="dividend-switch-age-label"
					min="0"
					max="120"
					step="1"
					bind:value={switchAge}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
		</div>
	</div>

	{#if !assumptionsAreValid}
		<p class="text-sm text-red-600 mb-4">Enter ages between 0 and 120 for both fields.</p>
	{:else if today.count === 0}
		<p class="text-sm text-muted-foreground">
			No dividend holdings recorded yet. Add one above and the building/income phase plan will work
			out here.
		</p>
	{:else if plan}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Pot at {parsedSwitchAge}</div>
				<div class="text-xs text-muted-foreground mb-1">
					{alreadySwitched
						? 'switching now'
						: `reinvesting for ${plan.monthsToSwitch} month${plan.monthsToSwitch === 1 ? '' : 's'}`}
				</div>
				<div class="text-xl font-semibold">{formatMoney(plan.atSwitch.value)}</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(plan.atSwitch.reinvestedGrowth)} reinvested, {formatMoney(
						plan.atSwitch.contributions
					)} contributed
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Income from {parsedSwitchAge}</div>
				<div class="text-xs text-muted-foreground mb-1">
					every holding taking its yield as income
				</div>
				<div class="text-xl font-semibold">{formatMoney(plan.income.annualIncome)}/yr</div>
				<div class="text-xs text-muted-foreground">{formatMoney(plan.income.monthlyIncome)}/mo</div>
			</div>
		</div>

		{#if buildingRows.length > 1}
			<h3 class="text-sm font-semibold mb-1">Building phase — DRIP compounding projection</h3>
			<p class="text-xs text-muted-foreground mb-2">
				Yearly, from today to age {parsedSwitchAge}. Each holding compounds under its own recorded
				strategy.
			</p>
			<table class="w-full text-sm border-collapse mb-4">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Age</th>
						<th class="py-2 px-2 font-medium">Month</th>
						<th class="py-2 px-2 font-medium text-right">Value</th>
						<th class="py-2 px-2 font-medium text-right">Contributed</th>
						<th class="py-2 pl-2 font-medium text-right">Reinvested</th>
					</tr>
				</thead>
				<tbody>
					{#each buildingRows as row (row.offset)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-2 tabular-nums">{ageAtBuildingOffset(row.offset)}</td>
							<td class="py-2 px-2">{formatMonth(row)}</td>
							<td class="py-2 px-2 text-right tabular-nums font-medium">{formatMoney(row.value)}</td
							>
							<td class="py-2 px-2 text-right tabular-nums">{formatMoney(row.contributions)}</td>
							<td class="py-2 pl-2 text-right tabular-nums">{formatMoney(row.reinvestedGrowth)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if incomeRows.length > 1}
			<h3 class="text-sm font-semibold mb-1">Income phase — income-taken chart</h3>
			<p class="text-xs text-muted-foreground mb-2">
				From {parsedSwitchAge} on, drawing {formatMoney(plan.income.monthlyIncome)} a month while the
				pot itself stays untouched — only the yield is drawn, so this never runs out.
			</p>
			<table class="w-full text-sm border-collapse mb-3">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Age</th>
						<th class="py-2 px-2 font-medium">Month</th>
						<th class="py-2 pl-2 font-medium text-right">Income taken so far</th>
					</tr>
				</thead>
				<tbody>
					{#each incomeRows as row (row.offset)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-2 tabular-nums">{ageAtIncomeOffset(row.offset)}</td>
							<td class="py-2 px-2">{formatMonth(row)}</td>
							<td class="py-2 pl-2 text-right tabular-nums font-medium">
								{formatMoney(row.cumulativeIncome)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		<p class="text-xs text-muted-foreground mt-2">
			Illustrative only, not financial advice. Every figure here is gross of tax: the card above
			applies the {DIVIDEND_TAX_YEAR} dividend allowance and GIA rates to today's portfolio, and the projection
			deliberately stays gross, since neither the allowance nor the rates can be assumed to hold for the
			decades this covers. Capital growth is not modelled either: a holding's value only moves from its
			own yield (reinvested or not) and its contribution schedule, never from an assumed price return.
		</p>
	{/if}
</Card>
