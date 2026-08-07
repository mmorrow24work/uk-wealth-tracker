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
 * 		| '/settings',
 * 	label: string
 * }} NavTab
 */

/**
 * Nav shell tab config — one entry per top-level route, in display order.
 * `href` must match a route directory under src/routes/ (or '/' for the dashboard),
 * and is typed as a literal so `$app/paths`' `resolve()` accepts it directly.
 * See README.md "Project Structure" for the target route list.
 *
 * @type {NavTab[]}
 */
export const NAV_TABS = [
	{ id: 'dashboard', href: '/', label: 'Net Worth' },
	{ id: 'forecast', href: '/forecast', label: 'Forecast' },
	{ id: 'retirement', href: '/retirement', label: 'Retirement' },
	{ id: 'tax', href: '/tax', label: 'Tax' },
	{ id: 'pensions', href: '/pensions', label: 'Pensions' },
	{ id: 'dividends', href: '/dividends', label: 'Dividends' },
	{ id: 'property', href: '/property', label: 'Property' },
	{ id: 'assets', href: '/assets', label: 'Assets' },
	{ id: 'budget', href: '/budget', label: 'Budget' },
	{ id: 'estate', href: '/estate', label: 'Estate' },
	{ id: 'settings', href: '/settings', label: 'Settings' }
];

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
