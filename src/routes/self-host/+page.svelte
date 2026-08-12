<script>
	/**
	 * Self-hosting / "fork this" page. Not one of `$lib/nav.js`'s `NAV_TABS` (same reasoning as
	 * `/connect`: a setup/reference screen most visitors read once, not a feature tab) — reached
	 * from the footer instead. Content is the in-app counterpart to `docs/self-hosting.md`, kept in
	 * sync by hand since one is prose for GitHub and the other is a Svelte page; update both together.
	 *
	 * The cost figures below are read from `docs/journal.md`'s own numbers as of the day this page
	 * was written (105 merged PRs, 108 closed issues, $75.08 recorded across 30 fully-logged issues,
	 * ~$2.50 mean cost/issue) -- they will drift as the build continues and aren't live-computed, so
	 * treat them as a snapshot rather than a real-time figure.
	 */
</script>

<h1>🍴 Make This Yours</h1>
<p>
	This app has no backend and no company behind it: your data lives in your browser (or your own
	private GitHub Gist), and the whole site is static files on GitHub Pages. That means you can fork
	it and run your own copy for free, on your own domain, with your own data nobody else sees. Here's
	how.
</p>

<div class="mt-6 max-w-2xl flex flex-col gap-6">
	<section class="border border-border rounded-md p-4">
		<h2 class="text-lg font-semibold mb-2">1. Fork the repo</h2>
		<p class="text-sm">
			Go to
			<a
				href="https://github.com/mmorrow24work/uk-wealth-tracker"
				target="_blank"
				rel="noopener noreferrer"
				class="underline hover:text-foreground"
			>
				github.com/mmorrow24work/uk-wealth-tracker
			</a>
			and click <strong>Fork</strong> (top right). You get your own full copy of the code and its history
			— free, no time limit, no permission needed. Change anything: figures, tax years, colours, tabs.
			It's yours.
		</p>
	</section>

	<section class="border border-border rounded-md p-4">
		<h2 class="text-lg font-semibold mb-2">2. Host it somewhere</h2>
		<p class="text-sm mb-2">
			The original runs on <strong>GitHub Pages</strong>, already wired up in your fork via
			<code>.github/workflows/deploy.yml</code> — free, no server to manage. In your fork's
			<strong>Settings → Pages</strong>, set the source to <strong>GitHub Actions</strong>, then
			push a commit (or re-run the deploy workflow from the <strong>Actions</strong> tab). Your copy
			is live at <code>https://&lt;your-username&gt;.github.io/uk-wealth-tracker/</code> within a couple
			of minutes.
		</p>
		<p class="text-sm">
			It's a plain static build (<code>npm run build</code>), so Netlify, Vercel and Cloudflare
			Pages all work too, unmodified, if you're already using one of those.
		</p>
	</section>

	<section class="border border-border rounded-md p-4">
		<h2 class="text-lg font-semibold mb-2">3. Put it on your own domain (optional)</h2>
		<ol class="text-sm list-decimal pl-5 flex flex-col gap-1">
			<li>
				Buy a domain — <a
					href="https://www.cloudflare.com/products/registrar/"
					target="_blank"
					rel="noopener noreferrer"
					class="underline hover:text-foreground">Cloudflare Registrar</a
				> sells at cost, typically £8–15/year. Any registrar works.
			</li>
			<li>
				Add a DNS <strong>CNAME</strong> record: name = your chosen subdomain (e.g.
				<code>wealth</code>), target = <code>&lt;your-username&gt;.github.io</code>.
			</li>
			<li>
				In your fork's <strong>Settings → Pages → Custom domain</strong>, enter the full domain and
				save — GitHub issues an HTTPS certificate automatically.
			</li>
			<li>
				Put your domain in <code>static/CNAME</code> (one line) so it survives future rebuilds.
			</li>
		</ol>
	</section>

	<section class="border border-border rounded-md p-4">
		<h2 class="text-lg font-semibold mb-2">4. Keep building it with an AI coding agent</h2>
		<p class="text-sm mb-2">
			Every tab in this app, including this page, was built by prompting an AI coding agent rather
			than hand-writing it. You don't need to be a developer to extend your fork — you need to be
			able to describe the change you want.
		</p>
		<p class="text-sm mb-2">
			<a
				href="https://claude.com/claude-code"
				target="_blank"
				rel="noopener noreferrer"
				class="underline hover:text-foreground">Claude Code</a
			>
			(what built this repo) reads your codebase, makes edits, and checks its own work by running your
			build/tests. This project also wired it into GitHub Actions as an autonomous loop (<code
				>.github/workflows/claude-build.yml</code
			>) that works through a queue of GitHub issues unattended — copyable into your fork as-is.
			<a
				href="https://github.com/google-gemini/gemini-cli"
				target="_blank"
				rel="noopener noreferrer"
				class="underline hover:text-foreground">Gemini CLI</a
			> is Google's free, open-source equivalent, if you'd rather not run a paid tool for occasional changes.
		</p>
		<p class="text-sm">
			Either way: describe one small, specific change, let the agent make it, check it in a browser,
			commit. This whole app was built that way, a few dozen small features at a time.
		</p>
	</section>

	<section class="border border-border rounded-md p-4">
		<h2 class="text-lg font-semibold mb-2">5. What this actually cost to build</h2>
		<p class="text-sm mb-2">
			Every change here was made by an AI agent, and every run logs its own token usage and
			estimated cost to <code>docs/journal.md</code> in this repo. As of the last time this page was
			updated: <strong>105 pull requests</strong> merged and <strong>108 issues</strong> closed over
			roughly <strong>5 days</strong>.
		</p>
		<p class="text-sm mb-2">
			<strong>$75.08</strong> in metered-API-equivalent cost is recorded in full detail across the
			30 issues with complete logging (some early runs predate that instrumentation). Using those 30
			issues' mean cost (≈$2.50/issue — the same figure the journal's own "Build Velocity" section
			reports) as a stand-in for the rest, the
			<strong>all-in ballpark for the whole build is on the order of $250–300</strong> in metered-API-equivalent
			terms. An estimate, not an invoice.
		</p>
		<p class="text-sm">
			That figure is illustrative, not what was actually paid: this was built on a flat-rate
			<strong>Claude Max subscription</strong>, not per-token billing, so the real cost was a fixed
			monthly fee regardless of how much the agent did — see
			<a
				href="https://claude.com/pricing"
				target="_blank"
				rel="noopener noreferrer"
				class="underline hover:text-foreground">claude.com/pricing</a
			> for current tiers. The figures above are for judging scale, not a receipt.
		</p>
	</section>

	<section class="border border-border rounded-md p-4">
		<h2 class="text-lg font-semibold mb-2">
			6. Lines of code, and what a human would have charged
		</h2>
		<p class="text-sm mb-2">
			As of the last time this page was updated, the repo is <strong>237 tracked files</strong>
			totalling <strong>≈78,600 lines</strong>: ≈43,100 application code (Svelte/JS/CSS), ≈30,600
			tests (2,600+ of them), ≈970 CI/build infrastructure, ≈900 hand/agent-authored docs, and
			≈3,000 lines of auto-generated build journal (not really "authored" in the usual sense).
		</p>
		<p class="text-sm mb-2">
			Two ways to estimate how long a human developer would take to build the same thing from
			scratch land in the same place: by feature scope (roughly a dozen substantial areas — UK
			income tax across all four nations, a Monte Carlo retirement simulator, Inheritance Tax,
			pensions, property, household/budget features, theming, CI/CD — at 1–2 weeks each, ≈14–18
			weeks), and by code volume (≈73,700 combined app+test lines at a sustainable,
			tested-and-correct 120–150 lines/hour, ≈490–615 hours). Both land around
			<strong>3–4 months of one developer working full-time (≈500–650 hours)</strong>.
		</p>
		<p class="text-sm">
			On a <strong>£60,000/year</strong> UK pro-rata salary (≈1,700 billable hours/year → ≈£35/hour
			base, ≈£44/hour fully loaded with employer NI, pension auto-enrolment and overhead), that's
			roughly <strong>£18,000–£29,000</strong> — about 30–48% of that developer's annual salary, spent
			over 3–4 months. An order-of-magnitude estimate for judging scale, not a real quote.
		</p>
	</section>

	<section class="border border-border rounded-md p-4">
		<h2 class="text-lg font-semibold mb-2">7. Your data stays yours</h2>
		<p class="text-sm">
			None of the above touches your financial data. Everything you enter into your fork stays in
			your own browser (or your own private GitHub Gist, if you turn on sync) — never sent to, or
			visible to, the original author or anyone else's fork.
		</p>
	</section>
</div>
