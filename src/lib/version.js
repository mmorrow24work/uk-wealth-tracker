/**
 * Build-version display: the short git commit SHA (injected at build time, see vite.config.js's
 * `__COMMIT_SHA__` define) plus a human-memorable two-word code name derived from it, e.g.
 * "b3a0925" -> "funky chicken". Deterministic -- the same commit always gets the same name (a
 * hash of the SHA selects from two fixed word lists) -- so there's no name registry to persist
 * or collide, and a rebuild of the same commit is reproducible. Same principle as Docker's
 * container-naming scheme.
 */

const ADJECTIVES = [
	'funky',
	'hungry',
	'dirty',
	'smelly',
	'grumpy',
	'sleepy',
	'sneaky',
	'wobbly',
	'crispy',
	'soggy',
	'spicy',
	'fluffy',
	'rusty',
	'shiny',
	'lazy',
	'jumpy',
	'silly',
	'clumsy',
	'chunky',
	'salty',
	'zesty',
	'grubby',
	'nifty',
	'wonky',
	'peppy',
	'moody',
	'plucky',
	'scruffy',
	'snazzy',
	'stroppy'
];

const NOUNS = [
	'chicken',
	'horse',
	'dog',
	'cat',
	'badger',
	'ferret',
	'otter',
	'goose',
	'hedgehog',
	'squirrel',
	'weasel',
	'pigeon',
	'llama',
	'walrus',
	'penguin',
	'donkey',
	'goat',
	'sheep',
	'duck',
	'moose',
	'beaver',
	'raccoon',
	'possum',
	'wombat',
	'seal',
	'crab',
	'newt',
	'toad',
	'gecko',
	'shrew'
];

/**
 * FNV-1a string hash. Not cryptographic -- doesn't need to be, this only needs a stable,
 * well-distributed index from a short SHA string.
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
 * The two-word code name for a given commit SHA. Deterministic: the same SHA always produces the
 * same name, and an empty/missing SHA (local dev, a build environment with no git history) still
 * resolves to a stable name rather than throwing.
 *
 * @param {string} sha
 * @returns {string}
 */
export function codenameForSha(sha) {
	const h = hash(sha || 'dev');
	const adjective = ADJECTIVES[h % ADJECTIVES.length];
	const noun = NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length];
	return `${adjective} ${noun}`;
}

/**
 * The short commit SHA this build was made from, e.g. "b3a0925" -- `__COMMIT_SHA__` is a
 * build-time string replacement (vite.config.js), not a runtime lookup, so this is a plain
 * constant rather than a function. Falls back to "dev" outside a Vite build (e.g. plain `node`).
 *
 * @type {string}
 */
export const COMMIT_SHA = typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : 'dev';

/** This build's two-word code name, derived from {@link COMMIT_SHA}. @type {string} */
export const CODENAME = codenameForSha(COMMIT_SHA);
