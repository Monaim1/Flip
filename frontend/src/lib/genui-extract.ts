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

const scoreCandidate = (candidate: ParseResult, textLength: number): number => {
	const obj = candidate.obj;
	if (!('dashboardSpec' in obj)) {
		return -1;
	}

	let score = 50;
	if ('queryMetadata' in obj) score += 20;
	if (
		typeof obj.queryMetadata === 'object' &&
		obj.queryMetadata !== null &&
		'contractVersion' in (obj.queryMetadata as Record<string, unknown>)
	) {
		score += 20;
	}
	if (typeof obj.assistantMessage === 'string') score += 5;

	const normalized = normalizeDashboardSpec(obj.dashboardSpec);
	if (normalized) {
		score += Math.min(10, normalized.blocks.length);
	}

	// Prefer candidates near the end (final payload appended by frontend).
	if (candidate.end > textLength * 0.6) score += 10;
	if (candidate.start > textLength * 0.5) score += 10;

	return score;
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

	const candidates: ParseResult[] = [];
	for (const start of startIndices) {
		for (let j = endIndices.length - 1; j >= 0; j--) {
			const end = endIndices[j];
			if (end < start) break;
			const snippet = text.slice(start, end + 1);
			const parsed = tryParseJson(snippet);
			if (parsed) {
				candidates.push({ obj: parsed, start, end });
			}
		}
	}

	if (candidates.length === 0) {
		return null;
	}

	const dashboardCandidates = candidates.filter((candidate) => 'dashboardSpec' in candidate.obj);
	if (dashboardCandidates.length === 0) {
		return candidates[0] ?? null;
	}

	let best = dashboardCandidates[0];
	let bestScore = scoreCandidate(best, text.length);
	for (let i = 1; i < dashboardCandidates.length; i++) {
		const next = dashboardCandidates[i];
		const nextScore = scoreCandidate(next, text.length);
		if (nextScore > bestScore || (nextScore === bestScore && next.end > best.end)) {
			best = next;
			bestScore = nextScore;
		}
	}
	return best;
};

export const extractDashboardSpecFromText = (raw: string): ExtractedDashboard | null => {
	if (!raw || typeof raw !== 'string') return null;
	const found = findJsonObject(raw);
	if (!found) return null;

	const specCandidate = found.obj.dashboardSpec;
	const normalized = normalizeDashboardSpec(specCandidate);
	const extractedAssistant =
		typeof found.obj.assistantMessage === 'string' ? found.obj.assistantMessage : '';
	const trimmedAssistant = extractedAssistant.trim();
	const assistantMessage =
		trimmedAssistant.length > 0
			? extractedAssistant
			: raw.slice(0, found.start).trim() || raw.slice(found.end + 1).trim();

	if (!normalized) {
		return {
			spec: { blocks: [] },
			assistantText: assistantMessage,
		};
	}

	return { spec: normalized, assistantText: assistantMessage };
};
