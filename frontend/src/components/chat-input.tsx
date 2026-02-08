import { ArrowUpIcon, MicIcon, MicOffIcon, SquareIcon, Volume2Icon, VolumeXIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import type { FormEvent, KeyboardEvent } from 'react';

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { useAgentContext } from '@/contexts/agent.provider';
import { useVoiceContext } from '@/contexts/voice.provider';
import { useVoiceInput } from '@/hooks/use-voice-input';

export function ChatInput() {
	const { sendMessage, isRunning, stopAgent, isReadyForNewMessages } = useAgentContext();
	const { isVoiceOutputEnabled, setVoiceOutputEnabled, stopSpeaking } = useVoiceContext();
	const chatId = useParams({ strict: false, select: (p) => p.chatId });
	const [input, setInput] = useState('');
	const { isRecording, isConnecting, transcript, startRecording, stopRecording } = useVoiceInput();
	const displayValue = useMemo(() => (isRecording ? transcript : input), [input, isRecording, transcript]);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		if (!input.trim() || isRunning) {
			return;
		}
		sendMessage({ text: input });
		setInput('');
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit(e);
		}
	};

	const handleMicClick = async () => {
		if (isRunning) return;
		if (isRecording) {
			const finalText = await stopRecording();
			if (finalText.trim()) {
				setVoiceOutputEnabled(true);
				await sendMessage({ text: finalText });
				setInput('');
			} else {
				setInput(finalText);
			}
			return;
		}
		stopSpeaking();
		setVoiceOutputEnabled(true);
		await startRecording();
	};

	return (
		<div className='p-4 pt-0 max-w-5xl w-full mx-auto'>
			<form onSubmit={handleSubmit} className='mx-auto'>
				<InputGroup htmlFor='chat-input'>
					<InputGroupAddon align='inline-start'>
						<InputGroupButton
							type='button'
							variant={isRecording ? 'destructive' : 'ghost'}
							className='rounded-full'
							size='icon-xs'
							onClick={handleMicClick}
							disabled={!isReadyForNewMessages || isConnecting}
						>
							{isRecording ? <MicOffIcon /> : <MicIcon />}
							<span className='sr-only'>{isRecording ? 'Stop recording' : 'Start recording'}</span>
						</InputGroupButton>
						<InputGroupButton
							type='button'
							variant={isVoiceOutputEnabled ? 'default' : 'ghost'}
							className='rounded-full'
							size='icon-xs'
							onClick={() => setVoiceOutputEnabled(!isVoiceOutputEnabled)}
						>
							{isVoiceOutputEnabled ? <Volume2Icon /> : <VolumeXIcon />}
							<span className='sr-only'>
								{isVoiceOutputEnabled ? 'Disable voice output' : 'Enable voice output'}
							</span>
						</InputGroupButton>
					</InputGroupAddon>

					<InputGroupTextarea
						key={chatId}
						autoFocus
						placeholder={isRecording ? 'Listening…' : 'Ask anything about your data...'}
						value={displayValue}
						onChange={(e) => {
							if (!isRecording) {
								setInput(e.target.value);
							}
						}}
						onKeyDown={handleKeyDown}
						id='chat-input'
					/>

					<InputGroupAddon align='block-end'>
						{isRunning ? (
							<InputGroupButton
								type='button'
								variant='destructive'
								className='rounded-full ml-auto'
								size='icon-xs'
								onClick={stopAgent}
							>
								<SquareIcon />
								<span className='sr-only'>Stop</span>
							</InputGroupButton>
						) : (
							<InputGroupButton
								type='submit'
								variant='default'
								className='rounded-full ml-auto'
								size='icon-xs'
								disabled={!isReadyForNewMessages || !input || isRecording}
							>
								<ArrowUpIcon />
								<span className='sr-only'>Send</span>
							</InputGroupButton>
						)}
					</InputGroupAddon>
				</InputGroup>
			</form>
		</div>
	);
}
