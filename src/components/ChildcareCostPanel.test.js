/**
 * Server-rendered smoke tests for the childcare cost overlay (issue #135).
 *
 * As `OneOffCostsPanel.test.js` documents: no browser test environment, so `svelte/server`'s
 * `render` covers the initial render only. `enabled` and the step list are local `$state`, not
 * props, so every render here starts unticked with an empty list — the same starting point a fresh
 * page load has. That still exercises the copy that depends on `forecast`/`position`: the empty
 * state, the "+ Add a childcare cost" control, and the row-list/add-form fields once ticked would
 * show, left to `npm run build && npm run preview` manual verification the same as
 * `StressTestPanel`/`IncomeShockPanel` (neither has a component test of its own either).
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { forecastScenarios } from '$lib/forecast.js';
import { createInvestment } from '$lib/model.js';
import ChildcareCostPanel from './ChildcareCostPanel.svelte';

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
	const { body } = render(ChildcareCostPanel, {
		props: {
			forecast,
			position: { investments: [], debts: [] },
			...props
		}
	});
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ');
}

describe('ChildcareCostPanel', () => {
	it('starts unticked, with the checkbox and its label', () => {
		const body = text();
		expect(body).toContain('Model a childcare cost');
		expect(body).not.toMatch(/<input type="checkbox"[^>]*checked/);
	});

	it('explains what ticking the box does before any step is added', () => {
		const body = text();
		expect(body).toContain('Tick the box to overlay');
		expect(body).toContain('the childcare costs you add');
	});

	it('offers the add-a-step control', () => {
		const body = text();
		expect(body).toContain('Add a childcare cost');
	});

	it('mentions the scenario by name', () => {
		const body = text();
		expect(body).toContain('Childcare cost');
	});

	it('states the means-testing non-goal up front', () => {
		const body = text();
		expect(body).toContain('Tax-Free Childcare');
		expect(body).toContain('15/30 free hours scheme');
	});

	it('renders with a real position without throwing', () => {
		const forecast = baseline();
		expect(() =>
			render(ChildcareCostPanel, {
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
