import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WS_URL } from '@/lib/api';

type VoiceInputOptions = {
	onTranscript?: (text: string) => void;
	onFinalTranscript?: (text: string) => void;
	onAutoStop?: (text: string) => void;
	vadEnabled?: boolean;
	vadSilenceMs?: number;
	vadThreshold?: number;
};

type VoiceInputState = {
	isRecording: boolean;
	isConnecting: boolean;
	transcript: string;
	error?: Error;
	startRecording: () => Promise<void>;
	stopRecording: (reason?: 'manual' | 'vad') => Promise<string>;
};

const TARGET_SAMPLE_RATE = 24000;
const PROCESSOR_BUFFER_SIZE = 4096;
const DEFAULT_VAD_SILENCE_MS = 1500;
const DEFAULT_VAD_THRESHOLD = 0.012;

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

export const useVoiceInput = ({
	onTranscript,
	onFinalTranscript,
	onAutoStop,
	vadEnabled = false,
	vadSilenceMs = DEFAULT_VAD_SILENCE_MS,
	vadThreshold = DEFAULT_VAD_THRESHOLD,
}: VoiceInputOptions = {}): VoiceInputState => {
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
	const isRecordingRef = useRef(false);
	const vadEnabledRef = useRef(vadEnabled);
	const vadSilenceMsRef = useRef(vadSilenceMs);
	const vadThresholdRef = useRef(vadThreshold);
	const lastVoiceAtRef = useRef(0);
	const hasVoiceRef = useRef(false);
	const vadIntervalRef = useRef<number | null>(null);
	const stoppingRef = useRef(false);

	const clearVadInterval = useCallback(() => {
		if (vadIntervalRef.current) {
			window.clearInterval(vadIntervalRef.current);
			vadIntervalRef.current = null;
		}
	}, []);

	const startVadInterval = useCallback(
		(triggerStop: () => void) => {
			clearVadInterval();
			vadIntervalRef.current = window.setInterval(() => {
				if (!isRecordingRef.current || !vadEnabledRef.current) return;
				if (!hasVoiceRef.current) return;
				const silenceFor = Date.now() - lastVoiceAtRef.current;
				if (silenceFor >= vadSilenceMsRef.current) {
					triggerStop();
				}
			}, 150);
		},
		[clearVadInterval],
	);

	useEffect(() => {
		vadEnabledRef.current = vadEnabled;
		vadSilenceMsRef.current = vadSilenceMs;
		vadThresholdRef.current = vadThreshold;
	}, [vadEnabled, vadSilenceMs, vadThreshold]);

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
		clearVadInterval();
	}, []);

	const stopRecording = useCallback(
		async (reason: 'manual' | 'vad' = 'manual') => {
			if (stoppingRef.current) {
				return transcriptRef.current.trim();
			}
			stoppingRef.current = true;
			setIsRecording(false);
			setIsConnecting(false);
			isRecordingRef.current = false;
			socketReadyRef.current = false;
			clearVadInterval();
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
				const finalText = await finalizePromise;
				if (reason === 'vad') {
					onAutoStop?.(finalText);
				}
				return finalText;
			} finally {
				if (ws && ws.readyState === WebSocket.OPEN) {
					ws.close();
				}
				wsRef.current = null;
				stoppingRef.current = false;
			}
		},
		[clearVadInterval, cleanupAudio, onAutoStop],
	);

	const startRecording = useCallback(async () => {
		if (isRecording || isConnecting) return;
		setError(undefined);
		setTranscript('');
		transcriptRef.current = '';
		setIsConnecting(true);
		hasVoiceRef.current = false;
		lastVoiceAtRef.current = Date.now();

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
				let sumSquares = 0;
				for (let i = 0; i < input.length; i++) {
					sumSquares += input[i] * input[i];
				}
				const rms = Math.sqrt(sumSquares / input.length);
				if (rms > vadThresholdRef.current) {
					lastVoiceAtRef.current = Date.now();
					hasVoiceRef.current = true;
				}
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
				isRecordingRef.current = true;
				if (vadEnabledRef.current) {
					startVadInterval(() => {
						if (!stoppingRef.current) {
							void stopRecording('vad');
						}
					});
				}
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
				isRecordingRef.current = false;
				void cleanupAudio();
			};
		} catch (err) {
			setError(err as Error);
			setIsConnecting(false);
			setIsRecording(false);
			isRecordingRef.current = false;
			await cleanupAudio();
		}
	}, [cleanupAudio, isConnecting, isRecording, onFinalTranscript, onTranscript, startVadInterval, stopRecording, updateTranscript]);

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
