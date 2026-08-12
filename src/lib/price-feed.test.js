import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInvestment } from './model.js';
import {
	PRICE_REFRESH_MAX_REQUESTS,
	PRICE_REFRESH_REQUEST_INTERVAL_MS,
	fetchQuote,
	isPriceFeedAvailable,
	mapTickerToQuery,
	refreshInvestmentPrices
} from './price-feed.js';

/**
 * @param {unknown} body
 * @param {{ ok?: boolean, status?: number }} [overrides]
 */
function jsonResponse(body, { ok = true, status = 200 } = {}) {
	return { ok, status, json: async () => body };
}

/** A realistic `GLOBAL_QUOTE` success body, the shape Alpha Vantage's docs show. */
function quoteBody(price = '123.45') {
	return {
		'Global Quote': {
			'01. symbol': 'AAPL',
			'05. price': price,
			'07. latest trading day': '2026-08-11'
		}
	};
}

/** @type {import('vitest').Mock} */
let fetchMock;

beforeEach(() => {
	vi.unstubAllEnvs();
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('isPriceFeedAvailable', () => {
	it('is false with no API key configured', () => {
		expect(isPriceFeedAvailable()).toBe(false);
	});

	it('is true once an API key is configured', () => {
		vi.stubEnv('VITE_ALPHA_VANTAGE_API_KEY', 'test-key');
		expect(isPriceFeedAvailable()).toBe(true);
	});

	it('is false for an empty-string key, same as unset', () => {
		vi.stubEnv('VITE_ALPHA_VANTAGE_API_KEY', '');
		expect(isPriceFeedAvailable()).toBe(false);
	});
});

describe('mapTickerToQuery', () => {
	it('passes a bare US ticker through unchanged, upper-cased', () => {
		expect(mapTickerToQuery('aapl')).toBe('AAPL');
		expect(mapTickerToQuery('AAPL')).toBe('AAPL');
	});

	it('translates the Yahoo-style ".L" suffix to Alpha Vantage\'s ".LON"', () => {
		expect(mapTickerToQuery('VWRL.L')).toBe('VWRL.LON');
		expect(mapTickerToQuery('vod.l')).toBe('VOD.LON');
	});

	it('rejects an unverified suffix rather than guessing at it', () => {
		expect(mapTickerToQuery('SAP.DE')).toBeNull();
		expect(mapTickerToQuery('MC.PA')).toBeNull();
		expect(mapTickerToQuery('0700.HK')).toBeNull();
	});

	it('rejects null, undefined, empty and malformed tickers', () => {
		expect(mapTickerToQuery(null)).toBeNull();
		expect(mapTickerToQuery(undefined)).toBeNull();
		expect(mapTickerToQuery('')).toBeNull();
		expect(mapTickerToQuery('   ')).toBeNull();
		expect(mapTickerToQuery('.L')).toBeNull();
		expect(mapTickerToQuery('VWRL.')).toBeNull();
		expect(mapTickerToQuery('VW RL.L')).toBeNull();
	});
});

describe('fetchQuote', () => {
	it('fails with "not-configured" and never calls fetch when no API key is set', async () => {
		const result = await fetchQuote('AAPL');
		expect(result).toEqual({
			ok: false,
			ticker: 'AAPL',
			reason: 'not-configured',
			message: expect.any(String)
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	describe('with an API key configured', () => {
		beforeEach(() => {
			vi.stubEnv('VITE_ALPHA_VANTAGE_API_KEY', 'test-key');
		});

		it('fails with "unrecognised-ticker" and never calls fetch for an unmapped ticker', async () => {
			const result = await fetchQuote('SAP.DE');
			expect(result).toEqual({
				ok: false,
				ticker: 'SAP.DE',
				reason: 'unrecognised-ticker',
				message: expect.any(String)
			});
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('returns the price on a successful lookup', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('304.90')));

			const result = await fetchQuote('AAPL');

			expect(result).toEqual({ ok: true, ticker: 'AAPL', price: 304.9 });
		});

		it('requests the mapped ".LON" symbol for a ".L" ticker, with the key in the query string', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('25.10')));

			await fetchQuote('VWRL.L');

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url] = fetchMock.mock.calls[0];
			expect(url).toContain('function=GLOBAL_QUOTE');
			expect(url).toContain('symbol=VWRL.LON');
			expect(url).toContain('apikey=test-key');
		});

		it('fails with "unrecognised-ticker" when the API returns an empty Global Quote', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ 'Global Quote': {} }));

			const result = await fetchQuote('ZZZZ');

			expect(result).toEqual({
				ok: false,
				ticker: 'ZZZZ',
				reason: 'unrecognised-ticker',
				message: expect.any(String)
			});
		});

		it('fails with "unrecognised-ticker" when the API returns no Global Quote at all', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({}));

			const result = await fetchQuote('ZZZZ');

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe('unrecognised-ticker');
		});

		it('fails with "rate-limited" when the response carries a legacy "Note" field', async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse({
					Note: 'Thank you for using Alpha Vantage! Our standard API call frequency is 25 requests per day.'
				})
			);

			const result = await fetchQuote('AAPL');

			expect(result).toEqual({
				ok: false,
				ticker: 'AAPL',
				reason: 'rate-limited',
				message: expect.any(String)
			});
		});

		it('fails with "rate-limited" when the response carries an "Information" rate-limit message', async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse({
					Information:
						'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day.'
				})
			);

			const result = await fetchQuote('AAPL');

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe('rate-limited');
		});

		it('does not treat an unrelated "Information" message as a rate limit', async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse({ Information: 'The demo API key is for demo purposes only.' })
			);

			const result = await fetchQuote('AAPL');

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe('unrecognised-ticker');
		});

		it('fails with "network-error" when fetch rejects', async () => {
			fetchMock.mockRejectedValueOnce(new Error('network down'));

			const result = await fetchQuote('AAPL');

			expect(result).toEqual({
				ok: false,
				ticker: 'AAPL',
				reason: 'network-error',
				message: expect.any(String)
			});
		});

		it('fails with "network-error" on a non-OK HTTP status', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 503 }));

			const result = await fetchQuote('AAPL');

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe('network-error');
			expect(result.message).toContain('503');
		});

		it('fails with "unparseable-response" when the body is not valid JSON', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => {
					throw new SyntaxError('Unexpected token in JSON');
				}
			});

			const result = await fetchQuote('AAPL');

			expect(result).toEqual({
				ok: false,
				ticker: 'AAPL',
				reason: 'unparseable-response',
				message: expect.any(String)
			});
		});

		it('never throws, even when fetch throws something unexpected', async () => {
			fetchMock.mockRejectedValueOnce('not an Error instance');

			await expect(fetchQuote('AAPL')).resolves.toMatchObject({
				ok: false,
				reason: 'network-error'
			});
		});
	});
});

describe('refreshInvestmentPrices', () => {
	/** @param {Partial<import('./types.js').Investment>} overrides */
	function holding(overrides) {
		return createInvestment(overrides);
	}

	/**
	 * Drives a whole refresh to completion. The module paces its requests with `setTimeout`, so under
	 * fake timers those pauses have to be advanced through rather than waited out — the budget here
	 * is a full capped run's worth of intervals, more than any test below needs.
	 *
	 * @param {import('./types.js').Investment[]} investments
	 */
	async function runRefresh(investments) {
		const promise = refreshInvestmentPrices(investments);
		await vi.advanceTimersByTimeAsync(
			PRICE_REFRESH_REQUEST_INTERVAL_MS * (PRICE_REFRESH_MAX_REQUESTS + 2)
		);
		return promise;
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns nothing at all for a portfolio with no tickers, and never calls fetch', async () => {
		vi.stubEnv('VITE_ALPHA_VANTAGE_API_KEY', 'test-key');

		const results = await runRefresh([holding({ name: 'Cash' }), holding({ ticker: '   ' })]);

		expect(results).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('fails every ticker holding with "not-configured" when no API key is set', async () => {
		const results = await runRefresh([
			holding({ id: 'inv_a', ticker: 'AAPL' }),
			holding({ id: 'inv_b', name: 'Cash' })
		]);

		expect(results).toEqual([
			{
				status: 'failed',
				investmentId: 'inv_a',
				ticker: 'AAPL',
				reason: 'not-configured',
				message: expect.any(String)
			}
		]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('never throws, whatever it is handed', async () => {
		vi.stubEnv('VITE_ALPHA_VANTAGE_API_KEY', 'test-key');
		const anything = /** @type {any} */ (undefined);

		await expect(refreshInvestmentPrices(anything)).resolves.toEqual([]);
		await expect(refreshInvestmentPrices(/** @type {any} */ (null))).resolves.toEqual([]);
		await expect(
			refreshInvestmentPrices(/** @type {any} */ ([null, 42, 'nope', {}, { ticker: null }]))
		).resolves.toEqual([]);
	});

	describe('with an API key configured', () => {
		beforeEach(() => {
			vi.stubEnv('VITE_ALPHA_VANTAGE_API_KEY', 'test-key');
		});

		it('records a baseline without touching the value on the first-ever fetch', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('104.50')));

			const results = await runRefresh([
				holding({ id: 'inv_a', ticker: 'VWRL.L', value: 5_000, last_price: null })
			]);

			expect(results).toEqual([
				{ status: 'baseline', investmentId: 'inv_a', ticker: 'VWRL.L', price: 104.5 }
			]);
			// Deliberately carries no value: a baseline must not read as a refresh that moved money.
			expect(results[0]).not.toHaveProperty('value');
		});

		it('treats a zero or negative recorded baseline as no baseline at all', async () => {
			fetchMock.mockResolvedValue(jsonResponse(quoteBody('104.50')));

			const results = await runRefresh([
				holding({ id: 'inv_a', ticker: 'VWRL.L', value: 5_000, last_price: 0 }),
				holding({ id: 'inv_b', ticker: 'VUSA.L', value: 5_000, last_price: -3 })
			]);

			expect(results.map((result) => result.status)).toEqual(['baseline', 'baseline']);
		});

		it('scales the value by the price ratio once a baseline exists', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('110.00')));

			const results = await runRefresh([
				holding({ id: 'inv_a', ticker: 'AAPL', value: 5_000, last_price: 100 })
			]);

			expect(results).toEqual([
				{
					status: 'updated',
					investmentId: 'inv_a',
					ticker: 'AAPL',
					previousValue: 5_000,
					value: 5_500,
					previousPrice: 100,
					price: 110
				}
			]);
		});

		it('scales a fall as readily as a rise, and rounds the new value to the penny', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('2.97')));
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('3.01')));

			const [fallen, risen] = await runRefresh([
				holding({ id: 'inv_a', ticker: 'AAPL', value: 1_000, last_price: 3 }),
				holding({ id: 'inv_b', ticker: 'MSFT', value: 1_000, last_price: 3 })
			]);

			// 1000 × 2.97/3 and 1000 × 3.01/3 — the latter is 1003.3333... before rounding.
			expect(fallen).toMatchObject({ status: 'updated', value: 990 });
			expect(risen).toMatchObject({ status: 'updated', value: 1_003.33 });
		});

		it('is unit-blind: the same percentage move scales the same in pence or pounds', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('255.00')));
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('2.55')));

			const [pence, pounds] = await runRefresh([
				holding({ id: 'inv_a', ticker: 'TSCO.L', value: 4_000, last_price: 250 }),
				holding({ id: 'inv_b', ticker: 'VOD.L', value: 4_000, last_price: 2.5 })
			]);

			expect(pence).toMatchObject({ value: 4_080 });
			expect(pounds).toMatchObject({ value: 4_080 });
		});

		it('returns exactly one result per attempted holding, in order, skipping the untickered', async () => {
			fetchMock.mockResolvedValue(jsonResponse(quoteBody('10.00')));

			const results = await runRefresh([
				holding({ id: 'inv_a', ticker: 'AAPL', value: 100, last_price: 5 }),
				holding({ id: 'inv_cash', name: 'Cash' }),
				holding({ id: 'inv_b', ticker: 'MSFT', value: 200 })
			]);

			expect(results.map((result) => result.investmentId)).toEqual(['inv_a', 'inv_b']);
			expect(results.map((result) => result.status)).toEqual(['updated', 'baseline']);
		});

		it('reports a failed holding with a reason and message, and no value or price to apply', async () => {
			fetchMock.mockRejectedValueOnce(new Error('network down'));

			const results = await runRefresh([
				holding({ id: 'inv_a', ticker: 'AAPL', value: 5_000, last_price: 100 })
			]);

			expect(results).toEqual([
				{
					status: 'failed',
					investmentId: 'inv_a',
					ticker: 'AAPL',
					reason: 'network-error',
					message: expect.any(String)
				}
			]);
			// The honesty requirement, asserted structurally: there is nothing here a caller could
			// write back onto the holding, so a stale value cannot be made to look freshly updated.
			expect(results[0]).not.toHaveProperty('value');
			expect(results[0]).not.toHaveProperty('price');
		});

		it('fails a holding whose quote is not a real price rather than wiping its value out', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('0.00')));

			const results = await runRefresh([
				holding({ id: 'inv_a', ticker: 'AAPL', value: 5_000, last_price: 100 })
			]);

			expect(results[0]).toMatchObject({ status: 'failed', reason: 'unparseable-response' });
			expect(results[0]).not.toHaveProperty('value');
		});

		it('reports an unmappable ticker as failed without spending a request on it', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('10.00')));

			const results = await runRefresh([
				holding({ id: 'inv_a', ticker: 'SAP.DE', value: 5_000, last_price: 100 }),
				holding({ id: 'inv_b', ticker: 'AAPL', value: 5_000, last_price: 5 })
			]);

			expect(results[0]).toMatchObject({ status: 'failed', reason: 'unrecognised-ticker' });
			expect(results[1]).toMatchObject({ status: 'updated', value: 10_000 });
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('carries on after one holding fails, updating the ones that worked', async () => {
			fetchMock.mockRejectedValueOnce(new Error('network down'));
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('120.00')));

			const results = await runRefresh([
				holding({ id: 'inv_a', ticker: 'AAPL', value: 5_000, last_price: 100 }),
				holding({ id: 'inv_b', ticker: 'MSFT', value: 5_000, last_price: 100 })
			]);

			expect(results.map((result) => result.status)).toEqual(['failed', 'updated']);
			expect(results[1]).toMatchObject({ value: 6_000 });
		});

		it('spends one request per distinct ticker, however many holdings share it', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('110.00')));

			const results = await runRefresh([
				holding({ id: 'inv_isa', ticker: 'VWRL.L', value: 5_000, last_price: 100 }),
				holding({ id: 'inv_gia', ticker: 'vwrl.l', value: 2_000, last_price: 100 })
			]);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(results.map((result) => result.investmentId)).toEqual(['inv_isa', 'inv_gia']);
			expect(results[0]).toMatchObject({ status: 'updated', value: 5_500 });
			expect(results[1]).toMatchObject({ status: 'updated', value: 2_200 });
		});

		it('paces requests one interval apart rather than firing them in parallel', async () => {
			fetchMock.mockResolvedValue(jsonResponse(quoteBody('10.00')));

			const promise = refreshInvestmentPrices([
				holding({ ticker: 'AAPL' }),
				holding({ ticker: 'MSFT' }),
				holding({ ticker: 'TSCO.L' })
			]);

			await vi.advanceTimersByTimeAsync(0);
			expect(fetchMock).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(PRICE_REFRESH_REQUEST_INTERVAL_MS - 10);
			expect(fetchMock).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(10);
			expect(fetchMock).toHaveBeenCalledTimes(2);

			await vi.advanceTimersByTimeAsync(PRICE_REFRESH_REQUEST_INTERVAL_MS);
			expect(fetchMock).toHaveBeenCalledTimes(3);

			await expect(promise).resolves.toHaveLength(3);
		});

		it('stops requesting once the feed says it is rate limited, and reports the rest as such', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(quoteBody('110.00')));
			fetchMock.mockResolvedValueOnce(
				jsonResponse({ Note: 'Our standard API call frequency is 25 requests per day.' })
			);

			const results = await runRefresh([
				holding({ id: 'inv_a', ticker: 'AAPL', value: 5_000, last_price: 100 }),
				holding({ id: 'inv_b', ticker: 'MSFT', value: 5_000, last_price: 100 }),
				holding({ id: 'inv_c', ticker: 'TSCO.L', value: 5_000, last_price: 100 }),
				holding({ id: 'inv_d', ticker: 'VOD.L', value: 5_000, last_price: 100 })
			]);

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(results.map((result) => result.status)).toEqual([
				'updated',
				'failed',
				'failed',
				'failed'
			]);
			for (const result of results.slice(1)) {
				expect(result).toMatchObject({ status: 'failed', reason: 'rate-limited' });
			}
		});

		it("never spends more than the provider's daily allowance in one refresh", async () => {
			fetchMock.mockResolvedValue(jsonResponse(quoteBody('10.00')));
			const holdings = Array.from({ length: PRICE_REFRESH_MAX_REQUESTS + 2 }, (_, index) =>
				holding({ id: `inv_${index}`, ticker: `T${index}`, value: 100, last_price: 5 })
			);

			const results = await runRefresh(holdings);

			expect(fetchMock).toHaveBeenCalledTimes(PRICE_REFRESH_MAX_REQUESTS);
			// Still one result each — the ones past the cap say why rather than going missing.
			expect(results).toHaveLength(PRICE_REFRESH_MAX_REQUESTS + 2);
			expect(results.slice(-2)).toEqual([
				expect.objectContaining({ status: 'failed', reason: 'rate-limited' }),
				expect.objectContaining({ status: 'failed', reason: 'rate-limited' })
			]);
		});

		it('never throws when the feed misbehaves mid-portfolio', async () => {
			fetchMock.mockRejectedValueOnce('not an Error instance');
			fetchMock.mockResolvedValueOnce(jsonResponse({ 'Global Quote': {} }));
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => {
					throw new SyntaxError('Unexpected token in JSON');
				}
			});

			const results = await runRefresh([
				holding({ id: 'inv_a', ticker: 'AAPL', value: 1, last_price: 1 }),
				holding({ id: 'inv_b', ticker: 'MSFT', value: 1, last_price: 1 }),
				holding({ id: 'inv_c', ticker: 'TSCO.L', value: 1, last_price: 1 })
			]);

			expect(results.map((result) => result.status)).toEqual(['failed', 'failed', 'failed']);
			expect(results.map((result) => /** @type {any} */ (result).reason)).toEqual([
				'network-error',
				'unrecognised-ticker',
				'unparseable-response'
			]);
		});
	});
});
