<script>
	/**
	 * Financial Headlines dashboard card (issue #264) — the Net Worth tab's short, plain-English
	 * observations about the latest recorded month, plus the "Worth knowing" fun/educational
	 * sub-section beneath them. This component renders only; every figure and sentence comes from
	 * `$lib/headlines.js`'s {@link financialHeadlines} (deltas, FIRE progress, and — once #262 lands —
	 * its smart-insight rules, appended to the same array with no change needed here: this component
	 * renders whatever comes back without knowing which rule produced which entry) and
	 * `$lib/worth-knowing.js`'s {@link worthKnowing} (dad joke, nugget to ponder, curated resources).
	 *
	 * Props are read-only, the same convention `growthRate`/`partner` already follow on
	 * `+page.svelte`: this card never writes back to `monthlyEntries` or `profile`, it only reads them.
	 *
	 * Empty/early states, per the issue's own "don't show £0 as if it were a real recorded fact"
	 * requirement (matching `EstateSummary.svelte`'s no-monthly-entry wording): with no recorded
	 * months at all, the numeric section says so instead of rendering nothing unexplained; with
	 * exactly one recorded month, {@link monthOverMonthDeltas} has nothing to compare against yet, so
	 * that's stated plainly rather than a delta headline being silently skipped — a FIRE progress
	 * headline can still appear from a single month (it needs no comparison), so the two messages are
	 * independent rather than one replacing the other.
	 *
	 * Tone (`positive` / `negative` / `neutral`) is shown as both colour and a small `aria-hidden`
	 * glyph, matching `DebtTracker.svelte`'s D/I ratio status chip — colour is a supplement, not the
	 * only signal, and every headline's own wording already states its direction in words ("up",
	 * "down", "unchanged") independently of both.
	 */
	import { financialHeadlines, monthOverMonthDeltas } from '$lib/headlines.js';
	import { createProfile } from '$lib/model.js';
	import { worthKnowing } from '$lib/worth-knowing.js';
	import { cn } from '$lib/utils.js';
	import Card from './ui/card.svelte';

	/**
	 * @type {{
	 * 	monthlyEntries?: import('$lib/types.js').MonthlyEntry[],
	 * 	profile?: import('$lib/types.js').Profile
	 * }}
	 */
	let { monthlyEntries = [], profile = createProfile() } = $props();

	const headlines = $derived(financialHeadlines({ profile, entries: monthlyEntries }));
	const hasTwoMonths = $derived(monthOverMonthDeltas(monthlyEntries) !== null);
	const content = $derived(worthKnowing());

	/** @type {Record<'positive' | 'negative' | 'neutral', string>} */
	const TONE_CLASSES = {
		positive: 'bg-green-50 text-green-800 border-green-400',
		negative: 'bg-red-50 text-red-800 border-red-400',
		neutral: 'bg-muted text-foreground border-border'
	};

	/** @type {Record<'positive' | 'negative' | 'neutral', string>} */
	const TONE_GLYPHS = {
		positive: '▲',
		negative: '▼',
		neutral: '–'
	};

	/** @type {Record<'positive' | 'negative' | 'neutral', string>} */
	const TONE_LABELS = {
		positive: 'Positive:',
		negative: 'Negative:',
		neutral: 'Neutral:'
	};

	/** @type {Record<import('$lib/worth-knowing.js').CuratedResource['type'], string>} */
	const RESOURCE_TYPE_LABELS = {
		youtube: 'YouTube',
		website: 'Website'
	};
</script>

<Card className="p-4">
	<h2 class="text-lg font-semibold mb-1">Financial Headlines</h2>
	<p class="text-sm text-muted-foreground mb-3">
		Short, plain-English observations about your latest recorded month.
	</p>

	{#if monthlyEntries.length === 0}
		<p class="text-sm text-muted-foreground">
			No monthly snapshot recorded yet, so there's nothing to report on — add one on the Net Worth
			tab below to see your Financial Headlines.
		</p>
	{:else}
		{#if !hasTwoMonths}
			<p class="text-sm text-muted-foreground mb-3">
				Only one month is recorded so far, so there's no month-over-month change to report yet —
				record a second month to see it.
			</p>
		{/if}

		{#if headlines.length > 0}
			<ul class="flex flex-col gap-2 list-none p-0 m-0">
				{#each headlines as headline (headline.id)}
					<li
						class={cn(
							'flex items-start gap-2 rounded-md border-l-4 px-3 py-2 text-sm',
							TONE_CLASSES[headline.tone]
						)}
					>
						<span aria-hidden="true" class="mt-0.5">{TONE_GLYPHS[headline.tone]}</span>
						<span>
							<span class="sr-only">{TONE_LABELS[headline.tone]}</span>
							{headline.text}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}

	<div class="mt-5 pt-4 border-t border-border">
		<h3 class="text-sm font-semibold mb-2 text-muted-foreground">Worth knowing</h3>
		<div class="flex flex-col gap-3 text-sm">
			<p>
				<span aria-hidden="true">😄</span>
				{content.dadJoke}
			</p>
			<p class="italic text-muted-foreground">
				<span aria-hidden="true" class="not-italic">💡</span>
				{content.nugget}
			</p>
			<div>
				<h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
					Worth a read or watch
				</h4>
				<ul class="flex flex-col gap-1 list-none p-0 m-0">
					{#each content.resources as resource (resource.id)}
						<li class="text-muted-foreground">
							<a
								href={resource.url}
								target="_blank"
								rel="external noopener noreferrer"
								class="font-medium text-foreground underline underline-offset-2"
							>
								{resource.name}
							</a>
							<span class="text-xs">({RESOURCE_TYPE_LABELS[resource.type]})</span>
							— {resource.description}
						</li>
					{/each}
				</ul>
			</div>
		</div>
	</div>
</Card>
