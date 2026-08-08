# uk-wealth-tracker

A personal UK net worth, tax and retirement planning app — self-hosted on GitHub Pages, with data stored either fully in your browser or synced to a private GitHub Gist (see [Persistence modes](#persistence-modes)). Functionally modelled on [WealthR](https://wealthr.co.uk/).

> **Personal use only.** Not financial advice. All projections are illustrative.

---

## Stack

- **Framework:** SvelteKit
- **UI:** shadcn-svelte + Tailwind CSS
- **Charts:** LayerChart (Svelte-native, D3-based — Recharts is React-only and doesn't apply to this SvelteKit app)
- **Persistence:** Browser-only by default (IndexedDB/localStorage), with optional GitHub Gist (JSON) sync — see [Persistence modes](#persistence-modes)
- **Hosting:** GitHub Pages
- **CI/CD:** GitHub Actions

---

## Functional Requirements

### Phase 1 — Core (Free tier equivalent)

#### Net Worth Tracking
- Monthly snapshot entry: investments (per holding) + debts
- Per-holding fields: name, type, current value, purchase price, year purchased, monthly contribution, account wrapper
- Investment types: Stocks ISA, SIPP, Shares, Crypto, Cash, Emergency Fund, Dividends, Property
- Debt tracking with D/I ratio (debt-to-investment %; <14% healthy, >18% concern)
- Mortgage debt toggle (exclude from net worth when property equity already tracked)
- Net worth chart: tracked line + realistic/optimistic/pessimistic forecast lines with shaded confidence band
- Month-on-month change in £ and %
- Activity log with revert support for deleted entries
- Auto-invest amounts per holding (fills missing months with compound growth)

#### Forecast
- Three-scenario projections: pessimistic / realistic / optimistic
- Live sliders for growth rate assumption
- Retirement milestone marker on chart
- Future net worth milestones (£100k, £250k, £500k, £1M) as chart pills
- Age filter (zoom forecast to specific age range)
- Compounding effect panel: contributions vs growth split
- Stress test overlay: crash magnitude, timing, recovery rate, recovery duration

#### UK Income Tax Calculator (2026/27)
- England/Wales/NI and Scotland bands
- Take-home calculation band by band
- High Income Child Benefit Charge (HICBC) — post-April 2024 rules (£60k threshold, £80k full clawback)
- Marriage Allowance
- Child Benefit
- Student Loan plans 1, 2, 4, 5, PG
- Salary sacrifice
- 60% personal allowance taper (£100k–£125,140)

#### ISA Allowance Tracker
- All six UK ISA wrappers: Stocks & Shares, Cash, LISA, JISA, IFISA, Help to Buy
- Per-wrapper limits, contributions and remaining allowance (2026/27: £20,000 adult, £9,000 JISA)

#### FIRE / Retirement Calculator
- Magic number (25× target annual income)
- Coast FIRE number (pot size where contributions can stop)
- Accumulation and drawdown charts
- "Will my money last?" portfolio runway in years
- Adjustable sliders: target income, monthly saving, growth rate, withdrawal rate

#### Pension Tracker
- Types: DC Workplace, SIPP, Defined Benefit (Final Salary / CARE), Lifetime ISA
- Per-pot: value, contribution %, employer contribution %, annual fund fee/OCF
- DB pension: accrual rate, years of service, expected salary, or direct annual income input
- UK State Pension projection from NI qualifying years (35 years for full £241.30/week 2026/27)
- Tax relief display per pot (20% basic, 40% higher — claim extra via Self Assessment)
- Retirement income stream builder: DB, annuity, SIPP drawdown, ISA withdrawals, GIA dividends, State Pension

#### Dividend Income Planner
- Per-holding: fund/stock name, wrapper, value, annual yield %, monthly contribution, frequency, strategy (DRIP / income)
- Building phase (reinvest) vs income phase with age slider
- UK dividend allowance: £500/yr tax-free (2026/27); ISA/SIPP fully sheltered
- GIA tax rates: 10.75% basic, 35.75% higher rate
- DRIP compounding projection vs income-taken chart

#### Property Tracker
- Types: Primary residence, Buy to let, Holiday home
- Fields: value, outstanding mortgage, monthly payment, interest rate, mortgage type (fixed/tracker/SVR), deal expiry date
- Equity calculation: value minus mortgage
- BTL: rental income, running costs, net monthly cashflow, gross yield
- Mortgage deal expiry reminder (amber 90 days, red if expired)
- Property equity toggle: include/exclude from net worth
- Equity growth projection chart (30-year)

#### Physical Assets Tracker
- Categories: Watches & Jewellery, Art & Collectables, Classic/Collector Cars, Wine & Whisky, Precious Metals, Other
- Fields: name, purchase price, current value, purchase date, expected annual change %, annual holding cost
- Gain/loss vs purchase price, annualised CAGR, net position after holding costs
- Future value projection chart
- Toggle: include/exclude from net worth

#### Milestones
- Standard milestones: £10k, £25k, £50k, £100k, £250k, £500k, £1M
- Custom milestones with target amount and label
- Progress bars + forecast crossing date
- Achieved milestones shown as green chips (off chart)

#### Monthly Debrief Card
- Net worth movement vs last month (£ and %)
- Biggest driver of change
- Dividend income progress
- FIRE percentage
- Milestones hit this month
- Tracking streak (consecutive months logged)

#### Budget & Bills
- Monthly spend categories
- Recurring bills and line items
- ONS UK household average benchmarks
- Manual entry only (no bank feed)

#### Emergency Fund Tracker
- Months of cover based on monthly expenses
- Target: 1 / 3 / 6 / 12 months or custom
- Cash investment accounts counted automatically by type tag

#### Estate & IHT Calculator (Free tier)
- Nil-rate band (£325k) + residence nil-rate band (£175k)
- Spouse/civil partner transferable allowances
- April 2027 pension-IHT rule toggle (both scenarios)
- 36% charity rate (10%+ to charity)
- Estate value from existing tracked data — no re-entry

---

### Phase 2 — Extended Features

#### Data Import / Export
- CSV export: account data, monthly entries, investment positions, net worth history
- CSV import: generic format (this app's own Holdings/Debts export, parse + merge — done, #130); WealthR export format still blocked on a real sample file, see DESIGN.md's "Data Migration"
- GDPR Article 20 data portability compatible

#### Monte Carlo Retirement Simulator
- 5,000 simulated market paths
- Log-normal returns, sequence-of-returns risk
- UK tax modelled per stream
- State Pension included
- Probability of pot lasting to target age

#### Advanced Scenarios
- Income shock (job loss, illness)
- Mortgage rate rise
- Childcare cost modelling
- One-off large costs
- Budget 2026–2031 changes (pension IHT, frozen nil-rate bands)

#### Estate & IHT Planning Suite (Pro equivalent)
- Lifetime gifts with 7-year countdown and taper relief
- Who-gets-what wishes per beneficiary
- "If I died today" — what family receives per stream
- Property gift-on-sale: records as lifetime gift, splits between beneficiaries

#### Household / Partner Planning
- Mark any holding as part-owned with ownership %
- Household / You / Partner net worth lens
- Partner profile: DOB, retirement age, salary, pension, NI years
- Joint retirement forecast with dual retirement age markers
- Household budget and cash flow
- Marriage Allowance on tax tab

#### PDF Reports
- Printable summaries: net worth, investments, tax, pensions
- Useful for adviser meetings or mortgage applications

---

## Data Model (outline — to be finalised in scaffold conversation)

```
profile
  name, dob_month, dob_year, journey_stage
  monthly_contribution, growth_rate, retirement_age, retirement_target
  inflation_rate, currency, tax_region, gross_salary, pension_pct

monthly_entries[]
  month, year
  investments[]
    id, name, type, wrapper, value, bought_for, year_purchased
    monthly_contribution, contribution_frequency, fund_fee
    notes, exclude_from_net_worth, ownership_pct
  debts[]
    id, name, type, balance, notes, exclude_from_net_worth

pensions[]
  id, name, type, value, contribution_pct, employer_pct
  fund_fee, db_accrual_rate, db_years, db_salary, db_annual_income
  ni_qualifying_years, ni_future_years

properties[]
  id, name, type, value, mortgage_balance, monthly_payment
  interest_rate, mortgage_type, deal_expiry
  rental_income, running_costs, growth_rate, include_in_net_worth

assets[]
  id, name, category, purchase_price, current_value
  purchase_date, expected_growth, holding_cost, include_in_net_worth

dividends[]
  id, name, wrapper, value, yield_pct, monthly_contribution
  frequency, strategy, notes

milestones[]
  id, label, target, current, type

budget[]
  categories[], bills[], line_items[]
```

---

## Project Structure (target)

```
uk-wealth-tracker/
├── src/
│   ├── routes/
│   │   ├── +layout.svelte        # nav shell
│   │   ├── +page.svelte          # net worth dashboard
│   │   ├── forecast/
│   │   ├── retirement/
│   │   ├── tax/
│   │   ├── pensions/
│   │   ├── dividends/
│   │   ├── property/
│   │   ├── assets/
│   │   ├── budget/
│   │   ├── estate/
│   │   └── connect/              # GitHub sign-in for Gist mode + delete all my data (not a feature tab)
│   ├── lib/
│   │   ├── persistence.js        # one load/save/delete API over both storage modes
│   │   ├── browser-storage.js    # browser-only persistence (IndexedDB + localStorage)
│   │   ├── gist.js               # GitHub Gist persistence
│   │   ├── github-auth.js        # GitHub sign-in: the token + the account it belongs to
│   │   ├── tax.js                # UK tax calculations
│   │   ├── fire.js               # FIRE / retirement maths
│   │   ├── monte-carlo.js        # Monte Carlo simulator
│   │   └── store.js              # Svelte stores (global state)
│   └── components/
│       ├── NetWorthChart.svelte
│       ├── ForecastChart.svelte
│       └── ...
├── static/
├── PROJECT_PLAN.md               # living build log
├── DECISIONS.md                  # architectural decisions
├── DESIGN.md                     # framework/tooling rationale
└── README.md
```

---

## Getting Started

### Installation

```bash
git clone https://github.com/mmorrow24work/uk-wealth-tracker.git
cd uk-wealth-tracker
npm install
npm run dev
```

### Persistence modes

The app supports two persistence modes:

1. **Browser-only (default).** Data is stored in the browser itself (IndexedDB, with `localStorage` as fallback). No account, no token, no setup — works immediately, entirely offline. Data stays on the one device unless you export it. Modelled on [SquirrelPlan](https://squirrelplan.app/)'s approach; see GitHub Milestone 7 ("Data Portability & Access") for status.
2. **GitHub Gist sync (opt-in).** For access from more than one device, the same data is also written to a single JSON file in a private ("secret") GitHub Gist.

   **What "a JSON blob in a private Gist" means:** the entire dataset — profile, monthly entries, pensions, properties, assets, dividends, milestones, budget — is one JSON object stored as a single file's content in a Gist. There's no database: every save overwrites that file wholesale, every load re-fetches and re-parses it. "Private" means GitHub's **secret** gist visibility — unlisted and unindexed, but **not access-controlled**: anyone with the raw file URL or the Gist's id can read it without authenticating. Treat the id itself as a secret, not as a real access boundary. Signing in (below) identifies *which* Gist is yours to read and write; it does not make that Gist's contents any better protected than its id staying secret. It is also what lets the app prove a Gist is yours before [deleting it](#deleting-your-data).

Both modes speak the same JSON shape, so **Export data as JSON** / **Import data from JSON** works as a manual bridge between them, and as a backup mechanism either way.

**Which mode you get.** Browser-only until the app has a GitHub token, and Gist sync once it does. Signing in on the **Connect GitHub** page (reached from the connection indicator in the header) is what normally provides that token, and signing in is itself the opt-in, so it switches this browser to Gist sync; signing out puts it back. A `VITE_GITHUB_TOKEN` compiled into the build also counts, and a build carrying one starts in Gist sync mode. Either way the choice is remembered per browser and wins over that default whenever it can be honoured: a signed-in browser can be put back into browser-only mode, and a remembered "Gist" choice with no token to honour it quietly falls back to browser-only rather than failing every save. `src/lib/persistence.js` is the single load/save API over both backends — `src/lib/store.js` calls it and never a backend directly. The Settings UI for switching modes explicitly is tracked separately (issue #100).

### Connecting GitHub (Gist sync mode only)

Sign in from inside the app — no environment files, no rebuild, no redeploy:

1. Click the connection indicator in the header (it reads **Connect GitHub** when nobody is signed in).
2. Create a personal access token with the `gist` scope:
   - Visit https://github.com/settings/tokens/new?scopes=gist&description=uk-wealth-tracker (the scope is pre-ticked; the page is also linked from the app)
   - Copy the token
   - `gist` on its own is enough — it reaches nothing else in your account
3. Paste it into **GitHub personal access token** and click **Connect GitHub**. The token is checked against the GitHub API before anything is stored, so a mistyped or expired one fails there and then rather than silently on your next save.
4. That's it — the header now shows the connected account, and this browser is in Gist sync mode. Your first save creates a private Gist for you.

**Using a Gist you already have** (this is how a second device joins the same data): paste its id, or its whole URL, into **Which Gist** on the same page and click **Use this Gist**.

**Signing out** forgets the token and the account in this browser and returns it to browser-only storage. Nothing is deleted — not the Gist, not this browser's copy — and the token stays valid until you revoke it at https://github.com/settings/tokens. To delete the data itself, see [Deleting your data](#deleting-your-data).

**Where the token lives.** In this browser's own storage, sent to nowhere but `api.github.com`, never written to the console, never included in an error message, and never stored inside the Gist itself. It is readable by any script running on this app's origin — which is true of any token a backend-less app can hold — so the protection that matters is the token's narrow `gist` scope and your ability to revoke it.

> **Why a pasted token rather than "Sign in with GitHub"?** GitHub's OAuth device-flow endpoints send no CORS headers, so a browser cannot complete that exchange without a server to proxy it, and this app is a static GitHub Pages build with no backend by design.

### Deleting your data

**Delete all my data** is on the same **Connect GitHub** page, below the connection panel. It is irreversible, has no undo and no backup, and what it reaches depends on the storage mode:

- **Gist sync mode** — the Gist itself *and* this browser's copy of it. The whole Gist is deleted (`DELETE /gists/:id`), not just emptied, because a Gist keeps its revision history: overwriting or removing the data file would leave every earlier version readable to anyone with the Gist's id. If the Gist also holds files this app never wrote, only `uk-wealth-tracker.json` is removed and you are told that the earlier revisions survive — deleting the rest is your call, since only you know what else is in there.
- **Browser-only mode** — this browser's copy (IndexedDB *and* the `localStorage` fallback), which is everywhere the data has been in that mode. No other device is reached, and no request is made.

Either way the app keeps your GitHub sign-in, your token and your storage mode: this deletes data, it does not sign you out.

**Which Gist it can delete.** Only the one this browser is syncing with, and only after the app has proved it belongs to you. Before anything is deleted, three identities have to agree: the account you signed in as, the account the token authenticates as when re-checked against `GET /user`, and the account GitHub reports as the Gist's `owner`. Any disagreement aborts with nothing deleted. The action takes no Gist id from the UI, so there is nothing to point at another Gist in the first place, and it is unavailable entirely on a build-time `VITE_GITHUB_TOKEN` — the app has never asked GitHub whose that token is, so it cannot prove anything about it. Sign in first.

**Confirming it.** The first click only opens a confirmation panel, which spells out exactly what will go (the Gist id, the account, this browser's copy) and requires the word `DELETE` typed exactly before the destructive button becomes clickable. Enter does not submit it; Cancel discards it.

#### Build-time configuration (still supported)

Deployments configured before in-app sign-in existed keep working. `.env.local` can still carry:

- **`VITE_GITHUB_TOKEN`** — a token with the `gist` scope, used when nobody has signed in on this browser. Note that `VITE_`-prefixed variables are inlined into the client bundle, so anyone who can read the deployed JavaScript can read this token — which is exactly what signing in avoids.
- **`VITE_GIST_ID`** — (optional) an existing private Gist's id. A Gist chosen or created in the app wins over this one.

```bash
cp .env.example .env.local   # then fill it in and restart `npm run dev`
```

**Important:** `.env.local` is in `.gitignore` and will not be committed. Keep your token safe and never paste it into version control.

---

## Licence

Personal use. Not for redistribution. Not financial advice.
