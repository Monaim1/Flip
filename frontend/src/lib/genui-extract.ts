import type { DashboardSpec } from '@/types/genui';
import { normalizeDashboardSpec } from '@/lib/genui-validate';

export type ExtractedDashboard = {
	spec: DashboardSpec;
	assistantText: string;
};

type ParseResult = {
	obj: Record<string, unknown>;
	start: number;
	end: number;
};

const tryParseJson = (text: string): Record<string, unknown> | null => {
	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === 'object') {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// ignore
	}
	return null;
};

const findJsonObject = (text: string): ParseResult | null => {
	const direct = tryParseJson(text);
	if (direct) {
		return { obj: direct, start: 0, end: text.length - 1 };
	}

	const startIndices: number[] = [];
	const endIndices: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '{') startIndices.push(i);
		if (char === '}') endIndices.push(i);
	}

	if (startIndices.length === 0 || endIndices.length === 0) return null;

	for (const start of startIndices) {
		for (let j = endIndices.length - 1; j >= 0; j--) {
			const end = endIndices[j];
			if (end < start) break;
			const snippet = text.slice(start, end + 1);
			const parsed = tryParseJson(snippet);
			if (parsed) {
				return { obj: parsed, start, end };
			}
		}
	}

	return null;
};

export const extractDashboardSpecFromText = (raw: string): ExtractedDashboard | null => {
	if (!raw || typeof raw !== 'string') return null;
	const found = findJsonObject(raw);
	if (!found) return null;

	const specCandidate = found.obj.dashboardSpec;
	const normalized = normalizeDashboardSpec(specCandidate);
	if (!normalized) return null;

	const extractedAssistant =
		typeof found.obj.assistantMessage === 'string' ? found.obj.assistantMessage : '';
	const trimmedAssistant = extractedAssistant.trim();
	const assistantMessage =
		trimmedAssistant.length > 0
			? extractedAssistant
			: raw.slice(0, found.start).trim() || raw.slice(found.end + 1).trim();

	return { spec: normalized, assistantText: assistantMessage };
};
