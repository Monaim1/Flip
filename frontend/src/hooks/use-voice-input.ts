import { useCallback, useMemo, useRef, useState } from 'react';
import { WS_URL } from '@/lib/api';

type VoiceInputOptions = {
	onTranscript?: (text: string) => void;
	onFinalTranscript?: (text: string) => void;
};

type VoiceInputState = {
	isRecording: boolean;
	isConnecting: boolean;
	transcript: string;
	error?: Error;
	startRecording: () => Promise<void>;
	stopRecording: () => Promise<string>;
};

const TARGET_SAMPLE_RATE = 24000;
const PROCESSOR_BUFFER_SIZE = 4096;

const downsampleBuffer = (buffer: Float32Array, inputSampleRate: number, outputSampleRate: number) => {
	if (outputSampleRate === inputSampleRate) {
		return buffer;
	}
	const sampleRateRatio = inputSampleRate / outputSampleRate;
	const newLength = Math.round(buffer.length / sampleRateRatio);
	const result = new Float32Array(newLength);
	let offsetResult = 0;
	let offsetBuffer = 0;
	while (offsetResult < result.length) {
		const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
		let accum = 0;
		let count = 0;
		for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
			accum += buffer[i];
			count++;
		}
		result[offsetResult] = accum / Math.max(1, count);
		offsetResult++;
		offsetBuffer = nextOffsetBuffer;
	}
	return result;
};

const floatTo16BitPCM = (input: Float32Array) => {
	const output = new Int16Array(input.length);
	for (let i = 0; i < input.length; i++) {
		const s = Math.max(-1, Math.min(1, input[i]));
		output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return output;
};

export const useVoiceInput = ({ onTranscript, onFinalTranscript }: VoiceInputOptions = {}): VoiceInputState => {
	const [isRecording, setIsRecording] = useState(false);
	const [isConnecting, setIsConnecting] = useState(false);
	const [transcript, setTranscript] = useState('');
	const [error, setError] = useState<Error | undefined>(undefined);

	const wsRef = useRef<WebSocket | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const processorRef = useRef<ScriptProcessorNode | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const transcriptRef = useRef('');
	const finalizeRef = useRef<((text: string) => void) | null>(null);
	const socketReadyRef = useRef(false);

	const mergeTranscript = useCallback((prev: string, nextText: string) => {
		const cleaned = nextText.trim();
		if (!prev) return cleaned;
		if (cleaned.startsWith(prev)) return cleaned;
		if (prev.startsWith(cleaned)) return prev;
		return `${prev} ${cleaned}`.trim();
	}, []);

	const updateTranscript = useCallback(
		(nextText: string) => {
			setTranscript((prev) => {
				const merged = mergeTranscript(prev, nextText);
				transcriptRef.current = merged;
				return merged;
			});
		},
		[mergeTranscript, setTranscript],
	);

	const cleanupAudio = useCallback(async () => {
		if (processorRef.current) {
			processorRef.current.disconnect();
			processorRef.current.onaudioprocess = null;
			processorRef.current = null;
		}
		if (audioContextRef.current) {
			await audioContextRef.current.close();
			audioContextRef.current = null;
		}
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => track.stop());
			streamRef.current = null;
		}
	}, []);

	const startRecording = useCallback(async () => {
		if (isRecording || isConnecting) return;
		setError(undefined);
		setTranscript('');
		transcriptRef.current = '';
		setIsConnecting(true);

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			streamRef.current = stream;

			const audioContext = new AudioContext();
			audioContextRef.current = audioContext;

			const source = audioContext.createMediaStreamSource(stream);
			const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
			processorRef.current = processor;

			const gain = audioContext.createGain();
			gain.gain.value = 0;

			processor.onaudioprocess = (event) => {
				if (!socketReadyRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
					return;
				}
				const input = event.inputBuffer.getChannelData(0);
				const downsampled = downsampleBuffer(input, audioContext.sampleRate, TARGET_SAMPLE_RATE);
				const pcm16 = floatTo16BitPCM(downsampled);
				wsRef.current.send(pcm16.buffer);
			};

			source.connect(processor);
			processor.connect(gain);
			gain.connect(audioContext.destination);

			const ws = new WebSocket(`${WS_URL}/api/voice/stt`);
			ws.binaryType = 'arraybuffer';
			wsRef.current = ws;

			ws.onopen = () => {
				socketReadyRef.current = true;
				setIsRecording(true);
				setIsConnecting(false);
			};

			ws.onmessage = (event) => {
				if (typeof event.data !== 'string') return;
				try {
					const data = JSON.parse(event.data);
					if (data.type === 'text' && typeof data.text === 'string') {
						updateTranscript(data.text);
						onTranscript?.(transcriptRef.current);
					}
					if (data.type === 'end_text' || data.type === 'end_of_stream') {
						const finalText = transcriptRef.current.trim();
						finalizeRef.current?.(finalText);
						onFinalTranscript?.(finalText);
						finalizeRef.current = null;
					}
					if (data.type === 'error') {
						setError(new Error(data.detail || 'Voice input error'));
					}
				} catch {
					// ignore malformed JSON
				}
			};

			ws.onerror = () => {
				setError(new Error('Voice input connection failed'));
			};

			ws.onclose = () => {
				socketReadyRef.current = false;
				setIsRecording(false);
				setIsConnecting(false);
				void cleanupAudio();
			};
		} catch (err) {
			setError(err as Error);
			setIsConnecting(false);
			setIsRecording(false);
			await cleanupAudio();
		}
	}, [cleanupAudio, isConnecting, isRecording, onFinalTranscript, onTranscript, updateTranscript]);

	const stopRecording = useCallback(async () => {
		setIsRecording(false);
		setIsConnecting(false);
		socketReadyRef.current = false;
		await cleanupAudio();

		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'end_of_stream' }));
		}

		const finalizePromise = new Promise<string>((resolve) => {
			finalizeRef.current = (text) => resolve(text);
			setTimeout(() => resolve(transcriptRef.current.trim()), 1500);
		});

		try {
			return await finalizePromise;
		} finally {
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.close();
			}
			wsRef.current = null;
		}
	}, [cleanupAudio]);

	return useMemo(
		() => ({
			isRecording,
			isConnecting,
			transcript,
			error,
			startRecording,
			stopRecording,
		}),
		[error, isConnecting, isRecording, startRecording, stopRecording, transcript],
	);
};
