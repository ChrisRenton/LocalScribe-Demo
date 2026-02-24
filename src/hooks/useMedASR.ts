import {useState, useEffect, useCallback, useRef} from 'react';
import medASRService, {
  ASRStatus,
  TranscriptEvent,
  TestResult,
  StopResult,
} from '../services/MedASRService';
import llamaService from '../services/LlamaService';
import {TimestampedChunkData} from '../services/SessionStorageService';

export type ChunkCallback = (
  text: string,
  startTimeSec: number,
  endTimeSec: number,
  chunkNumber: number,
) => void;

export interface UseMedASRResult {
  status: ASRStatus;
  isReady: boolean;
  isRecording: boolean;
  transcript: string;
  error: string | null;
  debugLogs: string[];
  /** Current session ID (set when recording starts) */
  sessionId: string | null;
  /** Timestamped chunks collected during this recording */
  timestampedChunks: TimestampedChunkData[];
  /** Set a callback to receive annotated chunk text (with [alt1|alt2] markers) */
  onChunkRef: React.MutableRefObject<ChunkCallback | null>;
  initialize: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<StopResult | null>;
  testWithSample: () => Promise<TestResult | null>;
  playDemo: (assetName?: string) => Promise<{encryptedAudioPath?: string} | void>;
  stopDemo: () => Promise<void>;
  clearTranscript: () => void;
}

export function useMedASR(autoInitialize = false): UseMedASRResult {
  const [status, setStatus] = useState<ASRStatus>('uninitialized');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [timestampedChunks, setTimestampedChunks] = useState<
    TimestampedChunkData[]
  >([]);

  const onChunkRef = useRef<
    | ((
        text: string,
        startTimeSec: number,
        endTimeSec: number,
        chunkNumber: number,
      ) => void)
    | null
  >(null);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setDebugLogs(prev => [...prev.slice(-19), `[${time}] ${msg}`]);
  };

  useEffect(() => {
    medASRService.setCallbacks({
      onStatusChange: newStatus => {
        setStatus(newStatus);
        addLog(`Status: ${newStatus}`);
      },
      onTranscript: (event: TranscriptEvent) => {
        setTranscript(event.transcript);

        const chunkData: TimestampedChunkData = {
          chunkNumber: event.chunkNumber,
          text: event.chunkText,
          startTimeSec: event.chunkStartTimeSec,
          endTimeSec: event.chunkEndTimeSec,
        };
        setTimestampedChunks(prev => [...prev, chunkData]);

        const rtf =
          event.processTimeMs / 1000 / event.chunkDuration;
        addLog(
          `Chunk #${event.chunkNumber} [${fmtTime(event.chunkStartTimeSec)}-${fmtTime(event.chunkEndTimeSec)}]: ` +
            `audio=${event.chunkDuration.toFixed(1)}s, proc=${event.processTimeMs}ms (${rtf.toFixed(2)}x RT)`,
        );

        onChunkRef.current?.(
          event.chunkText,
          event.chunkStartTimeSec,
          event.chunkEndTimeSec,
          event.chunkNumber,
        );
      },
      onError: err => {
        setError(err.error);
        addLog(`ERROR: ${err.error}`);
      },
    });

    if (autoInitialize) {
      addLog('Auto-initializing ASR...');
      medASRService.initialize().catch(e => {
        setError(e.message);
        addLog(`Init error: ${e.message}`);
      });
    }

    return () => {};
  }, [autoInitialize]);

  const initialize = useCallback(async () => {
    try {
      setError(null);
      addLog('Initializing ASR...');
      const paths = llamaService.getAsrModelPaths();
      const res = await medASRService.initialize(paths.mel, paths.asr, paths.tokenizer);
      addLog(`Initialized in ${res.loadTimeMs}ms, vocab=${res.vocabSize}`);
    } catch (e: any) {
      setError(e.message);
      addLog(`Init error: ${e.message}`);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscript('');
      setDebugLogs([]);
      setTimestampedChunks([]);
      addLog('Starting recording...');
      const result = await medASRService.startRecording();
      setSessionId(result.sessionId);
      addLog(`Recording started (session: ${result.sessionId.slice(0, 8)}...)`);
    } catch (e: any) {
      setError(e.message);
      addLog(`Start error: ${e.message}`);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<StopResult | null> => {
    try {
      addLog('Stopping recording...');
      const result = await medASRService.stopRecording();
      addLog(
        `Stopped: ${result?.chunks || 0} chunks, ${result?.duration?.toFixed(1) || 0}s` +
          (result?.encryptedAudioPath ? ' [audio encrypted]' : ' [no audio saved]'),
      );
      return result;
    } catch (e: any) {
      setError(e.message);
      addLog(`Stop error: ${e.message}`);
      return null;
    }
  }, []);

  const testWithSample = useCallback(async (): Promise<TestResult | null> => {
    try {
      setError(null);
      setTranscript('');
      setDebugLogs([]);
      setTimestampedChunks([]);
      addLog('Testing with sample...');
      const result = await medASRService.testWithSample();
      if (result?.transcript) {
        setTranscript(result.transcript);
        addLog(
          `Test done: ${result.processTimeMs}ms, ${result.speedMultiplier.toFixed(1)}x`,
        );
      }
      return result;
    } catch (e: any) {
      setError(e.message);
      addLog(`Test error: ${e.message}`);
      return null;
    }
  }, []);

  const playDemo = useCallback(async (assetName: string = 'GOOD_CONVO.wav'): Promise<{encryptedAudioPath?: string} | void> => {
    try {
      setError(null);
      setTranscript('');
      setDebugLogs([]);
      setTimestampedChunks([]);
      addLog('Starting demo from WAV file...');
      const result = await medASRService.playDemoFromAsset(assetName);
      addLog(
        `Demo finished: ${result.chunks} chunks, ${result.duration?.toFixed(1)}s` +
          (result.cancelled ? ' (cancelled)' : ''),
      );
      return {encryptedAudioPath: result.encryptedAudioPath};
    } catch (e: any) {
      setError(e.message);
      addLog(`Demo error: ${e.message}`);
    }
  }, []);

  const stopDemo = useCallback(async () => {
    try {
      addLog('Stopping demo...');
      await medASRService.stopDemo();
    } catch (e: any) {
      addLog(`Stop demo error: ${e.message}`);
    }
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setTimestampedChunks([]);
  }, []);

  return {
    status,
    isReady: status === 'ready',
    isRecording: status === 'recording',
    transcript,
    error,
    debugLogs,
    sessionId,
    timestampedChunks,
    onChunkRef,
    initialize,
    startRecording,
    stopRecording,
    testWithSample,
    playDemo,
    stopDemo,
    clearTranscript,
  };
}

/** Format seconds as MM:SS */
function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default useMedASR;
