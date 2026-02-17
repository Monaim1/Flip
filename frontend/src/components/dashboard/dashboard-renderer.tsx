import type React from 'react';
import type { Block, DashboardSpec } from '@/types/genui';
import type { EPICUIState } from '@/types/epic';
import { validateBlock } from '@/lib/genui-validate';
import { cn } from '@/lib/utils';
import { ExecutiveSummary } from './executive-summary';
import { KPICard } from './kpi-card';
import { LineChart } from './line-chart';
import { CandlestickChart } from './candlestick-chart';
import { EventTimeline } from './event-timeline';
import { CorrelationMatrix } from './correlation-matrix';

const FULL_WIDTH_TYPES = new Set([
	'executive-summary',
	'line-chart',
	'event-timeline',
	'candlestick-chart',
	'correlation-matrix',
]);

interface DashboardRendererProps {
	spec: DashboardSpec;
	uiState?: EPICUIState;
}

const BlockErrorFallback = ({ errors }: { errors: string[] }) => (
	<div className='rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700'>
		<p className='font-medium'>Could not render this block</p>
		<ul className='mt-1 list-disc pl-4 text-xs'>
			{errors.map((e, i) => (
				<li key={i}>{e}</li>
			))}
		</ul>
	</div>
);

const blockMentionsTicker = (block: Block, ticker: string) => {
	const props = block.props ?? {};
	if (typeof props['ticker'] === 'string' && props['ticker'].toUpperCase() === ticker) {
		return true;
	}

	const yKeys = props['yKeys'];
	if (Array.isArray(yKeys)) {
		for (const key of yKeys) {
			if (typeof key === 'string' && key.toUpperCase() === ticker) {
				return true;
			}
		}
	}

	const title = props['title'];
	if (typeof title === 'string' && title.toUpperCase().includes(ticker)) {
		return true;
	}

	return false;
};

const renderBlock = (block: Block, uiState?: EPICUIState) => {
	switch (block.type) {
		case 'executive-summary':
			return <ExecutiveSummary {...(block.props as any)} />;
		case 'kpi-card':
			return <KPICard {...(block.props as any)} />;
		case 'line-chart':
			return (
				<LineChart
					{...(block.props as any)}
					timeRange={uiState?.timeRange}
					focusedTicker={uiState?.focusedTicker}
				/>
			);
		case 'candlestick-chart':
			return <CandlestickChart {...(block.props as any)} timeRange={uiState?.timeRange} />;
		case 'event-timeline':
			return <EventTimeline {...(block.props as any)} />;
		case 'correlation-matrix':
			return <CorrelationMatrix {...(block.props as any)} />;
		default:
			return null;
	}
};

export function DashboardRenderer({ spec, uiState }: DashboardRendererProps) {
	if (!spec || !Array.isArray(spec.blocks)) return null;

	const chaos = { ...(spec.chaos ?? {}), ...(uiState?.chaosOverride ?? {}) };
	const rotation = chaos.rotation ?? 0;
	const isMatrix = chaos.theme === 'matrix';
	const isWobble = chaos.animation === 'wobble';
	const isRainbow = chaos.animation === 'rainbow';

	const focusedTicker = uiState?.focusedTicker?.toUpperCase() ?? null;
	const visibleBlockTypes = uiState?.visibleBlockTypes;
	const filteredBlocks = spec.blocks.filter((block) => {
		if (!block || typeof block !== 'object') {
			return false;
		}

		if (Array.isArray(visibleBlockTypes) && visibleBlockTypes.length > 0) {
			if (!visibleBlockTypes.includes(block.type)) {
				return false;
			}
		}

		if (!focusedTicker) {
			return true;
		}

		// Keep broad context blocks visible even when focusing.
		if (block.type === 'executive-summary' || block.type === 'event-timeline') {
			return true;
		}

		return blockMentionsTicker(block, focusedTicker);
	});

	const style: React.CSSProperties = {
		fontFamily: chaos.fontFamily || undefined,
		...(isWobble ? { ['--genui-rotation' as string]: `${rotation}deg` } : rotation ? { transform: `rotate(${rotation}deg)` } : {}),
	};

	return (
		<div
			className={cn(
				'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-4 rounded-xl',
				isMatrix ? 'genui-matrix' : '',
				isWobble ? 'genui-wobble' : '',
				isRainbow ? 'genui-rainbow' : '',
			)}
			style={style}
		>
			{uiState?.mode === 'context-wait' && uiState.lastIntentNote && (
				<div className='col-span-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground'>
					{uiState.lastIntentNote}
				</div>
			)}
			{filteredBlocks.map((block, index) => {
				const errors = validateBlock(block, index);
				if (errors.length > 0) {
					return (
						<div key={index} className='col-span-full'>
							<BlockErrorFallback errors={errors} />
						</div>
					);
				}

				return (
					<div key={index} className={cn(FULL_WIDTH_TYPES.has(block.type) ? 'col-span-full' : '')}>
						{renderBlock(block, uiState)}
					</div>
				);
			})}
		</div>
	);
}
