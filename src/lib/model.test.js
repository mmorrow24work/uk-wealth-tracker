import { describe, expect, it } from 'vitest';

import { INVESTMENT_TYPES, WRAPPERS } from './enums.js';
import {
	SCHEMA_VERSION,
	applyPriceRefreshResults,
	carryLastPrice,
	compareMonthlyEntries,
	createActivityLogEntry,
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
	createLifeInsurance,
	createMilestone,
	createMonthlyEntry,
	createNextMonthlyEntry,
	createPartner,
	createPension,
	createProfile,
	createProperty,
	createStandardMilestones,
	migrateAppData,
	monthlyEntryKey,
	normaliseAppData,
	validateAppData,
	validatePartnerFields
} from './model.js';

/* -------------------------------------------------------------------------- */
/* Shape — these assertions are transcribed from README.md's "Data Model"       */
/* outline. If one fails, either the README changed or the model drifted.       */
/* -------------------------------------------------------------------------- */

describe('document shape matches README.md', () => {
	it('has the eight top-level sections plus a schema version, partner, activity log and estate/IHT fields', () => {
		expect(Object.keys(createAppData()).sort()).toEqual(
			[
				'schema_version',
				'profile',
				'partner',
				'monthly_entries',
				'pensions',
				'properties',
				'assets',
				'dividends',
				'life_insurance',
				'milestones',
				'budget',
				'activity_log',
				'gifts',
				'beneficiaries',
				'iht_settings'
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
		[
			'partner',
			createPartner(),
			[
				'name',
				'dob_month',
				'dob_year',
				'retirement_age',
				'gross_salary',
				'pension_pct',
				'ni_qualifying_years'
			]
		],
		[
			'monthly_entries[]',
			createMonthlyEntry(),
			['id', 'month', 'year', 'investments', 'debts', 'auto_filled']
		],
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
				'ownership_pct',
				'ticker',
				'last_price'
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
				'offset_savings_balance',
				'deal_expiry',
				'purchase_price',
				'purchase_date',
				'let_from',
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
		[
			'life_insurance[]',
			createLifeInsurance(),
			['id', 'name', 'provider', 'sum_assured', 'current_value', 'in_trust', 'notes']
		],
		['milestones[]', createMilestone(), ['id', 'label', 'target', 'current', 'type']],
		['budget', createBudget(), ['categories', 'bills', 'line_items']],
		[
			'activity_log[]',
			createActivityLogEntry(),
			[
				'id',
				'timestamp',
				'action',
				'entity_type',
				'entity_id',
				'entity_name',
				'snapshot',
				'reverted'
			]
		]
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

	it('offers the eight investment types the issue lists plus the "other" catch-all, in order', () => {
		expect([...INVESTMENT_TYPES]).toEqual([
			'stocks_isa',
			'sipp',
			'shares',
			'crypto',
			'cash',
			'emergency_fund',
			'dividends',
			'property',
			'other'
		]);
	});

	it('offers an account wrapper enum a holding can be assigned to', () => {
		expect(WRAPPERS.length).toBeGreaterThan(0);
		expect(createInvestment().wrapper).toBeTypeOf('string');
		expect(WRAPPERS).toContain(createInvestment().wrapper);
	});
});

/* -------------------------------------------------------------------------- */
/* Issue #298 — Investment.last_price                                          */
/*                                                                              */
/* The per-share price seen at the last live price refresh, kept so a later     */
/* quote can be turned into a unit-free ratio (see price-feed.js). Zero is not  */
/* a valid value: it is only ever a ratio's denominator.                        */
/* -------------------------------------------------------------------------- */

describe('issue #298 — Investment.last_price', () => {
	it('starts null — no price has been fetched for a brand new holding', () => {
		expect(createInvestment().last_price).toBeNull();
		expect(createInvestment({ ticker: 'VWRL.L' }).last_price).toBeNull();
	});

	it('normalises a recorded price, and treats blank/unparseable as not recorded', () => {
		const data = normaliseAppData({
			monthly_entries: [
				{
					investments: [
						{ last_price: '104.5' },
						{ last_price: 25.1 },
						{ last_price: '' },
						{ last_price: 'dunno' },
						{}
					]
				}
			]
		});
		const prices = data.monthly_entries[0].investments.map((i) => i.last_price);
		expect(prices).toEqual([104.5, 25.1, null, null, null]);
	});

	it('survives a round trip through a saved document', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ ticker: 'VWRL.L', value: 5_000, last_price: 104.5 })]
				})
			]
		});
		const reloaded = normaliseAppData(JSON.parse(JSON.stringify(data)));
		expect(reloaded.monthly_entries[0].investments[0].last_price).toBe(104.5);
		expect(validateAppData(reloaded)).toEqual({ valid: true, errors: [] });
	});

	it('accepts null — the normal state for a holding that has never been priced', () => {
		const data = createAppData({
			monthly_entries: [
				createMonthlyEntry({ month: 6, year: 2026, investments: [createInvestment()] })
			]
		});
		expect(validateAppData(data).valid).toBe(true);
	});

	it('rejects a zero or negative price — it is only ever a ratio denominator', () => {
		for (const last_price of [0, -12]) {
			const data = createAppData({
				monthly_entries: [
					createMonthlyEntry({
						month: 6,
						year: 2026,
						investments: [createInvestment({ last_price })]
					})
				]
			});
			expect(paths(validateAppData(data))).toContain(
				'monthly_entries[0].investments[0].last_price'
			);
		}
	});

	it('carries a baseline across an edit that leaves value and ticker alone', () => {
		const before = createInvestment({ ticker: 'VWRL.L', value: 5_000, last_price: 104.5 });
		expect(carryLastPrice(before, { name: 'Renamed', notes: 'moved to the ISA' })).toBe(104.5);
		expect(carryLastPrice(before, { ticker: 'VWRL.L', value: 5_000 })).toBe(104.5);
	});

	it('drops the baseline when the value is restated by hand — it would double-count the move', () => {
		const before = createInvestment({ ticker: 'VWRL.L', value: 5_000, last_price: 104.5 });
		expect(carryLastPrice(before, { value: 5_250 })).toBeNull();
	});

	it('drops the baseline when the ticker changes — it belongs to the old instrument', () => {
		const before = createInvestment({ ticker: 'VWRL.L', value: 5_000, last_price: 104.5 });
		expect(carryLastPrice(before, { ticker: 'VUSA.L' })).toBeNull();
		expect(carryLastPrice(before, { ticker: null })).toBeNull();
	});

	it('leaves an already-null baseline null', () => {
		const before = createInvestment({ ticker: 'VWRL.L', value: 5_000 });
		expect(carryLastPrice(before, { value: 6_000 })).toBeNull();
		expect(carryLastPrice(before, { name: 'Renamed' })).toBeNull();
	});
});

describe('issue #300 — applyPriceRefreshResults', () => {
	it('writes the scaled value and the new last_price for an updated result', () => {
		const investment = createInvestment({ ticker: 'VWRL.L', value: 1_000, last_price: 90 });
		const [after] = applyPriceRefreshResults(
			[investment],
			[
				{
					status: 'updated',
					investmentId: investment.id,
					ticker: 'VWRL.L',
					previousValue: 1_000,
					value: 1_100,
					previousPrice: 90,
					price: 99
				}
			]
		);
		expect(after.value).toBe(1_100);
		expect(after.last_price).toBe(99);
	});

	it('writes last_price only for a baseline result, leaving value untouched', () => {
		const investment = createInvestment({ ticker: 'AAPL', value: 500, last_price: null });
		const [after] = applyPriceRefreshResults(
			[investment],
			[{ status: 'baseline', investmentId: investment.id, ticker: 'AAPL', price: 210.5 }]
		);
		expect(after.value).toBe(500);
		expect(after.last_price).toBe(210.5);
	});

	it('leaves a failed holding exactly as it was', () => {
		const investment = createInvestment({
			ticker: 'ZZZZ.L',
			value: 750,
			last_price: 12,
			name: 'Some Fund'
		});
		const [after] = applyPriceRefreshResults(
			[investment],
			[
				{
					status: 'failed',
					investmentId: investment.id,
					ticker: 'ZZZZ.L',
					reason: 'rate-limited',
					message: "The price service's request limit has been reached for now — try again later."
				}
			]
		);
		expect(after).toEqual(investment);
	});

	it('leaves a holding with no matching result untouched, e.g. one skipped for having no ticker', () => {
		const investment = createInvestment({ ticker: null, value: 250 });
		const [after] = applyPriceRefreshResults([investment], []);
		expect(after).toEqual(investment);
	});

	it('applies a mix of results by investmentId, not array position', () => {
		const updated = createInvestment({ ticker: 'VWRL.L', value: 1_000, last_price: 90 });
		const baseline = createInvestment({ ticker: 'AAPL', value: 500 });
		const failed = createInvestment({ ticker: 'ZZZZ.L', value: 750, last_price: 12 });

		const results = applyPriceRefreshResults(
			[failed, updated, baseline],
			[
				{
					status: 'updated',
					investmentId: updated.id,
					ticker: 'VWRL.L',
					previousValue: 1_000,
					value: 1_100,
					previousPrice: 90,
					price: 99
				},
				{ status: 'baseline', investmentId: baseline.id, ticker: 'AAPL', price: 210.5 },
				{
					status: 'failed',
					investmentId: failed.id,
					ticker: 'ZZZZ.L',
					reason: 'unrecognised-ticker',
					message: 'The price service didn\'t recognise "ZZZZ.L".'
				}
			]
		);

		expect(results.find((r) => r.id === updated.id)).toMatchObject({
			value: 1_100,
			last_price: 99
		});
		expect(results.find((r) => r.id === baseline.id)).toMatchObject({
			value: 500,
			last_price: 210.5
		});
		expect(results.find((r) => r.id === failed.id)).toEqual(failed);
	});

	it('does not mutate the input array or the original holding objects', () => {
		const investment = createInvestment({ ticker: 'VWRL.L', value: 1_000, last_price: 90 });
		const investments = [investment];
		applyPriceRefreshResults(investments, [
			{
				status: 'updated',
				investmentId: investment.id,
				ticker: 'VWRL.L',
				previousValue: 1_000,
				value: 1_100,
				previousPrice: 90,
				price: 99
			}
		]);
		expect(investments).toEqual([investment]);
		expect(investment.value).toBe(1_000);
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
		expect(createInvestment().last_price).toBeNull();
		expect(createProfile().dob_year).toBeNull();
		expect(createPartner().dob_year).toBeNull();
		expect(createPartner().ni_qualifying_years).toBeNull();
	});

	it('produce a valid document out of the box', () => {
		expect(validateAppData(createAppData())).toEqual({ valid: true, errors: [] });
	});

	it('defaults a new document to no partner — the normal case, not a blank record', () => {
		expect(createAppData().partner).toBeNull();
	});

	it('apply overrides over the defaults for a partner', () => {
		const partner = createPartner({ name: 'Alex', retirement_age: 60, gross_salary: 45_000 });
		expect(partner).toMatchObject({ name: 'Alex', retirement_age: 60, gross_salary: 45_000 });
		expect(partner.pension_pct).toBe(0);
		expect(partner.ni_qualifying_years).toBeNull();
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

describe('createNextMonthlyEntry', () => {
	it('copies investments/debts from the most recent entry earlier than the target, not the array-last one', () => {
		const jan = createMonthlyEntry({
			month: 1,
			year: 2026,
			investments: [createInvestment({ name: 'January holding', value: 1_000 })]
		});
		const march = createMonthlyEntry({
			month: 3,
			year: 2026,
			investments: [createInvestment({ name: 'March holding', value: 3_000 })]
		});
		// March pushed in before January -- array order must not be mistaken for chronological order.
		const entry = createNextMonthlyEntry([march, jan], { month: 4, year: 2026 });

		expect(entry.investments.map((investment) => investment.name)).toEqual(['March holding']);
	});

	it('mints fresh ids on every copied holding and debt', () => {
		const investment = createInvestment({ name: 'Vanguard', value: 5_000 });
		const debt = createDebt({ name: 'Credit card', balance: 500 });
		const previous = createMonthlyEntry({
			month: 1,
			year: 2026,
			investments: [investment],
			debts: [debt]
		});

		const entry = createNextMonthlyEntry([previous], { month: 2, year: 2026 });

		expect(entry.investments).toHaveLength(1);
		expect(entry.investments[0].id).not.toBe(investment.id);
		expect(entry.investments[0]).toMatchObject({ name: 'Vanguard', value: 5_000 });
		expect(entry.debts).toHaveLength(1);
		expect(entry.debts[0].id).not.toBe(debt.id);
		expect(entry.debts[0]).toMatchObject({ name: 'Credit card', balance: 500 });
	});

	it('falls back to a blank entry when there is no earlier entry', () => {
		const entry = createNextMonthlyEntry([], { month: 6, year: 2026 });
		expect(entry).toMatchObject({ month: 6, year: 2026, investments: [], debts: [] });

		const later = createMonthlyEntry({ month: 8, year: 2026, investments: [createInvestment()] });
		const stillBlank = createNextMonthlyEntry([later], { month: 6, year: 2026 });
		expect(stillBlank).toMatchObject({ month: 6, year: 2026, investments: [], debts: [] });
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
			partner: createPartner({ name: 'Alex', dob_month: 9, dob_year: 1987, gross_salary: 45_000 }),
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
			budget: createBudget({ categories: [createBudgetCategory({ name: 'Groceries' })] }),
			activity_log: [
				createActivityLogEntry({
					action: 'removed',
					entity_type: 'debt',
					entity_id: 'debt_1',
					entity_name: 'Old card',
					snapshot: { id: 'debt_1', name: 'Old card', balance: 500 }
				})
			]
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

	it('normalises a document with no partner key at all — saved before partners existed', () => {
		expect(normaliseAppData({ profile: { name: 'Solo' } }).partner).toBeNull();
	});

	it('keeps an explicit null partner null', () => {
		expect(normaliseAppData({ partner: null }).partner).toBeNull();
	});

	it('does not coerce a non-object partner into a phantom record', () => {
		expect(normaliseAppData({ partner: 'not a partner' }).partner).toBeNull();
		expect(normaliseAppData({ partner: 42 }).partner).toBeNull();
		expect(normaliseAppData({ partner: ['a', 'b'] }).partner).toBeNull();
	});

	it('normalises a stored partner, dropping unknown fields', () => {
		const data = normaliseAppData({
			partner: { name: 'Alex', gross_salary: '45000', unexpected: 'dropped' }
		});
		expect(data.partner).toEqual({
			name: 'Alex',
			dob_month: null,
			dob_year: null,
			retirement_age: 67,
			gross_salary: 45_000,
			pension_pct: 0,
			ni_qualifying_years: null
		});
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

	it('reads a monthly entry as user-recorded unless it says otherwise', () => {
		const data = normaliseAppData({
			monthly_entries: [
				{ month: 1, year: 2026 },
				{ month: 2, year: 2026, auto_filled: true },
				{ month: 3, year: 2026, auto_filled: 'yes please' }
			]
		});
		expect(data.monthly_entries.map((entry) => entry.auto_filled)).toEqual([false, true, false]);
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

	it('normalises an activity log entry, falling back on bad action/entity_type/timestamp', () => {
		const data = normaliseAppData({
			activity_log: [
				{
					action: 'archived',
					entity_type: 'pension',
					entity_id: 'debt_1',
					entity_name: 'Halifax',
					timestamp: 'not a date',
					snapshot: 'not an object',
					reverted: 'yes'
				}
			]
		});
		const entry = data.activity_log[0];
		expect(entry.action).toBe('added');
		expect(entry.entity_type).toBe('debt');
		expect(entry.entity_id).toBe('debt_1');
		expect(entry.snapshot).toBeNull();
		expect(entry.reverted).toBe(false);
		expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
	});

	it('generates an id for an activity log entry that arrives without one', () => {
		const data = normaliseAppData({ activity_log: [{ action: 'added', entity_type: 'debt' }] });
		expect(data.activity_log[0].id).toMatch(/^log_/);
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

	it('accepts a life insurance policy with valid sum assured and current value', () => {
		const data = createAppData({
			life_insurance: [
				createLifeInsurance({
					name: 'Level term to 60',
					provider: 'Zurich',
					sum_assured: 500000,
					current_value: 125000,
					in_trust: true
				})
			]
		});
		expect(validateAppData(data).valid).toBe(true);
	});

	it('rejects a life insurance policy with negative sum assured', () => {
		const data = createAppData({
			life_insurance: [createLifeInsurance({ sum_assured: -1000 })]
		});
		expect(paths(validateAppData(data))).toContain('life_insurance[0].sum_assured');
	});

	it('rejects a life insurance policy with negative current value', () => {
		const data = createAppData({
			life_insurance: [createLifeInsurance({ current_value: -500 })]
		});
		expect(paths(validateAppData(data))).toContain('life_insurance[0].current_value');
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

	it('accepts a null partner — no partner recorded', () => {
		const data = createAppData({ partner: null });
		expect(validateAppData(data)).toEqual({ valid: true, errors: [] });
	});

	it('accepts a populated, sensible partner', () => {
		const data = createAppData({
			partner: createPartner({ dob_month: 9, dob_year: 1987, retirement_age: 60, pension_pct: 5 })
		});
		expect(validateAppData(data)).toEqual({ valid: true, errors: [] });
	});

	it('rejects out-of-range partner fields', () => {
		const data = createAppData({
			partner: createPartner({ dob_month: 13, retirement_age: 200, pension_pct: -5 })
		});
		const reported = paths(validateAppData(data));
		expect(reported).toContain('partner.dob_month');
		expect(reported).toContain('partner.retirement_age');
		expect(reported).toContain('partner.pension_pct');
	});

	it('rejects partner NI years outside 0–60', () => {
		const data = createAppData({ partner: createPartner({ ni_qualifying_years: 99 }) });
		expect(paths(validateAppData(data))).toContain('partner.ni_qualifying_years');
	});

	describe('validatePartnerFields', () => {
		it('reports nothing for a sensible partner — the same rules validateAppData applies', () => {
			const partner = createPartner({ dob_month: 9, dob_year: 1987, retirement_age: 60 });
			expect(validatePartnerFields(partner)).toEqual([]);
		});

		it('reports the same paths validateAppData would, for a standalone record', () => {
			const partner = createPartner({ dob_month: 13, retirement_age: 200, pension_pct: -5 });
			const reported = validatePartnerFields(partner).map((error) => error.path);
			expect(reported).toEqual(
				expect.arrayContaining([
					'partner.dob_month',
					'partner.retirement_age',
					'partner.pension_pct'
				])
			);
		});

		it('reports NI years outside 0–60, same as validateAppData', () => {
			const partner = createPartner({ ni_qualifying_years: 99 });
			const reported = validatePartnerFields(partner).map((error) => error.path);
			expect(reported).toContain('partner.ni_qualifying_years');
		});
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

	it('accepts a removed activity log entry that carries a snapshot', () => {
		const data = createAppData({
			activity_log: [
				createActivityLogEntry({
					action: 'removed',
					entity_type: 'debt',
					entity_id: 'debt_1',
					snapshot: { id: 'debt_1', balance: 500 }
				})
			]
		});
		expect(validateAppData(data).valid).toBe(true);
	});

	it('rejects a removed activity log entry with no snapshot to revert from', () => {
		const data = createAppData({
			activity_log: [
				createActivityLogEntry({ action: 'removed', entity_id: 'debt_1', snapshot: null })
			]
		});
		expect(paths(validateAppData(data))).toContain('activity_log[0].snapshot');
	});

	it('rejects an activity log entry marked reverted that was not a removal', () => {
		const data = createAppData({
			activity_log: [
				createActivityLogEntry({ action: 'added', entity_id: 'debt_1', reverted: true })
			]
		});
		expect(paths(validateAppData(data))).toContain('activity_log[0].reverted');
	});

	it('rejects an activity log entry with an unparseable timestamp', () => {
		const data = createAppData({
			activity_log: [createActivityLogEntry({ entity_id: 'debt_1', timestamp: 'whenever' })]
		});
		expect(paths(validateAppData(data))).toContain('activity_log[0].timestamp');
	});

	it('rejects an activity log entry with an empty entity_id', () => {
		const data = createAppData({ activity_log: [createActivityLogEntry({ entity_id: '' })] });
		expect(paths(validateAppData(data))).toContain('activity_log[0].entity_id');
	});

	it('rejects duplicate ids within the activity log', () => {
		const data = createAppData({
			activity_log: [
				createActivityLogEntry({ id: 'log_1', entity_id: 'debt_1' }),
				createActivityLogEntry({ id: 'log_1', entity_id: 'debt_2' })
			]
		});
		expect(paths(validateAppData(data))).toContain('activity_log[1].id');
	});
});
