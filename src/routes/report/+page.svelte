<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import Button from '../../components/ui/button.svelte';
	import {
		DEBT_TYPE_LABELS,
		INVESTMENT_TYPE_LABELS,
		TAX_REGION_LABELS,
		WRAPPER_LABELS,
		appData,
		buildReport,
		createAppData,
		hydrateAppData
	} from '$lib/index.js';

	// Read-only against the store (#5), same hydrate-then-render pattern as every other tab — this
	// page never writes anything back. `report` is built once from the snapshot taken right after
	// hydration, not a live `$derived` off the store, so what prints matches what was on screen when
	// "Print / Save as PDF" was clicked even if another tab is mid-edit in a second browser tab.
	// Seeded from `buildReport(createAppData())` (an empty, `hasData: false` report) rather than
	// `null`, the same "seed from a real default, not a nullable placeholder" shape `TaxCalculator`'s
	// `profile = $state(createProfile())` already uses on the Tax tab — `ready` (below) is what
	// actually gates rendering, so this default is never shown, only ever type-checked against.
	/** @type {import('$lib/report.js').Report} */
	let report = $state(buildReport(createAppData()));
	let profileName = $state('');
	let ready = $state(false);

	// `new Date()` here (not in `report.js`) is deliberately a presentation concern, same as every
	// other tab's own `currencyFormatter`/`formatMonth` pair (DebtTracker.svelte, FireCalculator.svelte,
	// …) — `$lib/report.js` stays pure and stamps nothing itself, and "as of" (the latest recorded
	// snapshot) stays a different date from "generated on" (today, when the PDF was made). The same
	// `Date` is also the clock `buildReport` dates the State Pension projection against, so "Generated"
	// and the State Pension's own age arithmetic agree on what "now" was.
	const now = new Date();
	const generatedOnFormatter = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' });
	const generatedOn = generatedOnFormatter.format(now);

	onMount(async () => {
		await hydrateAppData();
		const data = get(appData);
		report = buildReport(data, { now });
		profileName = data.profile.name;
		ready = true;
	});

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP'
	});
	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} rate @returns {string} e.g. "20%", "67.5%" */
	function formatRate(rate) {
		return `${Math.round(rate * 100) / 100}%`;
	}

	const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
	/** @param {{ month: number, year: number }} value */
	function formatAsOf({ month, year }) {
		return monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
	}

	// Holdings the totals above don't count (e.g. a mortgage-offset property already tracked on the
	// Property tab) still get their own place in the report — a mortgage adviser wants the full
	// picture of what exists, not just what counts towards net worth (see `report.js`'s own
	// `holdings` doc: "a report should show what exists even where a total doesn't count it").
	const excludedHoldings = $derived(
		report.netWorth.hasData
			? report.netWorth.holdings.filter((holding) => holding.exclude_from_net_worth)
			: []
	);
</script>

<h1>🖨️ Report</h1>
<p class="no-print">
	A printable summary of your net worth, investment holdings, income tax and pensions, for an
	adviser meeting or a mortgage application. "Print / Save as PDF" opens your browser's print dialog
	with the navigation and this paragraph hidden, in a plain light layout regardless of your current
	theme — choose "Save as PDF" there instead of a physical printer if that's what you need.
</p>

{#if !ready}
	<p class="text-sm text-muted-foreground">Loading your saved data…</p>
{:else}
	<Button className="no-print mb-6" onclick={() => window.print()}>Print / Save as PDF</Button>

	<div class="print-report max-w-2xl">
		<header class="report-section mb-6">
			<h2 class="text-xl font-semibold">{profileName || 'Wealth report'}</h2>
			<p class="text-sm text-muted-foreground">Generated {generatedOn}</p>
			<p class="text-xs text-muted-foreground">Not financial advice. All figures illustrative.</p>
		</header>

		{#if !report.netWorth.asOf}
			<p class="report-section text-sm text-muted-foreground">
				No monthly snapshot has been recorded yet — add one on the Net Worth tab to generate a
				report.
			</p>
		{:else}
			<section class="report-section mb-6">
				<h3 class="text-lg font-semibold mb-2">Net worth</h3>
				<p class="text-sm text-muted-foreground mb-2">
					As of {formatAsOf(report.netWorth.asOf)}
				</p>
				<table class="w-full text-sm border-collapse">
					<tbody>
						<tr class="border-b border-border">
							<td class="py-1">Investments</td>
							<td class="py-1 text-right">{formatMoney(report.netWorth.investmentTotal)}</td>
						</tr>
						<tr class="border-b border-border">
							<td class="py-1">Debts</td>
							<td class="py-1 text-right">−{formatMoney(report.netWorth.debtTotal)}</td>
						</tr>
						<tr class="font-semibold">
							<td class="py-1">Net worth</td>
							<td class="py-1 text-right">{formatMoney(report.netWorth.netWorth)}</td>
						</tr>
					</tbody>
				</table>
			</section>

			<section class="report-section mb-6">
				<h3 class="text-lg font-semibold mb-2">Investments</h3>
				{#if report.netWorth.holdingsByType.length === 0}
					<p class="text-sm text-muted-foreground">
						No investment holdings counted towards net worth.
					</p>
				{:else}
					{#each report.netWorth.holdingsByType as group (group.type)}
						<div class="mb-4">
							<h4 class="font-medium flex justify-between">
								<span>{group.label}</span>
								<span>{formatMoney(group.total)}</span>
							</h4>
							<ul class="list-none p-0 m-0 text-sm">
								{#each group.holdings as holding (holding.id)}
									<li class="flex justify-between border-b border-border py-1">
										<span
											>{holding.name || 'Unnamed holding'} · {WRAPPER_LABELS[holding.wrapper]}</span
										>
										<span>{formatMoney(holding.value)}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				{/if}

				{#if excludedHoldings.length > 0}
					<div class="mb-4">
						<h4 class="font-medium text-muted-foreground">
							Other holdings (not counted towards net worth)
						</h4>
						<ul class="list-none p-0 m-0 text-sm">
							{#each excludedHoldings as holding (holding.id)}
								<li class="flex justify-between border-b border-border py-1">
									<span
										>{holding.name || 'Unnamed holding'} · {INVESTMENT_TYPE_LABELS[
											holding.type
										]}</span
									>
									<span>{formatMoney(holding.value)}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</section>

			<section class="report-section mb-6">
				<h3 class="text-lg font-semibold mb-2">Debts</h3>
				{#if report.netWorth.debts.length === 0}
					<p class="text-sm text-muted-foreground">No debts recorded.</p>
				{:else}
					<ul class="list-none p-0 m-0 text-sm">
						{#each report.netWorth.debts as debt (debt.id)}
							<li class="flex justify-between border-b border-border py-1">
								<span>
									{debt.name || 'Unnamed debt'} · {DEBT_TYPE_LABELS[debt.type]}
									{#if debt.exclude_from_net_worth}
										<span class="text-xs text-muted-foreground">(excluded from net worth)</span>
									{/if}
								</span>
								<span>{formatMoney(debt.balance)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		<!-- Tax is read from `profile.gross_salary`/`profile.tax_region`, not the monthly snapshots
		     above, so it renders on its own — a household with a recorded salary but no net worth
		     history yet still gets a tax section, and vice versa. -->
		<section class="report-section mb-6">
			<h3 class="text-lg font-semibold mb-2">Tax</h3>
			{#if !report.tax.breakdown}
				<p class="text-sm text-muted-foreground">No salary recorded yet.</p>
			{:else}
				{@const breakdown = report.tax.breakdown}
				<p class="text-sm text-muted-foreground mb-2">
					{TAX_REGION_LABELS[breakdown.region]}, {breakdown.taxYear}
				</p>
				<table class="w-full text-sm border-collapse mb-2">
					<thead>
						<tr class="border-b border-border text-left">
							<th class="py-1 font-medium">Band</th>
							<th class="py-1 font-medium text-right">Rate</th>
							<th class="py-1 font-medium text-right">Taxable amount</th>
							<th class="py-1 font-medium text-right">Tax</th>
						</tr>
					</thead>
					<tbody>
						{#each breakdown.bands as band (band.id)}
							<tr class="border-b border-border">
								<td class="py-1">{band.label}</td>
								<td class="py-1 text-right">{formatRate(band.rate)}</td>
								<td class="py-1 text-right">{formatMoney(band.amount)}</td>
								<td class="py-1 text-right">{formatMoney(band.tax)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class="py-1" colspan="3">Total tax</td>
							<td class="py-1 text-right">{formatMoney(breakdown.totalTax)}</td>
						</tr>
					</tfoot>
				</table>
				<table class="w-full text-sm border-collapse">
					<tbody>
						<tr class="border-b border-border">
							<td class="py-1">Take-home</td>
							<td class="py-1 text-right">{formatMoney(breakdown.takeHome)}</td>
						</tr>
						<tr>
							<td class="py-1">Effective rate</td>
							<td class="py-1 text-right">{formatRate(breakdown.effectiveRate)}</td>
						</tr>
					</tbody>
				</table>
			{/if}
		</section>

		<!-- Pensions is read from AppData.pensions, independent of the sections above for the same
		     reason the tax section is: a household can have pensions recorded with no net worth
		     history yet, or vice versa. -->
		<section class="report-section mb-6">
			<h3 class="text-lg font-semibold mb-2">Pensions</h3>
			{#if !report.pensions.hasData}
				<p class="text-sm text-muted-foreground">No pensions recorded yet.</p>
			{:else}
				<table class="w-full text-sm border-collapse">
					<tbody>
						<tr class="border-b border-border">
							<td class="py-1">Defined Contribution pots ({report.pensions.dcPotCount})</td>
							<td class="py-1 text-right">{formatMoney(report.pensions.dcPotTotal)}</td>
						</tr>
						<tr class="border-b border-border">
							<td class="py-1">Defined Benefit guaranteed income</td>
							<td class="py-1 text-right"
								>{formatMoney(report.pensions.definedBenefit.annualIncome)}/yr</td
							>
						</tr>
						<tr class="border-b border-border">
							<td class="py-1"
								>State Pension ({report.pensions.statePension.projection.totalYears} qualifying years)</td
							>
							<td class="py-1 text-right"
								>{formatMoney(report.pensions.statePension.projection.annualIncome)}/yr</td
							>
						</tr>
						<tr>
							<td class="py-1"
								>Pension tax relief ({report.pensions.pensionRelief.count} eligible pot{report
									.pensions.pensionRelief.count === 1
									? ''
									: 's'})</td
							>
							<td class="py-1 text-right"
								>{formatMoney(report.pensions.pensionRelief.totalRelief)}/yr</td
							>
						</tr>
					</tbody>
				</table>
			{/if}
		</section>
	</div>
{/if}
