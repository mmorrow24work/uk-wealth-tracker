/**
 * Core data model for uk-wealth-tracker.
 *
 * This is the single JSON document persisted to the private GitHub Gist (see `lib/gist.js`) and
 * held in memory by `lib/store.js` — every feature tab reads and writes against this shape
 * rather than storing anything of its own. Field names follow README.md's "Data Model" outline
 * verbatim; see `lib/model.js` for factories, normalisation and validation.
 *
 * This module contains JSDoc typedefs only — it emits no runtime code. Import types with
 * `@type {import('$lib/types.js').AppData}`.
 *
 * Conventions used throughout:
 * - **Money** is a plain number in major currency units (pounds, not pence). `1234.56` is
 *   £1,234.56. Not rounded on write; formatting is a presentation concern.
 * - **Percentages** are whole-number percents, not fractions: `5` means 5%, `0.35` means 0.35%.
 *   Applies to every `*_pct`, `*_rate`, `yield_pct`, `fund_fee`, `expected_growth` field.
 * - **Dates** are ISO `YYYY-MM-DD` strings. Months are 1-based (`1` = January).
 * - **`null` means "not recorded"**; `0` means "recorded as zero". Optional numeric inputs the
 *   user may legitimately leave blank are nullable, so forecasts can tell the two apart.
 * - **`id`** is an opaque unique string within its own collection (see `createId`).
 *
 * @module
 */

/** @typedef {import('./enums.js').JourneyStage} JourneyStage */
/** @typedef {import('./enums.js').TaxRegion} TaxRegion */
/** @typedef {import('./enums.js').Currency} Currency */
/** @typedef {import('./enums.js').InvestmentType} InvestmentType */
/** @typedef {import('./enums.js').Wrapper} Wrapper */
/** @typedef {import('./enums.js').DebtType} DebtType */
/** @typedef {import('./enums.js').ContributionFrequency} ContributionFrequency */
/** @typedef {import('./enums.js').PayoutFrequency} PayoutFrequency */
/** @typedef {import('./enums.js').BillFrequency} BillFrequency */
/** @typedef {import('./enums.js').PensionType} PensionType */
/** @typedef {import('./enums.js').PropertyType} PropertyType */
/** @typedef {import('./enums.js').MortgageType} MortgageType */
/** @typedef {import('./enums.js').AssetCategory} AssetCategory */
/** @typedef {import('./enums.js').DividendStrategy} DividendStrategy */
/** @typedef {import('./enums.js').MilestoneType} MilestoneType */
/** @typedef {import('./enums.js').ActivityLogEntityType} ActivityLogEntityType */
/** @typedef {import('./enums.js').ActivityLogAction} ActivityLogAction */

/**
 * The user and their headline planning assumptions. One profile per document — partner/household
 * planning is a Phase 2 feature and will extend this rather than duplicate it.
 *
 * @typedef {object} Profile
 * @property {string} name Display name. May be empty.
 * @property {number | null} dob_month Birth month, 1–12. Only month/year are stored: enough for
 *   age-based projections, less personal data than a full date of birth.
 * @property {number | null} dob_year Birth year, four digits.
 * @property {JourneyStage} journey_stage Where the user is in their wealth journey.
 * @property {number} monthly_contribution Default total monthly saving used by forecasts (£).
 * @property {number} growth_rate Assumed nominal annual investment growth (%).
 * @property {number} retirement_age Target retirement age in years.
 * @property {number} retirement_target Target annual retirement income (£/yr) — the figure the
 *   FIRE "magic number" (25×) is derived from.
 * @property {number} inflation_rate Assumed annual inflation (%), for real-terms projections.
 * @property {Currency} currency Reporting currency.
 * @property {TaxRegion} tax_region Income tax regime the user is resident in.
 * @property {number} gross_salary Gross annual employment income (£/yr).
 * @property {number} pension_pct Own pension contribution as a percentage of salary (%).
 */

/**
 * A single investment holding as recorded in one monthly snapshot. Holdings are re-stated each
 * month rather than mutated, so history is immutable and month-on-month change is a simple diff.
 *
 * @typedef {object} Investment
 * @property {string} id Stable across months for the same holding — that is what makes a holding
 *   trackable over time.
 * @property {string} name Holding name, e.g. "Vanguard FTSE Global All Cap".
 * @property {InvestmentType} type What kind of holding it is.
 * @property {Wrapper} wrapper Account wrapper it is held in (drives tax treatment).
 * @property {number} value Value at this month end (£).
 * @property {number | null} bought_for Total purchase cost (£), for gain/loss. Null if unknown.
 * @property {number | null} year_purchased Four-digit year of purchase. Null if unknown.
 * @property {number} monthly_contribution Amount paid in per `contribution_frequency` period (£).
 *   Named `monthly_contribution` per README.md even though the frequency is configurable.
 * @property {ContributionFrequency} contribution_frequency How often that amount is paid in.
 * @property {number} fund_fee Annual fund fee / OCF (%).
 * @property {string} notes Free text.
 * @property {boolean} exclude_from_net_worth Keep the holding tracked but out of the net worth
 *   total (e.g. property already counted via the property tab).
 * @property {number} ownership_pct Share of the holding the user owns (%). 100 unless part-owned.
 */

/**
 * A debt as recorded in one monthly snapshot. Balances are positive numbers; the sign is applied
 * when netting off, not stored.
 *
 * @typedef {object} Debt
 * @property {string} id Stable across months for the same debt.
 * @property {string} name Debt name, e.g. "Halifax mortgage".
 * @property {DebtType} type Debt category — `mortgage` is what the mortgage toggle keys off.
 * @property {number} balance Outstanding balance owed (£, positive).
 * @property {string} notes Free text.
 * @property {boolean} exclude_from_net_worth Exclude from the net worth total — the mortgage
 *   toggle sets this when property equity is already tracked on the property tab.
 */

/**
 * One month's snapshot of everything owned and owed. The net worth series is built from these.
 *
 * @typedef {object} MonthlyEntry
 * @property {string} id Stable key for the entry (not in README.md's outline; see PR notes).
 * @property {number} month Month of the snapshot, 1–12.
 * @property {number} year Four-digit year of the snapshot.
 * @property {Investment[]} investments Holdings at this month end.
 * @property {Debt[]} debts Debts at this month end.
 * @property {boolean} auto_filled True when the snapshot was generated to bridge a month the user
 *   skipped (`lib/auto-invest.js`) rather than recorded by hand. Not in README.md's outline; added
 *   so projected months stay visibly distinct from real ones and can be recomputed at will.
 */

/**
 * A pension pot. Which fields matter depends on `type`: DC pots use `value`/`contribution_pct`/
 * `employer_pct`/`fund_fee`, DB pots use the `db_*` fields, and the State Pension uses the `ni_*`
 * fields. Fields that do not apply stay `null` rather than being omitted, so the shape is stable.
 *
 * @typedef {object} Pension
 * @property {string} id
 * @property {string} name Scheme or provider name.
 * @property {PensionType} type
 * @property {number} value Current pot value (£). Zero for DB and State pensions, which have no
 *   pot — their income comes from the accrual and NI fields instead.
 * @property {number} contribution_pct Own contribution as a percentage of salary (%).
 * @property {number} employer_pct Employer contribution as a percentage of salary (%).
 * @property {number} fund_fee Annual fund fee / OCF (%).
 * @property {number | null} db_accrual_rate DB accrual as a percentage of salary per year of
 *   service (%): a 1/60th scheme is `1.6667`, a 1/80th scheme is `1.25`.
 * @property {number | null} db_years Years of pensionable service accrued.
 * @property {number | null} db_salary Pensionable salary the accrual applies to (£/yr).
 * @property {number | null} db_annual_income Scheme income taken directly from a statement
 *   (£/yr). When set it wins over the accrual calculation — README.md offers both routes.
 * @property {number | null} ni_qualifying_years National Insurance years already earned (35 gives
 *   the full State Pension in 2026/27).
 * @property {number | null} ni_future_years Further NI years expected before State Pension age.
 */

/**
 * A property. `include_in_net_worth` is positive (include) whereas investments and debts use a
 * negative `exclude_from_net_worth` — both spellings come straight from README.md's outline.
 *
 * @typedef {object} Property
 * @property {string} id
 * @property {string} name
 * @property {PropertyType} type
 * @property {number} value Current market value (£).
 * @property {number} mortgage_balance Outstanding mortgage (£, positive). Equity is
 *   `value - mortgage_balance`.
 * @property {number} monthly_payment Monthly mortgage payment (£).
 * @property {number} interest_rate Mortgage interest rate (%).
 * @property {MortgageType} mortgage_type
 * @property {string | null} deal_expiry Fixed/tracker deal end date, ISO `YYYY-MM-DD`. Drives the
 *   expiry reminder (amber within 90 days, red once past).
 * @property {number} rental_income Gross rent received (£/month). Buy-to-let and holiday lets.
 * @property {number} running_costs Running costs (£/month), excluding the mortgage payment —
 *   `monthly_payment` above already covers that. Net cashflow (`$lib/property.js`) is
 *   `rental_income - running_costs - monthly_payment`, all three combined.
 * @property {number} growth_rate Assumed annual capital growth (%), for the equity projection.
 * @property {boolean} include_in_net_worth Whether equity counts towards net worth.
 */

/**
 * A physical asset (watch, painting, classic car, case of wine, gold).
 *
 * @typedef {object} Asset
 * @property {string} id
 * @property {string} name
 * @property {AssetCategory} category
 * @property {number} purchase_price What was paid (£).
 * @property {number} current_value What it is worth now (£).
 * @property {string | null} purchase_date ISO `YYYY-MM-DD`. Needed for annualised CAGR.
 * @property {number} expected_growth Expected annual change in value (%). May be negative for
 *   depreciating assets.
 * @property {number} holding_cost Annual cost of ownership (£/yr) — insurance, storage, servicing.
 * @property {boolean} include_in_net_worth Whether the asset counts towards net worth.
 */

/**
 * An income-producing holding in the dividend planner. Kept separate from `Investment` because
 * the planner models yield and payout frequency, which monthly snapshots do not record.
 *
 * @typedef {object} Dividend
 * @property {string} id
 * @property {string} name Fund or stock name.
 * @property {Wrapper} wrapper Wrapper it is held in — ISA and SIPP are fully sheltered, `gia` is
 *   taxable above the dividend allowance.
 * @property {number} value Current value of the holding (£).
 * @property {number} yield_pct Annual dividend yield (%).
 * @property {number} monthly_contribution Amount added per month (£).
 * @property {PayoutFrequency} frequency How often dividends are paid.
 * @property {DividendStrategy} strategy Reinvest (DRIP) or take as income.
 * @property {string} notes Free text.
 */

/**
 * A net worth target. `current` is a cached progress figure so achieved milestones survive a
 * change in how net worth is computed; live progress is recalculated from `monthly_entries`.
 *
 * @typedef {object} Milestone
 * @property {string} id
 * @property {string} label Display label, e.g. "£100k" or "House deposit".
 * @property {number} target Target amount (£).
 * @property {number} current Progress towards the target when last recalculated (£).
 * @property {MilestoneType} type Built-in target or user-defined.
 */

/**
 * A monthly spending category, optionally benchmarked against the ONS UK household average.
 *
 * @typedef {object} BudgetCategory
 * @property {string} id
 * @property {string} name e.g. "Groceries".
 * @property {number} monthly_amount Budgeted spend (£/month).
 * @property {number | null} ons_benchmark ONS UK household average for this category (£/month).
 *   Null where no benchmark applies.
 */

/**
 * A recurring bill.
 *
 * @typedef {object} BudgetBill
 * @property {string} id
 * @property {string} name e.g. "Council tax".
 * @property {number} amount Amount per `frequency` period (£).
 * @property {BillFrequency} frequency How often it is due.
 * @property {number | null} due_day Day of the month it leaves the account, 1–31. Null if varies.
 * @property {string | null} category_id `BudgetCategory.id` this bill rolls up into.
 * @property {string} notes Free text.
 */

/**
 * A one-off or ad hoc budget line that is not a recurring bill.
 *
 * @typedef {object} BudgetLineItem
 * @property {string} id
 * @property {string} name
 * @property {number} amount Amount (£).
 * @property {string | null} category_id `BudgetCategory.id` this line rolls up into.
 * @property {string} notes Free text.
 */

/**
 * The budget. README.md's outline writes this as `budget[]` with nested arrays; there is only
 * ever one budget, so it is modelled as a single object holding the three lists (see PR notes).
 *
 * @typedef {object} Budget
 * @property {BudgetCategory[]} categories
 * @property {BudgetBill[]} bills
 * @property {BudgetLineItem[]} line_items
 */

/**
 * A named beneficiary and the share of the net estate they are wished to receive — README.md →
 * "Estate & IHT Planning Suite": "Who-gets-what wishes per beneficiary" (issue #140). A wish, not a
 * legal instrument: nothing here enforces that every `share_pct` across the list sums to 100 —
 * `estate-plan.js`'s `beneficiaryShares()` reports that as under- or over-allocated rather than this
 * shape preventing it.
 *
 * @typedef {object} Beneficiary
 * @property {string} id
 * @property {string} name
 * @property {string} relationship Free text, e.g. "Spouse", "Daughter", "Charity".
 * @property {number} share_pct Wished share of the net estate, 0–100.
 * @property {string} notes Free text.
 */

/**
 * The Inheritance Tax assumptions this app's tracked net worth data cannot supply on its own —
 * `estate-plan.js`'s `estateSnapshot()` folds these in alongside the estate value it derives from
 * `monthly_entries`/`properties`/`assets`/`pensions`.
 *
 * @typedef {object} IhtSettings
 * @property {boolean} spouse_exempt Whether the whole net estate is wished to pass to a spouse or
 *   civil partner, exempt without limit — the simplification an "if I died today" snapshot takes
 *   before a full who-gets-what split exists (see `beneficiaries` above, and #167).
 * @property {boolean} direct_descendants Whether a home is passing to children, grandchildren or
 *   other direct descendants — the residence nil-rate band's own precondition (`estate.js`).
 * @property {number} transferred_nil_rate_band_pct Percentage of a predeceased spouse's or civil
 *   partner's nil-rate band brought forward, 0–100.
 * @property {number} transferred_residence_nil_rate_band_pct The same for the residence nil-rate
 *   band, stated separately because a first estate can leave one unused and not the other.
 * @property {number} funeral_expenses Funeral costs (£) — deducted from the estate alongside
 *   whatever this app's own tracked mortgages/loans/debts already net off.
 */

/**
 * One row in the activity log — a record that an investment or debt was added, removed or
 * updated, kept so the change history can be reviewed and a deletion undone. README.md →
 * "Net Worth Tracking" lists "Activity log with revert support for deleted entries" but the Data
 * Model outline does not mention it; added here per this repo's rule that a new feature area
 * extends the shared data model rather than keeping its own storage (see PR notes for issue #14).
 *
 * @typedef {object} ActivityLogEntry
 * @property {string} id
 * @property {string} timestamp ISO 8601 date-time the action was recorded.
 * @property {ActivityLogAction} action What happened.
 * @property {ActivityLogEntityType} entity_type Kind of record the action was performed on.
 * @property {string} entity_id `Investment.id` / `Debt.id` the action applied to.
 * @property {string} entity_name Name of the record at the time of the action, kept alongside the
 *   id so the log still reads sensibly after the record itself is gone.
 * @property {Record<string, unknown> | null} snapshot The full record as it stood immediately
 *   before an `added`/`removed` action — what a `removed` entry needs to restore itself via
 *   revert. Null where no snapshot was recorded.
 * @property {boolean} reverted Whether a `removed` entry's deletion has since been undone. Always
 *   false for `added`/`updated` entries — only a deletion is revertible (issue #14's own scope).
 */

/**
 * The whole persisted document — everything the app stores, in one JSON blob.
 *
 * @typedef {object} AppData
 * @property {number} schema_version Version of this shape, for forward migration (see
 *   `SCHEMA_VERSION`). Not in README.md's outline; added so a stored Gist can be upgraded.
 * @property {Profile} profile
 * @property {MonthlyEntry[]} monthly_entries Ordered oldest first.
 * @property {Pension[]} pensions
 * @property {Property[]} properties
 * @property {Asset[]} assets
 * @property {Dividend[]} dividends
 * @property {Milestone[]} milestones
 * @property {Budget} budget
 * @property {ActivityLogEntry[]} activity_log Newest first.
 * @property {import('./lifetime-gifts.js').Gift[]} gifts Lifetime gifts — the 7-year countdown, the
 *   annual exemption and taper relief are `lifetime-gifts.js`'s own; this document only gives them
 *   a home. Normalised here structurally only (id, date-or-null, numbers); `lifetime-gifts.js`'s own
 *   `normaliseGift` is the authoritative normalisation and runs before every use.
 * @property {Beneficiary[]} beneficiaries Who-gets-what wishes — see {@link Beneficiary}.
 * @property {IhtSettings} iht_settings Assumptions "if I died today" needs that tracked net worth
 *   data cannot supply — see {@link IhtSettings}.
 */

/**
 * A single problem found by `validateAppData`.
 *
 * @typedef {object} ValidationError
 * @property {string} path Dotted path to the offending field, e.g. `monthly_entries[0].month`.
 * @property {string} message What is wrong, in plain English.
 */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid True when `errors` is empty.
 * @property {ValidationError[]} errors
 */

export {};
