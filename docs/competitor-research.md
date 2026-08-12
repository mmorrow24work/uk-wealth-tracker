# UK Wealth Tracker — Competitor Research

> Researched August 2026. Sources: WealthR blog, Aureli blog, App Store listings.

## Market Overview

The UK personal wealth tracking space in 2026 splits into three distinct categories:

1. **Open Banking spending trackers** — Emma, Moneyhub, Snoop
2. **Manual-entry wealth planners** — WealthR, WealthView, Ledgi
3. **Single-purpose specialists** — PensionBee (SIPP consolidation only)

Most serious UK users run one app from category 1 (spending) alongside one from category 2 (wealth/planning). This app sits firmly in **category 2**.

---

## App-by-App Breakdown

### WealthR — [wealthr.co.uk](https://wealthr.co.uk)
**Most direct competitor.**

- Free tier covers: UK income tax calculator (HICBC, Marriage Allowance, Scottish bands, £100k taper, salary sacrifice), FIRE / Coast FIRE / depletion modeller, 11-stream retirement income module, ISA allowance tracking across all six UK wrappers, Budget tab, BTL cashflow with gross yield, sequence-of-returns stress tests, Estate & IHT tab (April 2027 pension rules modelled)
- Pro (£39.99/yr): PDF reports, Tax Year Optimiser, what-if Scenarios, estate planning suite, unlimited history
- Manual entry only — no Open Banking by design
- Web-first PWA, works on all devices
- No native app, no Claude Code skill

**Where it wins over us:** Breadth of UK tax engine, FIRE depth, Estate/IHT modelling, established user base.  
**Where we differ:** GitHub Gist privacy model (no third-party server), landlord-specific focus, self-hostable ethos.

---

### WealthView — [wealthview.co.uk](https://wealthview.co.uk)
**Closest on privacy angle.**

- iOS only (Android "coming soon")
- £7.99 one-time unlock (no subscription)
- Strictly on-device storage — no cloud, no account
- Covers: net worth, retirement modelling, four-scenario stress test (longevity, low growth, market crash, care costs), IHT projection, CGT awareness, Scottish tax bands, ISA bridge for early retirement modelling
- Free tier limited to basic net worth + 5-row retirement preview

**Where it wins:** Native iOS UX, strictest privacy posture, one-time payment model.  
**Where we differ:** We support all platforms, no paywall for core features, BTL/rental income modelling.

---

### Ledgi — [ledgi.app](https://ledgi.app)
**Most innovative UX differentiator.**

- Clean focused tracker: net worth, ISA allowance (four UK wrappers), pension overview, live investment prices (stocks/ETFs/crypto), spending analytics via monthly snapshots
- **Unique feature:** Claude Code skill + CLI — natural language AI agent can update your data ("add my Monzo account with £2,500")
- Field-level AES encryption in cloud database
- No UK income tax calculator, no FIRE modelling, no retirement income planning
- £26.99/yr after 60-day trial

**Where it wins:** AI-agent integration, live investment prices, clean UX.  
**Where we differ:** Deeper UK tax/FIRE/planning features, free forever, no subscription required.

---

### Emma — [emma-app.com](https://emma-app.com)
**Different lane — budgeting first.**

- 2m+ UK users since 2017
- Open Banking: bank accounts, credit cards, ISAs, SIPPs aggregated automatically
- Strong spending categorisation, subscription detection, bill reminders, cashback
- Moving into direct investing (GIA, ISA, stocks, crypto; SIPP coming soon)
- Net worth tracking available but secondary to budgeting; sits behind Pro tier
- No UK tax engine, no FIRE planning, no retirement income modelling

**Best for:** Users who want automatic transaction categorisation and spending insight.  
**Not competing with us on:** Planning, tax, FIRE, BTL.

---

### Moneyhub — [moneyhub.com](https://moneyhub.com)
**Mature Open Banking aggregator.**

- FCA-regulated information provider
- Pulls transactions from current accounts, credit cards, ISAs, SIPPs, mortgages via Open Banking — updated daily, auto-categorised
- No permanent free tier at consumer level
- No UK income tax calculator, no FIRE/retirement income modelling, no ISA allowance tracking across all six wrappers

**Best for:** Users with multiple banks/cards who want unified transaction history.  
**Note:** Moneyhub closing consumer product August 2026 — users actively migrating.

---

### Snoop — [snoop.app](https://snoop.app)
**Savings-finder, not a planner.**

- Owned by Vanquis Banking Group
- Surfaces overpayments: forgotten subscriptions, energy tariff comparisons, broadband renegotiation prompts
- Open Banking-based, day-to-day focus
- No retirement modelling, no FIRE, no tax engine

**Best for:** Finding spending leaks.  
**Not competing with us on:** Anything long-term.

---

### Aureli — [aureli.app](https://aureli.app)
**Portfolio tracker with whole-wealth context.**

- UK-native: stocks, ETFs, funds, crypto with live prices alongside property, pensions, cash, debts
- FCA-regulated Open Banking connections
- Multi-currency, daily rate conversion
- AI chat layer — ask questions about your portfolio in plain English
- ISA, SIPP, workplace pension, GIA as first-class account types
- Freemium

**Best for:** Investors who want portfolio performance analytics in a full net worth context.  
**Where we differ:** No Open Banking dependency, privacy-first, BTL focus, FIRE/tax planning.

---

### PensionBee — [pensionbee.com](https://pensionbee.com)
**Not a tracker — SIPP consolidator.**

- FCA-regulated SIPP provider
- Consolidates old workplace pensions into one managed pot
- Cannot see ISAs, DB pension, property, State Pension, or SIPPs held elsewhere
- Excellent UX for what it does; wrong tool for whole-picture tracking

**Complementary use:** PensionBee to hold consolidated pot + this app to model the full picture.

---

## Feature Comparison Matrix

| Feature | This App | WealthR | WealthView | Ledgi | Emma | Aureli |
|---|---|---|---|---|---|---|
| UK ISA tracking | ✅ | ✅ (6 wrappers) | ✅ | ✅ (4 wrappers) | Partial | ✅ |
| SIPP/pension modelling | ✅ | ✅ | ✅ | Balance only | Balance only | Balance only |
| FIRE planning | ✅ | ✅ | Partial | ❌ | ❌ | ❌ |
| UK income tax engine | Partial | ✅ Full | Partial | ❌ | ❌ | ❌ |
| BTL/rental cashflow | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Estate/IHT modelling | ❌ | ✅ (Pro) | Partial | ❌ | ❌ | ❌ |
| Open Banking | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Live investment prices | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| AI agent / CLI | ❌ | ❌ | ❌ | ✅ | ❌ | Chat only |
| No account required | ✅ (Gist) | ❌ | ✅ (on-device) | ❌ | ❌ | ❌ |
| Free forever | ✅ | ✅ (core) | ❌ | ❌ | Freemium | Freemium |
| Native mobile app | ❌ (PWA) | ❌ (PWA) | iOS only | ❌ | ✅ | ✅ |
| Self-hostable | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Gaps / Opportunities Identified

Based on this research, features worth considering for the roadmap:

- **Estate/IHT tab** — WealthR has this; notable gap across most manual trackers
- **Live prices** — Ledgi/Aureli have this; could integrate a free API (Yahoo Finance, Alpha Vantage) for portfolio holdings
- **AI natural language input** — Ledgi's Claude Code skill is a genuine differentiator; worth evaluating for this stack
- **Scottish tax bands** — WealthView added these; worth ensuring parity
- **Scenario comparison** — WealthR's side-by-side scenario view is well regarded

---

*Sources: [wealthr.co.uk/blog/best-uk-net-worth-tracker-apps-2026](https://wealthr.co.uk/blog/best-uk-net-worth-tracker-apps-2026), [aureli.app/blog/best-net-worth-tracker-uk](https://aureli.app/blog/best-net-worth-tracker-uk), [apps.apple.com/gb/app/wealthview-net-worth-tracker](https://apps.apple.com/gb/app/wealthview-net-worth-tracker/id6761937882), [ledgi.app](https://ledgi.app)*
