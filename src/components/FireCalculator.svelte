<script>
	/**
	 * FIRE / Coast FIRE calculator — README.md → "FIRE / Retirement Calculator" (issue #22).
	 *
	 * Four sliders (target income, monthly saving, growth rate, withdrawal rate — README.md's own
	 * list) drive `$lib/fire.js`, which answers the three questions the spec asks: how big the pot has
	 * to be (the magic number), the pot size at which contributions could stop (Coast FIRE), and how
	 * long the money lasts once you start spending it (the portfolio runway).
	 *
	 * The starting pot and monthly saving are read off the latest recorded snapshot when there is one
	 * — the same anchor the forecast tab projects from (`fireStartingPoint` delegates to
	 * `positionFromEntries`), so the two tabs cannot disagree about what the user owns. With no
	 * history they fall back to figures typed in here, held for this page session only and never
	 * written to `monthly_entries`, exactly as `ForecastProjections` does.
	 *
	 * Everything shown is in today's money: the growth rate is nominal, the inflation field deflates
	 * it, and `fire.js` runs the whole plan at the resulting real rate (see that module's convention
	 * 1). Without that, a 25-year projection would report a pot in future pounds against a target
	 * income priced in current ones.
	 *
	 * The accumulation and drawdown charts README.md also lists are rendered as sampled tables with
	 * inline bars rather than plotted: #12 (LayerChart) is still open, and `fire.js` returns ordinary
	 * point series (`AccumulationPoint`/`DrawdownPoint`) written against no chart library, so #12 can
	 * hand them straight to a chart component once one exists. Same pattern #18/#20/#21 already set.
	 */
	import {
		DEFAULT_WITHDRAWAL_RATE,
		fireStartingPoint,
		fireSummary,
		MAX_WITHDRAWAL_RATE,
		MIN_WITHDRAWAL_RATE
	} from '$lib/fire.js';
	import { currentCalendarMonth } from '$lib/forecast.js';
	import { ageAtPoint } from '$lib/milestones.js';
	import { createProfile } from '$lib/model.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 * 	monthlyEntries?: import('$lib/types.js').MonthlyEntry[],
	 * 	profile?: import('$lib/types.js').Profile
	 * }}
	 */
	let { monthlyEntries = [], profile = createProfile() } = $props();

	// Slider bounds are a UI convenience, not spec — README.md gives no ranges. `fire.js` clamps
	// whatever the paired number field accepts, so these are only where the drag handle lives.
	const INCOME_SLIDER_MAX = 150_000;
	const SAVING_SLIDER_MAX = 5_000;
	const GROWTH_SLIDER_MIN = -5;
	const GROWTH_SLIDER_MAX = 15;
	const WITHDRAWAL_SLIDER_MIN = 2;
	const WITHDRAWAL_SLIDER_MAX = 8;

	/** How long the money has to last, by default: retiring and living to 95. */
	const DEFAULT_LAST_TO_AGE = 95;

	const anchorMonth = currentCalendarMonth();

	// The recorded position, if there is one. Derived rather than copied into state so a snapshot
	// added on the dashboard while this tab is open moves the plan with it.
	const recorded = $derived(fireStartingPoint(monthlyEntries));
	const hasHistory = $derived(recorded !== null);

	// Fallback pot, used only while no snapshot exists to read one off. The matching saving fallback
	// is `savingInput` below — the same field the slider drives once there is no history to override
	// it, rather than a second copy of it.
	let assumedPot = $state(25_000);

	// The four sliders README.md names. Seeded from the profile where it has an opinion; from then on
	// the user owns them.
	// svelte-ignore state_referenced_locally
	let targetIncome = $state(profile.retirement_target > 0 ? profile.retirement_target : 30_000);
	// svelte-ignore state_referenced_locally
	let savingInput = $state(profile.monthly_contribution > 0 ? profile.monthly_contribution : 500);
	// svelte-ignore state_referenced_locally
	let growthRate = $state(profile.growth_rate);
	let withdrawalRate = $state(DEFAULT_WITHDRAWAL_RATE);

	// svelte-ignore state_referenced_locally
	let inflationRate = $state(profile.inflation_rate);
	// svelte-ignore state_referenced_locally
	let retirementAge = $state(profile.retirement_age);
	let lastToAge = $state(DEFAULT_LAST_TO_AGE);
	// `Profile` stores a birth year, not an age, so the age below is derived from it when it's on
	// file. Nothing else in the app collects one, so an empty birth year means typing it here.
	// svelte-ignore state_referenced_locally
	let currentAge = $state(
		profile.dob_year === null ? 40 : ageAtPoint(profile.dob_year, profile.dob_month, anchorMonth)
	);

	/**
	 * `bind:value` on a number input hands back a number, or `null` once the field is cleared.
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

	const parsedTarget = $derived(parse(targetIncome, Number.NaN));
	const parsedSaving = $derived(
		hasHistory ? (recorded?.monthlySaving ?? 0) : parse(savingInput, Number.NaN)
	);
	const parsedGrowth = $derived(parse(growthRate, Number.NaN));
	const parsedWithdrawal = $derived(parse(withdrawalRate, Number.NaN));
	const parsedInflation = $derived(parse(inflationRate, Number.NaN));
	const parsedCurrentAge = $derived(parse(currentAge, Number.NaN));
	const parsedRetirementAge = $derived(parse(retirementAge, Number.NaN));
	const parsedLastToAge = $derived(parse(lastToAge, Number.NaN));

	const pot = $derived(hasHistory ? (recorded?.pot ?? 0) : Math.max(0, parse(assumedPot, 0)));

	const assumptionsAreValid = $derived(
		parsedTarget >= 0 &&
			parsedTarget <= 1e9 &&
			parsedSaving >= 0 &&
			parsedGrowth >= -100 &&
			parsedGrowth <= 100 &&
			parsedInflation >= -100 &&
			parsedInflation <= 100 &&
			parsedWithdrawal >= MIN_WITHDRAWAL_RATE &&
			parsedWithdrawal <= MAX_WITHDRAWAL_RATE &&
			parsedCurrentAge >= 0 &&
			parsedCurrentAge <= 120 &&
			parsedRetirementAge >= 16 &&
			parsedRetirementAge <= 120 &&
			parsedLastToAge >= 16 &&
			parsedLastToAge <= 120
	);

	// Already at or past the retirement age typed in: the plan is all drawdown, no accumulation.
	const alreadyRetired = $derived(assumptionsAreValid && parsedRetirementAge <= parsedCurrentAge);
	const yearsToRetirement = $derived(Math.max(0, parsedRetirementAge - parsedCurrentAge));
	const drawdownYears = $derived(
		Math.max(0, parsedLastToAge - Math.max(parsedRetirementAge, parsedCurrentAge))
	);

	const summary = $derived(
		assumptionsAreValid
			? fireSummary({
					pot,
					monthlySaving: parsedSaving,
					targetIncome: parsedTarget,
					growthRate: parsedGrowth,
					inflationRate: parsedInflation,
					withdrawalRate: parsedWithdrawal,
					yearsToRetirement,
					drawdownYears,
					start: hasHistory ? (recorded?.start ?? anchorMonth) : anchorMonth
				})
			: null
	);

	/**
	 * A series sampled every `step` months, always including its first and last point plus any
	 * `extra` offsets — enough rows to read the shape of the curve without printing 360 of them.
	 *
	 * @template {{ offset: number }} T
	 * @param {readonly T[]} points
	 * @param {number} step
	 * @param {readonly number[]} [extra]
	 * @returns {T[]}
	 */
	function sample(points, step, extra = []) {
		if (points.length === 0) return [];
		const last = points.at(-1)?.offset ?? 0;
		const wanted = [0, last, ...extra.filter((offset) => offset >= 0 && offset <= last)];
		for (let offset = step; offset < last; offset += step) wanted.push(offset);

		// Sorted then de-duplicated by comparing with the row already taken, rather than through a
		// `Set` — `svelte/prefer-svelte-reactivity` reads any plain `Set` in a component as reactive
		// state that should have been a `SvelteSet`, and this one is neither reactive nor state.
		/** @type {T[]} */
		const rows = [];
		for (const offset of wanted.sort((a, b) => a - b)) {
			if (rows.at(-1)?.offset === offset) continue;
			const point = points.find((candidate) => candidate.offset === offset);
			if (point) rows.push(point);
		}
		return rows;
	}

	/** Five-yearly rows, plus the month the pot reaches the number and the month coasting starts. */
	const accumulationRows = $derived(
		summary
			? sample(summary.accumulation, 60, [
					summary.timing.offset ?? -1,
					summary.coastDate.offset ?? -1
				])
			: []
	);
	const drawdownRows = $derived(summary ? sample(summary.runway.points, 60) : []);
	const peakValue = $derived(
		Math.max(
			...accumulationRows.map((row) => row.value),
			...drawdownRows.map((row) => row.value),
			1
		)
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
		return value ? formatMonth(value) : '—';
	}

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} share */
	function formatShare(share) {
		return percentFormatter.format(share);
	}

	/** @param {number} value @returns {string} e.g. "8 months", "12.5 years" */
	function formatDuration(value) {
		const months = Math.round(value);
		if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
		const years = Math.round((months / 12) * 10) / 10;
		return `${years} year${years === 1 ? '' : 's'}`;
	}

	/** The age at a given month offset from the anchor — how every date below is labelled. */
	function ageAt(/** @type {number} */ offset) {
		return Math.round(parsedCurrentAge + offset / 12);
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">FIRE &amp; Coast FIRE</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Your magic number is the pot that pays you your target income forever at your withdrawal rate —
		25× that income at the classic 4%. Coast FIRE is the smaller pot that gets there on its own,
		with no further saving, if you leave it alone until you retire. Every figure here is in today's
		money: the growth rate below is nominal and the inflation rate deflates it, so the pounds you
		see compare directly with the income you asked for.
	</p>

	{#if hasHistory && recorded}
		<p class="text-sm text-muted-foreground mb-4">
			Starting from your {formatMonth(recorded.start)} snapshot: {formatMoney(recorded.pot)} invested,
			{formatMoney(recorded.monthlySaving)} a month going in. Debts are left out — a mortgage isn't an
			income stream you can draw down.
		</p>
	{:else}
		<div class="mb-4 rounded-md border border-border bg-muted/40 p-3">
			<p class="text-sm text-muted-foreground mb-3">
				No monthly snapshots recorded yet, so there's no pot to read. Describe your position here —
				these two figures are assumptions for this page only; nothing is saved.
			</p>
			<div class="flex flex-wrap items-end gap-4">
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="fire-pot">Invested today (£)</label>
					<input
						id="fire-pot"
						type="number"
						min="0"
						step="1000"
						bind:value={assumedPot}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-36"
					/>
				</div>
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="fire-saving">Saved each month (£)</label>
					<input
						id="fire-saving"
						type="number"
						min="0"
						step="50"
						bind:value={savingInput}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-36"
					/>
				</div>
			</div>
		</div>
	{/if}

	<div class="flex flex-wrap items-end gap-4 mb-4">
		<div class="flex flex-col gap-1">
			<span id="fire-income-label" class="text-sm font-medium">Target income (£/yr)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="fire-income-label"
					min="0"
					max={INCOME_SLIDER_MAX}
					step="500"
					bind:value={targetIncome}
					class="w-32 accent-black"
				/>
				<input
					id="fire-income"
					type="number"
					aria-labelledby="fire-income-label"
					min="0"
					step="500"
					bind:value={targetIncome}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="fire-monthly-label" class="text-sm font-medium">Monthly saving (£)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="fire-monthly-label"
					min="0"
					max={SAVING_SLIDER_MAX}
					step="25"
					disabled={hasHistory}
					bind:value={savingInput}
					class="w-32 accent-black"
				/>
				<input
					id="fire-monthly"
					type="number"
					aria-labelledby="fire-monthly-label"
					min="0"
					step="25"
					disabled={hasHistory}
					value={hasHistory ? parsedSaving : savingInput}
					oninput={(event) => (savingInput = event.currentTarget.valueAsNumber)}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-28 disabled:opacity-50"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="fire-growth-label" class="text-sm font-medium">Annual growth (%)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="fire-growth-label"
					min={GROWTH_SLIDER_MIN}
					max={GROWTH_SLIDER_MAX}
					step="0.1"
					bind:value={growthRate}
					class="w-32 accent-black"
				/>
				<input
					id="fire-growth"
					type="number"
					aria-labelledby="fire-growth-label"
					min="-100"
					max="100"
					step="0.1"
					bind:value={growthRate}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="fire-withdrawal-label" class="text-sm font-medium">Withdrawal rate (%)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="fire-withdrawal-label"
					min={WITHDRAWAL_SLIDER_MIN}
					max={WITHDRAWAL_SLIDER_MAX}
					step="0.1"
					bind:value={withdrawalRate}
					class="w-32 accent-black"
				/>
				<input
					id="fire-withdrawal"
					type="number"
					aria-labelledby="fire-withdrawal-label"
					min={MIN_WITHDRAWAL_RATE}
					max={MAX_WITHDRAWAL_RATE}
					step="0.1"
					bind:value={withdrawalRate}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
		</div>
	</div>

	<div class="mb-4 rounded-md border border-border bg-muted/40 p-3">
		<p class="text-sm text-muted-foreground mb-3">
			When the pot is needed, and how long it has to last. Ages come from your profile where it has
			them; there's no form to edit a profile yet, so anything missing is typed in here for this
			page only.
		</p>
		<div class="flex flex-wrap items-end gap-4">
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="fire-age">Your age now</label>
				<input
					id="fire-age"
					type="number"
					min="0"
					max="120"
					step="1"
					bind:value={currentAge}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="fire-retirement-age">Retiring at</label>
				<input
					id="fire-retirement-age"
					type="number"
					min="16"
					max="120"
					step="1"
					bind:value={retirementAge}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="fire-last-to-age">Money must last to</label>
				<input
					id="fire-last-to-age"
					type="number"
					min="16"
					max="120"
					step="1"
					bind:value={lastToAge}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="fire-inflation">Inflation (%)</label>
				<input
					id="fire-inflation"
					type="number"
					min="-100"
					max="100"
					step="0.1"
					bind:value={inflationRate}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
		</div>
	</div>

	{#if !assumptionsAreValid}
		<p class="text-sm text-red-600 mb-4">
			Enter a non-negative target income and saving, growth and inflation rates between -100% and
			100%, a withdrawal rate of {MIN_WITHDRAWAL_RATE}–{MAX_WITHDRAWAL_RATE}%, and ages between 0
			and 120.
		</p>
	{:else if summary}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Magic number</div>
				<div class="text-xs text-muted-foreground mb-1">
					{Math.round(summary.multiple * 10) / 10}× {formatMoney(summary.input.targetIncome)} at {summary
						.input.withdrawalRate}%
				</div>
				<div class="text-xl font-semibold">{formatMoney(summary.number)}</div>
				<div class="text-xs text-muted-foreground">
					{formatShare(Math.min(summary.share, 1))} of the way there
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Coast FIRE number</div>
				<div class="text-xs text-muted-foreground mb-1">
					left alone for {formatDuration(yearsToRetirement * 12)} at {Math.round(
						summary.realRate * 100
					) / 100}% real
				</div>
				<div class="text-xl font-semibold">{formatMoney(summary.coast.number)}</div>
				<div class="text-xs text-muted-foreground">
					{#if summary.coast.achieved}
						reached — {formatMoney(summary.coast.surplus)} past it
					{:else}
						{formatMoney(summary.coast.gap)} to go
					{/if}
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Pot at {parsedRetirementAge}</div>
				<div class="text-xs text-muted-foreground mb-1">
					{alreadyRetired
						? 'drawing down from today'
						: `saving for ${formatDuration(yearsToRetirement * 12)}`}
				</div>
				<div class="text-xl font-semibold">{formatMoney(summary.potAtRetirement)}</div>
				<div class="text-xs text-muted-foreground">
					supports {formatMoney(summary.incomeAtRetirement)} a year
				</div>
			</div>

			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Money lasts</div>
				<div class="text-xs text-muted-foreground mb-1">
					drawing {formatMoney(summary.input.targetIncome)} a year
				</div>
				<div class="text-xl font-semibold">
					{#if summary.runway.sustainable}
						indefinitely
					{:else if !summary.runway.depleted}
						{formatDuration(summary.runway.months)}+
					{:else}
						{formatDuration(summary.runway.months)}
					{/if}
				</div>
				<div class="text-xs text-muted-foreground">
					{#if summary.runway.sustainable}
						growth alone covers it
					{:else if !summary.runway.depleted}
						still {formatMoney(summary.runway.finalValue)} left at {parsedLastToAge}
					{:else}
						gone by age {ageAt(
							(summary.runway.points.at(-1)?.offset ?? 0) + yearsToRetirement * 12
						)}
					{/if}
				</div>
			</div>
		</div>

		<p class="text-sm mb-3">
			{#if summary.number === 0}
				Set a target income above and this fills in — with nothing to aim at there is no number to
				reach.
			{:else if summary.timing.alreadyThere}
				<span class="font-medium">You're already there.</span>
				{formatMoney(pot)} covers the {formatMoney(summary.number)} your target income needs.
			{:else if summary.timing.reached}
				<span class="font-medium">
					You reach {formatMoney(summary.number)} in {formatDate(summary.timing.date)}
				</span>
				— {formatDuration(/** @type {number} */ (summary.timing.offset))} from now, at age {ageAt(
					/** @type {number} */ (summary.timing.offset)
				)}, if you keep saving {formatMoney(parsedSaving)} a month.
				{#if summary.onTrack}
					That's at or before you retire at {parsedRetirementAge}.
				{:else}
					That's after you planned to retire at {parsedRetirementAge}, when the pot is
					{formatMoney(summary.potAtRetirement)} — {formatMoney(summary.incomeGap)} a year short of your
					target.
				{/if}
			{:else}
				At {formatMoney(parsedSaving)} a month and {Math.round(summary.realRate * 100) / 100}% real
				growth you don't reach {formatMoney(summary.number)} within 60 years — you get to
				{formatMoney(summary.timing.finalValue)}. Raise the saving, lower the target, or accept a
				higher withdrawal rate.
			{/if}
		</p>

		<p class="text-sm text-muted-foreground mb-4">
			{#if summary.coast.achieved}
				<span class="font-medium text-foreground">You can stop contributing now.</span>
				{formatMoney(pot)} left alone until {parsedRetirementAge} compounds past your magic number on
				its own.
			{:else if summary.coastDate.reached}
				<span class="font-medium text-foreground">
					Coasting starts {formatDate(summary.coastDate.date)}
				</span>
				— at age {ageAt(/** @type {number} */ (summary.coastDate.offset))}, once the pot passes
				{formatMoney(/** @type {number} */ (summary.coastDate.number))}. From that month on you
				could stop saving entirely and still hit your number by {parsedRetirementAge}, because the
				coast number rises as the time left to compound shrinks.
			{:else}
				There's no month before {parsedRetirementAge} you could stop saving in: the pot never gets far
				enough ahead of its Coast FIRE number to reach your target on growth alone. Contributions have
				to keep going right up to retirement.
			{/if}
		</p>

		{#if accumulationRows.length > 1}
			<h3 class="text-sm font-semibold mb-1">Accumulation</h3>
			<p class="text-xs text-muted-foreground mb-2">
				Five-yearly, plus the months you cross the coast and magic numbers. Contributions and growth
				are cumulative and always add up to the change in the pot.
			</p>
			<table class="w-full text-sm border-collapse mb-4">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Age</th>
						<th class="py-2 px-2 font-medium">Month</th>
						<th class="py-2 px-2 font-medium text-right">Pot</th>
						<th class="py-2 px-2 font-medium text-right">Paid in</th>
						<th class="py-2 pl-2 font-medium text-right">Growth</th>
					</tr>
				</thead>
				<tbody>
					{#each accumulationRows as row (row.offset)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-2 tabular-nums">{ageAt(row.offset)}</td>
							<td class="py-2 px-2">
								{formatMonth(row)}
								<span
									class="ml-2 h-2 rounded-sm align-middle"
									style="display: inline-block; height: 0.5rem; border-radius: 0.125rem; width: {(row.value /
										peakValue) *
										40}%; background-color: #0ea5e9"
									title="{formatMonth(row)}: {formatMoney(row.value)}"
								></span>
							</td>
							<td class="py-2 px-2 text-right tabular-nums font-medium">{formatMoney(row.value)}</td
							>
							<td class="py-2 px-2 text-right tabular-nums">{formatMoney(row.contributions)}</td>
							<td class="py-2 pl-2 text-right tabular-nums">{formatMoney(row.growth)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if drawdownRows.length > 1}
			<h3 class="text-sm font-semibold mb-1">Drawdown — will my money last?</h3>
			<p class="text-xs text-muted-foreground mb-2">
				From {parsedRetirementAge} on, drawing {formatMoney(summary.runway.monthlyIncome)} a month ({formatMoney(
					summary.input.targetIncome
				)} a year) while what's left keeps growing at
				{Math.round(summary.realRate * 100) / 100}% real.
			</p>
			<table class="w-full text-sm border-collapse mb-3">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Age</th>
						<th class="py-2 px-2 font-medium">Month</th>
						<th class="py-2 px-2 font-medium text-right">Pot</th>
						<th class="py-2 pl-2 font-medium text-right">Taken so far</th>
					</tr>
				</thead>
				<tbody>
					{#each drawdownRows as row (row.offset)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-2 tabular-nums">{ageAt(row.offset + yearsToRetirement * 12)}</td>
							<td class="py-2 px-2">
								{formatMonth(row)}
								<span
									class="ml-2 h-2 rounded-sm align-middle"
									style="display: inline-block; height: 0.5rem; border-radius: 0.125rem; width: {(row.value /
										peakValue) *
										40}%; background-color: #f97316"
									title="{formatMonth(row)}: {formatMoney(row.value)}"
								></span>
							</td>
							<td class="py-2 px-2 text-right tabular-nums font-medium">{formatMoney(row.value)}</td
							>
							<td class="py-2 pl-2 text-right tabular-nums">{formatMoney(row.withdrawn)}</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<p class="text-sm text-muted-foreground">
				{#if summary.runway.sustainable}
					One month's growth on {formatMoney(summary.potAtRetirement)} more than covers one month's income,
					so the pot never falls — it lasts as long as the assumptions do.
				{:else if summary.runway.depleted}
					<span class="font-medium text-foreground">
						The money runs out in {formatDate(summary.runway.depletedDate)}
					</span>
					— age {ageAt((summary.runway.points.at(-1)?.offset ?? 0) + yearsToRetirement * 12)}, after
					{formatDuration(summary.runway.months)} of income, which is
					{formatDuration(drawdownYears * 12 - summary.runway.months)} short of lasting to {parsedLastToAge}.
					Drawing more than the pot earns empties it — and even drawing exactly what it earns
					empties it slowly, because each month's income leaves before it can compound.
				{:else}
					{formatMoney(summary.runway.finalValue)} is still there at {parsedLastToAge}, after
					{formatMoney(summary.runway.withdrawn)} of income drawn.
				{/if}
			</p>
		{/if}

		<p class="text-xs text-muted-foreground mt-4">
			Illustrative only, not financial advice. Tax is not modelled — the income above is what leaves
			the pot, not what reaches your bank account; pensions, the State Pension and ISA/GIA tax
			treatment land on their own tabs. There is no chart here yet: the accumulation and drawdown
			series are plotted once LayerChart lands (#12).
		</p>
	{/if}
</Card>
