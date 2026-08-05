import { describe, expect, it } from 'vitest';
import { NAV_TABS, isActiveTab } from './nav.js';

describe('NAV_TABS', () => {
	it('covers every route named in the issue, dashboard first', () => {
		expect(NAV_TABS.map((tab) => tab.id)).toEqual([
			'dashboard',
			'forecast',
			'retirement',
			'tax',
			'pensions',
			'dividends',
			'property',
			'assets',
			'budget',
			'estate'
		]);
	});

	it('has a unique id, href and label per tab', () => {
		expect(new Set(NAV_TABS.map((tab) => tab.id)).size).toBe(NAV_TABS.length);
		expect(new Set(NAV_TABS.map((tab) => tab.href)).size).toBe(NAV_TABS.length);
		expect(new Set(NAV_TABS.map((tab) => tab.label)).size).toBe(NAV_TABS.length);
	});

	it('gives every tab an absolute href starting with /', () => {
		for (const tab of NAV_TABS) {
			expect(tab.href.startsWith('/')).toBe(true);
		}
	});

	it('roots the dashboard tab at / and every other tab at /<id>', () => {
		for (const tab of NAV_TABS) {
			expect(tab.href).toBe(tab.id === 'dashboard' ? '/' : `/${tab.id}`);
		}
	});
});

describe('isActiveTab', () => {
	it('matches the dashboard tab only for the exact root path', () => {
		expect(isActiveTab('/', '/')).toBe(true);
		expect(isActiveTab('/forecast', '/')).toBe(false);
		expect(isActiveTab('/forecast/', '/')).toBe(false);
	});

	it('matches a non-root tab for its exact path', () => {
		expect(isActiveTab('/tax', '/tax')).toBe(true);
	});

	it('matches a non-root tab for nested sub-routes', () => {
		expect(isActiveTab('/tax/2026', '/tax')).toBe(true);
		expect(isActiveTab('/pensions/pot/123', '/pensions')).toBe(true);
	});

	it('does not match a different tab, including ones sharing a prefix', () => {
		expect(isActiveTab('/dividends', '/tax')).toBe(false);
		expect(isActiveTab('/taxonomy', '/tax')).toBe(false);
	});

	it('does not match the root path against a non-root tab', () => {
		expect(isActiveTab('/', '/tax')).toBe(false);
	});
});
