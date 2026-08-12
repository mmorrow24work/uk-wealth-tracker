/**
 * The itemised "Pension pots" row `EstateSummary.svelte` shows once `snapshot.valuation
 * .pensionsCounted` is true (issue #251) — the opposite reading of the exclusion note #224 already
 * covers in `EstateSummary.test.js`, and the row that note's own doc comment says can never both
 * render at once.
 *
 * `pensionsCounted` only turns `true` from `PENSION_IHT_TAX_YEAR` (2027/28) onward
 * (`budget-policy.js`'s convention 7), and `EstateSummary.svelte`'s own `estateSnapshot()` call never
 * passes a tax year — it is deliberately always "today", per `estate-plan.js`'s convention 1, with no
 * year-scenario picker on this tab (this issue's own scope note). That leaves no prop this file can
 * set to reach the branch under test, so — the same way `budget-policy.test.js` reaches it with an
 * explicit `startYear` argument, rather than waiting for the real calendar to cross 6 April 2027 —
 * this file mocks `budget-policy.js`'s `estateValuation` down to a thin wrapper that pins `startYear`
 * to `PENSION_IHT_TAX_YEAR` and `estateGrowthRate` to `0` whenever a caller (here, always
 * `estate-plan.js`) does not supply its own — the growth is otherwise real (`DEFAULT_BUDGET_POLICY`'s
 * 5%), and this file has no seam to pass a policy through `estateSnapshot()` either, so pinning it
 * keeps the money figures below identical to a same-inputs test at today's tax year rather than
 * requiring every assertion to carry a year of compounding. Everything else about the real
 * `estateValuation` — the wrapper breakdown, the property/asset/debt arithmetic — runs unchanged, via
 * `vi.importActual`, so these are still real valuations at a future tax year rather than a
 * stubbed-out `snapshot.valuation` object.
 */
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

import { createMonthlyEntry, createPension, createProperty } from '$lib/model.js';
import EstateSummary from './EstateSummary.svelte';

vi.mock('$lib/budget-policy.js', async () => {
	const actual = /** @type {typeof import('$lib/budget-policy.js')} */ (
		await vi.importActual('$lib/budget-policy.js')
	);
	return {
		...actual,
		estateValuation: (
			/** @type {Parameters<typeof actual.estateValuation>[0]} */ position,
			/** @type {Parameters<typeof actual.estateValuation>[1]} */ startYear,
			/** @type {Parameters<typeof actual.estateValuation>[2]} */ policy
		) =>
			actual.estateValuation(position, startYear ?? actual.PENSION_IHT_TAX_YEAR, {
				estateGrowthRate: 0,
				...policy
			})
	};
});

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(EstateSummary, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('EstateSummary — Pension pots row once pensionsCounted is true', () => {
	it('itemises the pension pots instead of excluding them, folded into the same total', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })],
			pensions: [createPension({ type: 'dc_workplace', value: 80_000 })]
		});

		// £500,000 property equity + £80,000 pension pots, nothing else recorded — the same £80,000
		// #224's exclusion-note test leaves out of the total, here folded straight into it instead.
		expect(body).toContain('Pension pots');
		expect(body).toContain('£80,000');
		expect(body).toContain('£580,000');
	});

	it('never shows the exclusion note alongside the itemised row — exactly one of the pair', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })],
			pensions: [createPension({ type: 'dc_workplace', value: 80_000 })]
		});

		expect(body).toContain('Pension pots');
		expect(body).not.toContain('left out of the total above');
		expect(body).not.toContain('6 April 2027');
	});

	it('gives a zero pension pot no row at all, even once pensionsCounted is true', () => {
		const body = text({
			monthlyEntries: [createMonthlyEntry({ month: 6, year: 2026 })],
			properties: [createProperty({ name: 'Home', value: 500_000, mortgage_balance: 0 })]
		});

		expect(body).not.toContain('Pension pots');
		expect(body).not.toContain('left out of the total above');
	});
});
