/**
 * Physical asset gain/loss, CAGR, net position and future value projection — README.md →
 * "Physical Assets Tracker": "Gain/loss vs purchase price, annualised CAGR, net position after
 * holding costs" and "Future value projection chart" (issue #39's exact scope, following on from
 * the `Asset` record and `ASSET_CATEGORIES` enum the scaffold build (#2) already put in place).
 *
 * `$lib/model.js` already owns the `Asset` record and every field this module reads —
 * `purchase_price`, `current_value`, `purchase_date`, `expected_growth`, `holding_cost` and
 * `include_in_net_worth` were all part of #2's data model outline, unused until this issue. Four
 * things this module answers:
 *
 * 1. **What has one asset made or lost against what was paid for it?** {@link assetGainLoss} —
 *    `current_value - purchase_price`, README.md's own definition, verbatim. Can be negative, the
 *    ordinary state for a depreciating asset (a classic car bought new, most "Other" categories).
 * 2. **What annual rate of return does that represent?** {@link assetCAGR} — the compound annual
 *    growth rate implied by `purchase_price`, `current_value` and the time between `purchase_date`
 *    and now. `null` whenever there is not enough to annualise from — no `purchase_date` recorded,
 *    a `purchase_date` that has not yet arrived, or a zero `purchase_price` (nothing to compound
 *    from). This mirrors `property.js`'s `propertyGrossYield` convention: `null` for "the question
 *    does not have an answer", never `Infinity` or a silently wrong `0`.
 * 3. **What has it actually made once the cost of owning it is counted?**
 *    {@link assetHoldingCostToDate} multiplies the recorded annual `holding_cost` by the years held
 *    (0 with no `purchase_date` on file, since there is then no known holding period to charge
 *    against), and {@link assetNetPosition} is {@link assetGainLoss} minus that — README.md's "net
 *    position after holding costs".
 * 4. **What might it be worth later?** {@link assetFutureValue} compounds `current_value` forward
 *    at the asset's own `expected_growth`, with no holding cost netted off (a point-in-time value,
 *    the same shape `propertyEquity` and every other "what is this worth" figure in this app take);
 *    {@link assetPortfolioProjection} does the same per-asset and sums the whole `assets[]` list
 *    year by year, alongside the accumulating holding-cost drag, for the tracker's "Future value
 *    projection chart" — rendered as a sampled table, the same convention
 *    `DividendIncomePlanner.svelte`'s own header records for every forecast-style panel in this app
 *    that is not the flagship `NetWorthChart` itself (`CompoundingPanel`, `StressTestPanel`,
 *    `FireCalculator`'s own projection tables).
 *
 * {@link assetPortfolioSummary} rolls a plain `assets[]` list into today's totals, split by
 * `include_in_net_worth` — `property.js`'s `propertyPortfolioSummary`'s own shape, not its
 * content: a physical asset the user has chosen to leave out (a family heirloom nobody would
 * actually sell, say) doesn't inflate the headline figure.
 *
 * As `property.js`'s own header notes for its BTL cashflow/yield figures: nothing here feeds
 * `net-worth.js`'s tracked net worth series. No issue in the tracked backlog wires property or
 * asset equity into that dashboard-wide total; `include_in_net_worth` governs this tab's own card
 * totals today, same as the property tab's toggle.
 *
 * Everything here is pure: assets go in, numbers come out, nothing is mutated.
 */

/*
 * As elsewhere in `$lib`: types are referenced inline as `import('./types.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *`
 * and svelte-check reads two same-named top-level typedefs across re-exported modules as an
 * ambiguous export.
 */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/** @param {number} value @returns {number} `value` rounded to 2 decimal places, without `-0`. */
function roundPercent(value) {
	return Math.round(value * 100) / 100 + 0;
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function asMoney(value, fallback = 0) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Average days in a year, leap years included — the same constant a mortgage-term or age
 *  calculation would use where a calendar-exact day count is not the point. */
const DAYS_PER_YEAR = 365.25;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Years between `purchase_date` and `referenceDate` — the base {@link assetCAGR} and
 * {@link assetHoldingCostToDate} both annualise against. `null` when there is no `purchase_date`
 * to measure from, or when it has not happened yet (a future-dated purchase, which
 * `validateAppData` allows but which has no "years held" answer).
 *
 * @param {Partial<import('./types.js').Asset> | null} [asset]
 * @param {Date} [referenceDate]
 * @returns {number | null}
 */
export function assetHoldingYears(asset, referenceDate = new Date()) {
	const purchaseDate = asset?.purchase_date;
	if (typeof purchaseDate !== 'string' || purchaseDate === '') return null;

	const parsed = new Date(`${purchaseDate}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return null;

	const days = (referenceDate.getTime() - parsed.getTime()) / MS_PER_DAY;
	if (days <= 0) return null;

	return days / DAYS_PER_YEAR;
}

/* -------------------------------------------------------------------------- */
/* One asset                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Gain/loss against what was paid — README.md's own definition, verbatim. Can be negative, the
 * ordinary state for a depreciating asset, not an input error.
 *
 * @param {Partial<import('./types.js').Asset> | null} [asset]
 * @returns {number} (£)
 */
export function assetGainLoss(asset) {
	const purchasePrice = asMoney(asset?.purchase_price);
	const currentValue = asMoney(asset?.current_value);
	return roundMoney(currentValue - purchasePrice);
}

/**
 * Annualised CAGR from `purchase_price` to `current_value` over {@link assetHoldingYears}.
 * `null` whenever there is nothing to annualise: no usable `purchase_date`
 * ({@link assetHoldingYears} already returns `null` for that), or a zero/negative
 * `purchase_price` — nothing to compound from, the same "nothing to divide by" convention
 * {@link import('./property.js').propertyGrossYield} uses.
 *
 * @param {Partial<import('./types.js').Asset> | null} [asset]
 * @param {Date} [referenceDate]
 * @returns {number | null} (%)
 */
export function assetCAGR(asset, referenceDate = new Date()) {
	const years = assetHoldingYears(asset, referenceDate);
	if (years === null) return null;

	const purchasePrice = asMoney(asset?.purchase_price);
	if (purchasePrice <= 0) return null;

	const currentValue = asMoney(asset?.current_value);
	return roundPercent((Math.pow(currentValue / purchasePrice, 1 / years) - 1) * 100);
}

/**
 * Total holding cost charged against the asset so far — the recorded annual `holding_cost` times
 * {@link assetHoldingYears}, `0` when there is no known holding period (no `purchase_date`)
 * rather than assuming one.
 *
 * @param {Partial<import('./types.js').Asset> | null} [asset]
 * @param {Date} [referenceDate]
 * @returns {number} (£)
 */
export function assetHoldingCostToDate(asset, referenceDate = new Date()) {
	const years = assetHoldingYears(asset, referenceDate);
	if (years === null) return 0;

	return roundMoney(asMoney(asset?.holding_cost) * years);
}

/**
 * README.md's "net position after holding costs" — {@link assetGainLoss} minus
 * {@link assetHoldingCostToDate}. Can be negative on either count: a loss on the asset itself, or
 * a gain more than eaten up by years of insurance/storage/servicing.
 *
 * @param {Partial<import('./types.js').Asset> | null} [asset]
 * @param {Date} [referenceDate]
 * @returns {number} (£)
 */
export function assetNetPosition(asset, referenceDate = new Date()) {
	return roundMoney(assetGainLoss(asset) - assetHoldingCostToDate(asset, referenceDate));
}

/**
 * `current_value` compounded forward `years` at the asset's own `expected_growth` — a point-in-time
 * future value, no holding cost netted off (see module doc). `expected_growth` may be negative,
 * for a depreciating asset the user expects to keep losing value.
 *
 * @param {Partial<import('./types.js').Asset> | null} asset
 * @param {number} years
 * @returns {number} (£)
 */
export function assetFutureValue(asset, years) {
	const currentValue = asMoney(asset?.current_value);
	const growthRate = asMoney(asset?.expected_growth);
	const horizon = Number.isFinite(years) && years > 0 ? years : 0;

	return roundMoney(currentValue * Math.pow(1 + growthRate / 100, horizon));
}

/* -------------------------------------------------------------------------- */
/* The whole portfolio                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One slice of the portfolio — how many assets, and their combined purchase price/current
 * value/gain-loss.
 *
 * @typedef {object} AssetSlice
 * @property {number} count
 * @property {number} purchasePrice (£)
 * @property {number} currentValue (£)
 * @property {number} gainLoss (£)
 */

/**
 * @param {readonly import('./types.js').Asset[]} assets
 * @returns {AssetSlice}
 */
function slice(assets) {
	return {
		count: assets.length,
		purchasePrice: roundMoney(assets.reduce((total, a) => total + asMoney(a.purchase_price), 0)),
		currentValue: roundMoney(assets.reduce((total, a) => total + asMoney(a.current_value), 0)),
		gainLoss: roundMoney(assets.reduce((total, a) => total + assetGainLoss(a), 0))
	};
}

/**
 * The whole `assets[]` list, today, split by the net worth toggle.
 *
 * @typedef {object} AssetPortfolioSummary
 * @property {number} count
 * @property {number} totalPurchasePrice (£)
 * @property {number} totalCurrentValue (£)
 * @property {number} totalGainLoss (£) — every asset, regardless of the toggle.
 * @property {AssetSlice} includedInNetWorth Assets whose value counts towards net worth.
 * @property {AssetSlice} excludedFromNetWorth Assets whose value does not.
 */

/**
 * @param {readonly Partial<import('./types.js').Asset>[]} [assets]
 * @returns {AssetPortfolioSummary}
 */
export function assetPortfolioSummary(assets) {
	const list = /** @type {import('./types.js').Asset[]} */ (Array.isArray(assets) ? assets : []);

	return {
		count: list.length,
		totalPurchasePrice: roundMoney(list.reduce((total, a) => total + asMoney(a.purchase_price), 0)),
		totalCurrentValue: roundMoney(list.reduce((total, a) => total + asMoney(a.current_value), 0)),
		totalGainLoss: roundMoney(list.reduce((total, a) => total + assetGainLoss(a), 0)),
		includedInNetWorth: slice(list.filter((a) => a.include_in_net_worth !== false)),
		excludedFromNetWorth: slice(list.filter((a) => a.include_in_net_worth === false))
	};
}

/* -------------------------------------------------------------------------- */
/* Future value projection                                                    */
/* -------------------------------------------------------------------------- */

/** Longest projection this module will walk — 50 years, generous enough never to bite for a
 *  physical asset held across a lifetime, without the open-ended horizon a net worth forecast needs. */
export const ASSET_MAX_PROJECTION_YEARS = 50;

/**
 * One year of a portfolio-level future value projection.
 *
 * @typedef {object} AssetProjectionPoint
 * @property {number} offset Whole years from now. `0` is today.
 * @property {number} totalValue Sum of every asset's own {@link assetFutureValue} at this offset (£).
 * @property {number} totalHoldingCost Cumulative holding cost from now to this offset, every asset's
 *   own annual `holding_cost` times `offset` (£).
 * @property {number} netValue `totalValue - totalHoldingCost` (£).
 */

/**
 * Walks the whole `assets[]` list forward year by year, each asset compounding at its own
 * `expected_growth` — README.md's "Future value projection chart", one point per year from today
 * to `years` out. Every asset in the list is projected regardless of `include_in_net_worth` (the
 * same "don't gate on the toggle" choice {@link assetGainLoss} and `property.js`'s cashflow figures
 * make); a caller wanting the included-only projection filters the list first, the same way a
 * caller of `dividendIncomePlan` would pre-filter its own `dividends[]`.
 *
 * @param {readonly Partial<import('./types.js').Asset>[]} [assets]
 * @param {{ years?: number }} [options]
 * @returns {{ years: number, points: AssetProjectionPoint[] }}
 */
export function assetPortfolioProjection(assets, options = {}) {
	const list = /** @type {import('./types.js').Asset[]} */ (Array.isArray(assets) ? assets : []);
	const horizon = Math.min(
		ASSET_MAX_PROJECTION_YEARS,
		Math.max(0, Math.trunc(asMoney(options.years, 0)))
	);

	const annualHoldingCost = roundMoney(
		list.reduce((total, a) => total + asMoney(a.holding_cost), 0)
	);

	/** @type {AssetProjectionPoint[]} */
	const points = [];
	for (let offset = 0; offset <= horizon; offset += 1) {
		points.push({
			offset,
			totalValue: roundMoney(list.reduce((total, a) => total + assetFutureValue(a, offset), 0)),
			totalHoldingCost: roundMoney(annualHoldingCost * offset),
			netValue: 0
		});
	}

	for (const point of points) {
		point.netValue = roundMoney(point.totalValue - point.totalHoldingCost);
	}

	return { years: horizon, points };
}
