import { describe, expect, it } from 'vitest';

import { IHT_RATE, NIL_RATE_BAND, RESIDENCE_NIL_RATE_BAND, inheritanceTax } from './estate.js';
import {
	ANNUAL_EXEMPTION,
	ANNUAL_EXEMPTION_CARRY_FORWARD_YEARS,
	DEFAULT_GIFT,
	GIFT_EXEMPTIONS,
	GIFT_EXEMPTION_LABELS,
	GIFT_STATUSES,
	GIFT_STATUS_LABELS,
	GIFT_TAX_YEAR,
	PET_SURVIVAL_YEARS,
	SMALL_GIFT_EXEMPTION,
	TAPER_RELIEF_BANDS,
	WEDDING_GIFT_EXEMPTIONS,
	createGift,
	giftCountdown,
	giftExemptOn,
	giftTaxYear,
	inheritanceTaxWithGifts,
	lifetimeGiftLedger,
	normaliseGift,
	normaliseGifts,
	taperReliefBand,
	transferableAllowancesAfterGifts,
	yearsBetween
} from './lifetime-gifts.js';

/** Values are money, so compare to the penny rather than to floating-point exactness. */
const PENNY = 0.005;

/**
 * Every worked example is run against one death, so the gift dates below can be read as
 * "N years before the death" at a glance.
 */
const DEATH = '2026-06-01';

/** The annual exemption is a separate concern from the taper — most examples switch it off. */
const NO_ANNUAL_EXEMPTION = { deathDate: DEATH, applyAnnualExemption: false };

/**
 * @param {Partial<import('./lifetime-gifts.js').Gift>} overrides
 * @returns {import('./lifetime-gifts.js').Gift}
 */
function gift(overrides) {
	return createGift(overrides);
}

/* -------------------------------------------------------------------------- */
/* Statutory figures                                                           */
/* -------------------------------------------------------------------------- */

describe('statutory figures', () => {
	it('states the seven-year period and the exemptions', () => {
		expect(PET_SURVIVAL_YEARS).toBe(7);
		expect(ANNUAL_EXEMPTION).toBe(3_000);
		expect(ANNUAL_EXEMPTION_CARRY_FORWARD_YEARS).toBe(1);
		expect(SMALL_GIFT_EXEMPTION).toBe(250);
		expect(WEDDING_GIFT_EXEMPTIONS).toEqual({
			wedding_child: 5_000,
			wedding_grandchild: 2_500,
			wedding_other: 1_000
		});
	});

	it('belongs to the same tax year as estate.js', () => {
		expect(GIFT_TAX_YEAR).toBe('2026/27');
	});

	it('states the HMRC taper table exactly — IHTA 1984 s.7(4)', () => {
		expect(TAPER_RELIEF_BANDS.map((band) => band.maxYears)).toEqual([3, 4, 5, 6, 7, null]);
		expect(TAPER_RELIEF_BANDS.map((band) => band.statutoryRatePct)).toEqual([
			100, 80, 60, 40, 20, 0
		]);
		expect(TAPER_RELIEF_BANDS.map((band) => band.reliefPct)).toEqual([0, 20, 40, 60, 80, 100]);
	});

	it('states the same table in gov.uk’s effective-rate form — 40% down to 0%', () => {
		expect(TAPER_RELIEF_BANDS.map((band) => band.effectiveRatePct)).toEqual([40, 32, 24, 16, 8, 0]);
	});

	it('derives every effective rate from estate.js’s 40%, not from a second copy of it', () => {
		for (const band of TAPER_RELIEF_BANDS) {
			expect(band.effectiveRatePct).toBeCloseTo((IHT_RATE * band.statutoryRatePct) / 100, 10);
			expect(band.reliefPct).toBe(100 - band.statutoryRatePct);
		}
	});

	it('flags the final row as exemption rather than taper relief', () => {
		expect(TAPER_RELIEF_BANDS.filter((band) => band.exempt)).toHaveLength(1);
		expect(TAPER_RELIEF_BANDS[TAPER_RELIEF_BANDS.length - 1].exempt).toBe(true);
	});

	it('freezes the table and its rows', () => {
		expect(Object.isFrozen(TAPER_RELIEF_BANDS)).toBe(true);
		expect(TAPER_RELIEF_BANDS.every((band) => Object.isFrozen(band))).toBe(true);
	});

	it('labels every exemption and every status', () => {
		for (const code of GIFT_EXEMPTIONS) expect(GIFT_EXEMPTION_LABELS[code]).toBeTruthy();
		for (const code of GIFT_STATUSES) expect(GIFT_STATUS_LABELS[code]).toBeTruthy();
		expect(Object.keys(GIFT_EXEMPTION_LABELS).sort()).toEqual([...GIFT_EXEMPTIONS].sort());
		expect(Object.keys(GIFT_STATUS_LABELS).sort()).toEqual([...GIFT_STATUSES].sort());
	});
});

/* -------------------------------------------------------------------------- */
/* Calendar arithmetic                                                         */
/* -------------------------------------------------------------------------- */

describe('yearsBetween', () => {
	it('counts complete calendar years', () => {
		expect(yearsBetween('2020-01-01', '2026-06-01')).toEqual({
			years: 6,
			onAnniversary: false,
			days: 2343
		});
	});

	it('flags an exact anniversary — the difference between two statutory bands', () => {
		expect(yearsBetween('2019-06-01', '2026-06-01')).toMatchObject({
			years: 7,
			onAnniversary: true
		});
		expect(yearsBetween('2019-05-31', '2026-06-01')).toMatchObject({
			years: 7,
			onAnniversary: false
		});
	});

	it('does not round a day short of an anniversary up', () => {
		expect(yearsBetween('2019-06-02', '2026-06-01')).toMatchObject({
			years: 6,
			onAnniversary: false
		});
	});

	it('is zero on the day of the gift', () => {
		expect(yearsBetween('2026-06-01', '2026-06-01')).toEqual({
			years: 0,
			onAnniversary: true,
			days: 0
		});
	});

	it('falls 29 February back to 28 February in a non-leap year', () => {
		expect(yearsBetween('2020-02-29', '2027-02-28')).toMatchObject({
			years: 7,
			onAnniversary: true
		});
		expect(yearsBetween('2020-02-29', '2027-02-27')).toMatchObject({ years: 6 });
		expect(giftExemptOn('2020-02-29')).toBe('2027-02-28');
	});

	it('returns null when the second date is before the first', () => {
		expect(yearsBetween('2026-06-02', '2026-06-01')).toBeNull();
	});

	it('returns null for anything that is not a calendar-valid ISO date', () => {
		expect(yearsBetween('2026-02-30', '2026-06-01')).toBeNull();
		expect(yearsBetween('01/06/2026', '2026-06-01')).toBeNull();
		expect(yearsBetween('2026-13-01', '2026-06-01')).toBeNull();
		expect(yearsBetween('2026-6-1', '2026-06-01')).toBeNull();
		expect(yearsBetween(/** @type {never} */ (null), '2026-06-01')).toBeNull();
	});

	it('completes a 29 February year on 28 February, and rejects a fake 29th', () => {
		expect(yearsBetween('2024-02-29', '2025-02-28')).toMatchObject({
			years: 1,
			onAnniversary: true
		});
		expect(yearsBetween('2024-02-29', '2025-02-27')).toMatchObject({ years: 0 });
		expect(yearsBetween('2023-02-29', '2026-06-01')).toBeNull();
	});
});

describe('giftExemptOn', () => {
	it('is the seventh anniversary, which is itself early enough', () => {
		expect(giftExemptOn('2019-06-01')).toBe('2026-06-01');
		expect(yearsBetween('2019-06-01', '2026-06-01')?.years).toBe(PET_SURVIVAL_YEARS);
	});

	it('is null for an unparseable date', () => {
		expect(giftExemptOn('nonsense')).toBeNull();
	});
});

describe('giftTaxYear', () => {
	it('runs 6 April to 5 April', () => {
		expect(giftTaxYear('2026-04-05')).toBe('2025/26');
		expect(giftTaxYear('2026-04-06')).toBe('2026/27');
		expect(giftTaxYear('2026-12-31')).toBe('2026/27');
		expect(giftTaxYear('2027-01-01')).toBe('2026/27');
		expect(giftTaxYear('2027-04-05')).toBe('2026/27');
	});

	it('pads the second half of a century boundary', () => {
		expect(giftTaxYear('2099-06-01')).toBe('2099/00');
		expect(giftTaxYear('2009-06-01')).toBe('2009/10');
	});

	it('is null for an unparseable date', () => {
		expect(giftTaxYear('')).toBeNull();
	});
});

/* -------------------------------------------------------------------------- */
/* The taper bands                                                             */
/* -------------------------------------------------------------------------- */

describe('taperReliefBand', () => {
	it('gives no relief within three years', () => {
		expect(taperReliefBand(0).reliefPct).toBe(0);
		expect(taperReliefBand(2).reliefPct).toBe(0);
		expect(taperReliefBand(2, true).reliefPct).toBe(0);
	});

	it('treats exactly three years as "not more than 3" — still the full 40%', () => {
		expect(taperReliefBand(3, true).effectiveRatePct).toBe(40);
		expect(taperReliefBand(3, true).reliefPct).toBe(0);
	});

	it('moves into the 3-to-4 band a day past the third anniversary', () => {
		expect(taperReliefBand(3, false).reliefPct).toBe(20);
		expect(taperReliefBand(3, false).effectiveRatePct).toBe(32);
	});

	it('steps 20/40/60/80 through the remaining bands', () => {
		expect(taperReliefBand(4, false).reliefPct).toBe(40);
		expect(taperReliefBand(5, false).reliefPct).toBe(60);
		expect(taperReliefBand(6, false).reliefPct).toBe(80);
	});

	it('holds each band open to its own anniversary', () => {
		expect(taperReliefBand(4, true).reliefPct).toBe(20);
		expect(taperReliefBand(5, true).reliefPct).toBe(40);
		expect(taperReliefBand(6, true).reliefPct).toBe(60);
		expect(taperReliefBand(7, true).exempt).toBe(true);
	});

	it('is exempt from seven years, inclusive — s.3A(4) beats s.7(4)', () => {
		expect(taperReliefBand(7, true).exempt).toBe(true);
		expect(taperReliefBand(7, false).exempt).toBe(true);
		expect(taperReliefBand(20).exempt).toBe(true);
		expect(taperReliefBand(6, false).exempt).toBe(false);
	});
});

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

describe('normaliseGift', () => {
	it('fills an empty object in with the defaults', () => {
		const normalised = normaliseGift();
		expect(normalised).toMatchObject(DEFAULT_GIFT);
		expect(normalised.id).toMatch(/^gift_/);
	});

	it('keeps an existing id and mints a missing one', () => {
		expect(normaliseGift({ id: 'gift_kept' }).id).toBe('gift_kept');
		expect(normaliseGift({ id: '' }).id).toMatch(/^gift_/);
	});

	it('floors a negative amount at zero and parses a numeric string', () => {
		expect(normaliseGift({ amount: -500 }).amount).toBe(0);
		expect(normaliseGift({ amount: /** @type {never} */ ('12500') }).amount).toBe(12_500);
		expect(normaliseGift({ amount: /** @type {never} */ ('nonsense') }).amount).toBe(0);
	});

	it('reads an unusable date as null rather than coercing it', () => {
		expect(normaliseGift({ date: '2026-02-30' }).date).toBeNull();
		expect(normaliseGift({ date: /** @type {never} */ (20260601) }).date).toBeNull();
		expect(normaliseGift({ date: '2026-06-01' }).date).toBe('2026-06-01');
	});

	it('reads an unrecognised exemption as none — the chargeable reading', () => {
		expect(normaliseGift({ exemption: /** @type {never} */ ('spousal') }).exemption).toBe('none');
		expect(normaliseGift({ exemption: 'charity' }).exemption).toBe('charity');
	});

	it('normalises a whole list, and anything that is not one to an empty list', () => {
		expect(normaliseGifts([{ amount: 1 }, { amount: 2 }])).toHaveLength(2);
		expect(normaliseGifts(undefined)).toEqual([]);
		expect(normaliseGifts(null)).toEqual([]);
		expect(normaliseGifts(/** @type {never} */ ('not a list'))).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* Worked examples — the ones the module comment prints                        */
/* -------------------------------------------------------------------------- */

describe('worked examples', () => {
	it('£400,000 gifted 4½ years before death → £18,000, after 40% taper relief', () => {
		// £400,000 - £325,000 band = £75,000 taxable; × 40% = £30,000; less 40% relief = £18,000.
		const ledger = lifetimeGiftLedger(
			[gift({ date: '2021-12-01', amount: 400_000, recipient: 'Daughter' })],
			NO_ANNUAL_EXEMPTION
		);

		const [assessed] = ledger.gifts;
		expect(assessed.status).toBe('failed');
		expect(assessed.yearsSurvived).toBe(4);
		expect(assessed.taperReliefPct).toBe(40);
		expect(assessed.effectiveRatePct).toBe(24);
		expect(assessed.nilRateBandUsed).toBeCloseTo(325_000, PENNY);
		expect(assessed.taxableValue).toBeCloseTo(75_000, PENNY);
		expect(assessed.taxBeforeTaper).toBeCloseTo(30_000, PENNY);
		expect(assessed.taperRelief).toBeCloseTo(12_000, PENNY);
		expect(assessed.tax).toBeCloseTo(18_000, PENNY);

		expect(ledger.tax).toBeCloseTo(18_000, PENNY);
		expect(ledger.nilRateBandRemaining).toBe(0);
	});

	it('£300,000 gifted 6½ years before death → no gift tax, and £25,000 of band left over', () => {
		// Convention 1: the band covers the gift, so 80% of a nil bill is still nil — and the whole
		// £300,000 has still been taken out of the band the estate was going to use.
		const ledger = lifetimeGiftLedger(
			[gift({ date: '2019-12-01', amount: 300_000, recipient: 'Son' })],
			NO_ANNUAL_EXEMPTION
		);

		const [assessed] = ledger.gifts;
		expect(assessed.status).toBe('failed');
		expect(assessed.taperReliefPct).toBe(80);
		expect(assessed.nilRateBandUsed).toBeCloseTo(300_000, PENNY);
		expect(assessed.taxBeforeTaper).toBe(0);
		expect(assessed.taperRelief).toBe(0);
		expect(assessed.tax).toBe(0);
		expect(ledger.nilRateBandRemaining).toBeCloseTo(25_000, PENNY);
	});

	it('two gifts: the old one takes the band, the recent one pays at the full 40% → £30,000', () => {
		// 2019-07-01 is 6y11m before the death (80% relief, but no tax to relieve);
		// 2024-07-01 is 1y11m (no relief at all) and is left with £75,000 above the band.
		const ledger = lifetimeGiftLedger(
			[
				gift({ date: '2024-07-01', amount: 200_000, recipient: 'Son' }),
				gift({ date: '2019-07-01', amount: 200_000, recipient: 'Daughter' })
			],
			NO_ANNUAL_EXEMPTION
		);

		expect(ledger.gifts.map((entry) => entry.date)).toEqual(['2019-07-01', '2024-07-01']);

		const [older, newer] = ledger.gifts;
		expect(older.taperReliefPct).toBe(80);
		expect(older.nilRateBandUsed).toBeCloseTo(200_000, PENNY);
		expect(older.tax).toBe(0);

		expect(newer.taperReliefPct).toBe(0);
		expect(newer.nilRateBandUsed).toBeCloseTo(125_000, PENNY);
		expect(newer.taxableValue).toBeCloseTo(75_000, PENNY);
		expect(newer.tax).toBeCloseTo(30_000, PENNY);

		expect(ledger.chargeableTransfers).toBeCloseTo(400_000, PENNY);
		expect(ledger.tax).toBeCloseTo(30_000, PENNY);
		expect(ledger.nilRateBandRemaining).toBe(0);
	});

	it('£500,000 gifted seven years to the day before death → out of account, band intact', () => {
		const ledger = lifetimeGiftLedger(
			[gift({ date: '2019-06-01', amount: 500_000, recipient: 'Son' })],
			NO_ANNUAL_EXEMPTION
		);

		const [assessed] = ledger.gifts;
		expect(assessed.status).toBe('survived');
		expect(assessed.yearsSurvived).toBe(7);
		expect(assessed.onAnniversary).toBe(true);
		expect(assessed.taperBand.exempt).toBe(true);
		expect(assessed.effectiveRatePct).toBe(0);
		expect(assessed.nilRateBandUsed).toBe(0);
		expect(assessed.daysUntilExempt).toBe(0);

		expect(ledger.tax).toBe(0);
		expect(ledger.totalSurvived).toBeCloseTo(500_000, PENNY);
		expect(ledger.nilRateBandRemaining).toBeCloseTo(NIL_RATE_BAND, PENNY);
	});

	it('one day short of seven years is a failed gift, not an exempt one', () => {
		const ledger = lifetimeGiftLedger(
			[gift({ date: '2019-06-02', amount: 500_000, recipient: 'Son' })],
			NO_ANNUAL_EXEMPTION
		);

		const [assessed] = ledger.gifts;
		expect(assessed.status).toBe('failed');
		expect(assessed.yearsSurvived).toBe(6);
		expect(assessed.taperReliefPct).toBe(80);
		// £175,000 above the band, taxed at 40% then relieved by 80% → 8% of £175,000.
		expect(assessed.taxableValue).toBeCloseTo(175_000, PENNY);
		expect(assessed.tax).toBeCloseTo(14_000, PENNY);
		expect(assessed.daysUntilExempt).toBe(1);
		expect(ledger.nextToFallOut).toBe('2026-06-02');
		expect(ledger.daysToNextFallOut).toBe(1);
	});

	it('£6,000 in the first recorded tax year is wholly exempt — £3,000 plus one year forward', () => {
		const ledger = lifetimeGiftLedger([gift({ date: '2024-07-01', amount: 6_000 })], {
			deathDate: DEATH
		});

		const [assessed] = ledger.gifts;
		expect(assessed.annualExemption).toBeCloseTo(6_000, PENNY);
		expect(assessed.chargeableValue).toBe(0);
		expect(assessed.status).toBe('exempt');
		expect(ledger.chargeableTransfers).toBe(0);
	});

	it('£15,000 to a child on their wedding → £5,000 s.22 + £6,000 s.19, £4,000 chargeable', () => {
		const ledger = lifetimeGiftLedger(
			[
				gift({
					date: '2024-07-01',
					amount: 15_000,
					recipient: 'Daughter',
					exemption: 'wedding_child'
				})
			],
			{ deathDate: DEATH }
		);

		const [assessed] = ledger.gifts;
		expect(assessed.declaredExemption).toBeCloseTo(5_000, PENNY);
		expect(assessed.annualExemption).toBeCloseTo(6_000, PENNY);
		expect(assessed.exemptAmount).toBeCloseTo(11_000, PENNY);
		expect(assessed.chargeableValue).toBeCloseTo(4_000, PENNY);
		expect(assessed.status).toBe('failed');
	});
});

/* -------------------------------------------------------------------------- */
/* Taper relief                                                                */
/* -------------------------------------------------------------------------- */

describe('taper relief', () => {
	/**
	 * One £525,000 gift leaves exactly £200,000 above the £325,000 band, so the tax before relief is
	 * a round £80,000 and each band's effective rate reads straight off the result.
	 *
	 * @param {string} date
	 * @returns {import('./lifetime-gifts.js').GiftAssessment}
	 */
	function taperedGift(date) {
		return lifetimeGiftLedger([gift({ date, amount: 525_000 })], NO_ANNUAL_EXEMPTION).gifts[0];
	}

	it('charges the full 40% within three years', () => {
		const assessed = taperedGift('2024-06-01');
		expect(assessed.taxBeforeTaper).toBeCloseTo(80_000, PENNY);
		expect(assessed.taperRelief).toBe(0);
		expect(assessed.tax).toBeCloseTo(80_000, PENNY);
	});

	it('walks the whole table down to 8%', () => {
		expect(taperedGift('2023-06-01').tax).toBeCloseTo(80_000, PENNY); // exactly 3 years → 40%
		expect(taperedGift('2023-05-31').tax).toBeCloseTo(64_000, PENNY); // 3y+ → 32%
		expect(taperedGift('2022-05-31').tax).toBeCloseTo(48_000, PENNY); // 4y+ → 24%
		expect(taperedGift('2021-05-31').tax).toBeCloseTo(32_000, PENNY); // 5y+ → 16%
		expect(taperedGift('2020-05-31').tax).toBeCloseTo(16_000, PENNY); // 6y+ → 8%
		expect(taperedGift('2019-05-31').tax).toBe(0); // 7y+ → exempt
	});

	it('relieves the tax, never the value — the band still loses the whole gift', () => {
		const assessed = taperedGift('2020-05-31');
		expect(assessed.taperReliefPct).toBe(80);
		expect(assessed.chargeableValue).toBeCloseTo(525_000, PENNY);
		expect(assessed.nilRateBandUsed).toBeCloseTo(325_000, PENNY);
	});

	it('gives nothing to a gift the band already covers, however long ago it was', () => {
		const covered = lifetimeGiftLedger(
			[gift({ date: '2020-05-31', amount: 100_000 })],
			NO_ANNUAL_EXEMPTION
		).gifts[0];

		expect(covered.taperReliefPct).toBe(80);
		expect(covered.taperRelief).toBe(0);
		expect(covered.tax).toBe(0);
	});

	it('reports the relief given as a total on the ledger', () => {
		const ledger = lifetimeGiftLedger([gift({ date: '2020-05-31', amount: 525_000 })], {
			...NO_ANNUAL_EXEMPTION
		});

		expect(ledger.taxBeforeTaper).toBeCloseTo(80_000, PENNY);
		expect(ledger.taperRelief).toBeCloseTo(64_000, PENNY);
		expect(ledger.tax).toBeCloseTo(16_000, PENNY);
	});

	it('takes the rate as a parameter, like estate.js takes its bands', () => {
		const ledger = lifetimeGiftLedger([gift({ date: '2025-06-01', amount: 525_000 })], {
			...NO_ANNUAL_EXEMPTION,
			rate: 20
		});

		expect(ledger.rate).toBe(20);
		expect(ledger.tax).toBeCloseTo(40_000, PENNY);
	});
});

/* -------------------------------------------------------------------------- */
/* Cumulation against the nil-rate band                                        */
/* -------------------------------------------------------------------------- */

describe('cumulation', () => {
	it('runs oldest first and reports the running total', () => {
		const ledger = lifetimeGiftLedger(
			[
				gift({ date: '2023-01-01', amount: 150_000 }),
				gift({ date: '2021-01-01', amount: 150_000 }),
				gift({ date: '2025-01-01', amount: 150_000 })
			],
			NO_ANNUAL_EXEMPTION
		);

		expect(ledger.gifts.map((entry) => entry.cumulativeChargeable)).toEqual([
			150_000, 300_000, 450_000
		]);
		expect(ledger.gifts.map((entry) => entry.nilRateBandUsed)).toEqual([150_000, 150_000, 25_000]);
		// Only the newest gift is left exposed, and it gets no taper relief.
		expect(ledger.gifts[2].taxableValue).toBeCloseTo(125_000, PENNY);
		expect(ledger.gifts[2].taperReliefPct).toBe(0);
		expect(ledger.tax).toBeCloseTo(50_000, PENNY);
	});

	it('skips gifts that were survived — they never touch the band', () => {
		const ledger = lifetimeGiftLedger(
			[
				gift({ date: '2015-01-01', amount: 400_000 }),
				gift({ date: '2025-01-01', amount: 100_000 })
			],
			NO_ANNUAL_EXEMPTION
		);

		expect(ledger.survivedCount).toBe(1);
		expect(ledger.failedCount).toBe(1);
		expect(ledger.chargeableTransfers).toBeCloseTo(100_000, PENNY);
		expect(ledger.nilRateBandUsed).toBeCloseTo(100_000, PENNY);
		expect(ledger.nilRateBandRemaining).toBeCloseTo(225_000, PENNY);
	});

	it('takes the band it is given, so a transferred band shelters more', () => {
		const gifts = [gift({ date: '2025-01-01', amount: 500_000 })];

		expect(lifetimeGiftLedger(gifts, { ...NO_ANNUAL_EXEMPTION, nilRateBand: 650_000 }).tax).toBe(0);
		expect(
			lifetimeGiftLedger(gifts, { ...NO_ANNUAL_EXEMPTION, nilRateBand: 325_000 }).tax
		).toBeCloseTo(70_000, PENNY);
	});

	it('defaults the band to estate.js’s statutory £325,000', () => {
		expect(lifetimeGiftLedger([], { deathDate: DEATH }).nilRateBand).toBe(NIL_RATE_BAND);
	});

	it('is an empty ledger when nothing has been given away', () => {
		const ledger = lifetimeGiftLedger(undefined, { deathDate: DEATH });

		expect(ledger.gifts).toEqual([]);
		expect(ledger.tax).toBe(0);
		expect(ledger.totalGifted).toBe(0);
		expect(ledger.nilRateBandRemaining).toBe(NIL_RATE_BAND);
		expect(ledger.nextToFallOut).toBeNull();
		expect(ledger.daysToNextFallOut).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Exemptions                                                                  */
/* -------------------------------------------------------------------------- */

describe('the annual exemption', () => {
	it('gives £3,000 a year and carries one year forward, current year first', () => {
		const ledger = lifetimeGiftLedger(
			[
				gift({ date: '2023-05-01', amount: 10_000, recipient: 'Son' }),
				gift({ date: '2024-05-01', amount: 10_000, recipient: 'Son' })
			],
			{ deathDate: DEATH }
		);

		// 2023/24: its own £3,000 plus £3,000 brought into the earliest recorded year.
		expect(ledger.gifts[0].annualExemption).toBeCloseTo(6_000, PENNY);
		// 2024/25: its own £3,000 only — 2023/24's was fully used.
		expect(ledger.gifts[1].annualExemption).toBeCloseTo(3_000, PENNY);
		expect(ledger.annualExemptionUsed).toBeCloseTo(9_000, PENNY);
	});

	it('carries forward only what the previous year did not use', () => {
		const ledger = lifetimeGiftLedger(
			[gift({ date: '2023-05-01', amount: 1_000 }), gift({ date: '2024-05-01', amount: 10_000 })],
			{ deathDate: DEATH, carriedForwardAnnualExemption: 0 }
		);

		expect(ledger.gifts[0].annualExemption).toBeCloseTo(1_000, PENNY);
		// £3,000 of 2024/25's own, plus the £2,000 of 2023/24's that was left over.
		expect(ledger.gifts[1].annualExemption).toBeCloseTo(5_000, PENNY);
	});

	it('carries forward nothing where the previous year used its own £3,000 in full', () => {
		const ledger = lifetimeGiftLedger(
			[gift({ date: '2023-05-01', amount: 4_000 }), gift({ date: '2024-05-01', amount: 10_000 })],
			{ deathDate: DEATH, carriedForwardAnnualExemption: 0 }
		);

		expect(ledger.gifts[0].annualExemption).toBeCloseTo(3_000, PENNY);
		expect(ledger.gifts[1].annualExemption).toBeCloseTo(3_000, PENNY);
	});

	it('carries forward one year only — a two-year gap brings £3,000, not £6,000', () => {
		const ledger = lifetimeGiftLedger(
			[gift({ date: '2021-05-01', amount: 100 }), gift({ date: '2024-05-01', amount: 10_000 })],
			{ deathDate: DEATH, carriedForwardAnnualExemption: 0 }
		);

		expect(ledger.gifts[1].annualExemption).toBeCloseTo(6_000, PENNY);
	});

	it('spends the year’s exemption on the earliest gifts, not the largest', () => {
		const ledger = lifetimeGiftLedger(
			[
				gift({ date: '2024-05-01', amount: 5_000, description: 'first' }),
				gift({ date: '2024-09-01', amount: 50_000, description: 'second' })
			],
			{ deathDate: DEATH, carriedForwardAnnualExemption: 0 }
		);

		expect(ledger.gifts[0].annualExemption).toBeCloseTo(3_000, PENNY);
		expect(ledger.gifts[1].annualExemption).toBe(0);
	});

	it('is used by a gift already seven years old, leaving less for a later one', () => {
		const ledger = lifetimeGiftLedger(
			[gift({ date: '2018-05-01', amount: 20_000 }), gift({ date: '2019-01-01', amount: 20_000 })],
			{ deathDate: DEATH, carriedForwardAnnualExemption: 0 }
		);

		// Both fall in 2018/19; the first takes the whole £3,000 even though it is out of account.
		expect(ledger.gifts[0].annualExemption).toBeCloseTo(3_000, PENNY);
		expect(ledger.gifts[1].annualExemption).toBe(0);
	});

	it('respects the 6 April boundary', () => {
		const ledger = lifetimeGiftLedger(
			[gift({ date: '2024-04-05', amount: 3_000 }), gift({ date: '2024-04-06', amount: 3_000 })],
			{ deathDate: DEATH, carriedForwardAnnualExemption: 0 }
		);

		expect(ledger.gifts[0].taxYear).toBe('2023/24');
		expect(ledger.gifts[1].taxYear).toBe('2024/25');
		expect(ledger.totalExempt).toBeCloseTo(6_000, PENNY);
	});

	it('can be switched off for figures that are already net of it', () => {
		const ledger = lifetimeGiftLedger([gift({ date: '2024-05-01', amount: 10_000 })], {
			deathDate: DEATH,
			applyAnnualExemption: false
		});

		expect(ledger.gifts[0].annualExemption).toBe(0);
		expect(ledger.gifts[0].chargeableValue).toBeCloseTo(10_000, PENNY);
	});

	it('clamps the brought-forward option to a single year’s worth', () => {
		const ledger = lifetimeGiftLedger([gift({ date: '2024-05-01', amount: 50_000 })], {
			deathDate: DEATH,
			carriedForwardAnnualExemption: 999_999
		});

		expect(ledger.gifts[0].annualExemption).toBeCloseTo(6_000, PENNY);
	});
});

describe('the declared exemptions', () => {
	it('exempts a gift to a spouse, a charity or out of normal income entirely', () => {
		for (const exemption of /** @type {const} */ (['spouse', 'charity', 'normal_expenditure'])) {
			const ledger = lifetimeGiftLedger(
				[gift({ date: '2025-05-01', amount: 400_000, exemption })],
				{ deathDate: DEATH }
			);

			expect(ledger.gifts[0].declaredExemption).toBeCloseTo(400_000, PENNY);
			expect(ledger.gifts[0].chargeableValue).toBe(0);
			expect(ledger.gifts[0].status).toBe('exempt');
			// It is exempt on its own account and must not also eat the £3,000.
			expect(ledger.gifts[0].annualExemption).toBe(0);
			expect(ledger.annualExemptionUsed).toBe(0);
		}
	});

	it('caps a wedding gift at its own limit and lets the excess be a PET', () => {
		const ledger = lifetimeGiftLedger(
			[
				gift({ date: '2025-05-01', amount: 4_000, exemption: 'wedding_grandchild' }),
				gift({ date: '2025-06-01', amount: 4_000, exemption: 'wedding_other' })
			],
			{ deathDate: DEATH, applyAnnualExemption: false }
		);

		expect(ledger.gifts[0].declaredExemption).toBeCloseTo(2_500, PENNY);
		expect(ledger.gifts[0].chargeableValue).toBeCloseTo(1_500, PENNY);
		expect(ledger.gifts[1].declaredExemption).toBeCloseTo(1_000, PENNY);
		expect(ledger.gifts[1].chargeableValue).toBeCloseTo(3_000, PENNY);
	});

	it('exempts a small gift of £250 or less', () => {
		const ledger = lifetimeGiftLedger(
			[gift({ date: '2025-05-01', amount: 250, recipient: 'Niece', exemption: 'small' })],
			{ deathDate: DEATH }
		);

		expect(ledger.gifts[0].exemptionApplied).toBe('small');
		expect(ledger.gifts[0].declaredExemption).toBeCloseTo(250, PENNY);
		expect(ledger.gifts[0].annualExemption).toBe(0);
	});

	it('is all-or-nothing above £250 — it cannot cover the first slice of a bigger gift', () => {
		const ledger = lifetimeGiftLedger(
			[gift({ date: '2025-05-01', amount: 1_000, recipient: 'Niece', exemption: 'small' })],
			{ deathDate: DEATH, applyAnnualExemption: false }
		);

		expect(ledger.gifts[0].exemptionApplied).toBe('none');
		expect(ledger.gifts[0].declaredExemption).toBe(0);
		expect(ledger.gifts[0].chargeableValue).toBeCloseTo(1_000, PENNY);
	});

	it('counts the £250 per recipient per tax year', () => {
		const ledger = lifetimeGiftLedger(
			[
				gift({ date: '2025-05-01', amount: 200, recipient: 'Niece', exemption: 'small' }),
				gift({ date: '2025-06-01', amount: 200, recipient: 'Niece', exemption: 'small' }),
				gift({ date: '2025-06-01', amount: 200, recipient: 'Nephew', exemption: 'small' })
			],
			{ deathDate: DEATH, applyAnnualExemption: false }
		);

		expect(ledger.gifts[0].exemptionApplied).toBe('small');
		// The second gift to the same person takes them over £250 in the year.
		expect(ledger.gifts[1].exemptionApplied).toBe('none');
		// A different person has their own £250.
		expect(ledger.gifts[2].exemptionApplied).toBe('small');
	});

	it('bars a small gift to someone who has already had annual exemption that year', () => {
		const ledger = lifetimeGiftLedger(
			[
				gift({ date: '2025-05-01', amount: 5_000, recipient: 'Niece' }),
				gift({ date: '2025-06-01', amount: 100, recipient: 'Niece', exemption: 'small' })
			],
			{ deathDate: DEATH }
		);

		expect(ledger.gifts[0].annualExemption).toBeGreaterThan(0);
		expect(ledger.gifts[1].exemptionApplied).toBe('none');
	});

	it('matches recipients case- and whitespace-insensitively', () => {
		const ledger = lifetimeGiftLedger(
			[
				gift({ date: '2025-05-01', amount: 200, recipient: 'Niece', exemption: 'small' }),
				gift({ date: '2025-06-01', amount: 200, recipient: ' niece ', exemption: 'small' })
			],
			{ deathDate: DEATH, applyAnnualExemption: false }
		);

		expect(ledger.gifts[1].exemptionApplied).toBe('none');
	});
});

/* -------------------------------------------------------------------------- */
/* Statuses and the countdown                                                  */
/* -------------------------------------------------------------------------- */

describe('statuses', () => {
	it('reports an undated gift rather than guessing at it', () => {
		const ledger = lifetimeGiftLedger([gift({ amount: 100_000 })], { deathDate: DEATH });

		expect(ledger.gifts[0].status).toBe('undated');
		expect(ledger.gifts[0].chargeableValue).toBe(0);
		expect(ledger.gifts[0].taxYear).toBeNull();
		expect(ledger.tax).toBe(0);
		// It is still counted as given away, so the total does not silently lose it.
		expect(ledger.totalGifted).toBeCloseTo(100_000, PENNY);
	});

	it('reports a gift dated after the death and charges nothing on it', () => {
		const ledger = lifetimeGiftLedger([gift({ date: '2026-06-02', amount: 100_000 })], {
			deathDate: DEATH
		});

		expect(ledger.gifts[0].status).toBe('after_death');
		expect(ledger.gifts[0].chargeableValue).toBe(0);
		expect(ledger.gifts[0].annualExemption).toBe(0);
	});

	it('sorts undated gifts last and keeps entry order within one day', () => {
		const ledger = lifetimeGiftLedger(
			[
				gift({ date: '2025-01-01', amount: 1, description: 'b' }),
				gift({ amount: 2, description: 'undated' }),
				gift({ date: '2025-01-01', amount: 3, description: 'c' }),
				gift({ date: '2020-01-01', amount: 4, description: 'a' })
			],
			{ deathDate: DEATH }
		);

		expect(ledger.gifts.map((entry) => entry.description)).toEqual(['a', 'b', 'c', 'undated']);
		expect(ledger.gifts.map((entry) => entry.index)).toEqual([3, 0, 2, 1]);
	});
});

describe('giftCountdown', () => {
	it('lists only the gifts still counting, soonest to fall out first', () => {
		const rows = giftCountdown(
			[
				gift({ date: '2010-01-01', amount: 100_000, description: 'long gone' }),
				gift({ date: '2024-01-01', amount: 100_000, description: 'recent' }),
				gift({ date: '2020-01-01', amount: 100_000, description: 'older' }),
				gift({ date: '2025-01-01', amount: 2_000, description: 'covered by the £3,000' })
			],
			{ deathDate: DEATH }
		);

		expect(rows.map((row) => row.description)).toEqual(['older', 'recent']);
		expect(rows[0].exemptOn).toBe('2027-01-01');
		expect(rows[0].daysUntilExempt).toBe(214);
		expect(rows[1].exemptOn).toBe('2031-01-01');
		expect(rows[0].daysUntilExempt).toBeLessThan(rows[1].daysUntilExempt);
	});

	it('defaults the death date to today, which is what makes it a countdown', () => {
		const today = new Date();
		const givenOn = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());
		const iso = `${givenOn.getFullYear()}-${String(givenOn.getMonth() + 1).padStart(2, '0')}-${String(
			givenOn.getDate()
		).padStart(2, '0')}`;

		const [row] = giftCountdown([gift({ date: iso, amount: 400_000 })]);

		expect(row.yearsSurvived).toBe(2);
		expect(row.taperReliefPct).toBe(0);
		expect(row.daysUntilExempt).toBeGreaterThan(1_800);
	});

	it('is empty once everything has been survived', () => {
		expect(
			giftCountdown([gift({ date: '2010-01-01', amount: 900_000 })], { deathDate: DEATH })
		).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* The estate, with gifts                                                      */
/* -------------------------------------------------------------------------- */

describe('inheritanceTaxWithGifts', () => {
	it('hands the estate whatever band the gifts left', () => {
		// £94,000 chargeable after £6,000 of exemptions, all covered by the band; the estate is left
		// with £231,000 instead of £325,000, so it pays 40% on £94,000 more than it otherwise would.
		const result = inheritanceTaxWithGifts(
			{ estateValue: 500_000 },
			[gift({ date: '2022-01-01', amount: 100_000, recipient: 'Son' })],
			{ deathDate: DEATH, carriedForwardAnnualExemption: ANNUAL_EXEMPTION }
		);

		expect(result.ledger.gifts[0].chargeableValue).toBeCloseTo(94_000, PENNY);
		expect(result.nilRateBandUsedByGifts).toBeCloseTo(94_000, PENNY);
		expect(result.estate.allowances.nrb).toBeCloseTo(231_000, PENNY);
		expect(result.giftTax).toBe(0);
		expect(result.estateTax).toBeCloseTo(107_600, PENNY);
		expect(result.totalTax).toBeCloseTo(107_600, PENNY);
		expect(result.taxIfGiftsSurvived).toBeCloseTo(70_000, PENNY);
		expect(result.costOfFailedGifts).toBeCloseTo(37_600, PENNY);
	});

	it('is estate.js’s own answer when nothing has been given away', () => {
		const estate = { estateValue: 900_000, residenceValue: 300_000 };
		const result = inheritanceTaxWithGifts(estate, []);

		expect(result.estate).toEqual(inheritanceTax(estate));
		expect(result.totalTax).toBe(inheritanceTax(estate).tax);
		expect(result.giftSaving).toBe(0);
	});

	it('applies a transferred nil-rate band once, to the whole band, before the gifts spend it', () => {
		const result = inheritanceTaxWithGifts(
			{ estateValue: 800_000, transferredNilRateBandPct: 100 },
			[gift({ date: '2024-01-01', amount: 400_000 })],
			{ ...NO_ANNUAL_EXEMPTION }
		);

		expect(result.nilRateBand).toBeCloseTo(650_000, PENNY);
		expect(result.nilRateBandUsedByGifts).toBeCloseTo(400_000, PENNY);
		expect(result.estate.allowances.nrb).toBeCloseTo(250_000, PENNY);
		expect(result.giftTax).toBe(0);
		expect(result.estateTax).toBeCloseTo((800_000 - 250_000) * 0.4, PENNY);
	});

	it('leaves the residence nil-rate band alone — no lifetime gift can consume it', () => {
		const result = inheritanceTaxWithGifts(
			{ estateValue: 900_000, residenceValue: 400_000 },
			[gift({ date: '2024-01-01', amount: 400_000 })],
			{ ...NO_ANNUAL_EXEMPTION }
		);

		expect(result.estate.allowances.rnrb).toBeCloseTo(RESIDENCE_NIL_RATE_BAND, PENNY);
		expect(result.estate.residenceNilRateBandUsed).toBeCloseTo(RESIDENCE_NIL_RATE_BAND, PENNY);
	});

	it('charges the gifts and the estate separately, and adds them', () => {
		const result = inheritanceTaxWithGifts(
			{ estateValue: 600_000 },
			[
				gift({ date: '2019-07-01', amount: 200_000 }),
				gift({ date: '2024-07-01', amount: 200_000 })
			],
			{ ...NO_ANNUAL_EXEMPTION }
		);

		expect(result.giftTax).toBeCloseTo(30_000, PENNY);
		expect(result.estate.allowances.nrb).toBe(0);
		expect(result.estateTax).toBeCloseTo(240_000, PENNY);
		expect(result.totalTax).toBeCloseTo(270_000, PENNY);
	});

	it('measures what giving it away saved against keeping it', () => {
		// £500,000 given away seven years ago: the estate is £600,000 rather than £1,100,000.
		const result = inheritanceTaxWithGifts(
			{ estateValue: 600_000 },
			[gift({ date: '2019-06-01', amount: 500_000 })],
			{ ...NO_ANNUAL_EXEMPTION }
		);

		expect(result.totalTax).toBeCloseTo(110_000, PENNY);
		expect(result.taxIfNothingGifted).toBeCloseTo(310_000, PENNY);
		expect(result.giftSaving).toBeCloseTo(200_000, PENNY);
		expect(result.costOfFailedGifts).toBe(0);
	});

	it('reports a recent gift as having cost money so far, not saved it', () => {
		const result = inheritanceTaxWithGifts(
			{ estateValue: 600_000 },
			[gift({ date: '2025-06-01', amount: 500_000 })],
			{ ...NO_ANNUAL_EXEMPTION }
		);

		// Nothing is saved yet — the gift is still fully in account — and the residence band is not
		// in play, so the two figures are the same and the saving is nil rather than negative.
		expect(result.giftSaving).toBe(0);
		expect(result.costOfFailedGifts).toBeCloseTo(200_000, PENNY);
	});

	it('shows a gift pulling an estate back under the £2,000,000 residence taper', () => {
		// £2,400,000 kept would lose the whole £175,000 residence band; £400,000 given away seven
		// years ago brings the estate to £2,000,000 and the band back in full.
		const estate = { estateValue: 2_000_000, residenceValue: 500_000 };
		const result = inheritanceTaxWithGifts(
			estate,
			[gift({ date: '2019-06-01', amount: 400_000 })],
			{ ...NO_ANNUAL_EXEMPTION }
		);

		expect(result.estate.allowances.rnrb).toBeCloseTo(175_000, PENNY);
		expect(result.estate.taperApplies).toBe(false);
		expect(inheritanceTax({ ...estate, estateValue: 2_400_000 }).allowances.rnrb).toBe(0);
		expect(result.giftSaving).toBeCloseTo(230_000, PENNY);
	});

	it('takes another year’s bands, as estate.js does', () => {
		const result = inheritanceTaxWithGifts(
			{ estateValue: 500_000 },
			[gift({ date: '2024-01-01', amount: 400_000 })],
			{ ...NO_ANNUAL_EXEMPTION, bands: { nrb: 500_000, rnrb: 200_000 }, taxYear: '2031/32' }
		);

		expect(result.taxYear).toBe('2031/32');
		expect(result.bands).toEqual({ nrb: 500_000, rnrb: 200_000 });
		expect(result.nilRateBand).toBe(500_000);
		expect(result.nilRateBandUsedByGifts).toBeCloseTo(400_000, PENNY);
		expect(result.estate.allowances.nrb).toBeCloseTo(100_000, PENNY);
	});

	it('defaults the death date to today, read off the local calendar', () => {
		const now = new Date();
		const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
			now.getDate()
		).padStart(2, '0')}`;

		expect(inheritanceTaxWithGifts({ estateValue: 100_000 }).deathDate).toBe(today);
		expect(lifetimeGiftLedger([]).deathDate).toBe(today);
	});
});

/* -------------------------------------------------------------------------- */
/* The spousal transfer, after gifts                                           */
/* -------------------------------------------------------------------------- */

describe('transferableAllowancesAfterGifts', () => {
	it('counts the gifts’ share of the band as used', () => {
		// £100,000 of gifts and a £100,000 estate leave £125,000 of the £325,000 unused.
		const result = inheritanceTaxWithGifts(
			{ estateValue: 100_000 },
			[gift({ date: '2024-01-01', amount: 100_000 })],
			{ ...NO_ANNUAL_EXEMPTION }
		);

		const transferable = transferableAllowancesAfterGifts(result);
		expect(transferable.nilRateBandPct).toBeCloseTo((125_000 / 325_000) * 100, 6);
		expect(transferable.nilRateBand).toBeCloseTo(125_000, PENNY);
	});

	it('transfers nothing where the gifts alone exhausted the band', () => {
		const result = inheritanceTaxWithGifts(
			{ estateValue: 10_000 },
			[gift({ date: '2024-01-01', amount: 400_000 })],
			{ ...NO_ANNUAL_EXEMPTION }
		);

		expect(transferableAllowancesAfterGifts(result).nilRateBandPct).toBe(0);
	});

	it('still transfers the residence band in full where no home was inherited', () => {
		const result = inheritanceTaxWithGifts(
			{ estateValue: 100_000 },
			[gift({ date: '2024-01-01', amount: 100_000 })],
			{ ...NO_ANNUAL_EXEMPTION }
		);

		expect(transferableAllowancesAfterGifts(result).residenceNilRateBandPct).toBe(100);
	});

	it('closes the loop: the survivor’s estate gets the reduced percentage', () => {
		const first = inheritanceTaxWithGifts(
			{ estateValue: 100_000 },
			[gift({ date: '2024-01-01', amount: 100_000 })],
			{ ...NO_ANNUAL_EXEMPTION }
		);
		const transferable = transferableAllowancesAfterGifts(first);

		const survivor = inheritanceTax({
			estateValue: 800_000,
			transferredNilRateBandPct: transferable.nilRateBandPct,
			transferredResidenceNilRateBandPct: transferable.residenceNilRateBandPct
		});

		expect(survivor.allowances.nrb).toBeCloseTo(325_000 + 125_000, PENNY);
	});
});
