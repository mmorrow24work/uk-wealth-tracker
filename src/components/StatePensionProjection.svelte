<script>
	/**
	 * UK State Pension projection from National Insurance qualifying years — README.md → "Pension
	 * Tracker": "UK State Pension projection from NI qualifying years (35 years for full £241.30/week
	 * 2026/27)" (issue #31).
	 *
	 * This is the "dedicated flow" `$lib/enums.js` promises where it explains why `PENSION_POT_TYPES`
	 * leaves `state` out of `PensionTracker`'s type select: the State Pension has no pot to add by
	 * hand, no provider and no contribution percentage, so putting it through the pot form would be
	 * five irrelevant fields around the only two that matter. It gets a card of its own, asking for
	 * the two counts and nothing else.
	 *
	 * It still stores what it collects in the same place as every other pot — one `type: 'state'`
	 * record in `pensions[]`, carrying `ni_qualifying_years`/`ni_future_years` — so the retirement
	 * income stream builder (#33) finds it beside the DB schemes and SIPPs rather than somewhere of
	 * this card's own. `$lib/state-pension.js`'s convention (6) is why there is exactly one: National
	 * Insurance is a fact about the person, not about a pot. The record is created on the first count
	 * entered and removed by the Remove button, which is the only way this card deletes anything.
	 *
	 * Unlike `PensionTracker`'s add/edit form there is no Save button: two number inputs against a
	 * record that already exists is not a form, and the store's own debounced sync means an
	 * every-keystroke write costs a re-render rather than a request. `profile` is read, never written
	 * — the same read-only seeding `PensionTaxRelief` takes it for.
	 *
	 * All the arithmetic is `$lib/state-pension.js`'s; this file formats it.
	 */
	import {
		FULL_STATE_PENSION_WEEKLY,
		MAX_QUALIFYING_YEARS,
		MINIMUM_QUALIFYING_YEARS,
		QUALIFYING_YEARS_FOR_FULL,
		STATE_PENSION_NAME,
		STATE_PENSION_TAX_YEAR,
		annualStatePension,
		asQualifyingYears,
		findStatePension,
		statePensionOutlook
	} from '$lib/state-pension.js';
	import { createPension, createProfile } from '$lib/model.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/**
	 * @type {{
	 *   pensions?: import('$lib/types.js').Pension[],
	 *   profile?: import('$lib/types.js').Profile,
	 *   withdrawalRate?: number,
	 *   now?: Date
	 * }}
	 */
	let {
		pensions = $bindable([]),
		profile = createProfile(),
		withdrawalRate = 4,
		now = new Date()
	} = $props();

	const outlook = $derived(statePensionOutlook(pensions, profile, { now, withdrawalRate }));
	const projection = $derived(outlook.projection);
	const timing = $derived(outlook.timing);

	/** @param {number | null | undefined} count @returns {string} */
	function countText(count) {
		return count === null || count === undefined ? '' : String(count);
	}

	// Seeded once, at mount, from whatever was hydrated into the store — the route only renders this
	// card after `hydrateAppData()` has resolved, so there is no pre-hydrate `[]` to read here.
	const seed = findStatePension(pensions);
	let qualifyingYearsInput = $state(countText(seed?.ni_qualifying_years));
	let futureYearsInput = $state(countText(seed?.ni_future_years));

	/**
	 * Write both counts into the single `type: 'state'` record, creating it if this is the first
	 * count entered. Blanking a box stores `null` ("not recorded") rather than `0` ("no qualifying
	 * years"), which is the distinction `$lib/types.js` asks for and the one the projection reports
	 * as `recorded`.
	 *
	 * Called from each input's own handler rather than from an `$effect`: the write it makes is to
	 * `pensions`, which the projection reads back, so an effect would re-run on its own output and
	 * spin. The handlers set the input state themselves instead of using `bind:value`, so the value
	 * committed is never a keystroke behind.
	 */
	function commit() {
		const qualifying = asQualifyingYears(qualifyingYearsInput);
		const future = asQualifyingYears(futureYearsInput);
		const existing = findStatePension(pensions);

		if (existing === null) {
			if (qualifying === null && future === null) return;
			pensions = [
				...pensions,
				createPension({
					name: STATE_PENSION_NAME,
					type: 'state',
					ni_qualifying_years: qualifying,
					ni_future_years: future
				})
			];
			return;
		}

		pensions = pensions.map((pension) =>
			pension.id === existing.id
				? { ...pension, ni_qualifying_years: qualifying, ni_future_years: future }
				: pension
		);
	}

	/**
	 * Snap both boxes back to what was actually stored, once the user has finished with them. A count
	 * is floored and clamped on the way in (`asQualifyingYears`), so typing `2835` records 60 and
	 * `12.7` records 12 — leaving the typed text on screen would show a number the projection below it
	 * is visibly not using. Run on `change` rather than on `input` so it never rewrites a box
	 * mid-keystroke.
	 */
	function normaliseInputs() {
		const stored = findStatePension(pensions);
		qualifyingYearsInput = countText(stored?.ni_qualifying_years);
		futureYearsInput = countText(stored?.ni_future_years);
	}

	function removeStatePension() {
		const existing = findStatePension(pensions);
		if (existing === null) return;

		pensions = pensions.filter((pension) => pension.id !== existing.id);
		qualifyingYearsInput = '';
		futureYearsInput = '';
	}

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	const weeklyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		minimumFractionDigits: 2
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} amount Weekly figures are quoted to the penny — that is how DWP states them. */
	function formatWeekly(amount) {
		return weeklyFormatter.format(amount);
	}

	/** @param {number} years @returns {string} e.g. "35 years", "1 year" */
	function formatYears(years) {
		return `${years} ${years === 1 ? 'year' : 'years'}`;
	}

	/** How full the 35-year bar is — clamped, since 60 recorded years still fills it exactly once. */
	const progressPct = $derived(
		Math.min(100, Math.round((projection.payableYears / QUALIFYING_YEARS_FOR_FULL) * 100))
	);
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">State Pension, {STATE_PENSION_TAX_YEAR}</h2>
	<p class="text-sm text-muted-foreground mb-4">
		The State Pension is bought with National Insurance years, not money:
		<span class="font-medium">{QUALIFYING_YEARS_FOR_FULL} qualifying years</span>
		gets the full {formatWeekly(FULL_STATE_PENSION_WEEKLY)} a week, fewer gets that many thirty-fifths
		of it, and under {MINIMUM_QUALIFYING_YEARS} gets nothing at all. Years you were credited — on Child
		Benefit for a child under 12, on certain benefits, or as a carer — count the same as years you paid,
		so use the count on your
		<a
			class="underline"
			href="https://www.gov.uk/check-state-pension"
			target="_blank"
			rel="noreferrer noopener">gov.uk State Pension forecast</a
		> rather than counting up the jobs you have had.
	</p>

	<div class="flex flex-wrap items-end gap-3 mb-4">
		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="state-pension-qualifying-years">
				Qualifying years so far
			</label>
			<input
				id="state-pension-qualifying-years"
				type="number"
				min="0"
				max={MAX_QUALIFYING_YEARS}
				step="1"
				value={qualifyingYearsInput}
				oninput={(event) => {
					qualifyingYearsInput = event.currentTarget.value;
					commit();
				}}
				onchange={normaliseInputs}
				placeholder="0"
				class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
			/>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-sm font-medium" for="state-pension-future-years">
				Further years expected
			</label>
			<input
				id="state-pension-future-years"
				type="number"
				min="0"
				max={MAX_QUALIFYING_YEARS}
				step="1"
				value={futureYearsInput}
				oninput={(event) => {
					futureYearsInput = event.currentTarget.value;
					commit();
				}}
				onchange={normaliseInputs}
				placeholder="0"
				class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
			/>
		</div>

		{#if outlook.record !== null}
			<Button variant="ghost" size="sm" type="button" onclick={removeStatePension}>Remove</Button>
		{/if}
	</div>

	{#if !projection.recorded && projection.futureYears === 0}
		<p class="text-sm">
			No National Insurance record entered yet. Put your qualifying years in above and this works
			out what the State Pension will pay you, and what it would take to reach the full rate.
		</p>
	{:else}
		<div class="flex flex-wrap gap-3 mb-4">
			<div class="flex-1 min-w-52 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Projected State Pension</div>
				<div class="text-xs text-muted-foreground mb-1">
					on {formatYears(projection.totalYears)} of National Insurance
				</div>
				<div class="text-xl font-semibold">{formatWeekly(projection.weeklyIncome)}/wk</div>
				<div class="text-xs text-muted-foreground">
					{formatMoney(projection.annualIncome)} a year · {formatMoney(projection.monthlyIncome)} a month
				</div>
			</div>

			<div class="flex-1 min-w-52 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Qualifying years</div>
				<div class="text-xs text-muted-foreground mb-1">
					{projection.qualifyingYears} earned + {projection.futureYears} expected
				</div>
				<div class="text-xl font-semibold">
					{projection.payableYears}
					<span class="text-muted-foreground text-sm">of {QUALIFYING_YEARS_FOR_FULL}</span>
				</div>
				<div class="h-2 w-full rounded-full bg-muted overflow-hidden mt-1.5">
					<div
						class="h-full rounded-full {projection.qualifies ? 'bg-black' : 'bg-amber-600'}"
						style="width: {progressPct}%"
					></div>
				</div>
				<div class="text-xs text-muted-foreground mt-1">
					{projection.full
						? 'Full rate'
						: `${progressPct}% of the full rate · ${formatYears(projection.shortfallYears)} short`}
				</div>
			</div>

			<div class="flex-1 min-w-52 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Worth as a pot</div>
				<div class="text-xs text-muted-foreground mb-1">
					at a {projection.withdrawalRate}% withdrawal rate
				</div>
				<div class="text-xl font-semibold">{formatMoney(projection.capitalEquivalent)}</div>
				<div class="text-xs text-muted-foreground">
					what a DC pot would need to be to buy the same income
				</div>
			</div>
		</div>

		{#if !projection.qualifies}
			<p class="text-sm text-amber-700 mb-3">
				<span class="font-medium">Under the {MINIMUM_QUALIFYING_YEARS}-year minimum.</span>
				{formatYears(projection.totalYears)} pays nothing at all — the State Pension starts at
				{MINIMUM_QUALIFYING_YEARS} qualifying years, not at one. Another
				{formatYears(projection.yearsToMinimum)} takes it from £0 to
				{formatMoney(annualStatePension(MINIMUM_QUALIFYING_YEARS))} a year — the whole of it arrives with
				the year that crosses the line.
			</p>
		{:else if projection.full}
			<p class="text-sm mb-3">
				<span class="font-medium">On course for the full rate.</span>
				{projection.wastedYears > 0
					? `${projection.wastedYears} of the ${formatYears(projection.totalYears)} projected go past the 35 that pay — National Insurance is due on earnings either way, so that is normal rather than something to fix.`
					: 'Exactly the 35 years the full rate takes.'}
			</p>
		{:else}
			<p class="text-sm mb-3">
				<span class="font-medium"
					>{formatYears(projection.shortfallYears)} short of the full rate.</span
				>
				Each further qualifying year is worth about {formatMoney(projection.nextYearValue)} a year for
				life, so closing the gap would add {formatMoney(
					projection.nextYearValue * projection.shortfallYears
				)} a year.
			</p>
		{/if}

		{#if projection.futureYears > 0}
			<p class="text-sm mb-3">
				The {formatYears(projection.qualifyingYears)} already on your record would pay
				{formatMoney(projection.currentAnnualIncome)} a year on their own; the
				{formatYears(projection.futureYears)} you still expect add
				{formatMoney(projection.futureUplift)} a year on top.
			</p>
		{/if}

		{#if outlook.unearnableYears > 0}
			<p class="text-sm text-amber-700 mb-3">
				<span class="font-medium">More future years than there is time for.</span>
				You reach State Pension age in {formatYears(timing.yearsRemaining)}, and a qualifying year
				takes a tax year to earn — so {outlook.unearnableYears} of the
				{formatYears(projection.futureYears)} above cannot be earned before then.
			</p>
		{/if}

		<p class="text-sm mb-3">
			{#if timing.available}
				State Pension age is {timing.statePensionAge} for you, in {timing.calendarYear} —
				{timing.reached
					? 'which you have already reached.'
					: `${formatYears(timing.yearsRemaining)} away, and the most further qualifying years there is time to earn.`}
			{:else}
				Add your date of birth on the forecast tab and this will say when your State Pension starts
				and how many more qualifying years there is time to earn. Until then it assumes
				{timing.statePensionAge}.
			{/if}
		</p>
	{/if}

	<p class="text-xs text-muted-foreground">
		Illustrative only, not financial advice. In today's money at the {STATE_PENSION_TAX_YEAR} rate, with
		no uprating applied, so a projection decades out is what it would be worth now — the triple lock has
		raised it by more than inflation in most recent years. The 35ths rule above is the new State Pension's;
		if you have National Insurance from before April 2016, your actual figure is the higher of that and
		what the old basic-plus-additional rules give, and being contracted out can push it the other way
		— which is why the gov.uk forecast is the number that counts. Nothing here models deferring the pension
		(which raises it by about 5.8% for each year not claimed), voluntary Class 3 contributions to fill
		gaps in your record, or the income tax the State Pension is liable to as earned income while being
		paid without any deducted. The "worth as a pot" figure is a comparison, not a transfer value — the
		State Pension cannot be exchanged for one.
	</p>
</Card>
