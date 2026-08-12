import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig([
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: {
			// __COMMIT_SHA__ and __COMMIT_DATE__ are Vite `define` build-time string replacements
			// (vite.config.js, $lib/version.js), not real globals -- declared here so the linter
			// doesn't flag them.
			globals: {
				...globals.browser,
				...globals.node,
				__COMMIT_SHA__: 'readonly',
				__COMMIT_DATE__: 'readonly'
			}
		}
	},

	{
		files: ['**/*.svelte', '**/*.svelte.js'],
		languageOptions: { parserOptions: {} }
	},

	{
		// Override or add rule settings here, such as:
		// 'svelte/button-has-type': 'error'
		rules: {}
	}
]);
