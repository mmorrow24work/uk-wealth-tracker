/**
 * Server-rendered smoke tests for the price refresh feedback panel (issue #295).
 *
 * Same approach and same limits as `InvestmentGuidance.test.js`: `svelte/server`'s `render` gives
 * the panel's markup as first sent to the browser, which is enough to assert every state this
 * purely presentational component can be in — it holds no internal state of its own, only derived
 * values over the `results`/`holdingNames` props, so there is nothing interactive left untested.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import PriceRefreshResults from './PriceRefreshResults.svelte';

/** @param {*} props
 * @returns {string} */
function text(props = {}) {
	const { body } = render(PriceRefreshResults, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#38;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ');
}

describe('PriceRefreshResults', () => {
	it('shows an empty state when there are no results', () => {
		const body = text({ results: [] });

		expect(body).toContain('No results yet');
	});

	it('shows an empty state when the results prop is omitted entirely', () => {
		const body = text({});

		expect(body).toContain('No results yet');
	});

	it('summarises the run by status counts', () => {
		const body = text({
			results: [
				{
					status: 'updated',
					investmentId: 'inv-1',
					ticker: 'VWRL.L',
					previousValue: 1000,
					value: 1100,
					previousPrice: 90,
					price: 99
				},
				{
					status: 'baseline',
					investmentId: 'inv-2',
					ticker: 'AAPL',
					price: 210.5
				},
				{
					status: 'failed',
					investmentId: 'inv-3',
					ticker: 'ZZZZ.L',
					reason: 'unrecognised-ticker',
					message: 'The price service didn\'t recognise "ZZZZ.L".'
				}
			]
		});

		expect(body).toContain("1 updated, 1 baseline, 1 couldn't be fetched");
	});

	it("shows an updated holding's previous and new value, and that it increased", () => {
		const body = text({
			results: [
				{
					status: 'updated',
					investmentId: 'inv-1',
					ticker: 'VWRL.L',
					previousValue: 1000,
					value: 1100,
					previousPrice: 90,
					price: 99
				}
			],
			holdingNames: { 'inv-1': 'Vanguard FTSE Global All Cap' }
		});

		expect(body).toContain('Vanguard FTSE Global All Cap');
		expect(body).toContain('£1,000.00');
		expect(body).toContain('£1,100.00');
		expect(body).toContain('+£100.00');
		expect(body).toContain('90');
		expect(body).toContain('99');
	});

	it('shows an updated holding whose value fell, with a negative change', () => {
		const body = text({
			results: [
				{
					status: 'updated',
					investmentId: 'inv-1',
					ticker: 'VWRL.L',
					previousValue: 1000,
					value: 900,
					previousPrice: 90,
					price: 81
				}
			]
		});

		expect(body).toContain('-£100.00');
	});

	it('falls back to the ticker as the holding label when no name is given', () => {
		const body = text({
			results: [
				{
					status: 'updated',
					investmentId: 'inv-1',
					ticker: 'VWRL.L',
					previousValue: 1000,
					value: 1100,
					previousPrice: 90,
					price: 99
				}
			],
			holdingNames: {}
		});

		expect(body).toContain('VWRL.L');
	});

	it('presents a baseline result as a first price recorded, not a changed value', () => {
		const body = text({
			results: [
				{
					status: 'baseline',
					investmentId: 'inv-2',
					ticker: 'AAPL',
					price: 210.5
				}
			],
			holdingNames: { 'inv-2': 'Apple Inc.' }
		});

		expect(body).toContain('Apple Inc.');
		expect(body).toContain('Price recorded, value unchanged');
		expect(body).toContain('210.5');
		expect(body).not.toContain('→ £');
	});

	it("shows a failed result's human-readable message, never a value or price", () => {
		const message = 'The price service returned an unexpected error (HTTP 500).';
		const body = text({
			results: [
				{
					status: 'failed',
					investmentId: 'inv-3',
					ticker: 'ZZZZ.L',
					reason: 'network-error',
					message
				}
			],
			holdingNames: { 'inv-3': 'Some Fund' }
		});

		expect(body).toContain('Some Fund');
		expect(body).toContain(message);
		expect(body).toContain("Couldn't fetch a price");
	});

	it('never shows a failed holding as updated, even alongside successful results', () => {
		const body = text({
			results: [
				{
					status: 'updated',
					investmentId: 'inv-1',
					ticker: 'VWRL.L',
					previousValue: 1000,
					value: 1100,
					previousPrice: 90,
					price: 99
				},
				{
					status: 'failed',
					investmentId: 'inv-3',
					ticker: 'ZZZZ.L',
					reason: 'rate-limited',
					message: "The price service's request limit has been reached for now — try again later."
				}
			]
		});

		expect(body).toContain('ZZZZ.L');
		expect(body).toContain("Couldn't fetch a price");
		expect(body).not.toContain('ZZZZ.L: ');
	});
});
