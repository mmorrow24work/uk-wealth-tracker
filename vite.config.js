import { execSync } from 'node:child_process';

import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// The footer's version display ($lib/version.js) needs the commit this build was made from.
// Reading it here (build time, via git itself) rather than at runtime keeps it a plain string
// constant with no server/API to ask -- this is a static, no-backend app, so "ask git" only
// works in an environment that actually has the .git history, which CI's checkout does. Falls
// back to empty rather than failing the build somewhere that doesn't (a tarball without .git).
function commitSha() {
	try {
		return execSync('git rev-parse --short HEAD').toString().trim();
	} catch {
		return '';
	}
}

// The footer's "updated" timestamp (issue #269) uses the commit's own timestamp, not this build's
// wall-clock time -- CI's build/deploy run can lag the commit by minutes, which would misanswer
// "when did the code last change". %cI is ISO 8601 with the commit's original timezone. Same
// fallback as commitSha() above, for the same reasons (local dev without git, a shallow clone).
function commitDate() {
	try {
		return execSync('git log -1 --format=%cI').toString().trim();
	} catch {
		return '';
	}
}

export default defineConfig({
	// Tailwind v4's own Vite plugin, not postcss.config.js's @tailwindcss/postcss (removed) --
	// the PostCSS route hit an ENOENT trying to resolve the bare `@import "tailwindcss"`
	// specifier under this Vite/Rolldown version, which the dedicated Vite plugin doesn't run
	// through the generic PostCSS import chain at all. Must come before sveltekit() so it sees
	// .css files first.
	plugins: [tailwindcss(), sveltekit()],

	// Raw text replacement at build time, not a runtime env var -- every reference to
	// __COMMIT_SHA__/__COMMIT_DATE__ in source becomes this literal string in the built output.
	define: {
		__COMMIT_SHA__: JSON.stringify(commitSha()),
		__COMMIT_DATE__: JSON.stringify(commitDate())
	},

	test: {
		// Unit tests live next to the module they cover, as `*.test.js`.
		include: ['src/**/*.test.js']
	}
});
