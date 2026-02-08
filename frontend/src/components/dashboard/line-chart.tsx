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

interface LineChartProps {
	title: string;
	data: any;
	xKey: string;
	yKeys: string[];
}

const COLORS = ['#2563eb', '#10b981', '#ef4444', '#f59e0b', '#6366f1', '#8b5cf6'];

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

export function LineChart({ title, data, xKey, yKeys }: LineChartProps) {
	const normalized = normalizeLineChartData(data, xKey, yKeys);
	const showDots = normalized.data.length < 2;
	const yDomain = computeYDomain(normalized.data, normalized.yKeys);

	return (
		<Card className='col-span-full h-[400px]'>
			<CardHeader>
				<CardTitle className='text-lg font-medium'>{title}</CardTitle>
			</CardHeader>
			<CardContent className='h-[300px]'>
				<ResponsiveContainer width='100%' height='100%'>
					<RechartsLineChart data={normalized.data}>
						<CartesianGrid strokeDasharray='3 3' vertical={false} stroke='#f1f5f9' />
						<XAxis
							dataKey={normalized.xKey}
							axisLine={false}
							tickLine={false}
							tick={{ fontSize: 12, fill: '#64748b' }}
						/>
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
						<Legend verticalAlign='top' height={36} />
						{normalized.yKeys.map((key, index) => (
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
