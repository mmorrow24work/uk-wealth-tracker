<script>
	import { cn } from '$lib/utils.js';

	let { className = '' } = $props();

	const baseClasses = 'rounded-lg border border-border bg-card text-card-foreground shadow-sm';
</script>

<div class={cn(baseClasses, className)}>
	<slot />
</div>
