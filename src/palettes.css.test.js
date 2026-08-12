/**
 * Contrast and structural tests for the named colour palettes in `app.css` (issue #126).
 *
 * The issue's hard requirement is that *every* palette clears WCAG AA (4.5:1 for body text) against
 * its own background in both its light and dark variant, and that the chart series stay usable —
 * which is exactly the kind of thing nobody re-checks by eye when a hue gets nudged a year later.
 * So this doesn't test that the palettes exist; it recomputes their contrast from the CSS itself:
 *
 * - every foreground/background token pair the app actually renders together, at 4.5:1;
 * - every categorical chart slot at 3:1 against both surfaces it's drawn on (the page background and
 *   the card they usually sit inside), the bar the `--chart-*` comment in `app.css` sets;
 * - every *pair* of chart slots at ΔE ≥ 8 under normal vision *and* under protanope, deuteranope and
 *   tritanope simulation, so a palette whose series happen to collapse into one colour for a
 *   red-green-blind reader fails here rather than in the wild.
 *
 * Both chart checks are driven off `CHART_SERIES_COUNT` rather than a hardcoded slot list (#240), so
 * widening the palette again is a one-line change here and no slot can be added untested — with a
 * pair of structural tests below pinning the CSS's slot list to that same count in both directions.
 *
 * It also pins the three places a palette's name is written down (this CSS, `$lib/palette.js`'s
 * `PALETTES`, and `app.html`'s pre-hydration inline script) against each other, and pins the rule
 * order the light/dark layering depends on — see the block comment above the palettes in `app.css`.
 *
 * The colour maths below is the whole reason this file is self-contained rather than importing a
 * helper: it is test-only, ships in nothing, and reads better next to the thresholds it feeds.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CHART_SERIES_COUNT, PALETTES } from './lib/palette.js';

const read = (/** @type {string} */ name) =>
	readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf-8');

/** Comments stripped up front so a token name mentioned in prose can't be parsed as a rule. */
const css = read('./app.css').replace(/\/\*[\s\S]*?\*\//g, '');
const html = read('./app.html');

// ---------------------------------------------------------------------------
// CSS parsing
// ---------------------------------------------------------------------------

/** @type {{ selector: string, declarations: Record<string, string>, index: number }[]} */
const rules = [];
for (const match of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
	/** @type {Record<string, string>} */
	const declarations = {};
	for (const declaration of match[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		declarations[declaration[1]] = declaration[2].trim();
	}
	rules.push({
		selector: match[1].trim().replace(/\s*\n\s*/g, ' '),
		declarations,
		index: /** @type {number} */ (match.index)
	});
}

/**
 * @param {string} selector
 * @returns {{ selector: string, declarations: Record<string, string>, index: number }}
 */
function rule(selector) {
	const found = rules.find((candidate) => candidate.selector === selector);
	if (!found) throw new Error(`no top-level rule found for selector: ${selector}`);
	return found;
}

const DEFAULT_SELECTOR = ':root, .palette-default';
const NAMED = PALETTES.map((option) => option.value).filter((value) => value !== 'default');

/**
 * The tokens actually in force for a palette/variant combination, resolved the way a browser would:
 * the default light rule first, then (for a named palette) its light rule, then `.dark`, then the
 * palette's own dark rule — which is precisely the cascade order `app.css` lays those rules out in.
 *
 * @param {string} name
 * @param {'light' | 'dark'} variant
 * @returns {Record<string, string>}
 */
function resolveTokens(name, variant) {
	const layers = [rule(DEFAULT_SELECTOR).declarations];
	if (name !== 'default') layers.push(rule(`.palette-${name}`).declarations);
	if (variant === 'dark') {
		layers.push(rule('.dark').declarations);
		if (name !== 'default') layers.push(rule(`.dark.palette-${name}`).declarations);
	}
	return Object.assign({}, ...layers);
}

// ---------------------------------------------------------------------------
// Colour maths (sRGB / WCAG 2 relative luminance / CIELAB / dichromat simulation)
// ---------------------------------------------------------------------------

/**
 * Every token here is stored as a bare `H S% L%` triple, the form `hsl(var(--token))` expects.
 *
 * @param {string} triple
 * @returns {[number, number, number]} sRGB in 0..1
 */
function hslToRgb(triple) {
	const match = triple.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
	if (!match) throw new Error(`not an H S% L% triple: ${triple}`);
	const h = Number(match[1]) / 360;
	const s = Number(match[2]) / 100;
	const l = Number(match[3]) / 100;
	if (s === 0) return [l, l, l];
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const channel = (/** @type {number} */ t) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

const toLinear = (/** @type {number} */ c) =>
	c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toGamma = (/** @type {number} */ c) =>
	c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

/** @param {[number, number, number]} rgb */
function luminance(rgb) {
	const [r, g, b] = rgb.map(toLinear);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2 contrast ratio between two tokens.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function contrastRatio(a, b) {
	const [la, lb] = [luminance(hslToRgb(a)), luminance(hslToRgb(b))];
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Viénot/Brettel/Mollon dichromat matrices, applied to *linear* sRGB. */
const DICHROMAT_MATRICES = {
	protanope: [
		[0.152286, 1.052583, -0.204868],
		[0.114503, 0.786281, 0.099216],
		[-0.003882, -0.048116, 1.051998]
	],
	deuteranope: [
		[0.367322, 0.860646, -0.227968],
		[0.280085, 0.672501, 0.047413],
		[-0.01182, 0.04294, 0.968881]
	],
	tritanope: [
		[1.255528, -0.076749, -0.178779],
		[-0.078411, 0.930809, 0.147602],
		[0.004733, 0.691367, 0.3039]
	]
};

/**
 * @param {[number, number, number]} rgb
 * @param {number[][]} matrix
 * @returns {[number, number, number]}
 */
function simulate(rgb, matrix) {
	const [r, g, b] = rgb.map(toLinear);
	return /** @type {[number, number, number]} */ (
		matrix.map((row) => Math.min(1, Math.max(0, toGamma(row[0] * r + row[1] * g + row[2] * b))))
	);
}

/**
 * @param {[number, number, number]} rgb
 * @returns {[number, number, number]} CIELAB, D65
 */
function rgbToLab(rgb) {
	const [r, g, b] = rgb.map(toLinear);
	const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
	const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
	const f = (/** @type {number} */ t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
	const [fx, fy, fz] = [f(x), f(y), f(z)];
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 */
function deltaE76(a, b) {
	const [la, lb] = [rgbToLab(a), rgbToLab(b)];
	return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/**
 * How far apart two series colours stay for the reader who can least tell them apart — normal
 * vision and all three dichromacies, worst case wins.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function worstCaseSeparation(a, b) {
	const [ra, rb] = [hslToRgb(a), hslToRgb(b)];
	return Math.min(
		deltaE76(ra, rb),
		...Object.values(DICHROMAT_MATRICES).map((matrix) =>
			deltaE76(simulate(ra, matrix), simulate(rb, matrix))
		)
	);
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Foreground/background token pairs the app renders together; each must clear WCAG AA. */
const TEXT_PAIRS = [
	['--foreground', '--background'],
	['--card-foreground', '--card'],
	['--popover-foreground', '--popover'],
	['--muted-foreground', '--background'],
	['--muted-foreground', '--card'],
	['--muted-foreground', '--muted'],
	['--primary-foreground', '--primary'],
	['--secondary-foreground', '--secondary'],
	['--accent-foreground', '--accent'],
	['--destructive-foreground', '--destructive']
];

/**
 * The categorical chart slots, driven off `CHART_SERIES_COUNT` rather than listed by hand: a sixth
 * slot then costs one constant bump in `$lib/palette.js` plus the CSS, and cannot be added without
 * these tests covering it.
 */
const CHART_SLOTS = Array.from(
	{ length: CHART_SERIES_COUNT },
	(_, index) => `--chart-${index + 1}`
);

/** The two surfaces a series is ever drawn on — the page, and the card charts usually sit inside. */
const CHART_SURFACES = ['--background', '--card'];

/** Series colours are graphical objects, not text, so the bar is 3:1 rather than 4.5:1. */
const CHART_PAIRS = CHART_SLOTS.flatMap((slot) => CHART_SURFACES.map((surface) => [slot, surface]));

/** Every unordered pair of slots — 10 of them at five slots, all of which must stay apart. */
const CHART_SLOT_PAIRS = CHART_SLOTS.flatMap((a, index) =>
	CHART_SLOTS.slice(index + 1).map((b) => [a, b])
);

/** @type {[string, 'light' | 'dark'][]} */
const COMBINATIONS = PALETTES.flatMap((option) => [
	/** @type {[string, 'light']} */ ([option.value, 'light']),
	/** @type {[string, 'dark']} */ ([option.value, 'dark'])
]);

describe('palette contrast', () => {
	it.each(COMBINATIONS)('%s/%s clears WCAG AA (4.5:1) on every text pair', (name, variant) => {
		const tokens = resolveTokens(name, variant);
		for (const [foreground, background] of TEXT_PAIRS) {
			const ratio = contrastRatio(tokens[foreground], tokens[background]);
			expect(
				ratio,
				`${foreground} (${tokens[foreground]}) on ${background} (${tokens[background]})`
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it.each(COMBINATIONS)(
		'%s/%s keeps every chart series at 3:1 on both surfaces',
		(name, variant) => {
			const tokens = resolveTokens(name, variant);
			for (const [series, surface] of CHART_PAIRS) {
				const ratio = contrastRatio(tokens[series], tokens[surface]);
				expect(
					ratio,
					`${series} (${tokens[series]}) on ${surface} (${tokens[surface]})`
				).toBeGreaterThanOrEqual(3);
			}
		}
	);

	it.each(COMBINATIONS)(
		'%s/%s keeps every pair of chart series apart under CVD',
		(name, variant) => {
			const tokens = resolveTokens(name, variant);
			for (const [a, b] of CHART_SLOT_PAIRS) {
				expect(
					worstCaseSeparation(tokens[a], tokens[b]),
					`${a} (${tokens[a]}) vs ${b} (${tokens[b]})`
				).toBeGreaterThanOrEqual(8);
			}
		}
	);
});

describe('chart slots', () => {
	it('declares every slot $lib/palette.js hands out, in every theme variant', () => {
		for (const [name, variant] of COMBINATIONS) {
			const tokens = resolveTokens(name, variant);
			for (const slot of CHART_SLOTS) {
				expect(tokens[slot], `${name}/${variant} is missing ${slot}`).toBeDefined();
			}
		}
	});

	it('declares no slot beyond the count, so a CSS-only slot can never go untested', () => {
		const declared = new Set(
			rules.flatMap((candidate) =>
				Object.keys(candidate.declarations).filter((token) => /^--chart-\d+$/.test(token))
			)
		);
		expect([...declared].sort()).toEqual([...CHART_SLOTS].sort());
	});
});

describe('palette structure', () => {
	it('declares a light and a dark rule for every named palette', () => {
		for (const name of NAMED) {
			expect(() => rule(`.palette-${name}`)).not.toThrow();
			expect(() => rule(`.dark.palette-${name}`)).not.toThrow();
		}
	});

	it('gives the default palette a class of its own, so Settings can swatch it', () => {
		expect(rule(DEFAULT_SELECTOR).selector).toBe(DEFAULT_SELECTOR);
	});

	it.each(NAMED)('%s restates the full colour token set in both variants', (name) => {
		// `--destructive`/`--destructive-foreground` are deliberately inherited, not restated: red
		// means danger in every palette.
		const expected = Object.keys(rule(DEFAULT_SELECTOR).declarations)
			.filter((token) => !token.startsWith('--destructive'))
			.sort();
		expect(Object.keys(rule(`.palette-${name}`).declarations).sort()).toEqual(expected);
		expect(Object.keys(rule(`.dark.palette-${name}`).declarations).sort()).toEqual(expected);
	});

	it.each(NAMED)(
		'%s orders its rules so light/dark layering survives equal specificity',
		(name) => {
			// `.palette-x` and `.dark` both weigh 0-1-0, so the light rule has to come first or it
			// would repaint a dark page; `.dark.palette-x` weighs 0-2-0 and wins wherever it sits, but
			// is kept after `.dark` so the file reads in cascade order.
			expect(rule(`.palette-${name}`).index).toBeLessThan(rule('.dark').index);
			expect(rule('.dark').index).toBeLessThan(rule(`.dark.palette-${name}`).index);
		}
	);
});

describe('palette name lists', () => {
	it('app.html’s pre-hydration script knows exactly the palettes $lib/palette.js does', () => {
		const match = html.match(/var palettes = \[([^\]]*)\];/);
		expect(match, 'no palette name list found in app.html').not.toBeNull();
		const names = /** @type {RegExpMatchArray} */ (match)[1]
			.split(',')
			.map((entry) => entry.trim().replace(/^'|'$/g, ''))
			.filter(Boolean);
		expect(names).toEqual(NAMED);
	});

	it('app.html reads the same localStorage key $lib/palette.js writes', async () => {
		const { PALETTE_STORAGE_KEY } = await import('./lib/palette.js');
		expect(html).toContain(`localStorage.getItem('${PALETTE_STORAGE_KEY}')`);
	});

	it('app.html builds the same class names $lib/palette.js applies', () => {
		expect(html).toContain("classList.add('palette-' + palette)");
	});
});
