/**
 * Live share/fund prices — issue #266, the provider-facing foundation. This app has no backend
 * (`DESIGN.md`), so any price lookup is a plain `fetch` made directly from the user's own browser;
 * the provider has to work under that constraint, not just have a nice API.
 *
 * **Provider chosen: Alpha Vantage** (`GLOBAL_QUOTE`, `https://www.alphavantage.co/query`).
 * Verified directly against the live API/docs while implementing this issue (2026-08), not assumed
 * from an earlier session's notes — see the two rejected candidates below, which is exactly why:
 *
 * - CORS: confirmed with a live request — `Access-Control-Allow-Origin: *` on every response,
 *   so no proxy is needed.
 * - Free tier: no card required, but tight — **25 requests per day**, shared across every function
 *   this module or anything else calls with the same key. That is the number issue #298's batch
 *   refresh has to pace itself against; it rules out anything but an occasional, user-triggered
 *   refresh, which matches the "manual/on-demand, never a background poll" scope for this whole
 *   feature anyway.
 * - UK coverage: Alpha Vantage's own documentation gives a London Stock Exchange example
 *   (`TSCO.LON`) right next to the US one, and that `.LON` suffix is what {@link mapTickerToQuery}
 *   translates this app's Yahoo-style `.L` suffix to.
 *
 * **Rejected: Twelve Data.** The provisional pick from an earlier, incomplete session (see #266's
 * own issue body) — re-checked here and found not to hold up. Its marketing page advertises an
 * 800-requests/day free "Basic" plan with `Access-Control-Allow-Origin: *`, which is real, but its
 * own `/exchanges` listing (`Min. individual plan` column, checked live) gates the London Stock
 * Exchange behind the paid "Grow" plan ($29/mo) — the free plan's `symbol_search` endpoint happily
 * *finds* LSE tickers, but actually pricing one 401s. Free-tier coverage is Crypto, Forex and US
 * stocks only ("3 Markets" on the pricing page). Since this app's whole reason for wanting live
 * prices is UK-listed shares/ETFs/funds, that free tier is a non-starter regardless of its CORS
 * support or its generous request budget.
 *
 * **Rejected: Financial Modeling Prep.** CORS-fine, but its current pricing page states plainly
 * that "US Coverage" itself is a Starter-plan ($22/mo) feature and "UK and Canada Coverage" needs
 * the $59/mo Premium plan — the free plan (50 calls/day) is EOD/reference data only, with no stated
 * market coverage at all. Worse fit for this app than even Twelve Data.
 *
 * **What this module does and doesn't do.** {@link isPriceFeedAvailable} is the "is there a usable
 * feed at all" check #295's button hides itself on. {@link mapTickerToQuery} turns this app's
 * ticker convention (`./types.js`'s `Investment.ticker`, Yahoo-Finance-style: `"VWRL.L"` or a bare
 * `"AAPL"`) into an Alpha Vantage symbol — only for suffixes actually verified against Alpha
 * Vantage's own docs (today, that is just `.L` for the London Stock Exchange and no suffix at all
 * for a US ticker); anything else comes back `null` rather than a guessed, possibly-wrong exchange
 * code. {@link fetchQuote} is the single-ticker lookup, and it **never throws** — issue #298 will
 * loop it over a whole portfolio and shouldn't have to wrap every call in its own try/catch.
 *
 * {@link refreshInvestmentPrices} (issue #298) is the portfolio-level layer on top: it loops
 * {@link fetchQuote} over a month's holdings, paces the requests against the free tier's budget,
 * and turns each quote into a per-holding result #295's panel can display and #300 can apply. It
 * is where `Investment.last_price` and the price→value ratio live — see its own comment.
 *
 * Not handled here, deliberately: any UI (#295/#300), and what currency unit `GLOBAL_QUOTE`
 * returns a UK price in (pounds vs pence). Alpha Vantage's response carries no currency field
 * either way, so this module passes the raw number through unlabelled — the ratio maths below is
 * specifically designed so that nothing ever has to know.
 */

const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';

/**
 * @typedef {'not-configured' | 'unrecognised-ticker' | 'rate-limited' | 'network-error' | 'unparseable-response'} PriceFeedFailureReason
 */

/**
 * @typedef {object} PriceQuoteSuccess
 * @property {true} ok
 * @property {string} ticker The ticker as passed in, e.g. "VWRL.L".
 * @property {number} price The per-share/unit price `GLOBAL_QUOTE` returned. Unit/currency is
 *   whatever Alpha Vantage used for that symbol — see this module's header comment.
 */

/**
 * @typedef {object} PriceQuoteFailure
 * @property {false} ok
 * @property {string} ticker The ticker as passed in.
 * @property {PriceFeedFailureReason} reason Machine-readable cause, for #295 to switch display on.
 * @property {string} message Human-readable reason, safe to show directly to the user.
 */

/**
 * @typedef {PriceQuoteSuccess | PriceQuoteFailure} PriceQuoteResult
 */

/**
 * The Alpha Vantage API key, if one has been configured. `VITE_`-prefixed, so — same caveat as
 * `VITE_GITHUB_TOKEN` (`.env.example`) — it is inlined into the deployed client bundle. That is a
 * smaller concern here than for the GitHub token: this key only ever reads public market quotes,
 * it cannot access or change anything of the user's, and Alpha Vantage keys are free and
 * disposable, not a credential worth protecting the way a `gist`-scoped GitHub token is.
 *
 * @returns {string | undefined}
 */
function getApiKey() {
	const value = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY;
	return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Whether a live price lookup is possible at all. False with no key configured — the one thing
 * #295's "Update prices" button needs to know before deciding whether to show itself.
 *
 * @returns {boolean}
 */
export function isPriceFeedAvailable() {
	return getApiKey() !== undefined;
}

/**
 * Translates this app's ticker convention into the Alpha Vantage symbol that actually prices it,
 * or `null` if this module doesn't know how. Only suffixes verified against Alpha Vantage's own
 * documentation are translated — everything else is an explicit "unrecognised", never a guess,
 * per this issue's own instruction: an invented exchange code would surface as a confusing
 * provider-side error instead of a clear one of our own.
 *
 * Verified today: a bare ticker (no suffix — a US symbol, Alpha Vantage's default market) and the
 * Yahoo-style `.L` suffix for the London Stock Exchange, which Alpha Vantage's own docs show as
 * `.LON` (e.g. their documented `TSCO.LON` example). Every other Yahoo suffix this app might one
 * day see (`.DE`, `.PA`, `.HK`, ...) is left unrecognised until it's checked the same way — this
 * app's stated scope is UK-listed shares/ETFs/funds, not a general international mapping.
 *
 * @param {string | null | undefined} ticker
 * @returns {string | null}
 */
export function mapTickerToQuery(ticker) {
	if (typeof ticker !== 'string') return null;
	const trimmed = ticker.trim();
	if (trimmed === '') return null;

	const lastDot = trimmed.lastIndexOf('.');
	if (lastDot === -1) {
		// No suffix at all — treat as a bare US ticker, Alpha Vantage's default market.
		return /^[A-Za-z0-9-]+$/.test(trimmed) ? trimmed.toUpperCase() : null;
	}

	const base = trimmed.slice(0, lastDot);
	const suffix = trimmed.slice(lastDot + 1).toUpperCase();
	if (base === '' || !/^[A-Za-z0-9-]+$/.test(base)) return null;

	if (suffix === 'L') return `${base.toUpperCase()}.LON`;

	return null;
}

/**
 * @param {unknown} body
 * @returns {boolean}
 */
function looksLikeRateLimitBody(body) {
	if (!body || typeof body !== 'object') return false;
	const record = /** @type {Record<string, unknown>} */ (body);
	if (typeof record.Note === 'string') return true;
	return (
		typeof record.Information === 'string' &&
		/rate limit|per (day|minute)|frequency/i.test(record.Information)
	);
}

/**
 * @param {unknown} body
 * @returns {number | null} The quoted price, or null if the body doesn't carry a usable one
 *   (Alpha Vantage's own documented behaviour for a ticker it doesn't recognise: HTTP 200 with an
 *   empty/missing `Global Quote` object rather than an error).
 */
function extractPrice(body) {
	if (!body || typeof body !== 'object') return null;
	const quote = /** @type {Record<string, unknown>} */ (body)['Global Quote'];
	if (!quote || typeof quote !== 'object' || Object.keys(quote).length === 0) return null;
	const priceText = /** @type {Record<string, unknown>} */ (quote)['05. price'];
	if (typeof priceText !== 'string') return null;
	const price = Number(priceText);
	return Number.isFinite(price) ? price : null;
}

/**
 * Looks up one ticker's current per-share/unit price. Never throws — every failure, including a
 * network error or a response this module can't parse, comes back as `{ ok: false, reason, message }`
 * instead, so #298 can loop this over a whole portfolio without wrapping each call itself.
 *
 * @param {string} ticker This app's ticker convention, e.g. "VWRL.L" or "AAPL".
 * @returns {Promise<PriceQuoteResult>}
 */
export async function fetchQuote(ticker) {
	const apiKey = getApiKey();
	if (apiKey === undefined) {
		return {
			ok: false,
			ticker,
			reason: 'not-configured',
			message: 'No price feed is configured for this app.'
		};
	}

	const symbol = mapTickerToQuery(ticker);
	if (symbol === null) {
		return {
			ok: false,
			ticker,
			reason: 'unrecognised-ticker',
			message: `"${ticker}" isn't a ticker format this app can look up prices for yet.`
		};
	}

	const url = `${ALPHA_VANTAGE_BASE_URL}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

	/** @type {Response} */
	let response;
	try {
		response = await fetch(url);
	} catch {
		return {
			ok: false,
			ticker,
			reason: 'network-error',
			message: 'Could not reach the price service — check your connection and try again.'
		};
	}

	if (!response.ok) {
		return {
			ok: false,
			ticker,
			reason: 'network-error',
			message: `The price service returned an unexpected error (HTTP ${response.status}).`
		};
	}

	/** @type {unknown} */
	let body;
	try {
		body = await response.json();
	} catch {
		return {
			ok: false,
			ticker,
			reason: 'unparseable-response',
			message: 'The price service returned a response this app could not understand.'
		};
	}

	if (looksLikeRateLimitBody(body)) {
		return {
			ok: false,
			ticker,
			reason: 'rate-limited',
			message: "The price service's request limit has been reached for now — try again later."
		};
	}

	const price = extractPrice(body);
	if (price === null) {
		return {
			ok: false,
			ticker,
			reason: 'unrecognised-ticker',
			message: `The price service didn't recognise "${ticker}".`
		};
	}

	return { ok: true, ticker, price };
}

/* -------------------------------------------------------------------------- */
/* Portfolio batch refresh — issue #298                                        */
/* -------------------------------------------------------------------------- */

/**
 * Alpha Vantage's free tier, as documented in this module's header: 25 requests per day, shared
 * across every call made with the key. Everything below is derived from this one number rather than
 * from hand-picked constants, so re-checking the provider's limit is a one-line change here.
 */
export const PRICE_FEED_REQUESTS_PER_DAY = 25;

/**
 * How long {@link refreshInvestmentPrices} waits between two requests.
 *
 * A *per-day* cap implies no useful spacing on its own — actually staying under 25/day over a full
 * day would mean one request every ~58 minutes, which is not a pause an interactive refresh can
 * take. So the pause is not doing rate-limit arithmetic; it is doing two other things. First, it
 * makes the run sequential, so each response's rate-limit signal arrives *before* the next request
 * goes out and the run can stop at the first refusal (see `rateLimited` below) instead of firing a
 * parallel burst that comes back half-rejected. Second, it keeps a large portfolio from arriving at
 * the provider as an instantaneous burst.
 *
 * The number itself is derived from the one limit the provider actually documents: spend a whole
 * day's budget and it still takes a minute, i.e. one minute ÷ 25 requests = 2,400ms.
 */
export const PRICE_REFRESH_REQUEST_INTERVAL_MS = Math.round(60_000 / PRICE_FEED_REQUESTS_PER_DAY);

/**
 * The most network requests one refresh will spend, distinct tickers counted once. A refresh that
 * spent more than the provider's entire daily budget in a single click would be guaranteed to come
 * back rate-limited anyway, would take longer than a minute of {@link PRICE_REFRESH_REQUEST_INTERVAL_MS}
 * pauses, and would leave nothing for a second attempt later in the day. Holdings past the cap come
 * back as `'failed'` with a plain explanation rather than silently missing from the results.
 */
export const PRICE_REFRESH_MAX_REQUESTS = PRICE_FEED_REQUESTS_PER_DAY;

/**
 * One holding whose value moved with its price. `value`/`price` are the two fields a caller writes
 * back onto the holding (`value` and `last_price` respectively) — this shape *is* the patch.
 *
 * @typedef {object} PriceRefreshUpdated
 * @property {'updated'} status
 * @property {string} investmentId
 * @property {string} ticker
 * @property {number} previousValue The holding's value before this refresh (£).
 * @property {number} value The value after scaling by `price / previousPrice` (£, 2dp).
 * @property {number} previousPrice The price recorded at the previous fetch.
 * @property {number} price The price quoted now.
 */

/**
 * The first-ever successful fetch for a holding: there is no earlier price to form a ratio
 * against, so the quote is recorded as a baseline and `value` is deliberately left alone. Carries
 * no `value` at all — a caller writes `price` to `last_price` and nothing else.
 *
 * @typedef {object} PriceRefreshBaseline
 * @property {'baseline'} status
 * @property {string} investmentId
 * @property {string} ticker
 * @property {number} price
 */

/**
 * A holding whose price could not be fetched. Carries neither `value` nor `price`: there is
 * nothing to write back, and nothing a caller could accidentally mistake for a fresh figure.
 *
 * @typedef {object} PriceRefreshFailed
 * @property {'failed'} status
 * @property {string} investmentId
 * @property {string} ticker
 * @property {PriceFeedFailureReason} reason
 * @property {string} message Human-readable, safe to show directly to the user.
 */

/**
 * @typedef {PriceRefreshUpdated | PriceRefreshBaseline | PriceRefreshFailed} PriceRefreshResult
 */

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function pause(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Money is stored to the penny everywhere else in this app; without this a ratio like 110/100 lands
 * a holding on 1100.0000000000001.
 *
 * @param {number} amount
 * @returns {number}
 */
function roundMoney(amount) {
	return Math.round(amount * 100) / 100;
}

/**
 * A holding is only *attempted* if it has a ticker. Anything else — a holding the user never linked
 * to a feed, or a non-object that reached here from hand-edited data — is skipped silently and gets
 * no result, since reporting a failure for it would imply a lookup that was never tried.
 *
 * @param {unknown} candidate
 * @returns {boolean}
 */
function hasTicker(candidate) {
	if (typeof candidate !== 'object' || candidate === null) return false;
	const ticker = /** @type {Record<string, unknown>} */ (candidate).ticker;
	return typeof ticker === 'string' && ticker.trim() !== '';
}

/**
 * {@link fetchQuote} is documented never to throw, and doesn't. This is the belt to that braces:
 * `refreshInvestmentPrices` promises never to throw *whatever* happens, and that promise shouldn't
 * quietly depend on another function keeping its own.
 *
 * @param {string} ticker
 * @returns {Promise<PriceQuoteResult>}
 */
async function fetchQuoteSafely(ticker) {
	try {
		return await fetchQuote(ticker);
	} catch {
		return {
			ok: false,
			ticker,
			reason: 'network-error',
			message: 'Could not reach the price service — check your connection and try again.'
		};
	}
}

/**
 * @param {import('./types.js').Investment} holding
 * @param {string} ticker
 * @param {PriceFeedFailureReason} reason
 * @param {string} message
 * @returns {PriceRefreshFailed}
 */
function failed(holding, ticker, reason, message) {
	return { status: 'failed', investmentId: holding.id, ticker, reason, message };
}

/**
 * Turns one quote into one holding's result — the whole of the value maths.
 *
 * `value` is scaled by `price / last_price` rather than recomputed from a share count, because an
 * `Investment` records a total value and has never had a share count (adding one would need the
 * holding's currency and the LSE's pence-vs-pounds quoting quirk to be right as well, and would
 * still be wrong for anything bought in instalments). A ratio needs none of that: "the price moved
 * 2%" is the same 1.02 whether the ticker quotes in pounds, pence or dollars, so a wrong guess
 * about the unit is not a mistake this code can make — it never sees a unit at all. What it costs
 * is that the *first* fetch can't move anything (there's no earlier price yet), which is exactly
 * why `'baseline'` is a separate, visible status rather than a silent no-op.
 *
 * @param {import('./types.js').Investment} holding
 * @param {string} ticker
 * @param {PriceQuoteResult} quote
 * @returns {PriceRefreshResult}
 */
function toRefreshResult(holding, ticker, quote) {
	if (!quote.ok) return failed(holding, ticker, quote.reason, quote.message);

	if (!Number.isFinite(quote.price) || quote.price <= 0) {
		// A zero or negative quote is not a price, and applying one would wipe the holding out.
		return failed(
			holding,
			ticker,
			'unparseable-response',
			`The price service quoted "${ticker}" at ${quote.price}, which can't be a real price.`
		);
	}

	const previousPrice = holding.last_price;
	if (typeof previousPrice !== 'number' || !Number.isFinite(previousPrice) || previousPrice <= 0) {
		// No usable earlier price — the first-ever fetch, or a baseline dropped by a manual edit
		// (`model.js`'s carryLastPrice). Record the quote, leave the value alone, say so plainly.
		return { status: 'baseline', investmentId: holding.id, ticker, price: quote.price };
	}

	// Normalisation and validation already guarantee a finite, non-negative value; the clamp is
	// here so that hand-edited data can never turn the ratio into NaN.
	const previousValue =
		typeof holding.value === 'number' && Number.isFinite(holding.value) && holding.value > 0
			? holding.value
			: 0;

	return {
		status: 'updated',
		investmentId: holding.id,
		ticker,
		previousValue,
		value: roundMoney((previousValue * quote.price) / previousPrice),
		previousPrice,
		price: quote.price
	};
}

/**
 * Refreshes the live price of every holding in `investments` that has a ticker, and reports what
 * happened to each one. Issue #298; #300's "Update prices" button is the caller.
 *
 * The contract, in full:
 *
 * - **Holdings with no ticker are skipped** and get no result — they were never attempted.
 * - **Exactly one result per attempted holding**, in the order given, each one `'updated'`,
 *   `'baseline'` or `'failed'`. `'failed'` carries no value or price at all, so a caller applying
 *   results field-by-field *cannot* accidentally present a stale value as freshly updated; that is
 *   the entire reason this returns a discriminated union rather than a count or a patch map.
 * - **Never throws**, whatever the feed or the network does.
 * - **Sequential, with a {@link PRICE_REFRESH_REQUEST_INTERVAL_MS} pause between requests**, so a
 *   large portfolio takes a while rather than coming back half rate-limited.
 * - **One request per distinct ticker.** The same fund held in an ISA and a GIA is two holdings but
 *   one quote — both get their own result from the one response. With 25 requests a day to spend,
 *   paying twice for the same number is not affordable.
 * - **Stops requesting at the first rate-limit refusal.** Every request after one is refused would
 *   be refused too; the remaining holdings are reported as rate-limited without spending a request
 *   or a pause on each, which also keeps the user from waiting out a minute of certain failure.
 * - **With no feed configured** (no API key — {@link isPriceFeedAvailable} is false) every ticker
 *   holding comes back `'failed'` with `'not-configured'` and nothing is requested. #295 hides its
 *   button in that case, so this is a defensive path rather than the main one, but it stays honest:
 *   the caller gets a result per holding either way, never a silent empty list.
 *
 * @param {readonly import('./types.js').Investment[]} investments A month's holdings, e.g. `entry.investments`.
 * @returns {Promise<PriceRefreshResult[]>}
 */
export async function refreshInvestmentPrices(investments) {
	const holdings = /** @type {import('./types.js').Investment[]} */ (
		(Array.isArray(investments) ? investments : []).filter(hasTicker)
	);
	if (holdings.length === 0) return [];

	if (!isPriceFeedAvailable()) {
		return holdings.map((holding) =>
			failed(
				holding,
				String(holding.ticker).trim(),
				'not-configured',
				'No price feed is configured for this app.'
			)
		);
	}

	/** Quotes already fetched this run, keyed by upper-cased ticker — successes and failures alike,
	 * since re-requesting a ticker that just failed would spend a second request to be told the same
	 * thing. @type {Map<string, PriceQuoteResult>} */
	const quotes = new Map();
	/** @type {PriceRefreshResult[]} */
	const results = [];
	let requestsSpent = 0;
	let rateLimited = false;

	for (const holding of holdings) {
		const ticker = String(holding.ticker).trim();
		const key = ticker.toUpperCase();

		let quote = quotes.get(key);
		if (quote === undefined) {
			// A ticker this app can't map to a provider symbol never reaches the network, so it costs
			// neither a request from the budget nor a pause — fetchQuote answers it locally.
			const needsRequest = mapTickerToQuery(ticker) !== null;

			if (!needsRequest) {
				quote = await fetchQuoteSafely(ticker);
			} else if (rateLimited) {
				quote = {
					ok: false,
					ticker,
					reason: 'rate-limited',
					message: "The price service's request limit has been reached for now — try again later."
				};
			} else if (requestsSpent >= PRICE_REFRESH_MAX_REQUESTS) {
				quote = {
					ok: false,
					ticker,
					reason: 'rate-limited',
					message: `One update can look up at most ${PRICE_REFRESH_MAX_REQUESTS} different tickers — that's the price service's whole allowance for a day. Try the rest tomorrow.`
				};
			} else {
				if (requestsSpent > 0) await pause(PRICE_REFRESH_REQUEST_INTERVAL_MS);
				requestsSpent += 1;
				quote = await fetchQuoteSafely(ticker);
				if (!quote.ok && quote.reason === 'rate-limited') rateLimited = true;
			}

			quotes.set(key, quote);
		}

		results.push(toRefreshResult(holding, ticker, quote));
	}

	return results;
}
