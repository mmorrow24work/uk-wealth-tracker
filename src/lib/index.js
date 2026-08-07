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

// Tracked net worth history series, the forecast confidence band overlay and the chart scales
// spanning both — see the Net Worth dashboard's NetWorthChart component.
export * from './net-worth.js';

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

// Child Benefit and the High Income Child Benefit Charge (2026/27) — see the Tax tab's
// ChildBenefitCharge component.
export * from './hicbc.js';

// Marriage Allowance transfer calculation (2026/27) — see the Tax tab's MarriageAllowance
// component.
export * from './marriage-allowance.js';

// Student Loan repayments, plans 1/2/4/5/PG (2026/27) — see the Tax tab's StudentLoanRepayment
// component.
export * from './student-loan.js';

// Salary sacrifice, and what it is worth against the 60% personal allowance taper (2026/27) — see
// the Tax tab's SalarySacrifice component.
export * from './salary-sacrifice.js';

// Defined Benefit pension income from an accrual formula or a scheme statement — see the Pensions
// tab's DefinedBenefitIncome component.
export * from './defined-benefit.js';

// Pension tax relief per pot (2026/27) — see the Pensions tab's PensionTaxRelief component.
export * from './pension-relief.js';

// Dividend income planner: per-holding DRIP compounding projection vs income-phase income, split
// around an age slider — see the Dividends tab's DividendTracker/DividendIncomePlanner components.
export * from './dividends.js';

// UK dividend allowance, ISA/SIPP shelter and GIA dividend tax rates (2026/27) — see the Dividends
// tab's DividendTaxSummary component.
export * from './dividend-tax.js';

// Property equity + buy-to-let cashflow/yield — see the Property tab's PropertyTracker component.
export * from './property.js';

// Client-side XLSX export of the whole document — see the dashboard's DataExport component.
export * from './xlsx-export.js';

// Persistence. `persistence.js` is the front door — it owns `loadAppData`/`saveAppData` and which
// mode the app is in; the two backends are re-exported by name only, since all three modules
// deliberately share the same load/save function names and `export *` cannot resolve that.
export * from './persistence.js';
export { BrowserStorageError, browserStorageBackend, hasLocalStorage } from './browser-storage.js';
export {
	GistError,
	clearActiveGistId,
	connectGitHubAccount,
	describeGistTarget,
	disconnectGitHubAccount,
	gistWebUrl,
	isGistConfigured,
	normaliseGistId,
	setActiveGistId
} from './gist.js';

// GitHub sign-in for Gist mode — the token and the account it belongs to, both browser-only. See
// the connect page (`src/routes/connect/`) and its GitHubSignIn component.
export * from './github-auth.js';

// Global reactive app state — the shared store every feature tab should read/write against
// instead of local component state. Hydrates from and syncs (debounced) to persistence.js.
export * from './store.js';
