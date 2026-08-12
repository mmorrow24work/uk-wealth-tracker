/**
 * Server-rendered smoke tests for the mortgage rate rise panel (issue #158, controls in #184).
 *
 * As `PropertyTracker.test.js`/`FireCalculator.test.js` document: no browser test environment, so
 * `svelte/server`'s `render` covers the initial render only — the overlay starts `enabled = false`
 * (same as `StressTestPanel`/`IncomeShockPanel`), so what's reachable here is the property picker's
 * filtering and its fall-back-to-first pick, and the two empty states. The maths behind the impact
 * headline itself is covered directly in `$lib/mortgage-rate-rise.test.js`.
 *
 * The rate/timing/keep-term controls (#184) are dials with no prop to read their live value from,
 * the same problem `NetWorthChart`'s lens toggle had — solved the same way, an `initialXxx` prop
 * that seeds the `$state` those dials bind to, so a test can reach a changed value without a pointer
 * to drag a slider with.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { forecastScenarios } from '$lib/forecast.js';
import { createInvestment, createProperty } from '$lib/model.js';
import MortgageRateRisePanel from './MortgageRateRisePanel.svelte';

const START = { month: 1, year: 2026 };

function baseForecast() {
	return forecastScenarios({
		investments: [
			createInvestment({
				id: 'inv_a',
				name: 'Global All Cap',
				value: 10_000,
				monthly_contribution: 500
			})
		],
		start: START,
		months: 60
	});
}

const basePosition = {
	investments: [createInvestment({ id: 'inv_a', value: 10_000, monthly_contribution: 500 })],
	debts: []
};

/**
 * The rendered markup as plain text, so an assertion reads the sentence a user reads rather than
 * the tags around it.
 *
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(MortgageRateRisePanel, {
		props: { forecast: baseForecast(), position: basePosition, properties: [], ...props }
	});
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ');
}

describe('MortgageRateRisePanel', () => {
	it('says so, and points at the Property tab, when there are no properties recorded', () => {
		const body = text({ properties: [] });
		expect(body).toContain('No properties recorded yet');
		expect(body).toContain('Property tab');
		expect(body).not.toContain('Model a mortgage rate rise');
	});

	it('says so, and points at the Property tab, when no recorded property carries a mortgage', () => {
		const body = text({
			properties: [createProperty({ name: 'Mortgage-free flat', mortgage_balance: 0 })]
		});
		expect(body).toContain('None of your recorded properties carry a mortgage');
		expect(body).toContain('Property tab');
		expect(body).not.toContain('Model a mortgage rate rise');
	});

	it('filters the picker to properties that actually carry a mortgage', () => {
		const body = text({
			properties: [
				createProperty({ id: 'prop_free', name: 'Mortgage-free flat', mortgage_balance: 0 }),
				createProperty({
					id: 'prop_owed',
					name: '12 Oak Avenue',
					mortgage_balance: 180_000,
					monthly_payment: 900,
					interest_rate: 4.5
				})
			]
		});
		expect(body).toContain('Model a mortgage rate rise');
		expect(body).toContain('12 Oak Avenue');
		expect(body).not.toContain('Mortgage-free flat');
	});

	it('picks the first mortgaged property by default', () => {
		const body = text({
			properties: [
				createProperty({
					id: 'prop_a',
					name: 'First house',
					mortgage_balance: 100_000,
					monthly_payment: 700,
					interest_rate: 4
				}),
				createProperty({
					id: 'prop_b',
					name: 'Second house',
					mortgage_balance: 200_000,
					monthly_payment: 1_200,
					interest_rate: 4
				})
			]
		});
		expect(body).toContain('First house');
		expect(body).toContain('Second house');
		expect(body).toContain("Tick the box to see 6% land 1 year from now on First house's mortgage");
	});

	it('falls back to the next mortgaged property when the first has nothing owed on it', () => {
		const body = text({
			properties: [
				createProperty({ id: 'prop_a', name: 'Paid-off house', mortgage_balance: 0 }),
				createProperty({
					id: 'prop_b',
					name: 'Mortgaged house',
					mortgage_balance: 150_000,
					monthly_payment: 800,
					interest_rate: 4.5
				})
			]
		});
		expect(body).toContain(
			"Tick the box to see 6% land 1 year from now on Mortgaged house's mortgage"
		);
	});

	it('labels an unnamed property honestly rather than leaving it blank', () => {
		const body = text({
			properties: [
				createProperty({
					name: '',
					mortgage_balance: 50_000,
					monthly_payment: 400,
					interest_rate: 4
				})
			]
		});
		expect(body).toContain('Unnamed property');
	});

	it('starts with the overlay off, matching the sibling scenario panels', () => {
		const body = text({
			properties: [
				createProperty({
					name: 'A house',
					mortgage_balance: 50_000,
					monthly_payment: 400,
					interest_rate: 4
				})
			]
		});
		expect(body).toContain('Model a mortgage rate rise');
		expect(body).toContain('Tick the box to see');
	});

	const mortgagedProperty = createProperty({
		id: 'prop_owed',
		name: '12 Oak Avenue',
		mortgage_balance: 180_000,
		monthly_payment: 900,
		interest_rate: 4.5
	});

	it('reaches the headline with a changed rate, not the engine default', () => {
		const body = text({
			properties: [mortgagedProperty],
			initialEnabled: true,
			initialNewRatePct: 9
		});
		expect(body).toContain("12 Oak Avenue's mortgage moves to 9% from");
		expect(body).not.toContain('moves to 6% from');
	});

	it('rounds a "takes effect in" typed in years to whole months, and never to the anchor itself', () => {
		const body = text({
			properties: [mortgagedProperty],
			initialEnabled: true,
			// Rounds to 0 months if the panel didn't floor it at 1 — offset 0 is the anchor every
			// scenario shares, never a valid "when it lands" answer.
			initialStartYears: 0.01
		});
		// The date the change lands is January 2026 (the forecast's own anchor month) only if the
		// panel let it round down to offset 0; flooring at 1 month lands it in February instead.
		expect(body).toContain('mortgage moves to 6% from Feb 2026');
	});

	it('falls back to the engine default rather than rendering NaN when a dial is emptied', () => {
		const body = text({
			properties: [mortgagedProperty],
			initialEnabled: true,
			initialNewRatePct: '',
			initialStartYears: ''
		});
		expect(body).not.toContain('NaN');
		expect(body).toContain("12 Oak Avenue's mortgage moves to 6% from");
	});

	it('keeping the payment instead of the term leaves the payment unchanged', () => {
		const body = text({
			properties: [mortgagedProperty],
			initialEnabled: true,
			initialKeepTerm: false
		});
		expect(body).toContain('the payment stays from £900 to £900/month (+£0/month)');
	});

	it('keeping the term (the default) lets the payment rise instead', () => {
		const body = text({
			properties: [mortgagedProperty],
			initialEnabled: true,
			initialKeepTerm: true
		});
		expect(body).toContain('the payment rises from £900');
	});

	it('shows a per-scenario table row for each of the three scenarios', () => {
		const body = text({
			properties: [mortgagedProperty],
			initialEnabled: true
		});
		expect(body).toContain('Pessimistic');
		expect(body).toContain('Realistic');
		expect(body).toContain('Optimistic');
		expect(body).toContain('Extra interest');
		expect(body).toContain('At the horizon');
		expect(body).toContain('vs no change');
	});

	it('shows month-by-month comparison rows at the offsets prop, following the summary table', () => {
		const body = text({
			properties: [mortgagedProperty],
			initialEnabled: true,
			offsets: [12, 36]
		});
		expect(body).toContain('1 year');
		expect(body).toContain('3 years');
		// 24 months is not in the passed offsets, so it must not appear as a horizon row.
		expect(body).not.toContain('2 years');
	});

	it('draws two horizon bars comparing the unchanged and risen projections', () => {
		const body = text({
			properties: [mortgagedProperty],
			initialEnabled: true
		});
		expect(body).toContain('No rate change');
		expect(body).toContain('With the new rate');
	});

	it('keeping the payment shows the caveat next to the tables rather than a silent column of zeroes', () => {
		const body = text({
			properties: [mortgagedProperty],
			initialEnabled: true,
			initialKeepTerm: false
		});
		expect(body).toContain(
			"isn't this choice costing nothing, it's this forecast having no way to carry the extra interest"
		);
		expect(body).toContain('Every row matches the baseline');
		// The £0/month payment change is real and expected — the caveat is what stops it reading as
		// "this choice is free", not a claim that the figures themselves are wrong.
		expect(body).toContain('the payment stays from £900 to £900/month (+£0/month)');
	});

	it('reports the extra interest honestly rather than £0 when no finite term exists to compare', () => {
		const interestOnly = createProperty({
			id: 'prop_io',
			name: 'Interest-only flat',
			mortgage_balance: 200_000,
			// Exactly the interest on the balance at 4.5%: the payment never clears any principal, so
			// there is no finite remaining term to solve for (module convention 1/2).
			monthly_payment: (200_000 * 0.045) / 12,
			interest_rate: 4.5
		});
		const body = text({
			properties: [interestOnly],
			initialEnabled: true
		});
		expect(body).toContain('no fixed term to solve for');
	});
});
