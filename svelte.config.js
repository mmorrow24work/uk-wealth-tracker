import adapter from '@sveltejs/adapter-static';

export default {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},

	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: true
		}),
		paths: {
			// Was '/uk-wealth-tracker' for the default project-pages URL
			// (mmorrow24work.github.io/uk-wealth-tracker/). A custom domain
			// (uk-wealth-tracker.coldwire.uk) serves from the domain root, not
			// that subpath -- every asset URL would 404 under the new domain
			// if this weren't cleared.
			base: ''
		},
		alias: {
			'~': 'src'
		}
	}
};
