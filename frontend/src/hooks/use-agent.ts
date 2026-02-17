import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UIMessage } from '@/types/chat';
import type { ScrollToBottom, ScrollToBottomOptions } from 'use-stick-to-bottom';
import type { ChaosState } from '@/types/genui';
import { DEFAULT_EPIC_UI_STATE } from '@/types/epic';
import type { EPICUIState, UICommand } from '@/types/epic';
import { API_URL } from '@/lib/api';
import { useSession } from '@/lib/auth-client';

const DEFAULT_CHAOS: ChaosState = {
	rotation: 0,
	fontFamily: 'Inter',
	animation: null,
	theme: 'professional',
};

export type AgentHelpers = {
	messages: UIMessage[];
	setMessages: Dispatch<SetStateAction<UIMessage[]>>;
	sendMessage: (args: { text: string }) => Promise<void>;
	uiState: EPICUIState;
	status: 'idle' | 'streaming';
	isRunning: boolean;
	isReadyForNewMessages: boolean;
	stopAgent: () => Promise<void>;
	registerScrollDown: (fn: ScrollToBottom) => { dispose: () => void };
	error: Error | undefined;
	clearError: () => void;
};

const createUserMessage = (text: string): UIMessage => ({
	id: Date.now().toString(),
	role: 'user',
	parts: [{ type: 'text', text }],
});

const createAssistantMessage = (): UIMessage => ({
	id: (Date.now() + 1).toString(),
	role: 'assistant',
	parts: [{ type: 'text', text: '', state: 'streaming' }],
});

export const useAgent = (): AgentHelpers => {
	const session = useSession();
	const userId = session?.data?.user?.id ?? 'local';
	const [messages, setMessages] = useState<UIMessage[]>([]);
	const [uiState, setUiState] = useState<EPICUIState>(DEFAULT_EPIC_UI_STATE);
	const [status, setStatus] = useState<'idle' | 'streaming'>('idle');
	const [error, setError] = useState<Error | undefined>(undefined);
	const [currentChaos, setCurrentChaos] = useState<ChaosState>(() => {
		if (typeof window === 'undefined') return DEFAULT_CHAOS;
		try {
			const saved = localStorage.getItem('currentChaos');
			if (saved) {
				const parsed = JSON.parse(saved) as ChaosState;
				if (parsed && typeof parsed === 'object') {
					return { ...DEFAULT_CHAOS, ...parsed };
				}
			}
		} catch {
			// ignore
		}
		return DEFAULT_CHAOS;
	});
	const [hasLoadedChaos, setHasLoadedChaos] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const streamedTextRef = useRef<Record<string, string>>({});
	const scrollDownService = useScrollDownCallbackService();

	const clearError = useCallback(() => setError(undefined), []);

	useEffect(() => {
		if (!userId) return;
		setHasLoadedChaos(false);
		let isActive = true;
		const loadChaos = async () => {
			try {
				const response = await fetch(`${API_URL}/api/chaos?userId=${encodeURIComponent(userId)}`);
				if (!response.ok) return;
				const data = await response.json();
				const chaos = data?.chaos;
				if (isActive && chaos && typeof chaos === 'object' && Object.keys(chaos).length > 0) {
					setCurrentChaos((prev) => ({ ...prev, ...chaos }));
				}
			} catch {
				// ignore
			} finally {
				if (isActive) {
					setHasLoadedChaos(true);
				}
			}
		};
		loadChaos();
		return () => {
			isActive = false;
		};
	}, [userId]);

	useEffect(() => {
		if (!userId || !hasLoadedChaos) return;
		if (typeof window !== 'undefined') {
			try {
				localStorage.setItem('currentChaos', JSON.stringify(currentChaos));
			} catch {
				// ignore
			}
		}
		fetch(`${API_URL}/api/chaos`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId, chaos: currentChaos }),
		}).catch(() => undefined);
	}, [currentChaos, userId]);

	useEffect(() => {
		setUiState((prev) => ({
			...prev,
			chaosOverride: { ...(prev.chaosOverride ?? {}), ...currentChaos },
		}));
	}, [currentChaos]);

	const updateAssistantText = useCallback((messageId: string, text: string, isStreaming: boolean) => {
		setMessages((prev) =>
			prev.map((m) =>
				m.id === messageId
					? {
							...m,
							parts: [{ type: 'text', text, state: isStreaming ? 'streaming' : 'done' }],
						}
					: m,
			),
		);
	}, []);

	const applyUICommand = useCallback((rawCommand: unknown) => {
		if (!rawCommand || typeof rawCommand !== 'object') {
			return;
		}

		const command = rawCommand as UICommand;
		const payload = command.payload ?? {};

		switch (command.type) {
			case 'set_time_range': {
				const range = payload['range'];
				if (typeof range === 'string') {
					setUiState((prev) => ({ ...prev, mode: 'analysis', timeRange: range as any }));
				}
				return;
			}
			case 'focus_ticker': {
				const ticker = payload['ticker'];
				if (typeof ticker === 'string' && ticker.trim()) {
					setUiState((prev) => ({
						...prev,
						mode: 'analysis',
						focusedTicker: ticker.toUpperCase(),
						lastIntentNote: null,
					}));
				}
				return;
			}
			case 'set_visible_blocks': {
				const types = payload['types'];
				if (Array.isArray(types)) {
					const validTypes = types.filter((type): type is string => typeof type === 'string');
					setUiState((prev) => ({
						...prev,
						mode: 'analysis',
						visibleBlockTypes: validTypes.length ? validTypes : null,
					}));
				}
				return;
			}
			case 'set_chaos': {
				if (payload && typeof payload === 'object') {
					const nextChaos = payload as Partial<ChaosState>;
					setUiState((prev) => ({
						...prev,
						mode: 'analysis',
						chaosOverride: { ...(prev.chaosOverride ?? {}), ...nextChaos },
					}));
					setCurrentChaos((prev) => ({ ...prev, ...nextChaos }));
				}
				return;
			}
			case 'clear_focus': {
				setUiState((prev) => ({
					...prev,
					mode: 'analysis',
					focusedTicker: null,
					lastIntentNote: null,
				}));
				return;
			}
			case 'reset_ui': {
				setUiState(DEFAULT_EPIC_UI_STATE);
				return;
			}
			default: {
				return;
			}
		}
	}, []);

	const sendMessage = useCallback(
		async ({ text }: { text: string }) => {
			if (status === 'streaming') return;

			clearError();
			const userMessage = createUserMessage(text);
			const assistantMessage = createAssistantMessage();
			setMessages((prev) => [...prev, userMessage, assistantMessage]);
			setStatus('streaming');
			scrollDownService.scrollDown({ animation: 'smooth' });

			abortRef.current = new AbortController();
			const assistantId = assistantMessage.id;
			streamedTextRef.current[assistantId] = '';
			let gotResult = false;

			const handleFallback = async () => {
				const response = await fetch(`${API_URL}/api/query`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ message: text, currentChaos, userId }),
				});
				if (!response.ok) {
					throw new Error(`Fallback failed: ${response.status}`);
				}
				const data = await response.json();
				if (data?.dashboardSpec?.chaos) {
					const nextChaos = data.dashboardSpec.chaos as Partial<ChaosState>;
					setCurrentChaos((prev) => ({ ...prev, ...nextChaos }));
					setUiState((prev) => ({
						...prev,
						mode: 'analysis',
						chaosOverride: { ...(prev.chaosOverride ?? {}), ...nextChaos },
					}));
				}
				const fallbackText =
					(data.assistantMessage && data.assistantMessage.trim()) ||
					streamedTextRef.current[assistantId] ||
					'';
				const finalText = `${fallbackText}\n${JSON.stringify(data)}`;
				updateAssistantText(assistantId, finalText, false);
			};

			try {
				const connectStream = async (url: string) =>
					fetch(url, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Accept: 'text/event-stream',
						},
						body: JSON.stringify({ message: text, currentChaos, userId }),
						signal: abortRef.current?.signal,
					});

				let response: Response | null = null;
				try {
					response = await connectStream(`${API_URL}/api/query/epic-stream`);
				} catch {
					response = null;
				}

				if (!response || !response.ok || !response.body) {
					try {
						response = await connectStream(`${API_URL}/api/query/stream`);
					} catch {
						response = null;
					}
				}

				if (!response || !response.ok || !response.body) {
					throw new Error('Failed to connect to stream');
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';
				let currentEvent = '';
				let dataLines: string[] = [];

				const dispatchEvent = () => {
					if (!currentEvent || dataLines.length === 0) {
						currentEvent = '';
						dataLines = [];
						return;
					}
					const dataStr = dataLines.join('\n');
					try {
						const data = JSON.parse(dataStr);
						if (currentEvent === 'content') {
							const delta = data?.delta ?? '';
							streamedTextRef.current[assistantId] = `${streamedTextRef.current[assistantId] || ''}${delta}`;
							setMessages((prev) =>
								prev.map((m) =>
									m.id === assistantId
										? {
												...m,
												parts: [
													{
														type: 'text',
														text: `${(m.parts[0] as any)?.text ?? ''}${delta}`,
														state: 'streaming',
													},
												],
											}
										: m,
								),
							);
						} else if (currentEvent === 'result') {
							gotResult = true;
							if (data?.dashboardSpec?.chaos) {
								const nextChaos = data.dashboardSpec.chaos as Partial<ChaosState>;
								setCurrentChaos((prev) => ({ ...prev, ...nextChaos }));
								setUiState((prev) => ({
									...prev,
									mode: 'analysis',
									chaosOverride: { ...(prev.chaosOverride ?? {}), ...nextChaos },
								}));
							}
							const finalMessage =
								(data.assistantMessage && data.assistantMessage.trim()) ||
								streamedTextRef.current[assistantId] ||
								'';
							const finalText = `${finalMessage}\n${JSON.stringify(data)}`;
							updateAssistantText(assistantId, finalText, false);
						} else if (currentEvent === 'ui_command') {
							applyUICommand(data);
						} else if (currentEvent === 'ui_intent') {
							const nextIntentNote =
								(typeof data?.intent?.goal === 'string' && data.intent.goal) ||
								(typeof data?.summary === 'string' && data.summary) ||
								'Waiting for more context before updating the UI.';
							setUiState((prev) => ({
								...prev,
								mode: 'context-wait',
								lastIntentNote: nextIntentNote,
							}));
						} else if (currentEvent === 'ui_state') {
							const pendingIntentCount =
								typeof data?.pendingIntentCount === 'number' ? data.pendingIntentCount : 0;
							setUiState((prev) => ({
								...prev,
								mode: pendingIntentCount > 0 ? 'context-wait' : 'analysis',
								lastIntentNote:
									pendingIntentCount > 0
										? prev.lastIntentNote || 'Waiting for more context before updating the UI.'
										: null,
							}));
						} else if (currentEvent === 'error') {
							setError(new Error(data?.detail || 'Agent error'));
						}
					} catch {
						// ignore malformed JSON
					}
					currentEvent = '';
					dataLines = [];
				};

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const rawLine of lines) {
						const line = rawLine.replace(/\r$/, '');
						if (line === '') {
							dispatchEvent();
							continue;
						}
						if (line.startsWith('event:')) {
							currentEvent = line.slice(6).trim();
						} else if (line.startsWith('data:')) {
							dataLines.push(line.slice(5).trimStart());
						}
					}
				}

				if (buffer) {
					const line = buffer.replace(/\r$/, '');
					if (line === '') {
						dispatchEvent();
					} else if (line.startsWith('event:')) {
						currentEvent = line.slice(6).trim();
					} else if (line.startsWith('data:')) {
						dataLines.push(line.slice(5).trimStart());
					}
				}
				dispatchEvent();

				if (!gotResult) {
					await handleFallback();
				}
			} catch (err) {
				if ((err as Error).name !== 'AbortError') {
					setError(err as Error);
					try {
						await handleFallback();
					} catch (fallbackErr) {
						setError(fallbackErr as Error);
					}
				}
			} finally {
				setStatus('idle');
				abortRef.current = null;
				delete streamedTextRef.current[assistantId];
			}
		},
		[applyUICommand, clearError, currentChaos, scrollDownService, status, updateAssistantText, userId],
	);

	const stopAgent = useCallback(async () => {
		if (abortRef.current) {
			abortRef.current.abort();
		}
	}, []);

	return useMemo(
		() => ({
			messages,
			setMessages,
			sendMessage,
			uiState,
			status,
			isRunning: status === 'streaming',
			isReadyForNewMessages: status !== 'streaming',
			stopAgent,
			registerScrollDown: scrollDownService.register,
			error,
			clearError,
		}),
		[messages, sendMessage, uiState, status, stopAgent, scrollDownService.register, error, clearError],
	);
};

export const useSyncMessages = () => {
	return;
};

export const useDisposeInactiveAgents = () => {
	return;
};

const useScrollDownCallbackService = () => {
	const scrollDownCallbackRef = useRef<ScrollToBottom | null>(null);

	const scrollDown = useCallback(
		(options?: ScrollToBottomOptions) => {
			if (scrollDownCallbackRef.current) {
				scrollDownCallbackRef.current(options);
			}
		},
		[scrollDownCallbackRef],
	);

	const register = useCallback((callback: ScrollToBottom) => {
		scrollDownCallbackRef.current = callback;
		return {
			dispose: () => {
				scrollDownCallbackRef.current = null;
			},
		};
	}, []);

	return {
		scrollDown,
		register,
	};
};
