/**
 * Physical asset gain/loss + CAGR + net position after holding costs + future value projection —
 * README.md → "Physical Assets Tracker": "Gain/loss vs purchase price, annualised CAGR, net
 * position after holding costs" and "Future value projection chart" (issue #39).
 *
 * `$lib/model.js` already owns the `Asset` record (added in #43 for this issue): `purchase_price`,
 * `current_value`, `purchase_date`, `expected_growth`, `holding_cost` and `include_in_net_worth`.
 * This module is the read-only maths over those fields, the same split `property.js` draws between
 * "the record" and "what it's worth" — five things it answers:
 *
 * 1. **What has it made or lost against what was paid?** {@link assetGainLoss} —
 *    `current_value - purchase_price`, README's own definition, verbatim.
 * 2. **What has that worked out to per year?** {@link assetCagr} — the annualised return implied by
 *    `purchase_price` growing to `current_value` over the time since `purchase_date`. `null` when
 *    it cannot be computed (no purchase date, a future purchase date, or a zero/negative purchase
 *    price to divide by) rather than `0` or `Infinity` — the same "nothing to divide by" convention
 *    `property.js`'s {@link import('./property.js').propertyGrossYield} uses.
 * 3. **What has it actually cost to hold, so far?** {@link assetHoldingCostToDate} —
 *    `holding_cost` (£/yr) times the years owned to date, `0` with no purchase date on record
 *    (nothing to accrue against).
 * 4. **So what's the real position, after those costs?** {@link assetNetPosition} — gain/loss minus
 *    the holding costs paid to date. README calls this "net position after holding costs"; a watch
 *    up £2,000 that has cost £3,000 in insurance and servicing over the same years is down overall,
 *    and this is the one figure that says so.
 * 5. **What might it be worth going forward?** {@link assetValueProjection} — `current_value`
 *    compounding annually at `expected_growth` (which, unlike a property's `growth_rate`, may
 *    legitimately be negative — classic cars appreciate, most everything else depreciates), alongside
 *    a running "if the holding cost keeps being paid" net line. No monthly step is needed here the
 *    way `property.js`'s mortgage amortisation forces one — a physical asset carries no debt to
 *    schedule against, so straight annual compounding is both simpler and exactly as accurate.
 *
 * Every figure here is a snapshot of today's recorded fields, using `now` (defaults to the real
 * clock, overridable so a caller or test gets a repeatable answer — the same convention
 * `property.js`'s `dealExpiryStatus` uses) only to work out how long the asset has been owned. It
 * does not track what happened in between, the same "no interpolation" restraint `net-worth.js`
 * documents for its own tracked line.
 *
 * Everything here is pure — assets go in, numbers come out, nothing is mutated.
 */

/*
 * As elsewhere in `$lib`: types are referenced inline as `import('./types.js').X` rather than
 * re-declared as local `@typedef`s, because `index.js` re-exports every module with `export *` and
 * svelte-check reads two same-named top-level typedefs across re-exported modules as an ambiguous
 * export.
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

/** Average days in a year, leap years included — the same span a "years owned" figure needs. */
const DAYS_PER_YEAR = 365.25;

/**
 * Years between `purchase_date` and `now`, both read as UTC midnight (the same convention
 * `property.js`'s `dealExpiryStatus` uses, for the same reason: comparing local midnights would
 * shift the boundary by the reader's UTC offset). `null` for a missing/invalid date, or one that
 * has not happened yet — this is "years owned", and an asset cannot yet be owned as of a future
 * date.
 *
 * @param {string | null | undefined} purchaseDate ISO `YYYY-MM-DD`, or `null`/`undefined`.
 * @param {Date} now
 * @returns {number | null}
 */
function yearsOwned(purchaseDate, now) {
	if (typeof purchaseDate !== 'string' || purchaseDate === '') return null;

	const purchased = new Date(`${purchaseDate}T00:00:00.000Z`);
	if (Number.isNaN(purchased.getTime())) return null;

	const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	const days = (today - purchased.getTime()) / 86_400_000;
	if (days < 0) return null;

	return days / DAYS_PER_YEAR;
}

/* -------------------------------------------------------------------------- */
/* One asset, today                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Gain or loss against what was paid. Can be negative — a depreciating asset losing value is a
 * real, if unhappy, state, not an input error.
 *
 * @param {Partial<import('./types.js').Asset> | null} [asset]
 * @returns {number} (£)
 */
export function assetGainLoss(asset) {
	const currentValue = asMoney(asset?.current_value);
	const purchasePrice = asMoney(asset?.purchase_price);
	return roundMoney(currentValue - purchasePrice);
}

/**
 * Annualised compound growth rate from `purchase_price` to `current_value` over the years since
 * `purchase_date`. `null` when it cannot be computed: no purchase date on record, a purchase date
 * that has not happened yet, or a zero/negative purchase price (nothing to compute a ratio against
 * — the module doc's "nothing to divide by" case). A `current_value` of `0` is a valid input and
 * yields `-100%`, a total loss, not a guarded-against case.
 *
 * @param {Partial<import('./types.js').Asset> | null} [asset]
 * @param {Date} [now] Defaults to the real clock; pass a fixed `Date` for a repeatable answer.
 * @returns {number | null} (%)
 */
export function assetCagr(asset, now = new Date()) {
	const purchasePrice = asMoney(asset?.purchase_price);
	if (purchasePrice <= 0) return null;

	const years = yearsOwned(asset?.purchase_date, now);
	if (years === null || years <= 0) return null;

	const currentValue = Math.max(0, asMoney(asset?.current_value));
	const ratio = currentValue / purchasePrice;
	return roundPercent((Math.pow(ratio, 1 / years) - 1) * 100);
}

/**
 * Total holding cost paid to date: `holding_cost` (£/yr) times the years owned. `0` with no
 * purchase date on record — there is no elapsed time to accrue a cost against.
 *
 * @param {Partial<import('./types.js').Asset> | null} [asset]
 * @param {Date} [now]
 * @returns {number} (£)
 */
export function assetHoldingCostToDate(asset, now = new Date()) {
	const years = yearsOwned(asset?.purchase_date, now) ?? 0;
	return roundMoney(asMoney(asset?.holding_cost) * years);
}

/**
 * README's "net position after holding costs": {@link assetGainLoss} minus
 * {@link assetHoldingCostToDate}. Can be negative even when the asset itself is up in value, if
 * what it has cost to hold outweighs the gain.
 *
 * @param {Partial<import('./types.js').Asset> | null} [asset]
 * @param {Date} [now]
 * @returns {number} (£)
 */
export function assetNetPosition(asset, now = new Date()) {
	return roundMoney(assetGainLoss(asset) - assetHoldingCostToDate(asset, now));
}

/* -------------------------------------------------------------------------- */
/* The whole collection                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One slice of the collection — how many assets, and their combined purchase/current value.
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
 * @typedef {object} AssetCollectionSummary
 * @property {number} count
 * @property {number} totalPurchasePrice (£)
 * @property {number} totalCurrentValue (£)
 * @property {number} totalGainLoss (£) — every asset, regardless of the toggle.
 * @property {AssetSlice} includedInNetWorth Assets whose current value counts towards net worth.
 * @property {AssetSlice} excludedFromNetWorth Assets whose current value does not.
 */

/**
 * @param {readonly Partial<import('./types.js').Asset>[]} [assets]
 * @returns {AssetCollectionSummary}
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

/**
 * Default projection horizon. Unlike `property.js`'s `PROPERTY_PROJECTION_YEARS` (README states
 * "30-year" explicitly), README gives no number for the asset projection chart — this is a starting
 * point the tracker's chart picker can be read against, not a spec figure, chosen as long enough to
 * show a trend on a slow-moving collectable without projecting so far out the number stops meaning
 * anything.
 */
export const ASSET_PROJECTION_YEARS = 20;

/** Longest horizon this will project — `property.js`'s own guard against an unbounded input. */
const MAX_PROJECTION_YEARS = 100;

/** Growth rates are whole-number percents; `validateAppData` accepts -100…100, so match it. */
const MIN_RATE_PCT = -100;
const MAX_RATE_PCT = 100;

/** @param {number} value @returns {number} */
function clampRatePct(value) {
	return Math.min(MAX_RATE_PCT, Math.max(MIN_RATE_PCT, value));
}

/**
 * One year of an asset's projected value, holding cost paid since today, and the net of the two.
 *
 * @typedef {object} AssetValueProjectionPoint
 * @property {number} year Whole years from today. `0` is the asset as it stands today.
 * @property {number} value Projected current value (£), `current_value` compounding at
 *   `expected_growth`.
 * @property {number} cumulativeHoldingCost `holding_cost` × `year` — cost paid from today forward,
 *   not the cost already paid before today (that is {@link assetHoldingCostToDate}).
 * @property {number} netValue `value - cumulativeHoldingCost` (£).
 */

/**
 * Project one asset's value forward from today, one point per year — README's "Future value
 * projection chart". `expected_growth` compounds annually against `current_value` (may be negative,
 * for a depreciating asset); `cumulativeHoldingCost` accrues `holding_cost` for each year projected,
 * giving a `netValue` line alongside the raw value line — the forward-looking twin of
 * {@link assetNetPosition}'s backward-looking one.
 *
 * @param {Partial<import('./types.js').Asset> | null} [asset]
 * @param {number} [years] Horizon in whole years. Clamped to 0…{@link MAX_PROJECTION_YEARS}.
 * @returns {AssetValueProjectionPoint[]} `years + 1` points, oldest (today) first.
 */
export function assetValueProjection(asset, years = ASSET_PROJECTION_YEARS) {
	const horizonYears = Math.min(MAX_PROJECTION_YEARS, Math.max(0, Math.trunc(years) || 0));

	const growthRatePct = clampRatePct(asMoney(asset?.expected_growth));
	const growthRate = growthRatePct / 100;
	const holdingCost = asMoney(asset?.holding_cost);
	const startValue = asMoney(asset?.current_value);

	/** @type {AssetValueProjectionPoint[]} */
	const points = [
		{
			year: 0,
			value: roundMoney(startValue),
			cumulativeHoldingCost: 0,
			netValue: roundMoney(startValue)
		}
	];

	let value = startValue;
	for (let year = 1; year <= horizonYears; year += 1) {
		value *= 1 + growthRate;

		const roundedValue = roundMoney(value);
		const cumulativeHoldingCost = roundMoney(holdingCost * year);
		points.push({
			year,
			value: roundedValue,
			cumulativeHoldingCost,
			netValue: roundMoney(roundedValue - cumulativeHoldingCost)
		});
	}

	return points;
}
