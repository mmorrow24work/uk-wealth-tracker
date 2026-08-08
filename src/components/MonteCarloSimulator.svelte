<script module>
	/**
	 * Readiness gating for the Monte Carlo panel — issue #132.
	 *
	 * `monteCarloInputFromAppData()` (`$lib/monte-carlo.js`, #131) never throws: with no date of
	 * birth recorded it falls back to its own age-40 default, and with no pension pot, no ISA
	 * holding, no contribution and no promised income stream it still normalises to a usable
	 * all-zero `MonteCarloInput` and simulates it happily. Both are the engine doing its job with
	 * the facts it was handed, not a plan anyone actually described — so this decides which of the
	 * two callers is in *before* `simulateRetirement()` ever runs, which is what keeps the age-40
	 * fallback and an empty position from reaching the headline dressed up as a real answer.
	 */

	/**
	 * @typedef {'no_dob' | 'no_data' | 'ready'} MonteCarloReadiness
	 */

	/**
	 * @param {Partial<import('$lib/types.js').Profile> | null | undefined} profile
	 * @param {import('$lib/monte-carlo.js').MonteCarloInput} input Already assembled from the same
	 *   `profile`/`pensions`/`monthlyEntries` this reads — so it looks at what was actually derived
	 *   rather than re-deriving it a second way.
	 * @returns {MonteCarloReadiness}
	 */
	export function monteCarloReadiness(profile, input) {
		if (profile?.dob_year === null || profile?.dob_year === undefined) return 'no_dob';

		const hasPot = input.pensionPot > 0 || input.isaPot > 0;
		const hasContribution = input.pensionContribution > 0 || input.isaContribution > 0;
		const hasStream = input.streams.length > 0;
		if (!hasPot && !hasContribution && !hasStream) return 'no_data';

		return 'ready';
	}
</script>

<script>
	/**
	 * Monte Carlo retirement simulator panel — README.md → Phase 2, "Monte Carlo Retirement
	 * Simulator" (issue #132), the results-display half of #131's engine.
	 *
	 * Seeded from the store and read-only, the same convention `FireCalculator` below it on this
	 * tab already follows: `monteCarloInputFromAppData()` (#131) does the actual assembly — the DC
	 * pension pot and its monthly contribution from `pensions`, the tax-free pot and its
	 * contribution from the latest snapshot's ISA holdings, the State Pension and any Defined
	 * Benefit pension as promised income streams, and the growth/inflation/tax-region/retirement-age
	 * assumptions from `profile` — so this component only decides *whether* to show a number and
	 * how to word the one it gets, never how to derive it. Nothing here writes back to the store.
	 *
	 * This issue adds no controls (#155's job): the run uses the engine's own `DEFAULT_TARGET_AGE`
	 * (95) and `DEFAULT_VOLATILITY` (15%) for the two assumptions `Profile` carries no field for,
	 * which `monteCarloInputFromAppData()` → `normaliseMonteCarloInput()` already fill in when
	 * nothing overrides them — so there is nothing to assemble here beyond the seam `#154`/`#153`
	 * hang off (`summary`, passed to neither yet since both cards are still to come).
	 *
	 * No debounce either: a run only recomputes when the store does (a `$derived` off props that
	 * only change on hydration or on another tab's write), not on every keystroke — there are no
	 * keystrokes to debounce until #155 adds the sliders.
	 *
	 * `monteCarloReadiness` above decides between three states before a single path is simulated:
	 * no date of birth on file, a date of birth but nothing to fund a retirement out of, or a real
	 * plan to run 5,000 paths against.
	 */
	import { createProfile } from '$lib/model.js';
	import {
		DEFAULT_SIMULATION_PATHS,
		DEFAULT_TARGET_AGE,
		DEFAULT_VOLATILITY,
		monteCarloInputFromAppData,
		simulateRetirement
	} from '$lib/monte-carlo.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 *   profile?: import('$lib/types.js').Profile,
	 *   pensions?: import('$lib/types.js').Pension[],
	 *   monthlyEntries?: import('$lib/types.js').MonthlyEntry[],
	 *   now?: Date
	 * }}
	 */
	let {
		profile = createProfile(),
		pensions = [],
		monthlyEntries = [],
		now = new Date()
	} = $props();

	const input = $derived(
		monteCarloInputFromAppData({ profile, pensions, monthly_entries: monthlyEntries }, {}, { now })
	);

	const readiness = $derived(monteCarloReadiness(profile, input));

	// Only ever run once there is a real plan to run — see `monteCarloReadiness`'s own doc comment
	// for why `no_dob`/`no_data` must not reach `simulateRetirement()` at all.
	const summary = $derived(readiness === 'ready' ? simulateRetirement(input) : null);

	const percentFormatter = new Intl.NumberFormat('en-GB', {
		style: 'percent',
		minimumFractionDigits: 1,
		maximumFractionDigits: 1
	});
	const pathsFormatter = new Intl.NumberFormat('en-GB');

	/** @param {number} fraction 0–1 @returns {string} e.g. "94.2%" */
	function formatProbability(fraction) {
		return percentFormatter.format(fraction);
	}

	/** @param {number} standardError 0–1 @returns {string} e.g. "±0.7 percentage points" */
	function formatStandardError(standardError) {
		return `±${(standardError * 100).toFixed(1)} percentage points`;
	}

	/** @param {number} count @returns {string} e.g. "5,000 paths" */
	function formatPaths(count) {
		return `${pathsFormatter.format(count)} path${count === 1 ? '' : 's'}`;
	}
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Monte Carlo retirement simulator</h2>
	<p class="text-sm text-muted-foreground mb-4">
		Every other projection on this tab answers "what if the market returns the same rate every
		single year?" — nobody's market does that. This runs {formatPaths(DEFAULT_SIMULATION_PATHS)},
		each one a different order of good and bad years drawn from the same growth and volatility
		assumption, funding your target income out of your pension pot and ISA pot under UK income tax,
		with the State Pension and any Defined Benefit pension paid first as promised income. The
		headline is the share of those paths that still had money left at age {DEFAULT_TARGET_AGE} — this
		issue only seeds and runs the panel, so it uses the engine's own default target age and a
		{DEFAULT_VOLATILITY}% volatility assumption; making both editable is further work.
	</p>

	{#if readiness === 'no_dob'}
		<p class="text-sm">
			Add your date of birth on the forecast tab and this will simulate your plan — without an age
			to start counting from, a probability here would be about someone else's retirement, not
			yours.
		</p>
	{:else if readiness === 'no_data'}
		<p class="text-sm">
			No pension pot, ISA holding or promised income recorded yet. Add a pension on the Pensions
			tab, or record a monthly snapshot with an ISA holding in it, and this will simulate your plan
			against it.
		</p>
	{:else if summary}
		<div class="flex flex-wrap gap-3 mb-3">
			<div class="flex-1 min-w-52 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">Probability of success</div>
				<div class="text-xs text-muted-foreground mb-1">
					still funded at age {summary.input.targetAge}
				</div>
				<div class="text-2xl font-semibold">{formatProbability(summary.successProbability)}</div>
				<div class="text-xs text-muted-foreground">
					{formatStandardError(summary.standardError)}, across {formatPaths(summary.paths)}
				</div>
			</div>
		</div>

		{#if summary.guaranteed}
			<p class="text-sm">
				<span class="font-medium">This is guaranteed, not simulated.</span>
				Your State Pension and any Defined Benefit pension already cover your target income in every retirement
				year on their own, before your pension pot or ISA pot are touched — so the 100% above is a statement
				about those promised payments, not about the market.
			</p>
		{:else}
			<p class="text-sm">
				Of {formatPaths(summary.paths)} simulated, {formatPaths(summary.successes)} funded every retirement
				year in full and {formatPaths(summary.failures)} fell short at some point before age
				{summary.input.targetAge}.
			</p>
		{/if}
	{/if}

	<p class="text-xs text-muted-foreground mt-4">
		Illustrative only, not financial advice. Deterministic and seeded — the same inputs always
		produce the same answer, so this figure only moves when your recorded position does. Returns are
		drawn independently month to month with no mean reversion, no volatility clustering and no
		correlation with inflation, so a real crash can be worse than anything simulated here; nothing
		here models asset allocation, annuitising, care costs or dying before the target age.
	</p>
</Card>
