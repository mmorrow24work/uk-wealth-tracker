/**
 * Server-rendered smoke tests for the combined "all properties" equity chart — issue #279.
 *
 * Same approach and same limits `PropertyTracker.test.js`/`NetWorthChart.test.js` document: no
 * browser test environment, so `svelte/server`'s `render` covers only the markup outside `<Chart>`
 * — the empty state, the legend, the accessible summary and the table fallback. The hover tooltip's
 * words are `propertyPortfolioTooltipReading`, a pure function exported from the component's
 * `<script module>` block, tested directly in its own describe block below.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createProperty } from '$lib/model.js';
import { propertyEquityProjection } from '$lib/property.js';
import PropertyPortfolioEquityChart, {
	propertyPortfolioTooltipReading
} from './PropertyPortfolioEquityChart.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(PropertyPortfolioEquityChart, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function body(props = {}) {
	return render(PropertyPortfolioEquityChart, { props }).body;
}

describe('PropertyPortfolioEquityChart', () => {
	it('says there is nothing to plot with no properties', () => {
		const rendered = text({ properties: [] });
		expect(rendered).toContain('No properties recorded');
	});

	it('renders without a properties prop at all', () => {
		expect(text()).toContain('No properties recorded');
	});

	it('names every property in the legend, in order', () => {
		const rendered = text({
			properties: [
				createProperty({ name: 'Home', value: 300_000, mortgage_balance: 180_000 }),
				createProperty({ name: 'Buy to let', value: 200_000, mortgage_balance: 100_000 })
			]
		});
		expect(rendered).toContain('Home');
		expect(rendered).toContain('Buy to let');
	});

	it('falls back to "Unnamed property" when a property has no name', () => {
		const rendered = text({
			properties: [
				createProperty({ name: '', value: 100_000 }),
				createProperty({ name: 'Named', value: 200_000 })
			]
		});
		expect(rendered).toContain('Unnamed property');
		expect(rendered).toContain('Named');
	});

	it('plots a single property the same way the picker would show one line', () => {
		const rendered = body({
			properties: [createProperty({ name: 'Solo', value: 300_000, mortgage_balance: 100_000 })]
		});
		expect(rendered).toContain('Solo');
		expect(rendered).toContain('role="img"');
	});

	it('gives the chart an accessible summary naming each property', () => {
		const rendered = body({
			properties: [
				createProperty({ name: 'Home', value: 300_000, mortgage_balance: 180_000, growth_rate: 3 }),
				createProperty({
					name: 'Rental',
					value: 200_000,
					mortgage_balance: 100_000,
					growth_rate: 3
				})
			],
			years: 5
		});
		expect(rendered).toContain('role="img"');
		expect(rendered).toContain('comparing projected equity for 2 properties');
		expect(rendered).toContain('Home:');
		expect(rendered).toContain('Rental:');
	});

	it('uses singular phrasing in the summary for exactly one property', () => {
		const rendered = body({
			properties: [createProperty({ name: 'Solo', value: 300_000 })],
			years: 5
		});
		expect(rendered).toContain('comparing projected equity for 1 property ');
	});

	it('offers a table with one column per property', () => {
		const rendered = text({
			properties: [
				createProperty({ name: 'Home', value: 300_000, mortgage_balance: 180_000 }),
				createProperty({ name: 'Rental', value: 200_000, mortgage_balance: 100_000 })
			],
			years: 5
		});
		expect(rendered).toContain('Show as a table');
		expect(rendered).toContain('Year');
		expect(rendered).toContain('£120,000'); // Home's equity today
		expect(rendered).toContain('£100,000'); // Rental's equity today
	});

	it('honours the years horizon the way the single-property chart does', () => {
		const rendered = body({
			properties: [createProperty({ name: 'Home', value: 300_000, growth_rate: 0 })],
			years: 3
		});
		expect(rendered).toContain('Year 3');
		expect(rendered).not.toContain('Year 4');
	});
});

describe('propertyPortfolioTooltipReading', () => {
	/**
	 * @param {import('$lib/types.js').Property} property
	 * @param {number} index
	 * @param {number} [years]
	 */
	function series(property, index, years = 5) {
		return {
			id: property.id,
			name: property.name || 'Unnamed property',
			color: `hsl(var(--chart-${index + 1}))`,
			points: propertyEquityProjection(property, years)
		};
	}

	it('reads one row per property, coloured to match its line', () => {
		const home = createProperty({ name: 'Home', value: 300_000, mortgage_balance: 180_000 });
		const rental = createProperty({ name: 'Rental', value: 200_000, mortgage_balance: 100_000 });
		const seriesList = [series(home, 0), series(rental, 1)];

		const reading = propertyPortfolioTooltipReading(
			{ year: 0, [home.id]: 120_000, [rental.id]: 100_000 },
			seriesList
		);

		expect(reading?.heading).toBe('Today');
		expect(reading?.rows).toEqual([
			{ label: 'Home', value: '£120,000', color: 'hsl(var(--chart-1))' },
			{ label: 'Rental', value: '£100,000', color: 'hsl(var(--chart-2))' }
		]);
	});

	it('labels year zero "Today" and later years "Year N"', () => {
		const home = createProperty({ name: 'Home', value: 300_000 });
		const seriesList = [series(home, 0)];

		expect(
			propertyPortfolioTooltipReading({ year: 0, [home.id]: 300_000 }, seriesList)?.heading
		).toBe('Today');
		expect(
			propertyPortfolioTooltipReading({ year: 4, [home.id]: 300_000 }, seriesList)?.heading
		).toBe('Year 4');
	});

	it('says nothing when no year is hovered', () => {
		expect(propertyPortfolioTooltipReading(null, [])).toBeNull();
		expect(propertyPortfolioTooltipReading(undefined, [])).toBeNull();
	});

	it('drops a property with no figure for the hovered year rather than showing £NaN', () => {
		const home = createProperty({ name: 'Home', value: 300_000 });
		const rental = createProperty({ name: 'Rental', value: 200_000 });
		const seriesList = [series(home, 0), series(rental, 1)];

		// Only `home` has a figure for this row — `rental`'s projection was shorter, say.
		const reading = propertyPortfolioTooltipReading({ year: 2, [home.id]: 310_000 }, seriesList);

		expect(reading?.rows).toEqual([
			{ label: 'Home', value: '£310,000', color: 'hsl(var(--chart-1))' }
		]);
	});

	it('reads an underwater property as negative equity rather than dropping it', () => {
		const home = createProperty({ name: 'Home', value: 300_000 });
		const seriesList = [series(home, 0)];

		const reading = propertyPortfolioTooltipReading({ year: 0, [home.id]: -5_000 }, seriesList);

		expect(reading?.rows[0].value).toBe('-£5,000');
	});
});
