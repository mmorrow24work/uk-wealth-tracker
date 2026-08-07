// place files you want to import through the `$lib` alias in this folder.

// Core data model — the shape every feature tab reads and writes.
// Types live in ./types.js (JSDoc only): `@type {import('$lib/types.js').AppData}`.
export * from './enums.js';
export * from './model.js';

// Debt-to-investment ratio — see the Net Worth dashboard's DebtTracker component.
export * from './debt.js';

// Activity log with revert support for deleted entries — see the ActivityLog component.
export * from './activity-log.js';

// Auto-invest fill — compound-growth snapshots for months the user skipped.
export * from './auto-invest.js';

// Three-scenario net worth projections — see the Forecast tab's ForecastProjections component.
export * from './forecast.js';

// Retirement age marker + net worth milestone pills — see ForecastProjections' "Milestones &
// retirement" section.
export * from './milestones.js';

// Age-range zoom/filter for the forecast summary table — see ForecastProjections' "Zoom from/to
// age" controls.
export * from './age-filter.js';

// Contributions vs growth split of a forecast — see the Forecast tab's CompoundingPanel component.
export * from './compounding.js';

// Market-crash overlay on a forecast — see the Forecast tab's StressTestPanel component.
export * from './stress-test.js';

// FIRE / Coast FIRE maths — see the Retirement tab's FireCalculator component.
export * from './fire.js';

// UK income tax bands and take-home pay (2026/27) — see the Tax tab's TaxCalculator component.
export * from './tax.js';

// GitHub Gist persistence — the only place any feature tab should read/write stored data from.
export * from './gist.js';

// Global reactive app state — the shared store every feature tab should read/write against
// instead of local component state. Hydrates from and syncs (debounced) to gist.js.
export * from './store.js';
