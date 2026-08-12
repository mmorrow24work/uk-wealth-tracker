# Self-hosting your own copy

This app is a personal project with no backend and no company behind it: your data lives in your
browser (or your own private GitHub Gist, if you turn that on), and the whole thing is just static
files served from GitHub Pages. That means anyone can fork the repo and run their own copy for
free, under their own domain, with their own data, seen by no one else. This page is a walkthrough
of how.

## 1. Fork the repo

Go to [github.com/mmorrow24work/uk-wealth-tracker](https://github.com/mmorrow24work/uk-wealth-tracker)
and click **Fork** (top right). That gives you your own full copy of the code and its history under
your own GitHub account — free, no time limit, no permission needed. From there you can change
anything: figures, tax years, colours, add or remove tabs, rename it entirely. It's yours.

You don't need to know how to code to use a fork as-is — it works exactly like this site. Making
changes is a separate step, covered in [§4](#4-optional-keep-building-it-with-an-ai-coding-agent).

## 2. Host it somewhere

The original is deployed on **GitHub Pages**, which is what `.github/workflows/deploy.yml` in this
repo is already set up to do — free static hosting, no server to manage, no card details needed.
Once you fork:

1. In your fork's **Settings → Pages**, set the source to **GitHub Actions**.
2. Push any commit (or just re-run the `Deploy to GitHub Pages` workflow from the **Actions** tab)
   to trigger a build.
3. Your copy is live at `https://<your-username>.github.io/uk-wealth-tracker/` within a couple of
   minutes.

GitHub Pages isn't the only option — the app is a static SvelteKit build (`npm run build` produces
a plain `build/` folder), so it also runs unmodified on **Netlify**, **Vercel**, or **Cloudflare
Pages**, all of which have free tiers and a similar "connect your GitHub repo, it deploys itself on
every push" workflow. GitHub Pages is simplest if you're not already using one of the others for
something else.

## 3. Put it on your own domain (optional)

A `github.io` URL works fine, but if you'd rather have `wealth.yourname.com` or similar:

1. **Buy a domain.** [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) sells
   domains at cost (no markup), typically £8–15/year for a `.com` or `.co.uk`. Any other registrar
   works too — the DNS step below is what matters, not who you bought the domain from.
2. **Add a CNAME record.** In Cloudflare's DNS settings for your domain, add a record:
   - Type: `CNAME`
   - Name: whichever subdomain you want (e.g. `wealth` for `wealth.yourname.com`, or `@` for the
     bare domain)
   - Target: `<your-username>.github.io`
   - Proxy status: either works; "DNS only" is simpler to reason about while you're setting this up
3. **Tell GitHub about it.** In your fork's **Settings → Pages → Custom domain**, enter the full
   domain (e.g. `wealth.yourname.com`) and save. GitHub issues an HTTPS certificate for it
   automatically — this can take a few minutes.
4. **Add a `static/CNAME` file** to the repo containing just your domain name, one line. This repo
   already has one (`static/CNAME`) — replace the contents with your own domain, since
   Actions-based Pages deploys don't otherwise persist the custom domain setting across rebuilds.

## 4. Optional: keep building it with an AI coding agent

Everything in this repo — every tab, every calculation, this very page — was built by prompting an
AI coding agent rather than writing it by hand line-by-line. You don't need to be a developer to
extend your fork; you need to be able to describe what you want changed.

- **[Claude Code](https://claude.com/claude-code)** (what built this repo) runs in a terminal or
  IDE, reads your codebase, makes edits, and can run your build/tests to check its own work. This
  project went further and wired it into GitHub Actions as an autonomous loop (see
  `.github/workflows/claude-build.yml`) that works through a queue of GitHub issues unattended,
  opening and merging its own pull requests — a pattern you could copy into your fork as-is if you
  want the same "describe features as issues, come back later to a working app" workflow.
- **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** is Google's equivalent: a free,
  open-source terminal agent with a similar read-the-repo-and-edit-it model, useful if you'd rather
  not run a paid tool for occasional changes.
- Either way, the practical pattern is the same: describe one specific, scoped change ("add a
  column for X", "change the tax year figures to 2027/28"), let the agent make the change, check it
  in a browser, and commit. Small steps compound — this whole app was built that way, a few dozen
  small features at a time, not in one pass.

## 5. What this actually cost to build

Every change to this app was made by an AI coding agent, and every run logs its own token usage and
estimated cost to `docs/journal.md` in this repo. As of the last time this page was updated:

- **105 pull requests** merged, **108 issues** closed, over roughly **5 days** (2026-08-05 to
  2026-08-09).
- **$75.08** in actual metered-API-equivalent cost is recorded in full detail across the 30 issues
  that have complete token/cost logging (some early runs and a stretch affected by a logging bug
  predate that instrumentation and are marked `n/a` rather than guessed at).
- Using the mean cost of those 30 fully-logged issues (**≈$2.50/issue**, the same figure
  `docs/journal.md`'s own "Build Velocity" section reports) as a rough stand-in for the ones missing
  data, the **all-in ballpark for the whole 108-issue build is on the order of $250–300** in
  metered-API-equivalent terms. This is an estimate, not an invoice.

That figure is *illustrative*, not what was actually paid: this project was built using a flat-rate
**Claude Max subscription**, not per-token API billing, so the real out-of-pocket cost was a fixed
monthly fee regardless of how much the agent actually did — see
[claude.com/pricing](https://claude.com/pricing) for current subscription tiers. The $-per-issue
figures exist so you can judge the *scale* of what a fork like this costs to build or extend, not
as a literal receipt.

## 6. Lines of code, and what a human developer would have charged

As of the last time this page was updated, the repo is **237 tracked files** (excluding the
auto-generated `package-lock.json`) totalling **≈78,600 lines**, split roughly like this:

| Category | Lines | What's in it |
|---|---:|---|
| Application code | ≈43,100 | Svelte components/routes (18,045), JS logic in `src/lib/` (24,349), CSS (658), app shell/type declarations (84) |
| Test code | ≈30,600 | `*.test.js` — over 2,600 tests across every calculator, component and edge case |
| CI / build infrastructure | ≈970 | GitHub Actions workflows (723), the autonomous build pipeline's helper scripts (170) |
| Hand/agent-authored docs | ≈900 | README, DESIGN.md, CLAUDE.md, docs/github.md, this page |
| Auto-generated build journal | ≈3,000 | `docs/journal.md` — one entry per issue, written by the agent as it went, not really "authored" in the usual sense |

**How long would a human developer take to build this from scratch?** Two ways of estimating,
which land in a similar place:

- **By feature scope.** This is roughly a dozen substantial feature areas — the data model and
  persistence layer, net worth tracking and charting, a forecast/FIRE engine, a full UK income tax
  calculator (England/Wales/NI *and* Scotland, HICBC, the 60% taper, Marriage Allowance, Student
  Loan, salary sacrifice), pensions and State Pension projection, a Monte Carlo retirement
  simulator, an Inheritance Tax calculator, property/mortgage/assets tracking, household/partner
  and budget features, theming/accessibility/exports, and the CI/CD and GitHub sign-in
  plumbing — each realistically **1–2 weeks** of design, implementation and testing for one
  developer working alone, including the time spent getting UK tax rules right rather than just
  typing code. That's **14–18 weeks**.
- **By code volume**, as a cross-check rather than the primary estimate (raw lines-per-day is a
  poor way to measure real engineering work on its own): ≈73,700 lines of application + test code,
  at a sustainable pace of roughly 120–150 lines/hour for code that's actually tested and correct
  — not a typing-speed number — comes out to **≈490–615 hours**, which is the same 3–4 month range.

Put together: **roughly 3–4 months of one developer working full-time (≈500–650 hours)**, including
the UK tax/pension domain research this app leans on throughout — an estimate, not a quote a real
agency would give without seeing the actual spec.

**What would that cost, paid as a UK employee?** Using a **£60,000/year** pro-rata salary as an
illustrative example:

- A UK working year is roughly 260 working days minus ~33 days of annual leave and bank holidays ≈
  227 days, at 7.5 hours/day ≈ **1,700 billable hours/year**.
- £60,000 ÷ 1,700 ≈ **£35/hour** base salary, or **≈£44/hour fully loaded** (adding ~25% for
  employer National Insurance, minimum pension auto-enrolment contributions, and basic overhead —
  the standard way UK contract rates are derived from a permanent salary).
- 500–650 hours × £35–£44/hour ≈ **£18,000–£29,000** — around **30–48% of that developer's annual
  salary**, spent over 3–4 months, to build what this repo now contains.

Same caveat as the AI-cost figures above: this is an order-of-magnitude estimate for judging scale,
built from standard UK salary-costing conventions, not a real quote — an actual agency or
freelancer would price this from the real spec, not from a line count after the fact.

## 7. Your data stays yours

None of the above touches your financial data. Everything you enter into your fork stays in your
own browser (or your own private GitHub Gist, if you turn on sync) — never sent to, or visible to,
the original author, or anyone else's fork. See `README.md`'s "Data Persistence" section for the
full detail on how storage works.
