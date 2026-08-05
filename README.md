# uk-wealth-tracker

A personal UK net worth, tax and retirement planning app — self-hosted on GitHub Pages with data stored in a private GitHub Gist. Functionally modelled on [WealthR](https://wealthr.co.uk/).

> **Personal use only.** Not financial advice. All projections are illustrative.

---

## Stack

- **Framework:** SvelteKit
- **UI:** shadcn-svelte + Tailwind CSS
- **Charts:** Recharts (or Chart.js — TBD in scaffold conversation)
- **Persistence:** GitHub Gist (JSON)
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
- CSV import: WealthR export format + generic format
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
│   │   └── estate/
│   ├── lib/
│   │   ├── gist.js               # GitHub Gist persistence
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

```bash
git clone https://github.com/mmorrow2012/uk-wealth-tracker.git
cd uk-wealth-tracker
npm install
npm run dev
```

Set a `VITE_GITHUB_TOKEN` and `VITE_GIST_ID` in `.env.local` for Gist persistence.

---

## Licence

Personal use. Not for redistribution. Not financial advice.
