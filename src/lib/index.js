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

// Income shock (job loss / illness) overlay on a forecast — see the Forecast tab's
// IncomeShockPanel component.
export * from './income-shock.js';

// Mortgage rate rise overlay on a forecast (engine only — #158 builds the panel and wires it into
// the Forecast tab).
export * from './mortgage-rate-rise.js';

// One-off large costs overlay on a forecast (engine only — #161 builds the panel and wires it into
// the Forecast tab).
export * from './one-off-costs.js';

// Inheritance Tax: the £325,000 nil-rate band, the £175,000 residence nil-rate band and its
// £2,000,000 taper, spouse/civil-partner transferable allowances, and the 40% charged above them.
// The one place the codebase states those figures — see the Estate tab (`src/routes/estate/`),
// still a placeholder until #140 builds the view over this.
export * from './estate.js';

// Budget 2026–2031 policy changes overlay — unused pensions entering the estate for IHT from
// 6 April 2027, and the frozen nil-rate bands. An estate overlay, not a forecast one (engine only);
// the bands and the bill themselves are estate.js's, run against each year's own figures.
export * from './budget-policy.js';

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

// ISA allowance tracker across all six wrappers (2026/27) — see the Tax tab's IsaAllowanceTracker
// component.
export * from './isa.js';

// Defined Benefit pension income from an accrual formula or a scheme statement — see the Pensions
// tab's DefinedBenefitIncome component.
export * from './defined-benefit.js';

// Pension tax relief per pot (2026/27) — see the Pensions tab's PensionTaxRelief component.
export * from './pension-relief.js';

// UK State Pension from National Insurance qualifying years (2026/27) — see the Pensions tab's
// StatePensionProjection component.
export * from './state-pension.js';

// Dividend income planner: per-holding DRIP compounding projection vs income-phase income, split
// around an age slider — see the Dividends tab's DividendTracker/DividendIncomePlanner components.
export * from './dividends.js';

// UK dividend allowance, ISA/SIPP shelter and GIA dividend tax rates (2026/27) — see the Dividends
// tab's DividendTaxSummary component.
export * from './dividend-tax.js';

// Every retirement income stream in one view — Defined Benefit, annuity, SIPP drawdown, ISA
// withdrawals, GIA dividends and the State Pension — see the Pensions tab's RetirementIncomeStreams
// component. Sits below the modules above because it composes all of them.
export * from './retirement-income.js';

// Property equity + buy-to-let cashflow/yield — see the Property tab's PropertyTracker component.
export * from './property.js';

// Physical asset gain/loss, CAGR, net position after holding costs and future value projection —
// see the Assets tab's AssetsTracker/AssetValueProjectionChart components.
export * from './assets.js';

// Persistence. `persistence.js` is the front door — it owns `loadAppData`/`saveAppData` and which
// mode the app is in; the two backends are re-exported by name only, since all three modules
// deliberately share the same load/save function names and `export *` cannot resolve that.
export * from './persistence.js';
export { BrowserStorageError, browserStorageBackend, hasLocalStorage } from './browser-storage.js';
export {
	GistError,
	clearActiveGistId,
	connectGitHubAccount,
	deleteGistData,
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

// JSON export/import — the manual bridge between the two persistence modes, and a backup mechanism
// either way. See the Settings tab's DataManager component.
export * from './data-transfer.js';

// XLSX export — a real .xlsx workbook built client-side with SheetJS, read-only (JSON stays the
// only re-importable format). See the Settings tab's DataManager component.
export * from './xlsx-export.js';

// CSV export — net worth history/holdings/debts as three separate .csv files, reusing
// xlsx-export.js's row-shaping. Read-only, like XLSX. See the Settings tab's DataManager component.
export * from './csv-export.js';

// CSV import — parse/validate/merge engine for re-importing this app's own Holdings/Debts CSV
// export shape (the inverse of csv-export.js; Net Worth History stays read-only, and WealthR's own
// format is still out of scope pending a real sample file). Pure logic only; DataManager.svelte's
// file picker / confirm step is a separate piece built on top of this module's exported API.
export * from './csv-import.js';

// Global reactive app state — the shared store every feature tab should read/write against
// instead of local component state. Hydrates from and syncs (debounced) to persistence.js.
export * from './store.js';

// Light/dark mode toggle (issue #116) — a per-browser display preference kept in localStorage,
// deliberately outside the AppData document above. See the nav header's ThemeToggleButton and the
// Settings tab's ThemeSettings component.
export * from './theme.js';
