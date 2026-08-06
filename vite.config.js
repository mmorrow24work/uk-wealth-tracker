import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],

	test: {
		// Unit tests live next to the module they cover, as `*.test.js`.
		include: ['src/**/*.test.js']
	}
});
