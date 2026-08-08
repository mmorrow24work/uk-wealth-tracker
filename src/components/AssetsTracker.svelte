<script>
	/**
	 * Physical asset tracking — README.md → "Physical Assets Tracker": "Categories: Watches &
	 * Jewellery, Art & Collectables, Classic/Collector Cars, Wine & Whisky, Precious Metals, Other",
	 * "Fields: name, purchase price, current value, purchase date, expected annual change %, annual
	 * holding cost", "Gain/loss vs purchase price, annualised CAGR, net position after holding
	 * costs", "Future value projection chart" and "Toggle: include/exclude from net worth" (issue
	 * #39, its full scope in one pass — unlike the property tab, which split types+fields from the
	 * projection chart across #36/#37/#38).
	 *
	 * Structured the same way `PropertyTracker.svelte`/`DividendTracker.svelte`/`PensionTracker.svelte`
	 * handle their own flat lists: `assets[]` sits directly on `AppData` (`$lib/model.js`'s own
	 * `Asset` typedef, added in #43), one list the user adds to, edits and removes from — a physical
	 * asset is a point-in-time fact, not a monthly snapshot line.
	 *
	 * `include_in_net_worth` is a row-level instant toggle, not a form field — the same pattern
	 * `PropertyTracker`/`DebtTracker` use, rather than routing a boolean through the add/edit form
	 * and an extra "Save changes" click.
	 *
	 * `$lib/assets.js` owns the maths (`assetGainLoss`, `assetCagr`, `assetNetPosition`,
	 * `assetPortfolioSummary`, `assetValueProjection`); this component only reads it. CAGR only
	 * renders when it can be computed (a purchase date that has actually happened, against a positive
	 * purchase price) — the same "don't show a computed line for data that isn't there" rule
	 * `PropertyTracker` applies to its own cashflow/yield line.
	 *
	 * The future value projection chart, `AssetValueProjectionChart.svelte`, is chosen from a select
	 * beneath the list — one chart rather than one per asset, `PropertyTracker`'s own reasoning for
	 * its equity chart: a shelf of thirty watches would mean thirty charts on screen for one that is
	 * ever being looked at.
	 *
	 * `now` is a prop, not read from the clock inside this component, purely so a server-rendered test
	 * can assert a specific CAGR/holding-cost figure without the answer changing depending on what day
	 * the test happens to run — `$lib/assets.js`'s own functions take the same parameter for the same
	 * reason.
	 *
	 * No activity log: `$lib/enums.js`'s `ACTIVITY_LOG_ENTITY_TYPES` covers `investment`/`debt` only
	 * (issue #14's own scope), and physical assets were never in it — same as pensions, dividends and
	 * properties.
	 */
	import { ASSET_CATEGORIES, ASSET_CATEGORY_LABELS } from '$lib/enums.js';
	import { createAsset } from '$lib/model.js';
	import {
		assetCagr,
		assetGainLoss,
		assetNetPosition,
		assetPortfolioSummary
	} from '$lib/assets.js';
	import Card from './ui/card.svelte';
	import Button from './ui/button.svelte';
	import AssetValueProjectionChart from './AssetValueProjectionChart.svelte';

	/**
	 * @type {{ assets?: import('$lib/types.js').Asset[], now?: Date }}
	 */
	let { assets = $bindable([]), now = new Date() } = $props();

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
		return amount >= 0 ? `+${formatMoney(amount)}` : `−${formatMoney(Math.abs(amount))}`;
	}

	const summary = $derived(assetPortfolioSummary(assets));

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

	/** @type {string | null} */
	let chartAssetId = $state(null);

	// Keeps the select's bound value pointed at a real asset: defaults to the first one once any
	// exist, and re-points itself if the one it was showing gets removed — `PropertyTracker`'s own
	// pattern for its equity chart picker.
	$effect(() => {
		if (assets.length === 0) {
			chartAssetId = null;
			return;
		}
		if (!assets.some((a) => a.id === chartAssetId)) {
			chartAssetId = assets[0].id;
		}
	});

	const chartAsset = $derived(assets.find((a) => a.id === chartAssetId) ?? assets[0] ?? null);
</script>

<div class="flex flex-col gap-6">
	<Card className="p-4">
		<h2 class="text-lg font-semibold mb-3">Physical Assets</h2>

		{#if assets.length === 0}
			<p class="text-sm text-muted-foreground mb-4">
				No physical assets recorded yet. Add one below.
			</p>
		{:else}
			<p class="text-sm text-muted-foreground mb-3">
				{assets.length} asset{assets.length === 1 ? '' : 's'} recorded, totalling {formatMoney(
					summary.totalCurrentValue
				)} current value against {formatMoney(summary.totalPurchasePrice)} paid — {formatSignedMoney(
					summary.totalGainLoss
				)} overall.
				{#if summary.excludedFromNetWorth.count > 0}
					{formatMoney(summary.includedInNetWorth.currentValue)} of that counts towards net worth ({summary
						.excludedFromNetWorth.count} asset{summary.excludedFromNetWorth.count === 1 ? '' : 's'} excluded).
				{/if}
			</p>

			<ul class="flex flex-col gap-2 mb-4 list-none p-0 m-0">
				{#each assets as asset (asset.id)}
					{@const gainLoss = assetGainLoss(asset)}
					{@const cagr = assetCagr(asset, now)}
					{@const netPosition = assetNetPosition(asset, now)}
					<li
						class="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
					>
						<div class="flex flex-col">
							<span class="font-medium">{asset.name}</span>
							<span class="text-sm text-muted-foreground">
								{ASSET_CATEGORY_LABELS[asset.category]}
							</span>
							<span class="text-xs text-muted-foreground">
								{formatMoney(asset.current_value)} current value · {formatMoney(
									asset.purchase_price
								)} paid
								{#if asset.purchase_date}
									· bought {asset.purchase_date}
								{/if}
								{#if asset.holding_cost > 0}
									· {formatMoney(asset.holding_cost)}/yr holding cost
								{/if}
							</span>
							<span class="text-xs text-muted-foreground">
								{formatSignedMoney(gainLoss)} gain/loss
								{#if cagr !== null}
									· {cagr >= 0 ? '+' : ''}{cagr}% annualised (CAGR)
								{/if}
								· {formatSignedMoney(netPosition)} net position after holding costs
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

	{#if assets.length > 0 && chartAsset}
		<Card className="p-4">
			<div class="flex flex-wrap items-center gap-2 mb-3">
				<label class="text-sm font-medium" for="asset-chart-select">
					Future value projection for
				</label>
				<select
					id="asset-chart-select"
					bind:value={chartAssetId}
					class="border border-input rounded-md px-2 py-1.5 text-sm"
				>
					{#each assets as asset (asset.id)}
						<option value={asset.id}>{asset.name || 'Unnamed asset'}</option>
					{/each}
				</select>
			</div>
			<AssetValueProjectionChart asset={chartAsset} />
		</Card>
	{/if}
</div>
