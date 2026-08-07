/**
 * Structural tests for the LayerChart chrome mapping in `app.css` (issue #85).
 *
 * Every failure mode this mapping can have is invisible by eye in a passing case: the app still
 * builds, the chart still draws, and the tooltip is just white-on-white or the wrong surface. So
 * this doesn't assert colours — it asserts the structural traps a previous attempt at this issue
 * hit before landing here: the cascade-layer import, the two rules being siblings rather than one
 * nested in the other, both declaring all five properties, every value going through `hsl(var())`
 * rather than a bare `H S% L%` triple, `-100`/`-300` matching within each rule (so `light-dark()`
 * picking either branch is a no-op), and the highlight point's ring being repainted at all.
 * Whether the values actually *look* right in each theme is a browser's job, not this file's.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf-8');

const CHROME_PROPERTIES = [
	'--color-primary',
	'--color-surface-content',
	'--color-surface-100',
	'--color-surface-200',
	'--color-surface-300'
];

/**
 * @param {string} selector
 * @returns {string}
 */
function ruleBody(selector) {
	const escaped = selector.replace(/[.]/g, '\\.');
	const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
	if (!match) {
		throw new Error(`no top-level rule found for selector: ${selector}`);
	}
	return match[1];
}

/**
 * @param {string} body
 * @param {string} property
 * @returns {string}
 */
function declaredValue(body, property) {
	const match = body.match(new RegExp(`${property}:\\s*([^;]+);`));
	if (!match) {
		throw new Error(`no declaration found for property: ${property}`);
	}
	return match[1].trim();
}

describe('app.css LayerChart chrome mapping', () => {
	it('imports layerchart/core.css, so the cascade-layer order is established up front', () => {
		expect(css).toMatch(/@import\s+['"]layerchart\/core\.css['"]\s*;/);
	});

	it('themes .lc-tooltip-root as its own top-level rule, not nested under .lc-root-container', () => {
		expect(css).toMatch(/(?:^|\n)\.lc-tooltip-root\s*\{/);
		expect(css).not.toMatch(/\.lc-root-container\s+\.lc-tooltip-root/);
	});

	it.each([['.lc-root-container'], ['.lc-tooltip-root']])(
		'%s declares all five chrome properties as hsl(var(--token)), not a bare triple',
		(selector) => {
			const body = ruleBody(selector);
			for (const property of CHROME_PROPERTIES) {
				expect(declaredValue(body, property)).toMatch(/^hsl\(var\(--[\w-]+\)\)$/);
			}
		}
	);

	it.each([['.lc-root-container'], ['.lc-tooltip-root']])(
		'%s sets --color-surface-300 to the same value as --color-surface-100',
		(selector) => {
			const body = ruleBody(selector);
			expect(declaredValue(body, '--color-surface-300')).toBe(
				declaredValue(body, '--color-surface-100')
			);
		}
	);

	it('repaints the crosshair highlight point ring off a themed token', () => {
		expect(css).toMatch(/\.lc-highlight-point\s*\{[^}]*--stroke-color:\s*hsl\(var\(--[\w-]+\)\)/);
	});
});
