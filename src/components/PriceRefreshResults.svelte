<script>
	/**
	 * Per-holding price refresh feedback panel — issue #295, split off from the "Update prices"
	 * button and its fetch/store-write logic (#300) because this presentational half is the only
	 * part buildable before #298's `refreshInvestmentPrices` exists (see this issue's own body for
	 * why: the previous attempt at #295 burned its turn budget trying to build #298 first). This
	 * component deliberately has **no import of `$lib/price-feed.js`**, not even for a type, so it
	 * cannot be coupled to a module that hasn't landed yet on the milestone's dependency order. The
	 * `PriceRefreshResult` shape below is therefore a contract this component defines; #298 is
	 * specified to return it and #300 is specified to pass it straight through. If #298 lands with a
	 * genuinely different shape, whoever wires this in (#300) should update the typedef here to match
	 * and note the divergence, rather than this component inventing a third shape to reconcile.
	 *
	 * Three result states, read only after checking `status` — matches the issue's table exactly:
	 * - `'updated'` — a fresh price moved the holding's value; shows the before/after value and price.
	 * - `'baseline'` — the first-ever fetch for this holding, so there's no prior price to form a
	 *   ratio against and the value is deliberately left unchanged. Must not read as a refresh that
	 *   silently did nothing, and must not imply the value moved.
	 * - `'failed'` — carries no `value`/`price` at all, only a human-readable `message`. A failed
	 *   holding must never be presentable as freshly updated — that honesty requirement is the entire
	 *   reason #298 returns a per-holding result shape rather than a count, and this panel is where it
	 *   either holds or is broken, so each status branch below only ever reads the fields its own
	 *   table row lists.
	 *
	 * Precedent followed: `InvestmentGuidance.svelte` (#255), a standalone presentational component
	 * with server-rendered smoke tests (`svelte/server`'s `render`) and no consumer yet — mirrored
	 * here in `PriceRefreshResults.test.js` since #300 (not this issue) wires this into
	 * `InvestmentHoldings.svelte`.
	 */
	import Card from './ui/card.svelte';

	/**
	 * @typedef {object} PriceRefreshUpdated
	 * @property {'updated'} status
	 * @property {string} investmentId
	 * @property {string} ticker
	 * @property {number} previousValue
	 * @property {number} value
	 * @property {number} previousPrice
	 * @property {number} price
	 */

	/**
	 * @typedef {object} PriceRefreshBaseline
	 * @property {'baseline'} status
	 * @property {string} investmentId
	 * @property {string} ticker
	 * @property {number} price
	 */

	/**
	 * @typedef {object} PriceRefreshFailed
	 * @property {'failed'} status
	 * @property {string} investmentId
	 * @property {string} ticker
	 * @property {string} reason
	 * @property {string} message
	 */

	/**
	 * @typedef {PriceRefreshUpdated | PriceRefreshBaseline | PriceRefreshFailed} PriceRefreshResult
	 */

	/**
	 * @type {{
	 * 	results?: PriceRefreshResult[],
	 * 	holdingNames?: Record<string, string>
	 * }}
	 */
	let { results = [], holdingNames = {} } = $props();

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 2
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** A holding's per-share/unit price has no known currency/unit (see `$lib/price-feed.js`'s own
	 * header comment), so unlike {@link formatMoney} this is a plain number, not a currency string.
	 * @param {number} price */
	function formatPrice(price) {
		return price.toLocaleString('en-GB', { maximumFractionDigits: 4 });
	}

	/** Names a holding the way the form above this panel does; falls back to the ticker when
	 * `holdingNames` has nothing for this holding's id, per the issue's own instruction.
	 * @param {PriceRefreshResult} result
	 * @returns {string} */
	function holdingLabel(result) {
		return holdingNames[result.investmentId] ?? result.ticker;
	}

	/** @param {PriceRefreshUpdated} result */
	function valueChange(result) {
		return result.value - result.previousValue;
	}

	const updatedCount = $derived(results.filter((result) => result.status === 'updated').length);
	const baselineCount = $derived(results.filter((result) => result.status === 'baseline').length);
	const failedCount = $derived(results.filter((result) => result.status === 'failed').length);

	const summary = $derived(
		[
			updatedCount > 0 ? `${updatedCount} updated` : null,
			baselineCount > 0 ? `${baselineCount} baseline` : null,
			failedCount > 0 ? `${failedCount} couldn't be fetched` : null
		]
			.filter((part) => part !== null)
			.join(', ')
	);
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Price refresh results</h2>

	{#if results.length === 0}
		<p class="text-sm text-muted-foreground">
			No results yet — a price refresh only covers holdings with a ticker symbol recorded, and
			results appear here once one has been run.
		</p>
	{:else}
		<p class="text-sm text-muted-foreground mb-3">{summary}.</p>

		<ul class="flex flex-col gap-2 list-none p-0 m-0">
			{#each results as result (result.investmentId)}
				<li class="border border-border rounded-md px-3 py-2">
					{#if result.status === 'updated'}
						{@const change = valueChange(result)}
						<div class="flex items-center justify-between gap-3">
							<span class="font-medium">{holdingLabel(result)}</span>
							<span
								class="text-sm {change > 0
									? 'text-green-700'
									: change < 0
										? 'text-red-600'
										: 'text-muted-foreground'}"
							>
								{formatMoney(result.previousValue)} → {formatMoney(result.value)}
								({change === 0
									? 'no change'
									: change > 0
										? `+${formatMoney(change)}`
										: formatMoney(change)})
							</span>
						</div>
						<p class="text-xs text-muted-foreground mt-1">
							{result.ticker}: {formatPrice(result.previousPrice)} → {formatPrice(result.price)}
						</p>
					{:else if result.status === 'baseline'}
						<div class="flex items-center justify-between gap-3">
							<span class="font-medium">{holdingLabel(result)}</span>
							<span class="text-sm text-muted-foreground">Price recorded, value unchanged</span>
						</div>
						<p class="text-xs text-muted-foreground mt-1">
							{result.ticker}: first price on record is {formatPrice(result.price)}. There's no
							earlier price yet to compare it against, so this holding's value hasn't been changed.
						</p>
					{:else}
						<div class="flex items-center justify-between gap-3">
							<span class="font-medium">{holdingLabel(result)}</span>
							<span class="text-sm text-red-600">Couldn't fetch a price</span>
						</div>
						<p class="text-xs text-red-600 mt-1">{result.message}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Card>
