<script>
	import DebtTracker from '../components/DebtTracker.svelte';

	// Investment holding entry (README.md → "Monthly snapshot entry") is issue #8's monthly
	// snapshot form and isn't wired up yet, so the ratio has nothing to divide by until then.
	// These local arrays are not persisted — that lands with the store (#5) and the Gist wiring it
	// syncs to; for now debts (and the activity log of changes to them) entered here live only for
	// the current page session.
	/** @type {import('$lib/types.js').Investment[]} */
	let investments = $state([]);
	/** @type {import('$lib/types.js').Debt[]} */
	let debts = $state([]);
	/** @type {import('$lib/types.js').ActivityLogEntry[]} */
	let activityLog = $state([]);
</script>

<h1>Net Worth</h1>
<p>Personal UK net worth, tax and retirement planning app. Not financial advice.</p>
<p>
	The full net worth dashboard — monthly snapshot entry and tracked/forecast chart — lands in a
	later build. Debt tracking, the debt-to-investment ratio and the activity log are below.
</p>

<div class="mt-6 max-w-2xl">
	<DebtTracker {investments} bind:debts bind:activityLog />
</div>
