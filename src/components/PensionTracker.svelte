<script>
	/**
	 * Pension pot tracking — README.md → "Pension Tracker": "Types: DC Workplace, SIPP, Defined
	 * Benefit (Final Salary / CARE), Lifetime ISA" and "Per-pot: value, contribution %, employer
	 * contribution %, annual fund fee/OCF" (issue #29's exact scope). The State Pension is a
	 * `PensionType` too (`$lib/enums.js`), but it has no pot to add by hand — it is derived from NI
	 * qualifying years instead, via a dedicated flow (#31) — so `PENSION_POT_TYPES` (not the full
	 * `PENSION_TYPES`) drives this form's type select.
	 *
	 * Unlike `InvestmentHoldings`/`DebtTracker`, pension pots are not re-stated per month: README.md's
	 * data model outline puts `pensions[]` directly on `AppData`, one flat list rather than nested in
	 * `monthly_entries`, since a pension balance is a point-in-time fact the user updates occasionally
	 * rather than a monthly snapshot line. So there is no month selector here — just add, edit, remove
	 * against one list, the same shape `AutoInvestFill` treats `monthlyEntries` as, minus the nesting.
	 *
	 * `contribution_pct`/`employer_pct`/`fund_fee` only mean something for the three pot-value types
	 * (DC Workplace, SIPP, Lifetime ISA) — `$lib/model.js`'s own `Pension` typedef says a Defined
	 * Benefit pot uses the `db_*` accrual fields instead and carries zero in these. Issue #30 replaces
	 * #29's forward-reference note with those four fields, and shows each Defined Benefit pot's income
	 * on its row: `$lib/defined-benefit.js` owns the formula, this owns the inputs to it.
	 *
	 * The accrual rate is asked for twice over, deliberately. Schemes are always *described* as a
	 * fraction ("a 1/60th scheme") and `Pension.db_accrual_rate` stores a percentage, so the select
	 * offers the usual denominators and writes the matching percentage into the number input beside
	 * it. The percentage is the single source of truth — the select is derived back off it, so typing
	 * a rate that happens to be 1/80th selects 1/80th, and typing one that is nobody's fraction falls
	 * to "Other".
	 *
	 * No activity log: `$lib/enums.js`'s `ACTIVITY_LOG_ENTITY_TYPES` covers `investment`/`debt` only
	 * (issue #14's own scope), and pensions were never in it.
	 */
	import {
		COMMON_ACCRUAL_DENOMINATORS,
		accrualFractionLabel,
		accrualRateFromDenominator,
		asRecordedInput,
		definedBenefitBreakdown
	} from '$lib/defined-benefit.js';
	import {
		DEFINED_BENEFIT_PENSION_TYPES,
		PENSION_POT_TYPES,
		PENSION_TYPE_LABELS
	} from '$lib/enums.js';
	import { createPension } from '$lib/model.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/**
	 * @type {{ pensions?: import('$lib/types.js').Pension[] }}
	 */
	let { pensions = $bindable([]) } = $props();

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {import('$lib/enums.js').PensionType} type */
	function isDefinedBenefitType(type) {
		return DEFINED_BENEFIT_PENSION_TYPES.includes(type);
	}

	/** @param {import('$lib/types.js').Pension} pension */
	function incomeSummary(pension) {
		const db = definedBenefitBreakdown(pension);
		if (!db.complete) return '';

		const headline = `${formatMoney(db.annualIncome)}/yr · ${formatMoney(db.monthlyIncome)}/mo`;
		if (db.source === 'stated') return `${headline} · taken from your statement`;

		const rate = db.accrualFraction || `${db.accrualRate}%`;
		return `${headline} · ${rate} × ${db.years} yrs × ${formatMoney(/** @type {number} */ (db.salary))}`;
	}

	const totalPotValue = $derived(pensions.reduce((sum, pension) => sum + pension.value, 0));

	/** @type {string | null} */
	let editingId = $state(null);
	let name = $state('');
	/** @type {import('$lib/enums.js').PensionType} */
	let type = $state('dc_workplace');
	let value = $state('');
	let contributionPct = $state('');
	let employerPct = $state('');
	let fundFee = $state('');
	let accrualRate = $state('');
	let dbYears = $state('');
	let dbSalary = $state('');
	let dbAnnualIncome = $state('');

	const showPotFields = $derived(!isDefinedBenefitType(type));

	/**
	 * Which fraction the typed rate is, if it is one of the ones on offer — `''` selects "Other".
	 * Compared as labels so the tolerance for "close enough to 1/60th" lives in one place,
	 * `defined-benefit.js`, rather than being restated here.
	 */
	const selectedDenominator = $derived.by(() => {
		const rate = asRecordedInput(accrualRate);
		if (rate === null) return '';

		const label = accrualFractionLabel(rate);
		const match = COMMON_ACCRUAL_DENOMINATORS.find(
			(denominator) => label !== '' && label === fractionLabel(denominator)
		);
		return match === undefined ? '' : String(match);
	});

	/** @param {number} denominator @returns {string} e.g. "1/60th" */
	function fractionLabel(denominator) {
		return accrualFractionLabel(accrualRateFromDenominator(denominator));
	}

	/**
	 * Picking a fraction writes the percentage it works out to, rounded to four decimals — the same
	 * precision `types.js` documents (`a 1/60th scheme is 1.6667`), and close enough that the select
	 * derives straight back to the fraction just chosen.
	 *
	 * @param {string} denominator
	 */
	function pickAccrualFraction(denominator) {
		if (denominator === '') return;
		const rate = accrualRateFromDenominator(Number(denominator));
		accrualRate = String(Math.round(rate * 10_000) / 10_000);
	}

	function resetForm() {
		editingId = null;
		name = '';
		type = 'dc_workplace';
		value = '';
		contributionPct = '';
		employerPct = '';
		fundFee = '';
		accrualRate = '';
		dbYears = '';
		dbSalary = '';
		dbAnnualIncome = '';
	}

	function formFields() {
		const isPot = !isDefinedBenefitType(type);
		const isDb = !isPot;
		return {
			name: name.trim(),
			type,
			value: isPot ? Number(value) || 0 : 0,
			contribution_pct: isPot ? Number(contributionPct) || 0 : 0,
			employer_pct: isPot ? Number(employerPct) || 0 : 0,
			fund_fee: isPot ? Number(fundFee) || 0 : 0,
			db_accrual_rate: isDb ? asRecordedInput(accrualRate) : null,
			db_years: isDb ? asRecordedInput(dbYears) : null,
			db_salary: isDb ? asRecordedInput(dbSalary) : null,
			db_annual_income: isDb ? asRecordedInput(dbAnnualIncome) : null
		};
	}

	/** @param {number | null} field @returns {string} */
	function fieldText(field) {
		return field === null ? '' : String(field);
	}

	/** @param {import('$lib/types.js').Pension} pension */
	function startEdit(pension) {
		editingId = pension.id;
		name = pension.name;
		type = pension.type;
		value = String(pension.value);
		contributionPct = String(pension.contribution_pct);
		employerPct = String(pension.employer_pct);
		fundFee = String(pension.fund_fee);
		accrualRate = fieldText(pension.db_accrual_rate);
		dbYears = fieldText(pension.db_years);
		dbSalary = fieldText(pension.db_salary);
		dbAnnualIncome = fieldText(pension.db_annual_income);
	}

	function addPension() {
		const fields = formFields();
		if (fields.name === '') return;

		pensions = [...pensions, createPension(fields)];
		resetForm();
	}

	function saveEdit() {
		if (editingId === null) return;
		const before = pensions.find((pension) => pension.id === editingId);
		if (!before) return;

		const fields = formFields();
		if (fields.name === '') return;

		const after = { ...before, ...fields };
		pensions = pensions.map((pension) => (pension.id === editingId ? after : pension));
		resetForm();
	}

	function submitForm() {
		if (editingId === null) addPension();
		else saveEdit();
	}

	/** @param {string} id */
	function removePension(id) {
		pensions = pensions.filter((pension) => pension.id !== id);
		if (editingId === id) resetForm();
	}
</script>

<div class="flex flex-col gap-6">
	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Pension pots</h2>

		{#if pensions.length === 0}
			<p class="text-sm text-muted-foreground mb-4">No pension pots recorded yet. Add one below.</p>
		{:else}
			<p class="text-sm text-muted-foreground mb-3">
				{pensions.length} pot{pensions.length === 1 ? '' : 's'} recorded, totalling {formatMoney(
					totalPotValue
				)} of pot value.
			</p>

			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each pensions as pension (pension.id)}
					<li
						class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
					>
						<div class="flex flex-col">
							<span class="font-medium">{pension.name}</span>
							<span class="text-sm text-muted-foreground">
								{PENSION_TYPE_LABELS[pension.type]}
							</span>
							{#if isDefinedBenefitType(pension.type)}
								{@const summary = incomeSummary(pension)}
								<span class="text-xs text-muted-foreground max-w-md">
									{#if summary === ''}
										No income yet — add an accrual rate, years of service and pensionable salary, or
										the annual income straight off your statement.
									{:else}
										{summary}
									{/if}
								</span>
							{:else}
								<span class="text-xs text-muted-foreground">
									{formatMoney(pension.value)} pot · {pension.contribution_pct}% your contribution +
									{pension.employer_pct}% employer · {pension.fund_fee}% fund fee
								</span>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<Button variant="outline" size="sm" type="button" onclick={() => startEdit(pension)}>
								Edit
							</Button>
							<Button
								variant="ghost"
								size="sm"
								type="button"
								onclick={() => removePension(pension.id)}
							>
								Remove
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			class="flex flex-wrap items-end gap-3"
			onsubmit={(event) => {
				event.preventDefault();
				submitForm();
			}}
		>
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="pension-name">Name</label>
				<input
					id="pension-name"
					type="text"
					bind:value={name}
					placeholder="e.g. Aviva workplace pension"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
					required
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="pension-type">Type</label>
				<select
					id="pension-type"
					bind:value={type}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				>
					{#each PENSION_POT_TYPES as pensionType (pensionType)}
						<option value={pensionType}>{PENSION_TYPE_LABELS[pensionType]}</option>
					{/each}
				</select>
			</div>

			{#if showPotFields}
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="pension-value">Pot value (£)</label>
					<input
						id="pension-value"
						type="number"
						min="0"
						step="0.01"
						bind:value
						placeholder="0"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="pension-contribution">Your contribution (%)</label
					>
					<input
						id="pension-contribution"
						type="number"
						min="0"
						max="100"
						step="0.1"
						bind:value={contributionPct}
						placeholder="0"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="pension-employer">Employer contribution (%)</label
					>
					<input
						id="pension-employer"
						type="number"
						min="0"
						max="100"
						step="0.1"
						bind:value={employerPct}
						placeholder="0"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="pension-fee">Annual fund fee / OCF (%)</label>
					<input
						id="pension-fee"
						type="number"
						min="0"
						max="100"
						step="0.01"
						bind:value={fundFee}
						placeholder="0"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
					/>
				</div>
			{:else}
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="pension-accrual-fraction">Accrual</label>
					<select
						id="pension-accrual-fraction"
						value={selectedDenominator}
						onchange={(event) => pickAccrualFraction(event.currentTarget.value)}
						class="border border-input rounded-md px-2 py-1.5 text-sm"
					>
						<option value="">Other</option>
						{#each COMMON_ACCRUAL_DENOMINATORS as denominator (denominator)}
							<option value={String(denominator)}>{fractionLabel(denominator)}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="pension-accrual-rate">Accrual rate (%/yr)</label>
					<input
						id="pension-accrual-rate"
						type="number"
						min="0"
						max="100"
						step="0.0001"
						bind:value={accrualRate}
						placeholder="1.6667"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="pension-db-years">Years of service</label>
					<input
						id="pension-db-years"
						type="number"
						min="0"
						max="100"
						step="0.1"
						bind:value={dbYears}
						placeholder="0"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="pension-db-salary">Pensionable salary (£)</label>
					<input
						id="pension-db-salary"
						type="number"
						min="0"
						step="0.01"
						bind:value={dbSalary}
						placeholder="0"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="pension-db-income">
						Annual income from statement (£)
					</label>
					<input
						id="pension-db-income"
						type="number"
						min="0"
						step="0.01"
						bind:value={dbAnnualIncome}
						placeholder="Optional"
						class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
					/>
				</div>

				<p class="text-xs text-muted-foreground max-w-md pb-2">
					A Defined Benefit pot has no pot value — its income is
					<span class="font-medium">accrual rate × pensionable salary × years of service</span>.
					Enter years of service as the total you expect to have when you draw the pension, and the
					salary you expect it to be worked out on. A figure off your annual benefit statement wins
					over the formula if you have one.
				</p>
			{/if}

			<Button type="submit" size="sm">{editingId === null ? 'Add pot' : 'Save changes'}</Button>
			{#if editingId !== null}
				<Button variant="ghost" size="sm" type="button" onclick={resetForm}>Cancel</Button>
			{/if}
		</form>
	</Card>
</div>
