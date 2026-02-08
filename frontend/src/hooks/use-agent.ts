import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { UIMessage } from '@/types/chat';
import type { ScrollToBottom, ScrollToBottomOptions } from 'use-stick-to-bottom';
import type { ChaosState } from '@/types/genui';
import { API_URL } from '@/lib/api';

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
	const [messages, setMessages] = useState<UIMessage[]>([]);
	const [status, setStatus] = useState<'idle' | 'streaming'>('idle');
	const [error, setError] = useState<Error | undefined>(undefined);
	const [currentChaos, setCurrentChaos] = useState<ChaosState>(DEFAULT_CHAOS);
	const abortRef = useRef<AbortController | null>(null);
	const streamedTextRef = useRef<Record<string, string>>({});
	const scrollDownService = useScrollDownCallbackService();

	const clearError = useCallback(() => setError(undefined), []);

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
					body: JSON.stringify({ message: text, currentChaos }),
				});
				if (!response.ok) {
					throw new Error(`Fallback failed: ${response.status}`);
				}
				const data = await response.json();
				if (data?.dashboardSpec?.chaos) {
					setCurrentChaos((prev) => ({ ...prev, ...data.dashboardSpec.chaos }));
				}
				const fallbackText =
					(data.assistantMessage && data.assistantMessage.trim()) ||
					streamedTextRef.current[assistantId] ||
					'';
				const finalText = `${fallbackText}\n${JSON.stringify(data)}`;
				updateAssistantText(assistantId, finalText, false);
			};

			try {
				const response = await fetch(`${API_URL}/api/query/stream`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Accept: 'text/event-stream',
					},
					body: JSON.stringify({ message: text, currentChaos }),
					signal: abortRef.current.signal,
				});

				if (!response.ok || !response.body) {
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
								setCurrentChaos((prev) => ({ ...prev, ...data.dashboardSpec.chaos }));
							}
							const finalMessage =
								(data.assistantMessage && data.assistantMessage.trim()) ||
								streamedTextRef.current[assistantId] ||
								'';
							const finalText = `${finalMessage}\n${JSON.stringify(data)}`;
							updateAssistantText(assistantId, finalText, false);
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
		[clearError, currentChaos, scrollDownService, status, updateAssistantText],
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
			status,
			isRunning: status === 'streaming',
			isReadyForNewMessages: status !== 'streaming',
			stopAgent,
			registerScrollDown: scrollDownService.register,
			error,
			clearError,
		}),
		[messages, sendMessage, status, stopAgent, scrollDownService.register, error, clearError],
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
