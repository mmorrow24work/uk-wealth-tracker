<script>
	/**
	 * Estate summary card — README.md → "Estate & IHT Planning Suite": "'If I died today' — what
	 * family receives per stream" (issue #140).
	 *
	 * This card is built up by several issues sharing one `estateSnapshot()` call rather than each
	 * re-running the engine: #189 adds the headline net estate figure below; this issue (#188) adds
	 * the itemised breakdown behind it — `investments`, `propertyEquity`, `physicalAssets` and
	 * `lifetimeIsaPots` (`snapshot.valuation`'s own fields, no arithmetic of its own here), footing to
	 * the same `total` #189 already shows, with `debts` as a deduction. `offsetSavings` (savings
	 * linked to an offset mortgage — genuinely owned money, but not property equity, hence its own
	 * line rather than folded into `propertyEquity`) was added later, at the user's own request,
	 * shown only when non-zero the same way `lifetimeIsaPots` already was. This issue (#250) itemises
	 * the `investments` line: one row per `snapshot.valuation.investmentsByWrapper` entry
	 * (`budget-policy.js`'s own breakdown of `investments` by `Investment.wrapper`, so a "Stocks &
	 * Shares ISA" line sits alongside "SIPP", "General Investment Account" and the rest), rows for a
	 * £0 wrapper already absent rather than filtered here, and the single lump "Investments" row it
	 * replaces is gone — the rows still sum to the same `investments` figure `total` was always built
	 * from. This issue (#249) does the same thing to the `debts` deduction: one row per
	 * `snapshot.valuation.debtsByType` entry (`budget-policy.js`'s own breakdown of `debts` by
	 * `Debt.type`, in `DEBT_TYPES` order), a £0 type getting no row for the same reason a £0 wrapper
	 * gets none above, and the single lump "Debts" row it replaces is gone — the rows still sum to
	 * the same `debts` figure `total` was always built from. The Inheritance Tax section
	 * beneath both carries its heading, its illustrative-only footnote and the `netAfterTax` headline —
	 * the taxable estate is a further figure in the same section (#205); the rate and the estate tax
	 * owed are this issue's (#204), and the no-tax-owed branch around them is #203's. The lifetime-gift
	 * half of that bill (#200) adds
	 * off `snapshot.ledger` — the nil-rate band gifts used before the estate got it, each failed gift
	 * assessed, the seven-year countdown, and the combined estate+gift total — gated on `gifts` being
	 * non-empty so a document with nothing gifted renders none of it. This issue (#201) adds the bands
	 * behind that bill, off `snapshot.estate` (the after-gifts `IhtCalculation` `estate.js` returns):
	 * the nil-rate band and residence nil-rate band each used vs. available, the £2,000,000 taper note
	 * when it applies, and — on an estate with headroom left — how much more could have passed before
	 * anything was taxed. No Inheritance Tax arithmetic of its own; every figure is already on
	 * `snapshot.estate`, which the taper, the residence cap and the transferred percentages were all
	 * applied to before this component saw it. Directly beneath that table, this issue (#224) adds two
	 * short notes: the "as of" month behind `investments`/`debts` — re-derived here via `forecast.js`'s
	 * `positionFromEntries(monthlyEntries)` rather than a second `estateSnapshot()` call, since its
	 * `.start` is exactly the anchor `estateValuation()` already used internally — with distinct
	 * wording for a document with no monthly entry at all (`positionFromEntries()` returns `null`, and
	 * the £0 investments/debts that follow are honestly labelled rather than presented as recorded);
	 * and, where `snapshot.valuation.pensionPots` is non-zero, a note that those unused Defined
	 * Contribution funds are left out of `total` until 6 April 2027 (`budget-policy.js`'s convention
	 * 7) — silent when there are none, so a document with no DC pensions gets no "£0 excluded" line.
	 * This issue (#251) is the opposite reading of that same figure: once `pensionsCounted` is true
	 * (a death on or after 6 April 2027 — never reachable through this card's own "today" call in
	 * practice, per #224's note above, but a live branch once the app itself is used past that date),
	 * an itemised "Pension pots" row joins the list instead of the exclusion note, so `total` never
	 * carries pension pots without saying so. The two are written as one pair, gated on
	 * `pensionsCounted` and its negation off the same `showPensionExclusion`/`showPensionPots`
	 * booleans, so exactly one of them can ever render for a given valuation, never both and never
	 * neither when `pensionPots` is non-zero.
	 *
	 * This issue (#254) brings recorded life insurance in, off the two fields `estateValuation()` now
	 * reports: a "Life insurance" row for `lifeInsurance` (cover not written in trust, already inside
	 * `total`), shown only when non-zero like every other conditional row here, and — where
	 * `lifeInsuranceInTrust` is non-zero — a note naming how much cover is left out and why. Unlike
	 * the pension pair above, these two are *independently* gated rather than mutually exclusive: a
	 * document can hold one policy in trust and one not, and both readings are then true at once. The
	 * note exists because this is the one figure on the card whose exclusion matters as much as its
	 * inclusion — someone who wrote a £500,000 policy in trust should be able to see that the cover is
	 * deliberately absent from the estate above rather than quietly missing — the same honesty this
	 * card already applies to pension pots left out of the total. Neither the row nor the note
	 * re-applies the in-trust rule: `budget-policy.js`'s `payableIntoEstate` is the only place it
	 * lives, and both figures arrive already split by it.
	 *
	 * Read-only props, all hydrated by the Estate tab (#166/#190) — this component owns none of them
	 * and writes nothing back, the way `RetirementIncomeStreams.svelte` reads the same kind of lists
	 * on the Pensions tab. The tab's own empty state (nothing recorded on Net Worth/Property/Assets)
	 * gates whether this card mounts at all — `hasEstateData` in `+page.svelte` — so that guard is
	 * not restated here, and this card renders its figure unconditionally once mounted.
	 *
	 * #203 built the `snapshot.totalTax` branch those charge rows were always meant to sit behind —
	 * keyed on the estate's own tax plus any gift tax, not `snapshot.estate.tax` alone, so an estate
	 * whose bands cover it but whose failed gifts are taxed still reads as owing something — with a
	 * plain sentence standing in for them until they existed. This issue (#204) is those rows: the
	 * rate (`snapshot.estate.rate`, `estate.js`'s `IHT_RATE` — already a percentage number, not a
	 * fraction) and the estate tax owed (`snapshot.estate.tax`), both inside `!noTaxOwed` so a
	 * document with nothing owed still shows only #203's sentence rather than a £0 rate and bill
	 * beside it. The footnote below picks up this issue's caveat too — a death is also charged
	 * Inheritance Tax on any lifetime gift not yet survived by seven years, and the estate tax owed
	 * here excludes it; #200's gift charge is the figure that caveat points to. The nil-rate band
	 * rows, the taper note and the unused-allowance headroom stay outside the branch and render either
	 * way, per #203's own instruction; this issue (#205) is the taxable estate beside these two
	 * figures — `snapshot.estate.taxableEstate`, the base `estate.js`'s `IHT_RATE` is charged on,
	 * rendered unconditionally like the bands above it rather than inside `!noTaxOwed`, since a £0
	 * taxable estate on a document the bands cover in full is a correct render, not a case to
	 * special-case. Its line of context names the nil-rate band and residence nil-rate band as what
	 * was taken off to reach it, without re-rendering the figures #201 already shows above.
	 *
	 * `netAfterTax` is the one value that *does* travel the other way: what's left of the estate
	 * once Inheritance Tax is paid, off the same `estateSnapshot()` this card already derives, handed
	 * back up as a `$bindable` prop defaulting to `0` so `BeneficiaryBreakdown.svelte` (#191) can price
	 * beneficiaries' wished shares against it without a second `estateSnapshot()` call. Kept in step
	 * with the derived snapshot via `$effect` — `AssetsTracker.svelte`'s own pattern for a value that
	 * only ever flows out of a component — so nothing a parent sets feeds back into a figure rendered
	 * here.
	 *
	 * `ihtSettings` is `$bindable` too (issue #199) — the one write this card makes. The five
	 * `IhtSettings` fields data this app already tracks cannot supply — `spouse_exempt`,
	 * `direct_descendants`, the two transferred-nil-rate-band percentages and `funeral_expenses` — are
	 * live-bound form fields beneath the bill, the same "no Save button, commit on input" convention
	 * `PartnerProfile.svelte` uses for a record that already exists rather than a list being added to.
	 * Unlike `PartnerProfile`, there is no add/remove: `iht_settings` always exists (`createIhtSettings()`
	 * seeds a brand new document), so the fields are always shown. Local text state (rather than
	 * binding straight into `ihtSettings`) keeps a half-typed numeric field from writing `NaN` into the
	 * document a parent persists — `estate-plan.js`'s own defensive re-normalisation inside
	 * `estateSnapshot()` is what keeps the *displayed* bill from ever flashing `NaN`, not this form; a
	 * committed field is always a finite number before it reaches `ihtSettings`, so both stay true at
	 * once. Editing a field never re-derives the bill itself — the changed `ihtSettings` flows back
	 * through the same `snapshot` `$derived` above, not a second `estateSnapshot()` call.
	 */
	import { estateSnapshot } from '$lib/estate-plan.js';
	import { positionFromEntries } from '$lib/forecast.js';
	import { createIhtSettings } from '$lib/model.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 *   monthlyEntries?: import('$lib/types.js').MonthlyEntry[],
	 *   properties?: import('$lib/types.js').Property[],
	 *   assets?: import('$lib/types.js').Asset[],
	 *   pensions?: import('$lib/types.js').Pension[],
	 *   lifeInsurance?: import('$lib/types.js').LifeInsurance[],
	 *   gifts?: import('$lib/lifetime-gifts.js').Gift[],
	 *   ihtSettings?: import('$lib/types.js').IhtSettings,
	 *   netAfterTax?: number
	 * }}
	 */
	let {
		monthlyEntries = [],
		properties = [],
		assets = [],
		pensions = [],
		lifeInsurance = [],
		gifts = [],
		ihtSettings = $bindable(undefined),
		// eslint-disable-next-line no-useless-assignment -- written by the $effect below, read by a parent's bind:netAfterTax, never by this component itself
		netAfterTax = $bindable(0)
	} = $props();

	// One estateSnapshot() call for the whole card (per this issue's own convention) — #188 and
	// #199–#205 read this same `snapshot`, rather than each re-running the engine against a
	// different set of inputs.
	const snapshot = $derived(
		estateSnapshot({
			monthly_entries: monthlyEntries,
			properties,
			assets,
			pensions,
			life_insurance: lifeInsurance,
			gifts,
			iht_settings: ihtSettings
		})
	);

	// Only ever written out — nothing a parent sets here feeds back into the derived snapshot above.
	$effect(() => {
		netAfterTax = snapshot.netAfterTax;
	});

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount @returns {string} */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	// `snapshot.estate.rate` is already a percentage number (`40`), per `estate.js`'s own convention
	// — `DividendTaxSummary.svelte`'s `formatRate` pattern, not `amount * 100`.
	/** @param {number} rate @returns {string} */
	function formatRate(rate) {
		return `${Math.round(rate * 100) / 100}%`;
	}

	// A zero lifetimeIsaPots gets no row (per this issue's own instruction) — it's only ever set on
	// the Pensions tab and is commonly zero, so an empty row would be noise rather than a true zero.
	const showLifetimeIsaPots = $derived(snapshot.valuation.lifetimeIsaPots !== 0);
	const showOffsetSavings = $derived(snapshot.valuation.offsetSavings !== 0);

	// The counted half of the life insurance split (issue #254) — cover not written in trust, already
	// inside `total`. Zero gets no row, the same rule the two above follow.
	const showLifeInsurance = $derived(snapshot.valuation.lifeInsurance !== 0);

	// The excluded half, and the reason this card says anything at all about cover it isn't counting:
	// non-zero exactly when the recorded sum assured is *not* fully in the total above. Independent of
	// `showLifeInsurance` — a document with one policy in trust and one not renders both.
	const showLifeInsuranceInTrust = $derived(snapshot.valuation.lifeInsuranceInTrust !== 0);

	/* -------------------------------------------------------------------------- */
	/* Provenance and the pension exclusion (issue #224)                          */
	/* -------------------------------------------------------------------------- */

	// The same re-derivation `estateSnapshot()` makes internally (`estate-plan.js`'s own doc comment)
	// rather than a second engine call — `positionFromEntries()` is the one place "latest" is worked
	// out, and its result is `null` on a document with no monthly entries at all.
	const monthlyPosition = $derived(positionFromEntries(monthlyEntries));

	const provenanceMonthFormatter = new Intl.DateTimeFormat('en-GB', {
		month: 'long',
		year: 'numeric'
	});

	/** @param {{ month: number, year: number }} value @returns {string} */
	function formatProvenanceMonth({ month, year }) {
		return provenanceMonthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
	}

	// Non-zero per convention 5/7 — a document with no Defined Contribution pensions has nothing to
	// exclude, so it gets no note rather than a "£0 left out" line that reads as a bug report. Gated
	// on `!pensionsCounted` too (issue #251) — the exclusion note and the itemised row below are the
	// two mutually exclusive readings of the same figure, never both at once.
	const showPensionExclusion = $derived(
		snapshot.valuation.pensionPots !== 0 && !snapshot.valuation.pensionsCounted
	);

	// The itemised counterpart to the note above: `pensionsCounted` is only ever true from 6 April
	// 2027 (`budget-policy.js`'s own convention 7), which this card's own `estateSnapshot()` call
	// cannot reach today (convention 1 — no year-scenario picker on this tab), but the row is written
	// now so a future tax year's estate itemises where that part of `total` came from rather than
	// folding it in silently. Zero gets no row, the same convention `showLifetimeIsaPots` follows.
	const showPensionPots = $derived(
		snapshot.valuation.pensionsCounted && snapshot.valuation.pensionPots !== 0
	);

	// Whether anything at all sits between the provenance note and the Inheritance Tax heading — the
	// pension exclusion, the in-trust cover exclusion, or both. Only decides spacing: the provenance
	// note keeps its own bottom margin when it is the last thing on the card.
	const hasExclusionNote = $derived(showPensionExclusion || showLifeInsuranceInTrust);

	/* -------------------------------------------------------------------------- */
	/* No-tax-owed branch (issue #203)                                            */
	/* -------------------------------------------------------------------------- */

	// Keyed on the combined `totalTax` — the estate's own tax plus any gift tax — rather than
	// `snapshot.estate.tax` alone, so an estate whose bands cover it but whose failed gifts are taxed
	// (#200) still reads as owing something rather than "no Inheritance Tax owed". #204/#205's
	// taxable-estate, rate and tax-owed rows land behind `!noTaxOwed` when they're built; nothing sits
	// there yet.
	const noTaxOwed = $derived(snapshot.totalTax === 0);

	/* -------------------------------------------------------------------------- */
	/* Lifetime gifts — the gift charge and combined total (issue #200)           */
	/* -------------------------------------------------------------------------- */

	// `snapshot.ledger.gifts` is one GiftAssessment per gift in `AppData.gifts`, so its length is the
	// right gate for "are any gifts recorded at all" — not just the ones that failed.
	const giftAssessments = $derived(snapshot.ledger.gifts);
	const hasGifts = $derived(giftAssessments.length > 0);

	// Only a failed gift counts against the estate (per lifetime-gifts.js's own GiftStatus); a
	// survived or exempt one is out of account and gets a quiet count instead, never a row of its own.
	const outOfAccountCount = $derived(
		giftAssessments.filter((gift) => gift.status === 'survived' || gift.status === 'exempt').length
	);
	const failedGiftRows = $derived(
		giftAssessments
			.filter((gift) => gift.status === 'failed')
			.map((gift) => ({
				id: gift.id,
				recipient: gift.recipient.trim() || 'Unnamed recipient',
				amount: formatMoney(gift.amount),
				taxYear: gift.taxYear ?? 'undated',
				yearsLabel: `${gift.yearsSurvived} ${gift.yearsSurvived === 1 ? 'year' : 'years'} survived`,
				taperLabel: gift.taperReliefPct > 0 ? `, ${gift.taperReliefPct}% taper relief` : '',
				tax: formatMoney(gift.tax)
			}))
	);

	const giftDateFormatter = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});

	/** @param {string} iso ISO `YYYY-MM-DD`. @returns {string} */
	function formatGiftDate(iso) {
		const [year, month, day] = iso.split('-').map(Number);
		return giftDateFormatter.format(new Date(Date.UTC(year, month - 1, day)));
	}

	/** @param {number} days @returns {string} */
	function formatDays(days) {
		return `${days} day${days === 1 ? '' : 's'}`;
	}

	/* -------------------------------------------------------------------------- */
	/* IhtSettings form (issue #199)                                               */
	/* -------------------------------------------------------------------------- */

	// Seeded once from whatever this card is handed on mount — the Estate tab only renders this
	// component after `hydrateAppData()` has resolved (this page's own `ready` guard), the same
	// guarantee `PartnerProfile`'s own "seeded once" local state relies on. `createIhtSettings()`
	// covers the (untested-in-practice) case of a caller not passing `ihtSettings` at all.
	const seedIhtSettings = ihtSettings ?? createIhtSettings();
	let spouseExempt = $state(seedIhtSettings.spouse_exempt);
	let directDescendants = $state(seedIhtSettings.direct_descendants);
	let transferredNilRateBandPct = $state(String(seedIhtSettings.transferred_nil_rate_band_pct));
	let transferredResidenceNilRateBandPct = $state(
		String(seedIhtSettings.transferred_residence_nil_rate_band_pct)
	);
	let funeralExpenses = $state(String(seedIhtSettings.funeral_expenses));

	/** @param {number} value @returns {number} */
	function clampPct(value) {
		return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
	}

	// Rewrites the bindable `ihtSettings` from the form's current field state — every commit is a
	// finite, in-range value, never `NaN`, so a half-typed field can never reach the document a
	// parent persists (see this file's own top-of-file note on why that is this form's job, not
	// `estate-plan.js`'s re-normalisation).
	function commit() {
		ihtSettings = {
			spouse_exempt: spouseExempt,
			direct_descendants: directDescendants,
			transferred_nil_rate_band_pct: clampPct(Number(transferredNilRateBandPct) || 0),
			transferred_residence_nil_rate_band_pct: clampPct(
				Number(transferredResidenceNilRateBandPct) || 0
			),
			funeral_expenses: Math.max(0, Number(funeralExpenses) || 0)
		};
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">If I died today</h2>
	<p class="text-2xl font-semibold">{formatMoney(snapshot.valuation.total)}</p>
	<p class="text-sm text-muted-foreground mb-4">
		What your estate is worth today, valued from data already recorded on the Net Worth, Property,
		Assets and Pensions tabs, plus any life insurance recorded below — nothing here is entered
		separately.
	</p>

	<ul class="flex flex-col gap-1 mb-4 list-none p-0 m-0 text-sm">
		{#each snapshot.valuation.investmentsByWrapper as row (row.wrapper)}
			<li class="flex justify-between gap-3">
				<span>{row.label}</span>
				<span>{formatMoney(row.amount)}</span>
			</li>
		{/each}
		<li class="flex justify-between gap-3">
			<span>Property equity</span>
			<span>{formatMoney(snapshot.valuation.propertyEquity)}</span>
		</li>
		{#if showOffsetSavings}
			<li class="flex justify-between gap-3">
				<span>Offset mortgage savings</span>
				<span>{formatMoney(snapshot.valuation.offsetSavings)}</span>
			</li>
		{/if}
		<li class="flex justify-between gap-3">
			<span>Physical assets</span>
			<span>{formatMoney(snapshot.valuation.physicalAssets)}</span>
		</li>
		{#if showLifetimeIsaPots}
			<li class="flex justify-between gap-3">
				<span>Lifetime ISA pots</span>
				<span>{formatMoney(snapshot.valuation.lifetimeIsaPots)}</span>
			</li>
		{/if}
		{#if showLifeInsurance}
			<li class="flex justify-between gap-3">
				<span>Life insurance</span>
				<span>{formatMoney(snapshot.valuation.lifeInsurance)}</span>
			</li>
		{/if}
		{#if showPensionPots}
			<li class="flex justify-between gap-3">
				<span>Pension pots</span>
				<span>{formatMoney(snapshot.valuation.pensionPots)}</span>
			</li>
		{/if}
		{#each snapshot.valuation.debtsByType as row (row.type)}
			<li class="flex justify-between gap-3">
				<span>{row.label}</span>
				<span>−{formatMoney(row.amount)}</span>
			</li>
		{/each}
	</ul>

	{#if monthlyPosition}
		<p class="text-xs text-muted-foreground {hasExclusionNote ? 'mb-2' : 'mb-4'}">
			Investments and debts are from your latest recorded entry, {formatProvenanceMonth(
				monthlyPosition.start
			)} — property equity and physical assets are today's recorded values.
		</p>
	{:else}
		<p class="text-xs text-muted-foreground {hasExclusionNote ? 'mb-2' : 'mb-4'}">
			No monthly entry recorded yet, so investments and debts show as £0 rather than a real figure —
			add one on the Net Worth tab to bring them in here.
		</p>
	{/if}

	{#if showPensionExclusion}
		<p class="text-xs text-muted-foreground {showLifeInsuranceInTrust ? 'mb-2' : 'mb-4'}">
			{formatMoney(snapshot.valuation.pensionPots)} of unused Defined Contribution pension pots is left
			out of the total above — pension pots only join the estate for deaths on or after 6 April 2027.
		</p>
	{/if}

	{#if showLifeInsuranceInTrust}
		<p class="text-xs text-muted-foreground mb-4">
			{formatMoney(snapshot.valuation.lifeInsuranceInTrust)} of life insurance cover is written in trust,
			so it is left out of the total above — a policy in trust pays your beneficiaries directly and never
			becomes part of your estate, so no Inheritance Tax is charged on it. Cover not in trust is counted
			in full.
		</p>
	{/if}

	<h2 class="text-lg font-semibold mb-1">Inheritance Tax</h2>

	<p class="text-sm text-muted-foreground mb-1">What's left after tax</p>
	<p class="text-xl font-semibold mb-4">{formatMoney(snapshot.netAfterTax)}</p>

	<ul class="flex flex-col gap-1 mb-2 list-none p-0 m-0 text-sm">
		<li class="flex justify-between gap-3">
			<span>Nil-rate band</span>
			<span>
				{formatMoney(snapshot.estate.nilRateBandUsed)} of {formatMoney(
					snapshot.estate.allowances.nrb
				)}
			</span>
		</li>
		<li class="flex justify-between gap-3">
			<span>Residence nil-rate band</span>
			<span>
				{#if snapshot.estate.allowances.rnrbBeforeTaper === 0}
					No qualifying home recorded, or not passing to direct descendants
				{:else}
					{formatMoney(snapshot.estate.residenceNilRateBandUsed)} of {formatMoney(
						snapshot.estate.allowances.rnrb
					)}
				{/if}
			</span>
		</li>
	</ul>

	{#if snapshot.estate.taperApplies}
		<p class="text-xs text-muted-foreground mb-2">
			The net estate is above £2,000,000, so the residence nil-rate band is withdrawn at £1 for
			every £2 above that threshold — {formatMoney(snapshot.estate.allowances.taperLoss)} lost.
		</p>
	{/if}

	{#if snapshot.estate.unusedAllowance > 0}
		<p class="text-xs text-muted-foreground mb-4">
			{formatMoney(snapshot.estate.unusedAllowance)} of allowance unused — how much more could have passed
			before anything was taxed.
		</p>
	{/if}

	<p class="text-sm text-muted-foreground mb-1">Taxable estate</p>
	<p class="text-xl font-semibold mb-1">{formatMoney(snapshot.estate.taxableEstate)}</p>
	<p class="text-xs text-muted-foreground mb-4">
		What's left of the chargeable estate once the nil-rate band and residence nil-rate band are
		taken off.
	</p>

	{#if noTaxOwed}
		<p class="text-sm text-muted-foreground mb-4">
			No Inheritance Tax is owed — your allowances cover the whole chargeable estate.
		</p>
	{:else}
		<ul class="flex flex-col gap-1 mb-4 list-none p-0 m-0 text-sm">
			<li class="flex justify-between gap-3">
				<span>Inheritance Tax rate</span>
				<span>{formatRate(snapshot.estate.rate)}</span>
			</li>
			<li class="flex justify-between gap-3 font-medium">
				<span>Estate tax owed</span>
				<span>{formatMoney(snapshot.estate.tax)}</span>
			</li>
		</ul>
	{/if}

	{#if hasGifts}
		<div class="border-t border-border pt-4 mb-4">
			<h3 class="text-sm font-semibold mb-2">Lifetime gifts</h3>

			<ul class="flex flex-col gap-1 mb-2 list-none p-0 m-0 text-sm">
				<li class="flex justify-between gap-3">
					<span>Nil-rate band used by gifts</span>
					<span>
						{formatMoney(snapshot.nilRateBandUsedByGifts)} of {formatMoney(snapshot.nilRateBand)}
					</span>
				</li>
			</ul>

			{#if failedGiftRows.length > 0}
				<ul class="flex flex-col gap-1 mb-2 list-none p-0 m-0 text-sm">
					{#each failedGiftRows as row (row.id)}
						<li class="flex justify-between gap-3">
							<span>
								{row.recipient} — {row.amount} ({row.taxYear}, {row.yearsLabel}{row.taperLabel})
							</span>
							<span>{row.tax}</span>
						</li>
					{/each}
				</ul>
			{/if}

			{#if outOfAccountCount > 0}
				<p class="text-xs text-muted-foreground mb-2">
					{outOfAccountCount} gift{outOfAccountCount === 1 ? '' : 's'} already out of account — survived
					seven years or fully exempt.
				</p>
			{/if}

			{#if snapshot.ledger.nextToFallOut}
				<p class="text-xs text-muted-foreground mb-2">
					The next gift falls out of account on {formatGiftDate(snapshot.ledger.nextToFallOut)} —
					{formatDays(snapshot.ledger.daysToNextFallOut)} away.
				</p>
			{/if}

			<ul class="flex flex-col gap-1 list-none p-0 m-0 text-sm">
				<li class="flex justify-between gap-3">
					<span>Tax on gifts (payable by recipients, not the estate)</span>
					<span>{formatMoney(snapshot.giftTax)}</span>
				</li>
				<li class="flex justify-between gap-3 font-medium">
					<span>Total Inheritance Tax (estate + gifts)</span>
					<span>{formatMoney(snapshot.totalTax)}</span>
				</li>
			</ul>
		</div>
	{/if}

	<div class="border-t border-border pt-4">
		<h3 class="text-sm font-semibold mb-1">Assumptions</h3>
		<p class="text-xs text-muted-foreground mb-3">
			What this bill cannot read off your tracked data — changes apply straight away.
		</p>

		<div class="flex flex-col gap-2 mb-3">
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={spouseExempt}
					onchange={(event) => {
						spouseExempt = event.currentTarget.checked;
						commit();
					}}
				/>
				Whole estate passes to a spouse or civil partner, exempt
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={directDescendants}
					onchange={(event) => {
						directDescendants = event.currentTarget.checked;
						commit();
					}}
				/>
				Home passes to children or other direct descendants
			</label>
		</div>

		<div class="flex flex-wrap items-end gap-3">
			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="iht-transferred-nrb">
					Transferred nil-rate band (%)
				</label>
				<input
					id="iht-transferred-nrb"
					type="number"
					min="0"
					max="100"
					step="1"
					value={transferredNilRateBandPct}
					oninput={(event) => {
						transferredNilRateBandPct = event.currentTarget.value;
						commit();
					}}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="iht-transferred-rnrb">
					Transferred residence nil-rate band (%)
				</label>
				<input
					id="iht-transferred-rnrb"
					type="number"
					min="0"
					max="100"
					step="1"
					value={transferredResidenceNilRateBandPct}
					oninput={(event) => {
						transferredResidenceNilRateBandPct = event.currentTarget.value;
						commit();
					}}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-sm font-medium" for="iht-funeral-expenses"> Funeral expenses (£) </label>
				<input
					id="iht-funeral-expenses"
					type="number"
					min="0"
					step="0.01"
					value={funeralExpenses}
					oninput={(event) => {
						funeralExpenses = event.currentTarget.value;
						commit();
					}}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-32"
				/>
			</div>
		</div>
	</div>

	<p class="text-xs text-muted-foreground mt-4">
		Illustrative only, not financial advice. A death is also charged Inheritance Tax on any lifetime
		gift not yet survived by seven years — the estate tax owed above does not include it.
	</p>
</Card>
