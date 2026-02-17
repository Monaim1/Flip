import {
	CartesianGrid,
	Legend,
	Line,
	LineChart as RechartsLineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { filterByDateRange } from '@/lib/charts.utils';
import type { DateRange } from '@/lib/charts.utils';

interface LineChartProps {
	title: string;
	data: any;
	xKey: string;
	yKeys: string[];
	timeRange?: DateRange;
	focusedTicker?: string | null;
}

const COLORS = ['#4769d0', '#2b9d7f', '#c24c5a', '#b88a2b', '#6f5ecf', '#6b7d3c'];

const toNumber = (value: unknown) => {
	if (value == null) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string') {
		const cleaned = value.replace(/[^0-9.+-]/g, '').replace(/,/g, '');
		const num = Number(cleaned);
		return Number.isFinite(num) ? num : null;
	}
	const num = Number(value);
	return Number.isFinite(num) ? num : null;
};

const normalizeLineChartData = (raw: any, xKey: string, yKeys: string[]) => {
	const source = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
	if (!Array.isArray(source) || source.length === 0) {
		return { data: [], xKey, yKeys };
	}

	const sample = source.find((row) => row && typeof row === 'object') ?? {};
	const keyMap: Record<string, string> = {};
	for (const key of Object.keys(sample)) {
		keyMap[key.toLowerCase()] = key;
	}

	const resolvedXKey =
		keyMap[xKey?.toLowerCase?.() ?? ''] ||
		('date' in sample ? 'date' : 'timestamp' in sample ? 'timestamp' : xKey);

	let resolvedYKeys = yKeys
		.map((key) => keyMap[key?.toLowerCase?.() ?? ''] || key)
		.filter((key, idx, arr) => key && arr.indexOf(key) === idx);

	if (resolvedYKeys.length === 0) {
		resolvedYKeys = Object.keys(sample).filter((key) => key !== resolvedXKey);
	}

	const normalized = source
		.map((row) => {
			if (!row || typeof row !== 'object') return null;
			const next: Record<string, unknown> = { ...row };
			if (resolvedXKey in row) {
				next[resolvedXKey] = String((row as Record<string, unknown>)[resolvedXKey] ?? '');
			}
			for (const key of resolvedYKeys) {
				next[key] = toNumber((row as Record<string, unknown>)[key]);
			}
			return next;
		})
		.filter(Boolean) as Record<string, unknown>[];

	const filtered = normalized.filter((row) => resolvedYKeys.some((key) => Number.isFinite(row[key] as number)));

	return { data: filtered, xKey: resolvedXKey, yKeys: resolvedYKeys };
};

const computeYDomain = (data: Record<string, unknown>[], yKeys: string[]) => {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;

	for (const row of data) {
		for (const key of yKeys) {
			const value = row[key];
			if (typeof value === 'number' && Number.isFinite(value)) {
				if (value < min) min = value;
				if (value > max) max = value;
			}
		}
	}

	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		return undefined;
	}

	if (min === max) {
		const pad = Math.max(1, Math.abs(min) * 0.01);
		return [min - pad, max + pad] as [number, number];
	}

	const range = max - min;
	const pad = Math.max(range * 0.05, Math.abs(max) * 0.002);
	return [min - pad, max + pad] as [number, number];
};

export function LineChart({ title, data, xKey, yKeys, timeRange = 'all', focusedTicker = null }: LineChartProps) {
	const normalized = normalizeLineChartData(data, xKey, yKeys);
	const resolvedYKeys =
		focusedTicker && normalized.yKeys.includes(focusedTicker) ? [focusedTicker] : normalized.yKeys;
	const rangedData = filterByDateRange(normalized.data, normalized.xKey, timeRange);
	const showDots = rangedData.length < 2;
	const yDomain = computeYDomain(rangedData, resolvedYKeys);

	return (
		<Card className='col-span-full h-[400px]'>
			<CardHeader>
				<CardTitle className='text-lg font-medium'>{title}</CardTitle>
			</CardHeader>
			<CardContent className='h-[300px]'>
				<ResponsiveContainer width='100%' height='100%'>
					<RechartsLineChart data={rangedData}>
						<CartesianGrid strokeDasharray='3 3' vertical={false} stroke='#d7dde4' />
						<XAxis
							dataKey={normalized.xKey}
							axisLine={false}
							tickLine={false}
							tick={{ fontSize: 12, fill: '#5c6673' }}
						/>
						<YAxis
							axisLine={false}
							tickLine={false}
							tick={{ fontSize: 12, fill: '#5c6673' }}
							domain={yDomain ?? ['auto', 'auto']}
						/>
						<Tooltip
							contentStyle={{
								borderRadius: '8px',
								border: '1px solid #d7dde4',
								backgroundColor: '#f7f8fa',
								boxShadow: '0 8px 20px -12px rgb(0 0 0 / 0.22)',
							}}
						/>
						<Legend verticalAlign='top' height={36} />
						{resolvedYKeys.map((key, index) => (
							<Line
								key={key}
								type='monotone'
								dataKey={key}
								stroke={COLORS[index % COLORS.length]}
								strokeWidth={2}
								dot={showDots ? { r: 3 } : false}
								activeDot={{ r: 4 }}
							/>
						))}
					</RechartsLineChart>
				</ResponsiveContainer>
			</CardContent>
		</Card>
	);
}
