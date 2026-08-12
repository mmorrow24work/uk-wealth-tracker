<script module>
	/**
	 * The shortfall and terminal-pot breakdown beneath the Monte Carlo headline — issue #154 (the
	 * component and the shortfall section) and #218 (the terminal-pot section added to the same
	 * component). Both are the supporting-figures half of #132's `MonteCarloSimulator.svelte` panel:
	 * that component computes `summary` (via `simulateRetirement()`, `$lib/monte-carlo.js`, #131) and
	 * passes it straight through as a prop; this component owns none of that arithmetic and writes
	 * nothing back — the same `summary`-shaped seam #153's fan chart (`MonteCarloFanChart.svelte`)
	 * hangs off, read independently.
	 *
	 * Formatting and state-selection are pure functions here, the same split `NetWorthChart.svelte`'s
	 * `netWorthTooltipReading` and `MonteCarloFanChart.svelte`'s own module-level helpers use for the
	 * same reason: testable without mounting a component.
	 *
	 * Two caveats worth restating here since they drive the labelling below:
	 * - Every figure in `summary.shortfall` is conditional on failure. `firstAges` is collected only
	 *   from paths that fell short and `meanYears` divides by `failures`, so "median first shortfall
	 *   at 84" means *given the plan fails*, not "the typical retirement runs out at 84" — read as an
	 *   unconditional average it makes a 95%-success plan look far worse than it is.
	 * - `summary.terminal.mean` sits well above `summary.terminal.median` because the distribution is
	 *   right-skewed — a handful of very good paths pull the average up — so the mean must not read as
	 *   "what you would expect to have left". And a percentile is the spread across paths at the target
	 *   age, not one simulation's outcome: the p95 pot and the p5 pot belong to different paths, the
	 *   same caveat `MonteCarloBandPoint`'s own docs in `monte-carlo.js` make for #153's fan.
	 */

	const currencyFormatter = new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: 'GBP',
		maximumFractionDigits: 0
	});
	const percentFormatter = new Intl.NumberFormat('en-GB', {
		style: 'percent',
		minimumFractionDigits: 1,
		maximumFractionDigits: 1
	});
	const countFormatter = new Intl.NumberFormat('en-GB');

	/** @param {number} amount @returns {string} */
	function formatMoney(amount) {
		return currencyFormatter.format(amount);
	}

	/** @param {number} fraction 0–1 @returns {string} */
	function formatShare(fraction) {
		return percentFormatter.format(fraction);
	}

	/** @param {number} count @returns {string} */
	function formatCount(count) {
		return countFormatter.format(count);
	}

	/**
	 * @param {number | null} age
	 * @returns {string} `"—"` rather than `"age 0"` or `"age NaN"` when there is nothing to average —
	 *   the null case the issue calls out by name.
	 */
	function formatAge(age) {
		return age === null ? '—' : `age ${Math.round(age)}`;
	}

	/** @param {number} years @returns {string} e.g. "6.2 years" */
	function formatYears(years) {
		return `${years.toFixed(1)} years`;
	}

	/**
	 * One label/value pair for a breakdown table row.
	 *
	 * @typedef {object} MonteCarloOutcomeRow
	 * @property {string} label
	 * @property {string} value
	 */

	/**
	 * Which of the four things the shortfall section has to show, decided once before a single row
	 * renders so the markup only ever picks a branch rather than reasoning about nulls itself. The
	 * terminal-pot section below has no equivalent state: `monteCarloTerminalRows` is meaningful in
	 * every case, including a fully depleted majority (see its own doc comment).
	 *
	 * - `no_summary` — no plan to explain yet: the parent is still debouncing, or the input was too
	 *   incomplete to run. `MonteCarloSimulator.svelte`'s own `monteCarloReadiness` already keeps a
	 *   no-date-of-birth or no-data position out of `summary` entirely (it stays `null`), so this
	 *   state does not need to tell the two apart.
	 * - `guaranteed` — `summary.guaranteed`: the promised income streams alone cover the target income
	 *   in every retirement year, so there is nothing for the market to break and no shortfall table
	 *   to show.
	 * - `no_shortfall` — `summary.shortfall.paths === 0`: every path funded the plan in full. Distinct
	 *   from `guaranteed`, since a fully-funded plan can still have real market risk in it; it just
	 *   never lost that bet across every path simulated.
	 * - `shortfall` — the ordinary case, with a real breakdown to show.
	 *
	 * @typedef {'no_summary' | 'guaranteed' | 'no_shortfall' | 'shortfall'} MonteCarloShortfallState
	 */

	/**
	 * @param {import('$lib/monte-carlo.js').MonteCarloSummary | null | undefined} summary
	 * @returns {MonteCarloShortfallState}
	 */
	export function monteCarloShortfallState(summary) {
		if (!summary) return 'no_summary';
		if (summary.guaranteed) return 'guaranteed';
		if (summary.shortfall.paths === 0) return 'no_shortfall';
		return 'shortfall';
	}

	/**
	 * The shortfall breakdown as display rows — meaningful only in the `'shortfall'` state, since
	 * every figure it reads is `null`/`0` by construction otherwise (see `monteCarloShortfallState`).
	 *
	 * @param {import('$lib/monte-carlo.js').MonteCarloSummary} summary
	 * @returns {MonteCarloOutcomeRow[]}
	 */
	export function monteCarloShortfallRows(summary) {
		const { shortfall, paths } = summary;
		return [
			{
				label: 'Paths that fell short',
				value: `${formatShare(shortfall.probability)} (${formatCount(shortfall.paths)} of ${formatCount(paths)})`
			},
			{ label: 'Earliest shortfall', value: formatAge(shortfall.earliestAge) },
			{
				label: 'Median first shortfall, given a shortfall happens',
				value: formatAge(shortfall.medianFirstAge)
			},
			{
				label: 'Mean years short, given a shortfall happens',
				value: formatYears(shortfall.meanYears)
			},
			{
				label: 'Median total missed, given a shortfall happens',
				value: formatMoney(shortfall.medianTotal)
			}
		];
	}

	/**
	 * The terminal-pot breakdown as display rows (issue #218) — what the plan leaves behind at
	 * `summary.input.targetAge` rather than how it failed along the way. Always meaningful, including
	 * at `paths === 0` or a fully depleted majority: a `terminal.median` of `0` sitting next to a
	 * `depletedShare` near `1` already reads as "most paths ended with nothing left" once both rows
	 * are on the same table — no special-cased message needed the way the shortfall section needs one
	 * for `no_shortfall`/`guaranteed`, since there is always a pot figure to report even when it is
	 * zero for almost everyone.
	 *
	 * @param {import('$lib/monte-carlo.js').MonteCarloSummary} summary
	 * @returns {MonteCarloOutcomeRow[]}
	 */
	export function monteCarloTerminalRows(summary) {
		const { terminal } = summary;
		return [
			{ label: 'Mean', value: formatMoney(terminal.mean) },
			{ label: 'Median', value: formatMoney(terminal.median) },
			{
				label: 'Middle 50% (25th–75th percentile)',
				value: `${formatMoney(terminal.percentiles.p25)} – ${formatMoney(terminal.percentiles.p75)}`
			},
			{
				label: 'Middle 90% (5th–95th percentile)',
				value: `${formatMoney(terminal.percentiles.p5)} – ${formatMoney(terminal.percentiles.p95)}`
			},
			{ label: 'Paths with nothing left', value: formatShare(terminal.depletedShare) }
		];
	}
</script>

<script>
	/**
	 * Rendered by `MonteCarloSimulator.svelte` directly beneath its probability-of-success headline —
	 * this card only ever reads the `summary` that produced it, never runs `simulateRetirement()` on
	 * its own and never writes to the store.
	 */
	import Card from './ui/card.svelte';

	/**
	 * @type {{ summary?: import('$lib/monte-carlo.js').MonteCarloSummary | null }}
	 */
	let { summary = null } = $props();

	const shortfallState = $derived(monteCarloShortfallState(summary));
	const shortfallRows = $derived(
		summary && shortfallState === 'shortfall' ? monteCarloShortfallRows(summary) : []
	);
	const terminalRows = $derived(summary ? monteCarloTerminalRows(summary) : []);
	// A depleted majority — `depletedShare` at or above half — has to read as "most paths ended with
	// nothing left" rather than as an unexplained `£0` median sitting next to a percentage. Half is
	// the natural cutoff: below it, "nothing left" would misdescribe a table most paths didn't hit.
	const depletedMajority = $derived(Boolean(summary && summary.terminal.depletedShare >= 0.5));
</script>

<Card className="p-4">
	{#if !summary}
		<p class="text-sm text-muted-foreground">
			Once there is a plan to simulate, the shortfall and terminal-pot figures behind the headline
			will show here.
		</p>
	{:else}
		<h3 class="text-base font-semibold mb-1">How the shortfalls happened</h3>

		{#if shortfallState === 'guaranteed'}
			<p class="text-sm text-muted-foreground mb-4">
				Your State Pension and any Defined Benefit pension already cover your target income in every
				retirement year on their own — see "This is guaranteed, not simulated" above. There is
				nothing here for the market to break, so there is no shortfall to break down.
			</p>
		{:else if shortfallState === 'no_shortfall'}
			<p class="text-sm text-muted-foreground mb-4">
				All {formatCount(summary.paths)} simulated paths funded every retirement year in full — none fell
				short.
			</p>
		{:else}
			<table class="w-full text-sm border-collapse mb-1">
				<tbody>
					{#each shortfallRows as row (row.label)}
						<tr class="border-b border-border/60 last:border-0">
							<th scope="row" class="py-1.5 pr-2 text-left font-normal text-muted-foreground">
								{row.label}
							</th>
							<td class="py-1.5 pl-2 text-right tabular-nums">{row.value}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-muted-foreground mb-4">
				Every row above is conditional on a shortfall happening: it describes the paths that failed,
				not the typical retirement — a 95% success plan can still show a grim-looking "median first
				shortfall" for the 5% that didn't make it.
			</p>
		{/if}

		<h3 class="text-base font-semibold mb-1">Pot left at age {summary.input.targetAge}</h3>
		{#if depletedMajority}
			<p class="text-sm text-muted-foreground mb-1">
				Most paths ended with nothing left: {formatShare(summary.terminal.depletedShare)} had a pot of
				£0 by age {summary.input.targetAge}.
			</p>
		{/if}
		<table class="w-full text-sm border-collapse">
			<tbody>
				{#each terminalRows as row (row.label)}
					<tr class="border-b border-border/60 last:border-0">
						<th scope="row" class="py-1.5 pr-2 text-left font-normal text-muted-foreground">
							{row.label}
						</th>
						<td class="py-1.5 pl-2 text-right tabular-nums">{row.value}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</Card>
