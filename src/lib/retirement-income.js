/**
 * Retirement income stream builder — README.md → "Pension Tracker": "Retirement income stream
 * builder: DB, annuity, SIPP drawdown, ISA withdrawals, GIA dividends, State Pension" — issue #33.
 *
 * Every other module in this app answers a question about one pot. This one answers the question the
 * pots exist for: *what would I actually be paid, and where would it come from?* Six streams, in the
 * order the issue names them — each one either a promise (Defined Benefit, State Pension) or a rate
 * applied to a pot (annuity, drawdown, ISA withdrawals, dividends) — added up into a single annual
 * and monthly figure, taxed the way HMRC would tax each part of it, and measured against the income
 * the user said they wanted.
 *
 * Eight conventions decide what the numbers mean:
 *
 * 1. **Six streams, always all six.** A stream with nothing behind it is reported as zero rather than
 *    dropped, because the view's job is to show what a retirement is made of — including the parts
 *    that are empty. {@link RETIREMENT_INCOME_STREAMS} is the order they come back in.
 * 2. **Each stored collection feeds exactly one stream family, so nothing is counted twice.**
 *    `pensions[]` feeds Defined Benefit, the annuity and drawdown (and a Lifetime ISA pot feeds the
 *    ISA stream, since after 60 that is what it is); the `type: 'state'` record's National Insurance
 *    fields feed the State Pension; the *latest* monthly snapshot's `investments[]` feeds ISA
 *    withdrawals; `dividends[]` feeds GIA dividends. A SIPP recorded both as a pension pot and as a
 *    snapshot holding is one pot of money, and the pension record is the one that counts — see
 *    convention (8) for what happens to the other.
 * 3. **This is a position, not a projection.** Every figure is what the pots recorded *today* would
 *    pay if drawn today, in today's money. Nothing is compounded forward to a retirement date, no
 *    inflation is applied, and no stream is switched on or off by age — `fire.js` owns the walk
 *    forward, and stapling a second, differently-anchored projection onto this view would put two
 *    numbers on one page that disagree about the same pot. The one place age appears is the State
 *    Pension's own start date, which `state-pension.js` reports and this module passes through
 *    unchanged so the card can say *when* that stream begins without pretending to model the gap.
 * 4. **A pot becomes an income by having a rate applied to it, and it is the same arithmetic every
 *    time** — `fire.js`'s own `sustainableIncome`. Drawdown at the withdrawal rate, ISA withdrawals
 *    at the same rate, an annuity at the annuity rate. Three different rates, one function, so "what
 *    does this pot pay" cannot mean two things on one screen.
 * 5. **A quarter of every Defined Contribution pound is tax-free.** Drawdown and annuity income both
 *    come back 25% tax-free / 75% taxable ({@link PENSION_TAX_FREE_SHARE}) — exactly right for
 *    UFPLS-style drawdown, where each withdrawal carries its own tax-free quarter, and the spread-out
 *    equivalent of taking a 25% lump sum before buying an annuity with the rest. What it is *not* is
 *    a model of the lump sum itself: there is no cash-now-versus-income-later choice here.
 * 6. **Three tax treatments, one personal allowance between them.** A Defined Benefit pension, an
 *    annuity, drawdown and the State Pension are earned income and meet `tax.js`'s band ladder for
 *    the profile's region; ISA and Lifetime ISA withdrawals (and the tax-free quarter above) are
 *    tax-free and never enter the calculation at all; GIA dividends meet `dividend-tax.js`'s
 *    allowance and rates. The two taxed families share one personal allowance, earned income first
 *    and dividends on what is left, which is HMRC's own ordering — and the allowance both are
 *    measured against is tapered on their *combined* total, so a retirement large enough to lose the
 *    allowance loses it once rather than twice or not at all.
 * 7. **The target is measured against income after tax.** A target income is what you want to live
 *    on, and you live on what arrives. Comparing a target against a gross figure would call a plan
 *    finished several thousand pounds before it is.
 * 8. **What is left out is reported, not dropped.** Anything in the recorded position that no stream
 *    can use — a snapshot holding in a pension wrapper (convention 2), an unwrapped holding with no
 *    yield recorded against it, a Junior ISA (a child's money, not a retirement income), a dividend
 *    holding inside an ISA or a pension — comes back in {@link RetirementIncomeSummary.uncounted}
 *    with its value, so the gap between this view and the net worth tab is visible instead of
 *    mysterious.
 *
 * **What this deliberately does not model:** the *timing* of any of it beyond reporting the State
 * Pension's start date — the 55/57 minimum pension age, a Defined Benefit scheme's normal pension age
 * and the reduction for drawing early, or phasing one stream in as another runs down; annuity
 * underwriting (age, health, joint life, guarantees, escalation, and the fact that a real quote is a
 * rate for life rather than a percentage of a pot each year); inflation-linking or the triple lock;
 * the lump sum allowance and the Money Purchase Annual Allowance; National Insurance, which is not
 * due on any pension income; and the sequence-of-returns risk that decides whether a drawdown rate
 * survives at all — `fire.js`'s runway is the honest answer to that, and this module's drawdown
 * figure is a rate, not a promise.
 *
 * Everything is pure and rounded to whole pence. The module imports from `enums.js`, `fire.js`,
 * `forecast.js`, `defined-benefit.js`, `state-pension.js`, `dividends.js`, `dividend-tax.js` and
 * `tax.js`, and nothing goes the other way — the same one-directional shape `defined-benefit.js` has
 * with `fire.js`.
 */

import { definedBenefitTotals } from './defined-benefit.js';
import { dividendTaxBreakdown, isTaxableHolding } from './dividend-tax.js';
import { annualDividendIncome } from './dividends.js';
import {
	DEFINED_CONTRIBUTION_PENSION_TYPES,
	ISA_WRAPPERS,
	TAX_SHELTERED_WRAPPERS
} from './enums.js';
import {
	DEFAULT_WITHDRAWAL_RATE,
	MAX_WITHDRAWAL_RATE,
	MIN_WITHDRAWAL_RATE,
	sustainableIncome
} from './fire.js';
import { positionFromEntries } from './forecast.js';
import { statePensionOutlook, statePensionProjection } from './state-pension.js';
import {
	DEFAULT_TAX_REGION,
	PERSONAL_ALLOWANCE,
	normaliseTaxRegion,
	personalAllowance,
	sliceIntoBands
} from './tax.js';

/*
 * As in `tax.js`/`fire.js`/`defined-benefit.js`, model types are referenced inline as
 * `import('./types.js').X` rather than re-declared as local `@typedef`s, because `index.js`
 * re-exports every module with `export *` and svelte-check reads two same-named top-level typedefs
 * as an ambiguous export.
 */

/* -------------------------------------------------------------------------- */
/* The streams                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The six streams, in the order README.md and issue #33 name them.
 * @typedef {'db' | 'annuity' | 'sipp_drawdown' | 'isa_withdrawal' | 'gia_dividends' | 'state_pension'} RetirementIncomeStreamId
 */

/** @type {readonly RetirementIncomeStreamId[]} */
export const RETIREMENT_INCOME_STREAMS = Object.freeze([
	'db',
	'annuity',
	'sipp_drawdown',
	'isa_withdrawal',
	'gia_dividends',
	'state_pension'
]);

/** @type {Record<RetirementIncomeStreamId, string>} */
export const RETIREMENT_INCOME_STREAM_LABELS = Object.freeze({
	db: 'Defined Benefit pension',
	annuity: 'Annuity',
	sipp_drawdown: 'SIPP / DC drawdown',
	isa_withdrawal: 'ISA withdrawals',
	gia_dividends: 'GIA dividends',
	state_pension: 'State Pension'
});

/**
 * How HMRC treats a stream — convention (6).
 * @typedef {'earned_income' | 'dividend' | 'tax_free'} RetirementIncomeTaxTreatment
 */

/** @type {Record<RetirementIncomeTaxTreatment, string>} */
export const RETIREMENT_INCOME_TAX_TREATMENT_LABELS = Object.freeze({
	earned_income: 'Taxed as income',
	dividend: 'Taxed at dividend rates',
	tax_free: 'Tax-free'
});

/**
 * Which collection a stream was built from — convention (2), made visible so a reader can tell where
 * to go and change the number.
 * @typedef {'pensions' | 'monthly_entries' | 'dividends' | 'ni_record'} RetirementIncomeSource
 */

/** @type {Record<RetirementIncomeSource, string>} */
export const RETIREMENT_INCOME_SOURCE_LABELS = Object.freeze({
	pensions: 'Pensions tab',
	monthly_entries: 'Latest monthly snapshot',
	dividends: 'Dividend planner',
	ni_record: 'NI qualifying years'
});

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The share of a Defined Contribution pot that comes out tax-free (%) — convention (5). 25% is the
 * pension commencement lump sum, and equally the tax-free quarter of a UFPLS withdrawal.
 */
export const PENSION_TAX_FREE_SHARE = 25;

/**
 * Default annuity rate (%): roughly what a level, single-life annuity bought at around State Pension
 * age paid per £100 of pot through 2025–26. A slider assumption, not a quote — a real rate depends on
 * age, health, gilt yields and whether the income escalates or covers a spouse.
 */
export const DEFAULT_ANNUITY_RATE = 6;

/**
 * Annuity rates are clamped into the same band `fire.js` clamps a withdrawal rate to, for the same
 * reason: a rate of zero would pay nothing for a pot handed over for life, and one above 100% would
 * pay the pot out in its first year.
 */
export const MIN_ANNUITY_RATE = MIN_WITHDRAWAL_RATE;
export const MAX_ANNUITY_RATE = MAX_WITHDRAWAL_RATE;

/**
 * ISA wrappers whose withdrawals are a retirement income. Every ISA except the Junior ISA, which is
 * a child's money held until they are 18 and never the account holder's to draw — convention (8)
 * reports it rather than counting it.
 *
 * @type {readonly import('./enums.js').Wrapper[]}
 */
export const RETIREMENT_ISA_WRAPPERS = Object.freeze(
	ISA_WRAPPERS.filter((wrapper) => wrapper !== 'jisa')
);

/**
 * Wrappers whose income is taxable — the "GIA" of "GIA dividends". `none` is unwrapped and untaxed by
 * ISA/pension rules, so its dividends are taxable in exactly the same way `gia`'s are. This is the
 * complement of `TAX_SHELTERED_WRAPPERS`, derived from it rather than typed out again, so a new
 * wrapper cannot end up in neither list.
 *
 * @type {readonly import('./enums.js').Wrapper[]}
 */
export const UNSHELTERED_WRAPPERS = Object.freeze(
	/** @type {import('./enums.js').Wrapper[]} */ (['gia', 'none']).filter(
		(wrapper) => !TAX_SHELTERED_WRAPPERS.includes(wrapper)
	)
);

/** Wrappers a snapshot holding sits in when the money is already counted as a pension pot. */
const PENSION_WRAPPERS = Object.freeze(['sipp', 'workplace_pension']);

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100 + 0;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asFinite(value, fallback) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

/**
 * @param {unknown} value
 * @returns {any[]}
 */
function asList(value) {
	return Array.isArray(value) ? [...value] : [];
}

/**
 * A holding counts towards a retirement income only if it counts towards net worth — a holding
 * flagged out (property tracked on its own tab, someone else's money) is out of every stream, and is
 * not reported as uncounted either: it was deliberately excluded upstream.
 *
 * @param {Partial<import('./types.js').Investment>} investment
 * @returns {boolean}
 */
function counts(investment) {
	return !investment.exclude_from_net_worth;
}

/**
 * @param {readonly { value?: number }[]} records
 * @returns {number} (£)
 */
function totalValue(records) {
	return roundMoney(records.reduce((total, record) => total + asFinite(record.value, 0), 0));
}

/* -------------------------------------------------------------------------- */
/* The pots behind the streams                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The Defined Contribution pots themselves — DC workplace pensions and SIPPs recorded on the Pensions
 * tab. This is the money that becomes either drawdown or an annuity; convention (2) keeps snapshot
 * holdings in SIPP/workplace wrappers out of it, since a pot recorded in both places is still one
 * pot.
 *
 * A Lifetime ISA pension pot is *not* here: a LISA drawn after 60 is tax-free, which makes it an ISA
 * withdrawal in everything but the tab it was typed into, so it goes to {@link isaPot}.
 *
 * @param {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @returns {Partial<import('./types.js').Pension>[]}
 */
export function definedContributionPots(pensions = []) {
	return asList(pensions).filter((pension) =>
		DEFINED_CONTRIBUTION_PENSION_TYPES.includes(
			/** @type {import('./enums.js').PensionType} */ (pension?.type)
		)
	);
}

/**
 * What those pots are worth between them.
 *
 * @param {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @returns {number} (£)
 */
export function definedContributionPot(pensions = []) {
	return totalValue(definedContributionPots(pensions));
}

/**
 * The tax-free pot: every ISA-wrapped holding in the latest monthly snapshot except a Junior ISA,
 * plus any Lifetime ISA pot recorded on the Pensions tab.
 *
 * @param {readonly Partial<import('./types.js').Investment>[]} [investments] Latest snapshot's holdings.
 * @param {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @returns {{ value: number, count: number }} `count` is how many records fed it.
 */
export function isaPot(investments = [], pensions = []) {
	const holdings = asList(investments)
		.filter(counts)
		.filter((investment) =>
			RETIREMENT_ISA_WRAPPERS.includes(
				/** @type {import('./enums.js').Wrapper} */ (investment.wrapper)
			)
		);
	const lisaPots = asList(pensions).filter((pension) => pension?.type === 'lisa');

	return {
		value: roundMoney(totalValue(holdings) + totalValue(lisaPots)),
		count: holdings.length + lisaPots.length
	};
}

/**
 * The income unwrapped dividend holdings pay: value × yield, for every holding in the dividend
 * planner that is not inside an ISA or a pension. A holding's `strategy` is not consulted — a DRIP
 * holding is reinvesting *today*, and the whole premise of this view is that today's pots are being
 * drawn on instead. What it is stated as, on screen, is "if you took the income".
 *
 * The income itself is `dividends.js`'s own `annualDividendIncome` and the sheltered/taxable split is
 * `dividend-tax.js`'s own `isTaxableHolding`, so this stream cannot disagree with the Dividends tab
 * about either.
 *
 * @param {readonly Partial<import('./types.js').Dividend>[]} [dividends]
 * @returns {{ income: number, value: number, count: number }} (£/yr, £, records)
 */
export function giaDividendIncome(dividends = []) {
	const holdings = asList(dividends).filter(isTaxableHolding);

	return {
		income: roundMoney(
			holdings.reduce((total, holding) => total + annualDividendIncome(holding), 0)
		),
		value: totalValue(holdings),
		count: holdings.length
	};
}

/* -------------------------------------------------------------------------- */
/* Assumptions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The assumptions the builder's controls set — everything that is a choice rather than a stored fact.
 * None of them has a field in `AppData`: "I would annuitise a third of my pot at 6%" is a question
 * being asked, not something recorded about a pension, the same way `DefinedBenefitIncome`'s
 * projection controls are component-local.
 *
 * @typedef {object} RetirementIncomeInput
 * @property {number} withdrawalRate Rate drawdown and ISA withdrawals are taken at (%).
 * @property {number} annuityRate Income an annuity pays a year, as a percentage of the pot handed
 *   over (%).
 * @property {number} annuitisedShare Share of the Defined Contribution pot spent on an annuity (%);
 *   the rest stays in drawdown.
 * @property {boolean} includeStatePension Whether the State Pension is part of this plan. Off is the
 *   honest setting for anyone planning to retire before State Pension age — convention (3) models no
 *   timing, so the gap has to be answered by switching the stream off rather than by a date.
 * @property {number | null} statePensionYears Total NI years to use. `null` means "read them off the
 *   `type: 'state'` record"; a number overrides it, which is how a gov.uk forecast beats the app's
 *   own arithmetic.
 * @property {import('./enums.js').TaxRegion} taxRegion Which band ladder the earned streams meet.
 * @property {number} targetIncome Income wanted in retirement (£/yr) — `Profile.retirement_target`.
 */

/** @type {RetirementIncomeInput} */
export const DEFAULT_RETIREMENT_INCOME_INPUT = Object.freeze({
	withdrawalRate: DEFAULT_WITHDRAWAL_RATE,
	annuityRate: DEFAULT_ANNUITY_RATE,
	// Nothing annuitised by default: buying an annuity is an irreversible choice, and a view that
	// assumed one would be putting words in the user's mouth about the biggest decision on the page.
	annuitisedShare: 0,
	includeStatePension: true,
	statePensionYears: null,
	taxRegion: DEFAULT_TAX_REGION,
	targetIncome: 0
});

/**
 * Coerce whatever the controls produced into a usable {@link RetirementIncomeInput}. Never throws — a
 * half-typed form is a normal state, not an error.
 *
 * @param {Partial<RetirementIncomeInput>} [raw]
 * @returns {RetirementIncomeInput}
 */
export function normaliseRetirementIncomeInput(raw = {}) {
	const source = { ...DEFAULT_RETIREMENT_INCOME_INPUT, ...raw };
	const years = source.statePensionYears;

	return {
		withdrawalRate: clamp(
			asFinite(source.withdrawalRate, DEFAULT_WITHDRAWAL_RATE),
			MIN_WITHDRAWAL_RATE,
			MAX_WITHDRAWAL_RATE
		),
		annuityRate: clamp(
			asFinite(source.annuityRate, DEFAULT_ANNUITY_RATE),
			MIN_ANNUITY_RATE,
			MAX_ANNUITY_RATE
		),
		annuitisedShare: clamp(asFinite(source.annuitisedShare, 0), 0, 100),
		includeStatePension: source.includeStatePension !== false,
		statePensionYears:
			years === null || years === undefined ? null : Math.max(0, asFinite(years, 0)),
		taxRegion: /** @type {import('./enums.js').TaxRegion} */ (normaliseTaxRegion(source.taxRegion)),
		targetIncome: Math.max(0, asFinite(source.targetIncome, 0))
	};
}

/**
 * The stored position the streams are built from — the three collections of convention (2), plus the
 * profile the tax region, the target income and State Pension age are read off.
 *
 * @typedef {object} RetirementIncomePosition
 * @property {readonly Partial<import('./types.js').Pension>[]} [pensions]
 * @property {readonly import('./types.js').MonthlyEntry[]} [monthlyEntries] The recorded history; the
 *   latest snapshot is the one that is drawn on.
 * @property {readonly Partial<import('./types.js').Investment>[]} [investments] The snapshot's
 *   holdings directly, for a caller that has already picked one. Wins over `monthlyEntries` when both
 *   are given.
 * @property {readonly Partial<import('./types.js').Dividend>[]} [dividends]
 * @property {Partial<import('./types.js').Profile>} [profile]
 */

/**
 * The holdings a position draws on: the ones handed in, or the latest recorded snapshot's.
 *
 * @param {RetirementIncomePosition} position
 * @returns {Partial<import('./types.js').Investment>[]}
 */
function holdingsFrom(position) {
	if (Array.isArray(position.investments)) return [...position.investments];

	const entries = /** @type {import('./types.js').MonthlyEntry[]} */ (
		asList(position.monthlyEntries)
	);
	return positionFromEntries(entries)?.investments ?? [];
}

/* -------------------------------------------------------------------------- */
/* One stream                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One line of the retirement income view.
 *
 * @typedef {object} RetirementIncomeStream
 * @property {RetirementIncomeStreamId} id
 * @property {string} label
 * @property {RetirementIncomeSource} source Which collection it was built from.
 * @property {number} sourceCount How many stored records fed it.
 * @property {RetirementIncomeTaxTreatment} taxTreatment How the taxable part of it is taxed.
 * @property {number} capital The pot behind it (£); `0` for the two promised incomes, which have no
 *   pot — see `RetirementIncomeSummary.promisedCapitalEquivalent` for what those promises are
 *   *worth* as one.
 * @property {number | null} rate The rate applied to that capital (%), or `null` where the income is
 *   not a rate on a pot.
 * @property {number} annualIncome (£/yr)
 * @property {number} monthlyIncome (£/mo)
 * @property {number} taxFreeIncome The part of `annualIncome` no tax is due on (£/yr).
 * @property {number} taxableIncome The rest (£/yr) — taxed per `taxTreatment`.
 * @property {number} share This stream as a fraction of total gross income (`0`–`1`).
 * @property {boolean} present Whether there is anything behind it at all.
 */

/**
 * @param {object} parts
 * @param {RetirementIncomeStreamId} parts.id
 * @param {RetirementIncomeSource} parts.source
 * @param {number} parts.sourceCount
 * @param {RetirementIncomeTaxTreatment} parts.taxTreatment
 * @param {number} parts.annualIncome
 * @param {number} [parts.capital]
 * @param {number | null} [parts.rate]
 * @param {number} [parts.taxFreeShare] (%) of the income that is tax-free.
 * @returns {RetirementIncomeStream}
 */
function buildStream(parts) {
	const annualIncome = roundMoney(Math.max(0, asFinite(parts.annualIncome, 0)));
	const taxFreeShare = clamp(asFinite(parts.taxFreeShare, 0), 0, 100);
	const taxFreeIncome = roundMoney((annualIncome * taxFreeShare) / 100);

	return {
		id: parts.id,
		label: RETIREMENT_INCOME_STREAM_LABELS[parts.id],
		source: parts.source,
		sourceCount: parts.sourceCount,
		taxTreatment: parts.taxTreatment,
		capital: roundMoney(Math.max(0, asFinite(parts.capital, 0))),
		rate: parts.rate ?? null,
		annualIncome,
		monthlyIncome: roundMoney(annualIncome / 12),
		taxFreeIncome,
		taxableIncome: roundMoney(annualIncome - taxFreeIncome),
		// Filled in by `retirementIncomeSummary`, which is the only thing that knows the total.
		share: 0,
		present: annualIncome > 0
	};
}

/* -------------------------------------------------------------------------- */
/* Tax on the whole retirement                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The tax due on a retirement income, both kinds of it — convention (6).
 *
 * @typedef {object} RetirementIncomeTax
 * @property {import('./enums.js').TaxRegion} region Which band ladder the earned income met.
 * @property {number} earnedIncome Taxable earned income across every earned stream (£/yr).
 * @property {number} dividendIncome Taxable dividend income (£/yr).
 * @property {number} taxableTotal The two added (£/yr) — the income the personal allowance is
 *   tapered against, and the only part of the retirement HMRC ever sees.
 * @property {number} personalAllowance Allowance available against that total (£), after any taper.
 * @property {number} allowanceUsedByEarnedIncome (£) — earned income takes it first.
 * @property {number} allowanceUsedByDividends (£) — dividends get whatever is left.
 * @property {boolean} allowanceTapered Whether the £100,000 taper took any of it.
 * @property {number} taxableEarnedIncome Earned income left after its share of the allowance (£/yr).
 * @property {import('./tax.js').TaxBandSlice[]} bands The whole earned-income ladder, in order,
 *   including bands the income never reaches.
 * @property {number} incomeTax Income tax due on the earned streams (£/yr).
 * @property {number} dividendTax Dividend tax due on the GIA stream (£/yr).
 * @property {number} dividendAllowanceUsed How much of the £500 nil rate this income used (£).
 * @property {number} dividendAllowanceRemaining What is left of it (£).
 * @property {number} totalTax `incomeTax + dividendTax` (£/yr).
 */

/**
 * Tax a retirement income, earned streams and dividends together against one shared, once-tapered
 * personal allowance — convention (6).
 *
 * Neither `tax.js`'s `incomeTax` nor `dividend-tax.js`'s `dividendTax` can do this alone: the first
 * would give the earned income the whole allowance and taper it on earned income only, the second
 * assumes its `otherIncome` was taxed exactly that way. Splitting the allowance here and slicing the
 * remainder through `tax.js`'s own ladder keeps both halves consistent — the earned income gets the
 * allowance first (HMRC's own ordering, and the one `dividendTaxBreakdown` already assumes), and the
 * taper both are measured against is assessed on the combined total.
 *
 * @param {object} [input]
 * @param {number} [input.earnedIncome] Taxable earned income (£/yr) — the tax-free quarter already off.
 * @param {number} [input.dividendIncome] Taxable dividend income (£/yr).
 * @param {unknown} [input.region]
 * @returns {RetirementIncomeTax}
 */
export function retirementIncomeTax(input = {}) {
	const region = /** @type {import('./enums.js').TaxRegion} */ (normaliseTaxRegion(input.region));
	const earnedIncome = roundMoney(Math.max(0, asFinite(input.earnedIncome, 0)));
	const dividendIncome = roundMoney(Math.max(0, asFinite(input.dividendIncome, 0)));
	const taxableTotal = roundMoney(earnedIncome + dividendIncome);

	const available = personalAllowance(taxableTotal);
	const usedByEarnedIncome = roundMoney(Math.min(earnedIncome, available));
	const taxableEarnedIncome = roundMoney(earnedIncome - usedByEarnedIncome);

	const bands = sliceIntoBands(taxableEarnedIncome, region);
	const incomeTax = roundMoney(bands.reduce((total, band) => total + band.tax, 0));

	// `dividendTaxBreakdown` re-derives the split from the same two figures — it gives `otherIncome`
	// the allowance first and tapers on the total — so the allowance it hands the dividends is the
	// complement of `usedByEarnedIncome` by construction, not by coincidence.
	const dividends = dividendTaxBreakdown({ dividendIncome, otherIncome: earnedIncome });

	return {
		region,
		earnedIncome,
		dividendIncome,
		taxableTotal,
		personalAllowance: available,
		allowanceUsedByEarnedIncome: usedByEarnedIncome,
		allowanceUsedByDividends: dividends.personalAllowance.usedByDividends,
		allowanceTapered: available < PERSONAL_ALLOWANCE,
		taxableEarnedIncome,
		bands,
		incomeTax,
		dividendTax: dividends.totalTax,
		dividendAllowanceUsed: dividends.dividendAllowanceUsed,
		dividendAllowanceRemaining: dividends.dividendAllowanceRemaining,
		totalTax: roundMoney(incomeTax + dividends.totalTax)
	};
}

/* -------------------------------------------------------------------------- */
/* What no stream can use                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A slice of the recorded position that no stream counts — convention (8).
 *
 * @typedef {object} UncountedCapital
 * @property {'pension_wrapped_holdings' | 'unsheltered_holdings' | 'junior_isa_holdings' | 'sheltered_dividends'} id
 * @property {string} label What it is.
 * @property {string} reason Why it is not in a stream, and what to do about it.
 * @property {number} count How many records.
 * @property {number} value (£)
 */

/** @type {Record<UncountedCapital['id'], { label: string, reason: string }>} */
export const UNCOUNTED_CAPITAL_LABELS = Object.freeze({
	pension_wrapped_holdings: {
		label: 'Snapshot holdings in a pension wrapper',
		reason:
			'pension pots are counted from the Pensions tab, so counting these too would count the same money twice — record them as a pension pot if they are missing there'
	},
	unsheltered_holdings: {
		label: 'Unwrapped snapshot holdings',
		reason:
			'these are not an ISA and carry no yield here, so no stream can price them — add them to the dividend planner to have their income counted'
	},
	junior_isa_holdings: {
		label: 'Junior ISA holdings',
		reason: 'a Junior ISA is the child’s money at 18, not a retirement income'
	},
	sheltered_dividends: {
		label: 'Dividend holdings inside an ISA or pension',
		reason:
			'their income is sheltered, not GIA dividends — record the holding on the relevant tab to have its pot drawn down'
	}
});

/**
 * Everything in the recorded position that no stream could use.
 *
 * @param {readonly Partial<import('./types.js').Investment>[]} [investments] Latest snapshot's holdings.
 * @param {readonly Partial<import('./types.js').Dividend>[]} [dividends]
 * @returns {UncountedCapital[]} Only the slices that actually hold something.
 */
export function uncountedCapital(investments = [], dividends = []) {
	const holdings = asList(investments).filter(counts);

	/** @param {UncountedCapital['id']} id @param {readonly { value?: number }[]} records */
	const slice = (id, records) => ({
		id,
		...UNCOUNTED_CAPITAL_LABELS[id],
		count: records.length,
		value: totalValue(records)
	});

	return [
		slice(
			'pension_wrapped_holdings',
			holdings.filter((holding) => PENSION_WRAPPERS.includes(holding.wrapper ?? ''))
		),
		slice(
			'unsheltered_holdings',
			holdings.filter((holding) =>
				UNSHELTERED_WRAPPERS.includes(/** @type {import('./enums.js').Wrapper} */ (holding.wrapper))
			)
		),
		slice(
			'junior_isa_holdings',
			holdings.filter((holding) => holding.wrapper === 'jisa')
		),
		slice(
			'sheltered_dividends',
			asList(dividends).filter((dividend) => !isTaxableHolding(dividend))
		)
	].filter((entry) => entry.count > 0);
}

/* -------------------------------------------------------------------------- */
/* The whole view                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Everything the retirement income view shows.
 *
 * @typedef {object} RetirementIncomeSummary
 * @property {RetirementIncomeInput} input The assumptions every figure was computed from.
 * @property {RetirementIncomeStream[]} streams All six, in {@link RETIREMENT_INCOME_STREAMS} order.
 * @property {number} annualIncome Gross, everything added up (£/yr).
 * @property {number} monthlyIncome (£/mo).
 * @property {number} taxFreeIncome The part no tax is due on at all (£/yr).
 * @property {number} earnedIncome The part taxed as income (£/yr).
 * @property {number} dividendIncome The part taxed at dividend rates (£/yr).
 * @property {RetirementIncomeTax} tax The whole tax calculation — convention (6).
 * @property {number} totalTax Income tax and dividend tax together (£/yr).
 * @property {number} netAnnualIncome Gross less that tax (£/yr).
 * @property {number} netMonthlyIncome (£/mo).
 * @property {number} effectiveTaxRate `totalTax` as a share of gross income (%).
 * @property {import('./state-pension.js').StatePensionOutlook} statePension What
 *   `state-pension.js` made of the National Insurance record — the projection, State Pension age and
 *   how long there is left to build the record. Reported whether or not this plan counts the stream,
 *   and reflecting `input.statePensionYears` when that overrides the recorded count.
 * @property {number} statePensionYears NI years the State Pension figure was worked out on.
 * @property {boolean} statePensionRecorded Whether a stored NI record exists to work it out from —
 *   the record, not the override, so "you have not entered your NI years" stays true when a figure is
 *   typed straight into the card.
 * @property {number} totalCapital Every pot behind a stream, added up (£). Real money only: the two
 *   promised incomes have no pot, so they are not in it.
 * @property {number} promisedCapitalEquivalent What a pot would have to be worth to buy the Defined
 *   Benefit *and* State Pension income at the same withdrawal rate (£) — kept beside `totalCapital`
 *   rather than added to it, because it is a comparison and not money anyone holds.
 * @property {number} targetIncome The income wanted (£/yr).
 * @property {number} targetGap How far the *net* income falls short of it (£/yr); `0` once covered.
 * @property {number} targetSurplus How far past it the net income is (£/yr); `0` until covered.
 * @property {number} targetShare Net income as a fraction of the target (`1` = exactly there). `1`
 *   when no target is set, since there is nothing left to reach.
 * @property {boolean} coversTarget
 * @property {UncountedCapital[]} uncounted What no stream could use — convention (8).
 */

/**
 * Build the whole retirement income view from a stored position and a set of assumptions.
 *
 * This is the card's single entry point, and composing it here is what keeps one set of assumptions
 * behind every figure: the annuity and the drawdown split one pot between them, the tax comes off one
 * total against one personal allowance, and the target is measured against the income after that tax
 * — so no two numbers on the page can disagree about what was typed.
 *
 * @param {RetirementIncomePosition} [position]
 * @param {Partial<RetirementIncomeInput>} [raw]
 * @param {object} [options]
 * @param {Date} [options.now] The clock `state-pension.js` dates State Pension age against.
 * @returns {RetirementIncomeSummary}
 */
export function retirementIncomeSummary(position = {}, raw = {}, options = {}) {
	const profile = position.profile ?? {};
	const input = normaliseRetirementIncomeInput({
		taxRegion: /** @type {import('./enums.js').TaxRegion} */ (profile.tax_region ?? undefined),
		targetIncome: asFinite(profile.retirement_target, 0),
		...raw
	});

	const pensions = asList(position.pensions);
	const investments = holdingsFrom(position);
	const dividends = asList(position.dividends);

	/* --- the pots ------------------------------------------------------------ */

	const dcPots = definedContributionPots(pensions);
	const dcPot = totalValue(dcPots);
	const annuitisedPot = roundMoney((dcPot * input.annuitisedShare) / 100);
	const drawdownPot = roundMoney(dcPot - annuitisedPot);
	const isa = isaPot(investments, pensions);
	const gia = giaDividendIncome(dividends);
	const db = definedBenefitTotals(pensions, input.withdrawalRate);

	/* --- the State Pension --------------------------------------------------- */

	// `state-pension.js` (#31) owns this arithmetic, the NI record it reads and State Pension age.
	// An override re-runs the projection on a different count rather than scaling the answer, so a
	// figure typed off a gov.uk forecast still meets the same 10-year cliff and 35-year cap the
	// recorded one does — and it replaces the *total*, which is why no further years are added to it.
	// The record itself is left as the stored one, so "is there an NI record?" keeps its real answer.
	const outlook = statePensionOutlook(pensions, profile, {
		now: options.now,
		withdrawalRate: input.withdrawalRate
	});
	const statePension =
		input.statePensionYears === null
			? outlook
			: {
					...outlook,
					projection: statePensionProjection({
						qualifyingYears: input.statePensionYears,
						futureYears: 0,
						withdrawalRate: input.withdrawalRate
					}),
					unearnableYears: 0
				};
	const statePensionIncome = input.includeStatePension ? statePension.projection.annualIncome : 0;

	/* --- the streams --------------------------------------------------------- */

	const streams = [
		buildStream({
			id: 'db',
			source: 'pensions',
			sourceCount: db.count,
			taxTreatment: 'earned_income',
			annualIncome: db.annualIncome,
			rate: null
		}),
		buildStream({
			id: 'annuity',
			source: 'pensions',
			sourceCount: dcPots.length,
			taxTreatment: 'earned_income',
			capital: annuitisedPot,
			rate: input.annuityRate,
			annualIncome: sustainableIncome(annuitisedPot, input.annuityRate),
			taxFreeShare: PENSION_TAX_FREE_SHARE
		}),
		buildStream({
			id: 'sipp_drawdown',
			source: 'pensions',
			sourceCount: dcPots.length,
			taxTreatment: 'earned_income',
			capital: drawdownPot,
			rate: input.withdrawalRate,
			annualIncome: sustainableIncome(drawdownPot, input.withdrawalRate),
			taxFreeShare: PENSION_TAX_FREE_SHARE
		}),
		buildStream({
			id: 'isa_withdrawal',
			source: 'monthly_entries',
			sourceCount: isa.count,
			taxTreatment: 'tax_free',
			capital: isa.value,
			rate: input.withdrawalRate,
			annualIncome: sustainableIncome(isa.value, input.withdrawalRate),
			taxFreeShare: 100
		}),
		buildStream({
			id: 'gia_dividends',
			source: 'dividends',
			sourceCount: gia.count,
			taxTreatment: 'dividend',
			capital: gia.value,
			rate: gia.value === 0 ? null : roundMoney((gia.income / gia.value) * 100),
			annualIncome: gia.income
		}),
		buildStream({
			id: 'state_pension',
			source: 'ni_record',
			sourceCount: outlook.record === null ? 0 : 1,
			taxTreatment: 'earned_income',
			annualIncome: statePensionIncome,
			rate: null
		})
	];

	/* --- the totals ---------------------------------------------------------- */

	const annualIncome = roundMoney(
		streams.reduce((total, stream) => total + stream.annualIncome, 0)
	);
	for (const stream of streams) {
		stream.share = annualIncome === 0 ? 0 : stream.annualIncome / annualIncome;
	}

	/** @param {RetirementIncomeTaxTreatment} treatment */
	const taxableUnder = (treatment) =>
		roundMoney(
			streams
				.filter((stream) => stream.taxTreatment === treatment)
				.reduce((total, stream) => total + stream.taxableIncome, 0)
		);

	const taxFreeIncome = roundMoney(
		streams.reduce((total, stream) => total + stream.taxFreeIncome, 0)
	);
	const earnedIncome = taxableUnder('earned_income');
	const dividendIncome = taxableUnder('dividend');

	const tax = retirementIncomeTax({ earnedIncome, dividendIncome, region: input.taxRegion });
	const netAnnualIncome = roundMoney(annualIncome - tax.totalTax);

	// A promise is worth whatever pot would buy the same income at the same rate — `fire.js`'s own
	// `fireNumber`, which is what both `defined-benefit.js` and `state-pension.js` already use, so the
	// two comparison figures add up rather than being computed two different ways.
	const promisedCapitalEquivalent = roundMoney(
		db.capitalEquivalent +
			(input.includeStatePension ? statePension.projection.capitalEquivalent : 0)
	);

	return {
		input,
		streams,
		annualIncome,
		monthlyIncome: roundMoney(annualIncome / 12),
		taxFreeIncome,
		earnedIncome,
		dividendIncome,
		tax,
		totalTax: tax.totalTax,
		netAnnualIncome,
		netMonthlyIncome: roundMoney(netAnnualIncome / 12),
		effectiveTaxRate: annualIncome === 0 ? 0 : (tax.totalTax / annualIncome) * 100,
		statePension,
		statePensionYears: statePension.projection.totalYears,
		statePensionRecorded: outlook.projection.recorded,
		totalCapital: roundMoney(streams.reduce((total, stream) => total + stream.capital, 0)),
		promisedCapitalEquivalent,
		targetIncome: input.targetIncome,
		targetGap: roundMoney(Math.max(0, input.targetIncome - netAnnualIncome)),
		targetSurplus: roundMoney(Math.max(0, netAnnualIncome - input.targetIncome)),
		targetShare: input.targetIncome === 0 ? 1 : netAnnualIncome / input.targetIncome,
		coversTarget: netAnnualIncome >= input.targetIncome,
		uncounted: uncountedCapital(investments, dividends)
	};
}
