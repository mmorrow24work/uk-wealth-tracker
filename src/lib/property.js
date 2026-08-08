/**
 * Property equity + buy-to-let cashflow + deal expiry reminder + equity growth projection —
 * README.md → "Property Tracker": "Equity calculation: value minus mortgage", "BTL: rental
 * income, running costs, net monthly cashflow, gross yield" and "Property equity toggle:
 * include/exclude from net worth" (issue #37), plus "Mortgage deal expiry reminder (amber 90
 * days, red if expired)" and "Equity growth projection chart (30-year)" (issue #38).
 *
 * `$lib/model.js` already owns the `Property` record and every field this module reads —
 * `rental_income`, `running_costs` and `include_in_net_worth` were added to the data model in #36
 * for #37, and `deal_expiry`/`growth_rate` for this issue (see #36's journal entry, and #37's own
 * "every figure here is a snapshot… `growth_rate` exists on the record for issue #38's equity
 * growth projection, not for anything in this module"). Four things this module answers:
 *
 * 1. **What is one property worth today, net of its mortgage?** {@link propertyEquity} —
 *    `value - mortgage_balance`, README.md's own definition, verbatim.
 * 2. **What does a let property actually make, month to month?** {@link propertyCashflow} and
 *    {@link propertyGrossYield} — rent in, running costs and the mortgage payment out, plus the
 *    yield the rent alone represents against the property's value.
 * 3. **Is the mortgage deal about to run out?** {@link dealExpiryStatus} — amber inside 90 days of
 *    `deal_expiry`, red once it has passed, so a fixed/tracker deal that is about to roll onto a
 *    lender's SVR gets flagged before it happens rather than after.
 * 4. **What might this property's equity look like in 30 years?** {@link propertyEquityProjection}
 *    — `value` compounding at `growth_rate` against the mortgage amortising off `interest_rate` and
 *    `monthly_payment`, the same two fields `propertyEquity`/`propertyCashflow` already read, one
 *    point per year.
 *
 * {@link propertyPortfolioSummary} rolls a `properties[]` list into the totals the tracker's
 * card shows: total value/mortgage/equity, and the same split by `include_in_net_worth` — the
 * toggle above — so a property the user has chosen to leave out (typically because its mortgage
 * is separately tracked as an *included* debt, `debt.js`'s `defaultsToExcludedFromNetWorth`'s own
 * mirror image) doesn't inflate the headline figure.
 *
 * **Net cashflow includes the mortgage payment**, even though `Property.running_costs`'s own doc
 * comment calls it "the other half of net cashflow" alongside `rental_income` — which reads as a
 * two-term sum. A two-term cashflow would ignore the single largest monthly outgoing a mortgaged
 * buy-to-let has, which is exactly the number a landlord needs "net monthly cashflow" to mean.
 * `monthly_payment` already exists on the record for the equity side; folding it into cashflow
 * too is the standard buy-to-let definition (rent minus running costs minus mortgage payment),
 * and the only reading under which this figure can tell the user whether the property pays for
 * itself.
 *
 * **Gross yield stays gross** — annual rental income against value, nothing subtracted. That is
 * what "gross" means in the term README.md uses, and it is the ratio BTL investors actually quote
 * (comparing properties of different sizes); subtracting costs into it would leave it neither the
 * standard gross yield nor a net one with a name of its own.
 *
 * Cashflow and yield are computed for any property with rent recorded, not gated on `type` —
 * `rental_income`'s own doc comment says "Buy-to-let and holiday lets", but a primary residence
 * with a lodger is a real, if unusual, case this module has no reason to refuse to add up.
 *
 * `propertyEquity`/`propertyCashflow`/`propertyGrossYield`/`propertyPortfolioSummary` are a
 * snapshot of today's recorded fields — no projection; that is what `propertyEquityProjection`
 * is for, and it is the only function here that is not a snapshot.
 *
 * Everything here is pure — `dealExpiryStatus` takes "now" as an explicit argument rather than
 * reading the clock itself, so a caller (or a test) that wants a specific day gets a repeatable
 * answer instead of one that changes depending on when it runs. Properties go in, numbers come
 * out, nothing is mutated.
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

/* -------------------------------------------------------------------------- */
/* One property                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Equity: what the property is worth minus what is still owed on it. Can be negative — negative
 * equity is a real, if unhappy, state a property can be in, not an input error.
 *
 * @param {Partial<import('./types.js').Property> | null} [property]
 * @returns {number} (£)
 */
export function propertyEquity(property) {
	const value = asMoney(property?.value);
	const mortgageBalance = asMoney(property?.mortgage_balance);
	return roundMoney(value - mortgageBalance);
}

/**
 * Net monthly cashflow: rent in, running costs and the mortgage payment out — see the module doc
 * for why the mortgage payment is included. Can be negative, same as {@link propertyEquity}: a
 * BTL that costs more to hold than it earns is exactly the case this number exists to surface.
 *
 * @param {Partial<import('./types.js').Property> | null} [property]
 * @returns {number} (£/mo)
 */
export function propertyCashflow(property) {
	const rentalIncome = asMoney(property?.rental_income);
	const runningCosts = asMoney(property?.running_costs);
	const monthlyPayment = asMoney(property?.monthly_payment);
	return roundMoney(rentalIncome - runningCosts - monthlyPayment);
}

/**
 * Gross yield: annualised rental income as a percentage of the property's value — before any
 * costs are deducted (module doc). `null` on a zero or negative value, the same "nothing to
 * divide by" convention {@link import('./debt.js').debtToInvestmentRatio} uses, rather than
 * `Infinity` or `0`.
 *
 * @param {Partial<import('./types.js').Property> | null} [property]
 * @returns {number | null} (%)
 */
export function propertyGrossYield(property) {
	const value = asMoney(property?.value);
	if (value <= 0) return null;

	const annualRentalIncome = asMoney(property?.rental_income) * 12;
	return roundPercent((annualRentalIncome / value) * 100);
}

/* -------------------------------------------------------------------------- */
/* The whole portfolio                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One slice of the portfolio — how many properties, and their combined value/mortgage/equity.
 *
 * @typedef {object} PropertySlice
 * @property {number} count
 * @property {number} value (£)
 * @property {number} mortgageBalance (£)
 * @property {number} equity (£)
 */

/**
 * @param {readonly import('./types.js').Property[]} properties
 * @returns {PropertySlice}
 */
function slice(properties) {
	return {
		count: properties.length,
		value: roundMoney(properties.reduce((total, p) => total + asMoney(p.value), 0)),
		mortgageBalance: roundMoney(
			properties.reduce((total, p) => total + asMoney(p.mortgage_balance), 0)
		),
		equity: roundMoney(properties.reduce((total, p) => total + propertyEquity(p), 0))
	};
}

/**
 * The whole `properties[]` list, today, split by the net worth toggle.
 *
 * @typedef {object} PropertyPortfolioSummary
 * @property {number} count
 * @property {number} totalValue (£)
 * @property {number} totalMortgageBalance (£)
 * @property {number} totalEquity (£) — `totalValue - totalMortgageBalance`, every property,
 *   regardless of the toggle.
 * @property {PropertySlice} includedInNetWorth Properties whose equity counts towards net worth.
 * @property {PropertySlice} excludedFromNetWorth Properties whose equity does not — typically
 *   because the mortgage is tracked as its own, *included* debt instead (`debt.js`'s
 *   `defaultsToExcludedFromNetWorth` is the mirror-image default on that side).
 */

/**
 * @param {readonly Partial<import('./types.js').Property>[]} [properties]
 * @returns {PropertyPortfolioSummary}
 */
export function propertyPortfolioSummary(properties) {
	const list = /** @type {import('./types.js').Property[]} */ (
		Array.isArray(properties) ? properties : []
	);

	return {
		count: list.length,
		totalValue: roundMoney(list.reduce((total, p) => total + asMoney(p.value), 0)),
		totalMortgageBalance: roundMoney(
			list.reduce((total, p) => total + asMoney(p.mortgage_balance), 0)
		),
		totalEquity: roundMoney(list.reduce((total, p) => total + propertyEquity(p), 0)),
		includedInNetWorth: slice(list.filter((p) => p.include_in_net_worth !== false)),
		excludedFromNetWorth: slice(list.filter((p) => p.include_in_net_worth === false))
	};
}

/* -------------------------------------------------------------------------- */
/* Mortgage deal expiry reminder                                              */
/* -------------------------------------------------------------------------- */

/**
 * How many days out the reminder starts warning — README.md's own number ("amber 90 days").
 */
export const DEAL_EXPIRY_WARNING_DAYS = 90;

/**
 * `none` — no deal to watch (no `deal_expiry` recorded, e.g. `mortgage_type: 'none'`); `ok` —
 * outside the warning window; `amber` — inside {@link DEAL_EXPIRY_WARNING_DAYS} but not yet past;
 * `red` — `deal_expiry` has already gone by.
 *
 * @typedef {'none' | 'ok' | 'amber' | 'red'} DealExpiryStatusLevel
 */

/**
 * @typedef {object} DealExpiryStatus
 * @property {DealExpiryStatusLevel} status
 * @property {number | null} daysRemaining Whole days from `now` to `deal_expiry` — negative once
 *   expired, `null` when there is no date to compare against.
 */

/**
 * How long until a mortgage deal expires, and whether that is close enough to warn about.
 *
 * Both dates are read as UTC midnight, the same convention `net-worth.js` uses for its own month
 * boundaries — comparing local midnights would shift the boundary by the reader's UTC offset, and
 * "expires today" should read the same in every timezone the user opens this in.
 *
 * @param {string | null | undefined} dealExpiry ISO `YYYY-MM-DD`, or `null`/`undefined` for no
 *   deal on record.
 * @param {Date} [now] Defaults to the real clock; pass a fixed `Date` to get a repeatable answer.
 * @returns {DealExpiryStatus}
 */
export function dealExpiryStatus(dealExpiry, now = new Date()) {
	if (typeof dealExpiry !== 'string' || dealExpiry === '') {
		return { status: 'none', daysRemaining: null };
	}

	const expiry = new Date(`${dealExpiry}T00:00:00.000Z`);
	if (Number.isNaN(expiry.getTime())) return { status: 'none', daysRemaining: null };

	const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	const daysRemaining = Math.round((expiry.getTime() - today) / 86_400_000);

	if (daysRemaining < 0) return { status: 'red', daysRemaining };
	if (daysRemaining <= DEAL_EXPIRY_WARNING_DAYS) return { status: 'amber', daysRemaining };
	return { status: 'ok', daysRemaining };
}

/* -------------------------------------------------------------------------- */
/* Mortgage amortisation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One month of standard reducing-balance amortisation: interest accrues on the balance at
 * `monthlyRate`, then `payment` is deducted, floored at zero rather than allowed to run negative.
 * A payment smaller than the interest it accrues is not special-cased — the balance grows instead
 * of shrinking, which is exactly what a real interest-only-or-worse mortgage does.
 *
 * The one place this arithmetic lives — {@link propertyEquityProjection} calls it twelve times a
 * year and samples the result annually; `mortgage-rate-rise.js` (issue #134) calls it once a month
 * to solve for the balance at an arbitrary future month — so there is one amortisation loop in the
 * codebase, not two. Deliberately not rounded: round the *sampled* result once, not every month, so
 * many months of compounding do not accumulate rounding drift into the answer (the same reasoning
 * `propertyEquityProjection`'s own doc comment gives for `value`).
 *
 * @param {number} balance Opening balance for the month (£).
 * @param {number} monthlyRate Monthly interest rate (a fraction, e.g. `0.04 / 12`, not a percent).
 * @param {number} payment Amount deducted after interest accrues (£).
 * @returns {number} Closing balance (£), floored at zero.
 */
export function amortiseMortgageMonth(balance, monthlyRate, payment) {
	if (balance <= 0) return 0;
	const interest = balance * monthlyRate;
	return Math.max(0, balance + interest - payment);
}

/* -------------------------------------------------------------------------- */
/* Equity growth projection                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Default projection horizon — README.md's own number ("Equity growth projection chart
 * (30-year)").
 */
export const PROPERTY_PROJECTION_YEARS = 30;

/**
 * Longest horizon this will project, mirroring `forecast.js`'s `MAX_FORECAST_MONTHS` guard for the
 * same reason: an unbounded `years` from a hand-edited document would otherwise build a series
 * large enough to lock the tab up.
 */
const MAX_PROJECTION_YEARS = 100;

/** Growth rates are whole-number percents; `validateAppData` accepts -100…100, so match it. */
const MIN_RATE_PCT = -100;
const MAX_RATE_PCT = 100;

/** @param {number} value @returns {number} */
function clampRatePct(value) {
	return Math.min(MAX_RATE_PCT, Math.max(MIN_RATE_PCT, value));
}

/**
 * One year of a property's projected value, mortgage balance and equity.
 *
 * @typedef {object} PropertyEquityProjectionPoint
 * @property {number} year Whole years from today. `0` is the property as it stands today.
 * @property {number} value Projected property value (£).
 * @property {number} mortgageBalance Projected outstanding mortgage (£).
 * @property {number} equity `value - mortgageBalance` (£).
 */

/**
 * Project one property's value, mortgage balance and equity forward, one point per year.
 *
 * Two independent projections, read off the fields `propertyEquity`/`propertyCashflow` already
 * use:
 *
 * - **Value compounds at `growth_rate`.** The same geometric-monthly convention
 *   `auto-invest.js` documents for holdings (`(1 + growth_rate/100)^(1/12) - 1` compounded twelve
 *   times a year, rather than `growth_rate / 12`) — kept monthly, not annual, purely so the
 *   mortgage amortisation below (which has to run monthly) and the value growth line up on the
 *   same month-by-month walk.
 * - **The mortgage amortises**, not just "carried forward unchanged" the way `forecast.js`
 *   documents for a bare `Debt` — a `Property` additionally carries `interest_rate` and
 *   `monthly_payment`, which is exactly the information needed to run a standard reducing-balance
 *   schedule: each month, interest accrues on the balance at `interest_rate / 12`, then
 *   `monthly_payment` is deducted. A balance that reaches zero stays at zero (floored, not
 *   allowed to run negative into "the bank owes the homeowner"). Where `monthly_payment` is `0` —
 *   no payment on record, whether because none was entered or the mortgage is `none` — the
 *   balance cannot be projected and is carried forward unchanged instead, `forecast.js`'s own
 *   fallback. A payment smaller than the interest it accrues is not special-cased: the balance
 *   grows instead of shrinking, which is exactly what happens to a real interest-only mortgage
 *   whose payment has been set too low, and a projection that hid that would be the less honest
 *   one.
 *
 * Whole-pound `value`/`mortgage_balance` inputs are typical, but nothing here assumes it —
 * rounding to whole pence only happens once a year, at the sampled points, so thirty years of
 * monthly compounding do not accumulate rounding drift into the answer.
 *
 * @param {Partial<import('./types.js').Property> | null} [property]
 * @param {number} [years] Horizon in whole years. Clamped to 0…{@link MAX_PROJECTION_YEARS}.
 * @returns {PropertyEquityProjectionPoint[]} `years + 1` points, oldest (today) first.
 */
export function propertyEquityProjection(property, years = PROPERTY_PROJECTION_YEARS) {
	const horizonYears = Math.min(MAX_PROJECTION_YEARS, Math.max(0, Math.trunc(years) || 0));

	const growthRatePct = clampRatePct(asMoney(property?.growth_rate));
	const monthlyGrowthRate = Math.pow(1 + growthRatePct / 100, 1 / 12) - 1;
	const monthlyInterestRate = asMoney(property?.interest_rate) / 100 / 12;
	const monthlyPayment = asMoney(property?.monthly_payment);
	const amortises = monthlyPayment > 0;

	let value = asMoney(property?.value);
	let mortgageBalance = asMoney(property?.mortgage_balance);

	/** @type {PropertyEquityProjectionPoint[]} */
	const points = [
		{
			year: 0,
			value: roundMoney(value),
			mortgageBalance: roundMoney(mortgageBalance),
			equity: roundMoney(value - mortgageBalance)
		}
	];

	for (let year = 1; year <= horizonYears; year += 1) {
		for (let month = 0; month < 12; month += 1) {
			value *= 1 + monthlyGrowthRate;

			if (amortises && mortgageBalance > 0) {
				mortgageBalance = amortiseMortgageMonth(
					mortgageBalance,
					monthlyInterestRate,
					monthlyPayment
				);
			}
		}

		const roundedValue = roundMoney(value);
		const roundedBalance = roundMoney(mortgageBalance);
		points.push({
			year,
			value: roundedValue,
			mortgageBalance: roundedBalance,
			equity: roundMoney(roundedValue - roundedBalance)
		});
	}

	return points;
}
