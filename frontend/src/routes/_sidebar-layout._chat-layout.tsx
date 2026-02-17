import { createFileRoute, Outlet } from '@tanstack/react-router';
import { RotateCcwIcon } from 'lucide-react';
import { AgentProvider } from '@/contexts/agent.provider';
import { useAgentContext } from '@/contexts/agent.provider';
import { ChatInput } from '@/components/chat-input';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout')({
	component: RouteComponent,
});

function ChatToolbar() {
	const { resetUI, isRunning } = useAgentContext();

	return (
		<div className='max-w-5xl w-full mx-auto px-4 pt-3 pb-1 flex justify-end'>
			<Button type='button' variant='outline' size='sm' onClick={resetUI} disabled={isRunning}>
				<RotateCcwIcon className='size-4' />
				Reset UI
			</Button>
		</div>
	);
}

function RouteComponent() {
	return (
		<AgentProvider>
			<div className='flex flex-col h-full flex-1 bg-panel min-w-0 overflow-hidden justify-center'>
				<ChatToolbar />
				<Outlet />
				<ChatInput />
			</div>
		</AgentProvider>
	);
}
