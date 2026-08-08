import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// Tailwind v4's own Vite plugin, not postcss.config.js's @tailwindcss/postcss (removed) --
	// the PostCSS route hit an ENOENT trying to resolve the bare `@import "tailwindcss"`
	// specifier under this Vite/Rolldown version, which the dedicated Vite plugin doesn't run
	// through the generic PostCSS import chain at all. Must come before sveltekit() so it sees
	// .css files first.
	plugins: [tailwindcss(), sveltekit()],

	test: {
		// Unit tests live next to the module they cover, as `*.test.js`.
		include: ['src/**/*.test.js']
	}
});
