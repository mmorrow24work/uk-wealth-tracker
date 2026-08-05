# uk-wealth-tracker — Design Decisions

## Origin

This project is a personal open-source clone of [WealthR](https://wealthr.co.uk/), a UK net worth, tax and retirement planning app. The goal is a self-hosted, GitHub Pages-deployed equivalent with full data ownership via GitHub Gist persistence.

---

## Framework Selection

### Decision: SvelteKit

**Evaluated options:**

| Option | Tokens during creation | Speed to code | Notes |
|---|---|---|---|
| React + Vite | Higher | Slower | More boilerplate; useState/useEffect ceremony adds lines |
| **SvelteKit** | **Lower** | **Faster** | Concise single-file components; reactive state with no hooks |
| Plain HTML/JS + Vite | Lowest | Fast initially | Breaks down under reactive chart/slider/shared-state requirements |

**Why SvelteKit won:**

- Svelte components are 30–50% fewer lines than equivalent React — meaningful token saving across a multi-tab app
- Reactive variables are plain `let x = 0`; no hook boilerplate
- Faster to scaffold per-tab features (tax calculator sliders, FIRE projections, chart reactivity)
- Maintainability and runtime performance were explicitly de-prioritised — AI-assisted maintenance and small app size make these moot

**React's counter-argument (acknowledged but overruled):**

Claude has deeper React training so makes fewer mistakes, reducing correction-loop token cost. This roughly cancels out the SvelteKit verbosity saving, but SvelteKit still edges it on net.

**Plain HTML/JS rejection rationale:**

Reactive charts updating on slider input, state shared across pension/forecast/tax views, and component reuse across tabs all require framework-level reactivity. Rolling this manually produces bad React.

---

## UI / Component Library

### Decision: shadcn-svelte + Tailwind

- shadcn has a mature Svelte port (shadcn-svelte) visually identical to the React original
- Presentation quality is driven by component library choice, not framework — both React and SvelteKit can produce identical output
- shadcn gives a clean financial dashboard aesthetic matching WealthR's style

---

## Data Persistence

### Decision: GitHub Gist (JSON)

- No backend required
- Auth via existing GitHub token
- Same pattern as SquirrelPlan fork work
- CSV export/import as secondary data path (WealthR data portability)

---

## Hosting

### Decision: GitHub Pages

- Zero infrastructure cost
- Fits personal-use scope
- GitHub Actions for any scheduled jobs (e.g. price fetches)
- Repo: `mmorrow2012/uk-wealth-tracker`

---

## Build Strategy

### Decision: Incremental — one tab per conversation

Full Phase 1 in one conversation burns too many tokens and risks context window degradation mid-build. Recommended sequence:

1. **Conversation 1** — repo scaffold + data model + Gist persistence + nav shell
2. **Conversation 2** — net worth tab + charts
3. **Conversation 3** — FIRE / forecast tab
4. **Conversation 4** — UK tax calculator
5. **Conversation 5** — pensions + dividends
6. **Conversation 6** — property + assets

Each conversation opens with repo context + `PROJECT_PLAN.md`, same pattern as `mmorrow24work/cve-demo`.

---

## Reference App Analysis

WealthR is a SvelteKit PWA with Supabase backend (EU-hosted, row-level security). Business logic is server-side/compiled — not directly reversible. Feature spec was captured from the public homepage and used as the functional requirements source of truth. See `README.md` for full feature inventory.

---

## Data Migration

WealthR offers CSV export (Pro feature, or free via GDPR Article 20 data portability request via their Privacy page). Import into uk-wealth-tracker will be a discrete Phase 2 feature — the core data schema will be designed to accommodate it without breaking changes.
