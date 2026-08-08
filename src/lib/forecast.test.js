import { describe, expect, it } from 'vitest';

import {
	DEFAULT_GROWTH_RATE,
	fillMissingMonths,
	monthlyGrowthRate,
	netAnnualGrowthRate
} from './auto-invest.js';
import { createDebt, createInvestment, createMonthlyEntry } from './model.js';
import {
	DEFAULT_FORECAST_MONTHS,
	DEFAULT_SCENARIO_SPREAD,
	DEFAULT_SUMMARY_YEARS,
	FORECAST_SCENARIOS,
	FORECAST_SCENARIO_LABELS,
	MAX_FORECAST_MONTHS,
	currentCalendarMonth,
	forecastBand,
	forecastFromEntries,
	forecastPointAtYear,
	forecastScenarios,
	positionFromEntries,
	projectScenario,
	resolveHoldingGrowthRate,
	scenarioGrowthRates,
	scenarioRateDelta,
	summariseForecast
} from './forecast.js';

/** Values are money, so compare to the penny rather than to floating-point exactness. */
const PENNY = 0.005;

const JAN_2026 = { month: 1, year: 2026 };

/** @param {Partial<import('./types.js').Investment>} [overrides] */
function holding(overrides = {}) {
	return createInvestment({ id: 'inv_a', name: 'Global All Cap', value: 10_000, ...overrides });
}

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                   */
/* -------------------------------------------------------------------------- */

describe('FORECAST_SCENARIOS', () => {
	it('names the three scenarios README.md asks for, worst first', () => {
		expect(FORECAST_SCENARIOS).toEqual(['pessimistic', 'realistic', 'optimistic']);
	});

	it('labels every scenario', () => {
		for (const scenario of FORECAST_SCENARIOS) {
			expect(FORECAST_SCENARIO_LABELS[scenario]).toBeTruthy();
		}
	});
});

describe('scenarioGrowthRates', () => {
	it('shifts the realistic rate down and up by the spread', () => {
		expect(scenarioGrowthRates(5, 2)).toEqual({
			pessimistic: 3,
			realistic: 5,
			optimistic: 7
		});
	});

	it('defaults to the profile default rate and the default spread', () => {
		expect(scenarioGrowthRates()).toEqual(
			scenarioGrowthRates(DEFAULT_GROWTH_RATE, DEFAULT_SCENARIO_SPREAD)
		);
	});

	it('reads a negative spread as its magnitude, so the rates stay ordered', () => {
		expect(scenarioGrowthRates(5, -2)).toEqual(scenarioGrowthRates(5, 2));
	});

	it('collapses to three identical rates at zero spread', () => {
		expect(scenarioGrowthRates(4, 0)).toEqual({ pessimistic: 4, realistic: 4, optimistic: 4 });
	});

	it('clamps to the -100…100 range the data model accepts', () => {
		expect(scenarioGrowthRates(-99, 10).pessimistic).toBe(-100);
		expect(scenarioGrowthRates(97, 10).optimistic).toBe(100);
	});
});

describe('scenarioRateDelta', () => {
	it('is negative, zero and positive in scenario order', () => {
		expect(FORECAST_SCENARIOS.map((scenario) => scenarioRateDelta(scenario, 3))).toEqual([
			-3, 0, 3
		]);
	});

	it('uses the default spread when none is given', () => {
		expect(scenarioRateDelta('optimistic')).toBe(DEFAULT_SCENARIO_SPREAD);
	});
});

/* -------------------------------------------------------------------------- */
/* Per-holding rates                                                           */
/* -------------------------------------------------------------------------- */

describe('resolveHoldingGrowthRate', () => {
	it('falls back to the single assumption when the holding has no override', () => {
		expect(resolveHoldingGrowthRate(holding({ fund_fee: 0 }), { growthRate: 6 })).toBeCloseTo(
			6,
			10
		);
	});

	it('uses a per-holding override where one is given', () => {
		const rate = resolveHoldingGrowthRate(holding({ id: 'inv_cash', fund_fee: 0 }), {
			growthRate: 7,
			holdingGrowthRates: { inv_cash: 1 }
		});
		expect(rate).toBeCloseTo(1, 10);
	});

	it('nets the fund fee off growth rather than subtracting it', () => {
		const rate = resolveHoldingGrowthRate(holding({ fund_fee: 0.22 }), { growthRate: 5 });
		expect(rate).toBeCloseTo(netAnnualGrowthRate(5, 0.22), 10);
		// (1.05 × 0.9978) - 1 = 4.769%, not 4.78%.
		expect(rate).toBeCloseTo(4.769, 4);
	});

	it('leaves the fee alone when applyFundFees is false', () => {
		const rate = resolveHoldingGrowthRate(holding({ fund_fee: 0.22 }), {
			growthRate: 5,
			applyFundFees: false
		});
		expect(rate).toBeCloseTo(5, 10);
	});

	it('applies the scenario delta to the gross rate, before the fee', () => {
		const pessimistic = resolveHoldingGrowthRate(holding({ fund_fee: 0.5 }), {
			growthRate: 5,
			growthRateDelta: -2
		});
		expect(pessimistic).toBeCloseTo(netAnnualGrowthRate(3, 0.5), 10);
	});

	it('applies the scenario delta to a per-holding override too', () => {
		const rate = resolveHoldingGrowthRate(holding({ id: 'inv_cash', fund_fee: 0 }), {
			growthRate: 7,
			holdingGrowthRates: { inv_cash: 1 },
			growthRateDelta: -2
		});
		expect(rate).toBeCloseTo(-1, 10);
	});

	it('clamps a shifted rate to the accepted range', () => {
		const rate = resolveHoldingGrowthRate(holding({ fund_fee: 0 }), {
			growthRate: -99,
			growthRateDelta: -5
		});
		expect(rate).toBe(-100);
	});
});

/* -------------------------------------------------------------------------- */
/* projectScenario                                                             */
/* -------------------------------------------------------------------------- */

describe('projectScenario', () => {
	it('starts at the anchor position, with nothing contributed or grown yet', () => {
		const [first] = projectScenario({
			investments: [holding({ value: 10_000 })],
			debts: [createDebt({ balance: 2_000 })],
			start: JAN_2026,
			months: 12
		});

		expect(first).toEqual({
			offset: 0,
			month: 1,
			year: 2026,
			investments: 10_000,
			debts: 2_000,
			net_worth: 8_000,
			contributions: 0,
			growth: 0
		});
	});

	it('returns one point per month plus the anchor', () => {
		const points = projectScenario({ investments: [holding()], start: JAN_2026, months: 24 });
		expect(points).toHaveLength(25);
		expect(points.at(-1)?.offset).toBe(24);
	});

	it('compounds twelve months to exactly the annual rate', () => {
		const points = projectScenario(
			{
				investments: [holding({ value: 10_000, monthly_contribution: 0, fund_fee: 0 })],
				start: JAN_2026,
				months: 12
			},
			{ growthRate: 5 }
		);
		expect(points[12].investments).toBeCloseTo(10_500, 1);
	});

	it('rolls the calendar over correctly', () => {
		const points = projectScenario({
			investments: [holding()],
			start: { month: 11, year: 2026 },
			months: 3
		});
		expect(points.map((point) => `${point.year}-${point.month}`)).toEqual([
			'2026-11',
			'2026-12',
			'2027-1',
			'2027-2'
		]);
	});

	it('grows first and contributes second, an ordinary annuity', () => {
		const points = projectScenario(
			{
				investments: [holding({ value: 10_000, monthly_contribution: 500, fund_fee: 0 })],
				start: JAN_2026,
				months: 1
			},
			{ growthRate: 5 }
		);
		// 10,000 × 1.05^(1/12) + 500 — the contribution earns nothing in the month it is paid.
		expect(points[1].investments).toBeCloseTo(10_000 * 1.05 ** (1 / 12) + 500, 2);
	});

	it('splits the value change into contributions and growth exactly', () => {
		const points = projectScenario(
			{
				investments: [holding({ value: 25_000, monthly_contribution: 400, fund_fee: 0.2 })],
				start: JAN_2026,
				months: 60
			},
			{ growthRate: 5 }
		);

		const last = points.at(-1);
		expect(last).toBeDefined();
		expect(last?.contributions).toBeCloseTo(60 * 400, 2);
		expect((last?.contributions ?? 0) + (last?.growth ?? 0)).toBeCloseTo(
			(last?.investments ?? 0) - points[0].investments,
			PENNY
		);
	});

	it('honours contribution frequency rather than flattening it', () => {
		const quarterly = projectScenario(
			{
				investments: [
					holding({
						value: 0,
						monthly_contribution: 900,
						contribution_frequency: 'quarterly',
						fund_fee: 0
					})
				],
				start: JAN_2026,
				months: 12
			},
			{ growthRate: 0 }
		);
		// Paid in April, July, October and January — four payments in twelve months.
		expect(quarterly.at(-1)?.contributions).toBeCloseTo(3_600, 2);
		expect(quarterly[3].contributions).toBe(900);
		expect(quarterly[2].contributions).toBe(0);
	});

	it('never pays a one-off contribution into a projected month', () => {
		const points = projectScenario(
			{
				investments: [
					holding({ value: 1_000, monthly_contribution: 5_000, contribution_frequency: 'one_off' })
				],
				start: JAN_2026,
				months: 36
			},
			{ growthRate: 5 }
		);
		expect(points.at(-1)?.contributions).toBe(0);
	});

	it('carries debts forward unchanged and nets them off net worth', () => {
		const points = projectScenario(
			{
				investments: [holding({ value: 10_000, monthly_contribution: 0, fund_fee: 0 })],
				debts: [createDebt({ balance: 4_000 })],
				start: JAN_2026,
				months: 12
			},
			{ growthRate: 5 }
		);
		expect(points.at(-1)?.debts).toBe(4_000);
		expect(points.at(-1)?.net_worth).toBeCloseTo(10_500 - 4_000, 1);
	});

	it('drops holdings and debts excluded from net worth', () => {
		const points = projectScenario({
			investments: [
				holding({ id: 'inv_a', value: 10_000 }),
				holding({ id: 'inv_b', value: 50_000, exclude_from_net_worth: true })
			],
			debts: [
				createDebt({ balance: 1_000 }),
				createDebt({ balance: 300_000, exclude_from_net_worth: true })
			],
			start: JAN_2026,
			months: 6
		});

		expect(points[0].investments).toBe(10_000);
		expect(points[0].debts).toBe(1_000);
		expect(points.at(-1)?.debts).toBe(1_000);
	});

	it('gives each holding its own rate', () => {
		const points = projectScenario(
			{
				investments: [
					holding({ id: 'inv_cash', value: 10_000, monthly_contribution: 0, fund_fee: 0 }),
					holding({ id: 'inv_equity', value: 10_000, monthly_contribution: 0, fund_fee: 0 })
				],
				start: JAN_2026,
				months: 12
			},
			{ growthRate: 5, holdingGrowthRates: { inv_cash: 1 } }
		);
		expect(points[12].investments).toBeCloseTo(10_100 + 10_500, 1);
	});

	it('shrinks the pot under a negative rate', () => {
		const points = projectScenario(
			{
				investments: [holding({ value: 10_000, monthly_contribution: 0, fund_fee: 0 })],
				start: JAN_2026,
				months: 12
			},
			{ growthRate: -10 }
		);
		expect(points[12].investments).toBeCloseTo(9_000, 1);
		expect(points[12].growth).toBeCloseTo(-1_000, 1);
	});

	it('projects an empty position as a flat zero line', () => {
		const points = projectScenario({ start: JAN_2026, months: 3 });
		expect(points).toHaveLength(4);
		expect(points.every((point) => point.net_worth === 0)).toBe(true);
	});

	it('returns just the anchor for a zero or negative horizon', () => {
		expect(projectScenario({ investments: [holding()], start: JAN_2026, months: 0 })).toHaveLength(
			1
		);
		expect(
			projectScenario({ investments: [holding()], start: JAN_2026, months: -12 })
		).toHaveLength(1);
	});

	it('clamps an absurd horizon rather than building it', () => {
		const points = projectScenario({ investments: [holding()], start: JAN_2026, months: 100_000 });
		expect(points).toHaveLength(MAX_FORECAST_MONTHS + 1);
	});

	it('does not mutate the holdings it is given', () => {
		const investment = holding({ value: 10_000, monthly_contribution: 250 });
		projectScenario({ investments: [investment], start: JAN_2026, months: 12 });
		expect(investment.value).toBe(10_000);
	});

	it('defaults to the current calendar month', () => {
		const [first] = projectScenario({ investments: [holding()], months: 1 });
		expect({ month: first.month, year: first.year }).toEqual(currentCalendarMonth());
	});

	it('continues the auto-invest series exactly — the same month, the same number', () => {
		const anchor = createMonthlyEntry({
			...JAN_2026,
			investments: [holding({ value: 10_000, monthly_contribution: 500, fund_fee: 0.22 })]
		});
		const filled = fillMissingMonths([anchor], {
			growthRate: 5,
			through: { month: 7, year: 2026 }
		});
		const forecast = projectScenario(
			{ investments: anchor.investments, start: JAN_2026, months: 6 },
			{ growthRate: 5 }
		);

		expect(forecast.at(-1)?.investments).toBe(filled.at(-1)?.investments[0].value);
	});
});

/* -------------------------------------------------------------------------- */
/* forecastScenarios                                                           */
/* -------------------------------------------------------------------------- */

describe('forecastScenarios', () => {
	const position = {
		investments: [holding({ value: 50_000, monthly_contribution: 500, fund_fee: 0 })],
		debts: [createDebt({ balance: 10_000 })],
		start: JAN_2026,
		months: 120
	};

	it('projects all three scenarios over the same months from the same anchor', () => {
		const forecast = forecastScenarios(position, { growthRate: 5 });

		for (const scenario of FORECAST_SCENARIOS) {
			expect(forecast.series[scenario]).toHaveLength(121);
			expect(forecast.series[scenario][0].net_worth).toBe(40_000);
		}
		expect(forecast.start).toEqual(JAN_2026);
		expect(forecast.months).toBe(120);
	});

	it('reports the headline rate each scenario used', () => {
		const forecast = forecastScenarios(position, { growthRate: 5 });
		expect(forecast.rates).toEqual({ pessimistic: 3, realistic: 5, optimistic: 7 });
		expect(forecast.spread).toBe(DEFAULT_SCENARIO_SPREAD);
	});

	it('orders the scenarios pessimistic ≤ realistic ≤ optimistic at every month', () => {
		const forecast = forecastScenarios(position, { growthRate: 5 });

		forecast.series.realistic.forEach((point, index) => {
			expect(forecast.series.pessimistic[index].net_worth).toBeLessThanOrEqual(point.net_worth);
			expect(point.net_worth).toBeLessThanOrEqual(forecast.series.optimistic[index].net_worth);
		});
	});

	it('separates the outer scenarios meaningfully over a long horizon', () => {
		const forecast = forecastScenarios({ ...position, months: 360 }, { growthRate: 5 });
		const pessimistic = forecast.series.pessimistic.at(-1)?.net_worth ?? 0;
		const optimistic = forecast.series.optimistic.at(-1)?.net_worth ?? 0;
		expect(optimistic).toBeGreaterThan(pessimistic * 2);
	});

	it('contributes the same in every scenario — only growth differs', () => {
		const forecast = forecastScenarios(position, { growthRate: 5 });
		const contributions = FORECAST_SCENARIOS.map(
			(scenario) => forecast.series[scenario].at(-1)?.contributions
		);
		expect(new Set(contributions).size).toBe(1);
	});

	it('collapses to one line at zero spread', () => {
		const forecast = forecastScenarios({ ...position, spread: 0 }, { growthRate: 5 });
		const finals = FORECAST_SCENARIOS.map(
			(scenario) => forecast.series[scenario].at(-1)?.net_worth
		);
		expect(new Set(finals).size).toBe(1);
	});

	it('ignores a growthRateDelta a caller tries to pass in — the scenario owns it', () => {
		const withDelta = forecastScenarios(position, { growthRate: 5, growthRateDelta: 20 });
		const without = forecastScenarios(position, { growthRate: 5 });
		expect(withDelta.series.realistic.at(-1)?.net_worth).toBe(
			without.series.realistic.at(-1)?.net_worth
		);
	});

	it('defaults to a thirty-year horizon', () => {
		const forecast = forecastScenarios({ investments: [holding()], start: JAN_2026 });
		expect(forecast.months).toBe(DEFAULT_FORECAST_MONTHS);
	});

	it('anchors every scenario on the same start month when none is given', () => {
		const forecast = forecastScenarios({ investments: [holding()], months: 1 });
		for (const scenario of FORECAST_SCENARIOS) {
			expect(forecast.series[scenario][0].month).toBe(forecast.start.month);
			expect(forecast.series[scenario][0].year).toBe(forecast.start.year);
		}
	});
});

/* -------------------------------------------------------------------------- */
/* Per-month adjustments (the stress test overlay's seam, #21)                 */
/* -------------------------------------------------------------------------- */

describe('projectScenario with adjustMonth', () => {
	const position = {
		investments: [holding({ value: 10_000, monthly_contribution: 0, fund_fee: 0 })],
		start: JAN_2026,
		months: 12
	};

	it('projects normally when the hook returns null for every month', () => {
		const adjusted = projectScenario(position, { growthRate: 5, adjustMonth: () => null });
		expect(adjusted).toEqual(projectScenario(position, { growthRate: 5 }));
	});

	it('applies a stated move to the month it names, and nothing else', () => {
		const points = projectScenario(position, {
			growthRate: 5,
			adjustMonth: (offset) => (offset === 6 ? { factor: 0.6 } : null)
		});
		const plain = projectScenario(position, { growthRate: 5 });

		expect(points[5]).toEqual(plain[5]);
		expect(points[6].investments).toBeCloseTo(points[5].investments * 0.6, 2);
		// The month after is ordinary growth again, on the smaller pot.
		expect(points[7].investments / points[6].investments).toBeCloseTo(
			plain[7].investments / plain[6].investments,
			6
		);
	});

	it('books a stated move as growth, so the split still reconciles', () => {
		const points = projectScenario(
			{ ...position, investments: [holding({ monthly_contribution: 200, fund_fee: 0 })] },
			{ growthRate: 5, adjustMonth: (offset) => (offset === 3 ? { factor: 0.5 } : null) }
		);

		for (const point of points) {
			expect(point.investments).toBeCloseTo(10_000 + point.contributions + point.growth, PENNY);
		}
		expect(points[3].growth).toBeLessThan(points[2].growth);
	});

	it('still pays the month contribution at the new price', () => {
		const points = projectScenario(
			{ ...position, investments: [holding({ monthly_contribution: 500, fund_fee: 0 })] },
			{ growthRate: 5, adjustMonth: (offset) => (offset === 4 ? { factor: 0.5 } : null) }
		);
		expect(points[4].investments).toBeCloseTo(points[3].investments * 0.5 + 500, 2);
		expect(points[4].contributions).toBe(2_000);
	});

	it('replaces the base rate for a month, keeping the scenario shift and the fund fee', () => {
		const points = projectScenario(
			{ ...position, investments: [holding({ fund_fee: 0.5, monthly_contribution: 0 })] },
			{
				growthRate: 5,
				growthRateDelta: -2,
				adjustMonth: (offset) => (offset === 2 ? { growthRate: 20 } : null)
			}
		);

		// 20% for the named month, shifted by the scenario's -2pp and netted of the 0.5% fee.
		expect(points[2].investments / points[1].investments).toBeCloseTo(
			1 + monthlyGrowthRate(netAnnualGrowthRate(18, 0.5)),
			6
		);
		expect(points[3].investments / points[2].investments).toBeCloseTo(
			1 + monthlyGrowthRate(netAnnualGrowthRate(3, 0.5)),
			6
		);
	});

	it('ignores per-holding growth overrides while a month rate is in force', () => {
		const points = projectScenario(
			{ ...position, investments: [holding({ id: 'inv_cash', fund_fee: 0 })] },
			{
				growthRate: 5,
				holdingGrowthRates: { inv_cash: 1 },
				adjustMonth: (offset) => (offset === 2 ? { growthRate: 20 } : null)
			}
		);

		expect(points[1].investments / points[0].investments).toBeCloseTo(1 + monthlyGrowthRate(1), 6);
		expect(points[2].investments / points[1].investments).toBeCloseTo(1 + monthlyGrowthRate(20), 6);
	});

	it('prefers a stated move over a rate when a month somehow carries both', () => {
		const points = projectScenario(position, {
			growthRate: 5,
			adjustMonth: (offset) => (offset === 1 ? { factor: 0.5, growthRate: 50 } : null)
		});
		expect(points[1].investments).toBeCloseTo(5_000, 2);
	});

	it('is never asked about the anchor, which every scenario shares', () => {
		/** @type {number[]} */
		const asked = [];
		projectScenario(
			{ ...position, months: 3 },
			{
				adjustMonth: (offset) => {
					asked.push(offset);
					return null;
				}
			}
		);
		expect(asked).toEqual([1, 2, 3]);
	});

	it('reaches every scenario through forecastScenarios', () => {
		const forecast = forecastScenarios(position, {
			growthRate: 5,
			adjustMonth: (offset) => (offset === 6 ? { factor: 0.5 } : null)
		});

		for (const scenario of FORECAST_SCENARIOS) {
			const series = forecast.series[scenario];
			expect(series[6].investments).toBeCloseTo(series[5].investments * 0.5, 2);
		}
	});

	describe('contributionFactor', () => {
		const contributing = {
			...position,
			investments: [holding({ monthly_contribution: 500, fund_fee: 0 })]
		};

		it('skips the month contribution entirely at a factor of 0', () => {
			const points = projectScenario(contributing, {
				growthRate: 5,
				adjustMonth: (offset) => (offset === 6 ? { contributionFactor: 0 } : null)
			});
			const plain = projectScenario(contributing, { growthRate: 5 });

			// Month 5 is identical in both series, so month 6 grows from the same base — the only
			// difference is the £500 contribution the plain run adds on top and this one skips.
			expect(points[6].investments).toBeCloseTo(plain[6].investments - 500, PENNY);
			expect(points[6].contributions).toBe(plain[5].contributions);
		});

		it('scales a partial drop, and leaves other months paying in full', () => {
			const points = projectScenario(contributing, {
				growthRate: 5,
				adjustMonth: (offset) => (offset === 6 ? { contributionFactor: 0.5 } : null)
			});
			const plain = projectScenario(contributing, { growthRate: 5 });

			expect(points[6].contributions).toBe(plain[5].contributions + 250);
			expect(points[12].contributions).toBe(plain[12].contributions - 250);
		});

		it('leaves the growth rate untouched — a skipped contribution earns nothing either way', () => {
			const points = projectScenario(contributing, {
				growthRate: 5,
				adjustMonth: (offset) => (offset === 6 ? { contributionFactor: 0 } : null)
			});
			const plain = projectScenario(contributing, { growthRate: 5 });

			// `growth` is the value change *not* explained by the contribution — an ordinary annuity
			// pays in at month end, so a contribution earns no growth in its own month regardless of
			// whether it was paid at all. Skipping it therefore changes `investments` and
			// `contributions` by the same £500 and leaves `growth` exactly as it was.
			expect(points[6].growth).toBeCloseTo(plain[6].growth, PENNY);
			expect(points[6].investments / points[5].investments).toBeCloseTo(
				(plain[6].investments - 500) / plain[5].investments,
				4
			);
		});

		it('still reconciles contributions + growth to the value change, at a fractional factor', () => {
			const points = projectScenario(contributing, {
				growthRate: 5,
				adjustMonth: (offset) => (offset === 6 ? { contributionFactor: 0.3 } : null)
			});
			for (const point of points) {
				expect(point.investments).toBeCloseTo(10_000 + point.contributions + point.growth, PENNY);
			}
		});

		it('combines with a stated move in the same month', () => {
			const points = projectScenario(contributing, {
				growthRate: 5,
				adjustMonth: (offset) => (offset === 6 ? { factor: 0.5, contributionFactor: 0 } : null)
			});
			expect(points[6].investments).toBeCloseTo(points[5].investments * 0.5, PENNY);
			expect(points[6].contributions).toBe(points[5].contributions);
		});

		it('defaults to 1 (paid in full) when a month adjustment omits it', () => {
			const points = projectScenario(contributing, {
				growthRate: 5,
				adjustMonth: (offset) => (offset === 6 ? { growthRate: 5 } : null)
			});
			expect(points).toEqual(projectScenario(contributing, { growthRate: 5 }));
		});
	});
});

/* -------------------------------------------------------------------------- */
/* positionFromEntries / forecastFromEntries                                   */
/* -------------------------------------------------------------------------- */

describe('positionFromEntries', () => {
	const older = createMonthlyEntry({ ...JAN_2026, investments: [holding({ value: 10_000 })] });
	const newer = createMonthlyEntry({
		month: 4,
		year: 2026,
		investments: [holding({ value: 12_000 })],
		debts: [createDebt({ balance: 2_000 })]
	});

	it('reads the latest snapshot, whatever order the entries arrive in', () => {
		const position = positionFromEntries([newer, older]);
		expect(position?.start).toEqual({ month: 4, year: 2026 });
		expect(position?.investments[0].value).toBe(12_000);
		expect(position?.debts[0].balance).toBe(2_000);
	});

	it('returns null when there is no history to anchor on', () => {
		expect(positionFromEntries([])).toBeNull();
	});

	it('is the position forecastFromEntries itself projects', () => {
		const position = positionFromEntries([older, newer]);
		expect(forecastFromEntries([older, newer], { months: 12 }, { growthRate: 5 })).toEqual(
			forecastScenarios({ ...position, months: 12 }, { growthRate: 5 })
		);
	});
});

describe('forecastFromEntries', () => {
	const older = createMonthlyEntry({
		...JAN_2026,
		investments: [holding({ value: 10_000 })]
	});
	const latest = createMonthlyEntry({
		month: 4,
		year: 2026,
		investments: [holding({ value: 12_000, monthly_contribution: 0, fund_fee: 0 })],
		debts: [createDebt({ balance: 2_000 })]
	});

	it('anchors on the most recent snapshot, whatever order it is given in', () => {
		const forecast = forecastFromEntries([latest, older], { months: 12 }, { growthRate: 5 });
		expect(forecast?.start).toEqual({ month: 4, year: 2026 });
		expect(forecast?.series.realistic[0].net_worth).toBe(10_000);
	});

	it('anchors on an auto-filled month when that is the latest position known', () => {
		const filled = fillMissingMonths([older, latest], { growthRate: 5 });
		const forecast = forecastFromEntries(filled, { months: 1 });
		expect(forecast?.start).toEqual({ month: 4, year: 2026 });
	});

	it('returns null when there is no history to anchor on', () => {
		expect(forecastFromEntries([], { months: 12 })).toBeNull();
	});

	it('passes the horizon and spread through', () => {
		const forecast = forecastFromEntries([latest], { months: 6, spread: 3 }, { growthRate: 5 });
		expect(forecast?.months).toBe(6);
		expect(forecast?.rates).toEqual({ pessimistic: 2, realistic: 5, optimistic: 8 });
	});
});

/* -------------------------------------------------------------------------- */
/* Reading a forecast                                                          */
/* -------------------------------------------------------------------------- */

describe('forecastBand', () => {
	const forecast = forecastScenarios(
		{
			investments: [holding({ value: 20_000, monthly_contribution: 200, fund_fee: 0 })],
			start: JAN_2026,
			months: 24
		},
		{ growthRate: 5 }
	);

	it('gives one low/mid/high point per projected month', () => {
		const band = forecastBand(forecast);
		expect(band).toHaveLength(25);
		expect(band[0]).toMatchObject({ offset: 0, month: 1, year: 2026 });
	});

	it('brackets the realistic line', () => {
		for (const point of forecastBand(forecast)) {
			expect(point.low).toBeLessThanOrEqual(point.mid);
			expect(point.mid).toBeLessThanOrEqual(point.high);
		}
	});

	it('starts as a single point — every scenario shares the anchor', () => {
		const [first] = forecastBand(forecast);
		expect(first.low).toBe(first.high);
		expect(first.mid).toBe(20_000);
	});

	it('takes the extremes across scenarios, so the band survives unordered rates', () => {
		const inverted = forecastScenarios(
			{
				investments: [holding({ value: 10_000, monthly_contribution: 0, fund_fee: 0 })],
				start: JAN_2026,
				months: 12
			},
			{ growthRate: 5, holdingGrowthRates: { inv_a: 5 } }
		);
		// A per-holding override ignores the scenario shift's *base*, but the delta still applies,
		// so ordering is preserved here; the assertion is that low/high are never crossed.
		for (const point of forecastBand(inverted)) {
			expect(point.low).toBeLessThanOrEqual(point.high);
		}
	});
});

describe('forecastPointAtYear', () => {
	const forecast = forecastScenarios(
		{
			investments: [holding({ value: 10_000, monthly_contribution: 0, fund_fee: 0 })],
			start: JAN_2026,
			months: 120
		},
		{ growthRate: 5 }
	);

	it('reads the month a whole number of years out', () => {
		const point = forecastPointAtYear(forecast, 'realistic', 10);
		expect(point?.offset).toBe(120);
		expect(point?.investments).toBeCloseTo(10_000 * 1.05 ** 10, 0);
	});

	it('returns null past the end of the forecast', () => {
		expect(forecastPointAtYear(forecast, 'realistic', 40)).toBeNull();
	});
});

describe('summariseForecast', () => {
	const forecast = forecastScenarios(
		{
			investments: [holding({ value: 50_000, monthly_contribution: 500, fund_fee: 0 })],
			debts: [createDebt({ balance: 10_000 })],
			start: JAN_2026,
			months: 120
		},
		{ growthRate: 5 }
	);

	it('drops horizons the forecast does not reach and always ends at its last month', () => {
		const rows = summariseForecast(forecast);
		expect(rows.map((row) => row.years)).toEqual([1, 5, 10]);
		expect(rows.at(-1)?.offset).toBe(120);
	});

	it('does not duplicate the final horizon when a requested year already lands on it', () => {
		const rows = summariseForecast(forecast, [10, 10]);
		expect(rows).toHaveLength(1);
	});

	it('dates each row from the anchor', () => {
		const [first] = summariseForecast(forecast, [1]);
		expect(first).toMatchObject({ offset: 12, month: 1, year: 2027 });
	});

	it('reports all three scenarios per row, in order', () => {
		const [row] = summariseForecast(forecast, [10]);
		expect(row.net_worth.pessimistic).toBeLessThan(row.net_worth.realistic);
		expect(row.net_worth.realistic).toBeLessThan(row.net_worth.optimistic);
	});

	it('reports contributions, which are the same in every scenario', () => {
		const [row] = summariseForecast(forecast, [10]);
		expect(row.contributions).toBeCloseTo(120 * 500, 2);
	});

	it('handles a horizon that is not a whole number of years', () => {
		const short = forecastScenarios(
			{ investments: [holding()], start: JAN_2026, months: 18 },
			{ growthRate: 5 }
		);
		const rows = summariseForecast(short);
		expect(rows.map((row) => row.offset)).toEqual([12, 18]);
		expect(rows.at(-1)?.years).toBeCloseTo(1.5, 10);
	});

	it('returns nothing for a forecast with no months', () => {
		const flat = forecastScenarios({ investments: [holding()], start: JAN_2026, months: 0 });
		expect(summariseForecast(flat)).toEqual([]);
	});

	it('defaults to the documented horizons', () => {
		const long = forecastScenarios(
			{ investments: [holding()], start: JAN_2026, months: 360 },
			{ growthRate: 5 }
		);
		expect(summariseForecast(long).map((row) => row.years)).toEqual([...DEFAULT_SUMMARY_YEARS]);
	});
});
