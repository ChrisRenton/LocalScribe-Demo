import {NativeModules, NativeEventEmitter} from 'react-native';

const {MedASR} = NativeModules;

export interface TranscriptEvent {
  transcript: string;
  chunkText: string;
  chunkNumber: number;
  chunkDuration: number;
  /** Precise start time of this chunk in the recording (seconds) */
  chunkStartTimeSec: number;
  /** Precise end time of this chunk in the recording (seconds) */
  chunkEndTimeSec: number;
  processTimeMs: number;
  isFinal: boolean;
}

export interface TestResult {
  transcript: string;
  duration: number;
  processTimeMs: number;
  speedMultiplier: number;
}

export interface StartResult {
  sessionId: string;
}

export interface StopResult {
  transcript: string;
  duration: number;
  chunks: number;
  sessionId: string;
  /** Path to the AES-256-GCM encrypted audio file, or undefined on failure */
  encryptedAudioPath?: string;
}

export type ASRStatus =
  | 'uninitialized'
  | 'loading'
  | 'ready'
  | 'recording'
  | 'processing'
  | 'error';

type ASREventCallback = {
  onStatusChange?: (status: ASRStatus) => void;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  onTranscript?: (event: TranscriptEvent) => void;
  onError?: (error: {error: string; chunkNumber: number}) => void;
};

class MedASRService {
  private emitter: NativeEventEmitter;
  private listeners: any[] = [];
  private callbacks: ASREventCallback = {};
  private _status: ASRStatus = 'uninitialized';

  constructor() {
    this.emitter = new NativeEventEmitter(MedASR);
    this.setupListeners();
  }

  private setupListeners() {
    this.listeners.push(
      this.emitter.addListener('onStatusChange', (status: ASRStatus) => {
        this._status = status;
        this.callbacks.onStatusChange?.(status);
      }),
      this.emitter.addListener('onRecordingStart', () => {
        this.callbacks.onRecordingStart?.();
      }),
      this.emitter.addListener('onRecordingStop', () => {
        this.callbacks.onRecordingStop?.();
      }),
      this.emitter.addListener('onTranscript', (event: TranscriptEvent) => {
        this.callbacks.onTranscript?.(event);
      }),
      this.emitter.addListener('onError', (error: any) => {
        this.callbacks.onError?.(error);
      }),
    );
  }

  get status(): ASRStatus {
    return this._status;
  }

  setCallbacks(callbacks: ASREventCallback) {
    this.callbacks = callbacks;
  }

  async initialize(melPath?: string, asrPath?: string, tokenizerPath?: string): Promise<{
    success: boolean;
    loadTimeMs: number;
    vocabSize: number;
  }> {
    return MedASR.initialize(melPath ?? null, asrPath ?? null, tokenizerPath ?? null);
  }

  async startRecording(): Promise<StartResult> {
    return MedASR.startRecording();
  }

  async stopRecording(): Promise<StopResult> {
    return MedASR.stopRecording();
  }

  async testWithSample(): Promise<TestResult> {
    return MedASR.testWithSample();
  }

  async playDemoFromAsset(assetName: string): Promise<{transcript: string; duration: number; chunks: number; cancelled?: boolean; encryptedAudioPath?: string}> {
    return MedASR.playDemoFromAsset(assetName);
  }

  async stopDemo(): Promise<boolean> {
    return MedASR.stopDemo();
  }

  async isInitialized(): Promise<boolean> {
    return MedASR.isInitialized();
  }

  async isRecording(): Promise<boolean> {
    return MedASR.isRecording();
  }

  cleanup() {
    this.listeners.forEach(listener => listener.remove());
    this.listeners = [];
  }
}

export const medASRService = new MedASRService();
export default medASRService;
