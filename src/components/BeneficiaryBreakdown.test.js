/**
 * Server-rendered smoke tests for the beneficiary list, its entry form, and the priced who-gets-what
 * breakdown (issues #167 and #191).
 *
 * As `AssetsTracker.test.js` documents: no browser test environment, so `svelte/server`'s `render`
 * covers the initial render only — the empty state, the form fields, each beneficiary's own summary
 * line, and, once `netAfterTax` is passed, the £ figure and allocation warning it derives. The
 * add/edit/remove logic itself is straightforward state-juggling (mirroring `AssetsTracker`, which
 * does not test that part either) left to `npm run build && npm run preview` manual verification
 * instead.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import { createBeneficiary } from '$lib/model.js';
import BeneficiaryBreakdown from './BeneficiaryBreakdown.svelte';

/**
 * @param {Record<string, unknown>} props
 * @returns {string}
 */
function text(props = {}) {
	const { body } = render(BeneficiaryBreakdown, { props });
	return body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

describe('BeneficiaryBreakdown', () => {
	it('shows an invitation, not an empty table, when no beneficiaries are recorded', () => {
		const body = text();
		expect(body).toContain('No beneficiaries recorded yet');
	});

	it('lists the name, relationship, share and notes fields in the form', () => {
		const body = text();
		expect(body).toContain('Name');
		expect(body).toContain('Relationship');
		expect(body).toContain('Wished share (%)');
		expect(body).toContain('Notes');
	});

	it("shows a beneficiary's name, relationship, wished share and notes on its own row", () => {
		const body = text({
			beneficiaries: [
				createBeneficiary({
					name: 'Jess',
					relationship: 'Daughter',
					share_pct: 60,
					notes: 'Eldest child'
				})
			]
		});

		expect(body).toContain('Jess');
		expect(body).toContain('Daughter');
		expect(body).toContain('60%');
		expect(body).toContain('Eldest child');
	});

	it('shows no pounds figure anywhere on a beneficiary row', () => {
		const body = text({
			beneficiaries: [createBeneficiary({ name: 'Jess', relationship: 'Daughter', share_pct: 60 })]
		});
		expect(body).not.toContain('£');
	});

	it('flags a missing relationship rather than showing a blank', () => {
		const body = text({ beneficiaries: [createBeneficiary({ name: 'Anon', share_pct: 10 })] });
		expect(body).toContain('Relationship not recorded');
	});

	it('saves a beneficiary list whose shares do not sum to 100 without adjustment', () => {
		const body = text({
			beneficiaries: [
				createBeneficiary({ name: 'Alex', relationship: 'Spouse', share_pct: 80 }),
				createBeneficiary({ name: 'Sam', relationship: 'Son', share_pct: 80 })
			]
		});
		expect(body).toContain('80%');
		expect(body).toContain('2 beneficiaries recorded');
		// Neither rescaled to fit 100 nor flagged as over-allocated — that is #191's job.
		expect(body).not.toContain('over-allocated');
		expect(body).not.toContain('160%');
	});

	it('uses singular "beneficiary" for exactly one recorded beneficiary', () => {
		const body = text({
			beneficiaries: [createBeneficiary({ name: 'Solo', relationship: 'Spouse', share_pct: 100 })]
		});
		expect(body).toContain('1 beneficiary recorded');
	});

	it('labels the submit button "Add beneficiary" until one is being edited', () => {
		const body = text();
		expect(body).toContain('Add beneficiary');
		expect(body).not.toContain('Save changes');
	});

	it('does not show a notes line when none is recorded', () => {
		const body = text({
			beneficiaries: [createBeneficiary({ name: 'Jess', relationship: 'Daughter', share_pct: 60 })]
		});
		expect(body).not.toContain('Eldest child');
	});

	it("prices a beneficiary's wished share once netAfterTax is passed", () => {
		const body = text({
			beneficiaries: [createBeneficiary({ name: 'Jess', relationship: 'Daughter', share_pct: 60 })],
			netAfterTax: 500_000
		});
		expect(body).toContain('£300,000');
	});

	it('prices against a net estate of exactly £0 rather than treating it as nothing to price', () => {
		const body = text({
			beneficiaries: [createBeneficiary({ name: 'Jess', relationship: 'Daughter', share_pct: 60 })],
			netAfterTax: 0
		});
		expect(body).toContain('Daughter');
		expect(body).toContain('£0');
	});

	it('flags the unallocated share and its £ value when wishes fall short of 100%', () => {
		const body = text({
			beneficiaries: [createBeneficiary({ name: 'Alex', relationship: 'Spouse', share_pct: 60 })],
			netAfterTax: 500_000
		});
		expect(body).toContain("isn't promised to anyone yet");
		expect(body).toContain('40');
		expect(body).toContain('£200,000');
	});

	it('flags an over-allocated list once wishes exceed 100%, without rescaling the shares', () => {
		const body = text({
			beneficiaries: [
				createBeneficiary({ name: 'Alex', relationship: 'Spouse', share_pct: 80 }),
				createBeneficiary({ name: 'Sam', relationship: 'Son', share_pct: 80 })
			],
			netAfterTax: 500_000
		});
		expect(body).toContain('£400,000'); // each row: 80% of £500,000, unrescaled
		expect(body).toContain('160');
		expect(body).toContain('Over-allocated');
		expect(body).toContain('£300,000'); // £800,000 promised - £500,000 estate
	});

	it('shows neither allocation warning when wishes add up to exactly 100%', () => {
		const body = text({
			beneficiaries: [createBeneficiary({ name: 'Solo', relationship: 'Spouse', share_pct: 100 })],
			netAfterTax: 500_000
		});
		expect(body).not.toContain("isn't promised");
		expect(body).not.toContain('Over-allocated');
	});

	it('shows no £ figure and no allocation warning when netAfterTax is not passed', () => {
		const body = text({
			beneficiaries: [
				createBeneficiary({ name: 'Alex', relationship: 'Spouse', share_pct: 80 }),
				createBeneficiary({ name: 'Sam', relationship: 'Son', share_pct: 80 })
			]
		});
		expect(body).not.toContain('£');
		expect(body).not.toContain("isn't promised");
		expect(body).not.toContain('Over-allocated');
	});
});
