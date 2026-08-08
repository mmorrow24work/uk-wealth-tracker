import { describe, expect, it } from 'vitest';

import { netAnnualGrowthRate } from './auto-invest.js';
import { portfolioRunway, realGrowthRate } from './fire.js';
import { projectScenario } from './forecast.js';
import {
	createAppData,
	createInvestment,
	createMonthlyEntry,
	createPension,
	createProfile
} from './model.js';
import {
	DEFAULT_MONTE_CARLO_INPUT,
	DEFAULT_SEED,
	DEFAULT_SIMULATION_PATHS,
	MAX_SAMPLE_PATHS,
	MAX_SIMULATION_PATHS,
	MAX_SIMULATION_YEARS,
	MONTE_CARLO_PERCENTILES,
	SHORTFALL_TOLERANCE,
	createNormalSource,
	createRandomSource,
	definedBenefitStream,
	forecastAdjustmentFromFactors,
	grossWithdrawalForNet,
	logNormalParameters,
	marginalEarnedRate,
	monteCarloInputFromAppData,
	monthlyReturnFactor,
	monthlyReturnFactors,
	netFromWithdrawal,
	normaliseIncomeStream,
	normaliseMonteCarloInput,
	percentileOf,
	planYearWithdrawals,
	prepareSimulation,
	probabilityOfLastingTo,
	simulatePath,
	simulateRetirement,
	statePensionStream,
	streamIncomeAtAge,
	taxOnEarnedIncome
} from './monte-carlo.js';
import { FULL_STATE_PENSION_ANNUAL } from './state-pension.js';
import { PERSONAL_ALLOWANCE, incomeTax, marginalTaxRate } from './tax.js';

/** Values are money, so compare to the penny rather than to floating-point exactness. */
const PENNY = 0.005;

const JAN_2026 = { month: 1, year: 2026 };

/** @param {number} count @param {number} [seed] @returns {number[]} */
function normals(count, seed = 7) {
	const source = createNormalSource(seed);
	return Array.from({ length: count }, () => source());
}

/** @param {readonly number[]} values @returns {() => number} */
function replay(values) {
	let index = 0;
	return () => values[index++] ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Randomness                                                                  */
/* -------------------------------------------------------------------------- */

describe('createRandomSource', () => {
	it('is deterministic: the same seed replays the same sequence', () => {
		const first = Array.from({ length: 50 }, createRandomSource(42));
		const again = Array.from({ length: 50 }, createRandomSource(42));
		expect(first).toEqual(again);
	});

	it('is a different sequence for a different seed', () => {
		const a = Array.from({ length: 50 }, createRandomSource(42));
		const b = Array.from({ length: 50 }, createRandomSource(43));
		expect(a).not.toEqual(b);
	});

	it('stays inside [0, 1)', () => {
		const uniform = createRandomSource(1);
		for (let index = 0; index < 20_000; index += 1) {
			const value = uniform();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});

	it('is roughly uniform — a mean near a half and every decile populated', () => {
		const uniform = createRandomSource(99);
		const buckets = new Array(10).fill(0);
		let total = 0;
		for (let index = 0; index < 100_000; index += 1) {
			const value = uniform();
			total += value;
			buckets[Math.floor(value * 10)] += 1;
		}
		expect(total / 100_000).toBeCloseTo(0.5, 2);
		for (const bucket of buckets) expect(bucket).toBeGreaterThan(9_000);
	});
});

describe('createNormalSource', () => {
	it('is deterministic and seed-dependent', () => {
		expect(normals(20, 5)).toEqual(normals(20, 5));
		expect(normals(20, 5)).not.toEqual(normals(20, 6));
	});

	it('has mean 0 and standard deviation 1', () => {
		const sample = normals(200_000, 3);
		const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
		const variance =
			sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sample.length - 1);
		expect(mean).toBeCloseTo(0, 2);
		expect(Math.sqrt(variance)).toBeCloseTo(1, 2);
	});

	it('never produces a non-finite draw, which a `log(0)` would', () => {
		const source = createNormalSource(11);
		for (let index = 0; index < 100_000; index += 1) {
			expect(Number.isFinite(source())).toBe(true);
		}
	});
});

/* -------------------------------------------------------------------------- */
/* The log-normal parameterisation — convention (2)                             */
/* -------------------------------------------------------------------------- */

describe('logNormalParameters', () => {
	it('matches the stated moments exactly under the arithmetic basis', () => {
		const params = logNormalParameters({ growthRate: 7, volatility: 15, basis: 'arithmetic' });
		expect(params.meanAnnualReturn).toBeCloseTo(7, 8);
		expect(params.impliedVolatility).toBeCloseTo(15, 8);
		// The median has to sit *below* a stated arithmetic mean — that is the volatility drag.
		expect(params.medianAnnualReturn).toBeLessThan(7);
		expect(params.volatilityDrag).toBeCloseTo(7 - params.medianAnnualReturn, 8);
	});

	it('matches the stated moments exactly under the compound basis', () => {
		const params = logNormalParameters({ growthRate: 5, volatility: 15 });
		expect(params.basis).toBe('compound');
		expect(params.medianAnnualReturn).toBeCloseTo(5, 8);
		expect(params.impliedVolatility).toBeCloseTo(15, 8);
		// And the mean above it, by the same drag.
		expect(params.meanAnnualReturn).toBeGreaterThan(5);
		expect(params.meanAnnualReturn).toBeCloseTo(6.0452, 4);
	});

	it('keeps the median on the growth slider whatever the volatility — convention (4)', () => {
		for (const volatility of [0, 5, 15, 25, 40]) {
			expect(logNormalParameters({ growthRate: 5, volatility }).medianAnnualReturn).toBeCloseTo(
				5,
				8
			);
		}
	});

	it('collapses to the deterministic rate at zero volatility', () => {
		const params = logNormalParameters({ growthRate: 5, volatility: 0 });
		expect(params.sigma).toBe(0);
		expect(params.monthlySigma).toBe(0);
		expect(params.volatilityDrag).toBeCloseTo(0, 10);
		expect(params.meanAnnualReturn).toBeCloseTo(params.medianAnnualReturn, 10);
		expect(Math.exp(params.mu)).toBeCloseTo(1.05, 10);
	});

	it('scales monthly draws by m/12 and s/√12, not by s/12 — convention (3)', () => {
		const params = logNormalParameters({ growthRate: 5, volatility: 15 });
		expect(params.monthlyMu).toBeCloseTo(params.mu / 12, 12);
		expect(params.monthlySigma).toBeCloseTo(params.sigma / Math.sqrt(12), 12);
		// Twelve monthly variances sum to the annual one — the whole point of the √12.
		expect(12 * params.monthlySigma ** 2).toBeCloseTo(params.sigma ** 2, 12);
		// And the wrong scaling would be smaller by a factor of √12, which is what makes it wrong.
		expect(params.monthlySigma / (params.sigma / 12)).toBeCloseTo(Math.sqrt(12), 6);
	});

	it('deflates for inflation by shifting the drift and leaving the log volatility alone', () => {
		const nominal = logNormalParameters({ growthRate: 5, volatility: 15 });
		const real = logNormalParameters({ growthRate: 5, volatility: 15, inflationRate: 2.5 });

		expect(real.sigma).toBeCloseTo(nominal.sigma, 12);
		expect(real.mu).toBeCloseTo(nominal.mu - Math.log(1.025), 12);
		// Fisher, not subtraction — and exactly `fire.js`'s own real rate, so the median simulated path
		// is the deterministic real projection the other tabs draw.
		expect(real.medianAnnualReturn).toBeCloseTo(realGrowthRate(5, 2.5), 8);
		expect(real.realRate).toBeCloseTo(realGrowthRate(5, 2.5), 8);
		expect(real.medianAnnualReturn).toBeLessThan(2.5);
	});

	it('takes a fund fee off the growth the way auto-invest.js does', () => {
		const params = logNormalParameters({ growthRate: 5, volatility: 0, feeRate: 0.22 });
		expect(params.nominalRate).toBeCloseTo(netAnnualGrowthRate(5, 0.22), 10);
		expect(params.medianAnnualReturn).toBeCloseTo(netAnnualGrowthRate(5, 0.22), 8);
	});

	it('tolerates nonsense: a -100% growth rate parameterises rather than producing NaN', () => {
		const params = logNormalParameters({ growthRate: -100, volatility: 15 });
		expect(Number.isFinite(params.mu)).toBe(true);
		expect(Number.isFinite(params.sigma)).toBe(true);
		expect(Number.isFinite(monthlyReturnFactor(params, 0))).toBe(true);
	});

	it('clamps a volatility outside 0…100 and an unparseable rate', () => {
		expect(logNormalParameters({ volatility: -5 }).volatility).toBe(0);
		expect(logNormalParameters({ volatility: 500 }).volatility).toBe(100);
		// @ts-expect-error deliberately wrong type — a half-typed form is a normal state
		expect(logNormalParameters({ growthRate: 'nope' }).statedRate).toBe(5);
	});

	it('reproduces the stated annual mean and volatility when actually simulated', () => {
		const params = logNormalParameters({ growthRate: 6, volatility: 18, basis: 'arithmetic' });
		const nextNormal = createNormalSource(2024);

		const years = 40_000;
		const returns = new Array(years);
		for (let year = 0; year < years; year += 1) {
			let factor = 1;
			for (let month = 0; month < 12; month += 1) {
				factor *= monthlyReturnFactor(params, nextNormal());
			}
			returns[year] = factor;
		}

		const mean = returns.reduce((sum, value) => sum + value, 0) / years;
		const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (years - 1);

		// Twelve monthly draws compound to the annual distribution that was specified — convention (3).
		expect((mean - 1) * 100).toBeCloseTo(6, 0);
		expect(Math.sqrt(variance) * 100).toBeCloseTo(18, 0);
	});
});

describe('monthlyReturnFactor / monthlyReturnFactors', () => {
	it('is the median month at z = 0, and twelve of them compound to the annual rate', () => {
		const params = logNormalParameters({ growthRate: 5, volatility: 15 });
		const factor = monthlyReturnFactor(params, 0);
		expect(factor).toBeCloseTo(Math.exp(params.monthlyMu), 12);
		expect(factor ** 12).toBeCloseTo(1.05, 10);
	});

	it('is always positive, however bad the draw — a pot cannot go negative from the market', () => {
		const params = logNormalParameters({ growthRate: 5, volatility: 40 });
		for (const z of [-10, -5, -1, 0, 1, 5, 10]) {
			expect(monthlyReturnFactor(params, z)).toBeGreaterThan(0);
		}
	});

	it('draws one factor per month, in order', () => {
		const params = logNormalParameters({ growthRate: 5, volatility: 15 });
		const sequence = [1, -1, 0.5];
		const factors = monthlyReturnFactors(params, 3, replay(sequence));
		expect(factors).toHaveLength(3);
		factors.forEach((factor, index) => {
			expect(factor).toBeCloseTo(monthlyReturnFactor(params, sequence[index]), 12);
		});
	});
});

/* -------------------------------------------------------------------------- */
/* The month is forecast.js's month — convention (5)                           */
/* -------------------------------------------------------------------------- */

describe('forecastAdjustmentFromFactors', () => {
	it('hands a drawn path to forecast.js as a per-month factor override', () => {
		const adjust = forecastAdjustmentFromFactors([1.01, 0.98]);
		expect(adjust(1)).toEqual({ factor: 1.01 });
		expect(adjust(2)).toEqual({ factor: 0.98 });
		// Past the end of the array a month projects normally rather than throwing.
		expect(adjust(3)).toBeNull();
	});

	it('makes an accumulation path exactly what projectScenario would have produced', () => {
		const plan = prepareSimulation({
			currentAge: 40,
			// Retiring at the target age leaves the whole run in accumulation, which is the phase
			// `forecast.js` also models — the comparison is only meaningful where both do the same job.
			retirementAge: 50,
			targetAge: 50,
			pensionPot: 10_000,
			pensionContribution: 100,
			growthRate: 5,
			volatility: 15,
			start: JAN_2026
		});

		const draws = normals(120, 31);
		const path = simulatePath(plan, replay(draws));
		const factors = draws.map((z) => monthlyReturnFactor(plan.distribution, z));

		const points = projectScenario(
			{
				investments: [
					createInvestment({
						id: 'inv_a',
						value: 10_000,
						monthly_contribution: 100,
						contribution_frequency: 'monthly',
						fund_fee: 0
					})
				],
				start: JAN_2026,
				months: 120
			},
			{ adjustMonth: forecastAdjustmentFromFactors(factors) }
		);

		expect(plan.years).toBe(10);
		// To the penny, every year, because it is the same arithmetic in the same order.
		for (let year = 0; year <= plan.years; year += 1) {
			expect(path.values[year]).toBe(points[year * 12].investments);
		}
	});
});

/* -------------------------------------------------------------------------- */
/* Sequence-of-returns risk — convention (1)                                   */
/* -------------------------------------------------------------------------- */

describe('sequence of returns', () => {
	/**
	 * @param {import('./monte-carlo.js').MonteCarloInputPatch} overrides
	 * @param {readonly number[]} draws
	 */
	function terminalUnder(overrides, draws) {
		const plan = prepareSimulation({
			currentAge: 60,
			retirementAge: 60,
			targetAge: 90,
			isaPot: 500_000,
			growthRate: 5,
			volatility: 15,
			start: JAN_2026,
			...overrides
		});
		return simulatePath(plan, replay(draws));
	}

	const draws = normals(360, 17);
	const reversed = [...draws].reverse();

	it('leaves an untouched pot where it was when the same returns arrive in a different order', () => {
		// No contributions, no withdrawals: the terminal value is a product, and multiplication
		// commutes. Only the pence-rounding carried month to month can differ at all.
		const forwards = terminalUnder({ targetIncome: 0 }, draws);
		const backwards = terminalUnder({ targetIncome: 0 }, reversed);
		expect(Math.abs(forwards.terminalValue - backwards.terminalValue)).toBeLessThan(1);
	});

	it('changes the outcome materially once income is being drawn from it', () => {
		const forwards = terminalUnder({ targetIncome: 25_000 }, draws);
		const backwards = terminalUnder({ targetIncome: 25_000 }, reversed);

		// Same returns, same average, same plan — a different order, and a materially different
		// retirement. This is the whole reason this module exists rather than one more average.
		expect(Math.abs(forwards.terminalValue - backwards.terminalValue)).toBeGreaterThan(50_000);
	});

	it('is what makes dispersion cost a plan, at an unchanged median return', () => {
		/** @param {number} volatility */
		const successAt = (volatility) =>
			simulateRetirement({
				currentAge: 60,
				retirementAge: 60,
				targetAge: 95,
				isaPot: 600_000,
				targetIncome: 30_000,
				growthRate: 5,
				volatility,
				paths: 2_000,
				start: JAN_2026
			}).successProbability;

		// The median annual return is 5% in all three (convention 4), so this is dispersion alone.
		const calm = successAt(2);
		const normal = successAt(15);
		const wild = successAt(30);
		expect(calm).toBeGreaterThan(normal);
		expect(normal).toBeGreaterThan(wild);
	});
});

/* -------------------------------------------------------------------------- */
/* Tax — conventions (7) and (8)                                               */
/* -------------------------------------------------------------------------- */

describe('taxOnEarnedIncome / marginalEarnedRate', () => {
	it('agrees with tax.js to the penny across the whole ladder, in both regions', () => {
		const incomes = [
			0, 1, 5_000, 12_569, 12_570, 12_571, 20_000, 37_700, 50_270, 60_000, 99_999, 100_000, 110_000,
			125_139, 125_140, 130_000, 250_000
		];

		for (const region of ['england_wales_ni', 'scotland']) {
			for (const income of incomes) {
				expect(taxOnEarnedIncome(income, region)).toBe(incomeTax(income, region));
				expect(marginalEarnedRate(income, region)).toBe(marginalTaxRate(income, region));
			}
		}
	});

	it('agrees with tax.js on a fine sweep too, so the two cannot have drifted', () => {
		for (let income = 0; income <= 200_000; income += 137) {
			expect(taxOnEarnedIncome(income)).toBe(incomeTax(income));
			expect(taxOnEarnedIncome(income, 'scotland')).toBe(incomeTax(income, 'scotland'));
		}
	});

	it('defaults to England/Wales/NI and tolerates an unknown region', () => {
		expect(taxOnEarnedIncome(50_000, 'narnia')).toBe(incomeTax(50_000));
	});
});

describe('netFromWithdrawal', () => {
	it('leaves a wholly tax-free withdrawal alone — an ISA is an ISA', () => {
		expect(netFromWithdrawal(20_000, 40_000, 100)).toBe(20_000);
	});

	it('taxes three quarters of a pension withdrawal, against the allowance left over', () => {
		// £20,000 gross, £5,000 tax-free, £15,000 taxable and nothing else in the year: £12,570 of it
		// is covered by the personal allowance, £2,430 is taxed at 20%.
		expect(netFromWithdrawal(20_000, 0, 25)).toBeCloseTo(20_000 - 486, 2);
	});

	it('charges the extra tax the withdrawal causes, not the tax on it in isolation', () => {
		// The same withdrawal on top of an income that has already used the allowance costs more.
		const alone = netFromWithdrawal(20_000, 0, 25);
		const onTop = netFromWithdrawal(20_000, PERSONAL_ALLOWANCE, 25);
		expect(onTop).toBeLessThan(alone);
		expect(20_000 - onTop).toBeCloseTo(15_000 * 0.2, 2);
	});
});

describe('grossWithdrawalForNet', () => {
	it('solves the gross-up exactly, everywhere on the ladder including the 60% taper band', () => {
		const cases = [
			{ netNeeded: 1_000, otherEarnedIncome: 0 },
			{ netNeeded: 12_000, otherEarnedIncome: 0 },
			{ netNeeded: 25_000, otherEarnedIncome: 11_500 },
			{ netNeeded: 30_000, otherEarnedIncome: 12_570 },
			{ netNeeded: 45_000, otherEarnedIncome: 40_000 },
			// Straight through the personal allowance taper, where the marginal rate is 60%.
			{ netNeeded: 60_000, otherEarnedIncome: 90_000 },
			{ netNeeded: 120_000, otherEarnedIncome: 60_000 },
			{ netNeeded: 200_000, otherEarnedIncome: 0 }
		];

		for (const region of ['england_wales_ni', 'scotland']) {
			for (const taxFreeShare of [0, 25, 60, 100]) {
				for (const input of cases) {
					const result = grossWithdrawalForNet({ ...input, taxFreeShare, region });
					expect(result.net).toBeCloseTo(input.netNeeded, 1);
					expect(result.shortfall).toBeLessThanOrEqual(0.1);
					expect(result.gross).toBeGreaterThanOrEqual(input.netNeeded - PENNY);
					expect(result.tax).toBeCloseTo(result.gross - result.net, 2);
				}
			}
		}
	});

	it('needs no grossing up at all when the withdrawal is tax-free', () => {
		const result = grossWithdrawalForNet({ netNeeded: 30_000, taxFreeShare: 100 });
		expect(result.gross).toBe(30_000);
		expect(result.tax).toBe(0);
		expect(result.capped).toBe(false);
	});

	it('reports what a pot could not cover rather than pretending it did', () => {
		const result = grossWithdrawalForNet({
			netNeeded: 30_000,
			taxFreeShare: 100,
			available: 12_000
		});
		expect(result.gross).toBe(12_000);
		expect(result.net).toBe(12_000);
		expect(result.shortfall).toBe(18_000);
		expect(result.capped).toBe(true);
	});

	it('asks for nothing when nothing is needed', () => {
		const result = grossWithdrawalForNet({ netNeeded: 0, taxFreeShare: 25 });
		expect(result).toEqual({ gross: 0, net: 0, tax: 0, shortfall: 0, capped: false });
	});
});

/* -------------------------------------------------------------------------- */
/* Promised income streams — convention (9)                                    */
/* -------------------------------------------------------------------------- */

describe('income streams', () => {
	it('normalises a half-filled stream rather than throwing', () => {
		expect(normaliseIncomeStream()).toEqual({
			id: 'income',
			label: 'Other income',
			annualIncome: 0,
			startAge: 0,
			endAge: null,
			taxTreatment: 'earned_income'
		});
		// @ts-expect-error deliberately wrong types
		const messy = normaliseIncomeStream({ annualIncome: '5000', startAge: 66.6, endAge: 10 });
		expect(messy.annualIncome).toBe(0);
		expect(messy.startAge).toBe(67);
		// An end age before the start would pay for negative years, so it is pulled up to the start.
		expect(messy.endAge).toBe(67);
	});

	it('pays a stream from its start age, inclusive, until its end age, exclusive', () => {
		const streams = [
			normaliseIncomeStream({ id: 'sp', annualIncome: 12_000, startAge: 67 }),
			normaliseIncomeStream({ id: 'bridge', annualIncome: 5_000, startAge: 60, endAge: 67 }),
			normaliseIncomeStream({
				id: 'trust',
				annualIncome: 2_000,
				startAge: 0,
				taxTreatment: 'tax_free'
			})
		];

		expect(streamIncomeAtAge(streams, 59)).toMatchObject({ earned: 0, taxFree: 2_000 });
		expect(streamIncomeAtAge(streams, 60)).toMatchObject({ earned: 5_000, taxFree: 2_000 });
		expect(streamIncomeAtAge(streams, 66)).toMatchObject({ earned: 5_000 });
		expect(streamIncomeAtAge(streams, 67)).toMatchObject({ earned: 12_000, total: 14_000 });
		expect(streamIncomeAtAge(streams, 90).active.map((stream) => stream.id)).toEqual([
			'sp',
			'trust'
		]);
	});

	it('reads the State Pension off state-pension.js, at its own State Pension age', () => {
		const stream = statePensionStream([createPension({ type: 'state', ni_qualifying_years: 35 })], {
			dob_year: 1985,
			dob_month: 6
		});
		expect(stream.annualIncome).toBe(FULL_STATE_PENSION_ANNUAL);
		// Born after April 1977, so State Pension age 68 under the legislated timetable.
		expect(stream.startAge).toBe(68);
		expect(stream.taxTreatment).toBe('earned_income');
	});

	it('reads Defined Benefit income off defined-benefit.js, from the retirement age given', () => {
		const stream = definedBenefitStream(
			[createPension({ type: 'db_final_salary', db_annual_income: 9_000 })],
			{ startAge: 60 }
		);
		expect(stream.annualIncome).toBe(9_000);
		expect(stream.startAge).toBe(60);
	});
});

/* -------------------------------------------------------------------------- */
/* Normalising and preparing                                                   */
/* -------------------------------------------------------------------------- */

describe('normaliseMonteCarloInput', () => {
	it('defaults to README.md’s 5,000 paths', () => {
		expect(DEFAULT_SIMULATION_PATHS).toBe(5000);
		expect(normaliseMonteCarloInput().paths).toBe(5000);
		expect(normaliseMonteCarloInput().returnBasis).toBe('compound');
		expect(normaliseMonteCarloInput().withdrawalOrder).toBe('pension_first');
		expect(normaliseMonteCarloInput().pensionTaxFreeShare).toBe(25);
	});

	it('clamps paths, sample paths and the horizon', () => {
		expect(normaliseMonteCarloInput({ paths: 0 }).paths).toBe(1);
		expect(normaliseMonteCarloInput({ paths: 1e9 }).paths).toBe(MAX_SIMULATION_PATHS);
		expect(normaliseMonteCarloInput({ samplePaths: -3 }).samplePaths).toBe(0);
		expect(normaliseMonteCarloInput({ samplePaths: 1e6 }).samplePaths).toBe(MAX_SAMPLE_PATHS);
		// Ages themselves stop at 120…
		expect(normaliseMonteCarloInput({ currentAge: 40, targetAge: 400 }).targetAge).toBe(120);
		// …and the horizon between two legitimate ages stops at a century.
		expect(normaliseMonteCarloInput({ currentAge: 0, targetAge: 120 }).targetAge).toBe(
			MAX_SIMULATION_YEARS
		);
	});

	it('orders the three ages rather than rejecting them', () => {
		// A retirement age behind you means "already retired", not an error.
		const past = normaliseMonteCarloInput({ currentAge: 70, retirementAge: 60, targetAge: 95 });
		expect(past.retirementAge).toBe(70);

		// A target age dragged below the retirement age is pulled back up to it.
		const crossed = normaliseMonteCarloInput({ currentAge: 40, retirementAge: 67, targetAge: 50 });
		expect(crossed.targetAge).toBe(67);
	});

	it('coerces money, rates and enums, and never throws on nonsense', () => {
		const input = normaliseMonteCarloInput({
			pensionPot: -100,
			// @ts-expect-error deliberately wrong types
			isaPot: 'lots',
			growthRate: 900,
			volatility: -4,
			inflationRate: -900,
			feeRate: 400,
			// @ts-expect-error deliberately wrong types
			returnBasis: 'vibes',
			// @ts-expect-error deliberately wrong types
			withdrawalOrder: 'whatever',
			// @ts-expect-error deliberately wrong types
			taxRegion: 'narnia',
			// @ts-expect-error deliberately wrong types
			streams: 'none'
		});

		expect(input.pensionPot).toBe(0);
		expect(input.isaPot).toBe(0);
		expect(input.growthRate).toBe(100);
		expect(input.volatility).toBe(0);
		expect(input.inflationRate).toBe(-100);
		expect(input.feeRate).toBe(100);
		expect(input.returnBasis).toBe('compound');
		expect(input.withdrawalOrder).toBe('pension_first');
		expect(input.taxRegion).toBe('england_wales_ni');
		expect(input.streams).toEqual([]);
	});

	it('does not deflate a growth rate nobody asked to have deflated', () => {
		expect(DEFAULT_MONTE_CARLO_INPUT.inflationRate).toBe(0);
	});
});

describe('prepareSimulation', () => {
	const plan = prepareSimulation({
		currentAge: 55,
		retirementAge: 60,
		targetAge: 90,
		targetIncome: 30_000,
		streams: [{ id: 'sp', label: 'State Pension', annualIncome: 12_000, startAge: 67 }],
		start: JAN_2026
	});

	it('builds one year per year of the run', () => {
		expect(plan.years).toBe(35);
		expect(plan.schedule).toHaveLength(35);
		expect(plan.retirementYear).toBe(5);
		expect(plan.schedule[0]).toMatchObject({
			index: 0,
			age: 55,
			calendarYear: 2026,
			retired: false
		});
		expect(plan.schedule.at(-1)).toMatchObject({ age: 89, retired: true });
	});

	it('switches from paying in to drawing out at the retirement age', () => {
		expect(plan.schedule[4].retired).toBe(false);
		expect(plan.schedule[5]).toMatchObject({ age: 60, retired: true });
	});

	it('counts promised income only once drawdown has started', () => {
		// Age 67 while still working would be a stream arriving alongside a salary — not retirement
		// funding, so it is not credited to the plan.
		const working = prepareSimulation({
			currentAge: 60,
			retirementAge: 70,
			targetAge: 90,
			targetIncome: 30_000,
			streams: [{ id: 'sp', label: 'State Pension', annualIncome: 12_000, startAge: 67 }]
		});
		expect(working.schedule[7]).toMatchObject({ age: 67, retired: false, guaranteedEarned: 0 });
		expect(working.schedule[10]).toMatchObject({
			age: 70,
			retired: true,
			guaranteedEarned: 12_000
		});
	});

	it('leaves the pots only the part of the target the promised income does not cover', () => {
		const before = plan.schedule[5]; // age 60, no State Pension yet
		const after = plan.schedule[12]; // age 67, State Pension in payment

		expect(before.guaranteedNet).toBe(0);
		expect(before.netNeededFromPots).toBe(30_000);

		// £12,000 of earned income is entirely inside the personal allowance, so all of it arrives.
		expect(after.guaranteedTax).toBe(0);
		expect(after.guaranteedNet).toBe(12_000);
		expect(after.netNeededFromPots).toBe(18_000);
	});

	it('taxes a promised income big enough to be taxed', () => {
		const rich = prepareSimulation({
			currentAge: 67,
			retirementAge: 67,
			targetAge: 90,
			targetIncome: 60_000,
			streams: [{ id: 'db', label: 'DB', annualIncome: 40_000, startAge: 60 }]
		});
		const year = rich.schedule[0];
		expect(year.guaranteedTax).toBe(incomeTax(40_000));
		expect(year.guaranteedNet).toBeCloseTo(40_000 - incomeTax(40_000), 2);
		expect(year.netNeededFromPots).toBeCloseTo(60_000 - year.guaranteedNet, 2);
	});
});

/* -------------------------------------------------------------------------- */
/* One year's withdrawals                                                      */
/* -------------------------------------------------------------------------- */

describe('planYearWithdrawals', () => {
	/** @param {import('./monte-carlo.js').MonteCarloInputPatch} overrides */
	const planFor = (overrides = {}) =>
		prepareSimulation({
			currentAge: 67,
			retirementAge: 67,
			targetAge: 90,
			targetIncome: 30_000,
			...overrides
		});

	it('takes nothing when the promised income already covers the target', () => {
		const plan = planFor({
			targetIncome: 12_000,
			streams: [{ id: 'sp', label: 'State Pension', annualIncome: 12_000, startAge: 60 }]
		});
		expect(planYearWithdrawals(plan, plan.schedule[0], 500_000, 500_000)).toEqual({
			pension: 0,
			isa: 0,
			shortfall: 0
		});
	});

	it('grosses a pension withdrawal up for tax and an ISA withdrawal not at all', () => {
		const pensionFirst = planFor({ withdrawalOrder: 'pension_first' });
		const isaFirst = planFor({ withdrawalOrder: 'isa_first' });

		const fromPension = planYearWithdrawals(
			pensionFirst,
			pensionFirst.schedule[0],
			500_000,
			500_000
		);
		const fromIsa = planYearWithdrawals(isaFirst, isaFirst.schedule[0], 500_000, 500_000);

		expect(fromIsa.isa).toBe(30_000);
		expect(fromIsa.pension).toBe(0);
		// Three quarters of the pension draw is taxable, so it has to be bigger for the same £30,000.
		expect(fromPension.pension).toBeGreaterThan(30_000);
		expect(fromPension.isa).toBe(0);
		// £32,336.47 gross: £24,252.35 of it taxable, £11,682.35 of that above the personal
		// allowance, £2,336.47 of tax — leaving exactly £30,000 in the hand.
		expect(fromPension.pension).toBe(32_336.47);
		expect(netFromWithdrawal(fromPension.pension, 0, 25)).toBeCloseTo(30_000, 1);
	});

	it('moves on to the next pot when the first cannot cover the year', () => {
		const plan = planFor();
		const result = planYearWithdrawals(plan, plan.schedule[0], 5_000, 500_000);

		expect(result.pension).toBe(5_000);
		expect(result.isa).toBeGreaterThan(0);
		expect(result.shortfall).toBe(0);

		// The ISA only has to cover what the pension's £5,000 did not put in the hand.
		const netFromPension = netFromWithdrawal(5_000, 0, 25);
		expect(result.isa).toBeCloseTo(30_000 - netFromPension, 1);
	});

	it('reports a shortfall when neither pot can fund the year', () => {
		const plan = planFor();
		const result = planYearWithdrawals(plan, plan.schedule[0], 1_000, 2_000);
		expect(result.pension).toBe(1_000);
		expect(result.isa).toBe(2_000);
		expect(result.shortfall).toBeGreaterThan(26_000);
	});

	it('splits a proportional draw by balance, with an exact blended tax-free share', () => {
		const plan = planFor({ withdrawalOrder: 'proportional' });
		const result = planYearWithdrawals(plan, plan.schedule[0], 300_000, 100_000);

		// Three quarters of the pot is the pension, so three quarters of the draw is.
		expect(result.pension / (result.pension + result.isa)).toBeCloseTo(0.75, 6);
		const delivered = netFromWithdrawal(result.pension, 0, 25) + result.isa;
		expect(delivered).toBeCloseTo(30_000, 1);
		expect(result.shortfall).toBe(0);
	});

	it('reports the whole year as a shortfall when both pots are empty', () => {
		const plan = planFor();
		expect(planYearWithdrawals(plan, plan.schedule[0], 0, 0)).toEqual({
			pension: 0,
			isa: 0,
			shortfall: 30_000
		});
	});
});

/* -------------------------------------------------------------------------- */
/* One path                                                                    */
/* -------------------------------------------------------------------------- */

describe('simulatePath', () => {
	it('records the pot at every year end, starting from today', () => {
		const plan = prepareSimulation({
			currentAge: 40,
			retirementAge: 60,
			targetAge: 70,
			pensionPot: 100_000,
			isaPot: 50_000,
			volatility: 0
		});
		const path = simulatePath(plan, () => 0);

		expect(path.values).toHaveLength(31);
		expect(path.values[0]).toBe(150_000);
		expect(path.terminalValue).toBe(path.values[30]);
	});

	it('funds a plan a big enough pot can obviously fund', () => {
		const plan = prepareSimulation({
			currentAge: 67,
			retirementAge: 67,
			targetAge: 90,
			isaPot: 5_000_000,
			targetIncome: 30_000,
			volatility: 0
		});
		const path = simulatePath(plan, () => 0);

		expect(path.success).toBe(true);
		expect(path.firstShortfallAge).toBeNull();
		expect(path.shortfallYears).toBe(0);
		expect(path.totalShortfall).toBe(0);
		expect(path.depletedAge).toBeNull();
	});

	it('fails from the first retirement year when there is nothing to draw on', () => {
		const plan = prepareSimulation({
			currentAge: 60,
			retirementAge: 65,
			targetAge: 90,
			targetIncome: 30_000,
			volatility: 0
		});
		const path = simulatePath(plan, () => 0);

		expect(path.success).toBe(false);
		expect(path.firstShortfallAge).toBe(65);
		expect(path.shortfallYears).toBe(25);
		expect(path.totalShortfall).toBeCloseTo(25 * 30_000, 0);
		// The pot is empty from the start, but "depleted" is only ever said of drawdown.
		expect(path.depletedAge).toBe(65);
	});

	it('succeeds on promised income alone, with no pot at all', () => {
		const plan = prepareSimulation({
			currentAge: 67,
			retirementAge: 67,
			targetAge: 90,
			targetIncome: 12_000,
			streams: [{ id: 'sp', label: 'State Pension', annualIncome: 12_000, startAge: 60 }],
			volatility: 0
		});
		const path = simulatePath(plan, () => 0);
		expect(path.success).toBe(true);
	});

	it('tells a pot that emptied having funded everything from one that fell short', () => {
		// A pot sized to run out right at the end: it is depleted, and it succeeded.
		const plan = prepareSimulation({
			currentAge: 90,
			retirementAge: 90,
			targetAge: 95,
			isaPot: 150_000,
			targetIncome: 30_000,
			growthRate: 0,
			volatility: 0
		});
		const path = simulatePath(plan, () => 0);

		expect(path.success).toBe(true);
		expect(path.depletedAge).toBe(94);
		expect(path.terminalValue).toBe(0);
	});

	it('runs out when fire.js says it runs out, given no volatility and no tax', () => {
		// A tax-free pot, a flat rate and no dispersion is exactly the question `fire.js`'s drawdown
		// answers, so the two have to agree — and if they ever stop agreeing, one of them is wrong.
		const pot = 500_000;
		const targetIncome = 30_000;
		const growthRate = 4;

		const plan = prepareSimulation({
			currentAge: 65,
			retirementAge: 65,
			targetAge: 105,
			isaPot: pot,
			targetIncome,
			growthRate,
			volatility: 0
		});
		const path = simulatePath(plan, () => 0);
		const runway = portfolioRunway({
			pot,
			annualIncome: targetIncome,
			growthRate,
			months: 480
		});

		expect(runway.depleted).toBe(true);
		// The first year this module cannot fund in full is the year `fire.js`'s runway ends in.
		expect(path.firstShortfallAge).toBe(65 + Math.floor(runway.years));
	});

	it('does not call an exactly-funded year a shortfall over rounding pence', () => {
		// The year's plan is paid in twelfths and every pot value is rounded to pence, so an exact
		// plan can land a few pence out. `SHORTFALL_TOLERANCE` is what stops that deciding the answer.
		expect(SHORTFALL_TOLERANCE).toBe(1);
		const plan = prepareSimulation({
			currentAge: 60,
			retirementAge: 60,
			targetAge: 61,
			isaPot: 30_000,
			targetIncome: 30_000,
			growthRate: 0,
			volatility: 0
		});
		expect(simulatePath(plan, () => 0).success).toBe(true);
	});

	it('walks a zero-volatility path down the deterministic real rate', () => {
		const plan = prepareSimulation({
			currentAge: 40,
			retirementAge: 50,
			targetAge: 50,
			isaPot: 100_000,
			growthRate: 5,
			inflationRate: 2.5,
			volatility: 0
		});
		const path = simulatePath(plan, () => 0);

		// Ten years at `fire.js`'s own real rate, compounded monthly — the same number the Forecast and
		// Retirement tabs already show for the same assumption.
		const real = realGrowthRate(5, 2.5) / 100;
		expect(path.terminalValue).toBeCloseTo(100_000 * (1 + real) ** 10, -1);
	});
});

/* -------------------------------------------------------------------------- */
/* The whole simulation                                                        */
/* -------------------------------------------------------------------------- */

describe('simulateRetirement', () => {
	/** @type {import('./monte-carlo.js').MonteCarloInputPatch} */
	const base = {
		currentAge: 40,
		retirementAge: 60,
		targetAge: 95,
		pensionPot: 250_000,
		isaPot: 100_000,
		pensionContribution: 800,
		isaContribution: 400,
		targetIncome: 30_000,
		growthRate: 5,
		volatility: 15,
		inflationRate: 2.5,
		paths: 1_000,
		start: JAN_2026
	};

	const summary = simulateRetirement(base);

	it('runs the paths it was asked for, over the years it was asked for', () => {
		expect(summary.paths).toBe(1_000);
		expect(summary.years).toBe(55);
		expect(summary.retirementYear).toBe(20);
		expect(summary.successes + summary.failures).toBe(1_000);
		expect(summary.band).toHaveLength(56);
	});

	it('is deterministic — the same plan and seed give the same probability', () => {
		expect(simulateRetirement(base).successProbability).toBe(summary.successProbability);
		expect(simulateRetirement({ ...base, seed: DEFAULT_SEED + 1 }).successProbability).not.toBe(
			summary.successProbability
		);
	});

	it('reports a probability, and how much of it is the sample size', () => {
		expect(summary.successProbability).toBeGreaterThan(0);
		expect(summary.successProbability).toBeLessThan(1);
		expect(summary.successPercent).toBeCloseTo(summary.successProbability * 100, 10);
		expect(summary.standardError).toBeCloseTo(
			Math.sqrt((summary.successProbability * (1 - summary.successProbability)) / 1_000),
			10
		);
		expect(summary.successProbability * 1_000).toBeCloseTo(summary.successes, 6);
	});

	it('builds a fan chart whose percentiles are ordered and dated', () => {
		expect(MONTE_CARLO_PERCENTILES).toEqual([5, 10, 25, 50, 75, 90, 95]);

		for (const point of summary.band) {
			const values = MONTE_CARLO_PERCENTILES.map((p) => point.percentiles[`p${p}`]);
			for (let index = 1; index < values.length; index += 1) {
				expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
			}
			expect(point.median).toBe(point.percentiles.p50);
			expect(point.min).toBeLessThanOrEqual(values[0]);
			expect(point.max).toBeGreaterThanOrEqual(values.at(-1) ?? 0);
			expect(point.age).toBe(40 + point.year);
			expect(point.calendarYear).toBe(2026 + point.year);
		}

		expect(summary.band[0].min).toBe(350_000);
		expect(summary.band[0].max).toBe(350_000);
	});

	it('has a mean above its median, because the distribution is right-skewed', () => {
		const atRetirement = summary.band[20];
		expect(atRetirement.mean).toBeGreaterThan(atRetirement.median);
	});

	it('reports the terminal distribution and the share of paths that ran out', () => {
		expect(summary.terminal.median).toBe(summary.band[55].median);
		expect(summary.terminal.mean).toBe(summary.band[55].mean);
		expect(summary.terminal.depletedShare).toBeGreaterThanOrEqual(0);
		expect(summary.terminal.depletedShare).toBeLessThanOrEqual(1);
	});

	it('describes how the failures failed', () => {
		expect(summary.shortfall.paths).toBe(summary.failures);
		expect(summary.shortfall.probability).toBeCloseTo(1 - summary.successProbability, 10);
		expect(summary.shortfall.earliestAge).toBeGreaterThanOrEqual(60);
		expect(summary.shortfall.medianFirstAge ?? 0).toBeGreaterThanOrEqual(
			summary.shortfall.earliestAge ?? 0
		);
		expect(summary.shortfall.meanYears).toBeGreaterThan(0);
		expect(summary.shortfall.medianTotal).toBeGreaterThan(0);
	});

	it('has no failures to describe when there are none', () => {
		const safe = simulateRetirement({ ...base, isaPot: 20_000_000, paths: 50 });
		expect(safe.failures).toBe(0);
		expect(safe.shortfall).toMatchObject({
			paths: 0,
			probability: 0,
			earliestAge: null,
			medianFirstAge: null,
			meanFirstAge: null,
			meanYears: 0
		});
	});

	it('gives a survival curve that only ever falls, and ends on the headline figure', () => {
		expect(summary.survival[0].age).toBe(60);
		expect(summary.survival.at(-1)?.age).toBe(94);

		for (let index = 1; index < summary.survival.length; index += 1) {
			expect(summary.survival[index].probability).toBeLessThanOrEqual(
				summary.survival[index - 1].probability
			);
		}
		expect(summary.survival.at(-1)?.probability).toBeCloseTo(summary.successProbability, 10);
	});

	it('keeps a few complete histories for drawing under the fan', () => {
		expect(summary.samplePaths).toHaveLength(5);
		for (const sample of summary.samplePaths) {
			expect(sample.values).toHaveLength(56);
			expect(sample.terminalValue).toBe(sample.values[55]);
			expect(sample.success).toBe(sample.firstShortfallAge === null);
		}
	});

	it('says when a 100% probability is about the promised income rather than the market', () => {
		const guaranteed = simulateRetirement({
			currentAge: 67,
			retirementAge: 67,
			targetAge: 90,
			targetIncome: 12_000,
			streams: [{ id: 'sp', label: 'State Pension', annualIncome: 12_000, startAge: 60 }],
			paths: 20
		});
		expect(guaranteed.guaranteed).toBe(true);
		expect(guaranteed.successProbability).toBe(1);
		expect(summary.guaranteed).toBe(false);
	});

	it('is helped by the State Pension — convention (9)', () => {
		const without = simulateRetirement({ ...base, paths: 2_000 });
		const with_ = simulateRetirement({
			...base,
			paths: 2_000,
			streams: [
				{ id: 'sp', label: 'State Pension', annualIncome: FULL_STATE_PENSION_ANNUAL, startAge: 67 }
			]
		});
		expect(with_.successProbability).toBeGreaterThan(without.successProbability);
	});

	it('is held back by tax, because tax is real money — convention (8)', () => {
		// The same £600,000, the same market, the same seed. In an ISA every pound drawn arrives; in a
		// pension pot three quarters of it is taxable, so more has to leave the pot for the same
		// income — and the plan is measurably less likely to last.
		/** @param {import('./monte-carlo.js').MonteCarloInputPatch} pots */
		const run = (pots) =>
			simulateRetirement({
				currentAge: 67,
				retirementAge: 67,
				targetAge: 95,
				targetIncome: 30_000,
				growthRate: 5,
				volatility: 15,
				paths: 2_000,
				...pots
			});

		const taxFree = run({ isaPot: 600_000 });
		const taxed = run({ pensionPot: 600_000 });
		expect(taxFree.successProbability).toBeGreaterThan(taxed.successProbability);
	});

	it('supports all three withdrawal orders on a pot split between the two', () => {
		/** @param {import('./monte-carlo.js').WithdrawalOrder} withdrawalOrder */
		const run = (withdrawalOrder) =>
			simulateRetirement({
				currentAge: 67,
				retirementAge: 67,
				targetAge: 95,
				pensionPot: 300_000,
				isaPot: 300_000,
				targetIncome: 30_000,
				growthRate: 5,
				volatility: 15,
				paths: 500,
				withdrawalOrder
			});

		// Which pot is spent first is close to a wash over a whole retirement — spending the pension
		// early pays its tax early and leaves the ISA compounding, spending the ISA early defers the
		// tax and leaves the pension compounding — so this asserts the orders are all *usable*, not
		// that one of them wins. Only the pension-versus-ISA comparison above is a real effect.
		for (const order of ['pension_first', 'isa_first', 'proportional']) {
			const summary = run(/** @type {import('./monte-carlo.js').WithdrawalOrder} */ (order));
			expect(summary.successProbability).toBeGreaterThan(0.5);
			expect(summary.successProbability).toBeLessThan(1);
		}
	});

	it('replays an injected sequence of draws instead of its own, for a known answer', () => {
		const median = simulateRetirement({ ...base, paths: 3 }, { normalSource: () => 0 });
		// Every path is the median path, so they all agree and the probability is 0 or 1.
		expect(new Set(median.samplePaths.map((sample) => sample.terminalValue)).size).toBe(1);
		expect([0, 1]).toContain(median.successProbability);
	});

	it('runs a zero-year plan without falling over', () => {
		const nothing = simulateRetirement({
			currentAge: 90,
			retirementAge: 90,
			targetAge: 90,
			paths: 5
		});
		expect(nothing.years).toBe(0);
		expect(nothing.band).toHaveLength(1);
		expect(nothing.survival).toEqual([]);
		expect(nothing.successProbability).toBe(1);
	});

	it('runs README.md’s own 5,000 paths', () => {
		const full = simulateRetirement({ ...base, paths: DEFAULT_SIMULATION_PATHS });
		expect(full.paths).toBe(5_000);
		expect(full.successes + full.failures).toBe(5_000);
	});
});

describe('probabilityOfLastingTo', () => {
	const summary = simulateRetirement({
		currentAge: 60,
		retirementAge: 60,
		targetAge: 95,
		isaPot: 500_000,
		targetIncome: 30_000,
		growthRate: 5,
		volatility: 15,
		paths: 1_000
	});

	it('is certain before anything is being funded', () => {
		expect(probabilityOfLastingTo(summary, 50)).toBe(1);
	});

	it('agrees with the headline figure at the target age', () => {
		expect(probabilityOfLastingTo(summary, 95)).toBeCloseTo(summary.successProbability, 10);
	});

	it('falls as the age asked about rises', () => {
		expect(probabilityOfLastingTo(summary, 75)).toBeGreaterThanOrEqual(
			probabilityOfLastingTo(summary, 85)
		);
		expect(probabilityOfLastingTo(summary, 85)).toBeGreaterThanOrEqual(
			probabilityOfLastingTo(summary, 95)
		);
	});

	it('stops at the target rather than claiming a certainty past it', () => {
		expect(probabilityOfLastingTo(summary, 200)).toBeCloseTo(summary.successProbability, 10);
	});
});

/* -------------------------------------------------------------------------- */
/* Percentiles                                                                 */
/* -------------------------------------------------------------------------- */

describe('percentileOf', () => {
	it('interpolates between the order statistics either side', () => {
		const sorted = [0, 10, 20, 30, 40];
		expect(percentileOf(sorted, 0)).toBe(0);
		expect(percentileOf(sorted, 50)).toBe(20);
		expect(percentileOf(sorted, 100)).toBe(40);
		expect(percentileOf(sorted, 25)).toBe(10);
		expect(percentileOf(sorted, 30)).toBeCloseTo(12, 10);
	});

	it('handles an empty and a single-valued sample', () => {
		expect(percentileOf([], 50)).toBe(0);
		expect(percentileOf([42], 5)).toBe(42);
	});

	it('clamps a percentile outside 0…100', () => {
		expect(percentileOf([1, 2, 3], -10)).toBe(1);
		expect(percentileOf([1, 2, 3], 500)).toBe(3);
	});
});

/* -------------------------------------------------------------------------- */
/* Reading a plan off the stored document                                      */
/* -------------------------------------------------------------------------- */

describe('monteCarloInputFromAppData', () => {
	const now = new Date('2026-08-08T00:00:00Z');

	const data = createAppData({
		profile: createProfile({
			dob_year: 1986,
			dob_month: 3,
			gross_salary: 60_000,
			growth_rate: 6,
			inflation_rate: 2.5,
			retirement_age: 60,
			retirement_target: 35_000,
			tax_region: 'scotland'
		}),
		pensions: [
			createPension({ type: 'sipp', value: 180_000, contribution_pct: 5, employer_pct: 3 }),
			createPension({ type: 'dc_workplace', value: 20_000, contribution_pct: 0, employer_pct: 0 }),
			createPension({ type: 'db_final_salary', db_annual_income: 8_000 }),
			createPension({ type: 'state', ni_qualifying_years: 30, ni_future_years: 5 }),
			createPension({ type: 'lisa', value: 15_000 })
		],
		monthly_entries: [
			createMonthlyEntry({
				month: 7,
				year: 2026,
				investments: [
					createInvestment({
						id: 'inv_isa',
						wrapper: 'isa_stocks_shares',
						value: 90_000,
						monthly_contribution: 500,
						contribution_frequency: 'monthly'
					}),
					createInvestment({
						id: 'inv_jisa',
						wrapper: 'jisa',
						value: 9_000,
						monthly_contribution: 100
					}),
					createInvestment({
						id: 'inv_sipp',
						wrapper: 'sipp',
						value: 180_000,
						monthly_contribution: 250
					}),
					createInvestment({ id: 'inv_gia', wrapper: 'gia', value: 12_000 })
				]
			})
		]
	});

	const input = monteCarloInputFromAppData(data, {}, { now });

	it('reads the ages and assumptions off the profile', () => {
		expect(input.currentAge).toBe(40);
		expect(input.retirementAge).toBe(60);
		expect(input.growthRate).toBe(6);
		expect(input.inflationRate).toBe(2.5);
		expect(input.taxRegion).toBe('scotland');
		expect(input.targetIncome).toBe(35_000);
	});

	it('counts the pension pot from the Pensions tab, not from the snapshot', () => {
		// The SIPP is recorded in both places; counting both would double the pot.
		expect(input.pensionPot).toBe(200_000);
	});

	it('counts the tax-free pot as the snapshot’s ISAs plus a Lifetime ISA — no Junior ISA', () => {
		expect(input.isaPot).toBe(105_000);
	});

	it('reads pension contributions off the pots’ own percentages and the salary', () => {
		// 5% own + 3% employer of £60,000 = £4,800 a year.
		expect(input.pensionContribution).toBeCloseTo(400, 2);
	});

	it('reads tax-free contributions off the snapshot’s ISA holdings only', () => {
		expect(input.isaContribution).toBe(500);
	});

	it('builds the State Pension and Defined Benefit streams', () => {
		expect(input.streams.map((stream) => stream.id)).toEqual(['state_pension', 'db']);
		const [statePension, db] = input.streams;
		// Born 1986, so State Pension age 68 — the stream starts eight years after retirement at 60.
		expect(statePension.startAge).toBe(68);
		expect(statePension.annualIncome).toBeCloseTo((FULL_STATE_PENSION_ANNUAL * 35) / 35, 0);
		expect(db.annualIncome).toBe(8_000);
		expect(db.startAge).toBe(60);
	});

	it('drops a stream with nothing behind it', () => {
		const bare = monteCarloInputFromAppData(
			{ profile: { dob_year: 1986, retirement_age: 60 } },
			{},
			{ now }
		);
		expect(bare.streams).toEqual([]);
		expect(bare.pensionPot).toBe(0);
		expect(bare.isaPot).toBe(0);
	});

	it('lets a slider win over the stored document', () => {
		const overridden = monteCarloInputFromAppData(
			data,
			{ targetIncome: 50_000, paths: 10 },
			{ now }
		);
		expect(overridden.targetIncome).toBe(50_000);
		expect(overridden.paths).toBe(10);
		expect(overridden.pensionPot).toBe(200_000);
	});

	it('falls back to a default age when no date of birth is recorded', () => {
		const anonymous = monteCarloInputFromAppData({ profile: { dob_year: null } }, {}, { now });
		expect(anonymous.currentAge).toBe(DEFAULT_MONTE_CARLO_INPUT.currentAge);
	});

	it('survives an empty document', () => {
		expect(() => monteCarloInputFromAppData()).not.toThrow();
		expect(monteCarloInputFromAppData().paths).toBe(DEFAULT_SIMULATION_PATHS);
	});
});
