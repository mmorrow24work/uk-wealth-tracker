import { describe, expect, it } from 'vitest';

import {
	NIL_RATE_BAND as BUDGET_POLICY_NIL_RATE_BAND,
	availableNilRateBands,
	nilRateBandsForTaxYear
} from './budget-policy.js';
import {
	DEFAULT_ESTATE,
	IHT_RATE,
	IHT_TAX_YEAR,
	MAX_TRANSFERRED_BAND_PCT,
	NIL_RATE_BAND,
	RESIDENCE_NIL_RATE_BAND,
	RNRB_TAPER_DIVISOR,
	RNRB_TAPER_THRESHOLD,
	STATUTORY_NIL_RATE_BANDS,
	chargeableEstate,
	estateAllowances,
	inheritanceTax,
	netEstate,
	normaliseEstate,
	transferableAllowances,
	transferredBand
} from './estate.js';

/** Values are money, so compare to the penny rather than to floating-point exactness. */
const PENNY = 0.005;

/** Percentages fall out of a division and are left unrounded — compare to a thousandth. */
const THOUSANDTH = 0.0005;

/* -------------------------------------------------------------------------- */
/* Statutory figures                                                           */
/* -------------------------------------------------------------------------- */

describe('statutory figures', () => {
	it('match CLAUDE.md/README.md 2026/27 domain rules exactly', () => {
		expect(NIL_RATE_BAND).toBe(325_000);
		expect(RESIDENCE_NIL_RATE_BAND).toBe(175_000);
		expect(RNRB_TAPER_THRESHOLD).toBe(2_000_000);
		expect(RNRB_TAPER_DIVISOR).toBe(2);
		expect(IHT_RATE).toBe(40);
		expect(MAX_TRANSFERRED_BAND_PCT).toBe(100);
	});

	it('states the tax year those figures belong to', () => {
		expect(IHT_TAX_YEAR).toBe('2026/27');
	});

	it('offers the pair as a frozen default', () => {
		expect(STATUTORY_NIL_RATE_BANDS).toEqual({ nrb: 325_000, rnrb: 175_000 });
		expect(Object.isFrozen(STATUTORY_NIL_RATE_BANDS)).toBe(true);
	});

	it('is the one place the codebase states them — budget-policy.js re-exports these', () => {
		expect(BUDGET_POLICY_NIL_RATE_BAND).toBe(NIL_RATE_BAND);
	});
});

/* -------------------------------------------------------------------------- */
/* The estate                                                                  */
/* -------------------------------------------------------------------------- */

describe('normaliseEstate', () => {
	it('fills an empty estate from the defaults', () => {
		expect(normaliseEstate()).toEqual(DEFAULT_ESTATE);
		expect(normaliseEstate({})).toEqual({ ...DEFAULT_ESTATE });
		expect(Object.isFrozen(DEFAULT_ESTATE)).toBe(true);
	});

	it('reads money that arrived as a string', () => {
		expect(normaliseEstate({ estateValue: /** @type {never} */ ('500000') }).estateValue).toBe(
			500_000
		);
	});

	it('floors negative money at zero — an estate cannot own or owe less than nothing', () => {
		const estate = normaliseEstate({ estateValue: -1, liabilities: -1, spouseExempt: -1 });
		expect(estate.estateValue).toBe(0);
		expect(estate.liabilities).toBe(0);
		expect(estate.spouseExempt).toBe(0);
	});

	it('reads a null residence — budget-policy.js’s "no qualifying home" — as nothing', () => {
		expect(normaliseEstate({ residenceValue: null }).residenceValue).toBe(0);
	});

	it('clamps transferred percentages to 0–100 rather than rejecting them', () => {
		expect(normaliseEstate({ transferredNilRateBandPct: 250 }).transferredNilRateBandPct).toBe(100);
		expect(normaliseEstate({ transferredNilRateBandPct: -50 }).transferredNilRateBandPct).toBe(0);
		expect(
			normaliseEstate({ transferredResidenceNilRateBandPct: 250 })
				.transferredResidenceNilRateBandPct
		).toBe(100);
	});

	it('keeps the two transferred percentages apart', () => {
		const estate = normaliseEstate({
			transferredNilRateBandPct: 100,
			transferredResidenceNilRateBandPct: 40
		});
		expect(estate.transferredNilRateBandPct).toBe(100);
		expect(estate.transferredResidenceNilRateBandPct).toBe(40);
	});

	it('falls back to the defaults for anything unreadable', () => {
		expect(normaliseEstate({ estateValue: undefined }).estateValue).toBe(0);
		expect(normaliseEstate({ estateValue: Number.NaN }).estateValue).toBe(0);
		expect(
			normaliseEstate({ directDescendants: /** @type {never} */ ('yes') }).directDescendants
		).toBe(true);
		expect(normaliseEstate({ directDescendants: false }).directDescendants).toBe(false);
	});
});

describe('netEstate', () => {
	it('is everything owned less everything owed', () => {
		expect(netEstate({ estateValue: 800_000, liabilities: 200_000 })).toBe(600_000);
	});

	it('can be negative — an estate can owe more than it owns', () => {
		expect(netEstate({ estateValue: 100_000, liabilities: 250_000 })).toBe(-150_000);
	});

	it('takes no notice of the spouse exemption — the taper is measured before it', () => {
		expect(netEstate({ estateValue: 900_000, spouseExempt: 900_000 })).toBe(900_000);
	});

	it('rounds to whole pence', () => {
		expect(netEstate({ estateValue: 500_000.1, liabilities: 0.05 })).toBeCloseTo(500_000.05, PENNY);
	});

	it('is nothing for an estate nobody has described', () => {
		expect(netEstate()).toBe(0);
	});
});

describe('chargeableEstate', () => {
	it('is the net estate less what passes to a spouse', () => {
		expect(chargeableEstate({ estateValue: 900_000, spouseExempt: 400_000 })).toBe(500_000);
	});

	it('is nothing when everything passes to a spouse', () => {
		expect(chargeableEstate({ estateValue: 2_000_000, spouseExempt: 2_000_000 })).toBe(0);
	});

	it('floors at zero rather than going negative', () => {
		expect(chargeableEstate({ estateValue: 100_000, spouseExempt: 400_000 })).toBe(0);
		expect(chargeableEstate({ estateValue: 100_000, liabilities: 250_000 })).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* The bands                                                                   */
/* -------------------------------------------------------------------------- */

describe('transferredBand', () => {
	it('adds the stated percentage of a second band', () => {
		expect(transferredBand(NIL_RATE_BAND, 0)).toBe(325_000);
		expect(transferredBand(NIL_RATE_BAND, 50)).toBe(487_500);
		expect(transferredBand(NIL_RATE_BAND, 100)).toBe(650_000);
		expect(transferredBand(RESIDENCE_NIL_RATE_BAND, 100)).toBe(350_000);
	});

	it('caps at one extra band and floors at none', () => {
		expect(transferredBand(NIL_RATE_BAND, 400)).toBe(650_000);
		expect(transferredBand(NIL_RATE_BAND, -20)).toBe(325_000);
		expect(transferredBand(NIL_RATE_BAND, Number.NaN)).toBe(325_000);
	});
});

describe('estateAllowances', () => {
	it('is the nil-rate band alone when no home is passing to descendants', () => {
		const allowances = estateAllowances({ estateValue: 500_000 });
		expect(allowances.nrb).toBe(325_000);
		expect(allowances.rnrb).toBe(0);
		expect(allowances.rnrbBeforeTaper).toBe(0);
		expect(allowances.total).toBe(325_000);
	});

	it('still reports the residence enhancement with no home — it is what transfers', () => {
		expect(estateAllowances({ estateValue: 500_000 }).rnrbEnhancement).toBe(175_000);
		expect(
			estateAllowances({ estateValue: 500_000, transferredResidenceNilRateBandPct: 100 })
				.rnrbEnhancement
		).toBe(350_000);
	});

	it('adds the residence band for a home closely inherited', () => {
		const allowances = estateAllowances({ estateValue: 500_000, residenceValue: 300_000 });
		expect(allowances.rnrb).toBe(175_000);
		expect(allowances.taperLoss).toBe(0);
		expect(allowances.residenceCapLoss).toBe(0);
		expect(allowances.total).toBe(500_000);
	});

	it('removes the residence band entirely when the home is not going to descendants', () => {
		const allowances = estateAllowances({
			estateValue: 500_000,
			residenceValue: 300_000,
			directDescendants: false
		});
		expect(allowances.rnrb).toBe(0);
		expect(allowances.total).toBe(325_000);
	});

	it('doubles both bands when both transfer in full', () => {
		const allowances = estateAllowances({
			estateValue: 1_000_000,
			residenceValue: 400_000,
			transferredNilRateBandPct: 100,
			transferredResidenceNilRateBandPct: 100
		});
		expect(allowances.nrb).toBe(650_000);
		expect(allowances.rnrb).toBe(350_000);
		expect(allowances.total).toBe(1_000_000);
	});

	it('transfers the two bands independently', () => {
		const allowances = estateAllowances({
			estateValue: 1_000_000,
			residenceValue: 400_000,
			transferredNilRateBandPct: 100,
			transferredResidenceNilRateBandPct: 0
		});
		expect(allowances.nrb).toBe(650_000);
		expect(allowances.rnrb).toBe(175_000);
		expect(allowances.total).toBe(825_000);
	});

	it('withdraws £1 of residence band for every £2 above £2,000,000', () => {
		const allowances = estateAllowances({ estateValue: 2_100_000, residenceValue: 500_000 });
		expect(allowances.taperLoss).toBe(50_000);
		expect(allowances.rnrb).toBe(125_000);
		expect(allowances.total).toBe(450_000);
	});

	it('tapers the residence band away entirely at £2,350,000', () => {
		expect(estateAllowances({ estateValue: 2_349_000, residenceValue: 500_000 }).rnrb).toBe(500);
		expect(estateAllowances({ estateValue: 2_350_000, residenceValue: 500_000 }).rnrb).toBe(0);
		expect(estateAllowances({ estateValue: 3_000_000, residenceValue: 500_000 }).rnrb).toBe(0);
	});

	it('tapers a transferred residence band from its doubled figure, so it survives longer', () => {
		const doubled = {
			estateValue: 2_350_000,
			residenceValue: 500_000,
			transferredResidenceNilRateBandPct: 100
		};
		expect(estateAllowances(doubled).taperLoss).toBe(175_000);
		expect(estateAllowances(doubled).rnrb).toBe(175_000);
		expect(estateAllowances({ ...doubled, estateValue: 2_700_000 }).rnrb).toBe(0);
	});

	it('never withdraws more residence band than there was', () => {
		const allowances = estateAllowances({ estateValue: 10_000_000, residenceValue: 500_000 });
		expect(allowances.taperLoss).toBe(175_000);
		expect(allowances.rnrb).toBe(0);
		expect(allowances.total).toBe(325_000);
	});

	it('measures the taper on the net estate, so liabilities can keep an estate under it', () => {
		const allowances = estateAllowances({
			estateValue: 2_200_000,
			liabilities: 300_000,
			residenceValue: 500_000
		});
		expect(allowances.taperLoss).toBe(0);
		expect(allowances.rnrb).toBe(175_000);
	});

	it('measures the taper before the spouse exemption — convention 1', () => {
		const allowances = estateAllowances({
			estateValue: 2_400_000,
			spouseExempt: 2_400_000,
			residenceValue: 500_000
		});
		expect(allowances.rnrb).toBe(0);
	});

	it('caps the residence band at what the home is actually worth', () => {
		const allowances = estateAllowances({ estateValue: 600_000, residenceValue: 120_000 });
		expect(allowances.rnrb).toBe(120_000);
		expect(allowances.residenceCapLoss).toBe(55_000);
		expect(allowances.total).toBe(445_000);
	});

	it('applies the taper before the cap, so both can bite at once', () => {
		const allowances = estateAllowances({ estateValue: 2_100_000, residenceValue: 100_000 });
		expect(allowances.taperLoss).toBe(50_000);
		expect(allowances.rnrb).toBe(100_000);
		expect(allowances.residenceCapLoss).toBe(25_000);
	});

	it('accepts a different tax year’s bands — convention 6', () => {
		const allowances = estateAllowances(
			{ estateValue: 500_000, residenceValue: 300_000 },
			{ nrb: 400_000, rnrb: 200_000 }
		);
		expect(allowances.nrb).toBe(400_000);
		expect(allowances.rnrb).toBe(200_000);
		expect(allowances.total).toBe(600_000);
	});

	it('agrees with budget-policy.js, which now calls it', () => {
		const bands = nilRateBandsForTaxYear(2026, { indexationRate: 0 });
		const viaPolicy = availableNilRateBands(
			2_100_000,
			bands,
			{ transferredBandsPct: 0, directDescendants: true },
			500_000
		);
		const direct = estateAllowances({ estateValue: 2_100_000, residenceValue: 500_000 });
		expect(viaPolicy.total).toBe(direct.total);
		expect(viaPolicy.taperLoss).toBe(direct.taperLoss);
	});
});

/* -------------------------------------------------------------------------- */
/* The bill — the worked examples in the module comment                        */
/* -------------------------------------------------------------------------- */

describe('inheritanceTax — worked examples', () => {
	it('£500,000 with nothing to descendants: £70,000', () => {
		const result = inheritanceTax({ estateValue: 500_000 });
		expect(result.allowances.total).toBe(325_000);
		expect(result.taxableEstate).toBe(175_000);
		expect(result.tax).toBe(70_000);
		expect(result.effectiveRate).toBeCloseTo(14, THOUSANDTH);
		expect(result.netAfterTax).toBe(430_000);
	});

	it('£500,000 including a £300,000 home to children: nothing', () => {
		const result = inheritanceTax({ estateValue: 500_000, residenceValue: 300_000 });
		expect(result.allowances.total).toBe(500_000);
		expect(result.taxableEstate).toBe(0);
		expect(result.tax).toBe(0);
		expect(result.effectiveRate).toBe(0);
	});

	it('£1,000,000 with both bands transferred in full: nothing — the couple’s £1m', () => {
		const result = inheritanceTax({
			estateValue: 1_000_000,
			residenceValue: 400_000,
			transferredNilRateBandPct: 100,
			transferredResidenceNilRateBandPct: 100
		});
		expect(result.allowances.total).toBe(1_000_000);
		expect(result.tax).toBe(0);
		expect(result.unusedAllowance).toBe(0);
	});

	it('£1,000,001 with both bands transferred in full: 40p', () => {
		const result = inheritanceTax({
			estateValue: 1_000_001,
			residenceValue: 400_000,
			transferredNilRateBandPct: 100,
			transferredResidenceNilRateBandPct: 100
		});
		expect(result.taxableEstate).toBe(1);
		expect(result.tax).toBeCloseTo(0.4, PENNY);
	});

	it('£2,100,000 with a £500,000 home to children: £660,000 after a partial taper', () => {
		const result = inheritanceTax({ estateValue: 2_100_000, residenceValue: 500_000 });
		expect(result.allowances.taperLoss).toBe(50_000);
		expect(result.allowances.total).toBe(450_000);
		expect(result.taxableEstate).toBe(1_650_000);
		expect(result.tax).toBe(660_000);
		expect(result.taperApplies).toBe(true);
	});

	it('£2,350,000 with a £500,000 home to children: £810,000, the residence band gone', () => {
		const result = inheritanceTax({ estateValue: 2_350_000, residenceValue: 500_000 });
		expect(result.allowances.total).toBe(325_000);
		expect(result.taxableEstate).toBe(2_025_000);
		expect(result.tax).toBe(810_000);
	});

	it('£600,000 with a £120,000 home to children: £62,000, the band capped at the home', () => {
		const result = inheritanceTax({ estateValue: 600_000, residenceValue: 120_000 });
		expect(result.allowances.total).toBe(445_000);
		expect(result.taxableEstate).toBe(155_000);
		expect(result.tax).toBe(62_000);
	});

	it('£900,000 with £400,000 to a spouse and a £300,000 home to children: nothing', () => {
		const result = inheritanceTax({
			estateValue: 900_000,
			spouseExempt: 400_000,
			residenceValue: 300_000
		});
		expect(result.chargeableEstate).toBe(500_000);
		expect(result.allowances.total).toBe(500_000);
		expect(result.tax).toBe(0);
	});
});

describe('inheritanceTax', () => {
	it('charges 40% of whatever is above the bands, and nothing below them', () => {
		expect(inheritanceTax({ estateValue: 325_000 }).tax).toBe(0);
		expect(inheritanceTax({ estateValue: 425_000 }).tax).toBe(40_000);
		expect(inheritanceTax({ estateValue: 425_000 }).rate).toBe(IHT_RATE);
	});

	it('deducts liabilities before anything else', () => {
		const result = inheritanceTax({ estateValue: 800_000, liabilities: 300_000 });
		expect(result.grossEstate).toBe(800_000);
		expect(result.liabilities).toBe(300_000);
		expect(result.netEstate).toBe(500_000);
		expect(result.tax).toBe(70_000);
	});

	it('charges nothing on an estate that owes more than it owns', () => {
		const result = inheritanceTax({ estateValue: 100_000, liabilities: 400_000 });
		expect(result.netEstate).toBe(-300_000);
		expect(result.chargeableEstate).toBe(0);
		expect(result.tax).toBe(0);
		expect(result.effectiveRate).toBe(0);
	});

	it('charges nothing on an estate passing entirely to a spouse, however large', () => {
		const result = inheritanceTax({ estateValue: 5_000_000, spouseExempt: 5_000_000 });
		expect(result.tax).toBe(0);
		expect(result.netAfterTax).toBe(5_000_000);
	});

	it('charges nothing on an estate nobody has described', () => {
		const result = inheritanceTax();
		expect(result.chargeableEstate).toBe(0);
		expect(result.tax).toBe(0);
		expect(result.taperApplies).toBe(false);
	});

	it('reports the estate it actually calculated from', () => {
		const result = inheritanceTax({
			estateValue: /** @type {never} */ ('500000'),
			transferredNilRateBandPct: 250
		});
		expect(result.estate).toEqual({
			...DEFAULT_ESTATE,
			estateValue: 500_000,
			transferredNilRateBandPct: 100
		});
	});

	it('sets the residence band against the estate before the nil-rate band — convention 2', () => {
		const result = inheritanceTax({ estateValue: 400_000, residenceValue: 300_000 });
		expect(result.residenceNilRateBandUsed).toBe(175_000);
		expect(result.nilRateBandUsed).toBe(225_000);
		expect(result.unusedAllowance).toBe(100_000);
	});

	it('uses only as much of the bands as the estate needs', () => {
		const result = inheritanceTax({ estateValue: 100_000, residenceValue: 80_000 });
		expect(result.allowances.rnrb).toBe(80_000);
		expect(result.residenceNilRateBandUsed).toBe(80_000);
		expect(result.nilRateBandUsed).toBe(20_000);
		expect(result.unusedAllowance).toBe(305_000);
		expect(result.tax).toBe(0);
	});

	it('uses both bands in full once the estate is above them', () => {
		const result = inheritanceTax({ estateValue: 900_000, residenceValue: 300_000 });
		expect(result.residenceNilRateBandUsed).toBe(175_000);
		expect(result.nilRateBandUsed).toBe(325_000);
		expect(result.unusedAllowance).toBe(0);
		expect(result.taxableEstate).toBe(400_000);
	});

	it('keeps the effective rate below the headline 40%, because the bands are charged at nil', () => {
		const result = inheritanceTax({ estateValue: 1_000_000 });
		expect(result.effectiveRate).toBeCloseTo(27, THOUSANDTH);
		expect(result.effectiveRate).toBeLessThan(IHT_RATE);
	});

	it('flags the taper threshold on the net estate, not the chargeable one', () => {
		expect(inheritanceTax({ estateValue: 2_000_000 }).taperApplies).toBe(false);
		expect(inheritanceTax({ estateValue: 2_000_001 }).taperApplies).toBe(true);
		expect(inheritanceTax({ estateValue: 2_400_000, spouseExempt: 2_400_000 }).taperApplies).toBe(
			true
		);
	});

	it('labels the tax year, and takes another year’s bands and label — convention 6', () => {
		expect(inheritanceTax({ estateValue: 500_000 }).taxYear).toBe(IHT_TAX_YEAR);

		const later = inheritanceTax(
			{ estateValue: 500_000 },
			{ nrb: 400_000, rnrb: 200_000 },
			'2031/32'
		);
		expect(later.taxYear).toBe('2031/32');
		expect(later.taxableEstate).toBe(100_000);
		expect(later.tax).toBe(40_000);
	});

	it('rounds the bill to whole pence', () => {
		const result = inheritanceTax({ estateValue: 325_000.11 });
		expect(result.taxableEstate).toBeCloseTo(0.11, PENNY);
		expect(result.tax).toBeCloseTo(0.04, PENNY);
	});
});

/* -------------------------------------------------------------------------- */
/* The spousal transfer                                                        */
/* -------------------------------------------------------------------------- */

describe('transferableAllowances', () => {
	it('transfers both bands in full when everything passed to the survivor', () => {
		const transfer = transferableAllowances(
			inheritanceTax({ estateValue: 800_000, spouseExempt: 800_000 })
		);
		expect(transfer.nilRateBandPct).toBe(100);
		expect(transfer.residenceNilRateBandPct).toBe(100);
		expect(transfer.nilRateBand).toBe(325_000);
		expect(transfer.residenceNilRateBand).toBe(175_000);
		expect(transfer.total).toBe(500_000);
	});

	it('transfers what a first death left unused, as a percentage', () => {
		const transfer = transferableAllowances(inheritanceTax({ estateValue: 100_000 }));
		expect(transfer.nilRateBandPct).toBeCloseTo(69.231, THOUSANDTH);
		expect(transfer.nilRateBand).toBe(225_000);
	});

	it('transfers nothing of a band the first estate used up', () => {
		const transfer = transferableAllowances(inheritanceTax({ estateValue: 1_000_000 }));
		expect(transfer.nilRateBandPct).toBe(0);
		expect(transfer.nilRateBand).toBe(0);
	});

	it('transfers the residence band in full where the first estate had no home', () => {
		const transfer = transferableAllowances(inheritanceTax({ estateValue: 1_000_000 }));
		expect(transfer.residenceNilRateBandPct).toBe(100);
		expect(transfer.residenceNilRateBand).toBe(175_000);
	});

	it('preserves more nil-rate band where a home sheltered the estate — reading 1', () => {
		const transfer = transferableAllowances(
			inheritanceTax({ estateValue: 400_000, residenceValue: 300_000 })
		);
		expect(transfer.nilRateBandPct).toBeCloseTo(30.769, THOUSANDTH);
		expect(transfer.nilRateBand).toBe(100_000);
		expect(transfer.residenceNilRateBandPct).toBe(0);
	});

	it('transfers a residence band the taper had removed — reading 2', () => {
		const first = inheritanceTax({ estateValue: 2_400_000, residenceValue: 500_000 });
		expect(first.allowances.rnrb).toBe(0);

		const transfer = transferableAllowances(first);
		expect(transfer.residenceNilRateBandPct).toBe(100);
		expect(transfer.residenceNilRateBand).toBe(175_000);
	});

	it('caps each band at one extra, whatever the first estate itself was entitled to — reading 3', () => {
		const first = inheritanceTax({
			estateValue: 0,
			transferredNilRateBandPct: 100,
			transferredResidenceNilRateBandPct: 100
		});
		const transfer = transferableAllowances(first);
		expect(transfer.nilRateBandPct).toBe(100);
		expect(transfer.residenceNilRateBandPct).toBe(100);
	});

	it('transfers nothing where the first estate used more than its own band', () => {
		const first = inheritanceTax({ estateValue: 500_000, transferredNilRateBandPct: 100 });
		expect(first.nilRateBandUsed).toBe(500_000);
		expect(transferableAllowances(first).nilRateBandPct).toBe(0);
	});

	it('prices the transfer at whichever bands the survivor will be assessed against', () => {
		const first = inheritanceTax({ estateValue: 800_000, spouseExempt: 800_000 });
		const transfer = transferableAllowances(first, { nrb: 400_000, rnrb: 200_000 });
		expect(transfer.nilRateBandPct).toBe(100);
		expect(transfer.nilRateBand).toBe(400_000);
		expect(transfer.residenceNilRateBand).toBe(200_000);
		expect(transfer.total).toBe(600_000);
	});

	it('measures the percentage against the bands in force at the first death, not the second', () => {
		// Half of a £200,000 nil-rate band used at the first death is 50%, whatever the band has
		// become by the time the survivor dies.
		const first = inheritanceTax({ estateValue: 100_000 }, { nrb: 200_000, rnrb: 100_000 });
		expect(first.bands).toEqual({ nrb: 200_000, rnrb: 100_000 });

		const transfer = transferableAllowances(first);
		expect(transfer.nilRateBandPct).toBe(50);
		expect(transfer.nilRateBand).toBe(162_500);
		expect(transfer.residenceNilRateBandPct).toBe(100);
	});

	it('closes the loop: a first death to the spouse, then £1,000,000 free at the second', () => {
		const first = inheritanceTax({ estateValue: 600_000, spouseExempt: 600_000 });
		const transfer = transferableAllowances(first);

		const second = inheritanceTax({
			estateValue: 1_000_000,
			residenceValue: 400_000,
			transferredNilRateBandPct: transfer.nilRateBandPct,
			transferredResidenceNilRateBandPct: transfer.residenceNilRateBandPct
		});
		expect(second.allowances.total).toBe(1_000_000);
		expect(second.tax).toBe(0);
	});

	it('carries a partial transfer through to the second death', () => {
		const first = inheritanceTax({ estateValue: 100_000 });
		const transfer = transferableAllowances(first);

		const second = inheritanceTax({
			estateValue: 800_000,
			transferredNilRateBandPct: transfer.nilRateBandPct
		});
		expect(second.allowances.nrb).toBe(550_000);
		expect(second.taxableEstate).toBe(250_000);
		expect(second.tax).toBe(100_000);
	});
});
