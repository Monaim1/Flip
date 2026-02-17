import type { DateRange } from '@/lib/charts.utils';
import type { ChaosState } from '@/types/genui';

export type UICommandType =
	| 'set_time_range'
	| 'focus_ticker'
	| 'set_visible_blocks'
	| 'set_chaos'
	| 'clear_focus'
	| 'reset_ui';

export type UICommand = {
	type: UICommandType;
	payload: Record<string, unknown>;
};

export type EPICUIState = {
	mode: 'analysis' | 'context-wait';
	timeRange: DateRange;
	focusedTicker: string | null;
	visibleBlockTypes: string[] | null;
	chaosOverride: Partial<ChaosState> | null;
	lastIntentNote: string | null;
};

export const DEFAULT_EPIC_UI_STATE: EPICUIState = {
	mode: 'analysis',
	timeRange: 'all',
	focusedTicker: null,
	visibleBlockTypes: null,
	chaosOverride: null,
	lastIntentNote: null,
};
