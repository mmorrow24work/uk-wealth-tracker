<script>
	/**
	 * UK State Pension projected from National Insurance qualifying years — README.md → "Pension
	 * Tracker": "UK State Pension projection from NI qualifying years (35 years for full £241.30/week
	 * 2026/27)" (issue #31).
	 *
	 * This is the "dedicated flow" `PENSION_POT_TYPES` was carved out for in #29: the State Pension is
	 * a `PensionType` like any other, but it has no pot value, no contribution percentage and no fund
	 * fee, so it cannot share `PensionTracker`'s add/edit form. What it has instead is two numbers on
	 * the same `Pension` record — `ni_qualifying_years` and `ni_future_years`, in the data model since
	 * #5 — and one nationally-set weekly rate, and `$lib/state-pension.js` turns those into pounds.
	 *
	 * Unlike `PensionTracker`, there is no list and no add button: one person has one National
	 * Insurance record, so this panel edits a single record that `setStatePensionYears` creates the
	 * first time a year count is entered and `removeStatePension` drops on "clear". The two counts
	 * are read straight back out of `pensions` on every render rather than mirrored into local
	 * `$state`, so there is exactly one copy of them and no re-seeding problem when the store
	 * hydrates underneath.
	 *
	 * Birth year and month are the exception: they belong to `Profile`, which still has no form
	 * anywhere in the app, so — exactly as `ForecastProjections` does for its retirement marker —
	 * they seed from the profile and are then owned locally for this page session, never written
	 * back. They drive only the "from what age, in what year" figures; the projection itself needs
	 * no date of birth at all.
	 */
	import {
		FULL_STATE_PENSION_WEEKLY,
		MAX_QUALIFYING_YEARS,
		MINIMUM_QUALIFYING_YEARS,
		QUALIFYING_YEARS_FOR_FULL,
		removeStatePension,
		setStatePensionYears,
		STATE_PENSION_TAX_YEAR,
		statePensionProjection
	} from '$lib/state-pension.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/**
	 * @type {{
	 *   pensions?: import('$lib/types.js').Pension[],
	 *   dobYear?: number | null,
	 *   dobMonth?: number | null
	 * }}
	 */
	let {
		pensions = $bindable([]),
		dobYear: dobYearProp = null,
		dobMonth: dobMonthProp = null
	} = $props();

	// Slider bounds are a UI convenience, not spec. 50 covers any realistic working life while
	// leaving the number field free to take the full 0–60 `validateAppData` accepts.
	const YEARS_SLIDER_MAX = 50;

	// The profile seeds the birth date once; from then on the user owns it, same as
	// `ForecastProjections`' own copy of these two fields.
	/** @type {number | string | undefined} */
	// svelte-ignore state_referenced_locally
	let dobYear = $state(dobYearProp ?? '');
	/** @type {number | string | undefined} */
	// svelte-ignore state_referenced_locally
	let dobMonth = $state(dobMonthProp ?? '');

	/**
	 * `bind:value` on `<input type="number">` hands back a *number* (or `undefined` for an empty
	 * field), not the string a text input would — so this has to take either.
	 *
	 * @param {unknown} value
	 * @returns {number | null}
	 */
	function parseOptionalInt(value) {
		if (value === null || value === undefined || value === '') return null;
		const parsed = typeof value === 'number' ? value : Number(String(value).trim());
		return Number.isFinite(parsed) ? Math.round(parsed) : null;
	}

	const parsedDobYear = $derived(parseOptionalInt(dobYear));
	const parsedDobMonthRaw = $derived(parseOptionalInt(dobMonth));
	const parsedDobMonth = $derived(
		parsedDobMonthRaw !== null && parsedDobMonthRaw >= 1 && parsedDobMonthRaw <= 12
			? parsedDobMonthRaw
			: null
	);

	// Single source of truth: the record inside `pensions`, not a mirrored copy of its two fields.
	const record = $derived(pensions.find((pension) => pension.type === 'state') ?? null);
	const hasRecord = $derived(record !== null);
	const qualifyingYears = $derived(record?.ni_qualifying_years ?? 0);
	const futureYears = $derived(record?.ni_future_years ?? 0);

	const result = $derived(
		statePensionProjection({
			qualifyingYears,
			futureYears,
			dobYear: parsedDobYear,
			dobMonth: parsedDobMonth
		})
	);

	/** @param {unknown} value @returns {number} A year count inside the stored 0–60 range. */
	function clampYears(value) {
		const parsed = typeof value === 'number' ? value : Number(value);
		if (!Number.isFinite(parsed)) return 0;
		return Math.min(MAX_QUALIFYING_YEARS, Math.max(0, Math.round(parsed)));
	}

	/** @param {unknown} value */
	function setQualifyingYears(value) {
		pensions = setStatePensionYears(pensions, { ni_qualifying_years: clampYears(value) });
	}

	/** @param {unknown} value */
	function setFutureYears(value) {
		pensions = setStatePensionYears(pensions, { ni_future_years: clampYears(value) });
	}

	function clearStatePension() {
		pensions = removeStatePension(pensions);
	}

	const weeklyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
	const annualFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount @returns {string} e.g. "£241.30" — weekly figures keep their pence. */
	function formatWeekly(amount) {
		return weeklyFormatter.format(amount);
	}

	/** @param {number} amount @returns {string} e.g. "£12,548" — yearly figures round to the pound. */
	function formatAnnual(amount) {
		return annualFormatter.format(amount);
	}

	/** @param {number} years @returns {string} e.g. "1 year", "12 years" */
	function formatYears(years) {
		return `${years} ${years === 1 ? 'year' : 'years'}`;
	}

	// Derived rather than inlined in the markup: the countdown clause has to butt straight up against
	// the year that precedes it, and the surrounding whitespace of an inline `{#if}` is not something
	// the formatter leaves alone.
	const yearsAwaySuffix = $derived(
		result.yearsToStatePensionAge !== null && result.yearsToStatePensionAge > 0
			? ` — ${formatYears(result.yearsToStatePensionAge)} away`
			: ''
	);
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">State Pension projection, {STATE_PENSION_TAX_YEAR}</h2>
	<p class="text-sm text-muted-foreground mb-4">
		{QUALIFYING_YEARS_FOR_FULL} qualifying National Insurance years buys the full new State Pension of
		{formatWeekly(FULL_STATE_PENSION_WEEKLY)} a week. Fewer years pays that same rate pro-rata — and under
		{MINIMUM_QUALIFYING_YEARS} qualifying years pays nothing at all. Check the years already on your record
		at
		<a
			class="underline"
			href="https://www.gov.uk/check-state-pension"
			target="_blank"
			rel="noreferrer">gov.uk/check-state-pension</a
		>, then add the years you still expect to earn.
	</p>

	<div class="flex flex-col gap-4 mb-5">
		<div class="flex flex-wrap items-end gap-3">
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="sp-qualifying-years">
					Qualifying years so far
				</label>
				<input
					id="sp-qualifying-years"
					type="number"
					min="0"
					max={MAX_QUALIFYING_YEARS}
					step="1"
					value={qualifyingYears}
					oninput={(event) => setQualifyingYears(event.currentTarget.value)}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
			<input
				aria-label="Qualifying years so far (slider)"
				type="range"
				min="0"
				max={YEARS_SLIDER_MAX}
				step="1"
				value={qualifyingYears}
				oninput={(event) => setQualifyingYears(event.currentTarget.value)}
				class="flex-1 min-w-52 accent-black mb-2"
			/>
		</div>

		<div class="flex flex-wrap items-end gap-3">
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="sp-future-years">Further years expected</label>
				<input
					id="sp-future-years"
					type="number"
					min="0"
					max={MAX_QUALIFYING_YEARS}
					step="1"
					value={futureYears}
					oninput={(event) => setFutureYears(event.currentTarget.value)}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
			<input
				aria-label="Further years expected (slider)"
				type="range"
				min="0"
				max={YEARS_SLIDER_MAX}
				step="1"
				value={futureYears}
				oninput={(event) => setFutureYears(event.currentTarget.value)}
				class="flex-1 min-w-52 accent-black mb-2"
			/>
		</div>

		{#if result.maxFutureYears !== null}
			<p class="text-xs text-muted-foreground -mt-2">
				{result.maxFutureYears > 0
					? `You have ${formatYears(result.maxFutureYears)} before State Pension age, so that is the most further qualifying years you could earn.`
					: 'You are already at State Pension age, so there are no further qualifying years to earn.'}
				{#if result.futureYearsExceedWorkingLife}
					<span class="text-amber-600 font-medium">
						{formatYears(result.futureYears)} is more than that.
					</span>
				{/if}
				<button
					type="button"
					class="underline"
					onclick={() => setFutureYears(result.maxFutureYears)}
				>
					Use {result.maxFutureYears}
				</button>
			</p>
		{/if}
	</div>

	{#if !result.meetsMinimum}
		<p class="text-sm mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2">
			<span class="font-medium">
				{formatYears(result.totalYears)} projected — no State Pension is payable at all.
			</span>
			The new State Pension needs at least {MINIMUM_QUALIFYING_YEARS} qualifying years before it pays
			anything, and a record {formatYears(result.yearsToMinimum)} short of that is worth exactly nothing
			rather than a small amount. Getting to {MINIMUM_QUALIFYING_YEARS} years is worth
			{formatWeekly(result.valueOfReachingMinimumWeekly)} a week ({formatAnnual(
				result.valueOfReachingMinimumAnnual
			)} a year) in one step.
		</p>
	{/if}

	<div class="flex flex-wrap gap-3 mb-4">
		<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
			<div class="text-sm font-medium">Projected State Pension</div>
			<div class="text-xs text-muted-foreground mb-1">
				on {formatYears(result.totalYears)} qualifying
			</div>
			<div class="text-xl font-semibold">{formatWeekly(result.weekly)} a week</div>
			<div class="text-xs text-muted-foreground">
				{formatAnnual(result.annual)} a year · {formatAnnual(result.monthly)} a month
			</div>
		</div>

		<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
			<div class="text-sm font-medium">Share of the full rate</div>
			<div class="text-xs text-muted-foreground mb-1">
				{result.meetsMinimum
					? `${result.countingYears} of ${QUALIFYING_YEARS_FOR_FULL} years count`
					: `none of your ${formatYears(result.totalYears)} count yet`}
			</div>
			<div class="text-xl font-semibold">{Math.round(result.pctOfFull)}%</div>
			<div class="text-xs text-muted-foreground">
				{#if result.reachesFull}
					Full rate reached{result.wastedYears > 0
						? ` — ${formatYears(result.wastedYears)} past the 35th add nothing`
						: ''}
				{:else}
					{formatYears(result.yearsToFull)} short — {formatWeekly(result.shortfallWeekly)} a week less
					than the full rate
				{/if}
			</div>
		</div>

		<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
			<div class="text-sm font-medium">One more qualifying year</div>
			<div class="text-xs text-muted-foreground mb-1">
				{#if result.reachesFull}
					nothing left to gain
				{:else if !result.meetsMinimum}
					still short of the {MINIMUM_QUALIFYING_YEARS}-year floor
				{:else}
					added to the projection above
				{/if}
			</div>
			<div class="text-xl font-semibold">
				{formatWeekly(result.valueOfOneMoreYearWeekly)} a week
			</div>
			<div class="text-xs text-muted-foreground">
				{formatAnnual(result.valueOfOneMoreYearAnnual)} a year, for life
			</div>
		</div>

		{#if result.futureYears > 0}
			<div class="flex-1 min-w-44 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">If you stopped paying today</div>
				<div class="text-xs text-muted-foreground mb-1">
					on the {formatYears(result.qualifyingYears)} already earned
				</div>
				<div class="text-xl font-semibold">
					{formatWeekly(result.weeklyIfNoMoreYears)} a week
				</div>
				<div class="text-xs text-muted-foreground">
					{formatAnnual(result.annualIfNoMoreYears)} a year
				</div>
			</div>
		{/if}
	</div>

	<table class="w-full text-sm border-collapse mb-4">
		<thead>
			<tr class="border-b border-border text-left">
				<th class="py-2 pr-2 font-medium">Qualifying years</th>
				<th class="py-2 px-2 font-medium text-right">Per week</th>
				<th class="py-2 px-2 font-medium text-right">Per year</th>
				<th class="py-2 pl-2 font-medium text-right">Of full rate</th>
			</tr>
		</thead>
		<tbody>
			{#each result.ladder as point (point.years)}
				<tr
					class="border-b border-border/60 {point.years === result.totalYears
						? 'font-medium'
						: 'text-muted-foreground'}"
				>
					<td class="py-2 pr-2">
						{point.years}
						{#if point.years === result.totalYears}
							<span class="text-xs text-muted-foreground">your projection</span>
						{:else if point.years === result.qualifyingYears}
							<span class="text-xs">already earned</span>
						{:else if point.years === MINIMUM_QUALIFYING_YEARS}
							<span class="text-xs">minimum to be paid anything</span>
						{:else if point.years === QUALIFYING_YEARS_FOR_FULL}
							<span class="text-xs">full rate</span>
						{/if}
					</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatWeekly(point.weekly)}</td>
					<td class="py-2 px-2 text-right tabular-nums">{formatAnnual(point.annual)}</td>
					<td class="py-2 pl-2 text-right tabular-nums">{Math.round(point.pctOfFull)}%</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<div class="flex flex-wrap items-end gap-3 mb-3">
		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="sp-dob-year">Birth year</label>
			<input
				id="sp-dob-year"
				type="number"
				min="1900"
				max="2100"
				step="1"
				bind:value={dobYear}
				placeholder="e.g. 1985"
				class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
			/>
		</div>
		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="sp-dob-month">Birth month</label>
			<input
				id="sp-dob-month"
				type="number"
				min="1"
				max="12"
				step="1"
				bind:value={dobMonth}
				placeholder="1–12"
				class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
			/>
		</div>
		<p class="text-sm pb-2 flex-1 min-w-64">
			{#if result.statePensionAge === null}
				Add a birth year to see the age this starts being paid at. Nothing above depends on it — the
				projection is a year count, not a date.
			{:else}
				Paid from age <span class="font-medium">{result.statePensionAge}</span>, in
				<span class="font-medium">{result.statePensionYear}</span>{yearsAwaySuffix}.
			{/if}
		</p>
	</div>

	<p class="text-sm mb-3">
		The State Pension is taxable, but it is paid gross — no tax is deducted from it, so any tax due
		comes out of your other income.
		{#if result.exceedsPersonalAllowance}
			At {formatAnnual(result.annual)} this projection already uses up the whole
			{formatAnnual(result.personalAllowance)} personal allowance.
		{:else}
			At {formatAnnual(result.annual)} it leaves
			<span class="font-medium">{formatAnnual(result.allowanceHeadroom)}</span>
			of the {formatAnnual(result.personalAllowance)} personal allowance for other retirement income before
			any tax is due.
		{/if}
	</p>

	{#if hasRecord}
		<div class="mb-3">
			<Button variant="ghost" size="sm" type="button" onclick={clearStatePension}>
				Clear NI years
			</Button>
		</div>
	{/if}

	<p class="text-xs text-muted-foreground">
		Illustrative only, not financial advice. {STATE_PENSION_TAX_YEAR} rates in today's money — the triple
		lock uprates them every April and none of that is projected forward here, so treat a pension decades
		away as a real-terms estimate. The 35ths arithmetic above is exactly right for a National Insurance
		record that starts in 2016/17 or later; if you have years before April 2016 your real entitlement
		is a "starting amount" under the transitional rules, which can sit either side of this figure and
		is reduced if you were ever contracted out. Deferring the State Pension (which increases it) and buying
		missing years with voluntary contributions (which costs money this doesn't know) are both unmodelled.
		Your own forecast at gov.uk/check-state-pension is the authoritative figure — this is a planning estimate
		built from the year counts you typed in.
	</p>
</Card>
