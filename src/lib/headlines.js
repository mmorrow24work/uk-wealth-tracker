/**
 * Financial Headlines — README.md's dashboard section of short, plain-English observations about
 * the latest recorded month (issue #261, first of a four-issue milestone). The first half is the
 * calculation engine: month-over-month deltas and FIRE progress. This module (issue #262) adds the
 * second, pattern-detecting half — new holdings, concentration, milestone crossings, composition —
 * appended to the same {@link financialHeadlines} output; #264 renders the combined array as a
 * dashboard card. No UI lives here.
 *
 * Two conventions carry across every rule in this module:
 *
 * 1. **A headline is `{ id, text, tone }`.** `text` is a complete, ready-to-render sentence —
 *    plain numbers with commas, one/two decimal percentages, no jargon — so the display issue never
 *    has to assemble or word anything itself. `tone` (`'positive' | 'negative' | 'neutral'`) is
 *    supplied rather than left for the UI to re-derive from the words, so colouring a headline can't
 *    drift out of sync with what it says.
 * 2. **Arithmetic and prose are separate functions.** {@link monthOverMonthDeltas} answers "what
 *    changed, by how much" as plain numbers; the `*Headline` functions below turn one delta into a
 *    sentence. Getting the arithmetic right is the part that matters — the wording is free to change
 *    without touching a single number.
 *
 * A third convention is specific to #262's rules: **one-time events guard against re-firing, but
 * standing observations repeat.** A new holding or a milestone crossing is true for exactly one
 * month — the month it first happens — so {@link newHoldingHeadlines}/{@link milestoneHeadlines}
 * compare against *every* prior recorded month, not just the previous one, so a value that dips
 * back under a threshold and crosses it again doesn't re-announce it. A concentration or composition
 * observation, by contrast, is a fact about the latest month alone — {@link concentrationHeadline}/
 * {@link pensionCompositionHeadline} validly say the same thing for as long as it stays true.
 */

import { WRAPPER_LABELS } from './enums.js';
import { DEFAULT_WITHDRAWAL_RATE, fireNumber } from './fire.js';
import { compareMonthlyEntries } from './model.js';
import { netWorthSeries } from './net-worth.js';
import { definedContributionPot } from './retirement-income.js';

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** @param {number} amount @returns {string} Whole pounds, comma-grouped — `£100,000`, never negative. */
function formatMoney(amount) {
	return `£${Math.round(Math.abs(amount)).toLocaleString('en-GB')}`;
}

/** @param {number} value @param {number} [decimals] @returns {string} `value`, fixed to `decimals`. */
function formatPercent(value, decimals = 1) {
	return Math.abs(value).toFixed(decimals);
}

/* -------------------------------------------------------------------------- */
/* Month-over-month deltas                                                     */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} HeadlineDelta
 * @property {number} current This month's figure (£).
 * @property {number} previous Last month's figure (£).
 * @property {number} absolute `current - previous` (£).
 * @property {number} percentage `absolute` as a percentage of `previous` — `NaN` when `previous`
 *   is zero (nothing to take a percentage of).
 */

/**
 * @param {number} current
 * @param {number} previous
 * @returns {HeadlineDelta}
 */
function delta(current, previous) {
	return {
		current,
		previous,
		absolute: Math.round((current - previous) * 100) / 100 + 0,
		percentage: previous === 0 ? NaN : ((current - previous) / previous) * 100
	};
}

/**
 * Month-over-month change in net worth, investments and debts, comparing the two most recent
 * recorded months — by {@link import('./model.js').compareMonthlyEntries} (`net-worth.js`'s
 * {@link netWorthSeries} already sorts this way), not array order.
 *
 * Reuses `net-worth.js`'s own per-entry figures ({@link netWorthSeries}, which in turn calls
 * `debt.js`'s `sumInvestmentValues`/`sumDebtBalances`) rather than re-summing holdings here, so this
 * module can never disagree with the net worth chart about what a month's investments or debts add
 * up to.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {{ netWorth: HeadlineDelta, investments: HeadlineDelta, debts: HeadlineDelta } | null}
 *   `null` when fewer than two recorded months exist — nothing to compare against yet, not an error.
 */
export function monthOverMonthDeltas(entries) {
	const points = netWorthSeries(entries);
	if (points.length < 2) return null;

	const latest = points[points.length - 1];
	const previous = points[points.length - 2];

	return {
		netWorth: delta(latest.net_worth, previous.net_worth),
		investments: delta(latest.investments, previous.investments),
		debts: delta(latest.debts, previous.debts)
	};
}

/* -------------------------------------------------------------------------- */
/* Delta headlines                                                             */
/* -------------------------------------------------------------------------- */

/**
 * "Net worth up £100,000 (9.6%) this month." — the user's own example. `null` when there is
 * nothing to compare against ({@link monthOverMonthDeltas} returned `null`).
 *
 * @param {ReturnType<typeof monthOverMonthDeltas>} deltas
 * @returns {{ id: string, text: string, tone: 'positive' | 'negative' | 'neutral' } | null}
 */
export function netWorthDeltaHeadline(deltas) {
	if (!deltas) return null;
	const { absolute, percentage } = deltas.netWorth;

	if (absolute === 0) {
		return { id: 'net-worth-delta', text: 'Net worth unchanged this month.', tone: 'neutral' };
	}

	const direction = absolute > 0 ? 'up' : 'down';
	const pctClause = Number.isFinite(percentage) ? ` (${formatPercent(percentage)}%)` : '';

	return {
		id: 'net-worth-delta',
		text: `Net worth ${direction} ${formatMoney(absolute)}${pctClause} this month.`,
		tone: absolute > 0 ? 'positive' : 'negative'
	};
}

/**
 * "Investments are up £100,000 — keep stacking." — the user's own example. `null` when there is
 * nothing to compare against, or when there have never been any investments to report on (both
 * months are £0 — not a real observation, just an empty portfolio).
 *
 * @param {ReturnType<typeof monthOverMonthDeltas>} deltas
 * @returns {{ id: string, text: string, tone: 'positive' | 'negative' | 'neutral' } | null}
 */
export function investmentsDeltaHeadline(deltas) {
	if (!deltas) return null;
	const { absolute, current, previous } = deltas.investments;
	if (current === 0 && previous === 0) return null;

	if (absolute === 0) {
		return {
			id: 'investments-delta',
			text: 'Investments are unchanged this month.',
			tone: 'neutral'
		};
	}
	if (absolute > 0) {
		return {
			id: 'investments-delta',
			text: `Investments are up ${formatMoney(absolute)} — keep stacking.`,
			tone: 'positive'
		};
	}
	return {
		id: 'investments-delta',
		text: `Investments are down ${formatMoney(absolute)} — markets have off months too.`,
		tone: 'negative'
	};
}

/**
 * The debt-side counterpart to {@link investmentsDeltaHeadline}: falling debt is good news, so the
 * tone is the mirror image of the investments headline's. `null` when there is nothing to compare
 * against, or when there has never been any debt to report on (both months are £0).
 *
 * @param {ReturnType<typeof monthOverMonthDeltas>} deltas
 * @returns {{ id: string, text: string, tone: 'positive' | 'negative' | 'neutral' } | null}
 */
export function debtsDeltaHeadline(deltas) {
	if (!deltas) return null;
	const { absolute, current, previous } = deltas.debts;
	if (current === 0 && previous === 0) return null;

	if (absolute === 0) {
		return { id: 'debts-delta', text: 'Debts are unchanged this month.', tone: 'neutral' };
	}
	if (absolute < 0) {
		return {
			id: 'debts-delta',
			text: `Debts are down ${formatMoney(absolute)} — nice work paying it down.`,
			tone: 'positive'
		};
	}
	return {
		id: 'debts-delta',
		text: `Debts are up ${formatMoney(absolute)} this month.`,
		tone: 'negative'
	};
}

/* -------------------------------------------------------------------------- */
/* FIRE progress                                                               */
/* -------------------------------------------------------------------------- */

/**
 * "152.5% of the way to your £750,000 FI number — added 13.33% this month." — the user's own
 * example. The FI number is `fire.js`'s {@link fireNumber}, off `profile.retirement_target` (the
 * field the retirement tab already reads — see `retirement/+page.svelte` and `FireCalculator.svelte`
 * — not a new one invented here). The withdrawal rate that turns that target income into a pot size
 * is a per-session slider on the FIRE tab, not something persisted on `profile`, so this headline
 * falls back to `fire.js`'s {@link DEFAULT_WITHDRAWAL_RATE} unless a caller overrides it.
 *
 * `null` when there is no FI number to progress towards (`retirement_target` is `0` or unset — the
 * user hasn't set one) or no recorded month to measure progress from.
 *
 * @param {import('./types.js').Profile} profile
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @param {{ withdrawalRate?: number }} [options] `withdrawalRate` defaults to
 *   {@link DEFAULT_WITHDRAWAL_RATE}, matching the FIRE tab's own slider default.
 * @returns {{ id: string, text: string, tone: 'positive' | 'negative' | 'neutral' } | null}
 */
export function fireProgressHeadline(
	profile,
	entries,
	{ withdrawalRate = DEFAULT_WITHDRAWAL_RATE } = {}
) {
	const targetIncome = profile?.retirement_target ?? 0;
	if (!(targetIncome > 0)) return null;

	const target = fireNumber(targetIncome, withdrawalRate);
	if (!(target > 0)) return null;

	const points = netWorthSeries(entries);
	if (points.length === 0) return null;

	const latest = points[points.length - 1];
	const previous = points.length >= 2 ? points[points.length - 2] : null;

	const currentPct = (latest.net_worth / target) * 100;

	let changeClause = '.';
	let tone = /** @type {'positive' | 'negative' | 'neutral'} */ ('neutral');
	if (previous) {
		const previousPct = (previous.net_worth / target) * 100;
		const pointChange = currentPct - previousPct;
		if (pointChange > 0) {
			changeClause = ` — added ${formatPercent(pointChange, 2)}% this month.`;
			tone = 'positive';
		} else if (pointChange < 0) {
			changeClause = ` — down ${formatPercent(pointChange, 2)}% this month.`;
			tone = 'negative';
		} else {
			changeClause = ' — unchanged this month.';
		}
	}

	return {
		id: 'fire-progress',
		text: `${formatPercent(currentPct)}% of the way to your ${formatMoney(target)} FI number${changeClause}`,
		tone
	};
}

/* -------------------------------------------------------------------------- */
/* Shared helpers for the smart-insight rules                                 */
/* -------------------------------------------------------------------------- */

/**
 * The holdings the smart-insight rules below look at — every one of them, the same way: excluding
 * anything flagged `exclude_from_net_worth`, so a "new holding"/"milestone"/"concentrated"
 * observation can never be about a holding the user has explicitly said should not count (e.g. a
 * house deposit already tracked on the property tab), matching what {@link netWorthSeries} itself
 * already excludes from the totals these rules read.
 *
 * @param {readonly import('./types.js').Investment[]} investments
 * @returns {import('./types.js').Investment[]}
 */
function countedHoldings(investments) {
	return investments.filter((investment) => !investment.exclude_from_net_worth);
}

/**
 * A holding's identity across months, for rules that need to recognise "the same holding, a month
 * later". Investment `id`s are *not* stable month to month — `model.js`'s
 * {@link import('./model.js').createNextMonthlyEntry} mints a fresh `id` for every holding it
 * copies forward into a new month's snapshot — so identity here is name + wrapper instead, per the
 * issue's own description of the new-holding rule.
 *
 * @param {import('./types.js').Investment} investment
 * @returns {string}
 */
function holdingKey(investment) {
	return `${investment.name.trim().toLowerCase()}|${investment.wrapper}`;
}

/** @param {string} value @returns {string} Lowercase, dash-separated, safe inside a headline `id`. */
function slug(value) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/* -------------------------------------------------------------------------- */
/* New holdings                                                                */
/* -------------------------------------------------------------------------- */

/**
 * "New holding: AJBell at £100,000." — the user's own example. One headline per holding in the
 * latest recorded month's `investments[]` whose {@link holdingKey} (name + wrapper) was not present
 * in the previous recorded month's — a one-time event by construction, since from the following
 * month onward it stops being "not present in the previous month" for good.
 *
 * `[]` when there are fewer than two recorded months (nothing to compare the first month against —
 * every holding in it would otherwise look "new"), or when nothing new appears this month.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {{ id: string, text: string, tone: 'positive' | 'negative' | 'neutral' }[]}
 */
export function newHoldingHeadlines(entries) {
	const sorted = [...entries].sort(compareMonthlyEntries);
	if (sorted.length < 2) return [];

	const latest = sorted[sorted.length - 1];
	const previous = sorted[sorted.length - 2];
	const previousKeys = new Set(countedHoldings(previous.investments).map(holdingKey));

	return countedHoldings(latest.investments)
		.filter(
			(investment) => investment.name.trim() !== '' && !previousKeys.has(holdingKey(investment))
		)
		.map((investment) => ({
			id: `new-holding-${slug(holdingKey(investment))}`,
			text: `New holding: ${investment.name.trim()} at ${formatMoney(investment.value)}.`,
			tone: /** @type {'positive' | 'negative' | 'neutral'} */ ('neutral')
		}));
}

/* -------------------------------------------------------------------------- */
/* Concentration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Share of total counted investments, at or above which a single wrapper or holding counts as
 * "concentrated" — the issue suggests 60–70%; this picks the middle of that range.
 */
export const CONCENTRATION_THRESHOLD_PCT = 65;

/**
 * The largest group in a `holdings` list, by whatever `keyOf` groups on — and the label to show
 * for whichever group wins.
 *
 * @param {readonly import('./types.js').Investment[]} holdings
 * @param {(investment: import('./types.js').Investment) => string} keyOf
 * @param {(key: string) => string} labelOf
 * @returns {{ label: string, value: number } | null}
 */
function largestGroup(holdings, keyOf, labelOf) {
	const totals = new Map();
	for (const investment of holdings) {
		const key = keyOf(investment);
		totals.set(key, (totals.get(key) ?? 0) + investment.value);
	}

	let best = null;
	for (const [key, value] of totals) {
		if (!best || value > best.value) best = { label: labelOf(key), value };
	}
	return best;
}

/**
 * "Cash ISA is 100% of your portfolio — concentrated. Worth a diversification check." — the user's
 * own example. Checks two independent groupings of the latest recorded month's counted investments —
 * by account wrapper, and by holding name added up *across* wrappers (the same fund split between an
 * ISA and a SIPP is one concentration risk, not two small ones) — and reports whichever group makes
 * up the largest share, worded as a diversification prompt rather than an alarm, per the issue's own
 * even-keeled example. Only when that share clears {@link CONCENTRATION_THRESHOLD_PCT}. A wrapper
 * and a same-share holding tie (the ordinary case: one holding is the whole of its wrapper) resolve
 * to the wrapper, the more generally meaningful of the two labels — matching the user's own example,
 * which names the ISA rather than whatever single fund happens to sit inside it.
 *
 * `null` when there is no recorded month, no counted investment value to take a share of, or
 * nothing crosses the threshold. This is a standing observation, not a one-time event (see the
 * module doc comment) — it is expected to repeat every month it stays true.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {{ id: string, text: string, tone: 'positive' | 'negative' | 'neutral' } | null}
 */
export function concentrationHeadline(entries) {
	const sorted = [...entries].sort(compareMonthlyEntries);
	const latest = sorted[sorted.length - 1];
	if (!latest) return null;

	const holdings = countedHoldings(latest.investments);
	const total = holdings.reduce((sum, investment) => sum + investment.value, 0);
	if (total <= 0) return null;

	const byWrapper = largestGroup(
		holdings,
		(investment) => investment.wrapper,
		(wrapper) => WRAPPER_LABELS[/** @type {import('./enums.js').Wrapper} */ (wrapper)]
	);
	const byHolding = largestGroup(
		holdings.filter((investment) => investment.name.trim() !== ''),
		(investment) => investment.name.trim(),
		(name) => name
	);

	let best = byWrapper;
	if (byHolding && (!best || byHolding.value > best.value)) best = byHolding;
	if (!best) return null;

	const share = (best.value / total) * 100;
	if (share < CONCENTRATION_THRESHOLD_PCT) return null;

	return {
		id: 'concentration',
		text: `${best.label} is ${formatPercent(share, 0)}% of your portfolio — concentrated. Worth a diversification check.`,
		tone: 'neutral'
	};
}

/* -------------------------------------------------------------------------- */
/* Milestone crossings                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Round-number bands a total might cross for the first time — a 1 / 2.5 / 5 sequence, the same
 * shape `milestones.js`'s own £100k/£250k/£500k/£1M forecast pills use one order of magnitude up,
 * generalised in both directions rather than hard-coding the user's own £5,000 example as the one
 * figure this rule can ever report.
 *
 * @type {readonly number[]}
 */
export const MILESTONE_BANDS = Object.freeze([
	1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000,
	5_000_000, 10_000_000
]);

/**
 * The highest band `current` has reached that `priorMax` never had — `null` if none.
 *
 * Taking the *highest* qualifying band rather than every one of them keeps a big first recorded
 * month (say, £1.14m of investments) from reporting ten milestones at once. Taking the max of
 * *every* prior month rather than just the previous one (per the issue) is what stops a total that
 * dips back under a band and re-crosses it from re-announcing it: `priorMax` only ever grows, so
 * once a band is behind it, it stays behind it for good.
 *
 * @param {number} current
 * @param {number} priorMax `-Infinity` when there is no prior month at all — the very first
 *   recorded month is still eligible to cross a band, since "first month above £X" is true whether
 *   or not there is history to compare it against.
 * @param {readonly number[]} [bands]
 * @returns {number | null}
 */
function highestNewlyCrossedBand(current, priorMax, bands = MILESTONE_BANDS) {
	let highest = null;
	for (const band of bands) {
		if (current >= band && priorMax < band) highest = band;
	}
	return highest;
}

/**
 * "First month above £5,000 in investments. Quietly significant." — the user's own example,
 * generalised (via {@link highestNewlyCrossedBand}) across three totals: net worth, total counted
 * investments, and each individual counted holding (by {@link holdingKey}).
 *
 * `[]` when there is no recorded month, or nothing newly crosses a band this month.
 *
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {{ id: string, text: string, tone: 'positive' | 'negative' | 'neutral' }[]}
 */
export function milestoneHeadlines(entries) {
	const points = netWorthSeries(entries);
	if (points.length === 0) return [];

	const latestPoint = points[points.length - 1];
	const priorPoints = points.slice(0, -1);
	/** @type {{ id: string, text: string, tone: 'positive' | 'negative' | 'neutral' }[]} */
	const headlines = [];

	const netWorthPriorMax = priorPoints.length
		? Math.max(...priorPoints.map((point) => point.net_worth))
		: -Infinity;
	const netWorthBand = highestNewlyCrossedBand(latestPoint.net_worth, netWorthPriorMax);
	if (netWorthBand !== null) {
		headlines.push({
			id: `milestone-net-worth-${netWorthBand}`,
			text: `First month above ${formatMoney(netWorthBand)} in net worth. Quietly significant.`,
			tone: 'positive'
		});
	}

	const investmentsPriorMax = priorPoints.length
		? Math.max(...priorPoints.map((point) => point.investments))
		: -Infinity;
	const investmentsBand = highestNewlyCrossedBand(latestPoint.investments, investmentsPriorMax);
	if (investmentsBand !== null) {
		headlines.push({
			id: `milestone-investments-${investmentsBand}`,
			text: `First month above ${formatMoney(investmentsBand)} in investments. Quietly significant.`,
			tone: 'positive'
		});
	}

	const sorted = [...entries].sort(compareMonthlyEntries);
	const latestEntry = sorted[sorted.length - 1];
	const priorEntries = sorted.slice(0, -1);

	const holdingPriorMax = new Map();
	for (const entry of priorEntries) {
		for (const investment of countedHoldings(entry.investments)) {
			const key = holdingKey(investment);
			const priorMax = holdingPriorMax.get(key) ?? -Infinity;
			if (investment.value > priorMax) holdingPriorMax.set(key, investment.value);
		}
	}

	for (const investment of countedHoldings(latestEntry.investments)) {
		if (investment.name.trim() === '') continue;
		const key = holdingKey(investment);
		const priorMax = holdingPriorMax.has(key) ? holdingPriorMax.get(key) : -Infinity;
		const band = highestNewlyCrossedBand(investment.value, priorMax);
		if (band === null) continue;
		headlines.push({
			id: `milestone-holding-${slug(key)}-${band}`,
			text: `First month above ${formatMoney(band)} in ${investment.name.trim()}. Quietly significant.`,
			tone: 'positive'
		});
	}

	return headlines;
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Share of (net worth + DC pension pots) at or above which the pension share is "notable" enough to
 * report — a majority, per the issue's own example ("pensions being the majority of net worth").
 */
export const PENSION_COMPOSITION_THRESHOLD_PCT = 50;

/**
 * "Your pension is £618,017 — 54% of your net worth." — the user's own example. This app's own "net
 * worth" ({@link netWorthSeries}) is investments minus debts and, by design, never includes pensions
 * (see `report.js`'s doc comment on the same point) — so read literally, a pension can never be "N%
 * of net worth" without N being unbounded. This headline instead reports the pension pot as a share
 * of net worth *plus* the pension pot itself — the combined total the user's own wording is actually
 * describing — and keeps calling that "your net worth" since that is the phrase the user reached for.
 * Reuses `retirement-income.js`'s own {@link definedContributionPot} (DC workplace pensions and
 * SIPPs — the pots with a monetary value to report at all; DB and State pensions pay an income, not
 * a pot, so they have nothing to add here) rather than re-summing pensions in this module.
 *
 * `null` when there is no recorded month, no DC pension pot recorded, the combined total is not
 * positive, or the pension's share does not clear {@link PENSION_COMPOSITION_THRESHOLD_PCT}. Like
 * {@link concentrationHeadline}, this is a standing observation, not a one-time event.
 *
 * @param {readonly import('./types.js').Pension[]} pensions
 * @param {readonly import('./types.js').MonthlyEntry[]} entries Any order.
 * @returns {{ id: string, text: string, tone: 'positive' | 'negative' | 'neutral' } | null}
 */
export function pensionCompositionHeadline(pensions, entries) {
	const points = netWorthSeries(entries);
	if (points.length === 0) return null;

	const pensionPot = definedContributionPot(pensions);
	if (!(pensionPot > 0)) return null;

	const netWorth = points[points.length - 1].net_worth;
	const combined = netWorth + pensionPot;
	if (combined <= 0) return null;

	const share = (pensionPot / combined) * 100;
	if (share < PENSION_COMPOSITION_THRESHOLD_PCT) return null;

	return {
		id: 'pension-composition',
		text: `Your pension is ${formatMoney(pensionPot)} — ${formatPercent(share, 0)}% of your net worth.`,
		tone: 'neutral'
	};
}

/* -------------------------------------------------------------------------- */
/* Combined output                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The Financial Headlines card's full content: every rule this module knows, in a fixed order, with
 * anything that had nothing to say dropped. #264's dashboard card renders whatever comes back
 * without needing to know which rule produced which entry.
 *
 * @param {{ profile: import('./types.js').Profile, entries: readonly import('./types.js').MonthlyEntry[], pensions?: readonly import('./types.js').Pension[] }} data
 * @returns {{ id: string, text: string, tone: 'positive' | 'negative' | 'neutral' }[]}
 */
export function financialHeadlines({ profile, entries, pensions = [] }) {
	const deltas = monthOverMonthDeltas(entries);

	return [
		netWorthDeltaHeadline(deltas),
		investmentsDeltaHeadline(deltas),
		debtsDeltaHeadline(deltas),
		fireProgressHeadline(profile, entries),
		...newHoldingHeadlines(entries),
		...milestoneHeadlines(entries),
		concentrationHeadline(entries),
		pensionCompositionHeadline(pensions, entries)
	].filter((headline) => headline !== null);
}
