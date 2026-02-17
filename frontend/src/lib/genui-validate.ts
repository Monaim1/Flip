import type { DashboardSpec, Block } from '@/types/genui';

const KNOWN_BLOCK_TYPES = new Set([
	'executive-summary',
	'kpi-card',
	'line-chart',
	'candlestick-chart',
	'event-timeline',
	'correlation-matrix',
]);

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	value != null && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

export const validateBlock = (block: unknown, index: number): string[] => {
	const errors: string[] = [];
	if (!isObject(block)) {
		errors.push(`Block ${index}: not an object.`);
		return errors;
	}
	const b = block as Record<string, unknown>;
	if (typeof b.type !== 'string' || b.type.trim() === '') {
		errors.push(`Block ${index}: missing or invalid "type" (must be a non-empty string).`);
	} else if (!KNOWN_BLOCK_TYPES.has(b.type)) {
		errors.push(`Block ${index}: unknown type "${b.type}".`);
	}
	if (!isObject(b.props)) {
		errors.push(`Block ${index}: missing or invalid "props" (must be an object).`);
		return errors;
	}

	const props = b.props as Record<string, unknown>;
	if (!isNonEmptyString(b.type)) {
		return errors;
	}

	switch (b.type) {
		case 'executive-summary': {
			if (!isNonEmptyString(props.content)) {
				errors.push(`Block ${index}: executive-summary.props.content must be a non-empty string.`);
			}
			break;
		}
		case 'kpi-card': {
			if (!isNonEmptyString(props.ticker)) errors.push(`Block ${index}: kpi-card.props.ticker must be a non-empty string.`);
			if (!isNonEmptyString(props.metric)) errors.push(`Block ${index}: kpi-card.props.metric must be a non-empty string.`);
			if (!isNonEmptyString(props.value)) errors.push(`Block ${index}: kpi-card.props.value must be a non-empty string.`);
			if (!isNonEmptyString(props.change)) errors.push(`Block ${index}: kpi-card.props.change must be a non-empty string.`);
			if (props.changeDirection !== 'up' && props.changeDirection !== 'down') {
				errors.push(`Block ${index}: kpi-card.props.changeDirection must be "up" or "down".`);
			}
			break;
		}
		case 'line-chart': {
			if (!isNonEmptyString(props.title)) errors.push(`Block ${index}: line-chart.props.title must be a non-empty string.`);
			if (!Array.isArray(props.data)) errors.push(`Block ${index}: line-chart.props.data must be an array.`);
			if (!isNonEmptyString(props.xKey)) errors.push(`Block ${index}: line-chart.props.xKey must be a non-empty string.`);
			if (!isStringArray(props.yKeys) || props.yKeys.length === 0) {
				errors.push(`Block ${index}: line-chart.props.yKeys must be a non-empty string array.`);
			}
			break;
		}
		case 'candlestick-chart': {
			if (!isNonEmptyString(props.ticker)) errors.push(`Block ${index}: candlestick-chart.props.ticker must be a non-empty string.`);
			if (!Array.isArray(props.data)) errors.push(`Block ${index}: candlestick-chart.props.data must be an array.`);
			break;
		}
		case 'event-timeline': {
			if (!Array.isArray(props.events)) errors.push(`Block ${index}: event-timeline.props.events must be an array.`);
			break;
		}
		case 'correlation-matrix': {
			if (!isStringArray(props.tickers)) errors.push(`Block ${index}: correlation-matrix.props.tickers must be a string array.`);
			if (!Array.isArray(props.data)) errors.push(`Block ${index}: correlation-matrix.props.data must be a matrix array.`);
			if (!isNonEmptyString(props.period)) errors.push(`Block ${index}: correlation-matrix.props.period must be a non-empty string.`);
			break;
		}
		default:
			break;
	}
	return errors;
};

export const validateDashboardSpec = (spec: unknown): ValidationResult => {
	const errors: string[] = [];

	if (spec == null || typeof spec !== 'object') {
		return { valid: false, errors: ['dashboardSpec is not an object.'] };
	}

	const s = spec as Record<string, unknown>;

	if (!Array.isArray(s.blocks)) {
		return { valid: false, errors: ['dashboardSpec.blocks is not an array.'] };
	}

	for (let i = 0; i < s.blocks.length; i++) {
		errors.push(...validateBlock(s.blocks[i], i));
	}

	if (s.chaos !== undefined && s.chaos !== null) {
		if (typeof s.chaos !== 'object' || Array.isArray(s.chaos)) {
			errors.push('dashboardSpec.chaos must be an object if present.');
		}
	}

	return { valid: errors.length === 0, errors };
};

export const normalizeDashboardSpec = (spec: unknown): DashboardSpec | null => {
	const result = validateDashboardSpec(spec);
	if (!result.valid) return null;
	return spec as DashboardSpec;
};
