import { describe, expect, it } from 'vitest';

import {
	createAsset,
	createBeneficiary,
	createDebt,
	createIhtSettings,
	createInvestment,
	createLifeInsurance,
	createMonthlyEntry,
	createPension,
	createProperty
} from './model.js';
import { createGift } from './lifetime-gifts.js';
import { beneficiaryShares, estateSnapshot } from './estate-plan.js';

/* -------------------------------------------------------------------------- */
/* estateSnapshot                                                              */
/* -------------------------------------------------------------------------- */

describe('estateSnapshot', () => {
	it('is a nil estate for a brand new document', () => {
		const snapshot = estateSnapshot();
		expect(snapshot.estateInput.estateValue).toBe(0);
		expect(snapshot.totalTax).toBe(0);
		expect(snapshot.netAfterTax).toBe(0);
	});

	it('values the estate from the latest monthly entry only', () => {
		const snapshot = estateSnapshot({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ value: 900_000 })]
				}),
				createMonthlyEntry({
					month: 2,
					year: 2026,
					investments: [createInvestment({ value: 950_000 })]
				})
			]
		});
		expect(snapshot.estateInput.estateValue).toBe(950_000);
	});

	it('nets off debts recorded in the same monthly entry', () => {
		const snapshot = estateSnapshot({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ value: 500_000 })],
					debts: [createDebt({ balance: 50_000 })]
				})
			]
		});
		expect(snapshot.estateInput.estateValue).toBe(450_000);
	});

	it('counts property equity and physical assets', () => {
		const snapshot = estateSnapshot({
			properties: [createProperty({ value: 400_000, mortgage_balance: 100_000 })],
			assets: [createAsset({ current_value: 20_000 })]
		});
		expect(snapshot.estateInput.estateValue).toBe(320_000);
	});

	it('counts recorded life insurance, less anything written in trust (#254)', () => {
		const snapshot = estateSnapshot({
			properties: [createProperty({ value: 400_000, mortgage_balance: 100_000 })],
			life_insurance: [
				createLifeInsurance({ name: 'Level term', sum_assured: 250_000, in_trust: false }),
				createLifeInsurance({ name: 'Death in service', sum_assured: 500_000, in_trust: true })
			]
		});

		// £300,000 of equity + the £250,000 policy that pays into the estate. The in-trust £500,000 is
		// reported, so the card can say what is missing, but is inside nothing.
		expect(snapshot.valuation.lifeInsurance).toBe(250_000);
		expect(snapshot.valuation.lifeInsuranceInTrust).toBe(500_000);
		expect(snapshot.estateInput.estateValue).toBe(550_000);
	});

	it('leaves cover out of the residence nil-rate band’s own figure', () => {
		const snapshot = estateSnapshot({
			properties: [createProperty({ type: 'primary_residence', value: 300_000 })],
			life_insurance: [createLifeInsurance({ sum_assured: 400_000, in_trust: false })]
		});

		expect(snapshot.estateInput.estateValue).toBe(700_000);
		expect(snapshot.estateInput.residenceValue).toBe(300_000);
	});

	it('grants the residence nil-rate band against a primary residence passing to descendants', () => {
		const snapshot = estateSnapshot({
			properties: [createProperty({ type: 'primary_residence', value: 300_000 })],
			iht_settings: createIhtSettings({ direct_descendants: true })
		});
		expect(snapshot.estateInput.residenceValue).toBe(300_000);
		// £325,000 NRB + £175,000 RNRB covers a £300,000 estate entirely.
		expect(snapshot.totalTax).toBe(0);
	});

	it('grants no residence band against a buy-to-let, however valuable', () => {
		const snapshot = estateSnapshot({
			properties: [createProperty({ type: 'buy_to_let', value: 900_000 })],
			iht_settings: createIhtSettings({ direct_descendants: true })
		});
		expect(snapshot.estateInput.residenceValue).toBeNull();
	});

	it('removes the residence band when direct_descendants is false', () => {
		const snapshot = estateSnapshot({
			properties: [createProperty({ type: 'primary_residence', value: 300_000 })],
			iht_settings: createIhtSettings({ direct_descendants: false })
		});
		expect(snapshot.estateInput.residenceValue).toBe(300_000);
		expect(snapshot.estate.allowances.rnrb).toBe(0);
	});

	it('excludes unused Defined Contribution pension pots — today deliberately excludes them', () => {
		const snapshot = estateSnapshot({
			pensions: [createPension({ type: 'dc_workplace', value: 250_000 })]
		});
		expect(snapshot.estateInput.estateValue).toBe(0);
		expect(snapshot.valuation.pensionPots).toBe(250_000);
		expect(snapshot.valuation.pensionsCounted).toBe(false);
	});

	it('deducts funeral expenses as a liability', () => {
		const snapshot = estateSnapshot({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ value: 400_000 })]
				})
			],
			iht_settings: createIhtSettings({ funeral_expenses: 8_000 })
		});
		expect(snapshot.estateInput.estateValue).toBe(400_000);
		expect(snapshot.estateInput.liabilities).toBe(8_000);
		expect(snapshot.estate.netEstate).toBe(392_000);
	});

	it('exempts the whole net estate when spouse_exempt is set, however large', () => {
		const snapshot = estateSnapshot({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ value: 5_000_000 })]
				})
			],
			iht_settings: createIhtSettings({ spouse_exempt: true })
		});
		expect(snapshot.totalTax).toBe(0);
		expect(snapshot.netAfterTax).toBe(5_000_000);
	});

	it('doubles both bands when a spouse’s allowances are transferred in full — £1,000,000 free', () => {
		const snapshot = estateSnapshot({
			monthly_entries: [
				createMonthlyEntry({
					month: 1,
					year: 2026,
					investments: [createInvestment({ value: 600_000 })]
				})
			],
			properties: [createProperty({ type: 'primary_residence', value: 400_000 })],
			iht_settings: createIhtSettings({
				direct_descendants: true,
				transferred_nil_rate_band_pct: 100,
				transferred_residence_nil_rate_band_pct: 100
			})
		});
		expect(snapshot.estateInput.estateValue).toBe(1_000_000);
		expect(snapshot.totalTax).toBe(0);
		expect(snapshot.netAfterTax).toBe(1_000_000);
	});

	it('spends the nil-rate band on a failed lifetime gift before the estate reaches it', () => {
		const withGift = estateSnapshot(
			{
				monthly_entries: [
					createMonthlyEntry({
						month: 1,
						year: 2026,
						investments: [createInvestment({ value: 600_000 })]
					})
				],
				// £331,000 less the £3,000 annual exemption and £3,000 brought forward is £325,000 —
				// exactly the nil-rate band, chosen so the gift consumes it entirely.
				gifts: [createGift({ date: '2024-01-01', amount: 331_000, recipient: 'Jo' })]
			},
			{ deathDate: '2026-01-01' }
		);
		const withoutGift = estateSnapshot(
			{
				monthly_entries: [
					createMonthlyEntry({
						month: 1,
						year: 2026,
						investments: [createInvestment({ value: 600_000 })]
					})
				]
			},
			{ deathDate: '2026-01-01' }
		);

		expect(withGift.ledger.chargeableTransfers).toBe(325_000);
		expect(withGift.nilRateBandUsedByGifts).toBe(325_000);
		// The gift used the whole band, so the estate now pays on all £600,000 instead of £275,000.
		expect(withGift.estate.tax).toBeGreaterThan(withoutGift.estate.tax);
	});

	it('reports totalTax as gift tax plus estate tax, but keeps netAfterTax to the estate only', () => {
		const snapshot = estateSnapshot(
			{
				monthly_entries: [
					createMonthlyEntry({
						month: 1,
						year: 2026,
						investments: [createInvestment({ value: 400_000 })]
					})
				],
				gifts: [createGift({ date: '2025-06-01', amount: 400_000, recipient: 'Jo' })]
			},
			{ deathDate: '2026-01-01' }
		);
		expect(snapshot.giftTax).toBeGreaterThan(0);
		expect(snapshot.estateTax).toBeGreaterThan(0);
		expect(snapshot.totalTax).toBe(snapshot.giftTax + snapshot.estateTax);
		// netAfterTax is what the estate pays out — gift tax is the recipient's, not deducted here.
		expect(snapshot.netAfterTax).toBe(snapshot.estate.netAfterTax);
		expect(snapshot.netAfterTax).not.toBe(snapshot.estate.netEstate - snapshot.totalTax);
	});

	it('runs the death date option through to the gift countdown', () => {
		const gift = createGift({ date: '2020-01-01', amount: 10_000, recipient: 'Jo' });
		const survived = estateSnapshot({ gifts: [gift] }, { deathDate: '2028-01-01' });
		const failed = estateSnapshot({ gifts: [gift] }, { deathDate: '2021-01-01' });
		expect(survived.ledger.survivedCount).toBe(1);
		expect(failed.ledger.failedCount).toBe(1);
	});

	it('never throws on a half-typed document, and never produces NaN', () => {
		const garbage = /** @type {any} */ ({
			monthly_entries: 'oops',
			properties: null,
			assets: undefined,
			pensions: 42,
			gifts: 'none of these',
			iht_settings: {
				spouse_exempt: 'yes please',
				transferred_nil_rate_band_pct: 'lots',
				funeral_expenses: 'a lot'
			}
		});
		const snapshot = estateSnapshot(garbage);
		expect(Number.isNaN(snapshot.estateInput.estateValue)).toBe(false);
		expect(Number.isNaN(snapshot.totalTax)).toBe(false);
		expect(Number.isNaN(snapshot.netAfterTax)).toBe(false);
		expect(snapshot.estateInput.spouseExempt).toBe(0);
	});

	it('clamps an out-of-range transferred percentage rather than rejecting it', () => {
		const snapshot = estateSnapshot({
			iht_settings: createIhtSettings({ transferred_nil_rate_band_pct: 250 })
		});
		expect(snapshot.ihtSettings.transferredNilRateBandPct).toBe(100);
	});
});

/* -------------------------------------------------------------------------- */
/* beneficiaryShares                                                          */
/* -------------------------------------------------------------------------- */

describe('beneficiaryShares', () => {
	it('is nothing allocated against an empty list', () => {
		const result = beneficiaryShares([], 100_000);
		expect(result).toEqual({
			netEstate: 100_000,
			shares: [],
			totalSharePct: 0,
			allocatedAmount: 0,
			unallocatedPct: 100,
			unallocatedAmount: 100_000,
			overAllocated: false
		});
	});

	it('prices a clean 60/40 split of a £100,000 estate', () => {
		const result = beneficiaryShares(
			[createBeneficiary({ share_pct: 60 }), createBeneficiary({ share_pct: 40 })],
			100_000
		);
		expect(result.shares.map((share) => share.amount)).toEqual([60_000, 40_000]);
		expect(result.totalSharePct).toBe(100);
		expect(result.allocatedAmount).toBe(100_000);
		expect(result.unallocatedPct).toBe(0);
		expect(result.unallocatedAmount).toBe(0);
		expect(result.overAllocated).toBe(false);
	});

	it('reads an under-allocated will as unallocated, not as an error', () => {
		const result = beneficiaryShares([createBeneficiary({ share_pct: 50 })], 100_000);
		expect(result.totalSharePct).toBe(50);
		expect(result.unallocatedPct).toBe(50);
		expect(result.unallocatedAmount).toBe(50_000);
		expect(result.overAllocated).toBe(false);
	});

	it('never rescales an over-allocated will to fit — negative unallocated instead', () => {
		const result = beneficiaryShares(
			[createBeneficiary({ share_pct: 70 }), createBeneficiary({ share_pct: 50 })],
			100_000
		);
		expect(result.shares.map((share) => share.amount)).toEqual([70_000, 50_000]);
		expect(result.totalSharePct).toBe(120);
		expect(result.allocatedAmount).toBe(120_000);
		expect(result.unallocatedPct).toBe(-20);
		expect(result.unallocatedAmount).toBe(-20_000);
		expect(result.overAllocated).toBe(true);
	});

	it('preserves name, relationship and notes', () => {
		const result = beneficiaryShares(
			[
				createBeneficiary({ name: 'Jo', relationship: 'Daughter', notes: 'Eldest', share_pct: 100 })
			],
			50_000
		);
		expect(result.shares[0]).toMatchObject({
			name: 'Jo',
			relationship: 'Daughter',
			notes: 'Eldest'
		});
	});

	it('clamps a negative or out-of-range share percentage', () => {
		const result = beneficiaryShares(
			[createBeneficiary({ share_pct: -20 }), createBeneficiary({ share_pct: 500 })],
			10_000
		);
		expect(result.shares.map((share) => share.sharePct)).toEqual([0, 100]);
	});

	it('treats a non-array beneficiary list as empty rather than throwing', () => {
		expect(beneficiaryShares(undefined, 10_000).shares).toEqual([]);
		const notAList = /** @type {any} */ ('not a list');
		expect(beneficiaryShares(notAList, 10_000).shares).toEqual([]);
	});

	it('floors a negative net estate at zero', () => {
		const result = beneficiaryShares([createBeneficiary({ share_pct: 100 })], -5_000);
		expect(result.netEstate).toBe(0);
		expect(result.shares[0].amount).toBe(0);
	});

	it('never produces NaN from a garbage share_pct', () => {
		const garbage = /** @type {any} */ ([{ share_pct: 'lots' }]);
		const result = beneficiaryShares(garbage, 10_000);
		expect(result.shares[0].sharePct).toBe(0);
		expect(Number.isNaN(result.totalSharePct)).toBe(false);
	});
});
