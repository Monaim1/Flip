import { Streamdown } from 'streamdown';
import { useEffect, useMemo, useRef } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { TextShimmer } from './ui/text-shimmer';
import { ChatError } from './chat-error';
import type { UIMessage } from '@/types/chat';
import type { MessageGroup } from '@/types/messages';
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from '@/components/ui/conversation';
import { cn, isLast } from '@/lib/utils';
import { useAgentContext } from '@/contexts/agent.provider';
import { useVoiceContext } from '@/contexts/voice.provider';
import { useHeight } from '@/hooks/use-height';
import { groupMessages } from '@/lib/messages.utils';
import { useDebounce } from '@/hooks/use-debounce';
import { extractDashboardSpecFromText } from '@/lib/genui-extract';
import { DashboardRenderer } from '@/components/dashboard/dashboard-renderer';

const DEBUG_MESSAGES = false;

export function ChatMessages() {
	const contentRef = useRef<HTMLDivElement>(null);
	const containerHeight = useHeight(contentRef, []);
	const { messages, status } = useAgentContext();
	const isAgentGenerating = status === 'streaming';
	const { isVoiceOutputEnabled, speak } = useVoiceContext();
	const lastMessageRole = messages.at(-1)?.role;
	const shouldResizeSmoothly = !isAgentGenerating && lastMessageRole === 'user';

	// Skip fade-in animation when navigating from home after sending a message
	const fromMessageSend = useRouterState({ select: (state) => state.location.state.fromMessageSend });

	useSpeakOnAssistantReply(messages, isVoiceOutputEnabled, speak);

	return (
		<div
			className={cn('h-full min-h-0 flex', !fromMessageSend && 'animate-fade-in')}
			ref={contentRef}
			style={{ '--container-height': `${containerHeight}px` } as React.CSSProperties}
		>
			<Conversation resize={shouldResizeSmoothly ? 'smooth' : 'instant'}>
				<ConversationContent className='max-w-5xl mx-auto'>
					<ChatMessagesContent isAgentGenerating={isAgentGenerating} />
				</ConversationContent>

				<ConversationScrollButton />
			</Conversation>
		</div>
	);
}

const getAssistantText = (message: UIMessage) => {
	const textContent = message.parts
		.filter((p) => p.type === 'text')
		.map((p) => p.text)
		.join('\n');
	const extracted = extractDashboardSpecFromText(textContent);
	return (extracted?.assistantText ?? textContent).trim();
};

const isMessageStreaming = (message: UIMessage) =>
	message.parts.some((p) => 'state' in p && (p as { state?: string }).state === 'streaming');

const useSpeakOnAssistantReply = (messages: UIMessage[], enabled: boolean, speak: (text: string) => Promise<void>) => {
	const spokenMessageIds = useRef<Set<string>>(new Set());
	const prevEnabledRef = useRef(enabled);

	useEffect(() => {
		if (enabled && !prevEnabledRef.current) {
			const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
			if (lastAssistant) {
				spokenMessageIds.current.add(lastAssistant.id);
			}
		}
		prevEnabledRef.current = enabled;
	}, [enabled, messages]);

	useEffect(() => {
		if (!enabled) return;
		const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
		if (!lastAssistant) return;
		if (isMessageStreaming(lastAssistant)) return;
		if (spokenMessageIds.current.has(lastAssistant.id)) return;

		const assistantText = getAssistantText(lastAssistant);
		if (!assistantText) return;

		spokenMessageIds.current.add(lastAssistant.id);
		void speak(assistantText);
	}, [enabled, messages, speak]);
};

const ChatMessagesContent = ({ isAgentGenerating }: { isAgentGenerating: boolean }) => {
	const { messages, isRunning, registerScrollDown } = useAgentContext();
	const { scrollToBottom } = useStickToBottomContext();

	useEffect(() => {
		// Register the scroll down fn so the agent context has access to it.
		const scrollDownSubscription = registerScrollDown(scrollToBottom);
		return () => {
			scrollDownSubscription.dispose();
		};
	}, [registerScrollDown, scrollToBottom]);

	const messageGroups = useMemo(() => groupMessages(messages), [messages]);

	// isRunning is status-based; isAgentGenerating means content/tool activity on the last message.
	/** `true` when the agent is running but it's not yet streaming content (text, reasoning or tool calls) */
	const isWaitingForAgentContentGeneration = isRunning && !isAgentGenerating;

	// Debounce the value to prevent flickering
	const debouncedIsWaitingForAgentContentGeneration = useDebounce({
		value: isWaitingForAgentContentGeneration,
		delay: 50,
		skipDebounce: (value) => !value, // Skip debounce if the value equals `false` to immediately remove the loader
	});

	return (
		<>
			{messageGroups.length === 0 ? (
				<ConversationEmptyState />
			) : (
				messageGroups.map((group) => (
					<MessageGroup
						key={group.user.id}
						group={group}
						showResponseLoader={isLast(group, messageGroups) && debouncedIsWaitingForAgentContentGeneration}
					/>
				))
			)}
			<ChatError className='mt-4' />
		</>
	);
};

function MessageGroup({ group, showResponseLoader }: { group: MessageGroup; showResponseLoader: boolean }) {
	return (
		<div className='flex flex-col gap-8 last:min-h-[calc(var(--container-height)-48px)] group/message'>
			{[group.user, ...group.responses].map((message) => (
				<MessageBlock
					key={message.id}
					message={message}
					showResponseLoader={showResponseLoader && isLast(message, group.responses)}
				/>
			))}

			{showResponseLoader && !group.responses.length && <TextShimmer className='px-3' />}

			<ChatError />
		</div>
	);
}

function MessageBlock({ message, showResponseLoader }: { message: UIMessage; showResponseLoader: boolean }) {
	const isUser = message.role === 'user';

	if (DEBUG_MESSAGES) {
		return (
			<div
				className={cn(
					'flex gap-3 text-xs',
					isUser ? 'justify-end bg-primary text-primary-foreground w-min ml-auto' : 'justify-start',
				)}
			>
				<pre>{JSON.stringify(message, null, 2)}</pre>
			</div>
		);
	}

	if (isUser) {
		return <UserMessageBlock message={message} />;
	}

	return <AssistantMessageBlock message={message} showResponseLoader={showResponseLoader} />;
}

const UserMessageBlock = ({ message }: { message: UIMessage }) => {
	return (
		<div className={cn('rounded-2xl px-3 py-2 bg-card text-card-foreground ml-auto max-w-xl border')}>
			{message.parts.map((p, i) => {
				switch (p.type) {
					case 'text':
						return (
							<span key={i} className='whitespace-pre-wrap wrap-break-word'>
								{p.text}
							</span>
						);
					default:
						return null;
				}
			})}
		</div>
	);
};

const AssistantMessageBlock = ({
	message,
	showResponseLoader,
}: {
	message: UIMessage;
	showResponseLoader: boolean;
}) => {
	const { isRunning, messages } = useAgentContext();
	const isLastMessage = isLast(message, messages);
	const textContent = useMemo(
		() => message.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n'),
		[message.parts],
	);
	const hasStreamingText = message.parts.some((p) => 'state' in p && p.state === 'streaming');
	const extracted = useMemo(
		() => (hasStreamingText ? null : extractDashboardSpecFromText(textContent)),
		[hasStreamingText, textContent],
	);
	const assistantText = extracted?.assistantText?.trim() ? extracted.assistantText : null;
	const dashboardSpec = extracted?.spec ?? null;
	let renderedAssistantText = false;

	if (!message.parts.length && !showResponseLoader) {
		return null;
	}

	return (
		<div className={cn('group px-3 flex flex-col gap-2 bg-transparent')}>
			{message.parts.map((p, i) => {
				const isPartStreaming = p.state === 'streaming';
				if (p.type !== 'text') {
					return null;
				}
				if (!isPartStreaming && (assistantText || dashboardSpec)) {
					if (renderedAssistantText) {
						return null;
					}
					renderedAssistantText = true;
					if (!assistantText) {
						return null;
					}
					return (
						<Streamdown key={i} isAnimating={false} mode='static'>
							{assistantText}
						</Streamdown>
					);
				}
				return (
					<Streamdown key={i} isAnimating={isPartStreaming} mode={isPartStreaming ? 'streaming' : 'static'}>
						{p.text}
					</Streamdown>
				);
			})}

			{showResponseLoader && <TextShimmer />}

			{dashboardSpec && dashboardSpec.blocks.length > 0 && <DashboardRenderer spec={dashboardSpec} />}

			{isRunning ? null : null}
		</div>
	);
};
