import { describe, expect, it } from 'vitest';

import { INVESTMENT_TYPES, WRAPPERS } from './enums.js';
import {
	SCHEMA_VERSION,
	compareMonthlyEntries,
	createAppData,
	createAsset,
	createBudget,
	createBudgetBill,
	createBudgetCategory,
	createBudgetLineItem,
	createDebt,
	createDividend,
	createId,
	createInvestment,
	createMilestone,
	createMonthlyEntry,
	createPension,
	createProfile,
	createProperty,
	createStandardMilestones,
	migrateAppData,
	monthlyEntryKey,
	normaliseAppData,
	validateAppData
} from './model.js';

/* -------------------------------------------------------------------------- */
/* Shape — these assertions are transcribed from README.md's "Data Model"       */
/* outline. If one fails, either the README changed or the model drifted.       */
/* -------------------------------------------------------------------------- */

describe('document shape matches README.md', () => {
	it('has the eight top-level sections plus a schema version', () => {
		expect(Object.keys(createAppData()).sort()).toEqual(
			[
				'schema_version',
				'profile',
				'monthly_entries',
				'pensions',
				'properties',
				'assets',
				'dividends',
				'milestones',
				'budget'
			].sort()
		);
	});

	/** @type {[string, Record<string, unknown>, string[]][]} */
	const shapes = [
		[
			'profile',
			createProfile(),
			[
				'name',
				'dob_month',
				'dob_year',
				'journey_stage',
				'monthly_contribution',
				'growth_rate',
				'retirement_age',
				'retirement_target',
				'inflation_rate',
				'currency',
				'tax_region',
				'gross_salary',
				'pension_pct'
			]
		],
		['monthly_entries[]', createMonthlyEntry(), ['id', 'month', 'year', 'investments', 'debts']],
		[
			'investments[]',
			createInvestment(),
			[
				'id',
				'name',
				'type',
				'wrapper',
				'value',
				'bought_for',
				'year_purchased',
				'monthly_contribution',
				'contribution_frequency',
				'fund_fee',
				'notes',
				'exclude_from_net_worth',
				'ownership_pct'
			]
		],
		['debts[]', createDebt(), ['id', 'name', 'type', 'balance', 'notes', 'exclude_from_net_worth']],
		[
			'pensions[]',
			createPension(),
			[
				'id',
				'name',
				'type',
				'value',
				'contribution_pct',
				'employer_pct',
				'fund_fee',
				'db_accrual_rate',
				'db_years',
				'db_salary',
				'db_annual_income',
				'ni_qualifying_years',
				'ni_future_years'
			]
		],
		[
			'properties[]',
			createProperty(),
			[
				'id',
				'name',
				'type',
				'value',
				'mortgage_balance',
				'monthly_payment',
				'interest_rate',
				'mortgage_type',
				'deal_expiry',
				'rental_income',
				'running_costs',
				'growth_rate',
				'include_in_net_worth'
			]
		],
		[
			'assets[]',
			createAsset(),
			[
				'id',
				'name',
				'category',
				'purchase_price',
				'current_value',
				'purchase_date',
				'expected_growth',
				'holding_cost',
				'include_in_net_worth'
			]
		],
		[
			'dividends[]',
			createDividend(),
			[
				'id',
				'name',
				'wrapper',
				'value',
				'yield_pct',
				'monthly_contribution',
				'frequency',
				'strategy',
				'notes'
			]
		],
		['milestones[]', createMilestone(), ['id', 'label', 'target', 'current', 'type']],
		['budget', createBudget(), ['categories', 'bills', 'line_items']]
	];

	it.each(shapes)('%s has exactly the documented fields', (_name, record, fields) => {
		expect(Object.keys(record).sort()).toEqual([...fields].sort());
	});

	it('seeds a new document with the seven standard milestones', () => {
		const milestones = createAppData().milestones;
		expect(milestones.map((milestone) => milestone.label)).toEqual([
			'£10k',
			'£25k',
			'£50k',
			'£100k',
			'£250k',
			'£500k',
			'£1M'
		]);
		expect(milestones.every((milestone) => milestone.type === 'standard')).toBe(true);
		expect(milestones.every((milestone) => milestone.current === 0)).toBe(true);
	});

	it('stamps the current schema version', () => {
		expect(createAppData().schema_version).toBe(SCHEMA_VERSION);
	});
});

/* -------------------------------------------------------------------------- */
/* Issue #9 — investment holding fields + account wrapper types                */
/*                                                                              */
/* Pins the issue's own acceptance criteria directly, independent of the       */
/* README-derived assertions above: "Per-holding fields: name, type, current   */
/* value, purchase price, year purchased, monthly contribution, account        */
/* wrapper. Investment types: Stocks ISA, SIPP, Shares, Crypto, Cash,          */
/* Emergency Fund, Dividends, Property."                                       */
/* -------------------------------------------------------------------------- */

describe('issue #9 — investment holding fields + account wrapper types', () => {
	it('records every per-holding field the issue asks for', () => {
		const investment = createInvestment();
		// name, type, current value, purchase price, year purchased, monthly contribution,
		// account wrapper — README.md's field names are name/type/value/bought_for/
		// year_purchased/monthly_contribution/wrapper respectively.
		for (const field of [
			'name',
			'type',
			'value',
			'bought_for',
			'year_purchased',
			'monthly_contribution',
			'wrapper'
		]) {
			expect(investment).toHaveProperty(field);
		}
	});

	it('offers exactly the eight investment types the issue lists, in the same order', () => {
		expect([...INVESTMENT_TYPES]).toEqual([
			'stocks_isa',
			'sipp',
			'shares',
			'crypto',
			'cash',
			'emergency_fund',
			'dividends',
			'property'
		]);
	});

	it('offers an account wrapper enum a holding can be assigned to', () => {
		expect(WRAPPERS.length).toBeGreaterThan(0);
		expect(createInvestment().wrapper).toBeTypeOf('string');
		expect(WRAPPERS).toContain(createInvestment().wrapper);
	});
});

/* -------------------------------------------------------------------------- */
/* Factories                                                                   */
/* -------------------------------------------------------------------------- */

describe('createId', () => {
	it('prefixes the id so records are identifiable in raw JSON', () => {
		expect(createId('inv')).toMatch(/^inv_/);
	});

	it('does not collide across a realistic number of records', () => {
		const ids = Array.from({ length: 2000 }, () => createId('x'));
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('factories', () => {
	it('give every record its own id', () => {
		expect(createInvestment().id).not.toBe(createInvestment().id);
		expect(createStandardMilestones().map((m) => m.id)).toHaveLength(
			new Set(createStandardMilestones().map((m) => m.id)).size
		);
	});

	it('apply overrides over the defaults', () => {
		const investment = createInvestment({
			id: 'inv_fixed',
			name: 'Global All Cap',
			type: 'stocks_isa',
			wrapper: 'isa_stocks_shares',
			value: 12_345.67
		});
		expect(investment).toMatchObject({
			id: 'inv_fixed',
			name: 'Global All Cap',
			type: 'stocks_isa',
			wrapper: 'isa_stocks_shares',
			value: 12_345.67
		});
		// Untouched defaults survive.
		expect(investment.ownership_pct).toBe(100);
		expect(investment.exclude_from_net_worth).toBe(false);
	});

	it('default an investment to fully owned and included in net worth', () => {
		const investment = createInvestment();
		expect(investment.ownership_pct).toBe(100);
		expect(investment.exclude_from_net_worth).toBe(false);
	});

	it('default a property and an asset to counting towards net worth', () => {
		expect(createProperty().include_in_net_worth).toBe(true);
		expect(createAsset().include_in_net_worth).toBe(true);
	});

	it('leave unrecorded optional numbers as null, not zero', () => {
		const pension = createPension();
		expect(pension.db_annual_income).toBeNull();
		expect(pension.ni_qualifying_years).toBeNull();
		expect(createInvestment().bought_for).toBeNull();
		expect(createProfile().dob_year).toBeNull();
	});

	it('produce a valid document out of the box', () => {
		expect(validateAppData(createAppData())).toEqual({ valid: true, errors: [] });
	});
});

/* -------------------------------------------------------------------------- */
/* Monthly entry helpers                                                       */
/* -------------------------------------------------------------------------- */

describe('monthlyEntryKey', () => {
	it('zero-pads to a sortable YYYY-MM key', () => {
		expect(monthlyEntryKey({ year: 2026, month: 3 })).toBe('2026-03');
	});

	it('orders entries chronologically when sorted', () => {
		const entries = [
			{ year: 2026, month: 1 },
			{ year: 2025, month: 12 },
			{ year: 2026, month: 10 },
			{ year: 2026, month: 2 }
		];
		expect(entries.sort(compareMonthlyEntries).map(monthlyEntryKey)).toEqual([
			'2025-12',
			'2026-01',
			'2026-02',
			'2026-10'
		]);
	});
});

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

describe('normaliseAppData', () => {
	it.each([[null], [undefined], ['not json'], [42], [[]], [{}]])(
		'returns a complete valid document for %p',
		(raw) => {
			const data = normaliseAppData(raw);
			expect(data.schema_version).toBe(SCHEMA_VERSION);
			expect(data.profile.currency).toBe('GBP');
			expect(data.monthly_entries).toEqual([]);
			expect(data.budget).toEqual({ categories: [], bills: [], line_items: [] });
			expect(validateAppData(data).valid).toBe(true);
		}
	);

	it('round-trips a document through JSON unchanged', () => {
		const data = createAppData({
			profile: createProfile({ name: 'Test', dob_month: 4, dob_year: 1985, gross_salary: 62_000 }),
			monthly_entries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ name: 'ISA', type: 'stocks_isa', value: 40_000 })],
					debts: [createDebt({ name: 'Mortgage', type: 'mortgage', balance: 180_000 })]
				})
			],
			pensions: [createPension({ name: 'Aviva', value: 55_000 })],
			properties: [createProperty({ name: 'Home', value: 320_000, deal_expiry: '2028-09-30' })],
			assets: [createAsset({ name: 'Watch', category: 'watches_jewellery', current_value: 4_000 })],
			dividends: [createDividend({ name: 'VHYL', yield_pct: 3.4 })],
			budget: createBudget({ categories: [createBudgetCategory({ name: 'Groceries' })] })
		});

		expect(normaliseAppData(JSON.parse(JSON.stringify(data)))).toEqual(data);
	});

	it('fills in missing fields and drops unknown ones', () => {
		const data = normaliseAppData({
			profile: { name: 'Partial' },
			pensions: [{ name: 'Old pot', unexpected: 'dropped' }]
		});
		expect(data.profile.name).toBe('Partial');
		expect(data.profile.retirement_age).toBe(67);
		expect(data.pensions[0]).not.toHaveProperty('unexpected');
		expect(data.pensions[0].type).toBe('dc_workplace');
		expect(data.pensions[0].id).toMatch(/^pen_/);
	});

	it('drops unknown top-level keys', () => {
		expect(normaliseAppData({ hacked: true })).not.toHaveProperty('hacked');
	});

	it('coerces numeric strings from forms and hand-edited JSON', () => {
		const data = normaliseAppData({
			profile: { gross_salary: '62000', growth_rate: '6.5', dob_year: '1985' },
			monthly_entries: [{ month: '6', year: '2026', investments: [{ value: '1234.56' }] }]
		});
		expect(data.profile.gross_salary).toBe(62_000);
		expect(data.profile.growth_rate).toBe(6.5);
		expect(data.profile.dob_year).toBe(1985);
		expect(data.monthly_entries[0].month).toBe(6);
		expect(data.monthly_entries[0].investments[0].value).toBe(1234.56);
	});

	it('falls back to defaults for unrecognised enum values', () => {
		const data = normaliseAppData({
			profile: { tax_region: 'wales_only', journey_stage: 'vibing' },
			monthly_entries: [{ investments: [{ type: 'nft', wrapper: 'mattress' }] }],
			properties: [{ mortgage_type: 'interest_only_probably' }]
		});
		expect(data.profile.tax_region).toBe('england_wales_ni');
		expect(data.profile.journey_stage).toBe('building');
		expect(data.monthly_entries[0].investments[0].type).toBe('shares');
		expect(data.monthly_entries[0].investments[0].wrapper).toBe('gia');
		expect(data.properties[0].mortgage_type).toBe('fixed');
	});

	it('treats blank, null and unparseable optional numbers as not recorded', () => {
		const data = normaliseAppData({
			profile: { dob_month: '', dob_year: null },
			monthly_entries: [{ investments: [{ bought_for: 'dunno' }] }]
		});
		expect(data.profile.dob_month).toBeNull();
		expect(data.profile.dob_year).toBeNull();
		expect(data.monthly_entries[0].investments[0].bought_for).toBeNull();
	});

	it('rejects non-ISO and calendar-invalid dates', () => {
		const data = normaliseAppData({
			properties: [{ deal_expiry: '30/09/2028' }, { deal_expiry: '2026-02-30' }],
			assets: [{ purchase_date: '2019-07-04' }]
		});
		expect(data.properties[0].deal_expiry).toBeNull();
		expect(data.properties[1].deal_expiry).toBeNull();
		expect(data.assets[0].purchase_date).toBe('2019-07-04');
	});

	it('generates ids for records that arrive without one', () => {
		const data = normaliseAppData({ assets: [{ name: 'Unidentified' }, { name: 'Also' }] });
		expect(data.assets[0].id).not.toBe('');
		expect(data.assets[0].id).not.toBe(data.assets[1].id);
	});

	it('sorts monthly entries oldest first', () => {
		const data = normaliseAppData({
			monthly_entries: [
				{ month: 3, year: 2026 },
				{ month: 12, year: 2025 },
				{ month: 1, year: 2026 }
			]
		});
		expect(data.monthly_entries.map(monthlyEntryKey)).toEqual(['2025-12', '2026-01', '2026-03']);
	});

	it('accepts the budget written as an array, as README.md sketches it', () => {
		const data = normaliseAppData({
			budget: [
				{ categories: [{ name: 'Groceries', monthly_amount: 450 }], bills: [], line_items: [] }
			]
		});
		expect(data.budget.categories).toHaveLength(1);
		expect(data.budget.categories[0].monthly_amount).toBe(450);
	});

	it('replaces a non-array collection rather than trusting it', () => {
		const data = normaliseAppData({ pensions: 'all of them', milestones: { target: 1 } });
		expect(data.pensions).toEqual([]);
		expect(data.milestones).toEqual([]);
	});

	it('upgrades an older document to the current schema version', () => {
		expect(normaliseAppData({ schema_version: 0 }).schema_version).toBe(SCHEMA_VERSION);
	});

	it('keeps a newer schema version so validation can flag it', () => {
		const data = normaliseAppData({ schema_version: SCHEMA_VERSION + 1 });
		expect(data.schema_version).toBe(SCHEMA_VERSION + 1);
		expect(paths(validateAppData(data))).toContain('schema_version');
	});

	it('is exposed as migrateAppData for callers loading a stored document', () => {
		expect(migrateAppData({ profile: { name: 'Stored' } }).profile.name).toBe('Stored');
	});
});

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @param {import('./types.js').ValidationResult} result
 * @returns {string[]}
 */
const paths = (result) => result.errors.map((error) => error.path);

describe('validateAppData', () => {
	it('accepts a populated, sensible document', () => {
		const data = createAppData({
			profile: createProfile({
				dob_month: 4,
				dob_year: 1985,
				gross_salary: 62_000,
				pension_pct: 8
			}),
			monthly_entries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 40_000, ownership_pct: 50 })],
					debts: [createDebt({ type: 'mortgage', balance: 180_000 })]
				})
			]
		});
		expect(validateAppData(data)).toEqual({ valid: true, errors: [] });
	});

	it('rejects a month outside 1–12', () => {
		const data = createAppData({
			monthly_entries: [createMonthlyEntry({ month: 13, year: 2026 })]
		});
		expect(paths(validateAppData(data))).toContain('monthly_entries[0].month');
	});

	it('rejects a fractional month', () => {
		const data = createAppData({
			monthly_entries: [createMonthlyEntry({ month: 6.5, year: 2026 })]
		});
		expect(paths(validateAppData(data))).toContain('monthly_entries[0].month');
	});

	it('rejects an implausible year', () => {
		const data = createAppData({ monthly_entries: [createMonthlyEntry({ month: 6, year: 26 })] });
		expect(paths(validateAppData(data))).toContain('monthly_entries[0].year');
	});

	it('rejects two snapshots for the same month', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({ month: 6, year: 2026 }),
				createMonthlyEntry({ month: 6, year: 2026 })
			]
		});
		const result = validateAppData(data);
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual({
			path: 'monthly_entries[1]',
			message: 'duplicate snapshot for 2026-06 — one entry per month'
		});
	});

	it('rejects duplicate ids within a collection', () => {
		const data = createAppData({
			pensions: [createPension({ id: 'pen_1' }), createPension({ id: 'pen_1' })]
		});
		expect(paths(validateAppData(data))).toContain('pensions[1].id');
	});

	it('allows the same holding id across different months', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 5,
					year: 2026,
					investments: [createInvestment({ id: 'inv_1', value: 100 })]
				}),
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ id: 'inv_1', value: 110 })]
				})
			]
		});
		expect(validateAppData(data).valid).toBe(true);
	});

	it('rejects ownership above 100%', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ ownership_pct: 140 })]
				})
			]
		});
		expect(paths(validateAppData(data))).toContain(
			'monthly_entries[0].investments[0].ownership_pct'
		);
	});

	it('rejects a negative debt balance — debts are stored unsigned', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({ month: 6, year: 2026, debts: [createDebt({ balance: -1_000 })] })
			]
		});
		expect(paths(validateAppData(data))).toContain('monthly_entries[0].debts[0].balance');
	});

	it('rejects out-of-range pension percentages and NI years', () => {
		const data = createAppData({
			pensions: [createPension({ contribution_pct: 130, ni_qualifying_years: 99 })]
		});
		const reported = paths(validateAppData(data));
		expect(reported).toContain('pensions[0].contribution_pct');
		expect(reported).toContain('pensions[0].ni_qualifying_years');
	});

	it('rejects a calendar-invalid mortgage deal expiry', () => {
		const data = createAppData({ properties: [createProperty({ deal_expiry: '2026-02-30' })] });
		expect(paths(validateAppData(data))).toContain('properties[0].deal_expiry');
	});

	it('accepts a negative expected growth on a depreciating asset', () => {
		const data = createAppData({ assets: [createAsset({ expected_growth: -8 })] });
		expect(validateAppData(data).valid).toBe(true);
	});

	it('rejects a milestone with no target', () => {
		const data = createAppData({ milestones: [createMilestone({ label: 'Someday', target: 0 })] });
		expect(paths(validateAppData(data))).toContain('milestones[0].target');
	});

	it('rejects a bill pointing at a category that does not exist', () => {
		const data = createAppData({
			budget: createBudget({
				categories: [createBudgetCategory({ id: 'cat_1', name: 'Utilities' })],
				bills: [createBudgetBill({ name: 'Council tax', category_id: 'cat_gone' })],
				line_items: [createBudgetLineItem({ name: 'Vet', category_id: 'cat_1' })]
			})
		});
		const result = validateAppData(data);
		expect(paths(result)).toEqual(['budget.bills[0].category_id']);
	});

	it('accepts an uncategorised bill', () => {
		const data = createAppData({
			budget: createBudget({ bills: [createBudgetBill({ name: 'Netflix', category_id: null })] })
		});
		expect(validateAppData(data).valid).toBe(true);
	});

	it('rejects a due day outside the month', () => {
		const data = createAppData({
			budget: createBudget({ bills: [createBudgetBill({ due_day: 42 })] })
		});
		expect(paths(validateAppData(data))).toContain('budget.bills[0].due_day');
	});

	it('flags a document written by a newer build', () => {
		const data = createAppData({ schema_version: SCHEMA_VERSION + 1 });
		const result = validateAppData(data);
		expect(result.valid).toBe(false);
		expect(paths(result)).toContain('schema_version');
	});

	it('reports every problem at once, each with a path', () => {
		const data = createAppData({
			profile: createProfile({ dob_month: 13, pension_pct: -5 }),
			monthly_entries: [createMonthlyEntry({ month: 0, year: 2026 })]
		});
		const result = validateAppData(data);
		expect(paths(result)).toEqual([
			'profile.dob_month',
			'profile.pension_pct',
			'monthly_entries[0].month'
		]);
		for (const error of result.errors) expect(error.message).toBeTruthy();
	});
});
