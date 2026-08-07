<script>
	import { scaleLinear, scaleTime } from 'd3-scale';
	import { line, curveMonotoneX } from 'd3-shape';
	import { extent } from 'd3-array';
	import { transformNetWorthData } from '$lib/net-worth.js';

	/**
	 * @type {{
	 *   monthlyEntries?: import('$lib/types.js').MonthlyEntry[]
	 * }}
	 */
	let { monthlyEntries = [] } = $props();

	let data = $derived(transformNetWorthData(monthlyEntries));

	let dimensions = $state({
		width: 800,
		height: 400,
		margin: { top: 20, right: 20, bottom: 20, left: 60 }
	});

	let innerWidth = $derived(dimensions.width - dimensions.margin.left - dimensions.margin.right);
	let innerHeight = $derived(dimensions.height - dimensions.margin.top - dimensions.margin.bottom);

	let xScale = $derived(
		scaleTime()
			.domain(extent(data, (d) => d.date) || [new Date(), new Date()])
			.range([0, innerWidth])
	);

	let yScale = $derived(
		scaleLinear()
			.domain([0, Math.max(...data.map((d) => d.netWorth), 0)])
			.range([innerHeight, 0])
	);

	let lineGenerator = $derived(
		line()
			// @ts-ignore - d3-shape's type stubs have issues with generic line generators
			.x((d) => xScale(d.date))
			// @ts-ignore
			.y((d) => yScale(d.netWorth))
			.curve(curveMonotoneX)
	);

	let linePath = $derived(data.length > 0 ? lineGenerator(data) : '');
</script>

<div class="w-full">
	<svg width={dimensions.width} height={dimensions.height} class="font-sans">
		<!-- Background -->
		<rect width={dimensions.width} height={dimensions.height} fill="white" />

		<!-- Grid lines (horizontal) -->
		{#each yScale.ticks(5) as tick (tick)}
			<line
				x1={dimensions.margin.left}
				x2={dimensions.width - dimensions.margin.right}
				y1={yScale(tick)}
				y2={yScale(tick)}
				stroke="#eee"
				stroke-width="1"
			/>
		{/each}

		<!-- Y-axis -->
		<line
			x1={dimensions.margin.left}
			y1={dimensions.margin.top}
			x2={dimensions.margin.left}
			y2={dimensions.height - dimensions.margin.bottom}
			stroke="#000"
			stroke-width="1"
		/>

		<!-- Y-axis labels -->
		{#each yScale.ticks(5) as tick (tick)}
			<text
				x={dimensions.margin.left - 8}
				y={yScale(tick)}
				text-anchor="end"
				dominant-baseline="middle"
				font-size="12"
			>
				£{(tick / 1000).toFixed(0)}k
			</text>
		{/each}

		<!-- X-axis -->
		<line
			x1={dimensions.margin.left}
			y1={dimensions.height - dimensions.margin.bottom}
			x2={dimensions.width - dimensions.margin.right}
			y2={dimensions.height - dimensions.margin.bottom}
			stroke="#000"
			stroke-width="1"
		/>

		<!-- X-axis labels -->
		{#each xScale.ticks(6) as tick (tick)}
			{@const xPos = xScale(tick)}
			{@const date = new Date(tick)}
			{@const label = date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}
			<text
				x={xPos}
				y={dimensions.height - dimensions.margin.bottom + 16}
				text-anchor="middle"
				font-size="12"
			>
				{label}
			</text>
		{/each}

		<!-- Net Worth line -->
		{#if linePath}
			<g transform={`translate(${dimensions.margin.left}, ${dimensions.margin.top})`}>
				<path d={linePath} stroke="#0066cc" stroke-width="2" fill="none" />

				<!-- Data points -->
				{#each data as point (point.date.getTime())}
					<circle
						cx={xScale(point.date) - dimensions.margin.left}
						cy={yScale(point.netWorth) - dimensions.margin.top}
						r="3"
						fill="#0066cc"
					/>
				{/each}
			</g>
		{/if}
	</svg>
</div>

<style>
	:global(svg) {
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}
</style>
