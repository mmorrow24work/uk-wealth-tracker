<script>
	/**
	 * Partner profile entry form — README.md → "Household / Partner Planning" (issue #170), built on
	 * top of the `Partner` data model #142 already added to `$lib/model.js` (`createPartner`,
	 * `normalisePartner`, `validatePartner`). Split out of #142 after that issue hit `error_max_turns`
	 * trying to ship the model and the form together, the same engine/panel split this milestone uses
	 * for #136/#161, #131/#132 and #140/#166.
	 *
	 * `AppData.partner` is `null` for a household with no partner, and that is the default — a
	 * one-person household is the common case, not an edge case, so the empty state below ("No
	 * partner recorded") is a first-class state rather than a form pre-filled with zeroes. The one
	 * "Add a partner" action is what creates a real record (`createPartner()`); the one "Remove
	 * partner" action sets it straight back to `null` rather than blanking the fields out, so every
	 * consumer downstream (#143's household lens, #144's joint forecast, #145's household budget,
	 * #146's Marriage Allowance pre-fill) can keep treating `null` as "no partner" without a second
	 * "is this partner actually filled in" check.
	 *
	 * There is no Save button: once a partner exists, every field commits on `input`, the same
	 * no-Save-button convention `StatePensionProjection` uses for a record that already exists rather
	 * than a list being added to. Field text is kept in local state (rather than binding straight
	 * into the bound `partner` object) so a blank box reads as "not typed" instead of being coerced
	 * to `0` mid-keystroke — `dob_month`/`dob_year`/`ni_qualifying_years` are all optional per #142's
	 * own typedef, and money/percentage fields fall back to `0` only once a value actually commits.
	 *
	 * No range checking is invented here: the fields' `min`/`max` are left to the browser's own
	 * number-input step controls, and anything out of range is reported by `validatePartnerFields`
	 * (the exported wrapper around #142's own `validatePartner`) exactly as it would be if this
	 * document were saved and reloaded — one set of range rules, not two.
	 */
	import { createPartner, validatePartnerFields } from '$lib/model.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/**
	 * @type {{ partner?: import('$lib/types.js').Partner | null }}
	 */
	let { partner = $bindable(null) } = $props();

	/** @param {number | null} field @returns {string} */
	function fieldText(field) {
		return field === null ? '' : String(field);
	}

	// Seeded once from whatever this panel is handed on mount — the Settings page only renders this
	// component after `hydrateAppData()` has resolved, so there is no pre-hydrate default to seed
	// from by mistake, the same guarantee `StatePensionProjection`'s own "seeded once" seed relies on.
	let name = $state(partner?.name ?? '');
	let dobMonth = $state(fieldText(partner?.dob_month ?? null));
	let dobYear = $state(fieldText(partner?.dob_year ?? null));
	let retirementAge = $state(partner ? String(partner.retirement_age) : '');
	let grossSalary = $state(partner ? String(partner.gross_salary) : '');
	let pensionPct = $state(partner ? String(partner.pension_pct) : '');
	let niYears = $state(fieldText(partner?.ni_qualifying_years ?? null));

	/**
	 * Blank stays `null` ("not recorded") rather than being coerced to `0` — the distinction #142's
	 * typedef draws for `dob_month`/`dob_year`/`ni_qualifying_years`. An unparseable value also reads
	 * as `null`, on the way to `validatePartnerFields` reporting nothing (`null` is always valid on
	 * these three) rather than a stray `NaN` reaching the store.
	 *
	 * @param {string} value
	 * @returns {number | null}
	 */
	function asOptionalNumber(value) {
		if (value.trim() === '') return null;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	/** Rewrites `partner` from the form's current field state. */
	function commit() {
		if (partner === null) return;
		partner = {
			name,
			dob_month: asOptionalNumber(dobMonth),
			dob_year: asOptionalNumber(dobYear),
			retirement_age: Number(retirementAge) || 0,
			gross_salary: Number(grossSalary) || 0,
			pension_pct: Number(pensionPct) || 0,
			ni_qualifying_years: asOptionalNumber(niYears)
		};
	}

	function addPartner() {
		const created = createPartner();
		name = created.name;
		dobMonth = fieldText(created.dob_month);
		dobYear = fieldText(created.dob_year);
		retirementAge = String(created.retirement_age);
		grossSalary = String(created.gross_salary);
		pensionPct = String(created.pension_pct);
		niYears = fieldText(created.ni_qualifying_years);
		partner = created;
	}

	function removePartner() {
		partner = null;
	}

	/**
	 * Field labels for `validatePartnerFields`' `path`s — the messages themselves are #142's own.
	 * @type {Record<string, string>}
	 */
	const FIELD_LABELS = {
		'partner.dob_month': 'Birth month',
		'partner.dob_year': 'Birth year',
		'partner.retirement_age': 'Retirement age',
		'partner.gross_salary': 'Gross salary',
		'partner.pension_pct': 'Pension contribution',
		'partner.ni_qualifying_years': 'NI qualifying years'
	};

	const errors = $derived(partner === null ? [] : validatePartnerFields(partner));
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-3">Partner</h2>

	{#if partner === null}
		<p class="text-sm text-muted-foreground mb-4">
			No partner recorded. Adding one unlocks the household net worth lens, the joint retirement
			forecast, the household budget and a Marriage Allowance pre-fill elsewhere in the app.
		</p>
		<Button type="button" size="sm" onclick={addPartner}>Add a partner</Button>
	{:else}
		<div class="flex flex-wrap items-end gap-3 mb-4">
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="partner-name">Name</label>
				<input
					id="partner-name"
					type="text"
					value={name}
					oninput={(event) => {
						name = event.currentTarget.value;
						commit();
					}}
					placeholder="e.g. Alex"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="partner-dob-month">Birth month</label>
				<input
					id="partner-dob-month"
					type="number"
					step="1"
					value={dobMonth}
					oninput={(event) => {
						dobMonth = event.currentTarget.value;
						commit();
					}}
					placeholder="e.g. 6"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="partner-dob-year">Birth year</label>
				<input
					id="partner-dob-year"
					type="number"
					step="1"
					value={dobYear}
					oninput={(event) => {
						dobYear = event.currentTarget.value;
						commit();
					}}
					placeholder="e.g. 1985"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="partner-retirement-age">Retirement age</label>
				<input
					id="partner-retirement-age"
					type="number"
					step="1"
					value={retirementAge}
					oninput={(event) => {
						retirementAge = event.currentTarget.value;
						commit();
					}}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="partner-salary">Gross salary (£)</label>
				<input
					id="partner-salary"
					type="number"
					step="500"
					value={grossSalary}
					oninput={(event) => {
						grossSalary = event.currentTarget.value;
						commit();
					}}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="partner-pension-pct">
					Pension contribution (%)
				</label>
				<input
					id="partner-pension-pct"
					type="number"
					step="0.1"
					value={pensionPct}
					oninput={(event) => {
						pensionPct = event.currentTarget.value;
						commit();
					}}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="partner-ni-years">NI qualifying years</label>
				<input
					id="partner-ni-years"
					type="number"
					step="1"
					value={niYears}
					oninput={(event) => {
						niYears = event.currentTarget.value;
						commit();
					}}
					placeholder="e.g. 20"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
				/>
			</div>
		</div>

		{#if errors.length > 0}
			<ul class="text-sm text-red-600 mb-3 list-disc pl-5">
				{#each errors as error (error.path)}
					<li>{FIELD_LABELS[error.path] ?? error.path} {error.message}</li>
				{/each}
			</ul>
		{/if}

		<Button variant="ghost" size="sm" type="button" onclick={removePartner}>Remove partner</Button>
	{/if}
</Card>
