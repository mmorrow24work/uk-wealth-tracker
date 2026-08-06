# Build Journal

Append-only log of each automated build-pipeline run, newest entries at the bottom. One entry per issue, added by the Claude Code session that implemented it, with a `<!-- METRICS:<slug> -->` block whose numbers are filled in afterward by the workflow from the run's actual duration/token usage.

Entry format. The Claude Code session that implements the issue writes everything **except** the six placeholder tokens below (`191` etc.) verbatim — the pipeline's metrics-patch step replaces those tokens after the run finishes, since only it knows actual wall-clock duration and billed token usage:

```
## <Issue Title> — <YYYY-MM-DD>
<!-- METRICS:<slug> -->
- **Execution Duration:** 191 seconds
- **Model:** claude-sonnet-5
- **Turns:** 37
- **Input Tokens:** n/a (execution log not retained for this manually-completed run)
- **Output Tokens:** n/a (execution log not retained for this manually-completed run)
- **Estimated Cost:** $0.9420 (from Claude Code's reported total_cost_usd)

**Decisions:**
- ...

**Trade-offs / deviations from prompt:**
- ...
```

## Scaffold bare SvelteKit project + directory structure — 2026-08-05
<!-- METRICS:scaffold-bare-sveltekit-project-directory-structure -->
- **Execution Duration:** 191 seconds
- **Model:** claude-sonnet-5
- **Turns:** 37
- **Input Tokens:** n/a (execution log not retained for this manually-completed run)
- **Output Tokens:** n/a (execution log not retained for this manually-completed run)
- **Estimated Cost:** $0.9420 (from Claude Code's reported total_cost_usd)

**Decisions:**
- Used the official `sv create` CLI (`--template minimal --types jsdoc`) rather than hand-rolling config, since it produces an up-to-date SvelteKit 2 / Svelte 5 setup with the exact `build`/`check`/`lint` scripts CI expects, out of the box.
- Chose `--types jsdoc` (plain `.js`, JSDoc-based checking via `svelte-check`) over TypeScript: README.md's target file tree names plain `.js` files throughout `src/lib/` (`gist.js`, `tax.js`, `fire.js`, `store.js`), so JS-with-checking matches the documented architecture without introducing a `.ts` toolchain the design docs never mention.
- Added `eslint` and `prettier` add-ons since the issue's `lint` script requirement implies a linter must exist; used the CLI's own defaults (tabs, single quotes, no trailing commas) rather than inventing a custom style.
- Created `src/components/` (missing from the bare `sv create` output) with a short README describing its purpose, since README.md's Project Structure lists it as a top-level sibling of `routes/` and `lib/`.
- Replaced the generated placeholder home page with a minimal one specific to this project (title, one-line description, note that feature tabs land in later builds) instead of leaving the generic "Welcome to SvelteKit" boilerplate.
- Added `*.md` and `.github/` to `.prettierignore`: `sv create`'s formatting step reformatted README.md/DESIGN.md/the GitHub Actions YAML (quote style, table alignment) as a side effect of running `prettier --write` repo-wide, which isn't part of this issue's scope. Excluding hand-maintained docs and workflow YAML from `npm run lint`'s `prettier --check` keeps CI green without pulling unrelated formatting churn into this PR.

**Trade-offs / deviations from prompt:**
- Left `@sveltejs/adapter-auto` as the adapter rather than switching to `adapter-static` for GitHub Pages. The issue is scoped to "project init only" and the DESIGN.md build sequence treats Pages deployment as configuration for a later stage, not this scaffold; `adapter-auto` still builds successfully today (it only warns that it can't detect a deploy target), so nothing here blocks `npm run build`.
- Did not add Tailwind/shadcn-svelte, per the issue's explicit instruction that those are separate follow-up issues (#40, #41).
- Chart library (Recharts vs Chart.js) remains undecided, as README.md defers that choice to a later conversation; no charting dependency was added here.

## Define core data model + types — 2026-08-05
<!-- METRICS:define-core-data-model-types -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** __COST__

**Decisions:**
- Split the model across three files rather than one: `src/lib/enums.js` (runtime value sets), `src/lib/types.js` (JSDoc typedefs, no runtime code) and `src/lib/model.js` (factories, normalisation, validation). Later tabs need the enums at runtime to populate dropdowns but only need the types at check time, so keeping them apart avoids importing a type-only module for its side effects.
- Used JSDoc typedefs, not TypeScript, matching the scaffold's `--types jsdoc` choice and README.md's all-`.js` target file tree. `npm run check` (svelte-check with `checkJs`) type-checks them for real — verified by deliberately introducing a type error and watching it fail.
- Field names are transcribed verbatim from README.md's "Data Model" outline, including its two inconsistencies: `exclude_from_net_worth` on investments/debts versus `include_in_net_worth` on properties/assets, and `monthly_contribution` on an investment that also carries a `contribution_frequency`. Renaming either would have been tidier but would silently diverge the code from the spec every later issue is written against. `src/lib/model.test.js` asserts each record's key list against the README outline, so drift fails CI rather than being discovered three tabs later.
- Enum values are stable snake_case codes with a separate `*_LABELS` map holding README.md's human wording ("Watches & Jewellery", "Buy to let"). UI copy can then change without a data migration, and the label maps are typed `Record<Enum, string>` so a new code without a label is a type error.
- Units are fixed and documented once at the top of `types.js`: money in pounds (not pence), percentages as whole-number percents (`5` = 5%), dates as ISO `YYYY-MM-DD`, months 1-based. Ambiguity here is the classic source of 100×-wrong projections later.
- `null` means "not recorded" and `0` means "recorded as zero" — so optional inputs (`bought_for`, `dob_year`, every `db_*` and `ni_*` field) are nullable. Forecasts need to distinguish "no purchase price on file" from "acquired for nothing".
- Added `schema_version` (absent from README.md's outline) to the persisted document, with `SCHEMA_VERSION` and a `migrateAppData` seam. A single hand-editable Gist with no backend has no other way to tell which build wrote it.
- Split "make it well-typed" from "make it sensible": `normaliseAppData` coerces arbitrary JSON into a complete `AppData` and never throws (numeric strings parsed, unknown enum values defaulted, unknown top-level keys dropped, monthly entries sorted oldest first, missing ids generated), while `validateAppData` reports what normalisation deliberately cannot fix — month 13, ownership of 140%, duplicate ids within a collection, a bill pointing at a deleted category, a calendar-invalid date like `2026-02-30`. Issue #3's Gist layer can therefore load anything the user's Gist contains and still surface real problems. Errors come back as a list of `{path, message}` rather than throwing on the first one, so a form can annotate every bad field at once.
- A document stamped with a *newer* `schema_version` keeps that version through normalisation instead of being relabelled as current, and validation flags it — that gives #3 the option to refuse to overwrite a Gist written by a future build.
- Modelled `budget` as one object holding `categories`/`bills`/`line_items`. README.md writes it as `budget[]` with those arrays nested inside, which does not describe anything coherent (there is only one budget); normalisation accepts the array form too, so a document written against the literal outline still loads.
- Added `vitest` and an `npm test` script, since the issue asks for a tested state and the scaffold shipped no test runner. 129 tests cover the shape assertions, factory defaults, normalisation of malformed input, and each validation rule.

**Trade-offs / deviations from prompt:**
- Added an `id` to `MonthlyEntry`, which README.md's outline does not list (it keys entries by `month`/`year` alone). Snapshots need a stable key for list rendering and for the activity log's revert support (#14); `monthlyEntryKey()` still derives the `YYYY-MM` identity, and validation rejects two entries for the same month.
- Enumerated three value sets README.md names but never lists: `journey_stage` (five stages), debt `type` (mortgage, credit card, loan, car finance, student loan, overdraft, other) and mortgage `type`'s `none` case. These are inventions and may need revisiting when the tabs that consume them are built.
- Extended two enums beyond the README's own lists where a later feature clearly requires it: `PensionType` splits Defined Benefit into `db_final_salary` and `db_care` (they accrue differently) and adds `state`, so the State Pension can sit alongside private pots in the retirement income stream builder; `Wrapper` covers the six ISA types plus `sipp`, `workplace_pension`, `gia` and `none`, since dividend tax treatment turns on exactly this distinction.
- Planning defaults (5% growth, 2.5% inflation, retirement age 67, 3% property growth) are assumptions, not spec — README.md gives no defaults. They are starting points the forecast sliders overwrite.
- Left the CSV import path (Phase 2, WealthR export format) unaddressed beyond keeping the schema close to the README outline. No mapping layer exists yet; the tolerant `normaliseAppData` is the intended hook for it.
- `.github/workflows/ci.yml` still has no `npm test` step: the push was rejected because the app token lacks the `workflows` permission, so the one-line addition (`- name: Unit tests` / `run: npm test`) has to be made by hand. Until then the suite runs locally but not in CI, and `build`/`check`/`lint` are the only gates on a PR.
- No `PROJECT_PLAN.md`, despite CLAUDE.md mentioning one. `docs/journal.md` now fills that role — a second overlapping build log would be one more thing to keep in sync.
- Nothing consumes the model yet: `store.js` (#5) and `gist.js` (#3) are separate issues, so this PR adds types, factories and validation but no wiring. `src/lib/index.js` re-exports the public surface so those issues can import from `$lib`.

## Implement GitHub Gist persistence layer (lib/gist.js) — 2026-08-05
<!-- METRICS:implement-github-gist-persistence-layer-lib-gist-js -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** __COST__

**Decisions:**
- Single gate, not two: `isGistConfigured()` checks only `VITE_GITHUB_TOKEN`. `VITE_GIST_ID` is optional — without it the module creates a private Gist itself on first `saveAppData()` call and caches the returned id in `localStorage` under `uk-wealth-tracker:gist-id`, since a Vite env var is fixed at build time and has no other way to remember an id the app generated at runtime. The issue's "create-if-missing" therefore covers two distinct cases: no Gist at all (create one), and an existing Gist that just doesn't have our file yet (the Gist PATCH API creates a named file that doesn't exist, so this needed no special-casing).
- `localStorage` fallback triggers on token absence alone, not "token or gist id missing" — a missing gist id with a token present is the create-if-missing path above, not a fallback. Read this from the issue text pairing "local dev without Gist setup" with "no token/gist ID is configured": the scenario being described is having configured neither, not partial configuration.
- Reused `normaliseAppData`/`createAppData` from `./model.js` (#43) on every read rather than trusting Gist content directly — a hand-edited Gist, one written by an older schema version, or simply an empty file all need to become a well-typed `AppData` the same way a corrupt `localStorage` value does. `loadAppData()` only ever throws `GistError` for "this Gist is configured but unreachable/unreadable" (bad token, deleted Gist, network failure, invalid JSON); "nothing saved yet" always resolves to `createAppData()` instead.
- Added a `GistError` class (carries the HTTP `status` when there was a response) so callers — the future `store.js` (#5) — can distinguish "show a sync error" from "this is just a first run" by catching a specific type rather than string-matching a message.
- Added `getPersistenceMode()` (`'gist' | 'local'`) as a thin wrapper over `isGistConfigured()`. Not asked for directly, but the nav shell will want to show the user which storage they're on, and it was a one-line addition once `isGistConfigured` existed.
- Wrote `readFileContent()` to follow a Gist file's `raw_url` when GitHub reports it `truncated` (files over 1MB return partial inline `content`). Our documents are small today, but a silently-truncated read producing a plausible-looking-but-wrong `AppData` would be a nasty bug to chase later, and the correct handling is only a few lines.
- Kept the local JSDoc `AppData` reference in `gist.js` as `import('./types.js').AppData` inline rather than a local `@typedef {import('./types.js').AppData} AppData` (the pattern every other `$lib` module uses): `src/lib/index.js` re-exports every module with `export *`, and `svelte-check` treats two same-named top-level typedefs across re-exported modules as an ambiguous export even though only `model.js`'s was ever meant to be the public one. Filed as a one-off local convention with a comment rather than touching `model.js`'s already-established pattern.

**Trade-offs / deviations from prompt:**
- The GitHub token is a `VITE_`-prefixed env var, so it's inlined into the client bundle and readable by anyone who opens the deployed app's JS — not something this module can fix, since it's `DESIGN.md`'s stated persistence design (`.env.local` → Vite → client) for a single-user, self-hosted, personal-use app. Flagging it in the module doc comment rather than silently shipping it.
- No retry/backoff or optimistic-concurrency (ETag) handling on Gist writes — a second device saving between this app's read and write would silently overwrite it. Out of scope for a single-user app with no `store.js` yet to even trigger concurrent writes; worth revisiting if multi-device use ever matters.
- Re-attempted `.github/workflows/ci.yml`'s missing `npm test` step (flagged as a gap in the previous PR's journal entry) and hit the same wall: the app token lacks `workflows` permission, so the push was rejected. Reverted that hunk in a follow-up commit rather than blocking this PR on it; `npm test` (18 new tests here, 147 total) still only runs locally and in `npm run lint`/`check`/`build`'s absence from CI is unchanged from the prior PR.

## Build nav shell with tab routing — 2026-08-05
<!-- METRICS:build-nav-shell-with-tab-routing -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** __COST__

**Decisions:**
- Pulled the tab list and active-tab matching out of `+layout.svelte` into `src/lib/nav.js` (`NAV_TABS`, `isActiveTab`) rather than inlining both in the component. Tailwind (#40) and shadcn-svelte (#41) are still separate, un-started issues, so the layout itself has no component-testing harness available yet (no jsdom/testing-library in the project); keeping the tab config and the active-route logic as plain, dependency-free functions means the part of the nav shell most likely to have a bug — "is this the right tab to highlight" — is covered by ordinary `vitest` unit tests instead of going untested until #40/#41 land.
- `isActiveTab` treats the dashboard tab (`/`) as an exact match only, but every other tab matches its own path plus any nested sub-route beneath it (`/tax/2026` still highlights Tax). Every other route's pathname also starts with `/`, so the root needed its own rule to avoid every tab lighting up at once; the prefix match on the rest is there so a future sub-route (e.g. a pension pot detail page under `/pensions/...`) doesn't need `nav.js` touched to keep its parent tab highlighted.
- Typed `NavTab.href` as a JSDoc union of the ten literal route strings (not `string`) so `$app/paths`'s `resolve()` — required by `eslint-plugin-svelte`'s `svelte/no-navigation-without-resolve` rule, which is part of the already-configured `svelte.configs.recommended` — accepts `tab.href` directly without a cast. `npm run check` catches a typo'd href (e.g. `/divdends`) as a type error against this union before it ever reaches a broken link.
- Wrote nine placeholder route pages (`forecast`, `retirement`, `tax`, `pensions`, `dividends`, `property`, `assets`, `budget`, `estate`), each a heading plus one line naming the specific features that land there, taken from README.md's Phase 1 feature list, rather than one generic "coming soon" component reused across routes — makes each empty tab tell the user something concrete about what's planned instead of being indistinguishable from the others.
- Reworded the existing root `+page.svelte` (net worth dashboard) now that the nav shell lists every tab itself: dropped its "feature tabs land in later builds" sentence (now redundant with the visible nav) in favour of naming what the dashboard specifically will hold (snapshot entry, tracked/forecast chart, activity log), and changed its `<h1>` from the repo name to "Net Worth" to match the other tabs' heading style.
- No dependency added for component testing (jsdom, `@testing-library/svelte`, `svelte/server`'s SSR `render`, etc.) — `svelte/server` isn't resolvable from this SvelteKit version's export map from a plain test file, and adding a browser-like environment just to snapshot-render one layout felt like scope creep onto #40/#41's territory. Verified the rendered shell by hand instead: `npm run build && npm run preview`, then `curl`ing `/`, `/forecast` and `/tax` to confirm `aria-current="page"` and the `active` class land on the right `<a>` per route, and that an unmapped path still 404s.

**Trade-offs / deviations from prompt:**
- The nav shell has no visual design system behind it yet — plain scoped CSS in `+layout.svelte` (flex header, pill-style tab links, dark "active" background), since Tailwind (#40) and shadcn-svelte (#41) are both still open. Expect this stylesheet to be deleted wholesale once those land rather than incrementally migrated.
- `resolve()` from `$app/paths` is a newer SvelteKit API (this project pins `@sveltejs/kit` `^2.63.0`, actually installed at 2.70.2) tied to a project with no `svelte.config.js` at all — config here lives inline in `vite.config.js`'s `sveltekit()` call, which predates this issue and wasn't touched. No `paths.base` is configured, so `resolve('/tax')` currently resolves to the same `/tax` `isActiveTab()` already expects; if a base path is ever added (e.g. for GitHub Pages project-page hosting in #7), `page.url.pathname` used by `isActiveTab()` would need rechecking against the same base-path handling.
- Left `npm run dev`/manual click-through undone in favour of the `build` + `preview` + `curl` check described above, since this environment has no browser to drive; the rendered HTML was inspected directly instead of taking screenshots.

## Wire up VITE_GITHUB_TOKEN / VITE_GIST_ID env handling — 2026-08-05
<!-- METRICS:wire-up-vite-github-token-vite-gist-id-env-handling -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** __COST__

**Decisions:**
- The core environment variable reading was already implemented in `lib/gist.js` (lines 68–81: `getEnv()`, `getToken()`, `getConfiguredGistId()`) and tested in `gist.test.js` (lines 81–94: `isGistConfigured / getPersistenceMode`). The issue's request was to document the user-facing setup, not to implement it. Expanded the README's "Getting Started" section from a one-liner into a subsection that breaks installation and environment setup into discrete steps.
- Took a step-by-step format for environment setup (copy `.env.example`, create GitHub token, paste token, optionally set Gist ID, restart dev server) rather than a dense paragraph. Each step is actionable and maps to a specific GitHub URL or action, so a user can follow it without leaving the README.
- Included an explicit security note about `.env.local` being in `.gitignore` and the token being embedded in the client bundle (as already documented in the `gist.js` module comment at line 19). Developers new to the project should know not to paste tokens into git or build artifacts.
- Documented the optional nature of `VITE_GIST_ID` and the create-if-missing behavior upfront, so users understand that a blank Gist ID is not an error — the app will create a Gist on first save and cache its id locally.

**Trade-offs / deviations from prompt:**
- The `.env.example` file already existed and was already well-commented. No changes were made to it since the documentation at the top already covers the two variables and explains their purpose in plain language. Adding more detail to `.env.example` felt like documentation duplication; the README is the proper place for user-facing setup instructions.
- Did not add a separate docs file for environment setup (e.g. `docs/SETUP.md`). The issue's scope is to document setup in README.md per the existing instruction "a short section in README documenting setup", and one-page setup docs are easier to keep in sync when they live in README rather than as a separate file.
- The `.env.local` path is not configurable (Vite's convention is fixed). No environment variable added to let users point to a different `.env` file. Keep the setup simple.

## Add Tailwind CSS — 2026-08-05
<!-- METRICS:add-tailwind-css -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** __COST__

**Decisions:**
- Installed Tailwind CSS v4 with the new `@tailwindcss/postcss` plugin rather than v3 — v4 is the current release and recommended for new projects, and since this is early-stage scaffolding with no legacy dependencies, choosing v4 from the start avoids a migration later.
- Created a minimal `tailwind.config.js` with just `content` path scanning for Svelte files (`./src/**/*.{html,js,svelte,ts}`), `theme.extend: {}`, and empty `plugins`. No custom theme is needed yet; shadcn-svelte (#41) will handle component-level design tokens when it lands.
- Wrote `src/app.css` as a placeholder comment rather than with `@tailwind` directives, since Tailwind v4's PostCSS plugin processes the styles automatically without needing explicit directives in the CSS file. The CSS is imported in the root layout, and the PostCSS step (configured in `postcss.config.js`) handles everything.
- Refactored the nav shell's inline `<style>` block into Tailwind utility classes: `flex`, `flex-col`, `min-h-screen`, `gap-6`, `px-4`, `py-3`, `border-b`, `border-gray-200`, etc. The visual design (dark active tab background, light hover state) is preserved exactly; only the implementation changes from CSS custom properties to Tailwind's utility API.
- Used conditional class binding (`class:active`) combined with string interpolation (`{active ? 'bg-black text-white' : ''}`) to toggle the dark background on the active tab. This is idiomatic Svelte and avoids needing a CSS variable or extra scoped `<style>` block for the dynamic state.

**Trade-offs / deviations from prompt:**
- Did not add shadcn-svelte or its integration (e.g., installing `shadcn-svelte` CLI, configuring `components.json`, copying component templates). That is issue #41, a distinct task. Tailwind alone is enough to style the nav shell and provide a foundation for later components.
- Left the chart library decision (Recharts vs Chart.js) unchanged — no charting dependency was installed here, per the earlier build journal entries. Charts are a later phase.
- No dark mode configuration added to `tailwind.config.js` (no `darkMode: 'class'`, no separate dark-mode utility classes). The design spec (README.md) makes no mention of dark mode, and it felt premature to add infrastructure for a feature that may not be needed. Can be added as a configuration extension to future design-system work without touching the codebase's Tailwind usage.

## Add shadcn-svelte component library — 2026-08-05
<!-- METRICS:add-shadcn-svelte-component-library -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** __COST__

**Decisions:**
- Installed `shadcn-svelte` as a single `npm install` rather than running the CLI setup (`npx shadcn-svelte init`), since the interactive setup was blocking and the alternative — manual configuration — is simpler, more reproducible, and better suited to a CI environment. Manual setup involved creating a `shadcn.json` config file, adding the `utils.js` module with the `cn()` class-merging function, and extending the Tailwind color palette with shadcn's CSS variables.
- Created `src/lib/utils.js` with a lightweight `cn()` function (variadic string filter) instead of importing a heavier utility library like `clsx` or `classnames`. The function is specific to shadcn's use case: merge Tailwind class strings and filter out empty ones. This matches the minimal dependencies philosophy of the project.
- Implemented two sample components (`Button` and `Card`) in `src/components/ui/` with full Svelte 5 runes-mode syntax (`let { ... } = $props()`) rather than legacy `export let` bindings. Both components demonstrate the pattern: accept a `className` prop for composition, use `cn()` to merge base styles with user-provided classes, and render with Tailwind utilities. These components serve as templates for future UI components.
- Defined theme colors as CSS custom properties (HSL-format variables like `--primary`, `--background`) in `src/app.css` `:root` and `.dark` blocks, matching shadcn's standard color system. Light mode defaults to a neutral (near-black/near-white) palette; dark mode inverts appropriately. This separates theme configuration from component styling and makes dark-mode support trivial.
- Created `svelte.config.js` with a `~` alias pointing to `src/` for cleaner component imports (`~` instead of `$lib` for local imports). Configured this both in `kit.alias` (SvelteKit's native routing) and in `vite.config.js`'s `resolve.alias` for Vite's asset resolution.
- Updated `tailwind.config.js` to add `theme.extend.colors`, `borderRadius`, and other shadcn-specific CSS variable references that the utility classes consume. This centralizes theme defaults while keeping the actual color values in `app.css` as CSS variables (which can be toggled for dark mode without recompiling).

**Trade-offs / deviations from prompt:**
- Did not use the `shadcn-svelte init` CLI to scaffold components, since it requires interactive prompts that block in a non-TTY environment. Instead, manually set up the configuration and wrote two example components (Button, Card) to demonstrate the pattern. This approach is reproducible, testable, and doesn't leave partial state if the command hangs or times out.
- Did not install the full shadcn-svelte component registry. Only `Button` and `Card` were implemented as proof-of-concept; a real application would use the CLI or registry to add components as needed (Dropdown, Modal, Input, etc.). The infrastructure is in place for future additions without modification.
- Leveraged Svelte 5 runes mode (`$props()`, slot forwarding without `$$restProps`) rather than Svelte 4 patterns, keeping the code current with the project's framework version (already forced to runes mode in `vite.config.js`). This meant bypassing shadcn-svelte's own CLI-generated components (which target a generic Svelte version) in favor of hand-written, project-specific implementations.
- CSS variable syntax in `app.css` uses standard CSS custom properties (no Tailwind @apply directives for the base theme) to keep the theme truly separated from Tailwind config. Tailwind utilities reference these variables via `hsl(var(--color-name))` in `tailwind.config.js`'s extend block, avoiding the common pitfall of tight coupling between theme and utilities.

## Investment holding fields + account wrapper types — 2026-08-06
<!-- METRICS:investment-holding-fields-account-wrapper-types -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** __COST__

**Decisions:**
- Audited the issue against the codebase before writing anything: every field it asks for (name, type, current value, purchase price, year purchased, monthly contribution, account wrapper) and every investment type it lists (Stocks ISA, SIPP, Shares, Crypto, Cash, Emergency Fund, Dividends, Property) was already implemented — `Investment` in `src/lib/types.js`/`model.js` and `INVESTMENT_TYPES`/`WRAPPERS` in `src/lib/enums.js` were built as part of #2 (`Define core data model + types`, merged as PR #43), which implemented README.md's full "Data Model" section — including this exact bullet from "Net Worth Tracking" — in one pass rather than issue-by-issue. This issue and #2 both trace back to the same README.md bullet list, so the backlog ended up with two tickets for one requirement.
- Rather than closing #9 with no diff (GitHub won't open a PR with an empty commit against a protected branch's required check, and a silent no-op PR would leave no audit trail of *why* nothing needed building), added a small, real verification layer: a dedicated `describe('issue #9 …')` block in `model.test.js` that pins the issue's own wording — the seven field names and the eight investment types, in the order the issue lists them — as an explicit regression, independent of the README-derived shape assertions already in that file. If a future edit to README.md's phrasing ever changed the generic shape tests without anyone noticing this issue's specific acceptance criteria, this block still fails loudly.
- Added one-line cross-references to issue #9 in the `InvestmentType`/`Wrapper` JSDoc typedefs (`enums.js`) and `createInvestment`'s doc comment (`model.js`), in the same style the codebase already uses to cite README.md section names next to the enums they implement — so anyone reading the source later can see both tickets point at the same code without having to check GitHub.
- Ran the full gate before and after the change (`npm test`, `npm run lint`, `npm run check`, `npm run build`) to confirm the pre-existing implementation genuinely satisfies the issue as written, not just by inspection: 156 tests passed before this PR's 3 new ones were added (159 after), lint/check/build were already clean.

**Trade-offs / deviations from prompt:**
- No new fields, enum values, or UI were added — the issue's literal scope was already done. Anyone expecting a diff sized like a typical "add a data model piece" PR will instead find test coverage and doc-comment traceability; adding unrequested fields (e.g. speculative wrapper-compatibility rules per investment type) to make the PR "feel" more substantial would have been scope creep the project's own conventions warn against.
- Did not touch the actual UI: no form exists yet for entering an investment holding with these fields (`INVESTMENT_TYPES`/`WRAPPERS` aren't imported anywhere outside `$lib` and its tests today) — that's `#8` (Monthly snapshot entry form), a distinct open issue, and building it here would have duplicated work already scoped there.
- Left the two overlapping tickets (`#2`/`#43` and `#9`) as-is rather than trying to retroactively edit either issue's history; the journal entry for `#2` already documents the field/type decisions in detail, so this entry cross-references rather than repeats them.

## Debt tracking with D/I ratio — 2026-08-06
<!-- METRICS:debt-tracking-with-d-i-ratio -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** __COST__

**Decisions:**
- Unlike #9, this issue's two halves genuinely didn't exist yet: `Debt`/`createDebt`/`DEBT_TYPES` were already built by #2, but nothing computed a debt-to-investment ratio and no UI let a user enter a debt at all. Wrote both: `src/lib/debt.js` (the calculation) and `src/components/DebtTracker.svelte` (the entry form + ratio display).
- `debtToInvestmentRatio(investments, debts)` sums each side with `exclude_from_net_worth` respected by default — the same flag `createDebt`/`createInvestment` already carry, and the one the mortgage toggle (#11) sets. Deliberately did not invent a second "is this debt real leverage" rule (e.g. special-casing `type === 'mortgage'`) on top of it: once a user flags their mortgage as excluded from net worth because the property tab already tracks the equity, that same flag now keeps it out of the ratio too, so the two views of "what counts" never disagree. Until #11's UI exists to set that flag, a tracked mortgage is included by default, same as any other debt — the ratio being unflattering for an unflagged mortgage is a data problem for the user to fix via the toggle, not something this module should silently work around.
- The ratio is `null`, not `0` or `Infinity`, whenever total tracked investment value is zero (no holdings, all holdings excluded, or all valued at zero) — dividing by zero has no sensible percentage, and README.md's <14%/>18% bands can't classify a ratio that doesn't exist. `debtToInvestmentStatus(null)` returns `'unknown'`, and the UI shows "Not enough data" plus a nudge to record an investment, rather than a misleading "0% — Healthy".
- README.md names only the two outer bands ("<14% healthy, >18% concern"); the 14–18% band in between needed a name for the UI to render something, so it's labelled `'moderate'` here — an invention, flagged as such in `debt.js`'s own doc comment, not read out of the spec. Boundary values (exactly 14, exactly 18) land in `'moderate'`, since the spec's `<`/`>` (not `<=`/`>=`) put them outside both named bands.
- `DebtTracker.svelte` takes `investments` as a plain (non-bindable) prop and `debts` as `$bindable`: debt entry is this issue's job, investment entry is #8's. Built it so #8/#5 can hand it real `investments`/`debts` arrays (from the eventual store) without any change to the component itself — it already only ever reads `investments` and only ever replaces `debts` wholesale via reassignment, which is exactly what a `bind:` to a store-backed array needs.
- Wired the component into the dashboard route (`src/routes/+page.svelte`) with local `$state([])` arrays rather than leaving it unused/unmounted, so the issue's "fully...to a working, tested state" is checkable by actually running the app, not just by reading component source. `investments` stays permanently empty until #8 exists to fill it, so the ratio card correctly shows "Not enough data" on a fresh page load today.
- Followed the nav-shell precedent (#4) for verifying the Svelte layer: no component-testing harness exists yet (no jsdom/testing-library), so `debt.js`'s calculation logic carries the real test weight (27 new tests: exclude-flag behaviour on both sides, the zero/all-excluded/no-holdings null cases, threshold boundaries at exactly 14 and 18, and a verbatim-thresholds regression pinning `{ healthy: 14, concern: 18 }` to README.md's wording) while the component was verified by hand via `npm run build && npm run preview` + `curl`, confirming the debt form, empty state, and "Not enough data" ratio card all render server-side as expected.
- Re-exported `debt.js` from `src/lib/index.js` alongside `enums.js`/`model.js`, and kept its `Debt`/`Investment` JSDoc references as inline `import('./types.js').X` rather than local `@typedef`s — same ambiguous-re-export workaround `gist.js` already uses, needed here because `svelte-check` otherwise flags `model.js`'s and `debt.js`'s same-named typedefs as a conflicting re-export through `index.js`'s `export *`.

**Trade-offs / deviations from prompt:**
- Debts entered on the dashboard today are not persisted anywhere — no `store.js` (#5) exists to sync them to the Gist, so a page reload loses them. This mirrors the nav shell's own starting point (built and rendering before persistence was wired to it) rather than reaching into #5's scope to add ad hoc `gist.js` calls from this component, which would have hard-coded a persistence pattern #5 should be the one to design.
- Because #8's investment entry form doesn't exist yet, the ratio card cannot show a real non-zero ratio in the running app today — only the null/"Not enough data" path is exercised live. The non-null arithmetic (including values that push the ratio past 100%, and the exact-boundary cases) is covered by `debt.test.js` instead, which exercises `debtToInvestmentRatio`/`debtToInvestmentStatus` directly against constructed `Investment`/`Debt` records.
- Did not add a `net-worth.js`-style aggregator that also folds in properties/assets/pensions into a single "total invested" figure — README.md's line item is specifically "debt-to-investment ratio", and `Investment.type` already includes a `property` tag for holdings a user chooses to track that way; pulling in the separate `properties[]`/`assets[]` collections would be a materially different metric invented beyond what the issue or README.md asked for.
- No colour-blind-safe pattern/icon alongside the green/amber/red status pill — Tailwind's default green-700/amber-700/red-700 on light backgrounds was used directly, matching the level of polish elsewhere in the app (plain utility classes, no design tokens for semantic status colours yet). Worth revisiting once a real design pass happens.

## Mortgage debt toggle (exclude from net worth) — 2026-08-06
<!-- METRICS:mortgage-debt-toggle-exclude-from-net-worth -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** __COST__

**Decisions:**
- #10's `exclude_from_net_worth` flag and checkbox already existed on every debt, generic across all seven `DebtType`s, and #10's own journal entry explicitly deferred the "actually set this for mortgages" UI to this issue. So the mechanism (`sumDebtBalances`/`debtToInvestmentRatio` respecting the flag) needed no changes here — this issue is specifically about the mortgage case of that generic checkbox, not a second competing toggle.
- Added `defaultsToExcludedFromNetWorth(type)` to `src/lib/debt.js`: a one-line pure function that returns `true` only for `type === 'mortgage'`. `DebtTracker.svelte`'s add-debt form calls it from the debt-type `<select>`'s `onchange` handler, so picking "Mortgage" pre-checks "Exclude from net worth" immediately, before the user has typed a balance or clicked submit — matching README.md's "Mortgage debt toggle (exclude from net worth when property equity already tracked)" as a smart default rather than a silent behind-the-scenes rule the user never sees. The checkbox stays fully user-editable either way: someone who logs a mortgage but doesn't track the property separately can still uncheck it before adding.
- Switched the type `<select>` from `bind:value` to an explicit `value`/`onchange` pair, since `bind:value` alone gives no reliable hook to run `defaultsToExcludedFromNetWorth` exactly once per user-driven selection (as opposed to on every reactive re-render). Reading `event.currentTarget.value` directly in the handler avoids depending on `bind:`'s and a sibling `onchange`'s relative firing order, which Svelte doesn't document as guaranteed.
- Gave mortgage-typed debts distinct copy everywhere the checkbox appears — the add-form and each already-added debt row — swapping the generic "Exclude from net worth" label for "Exclude — property equity tracked separately", with the full explanation ("...otherwise the same debt is counted twice") as a `title` tooltip and, on the add form, as visible helper text under the checkbox. Every other debt type keeps the original generic label untouched, since only a mortgage has a natural counterpart (property equity) it can double-count against.
- Added an inline amber warning under any already-added mortgage debt row that is *not* excluded ("Counted twice if this property's equity is also tracked."), rather than only warning at add-time. Debts persist across the session (and, once #5/#3 wire in persistence, across visits), so a user could add a mortgage, decline the default, and only realise the double-counting risk much later when reviewing the list — the row-level warning catches that case the add-form hint alone would miss.
- Deliberately did not thread a `properties` prop through `DebtTracker`/`+page.svelte` to check *for real* whether a matching property is tracked before showing the warning. The Property tracker (#36–38) has no UI yet — the route is still a placeholder — so the only property data that could exist is `[]`, and wiring a prop that is always empty in the running app today would be dead plumbing dressed up as a feature. The warning is worded conditionally ("if this property's equity is also tracked") precisely because this build can't yet know whether it is; revisit once #36 lands and real `Property` records exist to check against.
- Tested the new logic the same way #10 tested `debt.js`: three `defaultsToExcludedFromNetWorth` cases in `debt.test.js` (mortgage → `true`, every other `DEBT_TYPES` entry → `false`, and a boolean-return sweep over the full enum so a future ninth debt type can't silently fall through untested). The Svelte-side wiring (the `onchange` handler, conditional label text, the warning banner) has no dedicated test, consistent with this codebase's existing convention of putting the tested weight in `$lib` and hand-verifying component wiring — done here by running the dev server under Playwright/Chromium and screenshotting the add-form before/after selecting "Mortgage" and the rendered list with one excluded mortgage debt and one ordinary debt side by side.
- Ran the full gate (`npm test`, `npm run lint`, `npm run check`, `npm run build`) after the change: 185 tests pass (3 new), lint/check/build all clean.

**Trade-offs / deviations from prompt:**
- The "default checked" behaviour only fires when the user actively changes the type dropdown to "Mortgage" — if a debt is created straight from a script/import (or a future CSV-import path, per DESIGN.md's "Data Migration" section) with `type: 'mortgage'` and no `exclude_from_net_worth` set, `createDebt`'s own default (`false`) still applies, not this issue's smart default. `defaultsToExcludedFromNetWorth` is exported precisely so that a future import/migration path can call it explicitly if it wants the same default; wiring it into `createDebt` itself was avoided because that would silently change behaviour for every caller (including existing tests) rather than just the interactive add-debt form this issue is about.
- No real cross-check against tracked property data, as noted above — the warning is generic guidance, not a computed "this specific £250,000 mortgage overlaps with this specific property" alert. That sharper version is natural follow-up work once #36–38 give the Property tab real data to compare against.
- Re-selecting a different type after "Mortgage" (e.g. mortgage → credit card) re-derives the default and un-checks the box, overwriting whatever the user had manually set for the mortgage selection. This mirrors ordinary form UX (changing a category resets dependent fields) and keeps the behaviour simple and predictable, but a user who deliberately checked/unchecked the box, then changed their mind about the type twice, loses that manual choice each time — accepted as the simpler, more explainable rule over trying to track "was this ever hand-edited" state.

## Activity log with revert support — 2026-08-06
<!-- METRICS:activity-log-with-revert-support -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** __COST__

**Decisions:**
- Added `ActivityLogEntry` and its `activity_log[]` collection to the shared schema (`types.js`, `model.js`, `enums.js` for the `ActivityLogAction`/`ActivityLogEntityType` enums) even though README.md's "Data Model" outline never mentions an activity log — the same call #2's journal entry made for `MonthlyEntry.id`. CLAUDE.md's architecture section is explicit that a new feature area should "extend the shared data model rather than introducing separate storage," and this issue is squarely a new feature area: giving it a schema home now means #5 (store) and #8 (monthly snapshot form) have somewhere to write to later instead of the log staying a component-local invention.
- Split the work the way #10 split `debt.js`/`DebtTracker.svelte`: `lib/model.js` owns the one `create*` factory (`createActivityLogEntry`) plus normalisation/validation, matching every other record kind; `lib/activity-log.js` holds only the pure, entity-agnostic log operations (`logEntityAdded`, `logEntityRemoved`, `logEntityUpdated`, `isRevertible`, `revertEntityRemoval`, `describeActivityLogEntry`). `activity-log.js` never touches `debts`/`investments` directly — it takes a plain `{ id, name }`-shaped entity and hands back a new log array — so the same module already works for whichever entity kind #8's investment form logs against, with no changes needed here.
- Revert is scoped to `removed` entries only, exactly as issue #14 words it ("the ability to revert a deleted entry"). `logEntityUpdated` exists and records a pre-edit snapshot for context (useful once an edit form exists), but `isRevertible` always returns `false` for it — reverting an edit is a different, unrequested feature (it would mean "restore the previous values," not "undo a deletion") and inventing it here would be scope creep.
- A `removed` log entry carries the entire removed record as `snapshot`, not just its id — reversing a deletion needs to put the exact same balance/type/notes/etc. back, and the record is by definition gone from `debts`/`investments` by the time anyone clicks "Revert." Reverting re-adds the entity with its original `id` intact (not a freshly generated one) so it is recognisably the same debt reappearing, not a new one — and reverting does not write a second "added" log entry, since the reverted `removed` entry itself (rendered with a "— restored" suffix once `reverted: true`) already tells that story; a second entry would just be noise.
- Validation enforces the two invariants revert depends on: a `removed` entry must carry a non-null `snapshot` (`activity_log[i].snapshot`), and only a `removed` entry may have `reverted: true` (an `added`/`updated` entry with `reverted: true` is nonsensical and now flagged). Timestamp gets its own coercion helper, `asIsoDateTime`, distinct from the existing `asIsoDate` — the log needs a full date-time (`Date.parse`-accepted, e.g. `2026-08-06T09:30:00.000Z`) rather than the calendar-only `YYYY-MM-DD` the rest of the model uses for `deal_expiry`/`purchase_date`.
- Wired the log into `DebtTracker.svelte` — the only component with add/remove UI today — via a new bindable `activityLog` prop alongside the existing `debts` one, and render it through a new presentational `ActivityLog.svelte` (a third `Card`, below Debts and the D/I ratio) that takes `entries` + an `onRevert(logEntryId)` callback and has no knowledge of what "revert" does to the underlying record; `DebtTracker.svelte` owns that (`revertDebtRemoval` calls `revertEntityRemoval` then re-appends the returned snapshot to `debts`). `+page.svelte` gained a third `activityLog = $state([])` alongside `investments`/`debts`, bound through the same way, so it is positioned to be handed to #8's investment form later without `DebtTracker.svelte` needing to change.
- Followed the project's established test-weight convention (#4, #10, #11): the full behavioural surface — `logEntityAdded`/`logEntityRemoved`/`logEntityUpdated`/`isRevertible`/`revertEntityRemoval`/`describeActivityLogEntry`, plus schema shape/normalisation/validation for `activity_log` — is covered by 28 new `vitest` unit tests (19 in a new `activity-log.test.js`, 9 more in `model.test.js`), including immutability checks (the log passed in is never mutated) and the no-op paths (reverting an unknown id, an `added` entry, or an already-reverted entry). The Svelte wiring itself (the bindable props, the `onRevert` callback, the "— restored" suffix) has no dedicated test — consistent with this codebase's no-jsdom convention — verified instead via `npm run build && npm run preview` + `curl`, confirming the new "Activity log" card renders server-side with its empty state under the existing Debts/ratio cards.

**Trade-offs / deviations from prompt:**
- Nothing is actually revertible in the running app yet in the sense of "the user can click a button and watch a debt come back" being exercised end-to-end by an automated test — `DebtTracker.svelte`'s wiring is hand-verified only (see above), same limitation #10/#11 already accepted for this component's other interactive behaviour, since there is still no jsdom/testing-library harness in the project.
- Only `DebtTracker.svelte` writes to the log today. Investments have no add/remove UI yet (#8), so `logEntityAdded`/`logEntityRemoved` are exercised against debts only in the running app; the module itself is entity-type-agnostic and unit-tested against both `'debt'` and `'investment'` entity types directly, so #8 should be able to call it unchanged.
- The log is unbounded — every add/remove appends forever with no pruning, pagination, or "clear log" control. README.md's line item doesn't ask for retention limits and the session-only `$state` arrays it currently lives in reset on reload anyway; worth reconsidering once #5's Gist persistence makes the log actually durable and potentially long-lived.
- `logEntityUpdated`/edit support is written but has no caller — no edit-in-place UI exists anywhere yet (debts and investments are only ever added or removed). It is there so the log's shape doesn't need revisiting when an edit form eventually arrives, but is unexercised outside its own unit tests today.
- As with #10/#11, none of this is persisted — `activity_log` lives in `+page.svelte`'s local `$state` and is lost on refresh, same as `debts`/`investments`. It is modelled as part of `AppData` specifically so that wiring it into #5's store later is a non-event rather than a schema change.

## Auto-invest fill for missing months (compound growth) — 2026-08-06
<!-- METRICS:auto-invest-fill-for-missing-months-compound-growth -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** __COST__

**Decisions:**
- The monthly rate is geometric — `(1 + annual)^(1/12) - 1`, not `annual / 12`. This is the issue's "get the compounding math right" line taken literally: at a 5% assumption the naive division gives 0.4167%/month, which compounds to 5.116% a year, so every twelve filled months would silently add an extra 0.116% that no downstream forecast could see or subtract. `monthlyGrowthRate` is exported and unit-tested by the property that actually matters — twelve applications reproduce the annual rate to twelve decimal places — rather than by a hard-coded expected number.
- Growth is applied before the contribution, so a month's payment earns nothing in the month it is paid (`value(n) = value(n-1) × (1 + r) + contribution`, an ordinary annuity). The opposite convention is a defensible reading of "monthly contribution" but it inflates every filled month, and the inflation compounds; the conservative convention is the one a net worth *history* wants, since it can only understate what actually happened, never overstate it. Both this and the geometric rate are stated as numbered conventions at the top of `auto-invest.js` and pinned by tests that would fail if either were flipped.
- Gaps are **projected forward from the earlier snapshot, never interpolated between the two**. Interpolating towards the recorded snapshot that closes a gap would draw a prettier line, but it would invent a month-by-month attribution for a market move we only know the total of — and it would make February's number depend on data recorded in April, which is not what "history" means. The recorded snapshot that closes a gap is returned byte-identical (there is a test asserting exactly that), so the step onto it absorbs whatever the market really did.
- Contribution frequency is honoured rather than flattened. `monthly_contribution` is (per README.md's own naming, documented in `types.js`) the amount paid per `contribution_frequency` period, so a quarterly £900 is £900 every third filled month — not £900 monthly, and not £300 monthly smoothed. Payments are counted from the last recorded snapshot, the only anchor the data model offers: a January snapshot plus a quarterly holding pays in April. `one_off` never pays into a filled month at all, since a lump sum was paid once at a date nothing records.
- Fund fees make the compound rate per-holding. `Investment` has no growth rate of its own (README.md's data model doesn't give it one, and #2's journal entry is explicit that fields are transcribed verbatim rather than invented), so the single `growthRate` assumption is netted against each holding's `fund_fee`: `(1 + g)(1 - f) - 1`, compounded, not `g - f` subtracted. That is both the correct treatment of an OCF charged on fund value and the one thing in the existing model that legitimately makes one holding compound differently from another under a single assumption. `applyFundFees: false` turns it off for callers that want the gross series.
- Values are rounded to whole pence *each month* and the rounded value carries into the next, so a stored series is exactly reproducible from its own numbers. Carrying full precision and rounding only for display would be marginally more accurate (sub-penny per month) but would make a persisted Gist a series whose own arithmetic doesn't check out.
- Added `auto_filled` to `MonthlyEntry` (`types.js`, `model.js` factory + normalisation, plus the README-shape assertion in `model.test.js`) rather than keeping generated months in a parallel structure — the same call #14 made for `activity_log`, and what CLAUDE.md's "extend the shared data model rather than introducing separate storage" asks for. It buys three things at once: the UI can label a projected month honestly, `stripAutoFilledEntries` gives every later feature a "recorded history only" view for free, and `fillMissingMonths` can be **idempotent** — it discards existing filled months and recomputes, so filling twice equals filling once, changing the growth rate re-derives cleanly, and a snapshot the user later records *inside* a filled gap wins over the months this invented around it (all three are tests).
- `through` (project past the last recorded snapshot, up to a given month) is off by default. "I haven't logged since March" is the same user problem, but months after the last real snapshot are a forecast, and forecasting is #16's job with its own three scenarios; making it an explicit opt-in keeps `fillMissingMonths` honest about which of its output is bridging history and which is extrapolating beyond it.
- Debts carry forward untouched into a filled month. Nothing in the data model says how a balance amortises — interest rate and monthly payment live on `Property`, not `Debt` — so inventing a repayment schedule here would be a different, unrequested feature that would also quietly change the D/I ratio (#10) for months the user never recorded.
- `MAX_FILL_MONTHS` (1200) caps how long a gap will be bridged. A hand-edited Gist holding a 1900 snapshot next to a 2100 one would otherwise expand into 2,400 invented months on load; a gap that size is a data error, so it is left visible as a gap.
- Test weight sits in `$lib` as usual (75 new tests in `auto-invest.test.js`, 1 more in `model.test.js`; 289 total, up from 213), covering the calendar arithmetic, the two compounding conventions, every contribution frequency, what is and isn't carried forward, idempotence and re-fill, `through`, and the guards. The Svelte layer was verified for real this time rather than by `curl`: with a temporary seeded route and `puppeteer-core` driving the system Chromium, clicking "Fill 2 missing months" on a Jan-2026/Apr-2026 history produced Feb £10,539 and Mar £11,080 with "Auto-filled" badges (matching `10,000 × 1.0477^(1/12) + 500 = 10,538.98` by hand), and "Clear filled months" returned the list to the two recorded snapshots. The temporary route, the driver script and `puppeteer-core` were all removed afterwards — no test dependency was added to the project.
- Reworded the fill button once that run showed the wart: after filling, "Fill 2 missing months" still described months that were no longer missing. It now reads "Recalculate 2 filled months" whenever generated months exist, which is also the genuinely useful action there — redo them after changing the growth rate or the fee toggle.

**Trade-offs / deviations from prompt:**
- The card is inert in the running app today, because nothing can create a monthly snapshot yet — that is #8's entry form, still open. `AutoInvestFill.svelte` is wired into the dashboard with a real bindable `monthlyEntries` array and shows an honest empty state ("No monthly snapshots recorded yet…"), the same position `DebtTracker`'s ratio card was left in by #10 while it waited for holdings to divide by. Adding even a minimal "record this month" control here would have duplicated #8's scope; the seeded-route Chromium run above is how the interactive path was exercised instead.
- Per-holding growth rates are not supported — one assumption applies to all holdings, differentiated only by each one's fund fee. Adding `growth_rate` to `Investment` would have been the more literal reading of "each holding's … compound growth rate", but it is a field README.md's data model doesn't have and `model.test.js` pins the investment shape to that outline deliberately. If per-holding rates are wanted later, the seam is `projectHoldingValue`.
- Nothing calls `fillMissingMonths` automatically on load. It is a user action behind a button, not a silent transformation of stored history, because a fill writes invented snapshots into the same collection the user's own records live in — worth an explicit click until #5's store owns the document and can decide whether a filled view should be derived rather than stored.
- No forecast, chart or month-on-month wiring (#12, #13, #16) consumes the filled series yet; those are separate open issues. The output is deliberately the same `MonthlyEntry[]` shape they will already be reading, so they need no adapter.
- As with everything since #10, none of this persists — `monthlyEntries` lives in `+page.svelte`'s `$state` and resets on reload until #5 lands.
- Noticed while screenshotting, unrelated to this issue and left alone: the app currently renders with no styling at all, because `src/app.css` never imports Tailwind (v4 needs `@import 'tailwindcss';`, and #40's journal entry records the assumption that the PostCSS plugin handles it without a directive). Every utility class in every component is inert. Fixing it is a one-line change but would restyle every page in a PR about compounding maths, so it belongs in its own issue.
