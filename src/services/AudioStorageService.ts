/**
 * AudioStorageService - Encrypted audio file storage
 *
 * Handles:
 *   1. Saving audio recordings as encrypted files (AES-256-CBC + HMAC)
 *   2. Decrypting audio files for playback
 *   3. Managing the encrypted audio file directory
 *
 * Audio flow:
 *   Record WAV → Read as base64 → Encrypt → Write .enc file (with IV + HMAC header)
 *   Playback:  Read .enc file → Parse header → Decrypt → base64 audio data → Play
 *
 * File format (.enc):
 *   Line 1: IV (hex)
 *   Line 2: HMAC (hex)
 *   Line 3+: Ciphertext (hex)
 */

import RNFS from 'react-native-fs';
import encryptionService from './EncryptionService';

const AUDIO_DIR = `${RNFS.DocumentDirectoryPath}/encrypted_audio`;

class AudioStorageService {
  private initialized = false;

  /**
   * Ensure the encrypted audio directory exists.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const exists = await RNFS.exists(AUDIO_DIR);
    if (!exists) {
      await RNFS.mkdir(AUDIO_DIR);
    }
    this.initialized = true;
    console.log('[AudioStorage] Encrypted audio directory ready');
  }

  /**
   * Encrypt and save an audio file.
   * @param sourceFilePath  Path to the unencrypted audio file (WAV/AAC)
   * @param sessionId       Session ID for naming
   * @returns Path to the encrypted file
   */
  async saveEncrypted(
    sourceFilePath: string,
    sessionId: string,
  ): Promise<string> {
    await this.initialize();

    const audioBase64 = await RNFS.readFile(sourceFilePath, 'base64');

    const {ciphertext, iv} = await encryptionService.encryptData(audioBase64);

    const hmac = await encryptionService.hmac(ciphertext);

    const encPath = `${AUDIO_DIR}/${sessionId}.enc`;
    const encContent = `${iv}\n${hmac}\n${ciphertext}`;
    await RNFS.writeFile(encPath, encContent, 'utf8');

    const sourceExists = await RNFS.exists(sourceFilePath);
    if (sourceExists) {
      await RNFS.unlink(sourceFilePath);
    }

    const encSize = encContent.length;
    console.log(
      `[AudioStorage] Encrypted audio saved: ${encPath} (${(encSize / 1024).toFixed(1)} KB)`,
    );

    return encPath;
  }

  /**
   * Decrypt an audio file and return the base64 audio data.
   * Does NOT write the decrypted data to disk (HIPAA: minimize plaintext).
   * @param encryptedPath  Path to the .enc file
   * @returns base64-encoded audio data
   */
  async decryptToBase64(encryptedPath: string): Promise<string> {
    const encContent = await RNFS.readFile(encryptedPath, 'utf8');
    const lines = encContent.split('\n');

    if (lines.length < 3) {
      throw new Error('Invalid encrypted audio file format');
    }

    const iv = lines[0];
    const expectedHmac = lines[1];
    const ciphertext = lines.slice(2).join('\n');

    const valid = await encryptionService.verifyHmac(ciphertext, expectedHmac);
    if (!valid) {
      throw new Error(
        'Audio file integrity check failed - file may have been tampered with',
      );
    }

    const audioBase64 = await encryptionService.decryptData(ciphertext, iv);
    return audioBase64;
  }

  /**
   * Delete an encrypted audio file.
   */
  async deleteEncrypted(encryptedPath: string): Promise<void> {
    const exists = await RNFS.exists(encryptedPath);
    if (exists) {
      await RNFS.unlink(encryptedPath);
      console.log(`[AudioStorage] Deleted encrypted audio: ${encryptedPath}`);
    }
  }

  /**
   * Get the total size of all encrypted audio files.
   */
  async getTotalSize(): Promise<number> {
    await this.initialize();
    const files = await RNFS.readDir(AUDIO_DIR);
    return files.reduce((sum, f) => sum + (f.size || 0), 0);
  }

  /**
   * List all encrypted audio files.
   */
  async listFiles(): Promise<string[]> {
    await this.initialize();
    const files = await RNFS.readDir(AUDIO_DIR);
    return files.filter(f => f.name.endsWith('.enc')).map(f => f.path);
  }
}

export default new AudioStorageService();
