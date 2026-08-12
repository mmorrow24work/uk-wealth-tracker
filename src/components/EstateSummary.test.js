/**
 * Server-rendered smoke tests for the estate summary card (issues #187, #188, #189, #199, #200,
 * #201, #202, #203 and #204).
 *
 * As `RetirementIncomeStreams.test.js` documents: no browser test environment, so `svelte/server`'s
 * `render` covers the initial render only. That is enough for what these issues build — the
 * Inheritance Tax section's heading and its illustrative-only footnote (#187), the headline net
 * estate figure above it (#189), and the itemised line items behind that figure (#188), since none
 * of it is conditional on anything but `estateSnapshot()`'s own result. The no-tax-owed branch
 * (#203) is covered further down — a plain sentence keyed on `snapshot.totalTax`, present or absent
 * — and so is the charge it guards: the rate and the estate tax owed (#204), which only render on
 * the taxed side of that same branch, and the lifetime-gift caveat #204 adds to the footnote. The
 * estate's own taxable amount (#205) is covered further down too — `snapshot.estate.taxableEstate`,
 * rendered unconditionally (not gated on `noTaxOwed`) alongside the nil-rate bands above it. The
 * "as of" provenance note and the pension-exclusion note beneath the line items are #224's. The
 * opposite branch — an itemised "Pension pots" row once `pensionsCounted` is true — is #251's;
 * `EstateSummary.pension-pots.test.js` covers that branch on its own, since forcing it to render at
 * all needs a tax-year override this file's default `estateSnapshot()` call has no seam for (see
 * that file's own top-of-file note). What belongs here is only the negative case: that a document
 * under today's real, unmocked tax year never shows the row, alongside the exclusion note it
 * already covers.
 *
 * The life insurance row and the in-trust exclusion note (#254) are covered further down. Both are
 * plain initial-render facts off `snapshot.valuation.lifeInsurance`/`lifeInsuranceInTrust`, with no
 * tax-year seam to mock — a policy's own `in_trust` flag is the only thing that moves them — so,
 * unlike #251's pension row, they belong in this file. `budget-policy.test.js` re-verifies the
 * in-trust rule's own arithmetic; these tests only check the card shows the counted half as a row,
 * names the excluded half rather than dropping it silently, and stays quiet on a document with no
 * policies at all.
 *
 * The lifetime-gift charge and the combined estate+gift total (#200) are covered further down —
 * `estate-plan.test.js` and `lifetime-gifts.test.js` re-verify the arithmetic behind
 * `snapshot.ledger`/`snapshot.giftTax`/`snapshot.totalTax`; these tests only check the card reads it
 * out correctly and stays silent on a document with no gifts recorded. Gift dates are computed
 * relative to `new Date()` at test-run time — `lifetime-gifts.test.js`'s own pattern for a countdown
 * that has no `deathDate` override to pin it to, since this card always calls `estateSnapshot()` with
 * no second argument (deliberately: no gift entry form exists yet to seed one from, see #200's "out
 * of scope").
 *
 * The nil-rate bands behind that bill (#201) are covered further down too — the used-vs-available
 * nil-rate band and residence nil-rate band rows, the no-qualifying-home wording, the £2,000,000
 * taper note and the unused-allowance headroom. `estate.test.js` re-verifies `estateAllowances()`'s
 * own arithmetic (the taper, the residence-value cap, the transferred percentages); these tests only
 * check the card reads `snapshot.estate` out correctly.
 *
 * The "what's left after tax" figure (#202) is `netAfterTax` off the same snapshot, rendered
 * unconditionally beneath #187's charge — on a no-tax estate it is simply the gross valuation
 * again, so the tests below check both a taxed estate (below the gross figure) and an untaxed one
 * (equal to it), rather than only the untaxed branch. See `estate-plan.test.js` for `netAfterTax`'s
 * own arithmetic, which this file does not re-verify. The `$bindable` prop seam carrying the same
 * figure out to `+page.svelte`'s `bind:netAfterTax` — #191's own minimal groundwork for this issue,
 * built ahead of it because #191 needed the seam before #202 had landed — is written by an `$effect`
 * that never runs under `svelte/server`'s `render`, the same limitation this file's `ihtSettings`
 * note below describes; that it carries the right figure is left to `npm run build && npm run
 * preview`, and to the fact that the effect and the markup above both read the same `snapshot.
 * netAfterTax`, so a render assertion on the visible figure already pins the value the effect would
 * hand out.
 *
 * #199's `IhtSettings` form is the same story: what a stored settings object renders as (a checkbox's
 * `checked` attribute, a number input's `value` attribute — `PartnerProfile.test.js`'s own `html()`
 * pattern, since `text()`'s tag-stripping throws attributes away along with the tags) and what a
 * *different* stored settings object moves in the bill are both plain initial-render facts, since
 * this form takes no Save button and every field is driven straight off the `ihtSettings` prop it is
 * seeded from. The actual keystroke-by-keystroke `commit()`/`oninput` behaviour — and the `$effect`
 * in `+page.svelte` that would carry a bound-out `ihtSettings` back to a parent — never runs under
 * `svelte/server`'s `render`, so both are left to `npm run build && npm run preview`, the same manual
 * check `BeneficiaryBreakdown.test.js` already documents for its own untestable behaviour.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import {
	createAsset,
	createDebt,
	createIhtSettings,
	createInvestment,
	createLifeInsurance,
	createMonthlyEntry,
	createPension,
	createProperty
} from '$lib/model.js';
import EstateSummary from './EstateSummary.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(EstateSummary, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

/**
 * The rendered markup as-is, tags included — for asserting an input's `value`/`checked` attribute,
 * which `text()`'s tag-stripping throws away along with the tags — `PartnerProfile.test.js`'s own
 * `html()` helper.
 *
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function html(props = {}) {
	return render(EstateSummary, { props }).body;
}

/**
 * ISO `YYYY-MM-DD` for `yearsAgo` years before today, read off the local calendar —
 * `lifetime-gifts.test.js`'s own pattern for exercising the no-argument "if I died today" call, since
 * this card never passes `estateSnapshot()` a `deathDate` override.
 *
 * @param {number} yearsAgo
 * @returns {string}
 */
function isoYearsAgo(yearsAgo) {
	const now = new Date();
	const date = new Date(now.getFullYear() - yearsAgo, now.getMonth(), now.getDate());
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
		date.getDate()
	).padStart(2, '0')}`;
}

describe('EstateSummary', () => {
	it('renders the Inheritance Tax section heading with no data recorded', () => {
		const body = text();

		expect(body).toContain('Inheritance Tax');
	});

	it('carries the illustrative-only footnote every calculator card carries', () => {
		const body = text();

		expect(body).toContain('Illustrative only, not financial advice.');
	});

	it('extends the footnote with the lifetime-gift caveat this issue (#204) adds', () => {
		const body = text();

		expect(body).toContain(
			'charged Inheritance Tax on any lifetime gift not yet survived by seven years'
		);
		expect(body).toContain('the estate tax owed above does not include it');
	});

	it('renders the section unconditionally, with an estate to value', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000 })]
		});

		expect(body).toContain('Inheritance Tax');
		expect(body).toContain('Illustrative only, not financial advice.');
	});

	it('shows the net estate total, valued from tracked data, for a populated document', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		expect(body).toContain('If I died today');
		expect(body).toContain('£500,000');
		expect(body).toContain('Net Worth, Property, Assets and Pensions');
	});

	it('shows a £0 net estate on the no-data branch, rather than throwing', () => {
		const body = text();

		expect(body).toContain('If I died today');
		expect(body).toContain('£0');
	});

	it("shows what's left after tax alongside the gross valuation for a populated document", () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		expect(body).toContain("What's left after tax");
		// No IHT settings recorded, no funeral expenses, and £500,000 is well under both nil-rate
		// bands, so nothing is owed and what's left equals the gross valuation.
		expect(body).toContain('£500,000');
	});

	it("shows what's left below the gross valuation once the nil-rate band is exceeded", () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 900_000 })]
				})
			]
		});

		// £900,000 estate, no property so no residence nil-rate band: £575,000 taxable above the
		// £325,000 nil-rate band, at 40% is £230,000 owed, leaving £670,000 — below the £900,000
		// gross valuation shown above it, rather than equal to it.
		expect(body).toContain('£900,000');
		expect(body).toContain("What's left after tax");
		expect(body).toContain('£670,000');
	});

	it("renders what's left unconditionally on a no-tax estate too, not only once a bill exists", () => {
		// A brand new document has nothing to pass on and nothing owed, but "what's left" still
		// renders — the same £0 as the gross valuation — rather than being hidden until a bill exists.
		const body = text();

		expect(body).toContain("What's left after tax");
		expect(body).toContain('£0');
	});

	it('itemises the line items behind the total, footing to the same figure', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 100_000 })],
					debts: [createDebt({ balance: 5_000 })]
				})
			],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 100_000 })],
			assets: [createAsset({ name: 'Watch', current_value: 20_000 })],
			pensions: [createPension({ type: 'lisa', value: 10_000 })]
		});

		// Investments 100,000 + property equity 400,000 + physical assets 20,000 + lifetime ISA
		// pots 10,000 − debts 5,000 = 525,000, the same figure the headline shows.
		// The default createInvestment() wrapper is 'gia', so the itemised investments row is
		// labelled "General Investment Account" rather than a lump "Investments" row. Likewise the
		// default createDebt() type is 'other', so the itemised debts row is labelled "Other" rather
		// than a lump "Debts" row.
		expect(body).toContain('General Investment Account');
		expect(body).toContain('£100,000');
		expect(body).toContain('Property equity');
		expect(body).toContain('£400,000');
		expect(body).toContain('Physical assets');
		expect(body).toContain('£20,000');
		expect(body).toContain('Lifetime ISA pots');
		expect(body).toContain('£10,000');
		expect(body).toContain('Other');
		expect(body).toContain('−£5,000');
		expect(body).not.toContain('Debts');
		expect(body).toContain('£525,000');
	});

	it('itemises debts by type, omitting untouched ones and honouring exclude_from_net_worth', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					debts: [
						createDebt({ type: 'credit_card', balance: 2_000 }),
						createDebt({ type: 'credit_card', balance: 1_000 }),
						createDebt({ type: 'car_finance', balance: 8_000 }),
						createDebt({ type: 'mortgage', balance: 50_000, exclude_from_net_worth: true })
					]
				})
			]
		});

		expect(body).toContain('Credit card');
		expect(body).toContain('−£3,000');
		expect(body).toContain('Car finance');
		expect(body).toContain('−£8,000');
		expect(body).not.toContain('Mortgage');
		expect(body).not.toContain('Personal loan');
		expect(body).not.toContain('Student loan');
		expect(body).not.toContain('Overdraft');
	});

	it('itemises investments by wrapper, combining holdings in the same wrapper and omitting untouched ones', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [
						createInvestment({ wrapper: 'gia', value: 100_000, exclude_from_net_worth: true }),
						createInvestment({ wrapper: 'isa_stocks_shares', value: 30_000 }),
						createInvestment({ wrapper: 'isa_stocks_shares', value: 20_000 }),
						createInvestment({ wrapper: 'sipp', value: 40_000 })
					]
				})
			]
		});

		expect(body).toContain('Stocks & Shares ISA');
		expect(body).toContain('£50,000');
		expect(body).toContain('SIPP');
		expect(body).toContain('£40,000');
		expect(body).not.toContain('General Investment Account');
		expect(body).not.toContain('Cash ISA');
		expect(body).not.toContain('Lifetime ISA');
	});

	it('gives a zero lifetimeIsaPots no row, and a non-zero one a row', () => {
		const withoutLisa = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});
		expect(withoutLisa).not.toContain('Lifetime ISA');

		const withLisa = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })],
			pensions: [createPension({ type: 'lisa', value: 15_000 })]
		});
		expect(withLisa).toContain('Lifetime ISA pots');
		expect(withLisa).toContain('£15,000');
	});

	/* ---------------------------------------------------------------------- */
	/* Life insurance and the in-trust exclusion (issue #254)                 */
	/* ---------------------------------------------------------------------- */

	it('itemises cover not written in trust, folded into the same total', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })],
			lifeInsurance: [createLifeInsurance({ name: 'Level term', sum_assured: 300_000 })]
		});

		expect(body).toContain('Life insurance');
		expect(body).toContain('£300,000');
		// £500,000 property equity + £300,000 of chargeable cover.
		expect(body).toContain('£800,000');
		// Nothing is in trust, so nothing is excluded and the card stays silent about it.
		expect(body).not.toContain('written in trust');
	});

	it('gives a policy written in trust no row, and says how much cover is left out and why', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })],
			lifeInsurance: [
				createLifeInsurance({ name: 'Death in service', sum_assured: 300_000, in_trust: true })
			]
		});

		// The estate is the property alone — the cover contributes nothing — but the £300,000 that is
		// deliberately absent is named rather than silently missing.
		expect(body).toContain('£500,000');
		expect(body).toContain('£300,000 of life insurance cover is written in trust');
		expect(body).toContain('pays your beneficiaries directly');
		expect(body).not.toContain('£800,000');
	});

	it('shows both readings at once for a mix of in-trust and chargeable policies', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })],
			lifeInsurance: [
				createLifeInsurance({ name: 'Level term', sum_assured: 200_000, in_trust: false }),
				createLifeInsurance({ name: 'Death in service', sum_assured: 300_000, in_trust: true })
			]
		});

		expect(body).toContain('Life insurance');
		expect(body).toContain('£200,000');
		expect(body).toContain('£700,000'); // 500,000 of equity + 200,000 of chargeable cover.
		expect(body).toContain('£300,000 of life insurance cover is written in trust');
	});

	it('gives a document with no policies recorded neither the row nor the note', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		expect(body).not.toContain('Life insurance');
		expect(body).not.toContain('written in trust');
	});

	it('gives a property with no offset mortgage no row, and one with offset savings a row', () => {
		const withoutOffset = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});
		expect(withoutOffset).not.toContain('Offset mortgage savings');

		const withOffset = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [
				createProperty({
					name: 'Home',
					value: 500_000,
					mortgage_balance: 150_000,
					mortgage_type: 'offset',
					offset_savings_balance: 65_000
				})
			]
		});
		expect(withOffset).toContain('Offset mortgage savings');
		expect(withOffset).toContain('£65,000');
		// Property equity (350,000) and offset savings (65,000) both feed the headline total.
		expect(withOffset).toContain('£415,000');
	});

	/* ---------------------------------------------------------------------- */
	/* IhtSettings form (issue #199)                                          */
	/* ---------------------------------------------------------------------- */

	it('renders the Assumptions section and its five fields, with no data recorded', () => {
		const body = text();

		expect(body).toContain('Assumptions');
		expect(body).toContain('Whole estate passes to a spouse or civil partner, exempt');
		expect(body).toContain('Home passes to children or other direct descendants');
		expect(body).toContain('Transferred nil-rate band (%)');
		expect(body).toContain('Transferred residence nil-rate band (%)');
		expect(body).toContain('Funeral expenses (£)');
	});

	it('populates the numeric fields from a stored IhtSettings object', () => {
		const body = html({
			ihtSettings: createIhtSettings({
				transferred_nil_rate_band_pct: 60,
				transferred_residence_nil_rate_band_pct: 25,
				funeral_expenses: 4_000
			})
		});

		expect(body).toContain('value="60"');
		expect(body).toContain('value="25"');
		expect(body).toContain('value="4000"');
	});

	it('checks both checkboxes when spouse_exempt and direct_descendants are both true', () => {
		const body = html({
			ihtSettings: createIhtSettings({ spouse_exempt: true, direct_descendants: true })
		});

		const checked = body.match(/<input type="checkbox"[^>]*checked[^>]*\/>/g);
		expect(checked).toHaveLength(2);
	});

	it('checks neither checkbox when spouse_exempt and direct_descendants are both false', () => {
		const body = html({
			ihtSettings: createIhtSettings({ spouse_exempt: false, direct_descendants: false })
		});

		expect(body).not.toMatch(/<input type="checkbox"[^>]*checked[^>]*\/>/);
	});

	it('moves the net-after-tax figure when the funeral expenses assumption changes', () => {
		const baseProps = {
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		};

		// £500,000 is under both nil-rate bands, so no tax is owed either way — funeral expenses
		// come straight off the total (`estate.js`'s own `netAfterTax = netEstate - tax`, with `tax`
		// at 0), the same £500,000/£450,000 pair a browser would show typing 50000 into the field.
		const withoutExpenses = text(baseProps);
		expect(withoutExpenses).toContain('£500,000');

		const withExpenses = text({
			...baseProps,
			ihtSettings: createIhtSettings({ funeral_expenses: 50_000 })
		});
		expect(withExpenses).toContain('£450,000');
	});

	it('renders neither NaN nor a blank total when a stored numeric field is not a valid number', () => {
		// `estate-plan.js`'s own defensive re-normalisation inside `estateSnapshot()` is what a
		// half-typed field relies on — this is that guarantee exercised through the card, matching a
		// stored document a `NaN` could otherwise have reached before `commit()` ever ran.
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })],
			ihtSettings: createIhtSettings({ funeral_expenses: NaN })
		});

		expect(body).not.toContain('NaN');
		expect(body).toContain("What's left after tax");
		expect(body).toContain('£500,000');
	});

	/* ---------------------------------------------------------------------- */
	/* Lifetime gifts (issue #200)                                            */
	/* ---------------------------------------------------------------------- */

	it('renders no gift rows at all on a document with no gifts recorded', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		expect(body).not.toContain('Lifetime gifts');
		expect(body).not.toContain('Tax on gifts');
		expect(body).not.toContain('Total Inheritance Tax');
	});

	it('also renders no gift rows on the empty document, rather than throwing', () => {
		const body = text();

		expect(body).not.toContain('Lifetime gifts');
	});

	it('shows the gift tax and a combined total above the estate tax alone, for a failed gift', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 500_000 })]
				})
			],
			gifts: [
				{
					date: isoYearsAgo(1),
					amount: 400_000,
					recipient: 'Jess',
					description: 'house deposit',
					exemption: 'none'
				}
			]
		});

		// £500,000 estate, £400,000 gift a year old: the gift's £394,000 chargeable value (after the
		// £3,000 annual exemption plus a full year's carry-forward) takes the whole £325,000 nil-rate
		// band, leaving £69,000 taxable at 40% with no taper relief (under 3 years) — £27,600 gift tax.
		// The estate is left with no band at all, so its own £500,000 is taxed in full at 40% —
		// £200,000 — for a combined total of £227,600, well above the estate's £200,000 alone.
		expect(body).toContain('Lifetime gifts');
		expect(body).toContain('Nil-rate band used by gifts');
		expect(body).toContain('£325,000 of £325,000');
		expect(body).toContain('Jess');
		expect(body).toContain('Tax on gifts');
		expect(body).toContain('£27,600');
		expect(body).toContain('Total Inheritance Tax');
		expect(body).toContain('£227,600');
	});

	it('shows taper relief on a gift several years old', () => {
		const body = text({
			gifts: [
				{
					date: isoYearsAgo(5),
					amount: 50_000,
					recipient: 'Sam',
					description: 'wedding help',
					exemption: 'none'
				}
			]
		});

		expect(body).toContain('Sam');
		expect(body).toContain('5 years survived');
		expect(body).toContain('40% taper relief');
	});

	it('folds an already-survived gift into a quiet out-of-account count, not the charge', () => {
		const body = text({
			gifts: [
				{
					date: '2000-01-01',
					amount: 900_000,
					recipient: 'Grandad',
					description: 'long ago',
					exemption: 'none'
				}
			]
		});

		expect(body).toContain('Lifetime gifts');
		expect(body).toContain('1 gift already out of account');
		expect(body).not.toContain('Grandad');
	});

	/* ---------------------------------------------------------------------- */
	/* Nil-rate bands (issue #201)                                            */
	/* ---------------------------------------------------------------------- */

	it('shows the nil-rate band and residence nil-rate band both used in full on a taxed estate', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 1_000_000 })]
				})
			],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		// £1,500,000 net estate: the £175,000 residence band (home worth £500,000, well above it, no
		// taper below £2,000,000) is set against the estate first, then the full £325,000 nil-rate
		// band — both fully used, £1,000,000 left taxable at 40%.
		expect(body).toContain('Nil-rate band');
		expect(body).toContain('£325,000 of £325,000');
		expect(body).toContain('Residence nil-rate band');
		expect(body).toContain('£175,000 of £175,000');
	});

	it('says plainly there is no qualifying home rather than showing £0 of £0', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 100_000 })]
				})
			]
		});

		expect(body).toContain('No qualifying home recorded, or not passing to direct descendants');
		expect(body).not.toContain('£0 of £0');
	});

	it('notes the £2,000,000 taper and how much residence band it took, above the threshold', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 2_200_000 })]
				})
			],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		// £2,700,000 net estate is £700,000 over the £2,000,000 threshold, withdrawing £1 of residence
		// band for every £2 over it — £350,000, more than the whole £175,000 band, so it is lost in
		// full and the taper note reports exactly that £175,000.
		expect(body).toContain('above £2,000,000');
		expect(body).toContain('withdrawn at £1 for every £2');
		expect(body).toContain('£175,000 lost');
	});

	it('does not mention the taper on an estate under £2,000,000', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		expect(body).not.toContain('above £2,000,000');
	});

	it('shows the unused headroom on an estate below both bands, including the residence cap', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 50_000 })]
				})
			],
			properties: [createProperty({ name: 'Home', value: 100_000, mortgage_balance: 0 })]
		});

		// £150,000 net estate: the residence band is capped at the home's own £100,000 (well under the
		// £175,000 band), leaving £50,000 to the nil-rate band and nothing taxable — £275,000 of the
		// combined £425,000 allowance goes unused.
		expect(body).toContain('£50,000 of £325,000');
		expect(body).toContain('£100,000 of £100,000');
		expect(body).toContain('£275,000 of allowance unused');
	});

	it('shows no headroom on an estate that used its bands in full', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 1_000_000 })]
				})
			],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		expect(body).not.toContain('of allowance unused');
	});

	/* ---------------------------------------------------------------------- */
	/* Taxable estate (issue #205)                                            */
	/* ---------------------------------------------------------------------- */

	it('shows a £0 taxable estate on the empty document, alongside the no-tax-owed sentence', () => {
		const body = text();

		expect(body).toContain('Taxable estate');
		expect(body).toContain('No Inheritance Tax is owed');
	});

	it('shows the taxable estate above both nil-rate bands once they are exceeded', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 900_000 })]
				})
			]
		});

		// Same £900,000 no-property estate as the rate/tax-owed tests below: £575,000 left once the
		// £325,000 nil-rate band (no residence band — no qualifying home recorded) is taken off.
		expect(body).toContain('Taxable estate');
		expect(body).toContain('£575,000');
	});

	it('names the nil-rate bands the figure is left over from, without re-rendering their amounts', () => {
		const body = text();

		expect(body).toContain(
			"What's left of the chargeable estate once the nil-rate band and residence nil-rate band are taken off."
		);
	});

	/* ---------------------------------------------------------------------- */
	/* No-tax-owed branch (issue #203)                                       */
	/* ---------------------------------------------------------------------- */

	it('says no Inheritance Tax is owed on the empty document', () => {
		const body = text();

		expect(body).toContain('No Inheritance Tax is owed');
	});

	it('says no Inheritance Tax is owed on an estate under both nil-rate bands', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		expect(body).toContain('No Inheritance Tax is owed');
	});

	it('does not say no tax is owed once the nil-rate band is exceeded', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 900_000 })]
				})
			]
		});

		expect(body).not.toContain('No Inheritance Tax is owed');
	});

	it('does not say no tax is owed when the estate itself is untaxed but a failed gift is', () => {
		const body = text({
			gifts: [
				{
					date: isoYearsAgo(1),
					amount: 400_000,
					recipient: 'Jess',
					description: 'house deposit',
					exemption: 'none'
				}
			]
		});

		// No other estate assets recorded, so the estate's own tax is £0 — but the gift consumes the
		// whole nil-rate band and is still taxed in its own right (see the combined-total test above
		// for the arithmetic), so `totalTax` is non-zero and the branch — keyed on that combined
		// figure, not `snapshot.estate.tax` alone — must not read as "no tax owed".
		expect(body).not.toContain('No Inheritance Tax is owed');
	});

	/* ---------------------------------------------------------------------- */
	/* The charge itself: rate and estate tax owed (issue #204)              */
	/* ---------------------------------------------------------------------- */

	it('renders neither the rate nor the tax-owed row on the no-tax-owed branch', () => {
		const body = text();

		expect(body).not.toContain('Inheritance Tax rate');
		expect(body).not.toContain('Estate tax owed');
	});

	it('shows the rate and the estate tax owed once the nil-rate band is exceeded', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({
					month: 6,
					year: 2026,
					investments: [createInvestment({ value: 900_000 })]
				})
			]
		});

		// £900,000 estate, no property so no residence nil-rate band: £575,000 taxable above the
		// £325,000 nil-rate band, at 40% is £230,000 owed — the same figures the "what's left" test
		// above derives `£670,000` from.
		expect(body).toContain('Inheritance Tax rate');
		expect(body).toContain('40%');
		expect(body).toContain('Estate tax owed');
		expect(body).toContain('£230,000');
	});

	it('still shows the estate tax owed as £0 when only a failed gift is taxed', () => {
		const body = text({
			gifts: [
				{
					date: isoYearsAgo(1),
					amount: 400_000,
					recipient: 'Jess',
					description: 'house deposit',
					exemption: 'none'
				}
			]
		});

		// No estate assets recorded, so the estate's own tax is £0 — but `totalTax` is non-zero
		// (the gift's own charge), so the branch renders the charge rows rather than the no-tax-owed
		// sentence, and the estate tax owed row correctly reads £0 rather than being hidden.
		expect(body).toContain('Inheritance Tax rate');
		expect(body).toContain('Estate tax owed');
		expect(body).not.toContain('No Inheritance Tax is owed');
	});

	/* ---------------------------------------------------------------------- */
	/* Provenance and the pension exclusion (issue #224)                     */
	/* ---------------------------------------------------------------------- */

	it('names the month of the latest recorded entry for the dated figures', () => {
		const body = text({
			monthlyEntries: [
				createMonthlyEntry({ month: 6, year: 2026 }),
				createMonthlyEntry({ month: 3, year: 2026 })
			],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		// Two entries recorded — June 2026 is the later of the two, so that is the month named,
		// not March.
		expect(body).toContain('June 2026');
		expect(body).not.toContain('March 2026');
		expect(body).toContain('latest recorded entry');
	});

	it('uses different wording, pointing at the Net Worth tab, when no monthly entry exists at all', () => {
		const body = text();

		expect(body).toContain('No monthly entry recorded');
		expect(body).toContain('Net Worth tab');
		// Distinct wording from the dated case, not the dated sentence with a blank left in it.
		expect(body).not.toContain('latest recorded entry');
	});

	it('gives no pension-exclusion note when there are no Defined Contribution pots', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		expect(body).not.toContain('6 April 2027');
	});

	it('notes the excluded pension pots and the April 2027 boundary when a DC pot is recorded', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })],
			pensions: [createPension({ type: 'dc_workplace', value: 80_000 })]
		});

		expect(body).toContain('£80,000');
		expect(body).toContain('left out of the total above');
		expect(body).toContain('6 April 2027');
	});

	/* ---------------------------------------------------------------------- */
	/* Pension pots row — the negative case (issue #251)                     */
	/* ---------------------------------------------------------------------- */

	it("gives a DC pension pot the exclusion note, not the itemised row, under today's real tax year", () => {
		// This card's own `estateSnapshot()` call never overrides the tax year (convention 1), so
		// `pensionsCounted` is `false` under any real calendar date before 6 April 2027 — the
		// itemised "Pension pots" row this issue adds cannot render here at all, only its opposite,
		// the exclusion note #224 already covers above. `EstateSummary.pension-pots.test.js` exercises
		// the row itself with an explicit tax-year override.
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })],
			pensions: [createPension({ type: 'dc_workplace', value: 80_000 })]
		});

		expect(body).not.toContain('Pension pots');
		expect(body).toContain('left out of the total above');
	});
});
