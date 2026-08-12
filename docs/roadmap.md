
# Private repo

A private repo can still publish a public website via GitHub Pages, but there's a catch:

**It requires GitHub Pro or higher** (which you have on your account). Free accounts can only publish Pages from public repos.

To enable it:
- Repo → **Settings** → **Pages**
- Set source to your branch/folder as normal
- The site publishes publicly at `mmorrow24work.github.io/uk-wealth-tracker` (or your custom domain) even though the source code is private

Visitors can see the deployed site but cannot see your source code, Gist tokens, or any config you have in the repo.

One thing to be aware of: anything baked into the **built/deployed output** (i.e. what ends up in your `gh-pages` branch or `dist/` folder) is still publicly visible if someone inspects the page source or JS bundles. So make sure no secrets, API keys, or Gist tokens are hardcoded into the SvelteKit build output — they should come from runtime user input or environment variables that aren't embedded at build time.

# Poundshop

Create the poundshop app store where all of my apps are free to users but it allows users to donate what they can afford to charity in return for becoming a named sponsor on the app.

Purchase unique domains from Cloudflare - https://www.cloudflare.com/

# Hosting Options — Beyond GitHub Pages

> Analysis as of August 2026. Current hosting: GitHub Pages (free, static, tied to GitHub Pro).

### Why Consider Alternatives

GitHub Pages works well today but has constraints worth tracking:

- Requires GitHub Pro for private-repo publishing (currently £3.99/mo billed annually)
- 100GB/month soft bandwidth cap
- Build pipeline is GitHub Actions only — no preview deployments per PR
- No edge network — served from GitHub's CDN, not a global edge

The three realistic alternatives for a SvelteKit static site are **Cloudflare Pages**, **Netlify**, and **Vercel**.

---

### Cloudflare Pages

**Cost:** Free tier covers this use case entirely.

| Limit | Free tier |
|---|---|
| Bandwidth | Unlimited (no hard cap) |
| Builds/month | 500 |
| Custom domains | 100 per project |
| Static requests | Unlimited |
| Sites | Unlimited |

Paid plan (Pro) is $20/mo billed annually — not needed for this project.

**Benefits:**
- Unlimited bandwidth is genuine — Cloudflare's business model means bandwidth is not their cost centre, so there is no surprise bill if traffic spikes
- 300+ global edge locations; fastest static asset delivery of the three platforms, with average TTFB around 45ms in benchmarks
- Preview deployments per branch/PR — each push gets its own URL for review
- Private repo support — source stays private, site publishes publicly
- Custom domain with free SSL included
- No GitHub Pro dependency — hosting cost drops to £0 if GitHub is downgraded
- Integrates naturally with Cloudflare DNS, Access (email OTP gating), and Tunnel — consistent with existing home-lab setup
- SvelteKit static adapter works natively; no framework-specific friction for a fully static build
- Workers available if server-side functionality is ever needed (100,000 free requests/day)

**Downsides:**
- Slightly more setup than GitHub Pages — Wrangler CLI and Pages dashboard have a learning curve, though this has improved substantially in 2025/26
- Build pipeline breadth (Workers, KV, D1, R2) means more to navigate than needed for a pure static site
- SvelteKit SSR (if ever used) requires the Cloudflare adapter — a different adapter from the static one

**Verdict for this project:** Best option if moving away from GitHub Pages. Unlimited bandwidth removes the one meaningful limit GitHub Pages has, and the Cloudflare ecosystem is already familiar from the home-lab Tunnel/Access setup.

---

### Netlify

**Cost:** Free tier is usable; paid is $19/mo.

| Limit | Free tier |
|---|---|
| Bandwidth | 100GB/month |
| Build minutes | 300/month |
| Serverless functions | 125,000 invocations/month |
| Custom domains | ✅ included |

**Benefits:**
- Simplest onboarding of the three — drag-and-drop or Git connect, works immediately
- Preview deployments per PR out of the box
- Form handling, Identity (auth), and split testing built in — useful if contact/waitlist forms are ever added
- Private repo support
- SvelteKit works well

**Downsides:**
- 100GB/month bandwidth cap on free tier — could be hit if traffic grows; overages are charged
- Build minutes cap (300/month) is tighter than Cloudflare's 500 builds
- Less globally distributed than Cloudflare — fewer edge locations outside US/EU
- Paid tier is $19/mo, less competitive than Cloudflare at scale

**Verdict:** Good for simplicity and form handling; weaker than Cloudflare on bandwidth and global performance. Worth considering if the Cloudflare setup feels like overhead for a personal project.

---

### Vercel

**Cost:** Hobby (free) tier available; Pro is $20/user/month.

| Limit | Hobby tier |
|---|---|
| Bandwidth | 100GB/month |
| Serverless functions | Limited |
| Commercial use | **Not permitted on Hobby tier** |

**Benefits:**
- Best developer experience of the three — fast deploys, excellent dashboard, tight Git integration
- Best platform for Next.js specifically (Vercel builds Next.js)
- Preview deployments, analytics, and image optimisation included
- SvelteKit is supported via adapter

**Downsides:**
- Hobby tier prohibits commercial use — if this app ever charges users or runs ads, Hobby is not compliant; Pro at $20/user/month would be required
- 100GB/month bandwidth cap — same issue as Netlify
- Bandwidth overages can generate surprise bills at traffic spikes
- Costlier than Cloudflare at any paid tier (per-user pricing)

**Verdict:** Best DX but wrong licensing for a potentially commercial project on the free tier. Skip unless already invested in Vercel for other projects.

---

### Comparison Summary

| | GitHub Pages | Cloudflare Pages | Netlify | Vercel |
|---|---|---|---|---|
| **Cost** | Free (needs GitHub Pro) | Free | Free | Free (non-commercial only) |
| **Bandwidth** | 100GB soft cap | Unlimited | 100GB cap | 100GB cap |
| **Builds/mo** | GitHub Actions minutes | 500 | 300 min | Limited |
| **Custom domain + SSL** | ✅ | ✅ | ✅ | ✅ |
| **Private repo → public site** | ✅ (Pro required) | ✅ | ✅ | ✅ |
| **Preview deployments** | ❌ | ✅ | ✅ | ✅ |
| **SvelteKit static** | ✅ | ✅ | ✅ | ✅ |
| **Commercial use on free** | ✅ | ✅ | ✅ | ❌ |
| **Edge locations** | GitHub CDN | 300+ | ~100 | ~100 |
| **Surprise bill risk** | Low | None | Medium | High |

---

### Recommendation

**Stay on GitHub Pages** while the app is in active development and the repo is private under GitHub Pro.

**Migrate to Cloudflare Pages** as a natural next step if:
- GitHub Pro is ever downgraded (removing Pages private-repo support)
- Traffic grows to where the 100GB GitHub Pages soft cap becomes a concern
- PR preview deployments become useful for the one-tab-per-conversation build workflow
- The Cloudflare Access/Tunnel pattern from the home lab is applied here for staging gating

Migration effort is low — point Cloudflare Pages at the same repo, set the build command (`vite build` or `svelte-kit build`), output directory (`build` or `.svelte-kit/output`), and update DNS. No code changes required for a fully static adapter build.

---


# UK Wealth Tracker — Roadmap

> Derived from competitor research (August 2026).  
> Prioritised by: competitive gap, implementation effort, and alignment with core positioning (privacy-first, free forever, BTL-aware, self-hostable).

---

## Positioning Principles

These guide what gets built and what doesn't:

- **No Open Banking** — manual entry by design; GitHub Gist is the persistence layer
- **Free forever** — no paywalled core features
- **Privacy-first** — no third-party server sees user data
- **UK-specific** — ISA wrappers, SIPP, BTL, UK tax rules; not a US app with GBP bolted on
- **Self-hostable** — repo stays forkable and deployable by anyone

---

## Current State (Baseline)

| Feature | Status |
|---|---|
| Net worth tracking | ✅ |
| UK ISA tracking | ✅ |
| SIPP/pension modelling | ✅ |
| FIRE planning | ✅ |
| BTL/rental cashflow | ✅ |
| UK income tax engine | 🔶 Partial |
| GitHub Gist persistence | ✅ |
| GitHub Pages hosting | ✅ |
| PWA (installable) | ✅ |
| Estate/IHT modelling | ❌ |
| Live investment prices | ❌ |
| Scottish tax bands | ❌ |
| Scenario comparison | ❌ |
| AI natural language input | ❌ |

---

## Milestone Plan

### M1 — Tax Engine Parity
*Close the gap with WealthR and WealthView on UK tax accuracy.*

- [ ] Scottish income tax bands (Starter 19%, Basic 20%, Intermediate 21%, Higher 42%, Advanced 45%, Top 48%)
- [ ] HICBC (High Income Child Benefit Charge) calculator
- [ ] £100k personal allowance taper (the 60% effective rate trap)
- [ ] Marriage Allowance
- [ ] Salary sacrifice impact on take-home
- [ ] Student Loan Plan 1/2/4/5 + Postgrad deductions
- [ ] Tax year switcher (2025/26 → 2026/27)

**Competitor reference:** WealthR covers all of these in free tier; WealthView covers Scottish bands and basic tax. This is table stakes for a credible UK planning tool.

---

### M2 — ISA Wrapper Completeness
*Expand from current ISA tracking to all six UK wrappers.*

- [ ] Stocks & Shares ISA
- [ ] Cash ISA
- [ ] Lifetime ISA (LISA) — with 25% bonus and withdrawal penalty modelling
- [ ] Junior ISA (JISA)
- [ ] Innovative Finance ISA (IFISA)
- [ ] Legacy Help to Buy ISA (read-only / sunset tracking)
- [ ] Annual allowance tracker (£20,000 limit, shared across wrappers)
- [ ] LISA first-home vs retirement mode distinction

**Competitor reference:** WealthR tracks all six; Ledgi covers four; Emma partial. Six-wrapper coverage is a meaningful differentiator for UK users.

---

### M3 — Retirement Income Modelling
*Move beyond pot size to modelled income streams.*

- [ ] State Pension — input NI qualifying years, project weekly/annual amount
- [ ] Defined Benefit pension — annual income + indexation (CPI/RPI/fixed)
- [ ] Workplace DC + SIPP drawdown
- [ ] LISA retirement mode (after age 60)
- [ ] ISA bridge — drawdown ISA to fund income before pension access age (55/57)
- [ ] Tax-efficient withdrawal ordering across all streams
- [ ] Sustainable withdrawal rate view (3.5% / 4% SWR)

**Competitor reference:** WealthR models 11 income streams with correct UK tax treatment. WealthView models ISA bridge explicitly. No other competitor in the manual-entry category does this well.

---

### M4 — Estate & IHT Modelling
*The most notable gap vs WealthR; absent from almost all competitors.*

- [ ] IHT position calculated from tracked net worth
- [ ] Nil-rate band (£325k) and residence nil-rate band (£175k)
- [ ] Spouse/civil partner transferable allowances
- [ ] £2m taper on RNRB
- [ ] 36% charity rate (10%+ to charity)
- [ ] April 2027 pension IHT rule — pensions brought into estate; model both pre- and post-rule
- [ ] 7-year gift taper (record gifts, start clock automatically)
- [ ] "If you died today" death-benefit snapshot

**Competitor reference:** WealthR shipped this June 2026 and considers it a unique differentiator. WealthView has a basic IHT projection. No other manual-entry app covers this.

---

### M5 — Stress Testing & Scenarios
*Move from single-path projections to range of outcomes.*

- [ ] Four-scenario retirement stress test: longevity / low growth / market crash / care costs (matching WealthView)
- [ ] Sequence-of-returns risk illustration
- [ ] Income shock modelling (job loss, mortgage rate rise, childcare cost)
- [ ] Named scenario save + side-by-side comparison (matching WealthR Pro feature — but free here)
- [ ] FIRE date sensitivity: what does +1%/−1% return do to the date?

**Competitor reference:** WealthR offers scenario comparison at Pro tier (£39.99/yr). WealthView has four-scenario stress test behind paywall. Offering this free is a genuine differentiator.

---

### M6 — Live Investment Prices
*The clearest functional gap vs Ledgi and Aureli.*

- [ ] Portfolio holdings input (ticker, quantity, account type)
- [ ] Live price fetch via free API (Yahoo Finance via `query1.finance.yahoo.com` — no key required, or Alpha Vantage free tier)
- [ ] Daily price cache to avoid rate limits (store in Gist alongside user data)
- [ ] Holdings breakdown by account type (ISA / GIA / SIPP)
- [ ] Simple gain/loss vs average cost basis
- [ ] Crypto prices (CoinGecko free API)

**Competitor reference:** Ledgi and Aureli both offer live prices. This is table stakes for users with investment portfolios rather than just cash/property.

**Privacy note:** Price fetches are ticker-only — no personal data sent to any price API.

---

### M7 — BTL Enhancements
*Deepen the landlord differentiator — no competitor covers this well.*

- [ ] Multiple properties with individual cashflow views
- [ ] Section 24 tax impact calculator (finance cost restriction, basic rate tax credit)
- [ ] Gross yield, net yield, and ROE per property
- [ ] Mortgage details — rate, term, outstanding balance, monthly payment
- [ ] Rental income vs mortgage stress test (rental coverage ratio)
- [ ] Capital gains tax on disposal — including PPR relief if applicable
- [ ] Incorporation analysis (Ltd company vs personal ownership) — high-level comparison

**Competitor reference:** WealthR has BTL cashflow with gross yield. No other competitor covers BTL at depth. This is a real moat given UK private landlord numbers.

---

### M8 — UX & PWA Polish
*Close the experience gap with native apps.*

- [ ] Installable PWA — add to home screen prompt, offline mode
- [ ] Dark mode
- [ ] Monthly snapshot — guided balance update, net worth delta vs last month
- [ ] Net worth history chart — rolling 12/24/36 months
- [ ] Export — CSV of net worth history and asset breakdown
- [ ] Keyboard navigation and accessibility audit
- [ ] Mobile-first layout review (current design vs phone viewport)

---

### Backlog / Under Consideration

These are not committed but worth tracking:

| Item | Notes |
|---|---|
| AI natural language input | Ledgi's Claude Code skill is a genuine differentiator; feasible via Anthropic API in-browser |
| Slow-travel residency tax | Days-in-country tracker, split-year treatment, statutory residence test — unique to this user base |
| SIPP contribution optimiser | Annual allowance, carry forward (3 prior years), employer contributions |
| Pension consolidation tracker | Not a consolidator (that's PensionBee's job) but track which old pots exist and their status |
| Multi-currency net worth | For assets held abroad; convert at daily rate |
| Moneyhub migrant capture | Moneyhub closing August 2026 — opportunity to capture migrating users with a landing page |

---

## Won't Build

To keep scope honest:

| Item | Reason |
|---|---|
| Open Banking / bank linking | Requires FCA authorisation; contradicts privacy-first model |
| In-app investing | Regulated activity; out of scope |
| Transaction categorisation | Requires Open Banking; different product category |
| Native iOS/Android app | PWA is sufficient; native doubles maintenance cost |
| Subscription / paywall | Core positioning is free forever |

---

## Milestone Summary

| Milestone | Theme | Competitive Target |
|---|---|---|
| M1 | Tax engine parity | WealthR / WealthView |
| M2 | ISA wrapper completeness | WealthR |
| M3 | Retirement income modelling | WealthR |
| M4 | Estate & IHT | WealthR (unique gap) |
| M5 | Stress testing & scenarios | WealthR / WealthView |
| M6 | Live investment prices | Ledgi / Aureli |
| M7 | BTL enhancements | Uncontested |
| M8 | UX & PWA polish | WealthView (native feel) |

---

*Based on: [docs/competitor-research.md](./competitor-research.md)*
