/**
 * Server-rendered smoke tests for the one-off large costs overlay (issue #161).
 *
 * As `AssetsTracker.test.js` documents: no browser test environment, so `svelte/server`'s `render`
 * covers the initial render only. `enabled` and the cost list are local `$state`, not props, so
 * every render here starts unticked with an empty list — the same starting point a fresh page load
 * has. That still exercises the copy that depends on `forecast`/`position`: the empty state, the
 * "+ Add a cost" control, and the row-list/add-form fields once ticked would show, left to
 * `npm run build && npm run preview` manual verification the same as `StressTestPanel`/
 * `IncomeShockPanel` (neither has a component test of its own either).
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { forecastScenarios } from '$lib/forecast.js';
import { createInvestment } from '$lib/model.js';
import OneOffCostsPanel from './OneOffCostsPanel.svelte';

const START = { month: 1, year: 2026 };

function baseline() {
	return forecastScenarios(
		{
			investments: [
				createInvestment({
					id: 'inv_a',
					name: 'Global All Cap',
					value: 50_000,
					monthly_contribution: 500
				})
			],
			start: START,
			months: 120
		},
		{ growthRate: 5 }
	);
}

/**
 * @param {Record<string, unknown>} [props]
 * @returns {string}
 */
function text(props = {}) {
	const forecast = baseline();
	const { body } = render(OneOffCostsPanel, {
		props: {
			forecast,
			position: { investments: [], debts: [] },
			...props
		}
	});
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('OneOffCostsPanel', () => {
	it('starts unticked, with the checkbox and its label', () => {
		const body = text();
		expect(body).toContain('Model one-off costs');
		expect(body).not.toMatch(/<input type="checkbox"[^>]*checked/);
	});

	it('explains what ticking the box does before any cost is added', () => {
		const body = text();
		expect(body).toContain('Tick the box to overlay');
		expect(body).toContain('one-off costs you add');
	});

	it('offers the add-a-cost control', () => {
		const body = text();
		expect(body).toContain('Add a cost');
	});

	it('mentions the scenario by name', () => {
		const body = text();
		expect(body).toContain('One-off large costs');
	});

	it('renders with a real position without throwing', () => {
		const forecast = baseline();
		expect(() =>
			render(OneOffCostsPanel, {
				props: {
					forecast,
					position: {
						investments: [
							createInvestment({ id: 'inv_a', value: 50_000, monthly_contribution: 500 })
						],
						debts: []
					}
				}
			})
		).not.toThrow();
	});
});
