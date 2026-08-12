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
	 *
	 * #155 adds a fourth state, `'invalid'`, for a half-typed or out-of-range control — see
	 * `monteCarloControlsValid` below — but that gate lives in the component's own instance script,
	 * since it is about six numbers the user is actively editing rather than about the store.
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

	/**
	 * @param {unknown} value
	 * @param {number} fallback
	 * @returns {number}
	 */
	function numberOr(value, fallback) {
		return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	}

	/** @param {number} amount @returns {number} `amount` rounded to whole pence, without `-0`. */
	function roundMoney(amount) {
		return Math.round(amount * 100) / 100 + 0;
	}

	/**
	 * The six controls this issue adds. `monthlyContribution` is one number standing in for the
	 * engine's two — {@link splitMonthlyContribution} is the inverse of it.
	 *
	 * @typedef {object} MonteCarloControls
	 * @property {number} retirementAge
	 * @property {number} targetAge
	 * @property {number} targetIncome
	 * @property {number} monthlyContribution Combined pension + ISA (£/mo).
	 * @property {number} growthRate
	 * @property {number} volatility
	 */

	/**
	 * The one combined "monthly contributions" slider split back into the pension and ISA figures
	 * `MonteCarloInput` actually wants — the inverse of what `monteCarloInputFromAppData()` (#131)
	 * built in the first place. The split follows whatever ratio the store seeded the two
	 * contributions in, so a plan with no ISA contribution keeps none as the slider moves; a plan
	 * with no contribution recorded at all — nothing to take a ratio of — puts the whole amount into
	 * the pension, since that is `DEFAULT_WITHDRAWAL_ORDER`'s own assumption (`pension_first`) about
	 * which pot this app expects to be funded, and spent, first.
	 *
	 * @param {unknown} total Combined monthly contribution typed into the one control (£).
	 * @param {number} seedPensionContribution The pension half the panel seeded (£/mo).
	 * @param {number} seedIsaContribution The ISA half it seeded (£/mo).
	 * @returns {{ pensionContribution: number, isaContribution: number }}
	 */
	export function splitMonthlyContribution(total, seedPensionContribution, seedIsaContribution) {
		const amount = Math.max(0, numberOr(total, 0));
		const pensionSeed = Math.max(0, numberOr(seedPensionContribution, 0));
		const isaSeed = Math.max(0, numberOr(seedIsaContribution, 0));
		const seedTotal = pensionSeed + isaSeed;

		if (seedTotal <= 0) return { pensionContribution: roundMoney(amount), isaContribution: 0 };

		const pensionContribution = roundMoney((amount * pensionSeed) / seedTotal);
		return { pensionContribution, isaContribution: roundMoney(amount - pensionContribution) };
	}

	/**
	 * The six controls' starting values, seeded once off the panel's own already-assembled input —
	 * #132's `monteCarloInputFromAppData()`, called with no overrides — plus the engine's own
	 * `DEFAULT_TARGET_AGE`/`DEFAULT_VOLATILITY` for the two assumptions `Profile` carries no field
	 * for. Called once, at mount, never again: from the moment a caller reads this the six values are
	 * the user's, per the issue's "seeded once ... then user-owned from that point on".
	 *
	 * @param {import('$lib/monte-carlo.js').MonteCarloInput} seeded
	 * @returns {MonteCarloControls}
	 */
	export function monteCarloControlDefaults(seeded) {
		return {
			retirementAge: seeded.retirementAge,
			targetAge: DEFAULT_TARGET_AGE,
			targetIncome: seeded.targetIncome,
			monthlyContribution: roundMoney(seeded.pensionContribution + seeded.isaContribution),
			growthRate: seeded.growthRate,
			volatility: DEFAULT_VOLATILITY
		};
	}

	/** The -100…100 band `monte-carlo.js`'s own (unexported) `clampRate` validates growth against. */
	const MIN_GROWTH_RATE = -100;
	const MAX_GROWTH_RATE = 100;

	/**
	 * Whether every one of the six controls is a number worth spending a run on — the engine's own
	 * `MIN_AGE`/`MAX_AGE`/`MIN_VOLATILITY`/`MAX_VOLATILITY` for the two age fields and volatility,
	 * the same -100…100 band every other rate field in this app validates against for growth, and
	 * plain non-negativity for the two money fields. `bind:value` on a cleared number input hands
	 * back `null`/`''`, which the caller below turns into `NaN` before this ever sees it —
	 * `Number.isFinite` catches that the same way it catches a half-typed "1.2.3".
	 *
	 * @param {MonteCarloControls} controls Already parsed to numbers (or `NaN`) — see the instance
	 *   script's own `parse`.
	 * @returns {boolean}
	 */
	export function monteCarloControlsValid(controls) {
		const { retirementAge, targetAge, targetIncome, monthlyContribution, growthRate, volatility } =
			controls;
		return (
			Number.isFinite(retirementAge) &&
			retirementAge >= MIN_AGE &&
			retirementAge <= MAX_AGE &&
			Number.isFinite(targetAge) &&
			targetAge >= MIN_AGE &&
			targetAge <= MAX_AGE &&
			Number.isFinite(targetIncome) &&
			targetIncome >= 0 &&
			Number.isFinite(monthlyContribution) &&
			monthlyContribution >= 0 &&
			Number.isFinite(growthRate) &&
			growthRate >= MIN_GROWTH_RATE &&
			growthRate <= MAX_GROWTH_RATE &&
			Number.isFinite(volatility) &&
			volatility >= MIN_VOLATILITY &&
			volatility <= MAX_VOLATILITY
		);
	}

	/**
	 * Six validated controls, turned into the patch applied *over* the panel's seeded input —
	 * `$lib/monte-carlo.js`'s own `MonteCarloInputPatch` (#131). Pots, streams, inflation, fees, tax
	 * region, withdrawal order, seed and path count all keep coming from whatever
	 * `monteCarloInputFromAppData()` already built; this only ever touches the six fields the
	 * controls own.
	 *
	 * @param {MonteCarloControls} controls Already validated — see {@link monteCarloControlsValid}.
	 * @param {import('$lib/monte-carlo.js').MonteCarloInput} seeded The panel's own seeded input,
	 *   whose pension/ISA contribution ratio {@link splitMonthlyContribution} divides the combined
	 *   slider by.
	 * @returns {import('$lib/monte-carlo.js').MonteCarloInputPatch}
	 */
	export function monteCarloOverridesFromControls(controls, seeded) {
		return {
			retirementAge: controls.retirementAge,
			targetAge: controls.targetAge,
			targetIncome: controls.targetIncome,
			growthRate: controls.growthRate,
			volatility: controls.volatility,
			...splitMonthlyContribution(
				controls.monthlyContribution,
				seeded.pensionContribution,
				seeded.isaContribution
			)
		};
	}
</script>

<script>
	/**
	 * Monte Carlo retirement simulator panel — README.md → Phase 2, "Monte Carlo Retirement
	 * Simulator" (issue #132), the results-display half of #131's engine, and issue #155, which
	 * turns it from a read-only readout into a what-if: the same panel, with six assumptions the
	 * user can drag.
	 *
	 * Seeded from the store and read-only *against the store* — the same convention `FireCalculator`
	 * above it on this tab already follows — `monteCarloInputFromAppData()` (#131) does the actual
	 * assembly: the DC pension pot and its monthly contribution from `pensions`, the tax-free pot and
	 * its contribution from the latest snapshot's ISA holdings, the State Pension and any Defined
	 * Benefit pension as promised income streams, and the growth/inflation/tax-region/retirement-age
	 * assumptions from `profile`. This component reads that assembled input exactly once, at mount
	 * (`monteCarloControlDefaults`), to seed six controls — retirement age, target income, monthly
	 * contribution, growth, volatility and target age — and from that moment on the controls are the
	 * user's: nothing here writes back to the store, and nothing re-seeds a control the user has
	 * already touched.
	 *
	 * The six controls are applied as a *patch* over the seeded input (`monteCarloOverridesFromControls`),
	 * not a re-derivation: pots, streams, inflation, fees, tax region, withdrawal order, seed and path
	 * count all keep coming from `monteCarloInputFromAppData()` untouched, exactly as the issue asks.
	 * The one combined "monthly contributions" control is split back into the engine's own
	 * `pensionContribution`/`isaContribution` by `splitMonthlyContribution`, in whatever ratio the
	 * store seeded the two in.
	 *
	 * Responsiveness is the point, not a polish item: a 5,000-path run takes roughly half a second
	 * (#131's own measurement), so recomputing it on every keystroke or every pixel of a drag would
	 * lock the sliders up. The run is debounced (`DEBOUNCE_MS` below) — the six numbers, the
	 * validation state and every other part of the panel update immediately as the controls move, but
	 * `simulateRetirement()` only fires once dragging has paused. While a debounced run is pending,
	 * the *previous* headline stays on screen with a "recalculating…" marker rather than blanking out
	 * — see `recalculating` below — and the `$effect` that owns the timer clears it both on the next
	 * input and on teardown, so nothing here can outlive the component.
	 *
	 * `bind:value` on a cleared number input hands back `null`/`''`, and a retirement age of 300 is
	 * not a run worth spending — `monteCarloControlsValid` validates every control against the
	 * engine's own `MIN_AGE`/`MAX_AGE`/`MIN_VOLATILITY`/`MAX_VOLATILITY` (plus the app's usual
	 * -100…100 band for a rate and plain non-negativity for a pound figure), and a control outside
	 * that falls back to the same "can't say yet" treatment `monteCarloReadiness` already gives a
	 * missing date of birth or an empty position — never a NaN headline.
	 *
	 * #153's fan chart (`MonteCarloFanChart`) and #154/#218's shortfall/terminal-pot breakdown
	 * (`MonteCarloOutcomes`) both hang off the same `summary` seam this component has always produced
	 * — they re-render for free as the controls move the debounced `summary` along, and neither needed
	 * any change for this issue.
	 */
	import { createProfile } from '$lib/model.js';
	import {
		DEFAULT_SIMULATION_PATHS,
		DEFAULT_TARGET_AGE,
		DEFAULT_VOLATILITY,
		MAX_AGE,
		MAX_VOLATILITY,
		MIN_AGE,
		MIN_VOLATILITY,
		monteCarloInputFromAppData,
		simulateRetirement
	} from '$lib/monte-carlo.js';
	import MonteCarloFanChart from './MonteCarloFanChart.svelte';
	import MonteCarloOutcomes from './MonteCarloOutcomes.svelte';
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

	// Slider bounds are a UI convenience, not spec — README.md gives no ranges. Following
	// `FireCalculator.svelte`'s and `StressTestPanel.svelte`'s precedent, the number inputs below
	// still reach the engine's own full range (`MIN_AGE`…`MAX_AGE`, `MIN_VOLATILITY`…`MAX_VOLATILITY`,
	// -100…100 for growth) regardless of where the drag handle lives.
	const RETIREMENT_AGE_SLIDER_MIN = 40;
	const RETIREMENT_AGE_SLIDER_MAX = 80;
	const TARGET_AGE_SLIDER_MIN = 60;
	const TARGET_AGE_SLIDER_MAX = 110;
	const INCOME_SLIDER_MAX = 150_000;
	const CONTRIBUTION_SLIDER_MAX = 5_000;
	const GROWTH_SLIDER_MIN = -5;
	const GROWTH_SLIDER_MAX = 15;
	const VOLATILITY_SLIDER_MAX = 40;

	// How long a burst of dragging waits before the simulation re-runs. Long enough that a slider
	// stays perfectly smooth; short enough that letting go feels immediate. `store.js`'s own autosave
	// debounce (`SYNC_DEBOUNCE_MS`) is 800ms for a much cheaper write — this is shorter because the
	// cost here is a moment of user-visible latency, not the risk of losing an edit.
	const DEBOUNCE_MS = 400;

	const appDataView = $derived({ profile, pensions, monthly_entries: monthlyEntries });

	// The panel's own seeded input, built with no overrides — read once at mount to seed the six
	// controls (see `monteCarloControlDefaults`), and again below (still with no overrides) purely to
	// ask `monteCarloReadiness` whether a date of birth is on file, which no control can supply.
	const seeded = $derived(monteCarloInputFromAppData(appDataView, {}, { now }));

	// svelte-ignore state_referenced_locally
	const initialControls = monteCarloControlDefaults(seeded);
	let retirementAge = $state(initialControls.retirementAge);
	let targetIncome = $state(initialControls.targetIncome);
	let monthlyContribution = $state(initialControls.monthlyContribution);
	let growthRate = $state(initialControls.growthRate);
	let volatility = $state(initialControls.volatility);
	let targetAge = $state(initialControls.targetAge);

	/**
	 * `bind:value` on a number input hands back a number, or `null`/`''` once the field is cleared —
	 * turned into `NaN` here so `monteCarloControlsValid` has one thing to check per field.
	 *
	 * @param {unknown} value
	 * @returns {number}
	 */
	function parse(value) {
		if (value === null || value === undefined || value === '') return Number.NaN;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : Number.NaN;
	}

	const controls = $derived({
		retirementAge: parse(retirementAge),
		targetAge: parse(targetAge),
		targetIncome: parse(targetIncome),
		monthlyContribution: parse(monthlyContribution),
		growthRate: parse(growthRate),
		volatility: parse(volatility)
	});

	const controlsValid = $derived(monteCarloControlsValid(controls));

	const hasDob = $derived(profile?.dob_year !== null && profile?.dob_year !== undefined);

	// The live input the current controls describe — `null` while a control is half-typed or out of
	// range, since there is nothing safe to hand `simulateRetirement()` yet.
	const liveInput = $derived(
		controlsValid
			? monteCarloInputFromAppData(appDataView, monteCarloOverridesFromControls(controls, seeded), {
					now
				})
			: null
	);

	const readiness = $derived(
		!hasDob
			? 'no_dob'
			: !controlsValid
				? 'invalid'
				: monteCarloReadiness(
						profile,
						/** @type {import('$lib/monte-carlo.js').MonteCarloInput} */ (liveInput)
					)
	);

	// The debounced run. `summary` below is driven off `debouncedInput`, not `liveInput` directly, so
	// a burst of slider drags recomputes the ~half-second 5,000-path simulation once, on the trailing
	// edge, rather than once per pixel dragged. `$effect`'s own cleanup — returned below — is what
	// both restarts the timer on the next input and clears it on teardown; nothing else here owns a
	// `setTimeout` handle to remember to cancel by hand.
	//
	// Seeded synchronously with whatever `liveInput` already is at mount, not left to the effect
	// below to fill in: `$effect` never runs during server-side rendering, so a component that waited
	// for it would render its very first `summary` as `null` forever in a server-rendered smoke test
	// — and even in a browser it would mean a needless "recalculating…" flash before the first
	// headline anyone ever sees.
	// svelte-ignore state_referenced_locally
	let debouncedInput = $state(readiness === 'ready' ? liveInput : null);
	let recalculating = $state(false);

	// Skips its own first run — the mount-time value is already captured above — so this only ever
	// debounces a *change*, not the initial render.
	let firstEffectRun = true;

	$effect(() => {
		const ready = readiness === 'ready';
		const next = liveInput;

		if (firstEffectRun) {
			firstEffectRun = false;
			return;
		}

		if (!ready || !next) {
			recalculating = false;
			return;
		}

		recalculating = true;
		const timer = setTimeout(() => {
			debouncedInput = next;
			recalculating = false;
		}, DEBOUNCE_MS);

		return () => clearTimeout(timer);
	});

	// Only ever computed off a debounced, already-validated input — see `readiness`'s and the
	// `$effect` above's own doc comments for why `no_dob`/`invalid`/`no_data` must never reach
	// `simulateRetirement()`.
	const summary = $derived(debouncedInput ? simulateRetirement(debouncedInput) : null);

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
		headline is the share of those paths that still had money left at the target age below. The six
		figures are seeded from your recorded position and the engine's own defaults, then yours to
		change — drag a slider or edit a number, and the simulation re-runs a moment after you stop.
	</p>

	<div class="flex flex-wrap items-end gap-4 mb-4">
		<div class="flex flex-col gap-1">
			<span id="mc-retirement-age-label" class="text-sm font-medium">Retirement age</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="mc-retirement-age-label"
					min={RETIREMENT_AGE_SLIDER_MIN}
					max={RETIREMENT_AGE_SLIDER_MAX}
					step="1"
					bind:value={retirementAge}
					class="w-32 accent-black"
				/>
				<input
					id="mc-retirement-age"
					type="number"
					aria-labelledby="mc-retirement-age-label"
					min={MIN_AGE}
					max={MAX_AGE}
					step="1"
					bind:value={retirementAge}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="mc-target-income-label" class="text-sm font-medium">Target income (£/yr)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="mc-target-income-label"
					min="0"
					max={INCOME_SLIDER_MAX}
					step="500"
					bind:value={targetIncome}
					class="w-32 accent-black"
				/>
				<input
					id="mc-target-income"
					type="number"
					aria-labelledby="mc-target-income-label"
					min="0"
					step="500"
					bind:value={targetIncome}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="mc-contribution-label" class="text-sm font-medium">Monthly contributions (£)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="mc-contribution-label"
					min="0"
					max={CONTRIBUTION_SLIDER_MAX}
					step="25"
					bind:value={monthlyContribution}
					class="w-32 accent-black"
				/>
				<input
					id="mc-contribution"
					type="number"
					aria-labelledby="mc-contribution-label"
					min="0"
					step="25"
					bind:value={monthlyContribution}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-28"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="mc-growth-label" class="text-sm font-medium">Annual growth (%)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="mc-growth-label"
					min={GROWTH_SLIDER_MIN}
					max={GROWTH_SLIDER_MAX}
					step="0.1"
					bind:value={growthRate}
					class="w-32 accent-black"
				/>
				<input
					id="mc-growth"
					type="number"
					aria-labelledby="mc-growth-label"
					min={MIN_GROWTH_RATE}
					max={MAX_GROWTH_RATE}
					step="0.1"
					bind:value={growthRate}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="mc-volatility-label" class="text-sm font-medium">Volatility (%)</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="mc-volatility-label"
					min={MIN_VOLATILITY}
					max={VOLATILITY_SLIDER_MAX}
					step="0.5"
					bind:value={volatility}
					class="w-32 accent-black"
				/>
				<input
					id="mc-volatility"
					type="number"
					aria-labelledby="mc-volatility-label"
					min={MIN_VOLATILITY}
					max={MAX_VOLATILITY}
					step="0.5"
					bind:value={volatility}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span id="mc-target-age-label" class="text-sm font-medium">Money must last to</span>
			<div class="flex items-center gap-2">
				<input
					type="range"
					aria-labelledby="mc-target-age-label"
					min={TARGET_AGE_SLIDER_MIN}
					max={TARGET_AGE_SLIDER_MAX}
					step="1"
					bind:value={targetAge}
					class="w-32 accent-black"
				/>
				<input
					id="mc-target-age"
					type="number"
					aria-labelledby="mc-target-age-label"
					min={MIN_AGE}
					max={MAX_AGE}
					step="1"
					bind:value={targetAge}
					class="border border-input rounded-md px-2 py-1.5 text-sm w-24"
				/>
			</div>
		</div>
	</div>

	{#if readiness === 'no_dob'}
		<p class="text-sm">
			Add your date of birth on the forecast tab and this will simulate your plan — without an age
			to start counting from, a probability here would be about someone else's retirement, not
			yours.
		</p>
	{:else if readiness === 'invalid'}
		<p class="text-sm text-red-600">
			Enter ages between {MIN_AGE} and {MAX_AGE}, a volatility between {MIN_VOLATILITY}% and {MAX_VOLATILITY}%,
			a growth rate between {MIN_GROWTH_RATE}% and {MAX_GROWTH_RATE}%, and a non-negative target
			income and monthly contribution — one of the six fields above isn't one of those yet.
		</p>
	{:else if readiness === 'no_data'}
		<p class="text-sm">
			No pension pot, ISA holding or promised income recorded yet. Add a pension on the Pensions
			tab, record a monthly snapshot with an ISA holding in it, or raise the monthly contribution
			slider above, and this will simulate your plan against it.
		</p>
	{:else if summary}
		<div class="flex flex-wrap gap-3 mb-3">
			<div class="flex-1 min-w-52 rounded-md border border-border px-3 py-2">
				<div class="text-sm font-medium">
					Probability of success
					{#if recalculating}
						<span class="text-xs font-normal text-muted-foreground">(recalculating…)</span>
					{/if}
				</div>
				<div class="text-xs text-muted-foreground mb-1">
					still funded at age {summary.input.targetAge}
				</div>
				<div class="text-2xl font-semibold" class:opacity-60={recalculating}>
					{formatProbability(summary.successProbability)}
				</div>
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

		<!-- #153's fan chart, beneath the headline it is the picture of. Its own card, so it keeps the
		     visual weight of a chart rather than a footnote, and handed nothing but `summary` — every
		     series, domain and tick it draws comes off that one object. -->
		<div class="mt-4" style="margin-top: 1rem">
			<MonteCarloFanChart {summary} />
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">Running the simulation…</p>
	{/if}

	<p class="text-xs text-muted-foreground mt-4">
		Illustrative only, not financial advice. Deterministic and seeded — the same inputs always
		produce the same answer, so this figure only moves when your recorded position or the sliders
		above do. Returns are drawn independently month to month with no mean reversion, no volatility
		clustering and no correlation with inflation, so a real crash can be worse than anything
		simulated here; nothing here models asset allocation, annuitising, care costs or dying before
		the target age.
	</p>
</Card>

{#if readiness === 'ready' && summary}
	<div class="mt-4" style="margin-top: 1rem">
		<MonteCarloOutcomes {summary} />
	</div>
{/if}
