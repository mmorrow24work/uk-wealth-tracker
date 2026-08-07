<script>
	/**
	 * Physical asset tracking — README.md → "Physical Assets Tracker": "Categories: Watches &
	 * Jewellery, Art & Collectables, Classic/Collector Cars, Wine & Whisky, Precious Metals, Other",
	 * "Fields: name, purchase price, current value, purchase date, expected annual change %, annual
	 * holding cost", "Gain/loss vs purchase price, annualised CAGR, net position after holding
	 * costs", "Future value projection chart" and "Toggle: include/exclude from net worth" (issue
	 * #39's exact scope).
	 *
	 * Structured the same way `PropertyTracker.svelte` handles `properties[]`: `assets[]` sits
	 * directly on `AppData` (`$lib/model.js`'s own `Asset` typedef), one list the user adds to,
	 * edits and removes from — an asset is a point-in-time fact, not a monthly snapshot line.
	 *
	 * `$lib/assets.js` owns the maths (`assetGainLoss`, `assetCAGR`, `assetNetPosition`,
	 * `assetPortfolioSummary`, `assetPortfolioProjection`); this component only reads it. CAGR is
	 * hidden on a row when it is `null` — no `purchase_date` on file, or a zero purchase price
	 * (`assets.js`'s own "nothing to annualise from" convention) — the same "don't show a computed
	 * line for data that isn't there" rule `PropertyTracker.svelte` applies to its own cashflow/yield
	 * line.
	 *
	 * `include_in_net_worth` is a row-level instant toggle, not a form field — the same pattern
	 * `PropertyTracker.svelte`/`DebtTracker.svelte` use for their own net-worth toggles, rather than
	 * routing a boolean through the add/edit form and an extra "Save changes" click.
	 *
	 * **The future value projection is a sampled table, not a plotted chart** — the same choice
	 * `DividendIncomePlanner.svelte`'s own header records for every forecast-style panel in this app
	 * that is not the flagship `NetWorthChart`: `CompoundingPanel`, `StressTestPanel` and
	 * `FireCalculator`'s own accumulation/drawdown tables all render their series this way, and
	 * README.md's "chart" language has consistently meant "a table of a projected series" everywhere
	 * else it appears in a non-`NetWorthChart` panel. It projects every recorded asset (not gated on
	 * the include/exclude toggle, matching `assetPortfolioProjection`'s own choice not to filter),
	 * each compounding at its own `expected_growth`, alongside the accumulating holding-cost drag.
	 *
	 * No activity log: `$lib/enums.js`'s `ACTIVITY_LOG_ENTITY_TYPES` covers `investment`/`debt` only
	 * (issue #14's own scope) — properties, pensions and dividends have none either, for the same
	 * reason.
	 */
	import { ASSET_CATEGORIES, ASSET_CATEGORY_LABELS } from '$lib/enums.js';
	import { createAsset } from '$lib/model.js';
	import {
		assetCAGR,
		assetGainLoss,
		assetNetPosition,
		assetPortfolioProjection,
		assetPortfolioSummary
	} from '$lib/assets.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';

	/**
	 * @type {{ assets?: import('$lib/types.js').Asset[] }}
	 */
	let { assets = $bindable([]) } = $props();

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} amount */
	function formatSignedMoney(amount) {
		const formatted = formatMoney(Math.abs(amount));
		return amount < 0 ? `-${formatted}` : `+${formatted}`;
	}

	const summary = $derived(assetPortfolioSummary(assets));

	const PROJECTION_YEARS_MIN = 1;
	const PROJECTION_YEARS_MAX = 50;
	let projectionYears = $state(10);

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

	const parsedProjectionYears = $derived(
		Math.min(PROJECTION_YEARS_MAX, Math.max(PROJECTION_YEARS_MIN, parse(projectionYears, 10)))
	);

	const projection = $derived(assetPortfolioProjection(assets, { years: parsedProjectionYears }));

	/**
	 * A series sampled every `step` offsets, always including the first and last point — the same
	 * shape `DividendIncomePlanner.svelte`'s own `sample` gives its building/income phase tables.
	 *
	 * @param {readonly import('$lib/assets.js').AssetProjectionPoint[]} points
	 * @param {number} step
	 * @returns {import('$lib/assets.js').AssetProjectionPoint[]}
	 */
	function sample(points, step) {
		if (points.length === 0) return [];
		const last = points.at(-1)?.offset ?? 0;
		const wanted = [0, last];
		for (let offset = step; offset < last; offset += step) wanted.push(offset);

		/** @type {import('$lib/assets.js').AssetProjectionPoint[]} */
		const rows = [];
		for (const offset of wanted.sort((a, b) => a - b)) {
			if (rows.at(-1)?.offset === offset) continue;
			const point = points.find((candidate) => candidate.offset === offset);
			if (point) rows.push(point);
		}
		return rows;
	}

	const projectionRows = $derived(sample(projection.points, parsedProjectionYears > 15 ? 5 : 1));

	/** @type {string | null} */
	let editingId = $state(null);
	let name = $state('');
	/** @type {import('$lib/enums.js').AssetCategory} */
	let category = $state('other');
	let purchasePrice = $state('');
	let currentValue = $state('');
	let purchaseDate = $state('');
	let expectedGrowth = $state('');
	let holdingCost = $state('');

	function resetForm() {
		editingId = null;
		name = '';
		category = 'other';
		purchasePrice = '';
		currentValue = '';
		purchaseDate = '';
		expectedGrowth = '';
		holdingCost = '';
	}

	function formFields() {
		return {
			name: name.trim(),
			category,
			purchase_price: Number(purchasePrice) || 0,
			current_value: Number(currentValue) || 0,
			purchase_date: purchaseDate === '' ? null : purchaseDate,
			expected_growth: Number(expectedGrowth) || 0,
			holding_cost: Number(holdingCost) || 0
		};
	}

	/** @param {import('$lib/types.js').Asset} asset */
	function startEdit(asset) {
		editingId = asset.id;
		name = asset.name;
		category = asset.category;
		purchasePrice = String(asset.purchase_price);
		currentValue = String(asset.current_value);
		purchaseDate = asset.purchase_date ?? '';
		expectedGrowth = String(asset.expected_growth);
		holdingCost = String(asset.holding_cost);
	}

	function addAsset() {
		const fields = formFields();
		if (fields.name === '') return;

		assets = [...assets, createAsset(fields)];
		resetForm();
	}

	function saveEdit() {
		if (editingId === null) return;
		const before = assets.find((a) => a.id === editingId);
		if (!before) return;

		const fields = formFields();
		if (fields.name === '') return;

		const after = { ...before, ...fields };
		assets = assets.map((a) => (a.id === editingId ? after : a));
		resetForm();
	}

	function submitForm() {
		if (editingId === null) addAsset();
		else saveEdit();
	}

	/** @param {string} id */
	function removeAsset(id) {
		assets = assets.filter((a) => a.id !== id);
		if (editingId === id) resetForm();
	}

	/** @param {string} id */
	function toggleIncludeInNetWorth(id) {
		assets = assets.map((a) =>
			a.id === id ? { ...a, include_in_net_worth: !a.include_in_net_worth } : a
		);
	}
</script>

<div class="flex flex-col gap-6">
	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Physical assets</h2>

		{#if assets.length === 0}
			<p class="text-sm text-muted-foreground mb-4">
				No physical assets recorded yet. Add one below.
			</p>
		{:else}
			<p class="text-sm text-muted-foreground mb-3">
				{assets.length} asset{assets.length === 1 ? '' : 's'} recorded, totalling {formatMoney(
					summary.totalCurrentValue
				)} of value against {formatMoney(summary.totalPurchasePrice)} paid — {formatSignedMoney(
					summary.totalGainLoss
				)} gain/loss.
				{#if summary.excludedFromNetWorth.count > 0}
					{formatMoney(summary.includedInNetWorth.currentValue)} of that counts towards net worth ({summary
						.excludedFromNetWorth.count} asset{summary.excludedFromNetWorth.count === 1 ? '' : 's'} excluded).
				{/if}
			</p>

			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each assets as asset (asset.id)}
					{@const gainLoss = assetGainLoss(asset)}
					{@const cagr = assetCAGR(asset)}
					{@const netPosition = assetNetPosition(asset)}
					<li
						class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
					>
						<div class="flex flex-col">
							<span class="font-medium">{asset.name}</span>
							<span class="text-sm text-muted-foreground">
								{ASSET_CATEGORY_LABELS[asset.category]}
							</span>
							<span class="text-xs text-muted-foreground">
								{formatMoney(asset.current_value)} now · {formatMoney(asset.purchase_price)} paid
								{#if asset.purchase_date}
									· bought {asset.purchase_date}
								{/if}
							</span>
							<span class="text-xs text-muted-foreground">
								{formatSignedMoney(gainLoss)} gain/loss
								{#if cagr !== null}
									· {cagr}% CAGR
								{/if}
								· {formatSignedMoney(netPosition)} net of holding costs
								{#if !asset.include_in_net_worth}
									(excluded from net worth)
								{/if}
							</span>
						</div>
						<div class="flex items-center gap-2">
							<label class="flex items-center gap-1.5 text-sm text-muted-foreground">
								<input
									type="checkbox"
									checked={asset.include_in_net_worth}
									onchange={() => toggleIncludeInNetWorth(asset.id)}
								/>
								Include in net worth
							</label>
							<Button variant="outline" size="sm" type="button" onclick={() => startEdit(asset)}>
								Edit
							</Button>
							<Button variant="ghost" size="sm" type="button" onclick={() => removeAsset(asset.id)}>
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
				<label class="text-sm font-medium" for="asset-name">Asset name</label>
				<input
					id="asset-name"
					type="text"
					bind:value={name}
					placeholder="e.g. Rolex Submariner"
					class="border border-input rounded-md px-2 py-1.5 text-sm"
					required
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="asset-category">Category</label>
				<select
					id="asset-category"
					bind:value={category}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				>
					{#each ASSET_CATEGORIES as c (c)}
						<option value={c}>{ASSET_CATEGORY_LABELS[c]}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="asset-purchase-price">Purchase price (£)</label>
				<input
					id="asset-purchase-price"
					type="number"
					min="0"
					step="0.01"
					bind:value={purchasePrice}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="asset-current-value">Current value (£)</label>
				<input
					id="asset-current-value"
					type="number"
					min="0"
					step="0.01"
					bind:value={currentValue}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="asset-purchase-date">Purchase date</label>
				<input
					id="asset-purchase-date"
					type="date"
					bind:value={purchaseDate}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="asset-expected-growth">
					Expected annual change (%)
				</label>
				<input
					id="asset-expected-growth"
					type="number"
					min="-100"
					max="100"
					step="0.1"
					bind:value={expectedGrowth}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="asset-holding-cost">
					Annual holding cost (£)
				</label>
				<input
					id="asset-holding-cost"
					type="number"
					min="0"
					step="0.01"
					bind:value={holdingCost}
					placeholder="0"
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>

			<Button type="submit" size="sm">{editingId === null ? 'Add asset' : 'Save changes'}</Button>
			{#if editingId !== null}
				<Button variant="ghost" size="sm" type="button" onclick={resetForm}>Cancel</Button>
			{/if}
		</form>
	</Card>

	{#if assets.length > 0}
		<Card className="p-4">
			<h2 class="text-lg font-semibold mb-1">Future value projection</h2>
			<p class="text-sm text-muted-foreground mb-3">
				Every recorded asset compounding at its own expected annual change, holding costs
				accumulating alongside it. Illustrative only, not financial advice.
			</p>

			<div class="flex flex-col gap-1 mb-4 max-w-xs">
				<span id="asset-projection-years-label" class="text-sm font-medium">
					Projection horizon (years)
				</span>
				<div class="flex items-center gap-2">
					<input
						type="range"
						aria-labelledby="asset-projection-years-label"
						min={PROJECTION_YEARS_MIN}
						max={PROJECTION_YEARS_MAX}
						step="1"
						bind:value={projectionYears}
						class="w-40 accent-black"
					/>
					<input
						id="asset-projection-years"
						type="number"
						aria-labelledby="asset-projection-years-label"
						min={PROJECTION_YEARS_MIN}
						max={PROJECTION_YEARS_MAX}
						step="1"
						bind:value={projectionYears}
						class="border border-input rounded-md px-2 py-1.5 text-sm w-20"
					/>
				</div>
			</div>

			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-2 font-medium">Year</th>
						<th class="py-2 px-2 font-medium text-right">Projected value</th>
						<th class="py-2 px-2 font-medium text-right">Holding costs to date</th>
						<th class="py-2 pl-2 font-medium text-right">Net of holding costs</th>
					</tr>
				</thead>
				<tbody>
					{#each projectionRows as row (row.offset)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-2 tabular-nums">{row.offset}</td>
							<td class="py-2 px-2 text-right tabular-nums font-medium">
								{formatMoney(row.totalValue)}
							</td>
							<td class="py-2 px-2 text-right tabular-nums">{formatMoney(row.totalHoldingCost)}</td>
							<td class="py-2 pl-2 text-right tabular-nums">{formatMoney(row.netValue)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Card>
	{/if}
</div>
