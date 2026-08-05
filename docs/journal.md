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
