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
