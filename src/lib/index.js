// place files you want to import through the `$lib` alias in this folder.

// Core data model — the shape every feature tab reads and writes.
// Types live in ./types.js (JSDoc only): `@type {import('$lib/types.js').AppData}`.
export * from './enums.js';
export * from './model.js';

// GitHub Gist persistence — the only place any feature tab should read/write stored data from.
export * from './gist.js';
