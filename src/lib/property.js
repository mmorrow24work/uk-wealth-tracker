/**
 * Property equity + buy-to-let cashflow — README.md → "Property Tracker": "Equity calculation:
 * value minus mortgage", "BTL: rental income, running costs, net monthly cashflow, gross yield"
 * and "Property equity toggle: include/exclude from net worth" (issue #37's exact scope,
 * following #36's "types + core fields").
 *
 * `$lib/model.js` already owns the `Property` record and every field this module reads —
 * `rental_income`, `running_costs` and `include_in_net_worth` were added to the data model in #36
 * specifically so this issue would not need one of its own (see #36's journal entry). Two things
 * this module answers:
 *
 * 1. **What is one property worth today, net of its mortgage?** {@link propertyEquity} —
 *    `value - mortgage_balance`, README.md's own definition, verbatim.
 * 2. **What does a let property actually make, month to month?** {@link propertyCashflow} and
 *    {@link propertyGrossYield} — rent in, running costs and the mortgage payment out, plus the
 *    yield the rent alone represents against the property's value.
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
 * Every figure here is a snapshot of today's recorded fields — no projection. `growth_rate`
 * exists on the record for issue #38's equity growth projection, not for anything in this module.
 *
 * Everything here is pure: properties go in, numbers come out, nothing is mutated.
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
