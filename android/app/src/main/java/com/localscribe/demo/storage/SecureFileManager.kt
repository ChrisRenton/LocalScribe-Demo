package com.localscribe.demo.storage

import android.content.Context
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKey
import java.io.File

/**
 * HIPAA-compliant encrypted file manager.
 *
 * Uses Android Jetpack Security (Tink) with:
 *   - AES-256-GCM-HKDF-4KB streaming encryption
 *   - Keys stored in Android Keystore (hardware-backed where available)
 *
 * Satisfies HIPAA Security Rule §164.312(a)(2)(iv) for ePHI at rest.
 */
object SecureFileManager {

    private const val SESSIONS_DIR = "secure_sessions"
    private const val TEMP_DIR = "secure_temp"

    /**
     * Get or create the MasterKey backed by Android Keystore.
     */
    private fun masterKey(context: Context): MasterKey {
        return MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    /**
     * Get the base directory for encrypted sessions.
     */
    fun sessionsDir(context: Context): File {
        val dir = File(context.filesDir, SESSIONS_DIR)
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    /**
     * Get a temp directory (for decrypted playback files etc.).
     */
    fun tempDir(context: Context): File {
        val dir = File(context.cacheDir, TEMP_DIR)
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    /**
     * Encrypt a plaintext file → encrypted file.
     * The source file is NOT deleted (caller decides).
     */
    fun encryptFile(context: Context, source: File, dest: File) {
        if (dest.exists()) dest.delete()

        val encFile = EncryptedFile.Builder(
            context,
            dest,
            masterKey(context),
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB
        ).build()

        encFile.openFileOutput().use { os ->
            source.inputStream().use { inp ->
                inp.copyTo(os, bufferSize = 8192)
            }
        }
    }

    /**
     * Decrypt an encrypted file to a temp plaintext file.
     * Caller is responsible for deleting the temp file after use.
     */
    fun decryptToTemp(context: Context, encrypted: File): File {
        val tempFile = File(tempDir(context), "dec_${System.currentTimeMillis()}_${encrypted.name}")

        val encFile = EncryptedFile.Builder(
            context,
            encrypted,
            masterKey(context),
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB
        ).build()

        encFile.openFileInput().use { inp ->
            tempFile.outputStream().use { os ->
                inp.copyTo(os, bufferSize = 8192)
            }
        }

        return tempFile
    }

    /**
     * Write a string (e.g. JSON transcript) to an encrypted file.
     */
    fun writeEncryptedString(context: Context, dest: File, content: String) {
        if (dest.exists()) dest.delete()

        val encFile = EncryptedFile.Builder(
            context,
            dest,
            masterKey(context),
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB
        ).build()

        encFile.openFileOutput().use { os ->
            os.write(content.toByteArray(Charsets.UTF_8))
        }
    }

    /**
     * Read an encrypted file's contents as a string.
     */
    fun readEncryptedString(context: Context, source: File): String {
        val encFile = EncryptedFile.Builder(
            context,
            source,
            masterKey(context),
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB
        ).build()

        return encFile.openFileInput().use { inp ->
            inp.bufferedReader(Charsets.UTF_8).readText()
        }
    }

    /**
     * Securely delete a file (overwrite then delete).
     */
    fun secureDelete(file: File) {
        if (!file.exists()) return
        try {
            val size = file.length()
            file.outputStream().use { os ->
                val buf = ByteArray(4096)
                var remaining = size
                while (remaining > 0) {
                    val toWrite = minOf(buf.size.toLong(), remaining).toInt()
                    os.write(buf, 0, toWrite)
                    remaining -= toWrite
                }
            }
        } catch (_: Exception) {}
        file.delete()
    }

    /**
     * Clean up all temp decrypted files.
     */
    fun cleanupTemp(context: Context) {
        tempDir(context).listFiles()?.forEach { it.delete() }
    }

    /**
     * List all session directories.
     */
    fun listSessions(context: Context): List<String> {
        return sessionsDir(context).listFiles()
            ?.filter { it.isDirectory }
            ?.map { it.name }
            ?.sorted()
            ?: emptyList()
    }
}
