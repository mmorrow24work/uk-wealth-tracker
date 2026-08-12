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

// Childcare cost overlay on a forecast — a recurring monthly bill (flat or stepped) run against
// contribution capacity for a stated stretch of years. See the Forecast tab's ChildcareCostPanel
// component.
export * from './childcare-cost.js';

// Inheritance Tax: the £325,000 nil-rate band, the £175,000 residence nil-rate band and its
// £2,000,000 taper, spouse/civil-partner transferable allowances, and the 40% charged above them.
// The one place the codebase states those figures — see the Estate tab (`src/routes/estate/`),
// still a placeholder until #140 builds the view over this.
export * from './estate.js';

// Lifetime gifts: the 7-year countdown, the £3,000 annual exemption and its siblings, and taper
// relief on the tax where a gift has not been survived long enough. Sits on top of estate.js —
// gifts take the nil-rate band before the estate does — so it must be re-exported after it.
export * from './lifetime-gifts.js';

// Budget 2026–2031 policy changes overlay — unused pensions entering the estate for IHT from
// 6 April 2027, and the frozen nil-rate bands. An estate overlay, not a forecast one (engine only);
// the bands and the bill themselves are estate.js's, run against each year's own figures.
export * from './budget-policy.js';

// Household budget & cash flow — totals `types.js`'s Budget (categories/bills/line items), ONS
// benchmark comparison, and both partners' take-home income set against it. See the Budget tab's
// BudgetTracker/HouseholdCashFlow components. Not to be confused with budget-policy.js above,
// which is the Chancellor's Budget, not this one.
export * from './budget.js';

// Property gift-on-sale — turns a property sale's proceeds into lifetime-gifts.js Gifts, split
// between named beneficiaries, rather than an ordinary disposal. Sits on top of lifetime-gifts.js,
// so it must be re-exported after it.
export * from './property-gift-on-sale.js';

// The "if I died today" engine: values the estate from tracked data (budget-policy.js's
// estateValuation, forecast.js's positionFromEntries), folds in IhtSettings and runs it through
// lifetime-gifts.js's inheritanceTaxWithGifts, then prices named beneficiaries against the result.
// Engine only — the Estate tab's views are #166/#187/#189.
export * from './estate-plan.js';

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

// Monte Carlo retirement simulator: 5,000 log-normal market paths walked month by month, funding a
// net target income out of a pension pot and an ISA under UK tax, and counting how many still had
// money at the target age. The engine only — the Retirement tab's results UI is issue #132.
export * from './monte-carlo.js';

// Property equity + buy-to-let cashflow/yield — see the Property tab's PropertyTracker component.
export * from './property.js';

// Capital Gains Tax on a hypothetical property sale (2026/27) — the £3,000 annual exempt amount,
// the 18%/24% residential rates against tax.js's UK bands, and Private Residence Relief
// time-apportioned over the ownership period plus the final nine months. The engine only; the Tax
// tab's panel over it is the last issue in this milestone.
export * from './capital-gains.js';

// Physical asset gain/loss, CAGR, net position after holding costs and future value projection —
// see the Assets tab's AssetsTracker/AssetValueProjectionChart components.
export * from './assets.js';

// Printable report: net worth, investments, tax and pensions (DC pots + Defined Benefit income)
// sections (issues #147, #177, #195; #221 adds the State Pension and pension tax relief figures) —
// see the Report tab (`src/routes/report/`).
export * from './report.js';

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

// Bank statement CSV import (issue #267) — a generic column-mapper for a bank's own CSV export
// (Monzo, Starling, any high-street bank), turned into fresh one-off `budget.line_items`. No fixed
// header to detect, unlike csv-import.js above: the user maps columns themselves. See this
// module's own header comment for why the mapped date lands in `notes` rather than a new field.
// BankCsvImport.svelte (part of the Budget tab's BudgetTracker) is the upload/mapping/confirm UI
// built on top of it.
export * from './bank-csv-import.js';

// Live share/fund prices (issues #266 and #298) — the provider-facing foundation (is a feed
// configured at all, translating this app's Yahoo-style ticker convention (Investment.ticker,
// issue #265) into an Alpha Vantage symbol, and a single-ticker quote fetch that never throws),
// plus the portfolio-level batch refresh on top of it: one paced request per distinct ticker, one
// updated/baseline/failed result per holding, and Investment.last_price's price→value ratio maths.
// See this module's own header comment for the provider research (chosen vs rejected). Engine
// only — #295's panel displays the results and #300's "Update prices" button applies them.
export * from './price-feed.js';

// Global reactive app state — the shared store every feature tab should read/write against
// instead of local component state. Hydrates from and syncs (debounced) to persistence.js.
export * from './store.js';

// Light/dark mode toggle (issue #116) — a per-browser display preference kept in localStorage,
// deliberately outside the AppData document above. See the nav header's ThemeToggleButton and the
// Settings tab's ThemeSettings component.
export * from './theme.js';

// Named colour palettes (issue #126) — a second theming axis *under* light/dark rather than beside
// it: each palette has both variants, so this and theme.js compose rather than compete. Same
// localStorage-not-AppData persistence as theme.js above. See the Settings tab's PaletteSettings
// component, and app.css for the palettes themselves.
export * from './palette.js';

// Financial Headlines (issue #261) — month-over-month deltas and FIRE progress, the first half of
// the dashboard's auto-generated observations. #262 appends smart-insight rules to the same output;
// #264 renders the combined array. Engine only, no UI, here.
export * from './headlines.js';

// Financial Headlines: "Worth knowing" (issue #263) — the fun/educational half of the same
// dashboard section: a deterministic monthly dad joke, a nugget to ponder, and a curated list of
// UK-relevant personal finance YouTube channels/websites. Independent of headlines.js's engine;
// #264 renders both together. No UI here either.
export * from './worth-knowing.js';
