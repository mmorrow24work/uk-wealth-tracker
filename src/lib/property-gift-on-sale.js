/**
 * Property gift-on-sale — README.md → "Estate & IHT Planning Suite": "Property gift-on-sale: records
 * as lifetime gift, splits between beneficiaries" (issue #141).
 *
 * The whole of this module's job, stated once: when a property is sold and some or all of the
 * proceeds are given away, that gift has to be recorded as a lifetime gift — dated, so
 * `lifetime-gifts.js`'s (#139) seven-year countdown starts running from completion — and split
 * between whoever actually receives it, since a single `Gift` can't represent "half each to two
 * children". Selling a property and simply keeping or spending the proceeds is not this module's
 * concern at all: nothing IHT-relevant happens, it is an ordinary disposal, and there is nothing here
 * to calculate. `property.js` (#37/#38) already knows what one property is worth and what is owed on
 * it; this module doesn't recompute either of those — it takes a sale price and a mortgage redemption
 * figure (defaulting to `Property.value`/`.mortgage_balance` when a real `Property` record is
 * supplied, via {@link propertySaleGiftsFromProperty}) and turns what's left, after selling costs,
 * into `lifetime-gifts.js` `Gift`s that `lifetimeGiftLedger`/`inheritanceTaxWithGifts` can be run
 * against exactly as if they had been typed in by hand.
 *
 * Four conventions decide what the numbers here mean:
 *
 * 1. **Net proceeds are `salePrice - sellingCosts - mortgageRedemption`, floored at zero.** A sale
 *    that clears less than is owed on the mortgage, or where costs swallow the rest, leaves nothing
 *    to gift — not a negative gift, which is not a thing IHT has any concept of.
 * 2. **Not all of the net proceeds need be given away.** {@link PropertySale.giftedPct} says how much
 *    is — 100% by default, since the point of this module is the case where the sale *is* the gift —
 *    and whatever isn't gifted is {@link PropertySaleGiftResult.retainedProceeds}: kept by the seller,
 *    an ordinary disposal, and never turned into a `Gift`.
 * 3. **Beneficiary shares are relative weights, not percentages of the sale.**
 *    {@link PropertyGiftBeneficiary.sharePct} values are normalised against each other, not against
 *    100: three beneficiaries at `1`/`1`/`1` split the gifted proceeds exactly as evenly as `33.3`/
 *    `33.3`/`33.3` would, and a list that happens to sum to 90 or 110 doesn't silently under- or
 *    over-gift. This is deliberately unlike `Investment.ownership_pct`, which states a real
 *    percentage of one thing; here the only fact that matters is each beneficiary's share *relative
 *    to the others*, and {@link normalisePropertyGiftBeneficiary} does nothing to the number beyond
 *    clamping it non-negative — the normalisation happens once, across the whole list, inside
 *    {@link propertySaleGifts}.
 * 4. **The last beneficiary in the list absorbs the rounding remainder**, so the individual amounts
 *    always sum to `giftedProceeds` exactly, to the penny — the same "round the parts, then fix the
 *    last one" convention `budget-policy.js`'s sequential split and `lifetime-gifts.js`'s cumulative
 *    total both rely on, rather than three independently-rounded thirds silently losing a penny.
 *
 * Every produced `Gift` is otherwise an ordinary one: dated at completion, `lifetime-gifts.js` supplies
 * the seven-year countdown, taper relief and the exemptions from there. A beneficiary's own
 * {@link PropertyGiftBeneficiary.exemption} (`'none'` by default) is passed straight through to their
 * `Gift` — set it to `'spouse'` where the recipient is a spouse or civil partner, exactly as a
 * hand-entered gift would be.
 *
 * ## Worked examples
 *
 * Each of these is a test in `property-gift-on-sale.test.js`:
 *
 * ```text
 * £500,000 sale, £150,000 mortgage, £10,000 costs,
 *   100% gifted, two children 1:1                  £340,000 net, all gifted    → £170,000 each
 * £500,000 sale, £150,000 mortgage, £10,000 costs,
 *   60% gifted, two children 1:1                   £340,000 net, £204,000
 *                                                   gifted, £136,000 retained  → £102,000 each
 * £300,000 sale, £320,000 mortgage                 mortgage exceeds the price → £0 net, no gifts
 * £500,000 sale, no mortgage, three children
 *   weighted 2:1:1                                  £500,000 net               → £250,000/£125,000/
 *                                                                                £125,000
 * ```
 *
 * ## What this deliberately does not model
 *
 * - **Where the money actually goes before it reaches the beneficiaries.** A real sale completes
 *   through a solicitor's client account and the gift may follow days or weeks later; this module
 *   treats the sale date as the gift date, which is the conservative reading (it starts the
 *   seven-year countdown as early as possible) rather than an attempt to model conveyancing timing.
 * - **Persistence.** There is still no slot on `AppData` for a recorded property sale or a
 *   beneficiary list — the same gap `lifetime-gifts.js` and `budget-policy.js` both record, and
 *   `estate.js`'s own module comment names #140 as where the beneficiary data model belongs. Every
 *   function here is pure: a sale and a beneficiary list go in, `Gift`s come out.
 * - **Capital Gains Tax on the sale itself.** README.md's Estate & IHT suite is about Inheritance
 *   Tax; a sold second home or buy-to-let can trigger CGT quite separately from anything here, and
 *   nothing in this module reduces `salePrice` for it.
 *
 * Everything here is pure and every money figure is rounded to whole pence, matching `estate.js` and
 * `lifetime-gifts.js`. This module states no statutory figures of its own — it is allocation
 * arithmetic on top of #139's machinery, not a new piece of tax law — so it carries no sourcing note.
 */

import { GIFT_EXEMPTIONS, createGift } from './lifetime-gifts.js';
import { createId } from './model.js';

/*
 * As elsewhere in `$lib`: types from sibling modules are referenced inline as
 * `import('./lifetime-gifts.js').X` rather than re-declared as local `@typedef`s, because
 * `index.js` re-exports every module with `export *` and svelte-check reads two same-named
 * top-level typedefs as an ambiguous export.
 */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asNumber(value, fallback) {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/* -------------------------------------------------------------------------- */
/* Beneficiaries                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One recipient of a share of a property sale's gifted proceeds.
 *
 * @typedef {object} PropertyGiftBeneficiary
 * @property {string} id Stable identity for list rendering and editing, matching `model.js`'s
 *   `createInvestment`/`createDebt` factory pattern.
 * @property {string} name Free text — becomes the `recipient` on the `Gift` produced for them, and
 *   is also the key `lifetime-gifts.js`'s £250 small gifts exemption is counted per, same as any
 *   other gift.
 * @property {number} sharePct This beneficiary's share of the gifted proceeds, relative to the other
 *   beneficiaries in the same list — convention 3. `0` is a valid share (a beneficiary recorded but
 *   given nothing this time) and produces no `Gift`.
 * @property {import('./lifetime-gifts.js').GiftExemption} exemption Which exemption this
 *   beneficiary's `Gift` should be declared under. `'none'` by default, same as `DEFAULT_GIFT`.
 */

/**
 * Defaults for a beneficiary nobody has filled in yet.
 *
 * @type {Readonly<Omit<PropertyGiftBeneficiary, 'id'>>}
 */
export const DEFAULT_PROPERTY_GIFT_BENEFICIARY = Object.freeze({
	name: '',
	sharePct: 0,
	exemption: /** @type {import('./lifetime-gifts.js').GiftExemption} */ ('none')
});

/**
 * A fresh beneficiary for an "+ add a beneficiary" control.
 *
 * @param {Partial<PropertyGiftBeneficiary>} [overrides]
 * @returns {PropertyGiftBeneficiary}
 */
export function createPropertyGiftBeneficiary(overrides = {}) {
	return { id: createId('beneficiary'), ...DEFAULT_PROPERTY_GIFT_BENEFICIARY, ...overrides };
}

/**
 * Fill in and bound a partial beneficiary. An unrecognised exemption reads as `'none'`, the same
 * fallback `lifetime-gifts.js`'s own `normaliseGift` uses and for the same reason: a typo should
 * overstate the eventual bill, not quietly exempt the gift.
 *
 * @param {Partial<PropertyGiftBeneficiary>} [beneficiary]
 * @returns {PropertyGiftBeneficiary}
 */
export function normalisePropertyGiftBeneficiary(beneficiary = {}) {
	const id =
		typeof beneficiary.id === 'string' && beneficiary.id !== ''
			? beneficiary.id
			: createId('beneficiary');
	const exemption = /** @type {import('./lifetime-gifts.js').GiftExemption} */ (
		GIFT_EXEMPTIONS.includes(
			/** @type {import('./lifetime-gifts.js').GiftExemption} */ (beneficiary.exemption)
		)
			? beneficiary.exemption
			: DEFAULT_PROPERTY_GIFT_BENEFICIARY.exemption
	);

	return {
		id,
		name:
			typeof beneficiary.name === 'string'
				? beneficiary.name
				: DEFAULT_PROPERTY_GIFT_BENEFICIARY.name,
		sharePct: Math.max(
			0,
			asNumber(beneficiary.sharePct, DEFAULT_PROPERTY_GIFT_BENEFICIARY.sharePct)
		),
		exemption
	};
}

/**
 * {@link normalisePropertyGiftBeneficiary} over a whole list. Anything that is not an array
 * (including `undefined`) normalises to an empty list.
 *
 * @param {readonly Partial<PropertyGiftBeneficiary>[] | undefined | null} beneficiaries
 * @returns {PropertyGiftBeneficiary[]}
 */
export function normalisePropertyGiftBeneficiaries(beneficiaries) {
	return Array.isArray(beneficiaries)
		? beneficiaries.map((beneficiary) => normalisePropertyGiftBeneficiary(beneficiary))
		: [];
}

/* -------------------------------------------------------------------------- */
/* The sale                                                                   */
/* -------------------------------------------------------------------------- */

/** {@link PropertySale.giftedPct} when nothing else is specified — convention 2. */
export const DEFAULT_PROPERTY_SALE_GIFTED_PCT = 100;

/**
 * A property sale whose proceeds are (wholly or partly) being given away.
 *
 * @typedef {object} PropertySale
 * @property {string | null} date Completion date, ISO `YYYY-MM-DD` — becomes every produced `Gift`'s
 *   `date`. `null` reads as undated, same as `lifetime-gifts.js`'s own `Gift.date`.
 * @property {string} propertyName Free text, used in each `Gift`'s `description`. Typically
 *   `Property.name`; {@link propertySaleGiftsFromProperty} fills it in automatically.
 * @property {number} salePrice What the property sold for (£).
 * @property {number} mortgageRedemption What was paid off the mortgage on completion (£). A
 *   residential sale routinely redeems the whole mortgage through the conveyancing solicitor, so
 *   {@link propertySaleGiftsFromProperty} defaults this to the whole of `Property.mortgage_balance`
 *   — nothing in this app's data model records a part-redemption.
 * @property {number} sellingCosts Estate agent and legal fees, and anything else taken off before
 *   the proceeds are split (£). `0` by default: nothing on `Property` carries a percentage to
 *   default this from, and the true figure is rarely known until completion.
 * @property {number} giftedPct How much of the net proceeds is given away (%), 0–100 — convention 2.
 * @property {readonly Partial<PropertyGiftBeneficiary>[]} beneficiaries Who receives the gifted
 *   portion, and in what relative shares — convention 3.
 */

/**
 * A {@link PropertySale} once {@link normalisePropertySale} has filled in and bounded every field —
 * same relationship `lifetime-gifts.js`'s `Gift` has to its own callers' partial input, just not
 * worth a second name for the un-normalised half.
 *
 * @typedef {Omit<PropertySale, 'beneficiaries'> & { beneficiaries: PropertyGiftBeneficiary[] }} NormalisedPropertySale
 */

/**
 * Defaults for a sale nobody has filled in yet.
 *
 * @type {Readonly<PropertySale>}
 */
export const DEFAULT_PROPERTY_SALE = Object.freeze({
	date: null,
	propertyName: '',
	salePrice: 0,
	mortgageRedemption: 0,
	sellingCosts: 0,
	giftedPct: DEFAULT_PROPERTY_SALE_GIFTED_PCT,
	beneficiaries: Object.freeze([])
});

/**
 * Fill in and bound a partial sale.
 *
 * @param {Partial<PropertySale>} [sale]
 * @returns {NormalisedPropertySale}
 */
export function normalisePropertySale(sale = {}) {
	return {
		date:
			typeof sale.date === 'string' && sale.date !== '' ? sale.date : DEFAULT_PROPERTY_SALE.date,
		propertyName:
			typeof sale.propertyName === 'string'
				? sale.propertyName
				: DEFAULT_PROPERTY_SALE.propertyName,
		salePrice: Math.max(0, asNumber(sale.salePrice, DEFAULT_PROPERTY_SALE.salePrice)),
		mortgageRedemption: Math.max(
			0,
			asNumber(sale.mortgageRedemption, DEFAULT_PROPERTY_SALE.mortgageRedemption)
		),
		sellingCosts: Math.max(0, asNumber(sale.sellingCosts, DEFAULT_PROPERTY_SALE.sellingCosts)),
		giftedPct: clamp(asNumber(sale.giftedPct, DEFAULT_PROPERTY_SALE.giftedPct), 0, 100),
		beneficiaries: normalisePropertyGiftBeneficiaries(sale.beneficiaries)
	};
}

/* -------------------------------------------------------------------------- */
/* The split                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Split `total` proportionally to `weights`, with the last entry absorbing the rounding remainder so
 * the parts always sum to exactly `total` — convention 4. A `weights` list that sums to zero (every
 * beneficiary on `0%`, or an empty list) gets nothing, rather than divided-by-zero or an even split
 * nobody asked for.
 *
 * @param {number} total (£), `>= 0`.
 * @param {readonly number[]} weights Non-negative relative weights.
 * @returns {number[]} One amount (£) per weight, in the same order.
 */
function allocateProportionally(total, weights) {
	if (weights.length === 0 || total <= 0) return weights.map(() => 0);

	const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
	if (weightSum <= 0) return weights.map(() => 0);

	const amounts = weights.map((weight) => roundMoney((total * weight) / weightSum));
	const allButLast = roundMoney(amounts.slice(0, -1).reduce((sum, amount) => sum + amount, 0));
	amounts[amounts.length - 1] = roundMoney(total - allButLast);
	return amounts;
}

/**
 * One beneficiary, with the amount its share resolved to.
 *
 * @typedef {PropertyGiftBeneficiary & { amount: number }} PropertyGiftSplit
 */

/**
 * A property sale, turned into lifetime gifts.
 *
 * @typedef {object} PropertySaleGiftResult
 * @property {string | null} date
 * @property {string} propertyName
 * @property {number} salePrice (£)
 * @property {number} mortgageRedemption (£)
 * @property {number} sellingCosts (£)
 * @property {number} netProceeds `salePrice - sellingCosts - mortgageRedemption`, floored at `0`
 *   (£) — convention 1.
 * @property {number} giftedProceeds `netProceeds * giftedPct / 100` (£) — convention 2.
 * @property {number} retainedProceeds `netProceeds - giftedProceeds` (£): kept by the seller, an
 *   ordinary disposal, never part of any `Gift`.
 * @property {PropertyGiftSplit[]} splits Every supplied beneficiary with its resolved `amount` (£),
 *   in the order supplied — including any that resolved to `0` and so have no `Gift` below.
 * @property {import('./lifetime-gifts.js').Gift[]} gifts One `Gift` per beneficiary whose split
 *   `amount` is `> 0`, ready for `lifetimeGiftLedger`/`inheritanceTaxWithGifts`. Empty where there is
 *   nothing to gift — no beneficiaries, a `0` `giftedPct`, or `netProceeds` of `0`.
 */

/**
 * Turn a property sale into the lifetime gifts it represents — the whole of this module's job.
 *
 * @param {Partial<PropertySale>} [sale]
 * @returns {PropertySaleGiftResult}
 */
export function propertySaleGifts(sale = {}) {
	const config = normalisePropertySale(sale);

	const netProceeds = Math.max(
		0,
		roundMoney(config.salePrice - config.sellingCosts - config.mortgageRedemption)
	);
	const giftedProceeds = roundMoney((netProceeds * config.giftedPct) / 100);
	const retainedProceeds = roundMoney(netProceeds - giftedProceeds);

	const amounts = allocateProportionally(
		giftedProceeds,
		config.beneficiaries.map((beneficiary) => beneficiary.sharePct)
	);

	/** @type {PropertyGiftSplit[]} */
	const splits = config.beneficiaries.map((beneficiary, index) => ({
		...beneficiary,
		amount: amounts[index]
	}));

	const description = config.propertyName
		? `Share of sale proceeds: ${config.propertyName}`
		: 'Share of property sale proceeds';

	const gifts = splits
		.filter((split) => split.amount > 0)
		.map((split) =>
			createGift({
				date: config.date,
				amount: split.amount,
				recipient: split.name,
				description,
				exemption: split.exemption
			})
		);

	return {
		date: config.date,
		propertyName: config.propertyName,
		salePrice: config.salePrice,
		mortgageRedemption: config.mortgageRedemption,
		sellingCosts: config.sellingCosts,
		netProceeds,
		giftedProceeds,
		retainedProceeds,
		splits,
		gifts
	};
}

/**
 * {@link propertySaleGifts}, defaulting `propertyName`/`salePrice`/`mortgageRedemption` from a real
 * `Property` record where the sale itself doesn't specify them — the "sold at the recorded market
 * value, mortgage redeemed in full" case this module exists for.
 *
 * @param {Partial<import('./types.js').Property> | null} [property]
 * @param {Partial<PropertySale>} [sale]
 * @returns {PropertySaleGiftResult}
 */
export function propertySaleGiftsFromProperty(property, sale = {}) {
	const record = property ?? {};
	return propertySaleGifts({
		...sale,
		propertyName: sale.propertyName ?? record.name,
		salePrice: sale.salePrice ?? record.value,
		mortgageRedemption: sale.mortgageRedemption ?? record.mortgage_balance
	});
}
