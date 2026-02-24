/**
 * AudioPlaybackService - Bridge to native AudioPlayback module.
 *
 * Plays encrypted audio segments by time range.
 * Handles automatic decryption, seeking, and cleanup.
 */

import {NativeModules, NativeEventEmitter} from 'react-native';

const {AudioPlayback} = NativeModules;

type PlaybackCallback = {
  onComplete?: () => void;
  onError?: (error: string) => void;
};

class AudioPlaybackService {
  private emitter: NativeEventEmitter;
  private listeners: any[] = [];
  private callbacks: PlaybackCallback = {};

  constructor() {
    this.emitter = new NativeEventEmitter(AudioPlayback);
    this.listeners.push(
      this.emitter.addListener('onPlaybackComplete', () => {
        this.callbacks.onComplete?.();
      }),
      this.emitter.addListener('onPlaybackError', (error: string) => {
        this.callbacks.onError?.(error);
      }),
    );
  }

  setCallbacks(callbacks: PlaybackCallback) {
    this.callbacks = callbacks;
  }

  /**
   * Play a segment of an encrypted audio file.
   * @param encryptedPath - Absolute path to the .enc audio file
   * @param startSec - Start time in seconds
   * @param endSec - End time in seconds (-1 for play to end)
   */
  async playSegment(
    encryptedPath: string,
    startSec: number,
    endSec: number = -1,
  ): Promise<{playing: boolean; durationMs: number; startMs: number}> {
    return AudioPlayback.playSegment(encryptedPath, startSec, endSec);
  }

  /**
   * Play an unencrypted audio file from a specific position.
   */
  async playFile(
    filePath: string,
    startSec: number,
    endSec: number = -1,
  ): Promise<boolean> {
    return AudioPlayback.playFile(filePath, startSec, endSec);
  }

  async stop(): Promise<boolean> {
    return AudioPlayback.stop();
  }

  async isPlaying(): Promise<boolean> {
    return AudioPlayback.isPlaying();
  }

  cleanup() {
    this.listeners.forEach(l => l.remove());
    this.listeners = [];
  }
}

export const audioPlaybackService = new AudioPlaybackService();
export default audioPlaybackService;
