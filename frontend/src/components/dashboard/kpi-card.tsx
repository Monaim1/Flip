import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface KPICardProps {
	ticker?: string;
	metric?: string;
	value?: string | number;
	change?: string | number;
	changeDirection?: 'up' | 'down';
	comparisonBenchmark?: string;
}

export function KPICard({ ticker, metric, value, change, changeDirection, comparisonBenchmark }: KPICardProps) {
	const isUp = changeDirection !== 'down';
	const safeTicker = typeof ticker === 'string' && ticker.trim().length > 0 ? ticker : 'Ticker';
	const safeMetric = typeof metric === 'string' && metric.trim().length > 0 ? metric : 'Metric';
	const safeValue =
		typeof value === 'number' ? value.toLocaleString() : typeof value === 'string' && value.trim().length > 0 ? value : 'N/A';
	const safeChange =
		typeof change === 'number'
			? change.toString()
			: typeof change === 'string' && change.trim().length > 0
				? change
				: null;

	return (
		<Card>
			<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
				<CardTitle className='text-sm font-medium'>
					{safeTicker} - {safeMetric}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className='text-2xl font-bold'>{safeValue}</div>
				{safeChange ? (
					<div className={cn('flex items-center text-xs', isUp ? 'text-green-600' : 'text-red-600')}>
						{isUp ? <ArrowUpIcon className='mr-1 h-4 w-4' /> : <ArrowDownIcon className='mr-1 h-4 w-4' />}
						{safeChange}
					</div>
				) : (
					<div className='text-xs text-muted-foreground'>No daily change provided</div>
				)}
				{comparisonBenchmark && <p className='text-xs text-muted-foreground mt-1'>vs {comparisonBenchmark}</p>}
			</CardContent>
		</Card>
	);
}
