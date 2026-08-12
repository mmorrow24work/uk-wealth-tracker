/**
 * Financial Headlines — "Worth knowing" content (issue #263), the fun/educational half of this
 * milestone's dashboard section. #261 built the calculation engine (`headlines.js` — deltas and
 * FIRE progress) and #262 appends smart-insight rules to that same output; this module is
 * independent of both, with nothing to calculate from the household's own data. #264 renders
 * everything — `headlines.js`'s array plus this module's output — as the actual dashboard card, in
 * a small, clearly separate sub-section so a dad joke never reads as a serious observation sitting
 * next to "Net worth up £100,000". No UI lives here either.
 *
 * Three pieces:
 *
 * 1. {@link dadJokeOfTheMonth} — one line from a bank of real personal-finance puns.
 * 2. {@link nuggetToPonder} — one short, thought-provoking personal-finance idea or quote.
 * 3. {@link curatedResources} — a short, fixed list of well-regarded UK-relevant YouTube channels
 *    and websites (not rotated — a reading list doesn't need to hide most of itself each month).
 *
 * The joke and the nugget rotate once a month, deterministically off the calendar month rather than
 * randomly on every render — the same hash-a-string-to-pick-an-index trick `version.js`'s
 * `codenameForSha` uses to turn a commit SHA into a stable code name, applied here to a `YYYY-M`
 * month key instead of a SHA. Re-derived independently rather than imported from `version.js`,
 * since the two modules hash unrelated things for unrelated reasons and have no other reason to
 * depend on each other.
 */

import { currentCalendarMonth } from './forecast.js';

/* -------------------------------------------------------------------------- */
/* Content banks                                                              */
/* -------------------------------------------------------------------------- */

/** A genuinely-written bank of personal-finance puns — no filler padding a round number. */
const DAD_JOKES = [
	'Why did the ISA go to therapy? It had too much unresolved interest.',
	"I told my wallet a joke about compound interest. It's still paying it off.",
	'Why don’t bankers ever get lost? They always follow the interest rate.',
	'What do you call a pension that tells jokes? A funny fund.',
	'I invested in a broom company. Business is picking up.',
	'Why did the coin blush? Because it saw the bank’s interest.',
	'My budget and I are not on speaking terms. It keeps interrupting me.',
	'What’s a pirate’s favourite ISA? Aaaaarr-gh, tax-free treasure.',
	'I asked my accountant for a stiff drink. He gave me a spreadsheet with error bars.',
	'Why did the stock market go to the doctor? It had too many ups and downs.',
	'What do you call a financially responsible ghost? A budget-boo.',
	'I used to be a banker, but I lost interest.',
	'My pension plan is like a gym membership — I keep paying and I’ve never actually seen the results.',
	'What’s the difference between a bond and a dad joke? One matures over time, the other never does.',
	'I opened a Lifetime ISA. It’s a long-term commitment, like the gym membership I never use.',
	'Why did the mortgage break up with the house? It felt too tied down.',
	'My credit card and I have a complicated relationship — mostly complicated by 22.9% APR.',
	'Why did the pound sterling refuse to fight? It didn’t want to lose its cents.',
	'I told my financial adviser I wanted to retire early. He said, "great, aim for pension age minus one day."',
	'Why do economists make terrible detectives? They think everything comes down to supply and demand.',
	'I asked the bank for a loan to buy a thesaurus. They said my synonyms weren’t good enough collateral.',
	'Why did the pensioner bring a ladder to the bank? To reach the higher interest rates.',
	'I’ve got a great ISA joke, but it won’t mature for another 25 years.',
	'Why did the spreadsheet apply for a loan? It wanted to increase its column of credit.',
	'What do you call a stockbroker who never panics? Composed interest.',
	'I tried to save money by eating instant noodles for a year. Turns out that’s not really a Lifetime ISA strategy.',
	'My financial adviser told me to diversify. Now I own three different regrets.'
];

/** A genuinely-written bank of short, thought-provoking personal-finance ideas and quotes. */
const NUGGETS_TO_PONDER = [
	'"Do not save what is left after spending, but spend what is left after saving." — Warren Buffett. Automating the saving before you can talk yourself out of it does more for a net worth than any clever investment choice.',
	'Compound interest doesn’t feel like anything for years — then, all at once, it does. The boring middle is the whole strategy.',
	'Lifestyle inflation is the silent tax on every pay rise: spend the whole rise, and the raise never actually reaches your net worth.',
	'"An investment in knowledge pays the best interest." — Benjamin Franklin. An hour learning how tax wrappers and fees actually work tends to outperform an hour picking individual stocks.',
	'Loss aversion means losing £100 tends to hurt roughly twice as much as gaining £100 feels good — which is exactly why market dips feel so much louder than market gains.',
	'An emergency fund isn’t wasted opportunity cost sitting in cash — it’s the insurance policy that stops a broken boiler turning into a maxed-out credit card.',
	'The sunk cost fallacy keeps people holding a bad investment "until it gets back to what I paid" — the market has no idea what you paid, and neither should your next decision.',
	'Fees compound too. A 1% annual charge sounds small right up until you notice it can eat a quarter of a lifetime’s investment growth.',
	'Present bias is why "future you" always gets voted the smaller pension contribution — automating contributions takes the vote away from today’s you entirely.',
	'Diversification is the closest thing investing has to a free lunch: it doesn’t raise expected returns, it just means one bad headline can’t sink the whole plan.',
	'Anchoring: once a price sticks in your head — what you paid for a house, a stock, a car — it’s hard to judge whether today’s price is actually good or bad on its own terms.',
	'Money spent on experiences tends to age better in memory than money spent on things — worth weighing before the next big purchase.',
	'A high income paired with a higher spending habit is not wealth — it’s just a bigger number moving through the same net worth.',
	'Herd behaviour: by the time an investment is showing up in casual conversation, a lot of the easy gains have often already gone to whoever got there first.',
	'The rule of 72: divide 72 by a growth rate to estimate how many years it takes to double. At 6%, that’s 12 years — a useful gut check for any projection.',
	'Mental accounting treats a tax refund differently from a pay cheque, even though both are simply money — the label in your head shouldn’t change the decision.',
	'Inflation is a real, ongoing cost even when nothing is "happening" — cash sitting still is quietly losing purchasing power every single year.',
	'The best time to start investing was years ago. The second best time is whichever month you’re looking at this in.',
	'Debt isn’t inherently good or bad — a 2% mortgage and a 25% credit card balance are not the same decision wearing different clothes.',
	'FIRE (Financial Independence, Retire Early) isn’t really about not working — it’s about being able to say no to work you don’t want to do, on your own terms.',
	'A pay rise automated into savings before it reaches the current account tends to stick; one that lands in the current account first tends to vanish into lifestyle creep.',
	'"Wealth is what you don’t see." — Morgan Housel. The car not upgraded, the holiday not extended, sitting quietly as investments instead.',
	'Every "guaranteed" high return is either not guaranteed, not that high, or not available to you specifically — the three rarely coexist.',
	'The single biggest lever most people have over their retirement isn’t investment returns, it’s the savings rate — the gap between what’s earned and what’s spent.'
];

/**
 * @typedef {object} CuratedResource
 * @property {string} id Stable identifier, e.g. `'monevator'` — usable as a list key.
 * @property {'youtube' | 'website'} type
 * @property {string} name
 * @property {string} url
 * @property {string} description One sentence on what it’s good for.
 */

/**
 * A short, fixed list of well-regarded, UK-relevant personal finance resources — not an
 * exhaustive directory, just a sensible place to start reading/watching. Not rotated monthly like
 * the joke/nugget: a reading list is more useful shown in full than mostly hidden.
 *
 * @type {readonly CuratedResource[]}
 */
const CURATED_RESOURCES = [
	{
		id: 'monevator',
		type: 'website',
		name: 'Monevator',
		url: 'https://monevator.com',
		description:
			'Long-running UK blog on low-cost passive investing, index funds and the maths of FIRE.'
	},
	{
		id: 'moneysavingexpert',
		type: 'website',
		name: 'MoneySavingExpert',
		url: 'https://www.moneysavingexpert.com',
		description:
			"Martin Lewis's consumer site — practical UK guides on savings, credit, benefits and deals."
	},
	{
		id: 'moneyhelper',
		type: 'website',
		name: 'MoneyHelper',
		url: 'https://www.moneyhelper.org.uk',
		description:
			'Free, impartial UK government-backed guidance on pensions, savings and debt — no products sold.'
	},
	{
		id: 'damien-talks-money',
		type: 'youtube',
		name: 'Damien Talks Money',
		url: 'https://www.youtube.com/@DamienTalksMoney',
		description: 'Accessible UK-focused videos on ISAs, pensions, tax and everyday money decisions.'
	},
	{
		id: 'the-humble-penny',
		type: 'youtube',
		name: 'The Humble Penny',
		url: 'https://www.youtube.com/@TheHumblePenny',
		description:
			'UK financial independence and wealth-building content from a couple who reached it.'
	},
	{
		id: 'james-shack',
		type: 'youtube',
		name: 'James Shack',
		url: 'https://www.youtube.com/@JamesShack',
		description:
			'A UK chartered financial planner covering pensions, drawdown and retirement planning.'
	}
];

/* -------------------------------------------------------------------------- */
/* Deterministic monthly rotation                                             */
/* -------------------------------------------------------------------------- */

/**
 * FNV-1a string hash — the same algorithm `version.js`'s `codenameForSha` uses, re-derived here
 * rather than shared: not cryptographic, doesn't need to be, only needs a stable, well-distributed
 * index from a short string.
 *
 * @param {string} value
 * @returns {number}
 */
function hash(value) {
	let h = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * @param {{ month: number, year: number }} when
 * @param {string} salt Distinguishes which bank this key is for, so the joke and the nugget don't
 *   always land on the same relative index within their (differently-sized) banks in the same month.
 * @returns {string}
 */
function monthKey(when, salt) {
	return `${salt}:${when.year}-${when.month}`;
}

/**
 * @param {readonly string[]} bank
 * @param {string} salt
 * @param {{ month: number, year: number }} when
 * @returns {string}
 */
function pickForMonth(bank, salt, when) {
	return bank[hash(monthKey(when, salt)) % bank.length];
}

/**
 * This month's dad joke — stable for the whole month, a different one (deterministically) next
 * month. `when` defaults to the real current calendar month; tests pass an explicit one.
 *
 * @param {{ month: number, year: number }} [when]
 * @returns {string}
 */
export function dadJokeOfTheMonth(when = currentCalendarMonth()) {
	return pickForMonth(DAD_JOKES, 'dad-joke', when);
}

/**
 * This month's nugget to ponder — same deterministic monthly rotation as
 * {@link dadJokeOfTheMonth}, independent bank and salt so the two don't move in lockstep.
 *
 * @param {{ month: number, year: number }} [when]
 * @returns {string}
 */
export function nuggetToPonder(when = currentCalendarMonth()) {
	return pickForMonth(NUGGETS_TO_PONDER, 'nugget', when);
}

/**
 * The curated resources list, in full — see {@link CuratedResource}.
 *
 * @returns {readonly CuratedResource[]}
 */
export function curatedResources() {
	return CURATED_RESOURCES;
}

/**
 * The "Worth knowing" sub-section's full content for one month — #264's dashboard card renders
 * this alongside `headlines.js`'s numeric headlines, kept visually distinct so a joke never reads
 * as a serious financial observation.
 *
 * @param {{ month: number, year: number }} [when]
 * @returns {{ dadJoke: string, nugget: string, resources: readonly CuratedResource[] }}
 */
export function worthKnowing(when = currentCalendarMonth()) {
	return {
		dadJoke: dadJokeOfTheMonth(when),
		nugget: nuggetToPonder(when),
		resources: curatedResources()
	};
}
