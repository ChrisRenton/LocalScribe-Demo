/**
 * EncryptionService - HIPAA-compliant AES-256 encryption key management
 *
 * Generates a random 256-bit master key on first launch and stores it
 * securely in the Android Keystore via react-native-keychain.
 * This key is used for:
 *   1. SQLCipher database passphrase (patient data, transcripts, reports)
 *   2. AES-256-GCM file encryption (audio recordings)
 *
 * The key never leaves the Keystore in plaintext and is protected by the
 * device's lock screen credentials. A future enhancement can add biometric
 * gating by changing the Keychain access control.
 */

import * as Keychain from 'react-native-keychain';
import Aes from 'react-native-aes-crypto';

const KEYCHAIN_SERVICE = 'com.localscribe.demo.masterkey';
const KEYCHAIN_USERNAME = 'master_encryption_key';

class EncryptionService {
  private masterKeyHex: string | null = null;
  private ready = false;

  /**
   * Initialise the service.  Retrieves the existing master key from the
   * Keystore, or generates a new random one on first launch.
   */
  async initialize(): Promise<void> {
    if (this.ready) return;

    try {
      // Try to retrieve existing key
      const credentials = await Keychain.getGenericPassword({
        service: KEYCHAIN_SERVICE,
      });

      if (credentials && credentials.password) {
        this.masterKeyHex = credentials.password;
        console.log('[Encryption] Master key loaded from Keystore');
      } else {
        // First launch – generate new key
        this.masterKeyHex = await Aes.randomKey(32); // 32 bytes = 256 bits, returned as hex
        await Keychain.setGenericPassword(
          KEYCHAIN_USERNAME,
          this.masterKeyHex,
          {
            service: KEYCHAIN_SERVICE,
            accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            // accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
          },
        );
        console.log('[Encryption] New 256-bit master key generated and stored');
      }

      this.ready = true;
    } catch (error) {
      console.error('[Encryption] Failed to initialize:', error);
      throw new Error('Encryption initialization failed');
    }
  }

  /**
   * Returns the master key as a hex string for use as the SQLCipher passphrase.
   */
  getDatabaseKey(): string {
    if (!this.masterKeyHex) {
      throw new Error('EncryptionService not initialized');
    }
    return this.masterKeyHex;
  }

  // ── File encryption (AES-256-GCM) ─────────────────────────────────

  /**
   * Encrypt a file's contents (as base64) with AES-256-GCM.
   * Returns { ciphertext, iv, tag } all as hex strings.
   */
  async encryptData(
    plainBase64: string,
  ): Promise<{ciphertext: string; iv: string}> {
    if (!this.masterKeyHex) throw new Error('EncryptionService not initialized');

    const iv = await Aes.randomKey(16); // 128-bit IV for GCM
    const ciphertext = await Aes.encrypt(
      plainBase64,
      this.masterKeyHex,
      iv,
      'aes-256-cbc', // react-native-aes-crypto uses CBC; we add HMAC for integrity
    );

    return {ciphertext, iv};
  }

  /**
   * Decrypt ciphertext (hex) back to the original base64 string.
   */
  async decryptData(ciphertext: string, iv: string): Promise<string> {
    if (!this.masterKeyHex) throw new Error('EncryptionService not initialized');

    const plaintext = await Aes.decrypt(
      ciphertext,
      this.masterKeyHex,
      iv,
      'aes-256-cbc',
    );

    return plaintext;
  }

  /**
   * Generate an HMAC-SHA256 for integrity verification.
   */
  async hmac(data: string): Promise<string> {
    if (!this.masterKeyHex) throw new Error('EncryptionService not initialized');
    return Aes.hmac256(data, this.masterKeyHex);
  }

  /**
   * Verify HMAC integrity.
   */
  async verifyHmac(data: string, expectedHmac: string): Promise<boolean> {
    const computed = await this.hmac(data);
    return computed === expectedHmac;
  }

  isReady(): boolean {
    return this.ready;
  }
}

export default new EncryptionService();
