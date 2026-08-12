import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, NAV_TABS, isActiveTab } from './nav.js';

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
			'estate',
			'report',
			'settings'
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

	it('gives every tab a group from NAV_GROUPS, except settings which has none', () => {
		for (const tab of NAV_TABS) {
			if (tab.id === 'settings') {
				expect(tab.group).toBeNull();
			} else {
				expect(NAV_GROUPS).toContain(tab.group);
			}
		}
	});

	it('assigns the groups named in the issue', () => {
		const groupOf = (/** @type {string} */ id) => NAV_TABS.find((tab) => tab.id === id)?.group;
		expect(groupOf('dashboard')).toBe('Money');
		expect(groupOf('property')).toBe('Money');
		expect(groupOf('assets')).toBe('Money');
		expect(groupOf('budget')).toBe('Money');
		expect(groupOf('dividends')).toBe('Money');
		expect(groupOf('forecast')).toBe('Planning');
		expect(groupOf('retirement')).toBe('Planning');
		expect(groupOf('pensions')).toBe('Planning');
		expect(groupOf('tax')).toBe('Tax & Estate');
		expect(groupOf('estate')).toBe('Tax & Estate');
		expect(groupOf('report')).toBe('Tax & Estate');
	});
});

describe('NAV_GROUPS', () => {
	it('names exactly the three sidebar sections, in display order', () => {
		expect(NAV_GROUPS).toEqual(['Money', 'Planning', 'Tax & Estate']);
	});

	it('is exhaustive: every non-null tab group appears in NAV_GROUPS', () => {
		const tabGroups = new Set(NAV_TABS.map((tab) => tab.group).filter((group) => group !== null));
		for (const group of tabGroups) {
			expect(NAV_GROUPS).toContain(group);
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
