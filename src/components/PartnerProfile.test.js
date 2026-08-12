/**
 * Server-rendered smoke tests for the Partner profile panel (issue #170).
 *
 * As `PensionTracker.test.js`/`MarriageAllowance.test.js` document: no browser test environment,
 * so `svelte/server`'s `render` covers the initial render only — what a user sees for a given
 * `partner` prop, before touching an input. The two interesting initial-render branches are the
 * empty state (`partner: null`) and a populated partner's rendered fields; the commit-on-input and
 * remove behaviour is straightforward state-juggling covered by `npm run build && npm run preview`
 * manual verification instead, the same convention `PensionTracker`'s own test file documents.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createPartner } from '$lib/model.js';
import PartnerProfile from './PartnerProfile.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(PartnerProfile, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ');
}

/**
 * The rendered markup as-is, tags included — for asserting an input's `value`/`placeholder`
 * attribute, which `text()`'s tag-stripping throws away along with the tags themselves.
 *
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function html(props = {}) {
	return render(PartnerProfile, { props }).body;
}

describe('PartnerProfile', () => {
	it('shows the empty state when there is no partner recorded', () => {
		const body = text({ partner: null });

		expect(body).toContain('No partner recorded');
		expect(body).toContain('Add a partner');
	});

	it('does not show the form fields in the empty state', () => {
		const body = text({ partner: null });

		expect(body).not.toContain('Birth month');
		expect(body).not.toContain('Remove partner');
	});

	it("shows a populated partner's fields", () => {
		const props = {
			partner: createPartner({
				name: 'Alex',
				dob_month: 6,
				dob_year: 1985,
				retirement_age: 60,
				gross_salary: 45_000,
				pension_pct: 5,
				ni_qualifying_years: 20
			})
		};

		expect(text(props)).toContain('Remove partner');
		const body = html(props);
		expect(body).toContain('value="Alex"');
		expect(body).toContain('value="6"');
		expect(body).toContain('value="1985"');
		expect(body).toContain('value="60"');
		expect(body).toContain('value="45000"');
		expect(body).toContain('value="5"');
		expect(body).toContain('value="20"');
	});

	it('leaves the optional fields blank rather than zero for a freshly-added default partner', () => {
		const props = { partner: createPartner() };

		expect(text(props)).not.toContain('Add a partner');
		// `createPartner()`'s own defaults: no name, no DOB, no NI years recorded yet.
		const body = html(props);
		expect(body).toContain('placeholder="e.g. Alex"');
		expect(body).toContain('placeholder="e.g. 6"');
		expect(body).toContain('placeholder="e.g. 1985"');
		expect(body).toContain('placeholder="e.g. 20"');
	});

	it('surfaces validatePartner failures for an out-of-range partner rather than silently accepting them', () => {
		const body = text({
			partner: createPartner({ dob_month: 13, retirement_age: 200, pension_pct: -5 })
		});

		expect(body).toContain('Birth month');
		expect(body).toContain('must be a month from 1 to 12, or null');
		expect(body).toContain('Retirement age');
		expect(body).toContain('must be 16–120');
		expect(body).toContain('Pension contribution');
		expect(body).toContain('must be 0–100%');
	});

	it('shows no validation errors for a sensible partner', () => {
		const body = text({ partner: createPartner({ name: 'Sam', retirement_age: 65 }) });

		expect(body).not.toContain('must be');
	});
});
