# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository currently contains **only planning documents** (`README.md`, `DESIGN.md`) — no application code has been scaffolded yet. There is no `package.json`, no build/lint/test tooling, and no source tree. Before assuming any commands or file structure, check whether the scaffold has since been created; if not, the first task in this repo is likely the scaffold itself.

## What this project is

A personal UK net worth, tax and retirement planning app, functionally modelled on [WealthR](https://wealthr.co.uk/). Self-hosted on GitHub Pages, no backend. Data is stored in the browser by default, with optional sync to a private GitHub Gist for cross-device access (see DESIGN.md's "Data Persistence" section and GitHub Milestone 7). Personal use only — not financial advice, all projections illustrative.

Repo: `mmorrow24work/uk-wealth-tracker` (fork of `mmorrow2012/uk-wealth-tracker`, used as the working repo — `origin` remote points here, `upstream` points to the original).

## Planned stack (from DESIGN.md)

- **Framework:** SvelteKit — chosen deliberately over React for token/verbosity reasons (see "Build philosophy" below), not for technical superiority.
- **UI:** shadcn-svelte + Tailwind CSS
- **Charts:** Recharts or Chart.js — undecided, resolve in the scaffold conversation if not already settled
- **Persistence:** Browser-only by default (IndexedDB/localStorage, no setup); optional GitHub Gist (JSON) sync, authenticated by signing in on the app's `/connect` page (token kept in the browser). `VITE_GITHUB_TOKEN`/`VITE_GIST_ID` in `.env.local` still work as a build-time fallback. Gist mode only, not browser-only mode, needs GitHub sign-in.
- **Hosting:** GitHub Pages, deployed via GitHub Actions

## Build philosophy — read before making framework/architecture choices

DESIGN.md records these as deliberate, already-settled decisions — don't re-litigate them without the user raising it:

- SvelteKit was chosen over React specifically because Svelte components run 30–50% fewer lines for equivalent functionality (no hooks/useState ceremony), which matters for a multi-tab app built incrementally across many conversations. Maintainability and runtime performance were **explicitly de-prioritised** in favour of build speed and token economy.
- Plain HTML/JS was rejected: the app needs framework-level reactivity (charts reacting to sliders, state shared across tabs), and hand-rolling that produces worse code than just using a framework properly.
- **Build incrementally, one feature area per conversation.** DESIGN.md prescribes this sequence: (1) repo scaffold + data model + Gist persistence + nav shell, (2) net worth tab + charts, (3) FIRE/forecast tab, (4) UK tax calculator, (5) pensions + dividends, (6) property + assets. Don't try to build all of Phase 1 in one pass — it burns context and risks degradation mid-build. Each conversation should open by reading repo context plus `PROJECT_PLAN.md` (a living build log — create/consult it once the scaffold exists).

## Architecture (target — see README.md for full detail)

Once scaffolded, the intended structure is:

```
src/
├── routes/            # one directory per tab: forecast, retirement, tax, pensions,
│                       # dividends, property, assets, budget, estate
├── lib/
│   ├── persistence.js  # one load/save API over both storage modes — the only one store.js calls
│   ├── browser-storage.js # browser-only persistence (IndexedDB, localStorage fallback)
│   ├── gist.js         # GitHub Gist read/write (+ which Gist, + connect/disconnect)
│   ├── github-auth.js  # GitHub sign-in: the token and the account it belongs to
│   ├── tax.js          # UK income tax calculations
│   ├── fire.js         # FIRE / retirement maths
│   ├── monte-carlo.js  # Monte Carlo retirement simulator (Phase 2)
│   └── store.js        # Svelte stores — global reactive state shared across tabs
└── components/         # NetWorthChart.svelte, ForecastChart.svelte, etc.
```

Key architectural point: **all persisted data lives in one JSON blob**, either in the browser (default, no setup) or additionally synced to a private GitHub Gist (opt-in, cross-device), read/written through `lib/persistence.js`, which routes to `lib/browser-storage.js` (IndexedDB + `localStorage` fallback) or `lib/gist.js` depending on the active mode. There is no backend and no database — every feature tab reads/writes against the same in-memory store (`lib/store.js`). Gist mode's credential comes from `lib/github-auth.js` (in-app sign-in, token in `localStorage`; `VITE_GITHUB_TOKEN` is only a fallback) — `gist.js` imports it, never the other way round. "Private" Gist means GitHub's *secret* (unlisted) visibility, not access control — anyone with the raw URL or Gist id can read it; see DESIGN.md for why this matters for the sign-in / delete-my-data work. When adding a new feature area, extend the shared data model rather than introducing separate storage.

## Data model

The full outline (profile, monthly_entries, pensions, properties, assets, dividends, milestones, budget) is in README.md under "Data Model" — treat it as the source of truth for shape when building persistence or forms, but expect it to evolve ("to be finalised in scaffold conversation"). Data import from WealthR's CSV export format is a planned Phase 2 feature, so avoid schema changes that would break that compatibility path without checking DESIGN.md's "Data Migration" section.

## Domain rules worth knowing

The functional spec (README.md) encodes real UK tax-year-specific rules for 2026/27 — e.g. HICBC thresholds (£60k–£80k), the 60% personal allowance taper (£100k–£125,140), ISA allowances (£20,000 adult / £9,000 JISA), State Pension (£241.30/week at 35 qualifying NI years), and IHT nil-rate bands (£325k + £175k residence). These are tax-year-specific figures, not arbitrary constants — when implementing tax/pension/ISA logic, match README.md's stated figures exactly rather than substituting general knowledge, since UK allowances change every tax year.

## Getting started (once scaffolded)

```bash
npm install
npm run dev
```
