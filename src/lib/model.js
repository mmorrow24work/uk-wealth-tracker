/**
 * Factories, normalisation and validation for the core data model.
 *
 * Two entry points matter to the rest of the app:
 *
 * - {@link normaliseAppData} turns arbitrary JSON (a Gist that was hand-edited, written by an
 *   older build, or simply empty) into a complete, well-typed {@link AppData}. It never throws
 *   and never returns a partial document — unknown fields are dropped, missing ones defaulted.
 * - {@link validateAppData} reports the problems normalisation deliberately cannot fix: values
 *   that are the right type but wrong (month 13, ownership of 140%, duplicate ids, a bill
 *   pointing at a category that no longer exists).
 *
 * Everything else here is a `create*` factory returning a fully populated record, so forms and
 * tests never have to spell out defaults.
 *
 * See `./types.js` for the shapes and the units convention.
 */

import {
	ASSET_CATEGORIES,
	BILL_FREQUENCIES,
	CONTRIBUTION_FREQUENCIES,
	CURRENCIES,
	DEBT_TYPES,
	DIVIDEND_STRATEGIES,
	INVESTMENT_TYPES,
	JOURNEY_STAGES,
	MILESTONE_TYPES,
	MORTGAGE_TYPES,
	PAYOUT_FREQUENCIES,
	PENSION_TYPES,
	PROPERTY_TYPES,
	STANDARD_MILESTONE_TARGETS,
	TAX_REGIONS,
	WRAPPERS
} from './enums.js';

/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./types.js').Asset} Asset */
/** @typedef {import('./types.js').Budget} Budget */
/** @typedef {import('./types.js').BudgetBill} BudgetBill */
/** @typedef {import('./types.js').BudgetCategory} BudgetCategory */
/** @typedef {import('./types.js').BudgetLineItem} BudgetLineItem */
/** @typedef {import('./types.js').Debt} Debt */
/** @typedef {import('./types.js').Dividend} Dividend */
/** @typedef {import('./types.js').Investment} Investment */
/** @typedef {import('./types.js').Milestone} Milestone */
/** @typedef {import('./types.js').MonthlyEntry} MonthlyEntry */
/** @typedef {import('./types.js').Pension} Pension */
/** @typedef {import('./types.js').Profile} Profile */
/** @typedef {import('./types.js').Property} Property */
/** @typedef {import('./types.js').ValidationError} ValidationError */
/** @typedef {import('./types.js').ValidationResult} ValidationResult */

/**
 * Version of the persisted document shape. Bump it whenever a change cannot be absorbed by
 * `normaliseAppData` alone, and add the corresponding step to `migrateAppData`.
 */
export const SCHEMA_VERSION = 1;

/** Earliest year we accept anywhere — anything older is a typo, not history. */
const MIN_YEAR = 1900;
/** Latest year we accept. Generous: mortgage deals and projections run decades out. */
const MAX_YEAR = 2200;

/* -------------------------------------------------------------------------- */
/* Ids                                                                         */
/* -------------------------------------------------------------------------- */

let idCounter = 0;

/**
 * Generate an id that is unique within this document. Uses `crypto.randomUUID` where available
 * (browsers on a secure origin, Node 19+) and falls back to a time-plus-counter string so the
 * function works in any context — ids are opaque, so the two forms can coexist in one document.
 *
 * @param {string} [prefix] Short tag identifying the record kind, e.g. `inv`.
 * @returns {string}
 */
export function createId(prefix = 'id') {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (uuid) return `${prefix}_${uuid}`;

	idCounter += 1;
	return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Coercion helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? /** @type {Record<string, unknown>} */ (value)
		: {};
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function asArray(value) {
	return Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function asString(value, fallback = '') {
	return typeof value === 'string' ? value : fallback;
}

/**
 * Coerce to a finite number. Numeric strings are accepted because form inputs and hand-edited
 * JSON routinely carry `"1200"` rather than `1200`.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function asNumber(value, fallback) {
	if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

/**
 * As {@link asNumber}, but `null`/`undefined`/unparseable means "not recorded".
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function asNullableNumber(value) {
	if (value === null || value === undefined || value === '') return null;
	const parsed = asNumber(value, Number.NaN);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function asBoolean(value, fallback) {
	return typeof value === 'boolean' ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {string | null} An ISO `YYYY-MM-DD` date, or null if it is not one.
 */
function asIsoDate(value) {
	return typeof value === 'string' && isIsoDate(value) ? value : null;
}

/**
 * @template T
 * @param {unknown} value
 * @param {readonly T[]} allowed
 * @param {T} fallback
 * @returns {T}
 */
function asOneOf(value, allowed, fallback) {
	return allowed.includes(/** @type {T} */ (value)) ? /** @type {T} */ (value) : fallback;
}

/**
 * @param {unknown} value
 * @param {string} prefix
 * @returns {string}
 */
function asId(value, prefix) {
	return typeof value === 'string' && value !== '' ? value : createId(prefix);
}

/* -------------------------------------------------------------------------- */
/* Defaults and factories                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Planning defaults: 5% nominal growth and 2.5% inflation are mid-range long-run assumptions,
 * and 67 is State Pension age for anyone born after April 1978. All three are starting points
 * the user is expected to override on the forecast tab.
 *
 * @type {Profile}
 */
const DEFAULT_PROFILE = Object.freeze({
	name: '',
	dob_month: null,
	dob_year: null,
	journey_stage: 'building',
	monthly_contribution: 0,
	growth_rate: 5,
	retirement_age: 67,
	retirement_target: 0,
	inflation_rate: 2.5,
	currency: 'GBP',
	tax_region: 'england_wales_ni',
	gross_salary: 0,
	pension_pct: 0
});

/**
 * @param {Partial<Profile>} [overrides]
 * @returns {Profile}
 */
export function createProfile(overrides = {}) {
	return { ...DEFAULT_PROFILE, ...overrides };
}

/**
 * @param {Partial<Investment>} [overrides]
 * @returns {Investment}
 */
export function createInvestment(overrides = {}) {
	return {
		id: createId('inv'),
		name: '',
		type: 'shares',
		wrapper: 'gia',
		value: 0,
		bought_for: null,
		year_purchased: null,
		monthly_contribution: 0,
		contribution_frequency: 'monthly',
		fund_fee: 0,
		notes: '',
		exclude_from_net_worth: false,
		ownership_pct: 100,
		...overrides
	};
}

/**
 * @param {Partial<Debt>} [overrides]
 * @returns {Debt}
 */
export function createDebt(overrides = {}) {
	return {
		id: createId('debt'),
		name: '',
		type: 'other',
		balance: 0,
		notes: '',
		exclude_from_net_worth: false,
		...overrides
	};
}

/**
 * @param {Partial<MonthlyEntry>} [overrides]
 * @returns {MonthlyEntry}
 */
export function createMonthlyEntry(overrides = {}) {
	return {
		id: createId('entry'),
		month: 1,
		year: MIN_YEAR,
		investments: [],
		debts: [],
		...overrides
	};
}

/**
 * @param {Partial<Pension>} [overrides]
 * @returns {Pension}
 */
export function createPension(overrides = {}) {
	return {
		id: createId('pen'),
		name: '',
		type: 'dc_workplace',
		value: 0,
		contribution_pct: 0,
		employer_pct: 0,
		fund_fee: 0,
		db_accrual_rate: null,
		db_years: null,
		db_salary: null,
		db_annual_income: null,
		ni_qualifying_years: null,
		ni_future_years: null,
		...overrides
	};
}

/**
 * @param {Partial<Property>} [overrides]
 * @returns {Property}
 */
export function createProperty(overrides = {}) {
	return {
		id: createId('prop'),
		name: '',
		type: 'primary_residence',
		value: 0,
		mortgage_balance: 0,
		monthly_payment: 0,
		interest_rate: 0,
		mortgage_type: 'fixed',
		deal_expiry: null,
		rental_income: 0,
		running_costs: 0,
		growth_rate: 3,
		include_in_net_worth: true,
		...overrides
	};
}

/**
 * @param {Partial<Asset>} [overrides]
 * @returns {Asset}
 */
export function createAsset(overrides = {}) {
	return {
		id: createId('asset'),
		name: '',
		category: 'other',
		purchase_price: 0,
		current_value: 0,
		purchase_date: null,
		expected_growth: 0,
		holding_cost: 0,
		include_in_net_worth: true,
		...overrides
	};
}

/**
 * @param {Partial<Dividend>} [overrides]
 * @returns {Dividend}
 */
export function createDividend(overrides = {}) {
	return {
		id: createId('div'),
		name: '',
		wrapper: 'gia',
		value: 0,
		yield_pct: 0,
		monthly_contribution: 0,
		frequency: 'quarterly',
		strategy: 'drip',
		notes: '',
		...overrides
	};
}

/**
 * @param {Partial<Milestone>} [overrides]
 * @returns {Milestone}
 */
export function createMilestone(overrides = {}) {
	return {
		id: createId('ms'),
		label: '',
		target: 0,
		current: 0,
		type: 'custom',
		...overrides
	};
}

/**
 * @param {Partial<BudgetCategory>} [overrides]
 * @returns {BudgetCategory}
 */
export function createBudgetCategory(overrides = {}) {
	return { id: createId('cat'), name: '', monthly_amount: 0, ons_benchmark: null, ...overrides };
}

/**
 * @param {Partial<BudgetBill>} [overrides]
 * @returns {BudgetBill}
 */
export function createBudgetBill(overrides = {}) {
	return {
		id: createId('bill'),
		name: '',
		amount: 0,
		frequency: 'monthly',
		due_day: null,
		category_id: null,
		notes: '',
		...overrides
	};
}

/**
 * @param {Partial<BudgetLineItem>} [overrides]
 * @returns {BudgetLineItem}
 */
export function createBudgetLineItem(overrides = {}) {
	return { id: createId('line'), name: '', amount: 0, category_id: null, notes: '', ...overrides };
}

/**
 * @param {Partial<Budget>} [overrides]
 * @returns {Budget}
 */
export function createBudget(overrides = {}) {
	return { categories: [], bills: [], line_items: [], ...overrides };
}

/**
 * Format a standard milestone target the way the chart pills label them: £10k … £1M.
 *
 * @param {number} target
 * @returns {string}
 */
function milestoneLabel(target) {
	return target >= 1_000_000 ? `£${target / 1_000_000}M` : `£${target / 1_000}k`;
}

/**
 * The seven built-in net worth milestones, ready to store.
 *
 * @returns {Milestone[]}
 */
export function createStandardMilestones() {
	return STANDARD_MILESTONE_TARGETS.map((target) =>
		createMilestone({ label: milestoneLabel(target), target, type: 'standard' })
	);
}

/**
 * A complete, empty document — what a brand new Gist gets seeded with.
 *
 * @param {Partial<AppData>} [overrides]
 * @returns {AppData}
 */
export function createAppData(overrides = {}) {
	return {
		schema_version: SCHEMA_VERSION,
		profile: createProfile(),
		monthly_entries: [],
		pensions: [],
		properties: [],
		assets: [],
		dividends: [],
		milestones: createStandardMilestones(),
		budget: createBudget(),
		...overrides
	};
}

/* -------------------------------------------------------------------------- */
/* Monthly entry helpers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Sortable `YYYY-MM` key for a snapshot. One entry per calendar month is the rule, so this also
 * doubles as the entry's natural identity.
 *
 * @param {Pick<MonthlyEntry, 'month' | 'year'>} entry
 * @returns {string}
 */
export function monthlyEntryKey(entry) {
	return `${String(entry.year).padStart(4, '0')}-${String(entry.month).padStart(2, '0')}`;
}

/**
 * Comparator putting the oldest snapshot first — the order charts and month-on-month diffs want.
 *
 * @param {Pick<MonthlyEntry, 'month' | 'year'>} a
 * @param {Pick<MonthlyEntry, 'month' | 'year'>} b
 * @returns {number}
 */
export function compareMonthlyEntries(a, b) {
	return monthlyEntryKey(a).localeCompare(monthlyEntryKey(b));
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * @param {unknown} raw
 * @returns {Profile}
 */
function normaliseProfile(raw) {
	const source = asRecord(raw);
	return {
		name: asString(source.name),
		dob_month: asNullableNumber(source.dob_month),
		dob_year: asNullableNumber(source.dob_year),
		journey_stage: asOneOf(source.journey_stage, JOURNEY_STAGES, DEFAULT_PROFILE.journey_stage),
		monthly_contribution: asNumber(source.monthly_contribution, 0),
		growth_rate: asNumber(source.growth_rate, DEFAULT_PROFILE.growth_rate),
		retirement_age: asNumber(source.retirement_age, DEFAULT_PROFILE.retirement_age),
		retirement_target: asNumber(source.retirement_target, 0),
		inflation_rate: asNumber(source.inflation_rate, DEFAULT_PROFILE.inflation_rate),
		currency: asOneOf(source.currency, CURRENCIES, 'GBP'),
		tax_region: asOneOf(source.tax_region, TAX_REGIONS, DEFAULT_PROFILE.tax_region),
		gross_salary: asNumber(source.gross_salary, 0),
		pension_pct: asNumber(source.pension_pct, 0)
	};
}

/**
 * @param {unknown} raw
 * @returns {Investment}
 */
function normaliseInvestment(raw) {
	const source = asRecord(raw);
	return {
		id: asId(source.id, 'inv'),
		name: asString(source.name),
		type: asOneOf(source.type, INVESTMENT_TYPES, 'shares'),
		wrapper: asOneOf(source.wrapper, WRAPPERS, 'gia'),
		value: asNumber(source.value, 0),
		bought_for: asNullableNumber(source.bought_for),
		year_purchased: asNullableNumber(source.year_purchased),
		monthly_contribution: asNumber(source.monthly_contribution, 0),
		contribution_frequency: asOneOf(
			source.contribution_frequency,
			CONTRIBUTION_FREQUENCIES,
			'monthly'
		),
		fund_fee: asNumber(source.fund_fee, 0),
		notes: asString(source.notes),
		exclude_from_net_worth: asBoolean(source.exclude_from_net_worth, false),
		ownership_pct: asNumber(source.ownership_pct, 100)
	};
}

/**
 * @param {unknown} raw
 * @returns {Debt}
 */
function normaliseDebt(raw) {
	const source = asRecord(raw);
	return {
		id: asId(source.id, 'debt'),
		name: asString(source.name),
		type: asOneOf(source.type, DEBT_TYPES, 'other'),
		balance: asNumber(source.balance, 0),
		notes: asString(source.notes),
		exclude_from_net_worth: asBoolean(source.exclude_from_net_worth, false)
	};
}

/**
 * @param {unknown} raw
 * @returns {MonthlyEntry}
 */
function normaliseMonthlyEntry(raw) {
	const source = asRecord(raw);
	return {
		id: asId(source.id, 'entry'),
		month: asNumber(source.month, 1),
		year: asNumber(source.year, MIN_YEAR),
		investments: asArray(source.investments).map(normaliseInvestment),
		debts: asArray(source.debts).map(normaliseDebt)
	};
}

/**
 * @param {unknown} raw
 * @returns {Pension}
 */
function normalisePension(raw) {
	const source = asRecord(raw);
	return {
		id: asId(source.id, 'pen'),
		name: asString(source.name),
		type: asOneOf(source.type, PENSION_TYPES, 'dc_workplace'),
		value: asNumber(source.value, 0),
		contribution_pct: asNumber(source.contribution_pct, 0),
		employer_pct: asNumber(source.employer_pct, 0),
		fund_fee: asNumber(source.fund_fee, 0),
		db_accrual_rate: asNullableNumber(source.db_accrual_rate),
		db_years: asNullableNumber(source.db_years),
		db_salary: asNullableNumber(source.db_salary),
		db_annual_income: asNullableNumber(source.db_annual_income),
		ni_qualifying_years: asNullableNumber(source.ni_qualifying_years),
		ni_future_years: asNullableNumber(source.ni_future_years)
	};
}

/**
 * @param {unknown} raw
 * @returns {Property}
 */
function normaliseProperty(raw) {
	const source = asRecord(raw);
	return {
		id: asId(source.id, 'prop'),
		name: asString(source.name),
		type: asOneOf(source.type, PROPERTY_TYPES, 'primary_residence'),
		value: asNumber(source.value, 0),
		mortgage_balance: asNumber(source.mortgage_balance, 0),
		monthly_payment: asNumber(source.monthly_payment, 0),
		interest_rate: asNumber(source.interest_rate, 0),
		mortgage_type: asOneOf(source.mortgage_type, MORTGAGE_TYPES, 'fixed'),
		deal_expiry: asIsoDate(source.deal_expiry),
		rental_income: asNumber(source.rental_income, 0),
		running_costs: asNumber(source.running_costs, 0),
		growth_rate: asNumber(source.growth_rate, 3),
		include_in_net_worth: asBoolean(source.include_in_net_worth, true)
	};
}

/**
 * @param {unknown} raw
 * @returns {Asset}
 */
function normaliseAsset(raw) {
	const source = asRecord(raw);
	return {
		id: asId(source.id, 'asset'),
		name: asString(source.name),
		category: asOneOf(source.category, ASSET_CATEGORIES, 'other'),
		purchase_price: asNumber(source.purchase_price, 0),
		current_value: asNumber(source.current_value, 0),
		purchase_date: asIsoDate(source.purchase_date),
		expected_growth: asNumber(source.expected_growth, 0),
		holding_cost: asNumber(source.holding_cost, 0),
		include_in_net_worth: asBoolean(source.include_in_net_worth, true)
	};
}

/**
 * @param {unknown} raw
 * @returns {Dividend}
 */
function normaliseDividend(raw) {
	const source = asRecord(raw);
	return {
		id: asId(source.id, 'div'),
		name: asString(source.name),
		wrapper: asOneOf(source.wrapper, WRAPPERS, 'gia'),
		value: asNumber(source.value, 0),
		yield_pct: asNumber(source.yield_pct, 0),
		monthly_contribution: asNumber(source.monthly_contribution, 0),
		frequency: asOneOf(source.frequency, PAYOUT_FREQUENCIES, 'quarterly'),
		strategy: asOneOf(source.strategy, DIVIDEND_STRATEGIES, 'drip'),
		notes: asString(source.notes)
	};
}

/**
 * @param {unknown} raw
 * @returns {Milestone}
 */
function normaliseMilestone(raw) {
	const source = asRecord(raw);
	return {
		id: asId(source.id, 'ms'),
		label: asString(source.label),
		target: asNumber(source.target, 0),
		current: asNumber(source.current, 0),
		type: asOneOf(source.type, MILESTONE_TYPES, 'custom')
	};
}

/**
 * @param {unknown} raw
 * @returns {BudgetCategory}
 */
function normaliseBudgetCategory(raw) {
	const source = asRecord(raw);
	return {
		id: asId(source.id, 'cat'),
		name: asString(source.name),
		monthly_amount: asNumber(source.monthly_amount, 0),
		ons_benchmark: asNullableNumber(source.ons_benchmark)
	};
}

/**
 * @param {unknown} raw
 * @returns {BudgetBill}
 */
function normaliseBudgetBill(raw) {
	const source = asRecord(raw);
	return {
		id: asId(source.id, 'bill'),
		name: asString(source.name),
		amount: asNumber(source.amount, 0),
		frequency: asOneOf(source.frequency, BILL_FREQUENCIES, 'monthly'),
		due_day: asNullableNumber(source.due_day),
		category_id: typeof source.category_id === 'string' ? source.category_id : null,
		notes: asString(source.notes)
	};
}

/**
 * @param {unknown} raw
 * @returns {BudgetLineItem}
 */
function normaliseBudgetLineItem(raw) {
	const source = asRecord(raw);
	return {
		id: asId(source.id, 'line'),
		name: asString(source.name),
		amount: asNumber(source.amount, 0),
		category_id: typeof source.category_id === 'string' ? source.category_id : null,
		notes: asString(source.notes)
	};
}

/**
 * README.md's outline writes the budget as `budget[]`; we store an object. Accept either, so a
 * document written against the literal outline still loads.
 *
 * @param {unknown} raw
 * @returns {Budget}
 */
function normaliseBudget(raw) {
	const source = asRecord(Array.isArray(raw) ? raw[0] : raw);
	return {
		categories: asArray(source.categories).map(normaliseBudgetCategory),
		bills: asArray(source.bills).map(normaliseBudgetBill),
		line_items: asArray(source.line_items).map(normaliseBudgetLineItem)
	};
}

/**
 * Coerce arbitrary parsed JSON into a complete {@link AppData}. Missing collections become empty
 * arrays, missing fields take their defaults, unrecognised enum values fall back, and monthly
 * entries come back sorted oldest first. Unknown top-level keys are dropped, so a stray field
 * in the Gist cannot leak into the app's state.
 *
 * Never throws: a null, a string, or a deeply malformed object all yield a usable empty document.
 *
 * A document stamped with a *newer* schema version keeps that version rather than being quietly
 * relabelled — {@link validateAppData} then flags it, so a caller can refuse to overwrite a Gist
 * written by a build that knows more than this one does.
 *
 * @param {unknown} raw Parsed JSON — typically the Gist file contents.
 * @returns {AppData}
 */
export function normaliseAppData(raw) {
	const source = asRecord(raw);
	const storedVersion = asNullableNumber(source.schema_version);
	return {
		schema_version:
			storedVersion !== null && Number.isInteger(storedVersion) && storedVersion > SCHEMA_VERSION
				? storedVersion
				: SCHEMA_VERSION,
		profile: normaliseProfile(source.profile),
		monthly_entries: asArray(source.monthly_entries)
			.map(normaliseMonthlyEntry)
			.sort(compareMonthlyEntries),
		pensions: asArray(source.pensions).map(normalisePension),
		properties: asArray(source.properties).map(normaliseProperty),
		assets: asArray(source.assets).map(normaliseAsset),
		dividends: asArray(source.dividends).map(normaliseDividend),
		milestones: asArray(source.milestones).map(normaliseMilestone),
		budget: normaliseBudget(source.budget)
	};
}

/**
 * Upgrade a stored document to the current schema version. There is only one version so far, so
 * this is `normaliseAppData` — the seam exists so version 2 has an obvious home.
 *
 * @param {unknown} raw
 * @returns {AppData}
 */
export function migrateAppData(raw) {
	return normaliseAppData(raw);
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isIsoDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	// Round-tripping catches calendar-invalid dates like 2026-02-30, which `Date` rolls over.
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Collects validation errors. Each `check` records one error when its condition is false.
 *
 * @returns {{ errors: ValidationError[], check: (ok: boolean, path: string, message: string) => void }}
 */
function createCollector() {
	/** @type {ValidationError[]} */
	const errors = [];
	return {
		errors,
		check(ok, path, message) {
			if (!ok) errors.push({ path, message });
		}
	};
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {boolean}
 */
function inRange(value, min, max) {
	return Number.isFinite(value) && value >= min && value <= max;
}

/**
 * @param {number | null} value
 * @param {number} min
 * @param {number} max
 * @returns {boolean}
 */
function nullOrInRange(value, min, max) {
	return value === null || inRange(value, min, max);
}

/** Upper bound for money fields — high enough never to bite, low enough to catch a fat finger. */
const MAX_MONEY = 1e12;

/**
 * @param {number} value
 * @returns {boolean}
 */
function isMoney(value) {
	return inRange(value, 0, MAX_MONEY);
}

/**
 * Check a document for problems normalisation cannot fix: out-of-range numbers, duplicate ids and
 * dangling references. Pass it a normalised document — {@link normaliseAppData} guarantees the
 * types, this guarantees the values make sense.
 *
 * @param {AppData} data
 * @returns {ValidationResult}
 */
export function validateAppData(data) {
	const { errors, check } = createCollector();

	check(
		Number.isInteger(data.schema_version) && data.schema_version >= 1,
		'schema_version',
		'must be a positive integer'
	);
	check(
		data.schema_version <= SCHEMA_VERSION,
		'schema_version',
		`document is version ${data.schema_version}, this build understands up to ${SCHEMA_VERSION}`
	);

	validateProfile(data.profile, check);

	/** @type {Set<string>} */
	const monthKeys = new Set();
	data.monthly_entries.forEach((entry, index) => {
		const path = `monthly_entries[${index}]`;
		check(
			inRange(entry.month, 1, 12) && Number.isInteger(entry.month),
			`${path}.month`,
			'must be a whole number from 1 to 12'
		);
		check(
			inRange(entry.year, MIN_YEAR, MAX_YEAR) && Number.isInteger(entry.year),
			`${path}.year`,
			`must be a whole year between ${MIN_YEAR} and ${MAX_YEAR}`
		);

		const key = monthlyEntryKey(entry);
		check(!monthKeys.has(key), path, `duplicate snapshot for ${key} — one entry per month`);
		monthKeys.add(key);

		checkUniqueIds(entry.investments, `${path}.investments`, check);
		entry.investments.forEach((investment, i) => {
			const p = `${path}.investments[${i}]`;
			check(isMoney(investment.value), `${p}.value`, 'must be a non-negative amount');
			check(
				investment.bought_for === null || isMoney(investment.bought_for),
				`${p}.bought_for`,
				'must be a non-negative amount or null'
			);
			check(
				nullOrInRange(investment.year_purchased, MIN_YEAR, MAX_YEAR),
				`${p}.year_purchased`,
				`must be a year between ${MIN_YEAR} and ${MAX_YEAR} or null`
			);
			check(
				isMoney(investment.monthly_contribution),
				`${p}.monthly_contribution`,
				'must be a non-negative amount'
			);
			check(inRange(investment.fund_fee, 0, 100), `${p}.fund_fee`, 'must be 0–100%');
			check(inRange(investment.ownership_pct, 0, 100), `${p}.ownership_pct`, 'must be 0–100%');
		});

		checkUniqueIds(entry.debts, `${path}.debts`, check);
		entry.debts.forEach((debt, i) => {
			check(
				isMoney(debt.balance),
				`${path}.debts[${i}].balance`,
				'must be a non-negative amount — debts are stored unsigned'
			);
		});
	});

	checkUniqueIds(data.pensions, 'pensions', check);
	data.pensions.forEach((pension, index) => {
		const path = `pensions[${index}]`;
		check(isMoney(pension.value), `${path}.value`, 'must be a non-negative amount');
		check(inRange(pension.contribution_pct, 0, 100), `${path}.contribution_pct`, 'must be 0–100%');
		check(inRange(pension.employer_pct, 0, 100), `${path}.employer_pct`, 'must be 0–100%');
		check(inRange(pension.fund_fee, 0, 100), `${path}.fund_fee`, 'must be 0–100%');
		check(
			nullOrInRange(pension.db_accrual_rate, 0, 100),
			`${path}.db_accrual_rate`,
			'must be 0–100% of salary per year of service, or null'
		);
		check(
			nullOrInRange(pension.db_years, 0, 100),
			`${path}.db_years`,
			'must be 0–100 years or null'
		);
		check(
			pension.db_salary === null || isMoney(pension.db_salary),
			`${path}.db_salary`,
			'must be a non-negative amount or null'
		);
		check(
			pension.db_annual_income === null || isMoney(pension.db_annual_income),
			`${path}.db_annual_income`,
			'must be a non-negative amount or null'
		);
		check(
			nullOrInRange(pension.ni_qualifying_years, 0, 60),
			`${path}.ni_qualifying_years`,
			'must be 0–60 years or null'
		);
		check(
			nullOrInRange(pension.ni_future_years, 0, 60),
			`${path}.ni_future_years`,
			'must be 0–60 years or null'
		);
	});

	checkUniqueIds(data.properties, 'properties', check);
	data.properties.forEach((property, index) => {
		const path = `properties[${index}]`;
		check(isMoney(property.value), `${path}.value`, 'must be a non-negative amount');
		check(isMoney(property.mortgage_balance), `${path}.mortgage_balance`, 'must be non-negative');
		check(isMoney(property.monthly_payment), `${path}.monthly_payment`, 'must be non-negative');
		check(inRange(property.interest_rate, 0, 100), `${path}.interest_rate`, 'must be 0–100%');
		check(isMoney(property.rental_income), `${path}.rental_income`, 'must be non-negative');
		check(isMoney(property.running_costs), `${path}.running_costs`, 'must be non-negative');
		check(inRange(property.growth_rate, -100, 100), `${path}.growth_rate`, 'must be -100–100%');
		check(
			property.deal_expiry === null || isIsoDate(property.deal_expiry),
			`${path}.deal_expiry`,
			'must be an ISO YYYY-MM-DD date or null'
		);
	});

	checkUniqueIds(data.assets, 'assets', check);
	data.assets.forEach((asset, index) => {
		const path = `assets[${index}]`;
		check(isMoney(asset.purchase_price), `${path}.purchase_price`, 'must be non-negative');
		check(isMoney(asset.current_value), `${path}.current_value`, 'must be non-negative');
		check(isMoney(asset.holding_cost), `${path}.holding_cost`, 'must be non-negative');
		check(
			inRange(asset.expected_growth, -100, 100),
			`${path}.expected_growth`,
			'must be -100–100%'
		);
		check(
			asset.purchase_date === null || isIsoDate(asset.purchase_date),
			`${path}.purchase_date`,
			'must be an ISO YYYY-MM-DD date or null'
		);
	});

	checkUniqueIds(data.dividends, 'dividends', check);
	data.dividends.forEach((dividend, index) => {
		const path = `dividends[${index}]`;
		check(isMoney(dividend.value), `${path}.value`, 'must be a non-negative amount');
		check(inRange(dividend.yield_pct, 0, 100), `${path}.yield_pct`, 'must be 0–100%');
		check(
			isMoney(dividend.monthly_contribution),
			`${path}.monthly_contribution`,
			'must be non-negative'
		);
	});

	checkUniqueIds(data.milestones, 'milestones', check);
	data.milestones.forEach((milestone, index) => {
		const path = `milestones[${index}]`;
		check(isMoney(milestone.target), `${path}.target`, 'must be a non-negative amount');
		check(milestone.target > 0, `${path}.target`, 'must be greater than zero');
		check(Number.isFinite(milestone.current), `${path}.current`, 'must be a number');
	});

	validateBudget(data.budget, check);

	return { valid: errors.length === 0, errors };
}

/**
 * @param {Profile} profile
 * @param {(ok: boolean, path: string, message: string) => void} check
 */
function validateProfile(profile, check) {
	check(
		nullOrInRange(profile.dob_month, 1, 12),
		'profile.dob_month',
		'must be a month from 1 to 12, or null'
	);
	check(
		nullOrInRange(profile.dob_year, MIN_YEAR, MAX_YEAR),
		'profile.dob_year',
		`must be a year between ${MIN_YEAR} and ${MAX_YEAR}, or null`
	);
	check(
		isMoney(profile.monthly_contribution),
		'profile.monthly_contribution',
		'must be a non-negative amount'
	);
	check(inRange(profile.growth_rate, -100, 100), 'profile.growth_rate', 'must be -100–100%');
	check(inRange(profile.inflation_rate, -100, 100), 'profile.inflation_rate', 'must be -100–100%');
	check(inRange(profile.retirement_age, 16, 120), 'profile.retirement_age', 'must be 16–120');
	check(
		isMoney(profile.retirement_target),
		'profile.retirement_target',
		'must be a non-negative amount'
	);
	check(isMoney(profile.gross_salary), 'profile.gross_salary', 'must be a non-negative amount');
	check(inRange(profile.pension_pct, 0, 100), 'profile.pension_pct', 'must be 0–100%');
}

/**
 * @param {Budget} budget
 * @param {(ok: boolean, path: string, message: string) => void} check
 */
function validateBudget(budget, check) {
	checkUniqueIds(budget.categories, 'budget.categories', check);
	checkUniqueIds(budget.bills, 'budget.bills', check);
	checkUniqueIds(budget.line_items, 'budget.line_items', check);

	const categoryIds = new Set(budget.categories.map((category) => category.id));

	budget.categories.forEach((category, index) => {
		const path = `budget.categories[${index}]`;
		check(isMoney(category.monthly_amount), `${path}.monthly_amount`, 'must be non-negative');
		check(
			category.ons_benchmark === null || isMoney(category.ons_benchmark),
			`${path}.ons_benchmark`,
			'must be a non-negative amount or null'
		);
	});

	budget.bills.forEach((bill, index) => {
		const path = `budget.bills[${index}]`;
		check(isMoney(bill.amount), `${path}.amount`, 'must be a non-negative amount');
		check(nullOrInRange(bill.due_day, 1, 31), `${path}.due_day`, 'must be a day 1–31, or null');
		check(
			bill.category_id === null || categoryIds.has(bill.category_id),
			`${path}.category_id`,
			'refers to a budget category that does not exist'
		);
	});

	budget.line_items.forEach((item, index) => {
		const path = `budget.line_items[${index}]`;
		check(isMoney(item.amount), `${path}.amount`, 'must be a non-negative amount');
		check(
			item.category_id === null || categoryIds.has(item.category_id),
			`${path}.category_id`,
			'refers to a budget category that does not exist'
		);
	});
}

/**
 * @param {readonly { id: string }[]} records
 * @param {string} path
 * @param {(ok: boolean, path: string, message: string) => void} check
 */
function checkUniqueIds(records, path, check) {
	/** @type {Set<string>} */
	const seen = new Set();
	records.forEach((record, index) => {
		check(record.id !== '', `${path}[${index}].id`, 'must not be empty');
		check(!seen.has(record.id), `${path}[${index}].id`, `duplicate id "${record.id}"`);
		seen.add(record.id);
	});
}
