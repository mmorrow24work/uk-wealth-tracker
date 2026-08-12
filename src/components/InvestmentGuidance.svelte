<script>
	/**
	 * Plain-English ISA guidance and non-ISA CGT explanation for the Net Worth tab's investment
	 * holdings form (issue #255). Educational text only — no new calculation. Collapsed by default,
	 * behind a native `<details>`, the same disclosure pattern `StudentLoanRepayment.svelte`'s "All
	 * five plan types" and the chart components' "Show as a table" already use — a returning user who
	 * already knows this content never has to scroll past it to reach the data-entry form above.
	 *
	 * Every number quoted here is imported from the module that already owns it — `$lib/isa.js` for
	 * the ISA allowances, `$lib/capital-gains.js` for the Capital Gains Tax annual exempt amount and
	 * rate ladder — rather than restated as a literal, so this component cannot go out of sync with
	 * the ISA Allowance Tracker (Tax tab) or the property CGT scenario tool it quotes figures from.
	 */
	import { ISA_WRAPPERS, WRAPPER_LABELS } from '$lib/enums.js';
	import {
		ADULT_ISA_ALLOWANCE,
		ISA_TAX_YEAR,
		JISA_ALLOWANCE,
		LISA_ANNUAL_SUBLIMIT
	} from '$lib/isa.js';
	import {
		CGT_ANNUAL_EXEMPT_AMOUNT,
		CGT_TAX_YEAR,
		RESIDENTIAL_CGT_BASIC_RATE,
		RESIDENTIAL_CGT_HIGHER_RATE
	} from '$lib/capital-gains.js';
	import Card from './ui/card.svelte';

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});

	/** @param {number} amount */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/**
	 * One short paragraph per ISA wrapper — "UK ISA Options Explained" — in `ISA_WRAPPERS`' own
	 * order, which is the order the ISA Allowance Tracker already lists them in.
	 *
	 * Help to Buy's "closed to new applicants" claim matches `$lib/isa.js`'s own
	 * `closedToNewAccounts` fact (30 November 2019), so this reads the same date the ISA Allowance
	 * Tracker already asserts rather than a second, possibly-drifting copy of it.
	 *
	 * @type {Record<'isa_stocks_shares' | 'isa_cash' | 'lisa' | 'jisa' | 'ifisa' | 'htb_isa', string>}
	 */
	const WRAPPER_EXPLANATIONS = {
		isa_stocks_shares: `Funds, shares, bonds and investment trusts, held inside the wrapper. No sub-limit of its own — draws on the shared ${formatMoney(ADULT_ISA_ALLOWANCE)} adult allowance. Growth and any dividends inside it are entirely free of Income Tax, Dividend Tax and Capital Gains Tax.`,
		isa_cash: `Cash savings, including fixed-rate and notice accounts, with the interest free of Income Tax. Also draws on the shared ${formatMoney(ADULT_ISA_ALLOWANCE)} allowance. The lowest-risk of the ISA wrappers — the balance doesn't fall in value, though inflation can still erode what it's worth in real terms.`,
		lisa: `For a first home (up to £450,000) or retirement from age 60. Its own ${formatMoney(LISA_ANNUAL_SUBLIMIT)}/yr sub-limit sits inside the shared ${formatMoney(ADULT_ISA_ALLOWANCE)} adult allowance, not beside it, and the government adds a 25% bonus on top of what's paid in. Withdraw it for anything else and a 25% penalty applies instead — see "Which ISA for your goals?" below for why this app tracks it on the Pensions tab rather than here.`,
		jisa: `Opened by a parent or guardian for a child under 18, but the money belongs to the child, who can access it from age 18. Its own separate ${formatMoney(JISA_ALLOWANCE)}/yr allowance — it doesn't share with, or reduce, the adult ${formatMoney(ADULT_ISA_ALLOWANCE)} above.`,
		ifisa: `Holds peer-to-peer loans and debt-based crowdfunding instead of cash or listed investments. Draws on the shared ${formatMoney(ADULT_ISA_ALLOWANCE)} allowance. Materially higher risk than the other ISA wrappers: the loans inside it can default, and it carries none of the deposit protection a bank or building society savings account has.`,
		htb_isa: `A savings account for a first home deposit, topped up with a 25% government bonus, paid out when you complete on a home. Closed to new applicants since 30 November 2019 — existing holders can keep paying in, inside the same shared ${formatMoney(ADULT_ISA_ALLOWANCE)} allowance, and still claim the bonus, but nobody can open a new one.`
	};

	/**
	 * `ISA_WRAPPERS` is typed as `readonly Wrapper[]` in `$lib/enums.js` (it lists all six, but the
	 * type covers all ten wrapper codes), so iterating it hands back a plain `Wrapper` — this narrows
	 * back to a key {@link WRAPPER_EXPLANATIONS} actually has, rather than widening the object to
	 * cover the four non-ISA wrappers it has no paragraph for.
	 *
	 * @param {import('$lib/enums.js').Wrapper} wrapper
	 * @returns {string}
	 */
	function explanationFor(wrapper) {
		return WRAPPER_EXPLANATIONS[/** @type {keyof typeof WRAPPER_EXPLANATIONS} */ (wrapper)];
	}
</script>

<Card className="p-4">
	<details>
		<summary class="text-base font-semibold cursor-pointer select-none">
			ISA guidance &amp; investment tax basics
		</summary>

		<div class="mt-4 flex flex-col gap-5 text-sm">
			<section>
				<h3 class="text-sm font-semibold mb-1">Key rules for all ISAs</h3>
				<ul class="list-disc pl-5 flex flex-col gap-1 text-muted-foreground">
					<li>
						Everyone gets a {formatMoney(ADULT_ISA_ALLOWANCE)} ISA allowance each tax year ({ISA_TAX_YEAR}).
						It's one combined limit shared across every adult ISA type — Cash, Stocks &amp; Shares,
						Innovative Finance, and the Lifetime ISA's own smaller limit sits inside it too — not
						{formatMoney(ADULT_ISA_ALLOWANCE)} for each one separately.
					</li>
					<li>
						Growth and withdrawals inside any ISA are entirely free of Income Tax, Dividend Tax and
						Capital Gains Tax, and none of it needs to go on a tax return.
					</li>
					<li>
						Since 6 April 2024, savers are no longer limited to one account of a given ISA type —
						you can pay into more than one Cash, Stocks &amp; Shares or Innovative Finance ISA in
						the same tax year, for instance to split across providers. The {formatMoney(
							ADULT_ISA_ALLOWANCE
						)} cap is what actually limits you, not a one-account-per-type rule.
					</li>
					<li>
						The Junior ISA is separate again: its own {formatMoney(JISA_ALLOWANCE)} allowance, belonging
						to the child rather than the parent, which neither shares nor competes with the adult
						{formatMoney(ADULT_ISA_ALLOWANCE)} above.
					</li>
				</ul>
			</section>

			<section>
				<h3 class="text-sm font-semibold mb-1">Which ISA for your goals?</h3>
				<ul class="list-disc pl-5 flex flex-col gap-1 text-muted-foreground">
					<li>
						<span class="font-medium text-foreground"
							>Emergency fund or a goal within a few years</span
						>
						— a Cash ISA. Capital is protected and the interest is tax-free; you're trading potential
						growth for certainty.
					</li>
					<li>
						<span class="font-medium text-foreground">Long-term growth (five-plus years)</span>
						— a Stocks &amp; Shares ISA. It can fall as well as rise in value, but has more time to compound
						over a long horizon.
					</li>
					<li>
						<span class="font-medium text-foreground">Peer-to-peer lending exposure</span>
						— an Innovative Finance ISA. This is materially higher risk than a Cash or Stocks &amp; Shares
						ISA: the underlying loans can default, and unlike a savings account, money in an IFISA has
						no deposit-protection scheme behind it.
					</li>
					<li>
						<span class="font-medium text-foreground">A first home or retirement</span>
						— a Lifetime ISA. It has its own {formatMoney(LISA_ANNUAL_SUBLIMIT)}/yr sub-limit
						(inside the shared {formatMoney(ADULT_ISA_ALLOWANCE)} allowance, not beside it), a 25% government
						bonus on what's paid in, and a 25% penalty on withdrawals outside a first home purchase or
						age 60. This app tracks the Lifetime ISA on the
						<span class="font-medium text-foreground">Pensions tab</span>, not here — see
						<code class="text-xs">PENSION_TYPES</code>
						in
						<code class="text-xs">$lib/enums.js</code>.
					</li>
				</ul>
			</section>

			<section>
				<h3 class="text-sm font-semibold mb-1">UK ISA options explained ({ISA_TAX_YEAR})</h3>
				<ul class="flex flex-col gap-2 text-muted-foreground">
					{#each ISA_WRAPPERS as wrapper (wrapper)}
						<li>
							<span class="font-medium text-foreground">{WRAPPER_LABELS[wrapper]}</span> —
							{explanationFor(wrapper)}
						</li>
					{/each}
				</ul>
			</section>

			<section>
				<h3 class="text-sm font-semibold mb-1">Capital Gains Tax for non-ISA investments</h3>
				<p class="text-muted-foreground">
					Gains inside an ISA or a SIPP are never subject to Capital Gains Tax at all — that's the
					whole point of using one of those wrappers. A General Investment Account (<code
						class="text-xs">gia</code
					>) or any other unwrapped holding gets no such shelter: sell for more than you paid, and
					the gain is potentially taxable.
				</p>
				<p class="text-muted-foreground mt-2">
					Each tax year ({CGT_TAX_YEAR}) you get an Annual Exempt Amount of {formatMoney(
						CGT_ANNUAL_EXEMPT_AMOUNT
					)} before any Capital Gains Tax is due — one allowance per person, shared across every gain
					you make that year, not a separate {formatMoney(CGT_ANNUAL_EXEMPT_AMOUNT)} for shares specifically.
					Above that, the rate depends on your Income Tax band: {RESIDENTIAL_CGT_BASIC_RATE}% on the
					gain inside your remaining basic rate band, {RESIDENTIAL_CGT_HIGHER_RATE}% above it — the
					same two rates this app's property Capital Gains Tax tool uses, since they were aligned
					with the property rates in the October 2024 Budget (shares and funds were taxed at a lower
					10%/20% before then). There's no separate additional rate for Capital Gains Tax: a
					higher-rate and an additional-rate taxpayer both pay {RESIDENTIAL_CGT_HIGHER_RATE}% above
					the basic rate band.
				</p>
				<p class="text-muted-foreground mt-2">
					This is background only — this app doesn't calculate Capital Gains Tax on shares, funds or
					crypto. The property scenario tool on the Tax tab is the one Capital Gains Tax calculator
					that exists so far.
				</p>
			</section>

			<p class="text-xs text-muted-foreground">
				Illustrative only, not financial advice. {ISA_TAX_YEAR} ISA figures and {CGT_TAX_YEAR} Capital
				Gains Tax figures — see README.md's tax-figures section for sourcing and confidence notes on each.
			</p>
		</div>
	</details>
</Card>
