/**
 * Enumerated value sets for the core data model.
 *
 * Every enum is a frozen array of stable snake_case codes (the values persisted to the Gist)
 * plus a `*_LABELS` map giving the human-readable text from README.md's functional spec.
 * Persist the code, render the label — that way UI copy can change without a data migration.
 *
 * See `./types.js` for the record shapes these values are used in.
 */

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where the user is in their wealth-building journey. README.md names `journey_stage` but
 * does not enumerate its values; these five stages are ours (see docs note in the PR).
 * @typedef {'starting_out' | 'building' | 'consolidating' | 'pre_retirement' | 'retired'} JourneyStage
 */

/** @type {readonly JourneyStage[]} */
export const JOURNEY_STAGES = Object.freeze([
	'starting_out',
	'building',
	'consolidating',
	'pre_retirement',
	'retired'
]);

/** @type {Record<JourneyStage, string>} */
export const JOURNEY_STAGE_LABELS = Object.freeze({
	starting_out: 'Starting out',
	building: 'Building',
	consolidating: 'Consolidating',
	pre_retirement: 'Approaching retirement',
	retired: 'Retired'
});

/**
 * Income tax regime. Scotland has its own bands; England, Wales and Northern Ireland share one.
 * @typedef {'england_wales_ni' | 'scotland'} TaxRegion
 */

/** @type {readonly TaxRegion[]} */
export const TAX_REGIONS = Object.freeze(['england_wales_ni', 'scotland']);

/** @type {Record<TaxRegion, string>} */
export const TAX_REGION_LABELS = Object.freeze({
	england_wales_ni: 'England, Wales & Northern Ireland',
	scotland: 'Scotland'
});

/* -------------------------------------------------------------------------- */
/* Investments and debts                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Investment holding type (README.md → "Investment types").
 * @typedef {'stocks_isa' | 'sipp' | 'shares' | 'crypto' | 'cash' | 'emergency_fund' | 'dividends' | 'property'} InvestmentType
 */

/** @type {readonly InvestmentType[]} */
export const INVESTMENT_TYPES = Object.freeze([
	'stocks_isa',
	'sipp',
	'shares',
	'crypto',
	'cash',
	'emergency_fund',
	'dividends',
	'property'
]);

/** @type {Record<InvestmentType, string>} */
export const INVESTMENT_TYPE_LABELS = Object.freeze({
	stocks_isa: 'Stocks ISA',
	sipp: 'SIPP',
	shares: 'Shares',
	crypto: 'Crypto',
	cash: 'Cash',
	emergency_fund: 'Emergency Fund',
	dividends: 'Dividends',
	property: 'Property'
});

/**
 * Investment types that count as cash for the emergency fund tracker
 * ("cash investment accounts counted automatically by type tag").
 * @type {readonly InvestmentType[]}
 */
export const CASH_INVESTMENT_TYPES = Object.freeze(['cash', 'emergency_fund']);

/**
 * Account wrapper a holding sits in. The first six are the UK ISA wrappers tracked by the ISA
 * allowance tracker; `sipp` and `workplace_pension` are tax-relieved pension wrappers; `gia` is
 * an unwrapped general investment account (taxable); `none` covers anything unwrapped and
 * untaxed by these rules (e.g. crypto held directly, physical assets).
 * @typedef {'isa_stocks_shares' | 'isa_cash' | 'lisa' | 'jisa' | 'ifisa' | 'htb_isa' | 'sipp' | 'workplace_pension' | 'gia' | 'none'} Wrapper
 */

/** @type {readonly Wrapper[]} */
export const WRAPPERS = Object.freeze([
	'isa_stocks_shares',
	'isa_cash',
	'lisa',
	'jisa',
	'ifisa',
	'htb_isa',
	'sipp',
	'workplace_pension',
	'gia',
	'none'
]);

/** @type {Record<Wrapper, string>} */
export const WRAPPER_LABELS = Object.freeze({
	isa_stocks_shares: 'Stocks & Shares ISA',
	isa_cash: 'Cash ISA',
	lisa: 'Lifetime ISA',
	jisa: 'Junior ISA',
	ifisa: 'Innovative Finance ISA',
	htb_isa: 'Help to Buy ISA',
	sipp: 'SIPP',
	workplace_pension: 'Workplace pension',
	gia: 'General Investment Account',
	none: 'Unwrapped'
});

/**
 * The six ISA wrappers, in the order the ISA allowance tracker lists them.
 * @type {readonly Wrapper[]}
 */
export const ISA_WRAPPERS = Object.freeze([
	'isa_stocks_shares',
	'isa_cash',
	'lisa',
	'jisa',
	'ifisa',
	'htb_isa'
]);

/**
 * Wrappers that shelter income and gains from UK tax entirely — used by the dividend planner
 * ("ISA/SIPP fully sheltered") and by future tax logic.
 * @type {readonly Wrapper[]}
 */
export const TAX_SHELTERED_WRAPPERS = Object.freeze([
	'isa_stocks_shares',
	'isa_cash',
	'lisa',
	'jisa',
	'ifisa',
	'htb_isa',
	'sipp',
	'workplace_pension'
]);

/**
 * Debt category. README.md does not enumerate debt types; these cover the UK household debts
 * the D/I ratio and the mortgage toggle need to distinguish.
 * @typedef {'mortgage' | 'credit_card' | 'loan' | 'car_finance' | 'student_loan' | 'overdraft' | 'other'} DebtType
 */

/** @type {readonly DebtType[]} */
export const DEBT_TYPES = Object.freeze([
	'mortgage',
	'credit_card',
	'loan',
	'car_finance',
	'student_loan',
	'overdraft',
	'other'
]);

/** @type {Record<DebtType, string>} */
export const DEBT_TYPE_LABELS = Object.freeze({
	mortgage: 'Mortgage',
	credit_card: 'Credit card',
	loan: 'Personal loan',
	car_finance: 'Car finance',
	student_loan: 'Student loan',
	overdraft: 'Overdraft',
	other: 'Other'
});

/* -------------------------------------------------------------------------- */
/* Frequencies                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How often money is paid into a holding.
 * @typedef {'monthly' | 'quarterly' | 'annually' | 'one_off'} ContributionFrequency
 */

/** @type {readonly ContributionFrequency[]} */
export const CONTRIBUTION_FREQUENCIES = Object.freeze([
	'monthly',
	'quarterly',
	'annually',
	'one_off'
]);

/** @type {Record<ContributionFrequency, string>} */
export const CONTRIBUTION_FREQUENCY_LABELS = Object.freeze({
	monthly: 'Monthly',
	quarterly: 'Quarterly',
	annually: 'Annually',
	one_off: 'One-off'
});

/**
 * How often a holding pays out (dividend planner).
 * @typedef {'monthly' | 'quarterly' | 'semi_annually' | 'annually'} PayoutFrequency
 */

/** @type {readonly PayoutFrequency[]} */
export const PAYOUT_FREQUENCIES = Object.freeze([
	'monthly',
	'quarterly',
	'semi_annually',
	'annually'
]);

/** @type {Record<PayoutFrequency, string>} */
export const PAYOUT_FREQUENCY_LABELS = Object.freeze({
	monthly: 'Monthly',
	quarterly: 'Quarterly',
	semi_annually: 'Semi-annually',
	annually: 'Annually'
});

/**
 * How often a bill falls due (budget tab).
 * @typedef {'weekly' | 'monthly' | 'quarterly' | 'annually'} BillFrequency
 */

/** @type {readonly BillFrequency[]} */
export const BILL_FREQUENCIES = Object.freeze(['weekly', 'monthly', 'quarterly', 'annually']);

/** @type {Record<BillFrequency, string>} */
export const BILL_FREQUENCY_LABELS = Object.freeze({
	weekly: 'Weekly',
	monthly: 'Monthly',
	quarterly: 'Quarterly',
	annually: 'Annually'
});

/** Number of payments per year for each frequency — the shared basis for annualising amounts. */
export const PAYMENTS_PER_YEAR = Object.freeze({
	weekly: 52,
	monthly: 12,
	quarterly: 4,
	semi_annually: 2,
	annually: 1,
	one_off: 0
});

/* -------------------------------------------------------------------------- */
/* Pensions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Pension pot type (README.md → "Pension Tracker"). Defined Benefit is split into its two UK
 * flavours because they accrue differently (final salary vs career average revalued earnings).
 * `state` is included so the State Pension can sit alongside private pots in the retirement
 * income stream builder.
 * @typedef {'dc_workplace' | 'sipp' | 'db_final_salary' | 'db_care' | 'lisa' | 'state'} PensionType
 */

/** @type {readonly PensionType[]} */
export const PENSION_TYPES = Object.freeze([
	'dc_workplace',
	'sipp',
	'db_final_salary',
	'db_care',
	'lisa',
	'state'
]);

/** @type {Record<PensionType, string>} */
export const PENSION_TYPE_LABELS = Object.freeze({
	dc_workplace: 'DC Workplace',
	sipp: 'SIPP',
	db_final_salary: 'Defined Benefit (Final Salary)',
	db_care: 'Defined Benefit (CARE)',
	lisa: 'Lifetime ISA',
	state: 'State Pension'
});

/**
 * Pension types whose income comes from an accrual formula rather than a pot value — these are
 * the pots for which the `db_*` fields apply.
 * @type {readonly PensionType[]}
 */
export const DEFINED_BENEFIT_PENSION_TYPES = Object.freeze(['db_final_salary', 'db_care']);

/* -------------------------------------------------------------------------- */
/* Property                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Property type (README.md → "Property Tracker").
 * @typedef {'primary_residence' | 'buy_to_let' | 'holiday_home'} PropertyType
 */

/** @type {readonly PropertyType[]} */
export const PROPERTY_TYPES = Object.freeze(['primary_residence', 'buy_to_let', 'holiday_home']);

/** @type {Record<PropertyType, string>} */
export const PROPERTY_TYPE_LABELS = Object.freeze({
	primary_residence: 'Primary residence',
	buy_to_let: 'Buy to let',
	holiday_home: 'Holiday home'
});

/**
 * Mortgage product type.
 * @typedef {'fixed' | 'tracker' | 'svr' | 'none'} MortgageType
 */

/** @type {readonly MortgageType[]} */
export const MORTGAGE_TYPES = Object.freeze(['fixed', 'tracker', 'svr', 'none']);

/** @type {Record<MortgageType, string>} */
export const MORTGAGE_TYPE_LABELS = Object.freeze({
	fixed: 'Fixed',
	tracker: 'Tracker',
	svr: 'Standard variable rate',
	none: 'No mortgage'
});

/* -------------------------------------------------------------------------- */
/* Physical assets                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Physical asset category (README.md → "Physical Assets Tracker").
 * @typedef {'watches_jewellery' | 'art_collectables' | 'classic_cars' | 'wine_whisky' | 'precious_metals' | 'other'} AssetCategory
 */

/** @type {readonly AssetCategory[]} */
export const ASSET_CATEGORIES = Object.freeze([
	'watches_jewellery',
	'art_collectables',
	'classic_cars',
	'wine_whisky',
	'precious_metals',
	'other'
]);

/** @type {Record<AssetCategory, string>} */
export const ASSET_CATEGORY_LABELS = Object.freeze({
	watches_jewellery: 'Watches & Jewellery',
	art_collectables: 'Art & Collectables',
	classic_cars: 'Classic/Collector Cars',
	wine_whisky: 'Wine & Whisky',
	precious_metals: 'Precious Metals',
	other: 'Other'
});

/* -------------------------------------------------------------------------- */
/* Dividends                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What happens to dividends when they are paid: reinvested (DRIP) or taken as income.
 * @typedef {'drip' | 'income'} DividendStrategy
 */

/** @type {readonly DividendStrategy[]} */
export const DIVIDEND_STRATEGIES = Object.freeze(['drip', 'income']);

/** @type {Record<DividendStrategy, string>} */
export const DIVIDEND_STRATEGY_LABELS = Object.freeze({
	drip: 'Reinvest (DRIP)',
	income: 'Take as income'
});

/* -------------------------------------------------------------------------- */
/* Milestones                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether a milestone is one of the built-in net worth targets or user-defined.
 * @typedef {'standard' | 'custom'} MilestoneType
 */

/** @type {readonly MilestoneType[]} */
export const MILESTONE_TYPES = Object.freeze(['standard', 'custom']);

/** @type {Record<MilestoneType, string>} */
export const MILESTONE_TYPE_LABELS = Object.freeze({
	standard: 'Standard',
	custom: 'Custom'
});

/** Built-in net worth milestones, in pounds (README.md → "Milestones"). */
export const STANDARD_MILESTONE_TARGETS = Object.freeze([
	10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000
]);

/* -------------------------------------------------------------------------- */
/* Currency                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reporting currency. Only GBP is supported today — the field exists because README.md's model
 * lists it, and an ISO 4217 code keeps the door open without a schema change.
 * @typedef {'GBP'} Currency
 */

/** @type {readonly Currency[]} */
export const CURRENCIES = Object.freeze(['GBP']);
