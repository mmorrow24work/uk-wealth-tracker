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

### Decision: two persistence modes — browser-only by default, GitHub Gist sync as opt-in

**Mode 1 — Browser-only (default).** All data lives in the browser (IndexedDB, with `localStorage` as fallback) via `lib/store.js`. No GitHub token, no network call, no setup required — the app works fully offline from first load. Data never leaves the device unless the user explicitly exports it. Modelled on [SquirrelPlan](https://squirrelplan.app/)'s approach.

**Mode 2 — GitHub Gist sync (opt-in).** For cross-device access, the same data model is also written to a single JSON file in a private ("secret") GitHub Gist via `lib/gist.js`, authenticated with the user's own GitHub token.

**What "a JSON blob in a private Gist" actually means:** the app's entire dataset (profile, monthly entries, pensions, properties, assets, dividends, milestones, budget) is serialized into one JSON object and stored as the content of a single file inside a GitHub Gist. There are no tables, no rows, no query engine — every save overwrites that one file's content wholesale, every load fetches and re-parses it. "Private" here means GitHub's **secret** gist visibility: not listed publicly, not indexed by search — but **not access-controlled**. Anyone who obtains the raw file URL or the Gist's id can read its full contents without authenticating as the owner; it's obscurity, not encryption or an access-control list. This is directly relevant to the sign-in/delete-my-data work below — being signed in identifies *which* Gist is yours to read and write, it does not make that Gist's content itself any more protected than its id staying secret.

- No backend required, either mode
- GitHub sign-in (auth) only applies to Gist mode — a user on browser-only storage never needs a GitHub token at all. See GitHub Milestone 7 ("Data Portability & Access") and the delete decision below for the per-user "delete all my data" action this makes possible for Gist mode.
- JSON export/import works in both modes, as the common interchange format between them; CSV and XLSX export are secondary, read-only data paths (WealthR data portability)

### Decision: in-app token entry, not the OAuth device flow

Gist mode's token is pasted into the app (the `/connect` page) and kept in the browser, rather than obtained through GitHub's OAuth device flow.

The device flow was the preferred option on paper — no credential handling by the user at all — but it cannot be completed by a browser: GitHub's `https://github.com/login/device/code` and `/login/oauth/access_token` endpoints send no `Access-Control-Allow-Origin` header, so the exchange has to run on a server. Adding one would contradict "no backend required, either mode" above and the GitHub Pages hosting decision below, for a single-user app. A registered OAuth app's client id would also have to be configured somewhere, which is the same build-time configuration step in-app sign-in exists to remove.

What the pasted-token flow keeps: the token is verified against the GitHub API before it is stored (so a bad token fails at sign-in, not at the next save), it is stored only in the browser, it is never logged or included in an error message, and the app shows which account and which Gist are connected. What it doesn't: a token in `localStorage` is readable by any script on the app's origin. That is true of anything a backend-less app can hold; the mitigations are the token's narrow `gist` scope and the user's ability to revoke it.

`VITE_GITHUB_TOKEN` remains as a build-time fallback for deployments configured before this existed — but a `VITE_` variable is inlined into the client bundle, so that token is readable by anyone who can read the deployed JavaScript, which is precisely what signing in avoids.

### Decision: "delete all my data" deletes the whole Gist, and proves ownership before it does

Two decisions, both forced by what a Gist actually is.

**The whole Gist, not an emptied one.** A Gist keeps its revision history, and every revision stays readable to anyone holding the Gist's id — which, per the secrecy note above, is the *only* thing protecting a secret Gist's contents. Overwriting the data file with an empty document, or removing the file with a `PATCH`, would therefore leave the user's entire financial history intact one click into GitHub's "Revisions" tab, while telling them it was deleted. `DELETE /gists/:id` is the only operation that takes the history with it, so that is what the action does. The exception is a Gist that also holds files this app never wrote (a Gist the user keeps for other things): there only `uk-wealth-tracker.json` is removed, the surviving revisions are stated on screen, and deleting the rest is left to the person who knows what else is in it.

**Ownership is proved, not assumed.** The action takes no Gist id — there is no parameter for one — and runs only against the Gist this browser is syncing with, after the signed-in account, the account the token authenticates as when re-checked, and the Gist's `owner` from GitHub all agree. A build-time `VITE_GITHUB_TOKEN` cannot use the action at all: the app has never presented that token to GitHub, so it can prove nothing about whose account it reaches, and guessing is not an option for an irreversible operation. This is the concrete reason the sign-in decision above had to land first.

Browser-only mode gets its own equally-confirmed action, which clears IndexedDB *and* the `localStorage` fallback — leaving either one behind would let the next load resurrect the data the user just deleted.

---

## Hosting

### Decision: GitHub Pages

- Zero infrastructure cost
- Fits personal-use scope
- GitHub Actions for any scheduled jobs (e.g. price fetches)
- Repo: `mmorrow24work/uk-wealth-tracker` (fork of `mmorrow2012/uk-wealth-tracker`, used as the working repo for full admin access — see `upstream` git remote)

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
7. **Conversation 7** (added after Phase 1 was underway) — data portability & access: browser-only storage mode, XLSX export, GitHub sign-in for Gist mode, delete-all-my-data for Gist mode. Tracked as GitHub Milestone 7, "Data Portability & Access."

Each conversation opens with repo context + `PROJECT_PLAN.md`, same pattern as `mmorrow24work/cve-demo`.

---

## Reference App Analysis

WealthR is a SvelteKit PWA with Supabase backend (EU-hosted, row-level security). Business logic is server-side/compiled — not directly reversible. Feature spec was captured from the public homepage and used as the functional requirements source of truth. See `README.md` for full feature inventory.

---

## Data Migration

WealthR offers CSV export (Pro feature, or free via GDPR Article 20 data portability request via their Privacy page). Import into uk-wealth-tracker will be a discrete Phase 2 feature — the core data schema will be designed to accommodate it without breaking changes.
