import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { API_URL } from '@/lib/api';

type VoiceContextValue = {
	isVoiceOutputEnabled: boolean;
	setVoiceOutputEnabled: (enabled: boolean) => void;
	isSpeaking: boolean;
	speak: (text: string) => Promise<void>;
	stopSpeaking: () => void;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

export const useVoiceContext = () => {
	const ctx = useContext(VoiceContext);
	if (!ctx) {
		throw new Error('useVoiceContext must be used within VoiceProvider');
	}
	return ctx;
};

export const VoiceProvider = ({ children }: { children: React.ReactNode }) => {
	const [isVoiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
	const [isSpeaking, setIsSpeaking] = useState(false);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const stopSpeaking = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		if (audioRef.current) {
			audioRef.current.pause();
			audioRef.current.currentTime = 0;
			audioRef.current = null;
		}
		setIsSpeaking(false);
	}, []);

	const speak = useCallback(
		async (text: string) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			stopSpeaking();
			setIsSpeaking(true);

			const controller = new AbortController();
			abortRef.current = controller;

			const response = await fetch(`${API_URL}/api/voice/tts`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: trimmed }),
				signal: controller.signal,
			});

			if (!response.ok) {
				setIsSpeaking(false);
				throw new Error(`TTS failed: ${response.status}`);
			}

			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const audio = new Audio(url);
			audioRef.current = audio;

			audio.onended = () => {
				URL.revokeObjectURL(url);
				setIsSpeaking(false);
			};
			audio.onerror = () => {
				URL.revokeObjectURL(url);
				setIsSpeaking(false);
			};

			try {
				await audio.play();
			} catch {
				URL.revokeObjectURL(url);
				setIsSpeaking(false);
			}
		},
		[stopSpeaking],
	);

	const value = useMemo(
		() => ({ isVoiceOutputEnabled, setVoiceOutputEnabled, isSpeaking, speak, stopSpeaking }),
		[isVoiceOutputEnabled, isSpeaking, speak, stopSpeaking],
	);

	return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
};
