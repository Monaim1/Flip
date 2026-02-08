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
						<YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
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
