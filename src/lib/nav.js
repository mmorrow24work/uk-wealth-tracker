/**
 * @typedef {'Money' | 'Planning' | 'Tax & Estate'} NavGroup
 */

/**
 * @typedef {{
 * 	id: string,
 * 	href:
 * 		| '/'
 * 		| '/forecast'
 * 		| '/retirement'
 * 		| '/tax'
 * 		| '/pensions'
 * 		| '/dividends'
 * 		| '/property'
 * 		| '/assets'
 * 		| '/budget'
 * 		| '/estate'
 * 		| '/report'
 * 		| '/settings',
 * 	label: string,
 * 	group: NavGroup | null
 * }} NavTab
 */

/**
 * Nav shell tab config — one entry per top-level route, in display order.
 * `href` must match a route directory under src/routes/ (or '/' for the dashboard),
 * and is typed as a literal so `$app/paths`' `resolve()` accepts it directly.
 * See README.md "Project Structure" for the target route list.
 *
 * `group` is the sidebar section (#242/#243) each tab renders under — Money, Planning
 * or Tax & Estate. `settings` deliberately carries `group: null`: it's account/preferences-level
 * rather than a feature tab, and the sidebar pins it at the bottom outside the three named
 * groups rather than filing it under any of them.
 *
 * @type {NavTab[]}
 */
export const NAV_TABS = [
	{ id: 'dashboard', href: '/', label: '💰 Net Worth', group: 'Money' },
	{ id: 'forecast', href: '/forecast', label: '📈 Forecast', group: 'Planning' },
	{ id: 'retirement', href: '/retirement', label: '🏖️ Retirement', group: 'Planning' },
	{ id: 'tax', href: '/tax', label: '🧾 Tax', group: 'Tax & Estate' },
	{ id: 'pensions', href: '/pensions', label: '👴 Pensions', group: 'Planning' },
	{ id: 'dividends', href: '/dividends', label: '💷 Dividends', group: 'Money' },
	{ id: 'property', href: '/property', label: '🏠 Property', group: 'Money' },
	{ id: 'assets', href: '/assets', label: '💎 Assets', group: 'Money' },
	{ id: 'budget', href: '/budget', label: '📅 Budget', group: 'Money' },
	{ id: 'estate', href: '/estate', label: '🏛️ Estate', group: 'Tax & Estate' },
	{ id: 'report', href: '/report', label: '🖨️ Report', group: 'Tax & Estate' },
	{ id: 'settings', href: '/settings', label: '⚙️ Settings', group: null }
];

/**
 * The three named sidebar sections, in display order — the sidebar (`+layout.svelte`)
 * iterates this rather than deriving group order from `NAV_TABS`' own tab order, since
 * a group's tabs aren't contiguous in `NAV_TABS` (e.g. Money's `dashboard` comes before
 * Planning's `forecast`, but Money's `dividends` comes after it).
 *
 * @type {NavGroup[]}
 */
export const NAV_GROUPS = ['Money', 'Planning', 'Tax & Estate'];

/**
 * Whether `pathname` should mark the tab at `href` as active.
 * The dashboard tab ('/') matches only the exact root path, since every other
 * route's pathname also starts with '/'. Every other tab matches its own path
 * and any nested sub-route under it (e.g. `/tax/2026` still highlights Tax).
 *
 * @param {string} pathname
 * @param {string} href
 * @returns {boolean}
 */
export function isActiveTab(pathname, href) {
	if (href === '/') return pathname === '/';
	return pathname === href || pathname.startsWith(href + '/');
}
