/**
 * Server-rendered smoke tests for the Settings tab's colour-palette picker (issue #126).
 *
 * Same approach and same limits as every other component test here: `svelte/server`'s `render`
 * gives the picker's *initial* markup, with no way to click a button or to observe the `<html>`
 * class that clicking one would swap — `$lib/palette.test.js` covers that half directly, and
 * `src/palettes.css.test.js` covers whether the colours those classes select are actually legible.
 *
 * What is worth asserting here is the wiring only this file can get wrong: that every palette
 * `$lib/palette.js` knows about is offered, and that each swatch carries its own `palette-<name>`
 * class — the swatch is not decorative markup, it is the mechanism by which a swatch renders in a
 * palette the page itself isn't in (see the component's doc comment), so losing that class would
 * silently leave eight identical swatches behind.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PALETTE, PALETTES } from '$lib/palette.js';
import PaletteSettings from './PaletteSettings.svelte';

const { body } = render(PaletteSettings);

/** The rendered markup as plain text, so an assertion reads the sentence a user reads. */
const copy = body
	.replace(/<[^>]+>/g, ' ')
	.replace(/&#39;/g, "'")
	.replace(/&amp;/g, '&')
	.replace(/\s+/g, ' ');

describe('PaletteSettings', () => {
	it('offers every palette $lib/palette.js knows about', () => {
		for (const option of PALETTES) {
			expect(copy).toContain(option.label);
		}
	});

	it('gives each palette a swatch carrying that palette’s own class', () => {
		for (const option of PALETTES) {
			expect(body).toContain(`palette-${option.value}`);
		}
	});

	it('draws the swatches from the same tokens the app itself themes with', () => {
		for (const token of ['--background', '--border', '--primary', '--chart-1', '--chart-2']) {
			expect(body).toContain(`hsl(var(${token}))`);
		}
	});

	it('names the palette in force, which before hydration is the default one', () => {
		const fallback = /** @type {(typeof PALETTES)[number]} */ (
			PALETTES.find((option) => option.value === DEFAULT_PALETTE)
		);
		expect(copy).toContain(`Palette right now: ${fallback.label} — ${fallback.description}`);
	});

	it('says the palette sits on top of light/dark rather than replacing it', () => {
		expect(copy).toContain('every palette has both a light and a dark version');
	});
});
