import {
	CartesianGrid,
	Line,
	LineChart as RechartsLineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CandlestickData {
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
}

interface CandlestickChartProps {
	ticker: string;
	data: CandlestickData[];
}

export function CandlestickChart({ ticker, data }: CandlestickChartProps) {
	const chartData: CandlestickData[] = data
		.map((d) => ({
			date: String((d as CandlestickData).date ?? ''),
			open: Number((d as CandlestickData).open),
			high: Number((d as CandlestickData).high),
			low: Number((d as CandlestickData).low),
			close: Number((d as CandlestickData).close),
		}))
		.filter((d) => Number.isFinite(d.open) && Number.isFinite(d.high) && Number.isFinite(d.low) && Number.isFinite(d.close));

	const computeYDomain = (rows: CandlestickData[]) => {
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const row of rows) {
			const low = row.low;
			const high = row.high;
			if (Number.isFinite(low)) min = Math.min(min, low);
			if (Number.isFinite(high)) max = Math.max(max, high);
		}
		if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
		if (min === max) {
			const pad = Math.max(1, Math.abs(min) * 0.01);
			return [min - pad, max + pad] as [number, number];
		}
		const range = max - min;
		const pad = Math.max(range * 0.05, Math.abs(max) * 0.002);
		return [min - pad, max + pad] as [number, number];
	};

	const yDomain = computeYDomain(chartData);

	return (
		<Card className='col-span-full h-[450px]'>
			<CardHeader>
				<CardTitle className='text-lg font-medium'>{ticker} - Price Time Series</CardTitle>
			</CardHeader>
			<CardContent className='h-[350px]'>
				<ResponsiveContainer width='100%' height='100%'>
					<RechartsLineChart data={chartData}>
						<CartesianGrid strokeDasharray='3 3' vertical={false} stroke='#f1f5f9' />
						<XAxis dataKey='date' axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
						<YAxis
							axisLine={false}
							tickLine={false}
							tick={{ fontSize: 12, fill: '#64748b' }}
							domain={yDomain ?? ['auto', 'auto']}
						/>
						<Tooltip
							contentStyle={{
								borderRadius: '8px',
								border: 'none',
								boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
							}}
						/>
						<Line
							type='monotone'
							dataKey='close'
							stroke='#2563eb'
							strokeWidth={2}
							dot={false}
							activeDot={{ r: 4 }}
						/>
					</RechartsLineChart>
				</ResponsiveContainer>
			</CardContent>
		</Card>
	);
}
