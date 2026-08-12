// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Build-time string replacement, not a runtime value -- see vite.config.js's `define` and
	// $lib/version.js. Declared here so svelte-check knows it exists.
	const __COMMIT_SHA__: string;
	// The commit's own timestamp (ISO 8601), not the build's wall-clock time -- see
	// vite.config.js's `commitDate()` and $lib/version.js.
	const __COMMIT_DATE__: string;
}

export {};
