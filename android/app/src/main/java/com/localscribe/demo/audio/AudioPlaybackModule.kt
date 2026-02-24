package com.localscribe.demo.audio

import android.media.MediaPlayer
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.localscribe.demo.storage.SecureFileManager
import kotlinx.coroutines.*
import java.io.File

/**
 * React Native native module for audio playback with seeking.
 *
 * Handles decryption of encrypted audio files → temp WAV → MediaPlayer.
 * Supports playing a specific time segment (startSec → endSec).
 */
class AudioPlaybackModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AudioPlayback"

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var mediaPlayer: MediaPlayer? = null
    private var tempDecryptedFile: File? = null
    private var stopJob: Job? = null

    /**
     * Play an encrypted audio file from startSec to endSec.
     *
     * @param encryptedPath Absolute path to encrypted WAV file
     * @param startSec      Start time in seconds
     * @param endSec        End time in seconds (-1 = play to end)
     */
    @ReactMethod
    fun playSegment(encryptedPath: String, startSec: Double, endSec: Double, promise: Promise) {
        scope.launch {
            try {
                stopInternal()

                val encFile = File(encryptedPath)
                if (!encFile.exists()) {
                    promise.reject("FILE_NOT_FOUND", "Encrypted audio file not found: $encryptedPath")
                    return@launch
                }

                val tempFile = withContext(Dispatchers.IO) {
                    SecureFileManager.decryptToTemp(reactApplicationContext, encFile)
                }
                tempDecryptedFile = tempFile

                val mp = MediaPlayer()
                mp.setDataSource(tempFile.absolutePath)
                mp.prepare()

                val startMs = (startSec * 1000).toInt().coerceAtLeast(0)
                val durationMs = mp.duration

                mp.seekTo(startMs)
                mp.start()

                mp.setOnCompletionListener {
                    cleanupPlayback()
                    sendEvent("onPlaybackComplete", null)
                }

                mp.setOnErrorListener { _, what, extra ->
                    cleanupPlayback()
                    sendEvent("onPlaybackError", "MediaPlayer error: what=$what extra=$extra")
                    true
                }

                mediaPlayer = mp

                if (endSec > 0 && endSec > startSec) {
                    val playDurationMs = ((endSec - startSec) * 1000).toLong()
                    stopJob = scope.launch {
                        delay(playDurationMs)
                        stopInternal()
                        sendEvent("onPlaybackComplete", null)
                    }
                }

                val result = Arguments.createMap().apply {
                    putBoolean("playing", true)
                    putInt("durationMs", durationMs)
                    putInt("startMs", startMs)
                }
                promise.resolve(result)

            } catch (e: Exception) {
                cleanupPlayback()
                promise.reject("PLAYBACK_ERROR", e.message, e)
            }
        }
    }

    /**
     * Play an unencrypted (already decrypted / temp) audio file.
     */
    @ReactMethod
    fun playFile(filePath: String, startSec: Double, endSec: Double, promise: Promise) {
        scope.launch {
            try {
                stopInternal()

                val file = File(filePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "Audio file not found: $filePath")
                    return@launch
                }

                val mp = MediaPlayer()
                mp.setDataSource(file.absolutePath)
                mp.prepare()

                val startMs = (startSec * 1000).toInt().coerceAtLeast(0)
                mp.seekTo(startMs)
                mp.start()

                mp.setOnCompletionListener {
                    cleanupPlayback()
                    sendEvent("onPlaybackComplete", null)
                }

                mediaPlayer = mp

                if (endSec > 0 && endSec > startSec) {
                    val playDurationMs = ((endSec - startSec) * 1000).toLong()
                    stopJob = scope.launch {
                        delay(playDurationMs)
                        stopInternal()
                        sendEvent("onPlaybackComplete", null)
                    }
                }

                promise.resolve(true)
            } catch (e: Exception) {
                cleanupPlayback()
                promise.reject("PLAYBACK_ERROR", e.message, e)
            }
        }
    }

    /**
     * Stop current playback.
     */
    @ReactMethod
    fun stop(promise: Promise) {
        try {
            stopInternal()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message, e)
        }
    }

    /**
     * Check if audio is currently playing.
     */
    @ReactMethod
    fun isPlaying(promise: Promise) {
        promise.resolve(mediaPlayer?.isPlaying ?: false)
    }

    private fun stopInternal() {
        stopJob?.cancel()
        stopJob = null

        try {
            mediaPlayer?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
        } catch (_: Exception) {}
        mediaPlayer = null

        cleanupTempFile()
    }

    private fun cleanupPlayback() {
        try {
            mediaPlayer?.release()
        } catch (_: Exception) {}
        mediaPlayer = null
        cleanupTempFile()
    }

    private fun cleanupTempFile() {
        tempDecryptedFile?.let {
            SecureFileManager.secureDelete(it)
        }
        tempDecryptedFile = null
    }

    private fun sendEvent(eventName: String, params: Any?) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    override fun invalidate() {
        super.invalidate()
        stopInternal()
        scope.cancel()
    }
}
