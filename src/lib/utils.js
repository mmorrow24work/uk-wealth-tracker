/**
 * Merge classnames, filtering out empty strings and falsy values.
 * @param {string[]} classes
 * @returns {string}
 */
export function cn(...classes) {
	return classes.filter((x) => typeof x === 'string' && x.length > 0).join(' ');
}
