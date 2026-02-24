package com.localscribe.demo.asr

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.localscribe.demo.storage.SecureFileManager
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import java.io.File
import java.util.UUID

/**
 * React Native Bridge Module for MedASR.
 *
 * Provides ASR functionality to JavaScript code, including:
 * - Model loading
 * - Live recording → ASR with per-chunk timestamps
 * - Concurrent WAV file writing
 * - AES-256-GCM encryption of recorded audio
 */
class MedASRModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "MedASR"

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private var pipeline: MedASRPipeline? = null
    private var decoder: CtcDecoder? = null
    private var recorder: AudioRecorder? = null
    private var wavWriter: WavFileWriter? = null
    private var wavWriterJob: Job? = null
    private var recordingJob: Job? = null
    private var isModelLoaded = false

    private val fullTranscription = StringBuilder()
    private var chunkCount = 0
    private var previousChunkWords: List<String> = emptyList()

    private var currentSessionId: String? = null
    private var currentTempWavFile: File? = null

    // -----------------------------------------------------------------------
    // Model loading
    // -----------------------------------------------------------------------

    @ReactMethod
    fun initialize(melPath: String?, asrPath: String?, tokenizerPath: String?, promise: Promise) {
        android.util.Log.d("MedASR", "initialize called, isModelLoaded=$isModelLoaded")
        scope.launch {
            try {
                sendEvent("onStatusChange", "loading")
                val startTime = System.currentTimeMillis()

                val melModelFile: File
                val asrModelFile: File
                val vocabFile: File

                if (melPath != null && asrPath != null && tokenizerPath != null) {
                    melModelFile = File(melPath)
                    asrModelFile = File(asrPath)
                    vocabFile = File(tokenizerPath)
                } else {
                    melModelFile = copyAssetToCache("medasr_mel_fp32.onnx")
                    asrModelFile = copyAssetToCache("medasr_asr_int8.onnx")
                    vocabFile = copyAssetToCache("tokenizer.json")
                }

                val vocabJson = vocabFile.readText()
                val vocabulary = CtcDecoder.loadVocabulary(vocabJson)
                decoder = CtcDecoder(vocabulary, blankId = 0)

                pipeline = withContext(Dispatchers.IO) {
                    MedASRPipeline(melModelFile.absolutePath, asrModelFile.absolutePath)
                }

                val loadTime = System.currentTimeMillis() - startTime
                isModelLoaded = true

                sendEvent("onStatusChange", "ready")

                val result = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putInt("loadTimeMs", loadTime.toInt())
                    putInt("vocabSize", vocabulary.size)
                }
                promise.resolve(result)

            } catch (e: Exception) {
                sendEvent("onStatusChange", "error")
                promise.reject("INIT_ERROR", e.message, e)
            }
        }
    }

    // -----------------------------------------------------------------------
    // Recording
    // -----------------------------------------------------------------------

    @ReactMethod
    fun startRecording(promise: Promise) {
        if (!isModelLoaded) {
            promise.reject("NOT_INITIALIZED", "Models not loaded. Call initialize() first.")
            return
        }
        if (recorder?.isRecording() == true) {
            promise.reject("ALREADY_RECORDING", "Recording is already in progress")
            return
        }

        currentSessionId = UUID.randomUUID().toString()
        currentTempWavFile = File(
            reactApplicationContext.cacheDir,
            "recording_${currentSessionId}.wav"
        )

        recorder = AudioRecorder()

        if (!recorder!!.start()) {
            promise.reject("RECORD_ERROR", "Failed to start recording")
            return
        }

        chunkCount = 0
        fullTranscription.clear()
        previousChunkWords = emptyList()

        wavWriter = WavFileWriter(currentTempWavFile!!)
        wavWriter!!.start()

        wavWriterJob = scope.launch(Dispatchers.IO) {
            recorder?.audioBuffers?.collectLatest { buffer ->
                wavWriter?.writeSamples(buffer)
            }
        }

        recordingJob = scope.launch {
            recorder?.timestampedChunks?.collectLatest { tsChunk ->
                processChunk(
                    tsChunk.audio,
                    isFinal = false,
                    chunkStartTimeSec = tsChunk.startTimeSec,
                    chunkEndTimeSec = tsChunk.endTimeSec,
                )
            }
        }

        sendEvent("onRecordingStart", null)
        sendEvent("onStatusChange", "recording")

        val sessionInfo = Arguments.createMap().apply {
            putString("sessionId", currentSessionId)
        }
        promise.resolve(sessionInfo)
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        scope.launch {
            try {
                recordingJob?.cancel()
                recordingJob = null
                wavWriterJob?.cancel()
                wavWriterJob = null

                val remaining = recorder?.stop()

                if (remaining != null && remaining.audio.isNotEmpty()) {
                    withContext(Dispatchers.IO) {
                        wavWriter?.writeSamples(remaining.audio)
                    }
                }

                withContext(Dispatchers.IO) {
                    wavWriter?.finish()
                }
                wavWriter = null

                if (remaining != null && remaining.audio.size > 8000) {
                    processChunk(
                        remaining.audio,
                        isFinal = true,
                        chunkStartTimeSec = remaining.startTimeSec,
                        chunkEndTimeSec = remaining.endTimeSec,
                    )
                }

                val totalDuration = recorder?.recordingDurationSeconds ?: 0f

                var encryptedAudioPath: String? = null
                val tempWav = currentTempWavFile
                if (tempWav != null && tempWav.exists() && tempWav.length() > 44) {
                    try {
                        val sessionDir = File(
                            SecureFileManager.sessionsDir(reactApplicationContext),
                            currentSessionId ?: "unknown"
                        )
                        sessionDir.mkdirs()

                        val encryptedFile = File(sessionDir, "audio.enc")
                        withContext(Dispatchers.IO) {
                            SecureFileManager.encryptFile(
                                reactApplicationContext, tempWav, encryptedFile
                            )
                            SecureFileManager.secureDelete(tempWav)
                        }
                        encryptedAudioPath = encryptedFile.absolutePath
                    } catch (e: Exception) {
                        // Encryption failed — still return result without path
                        android.util.Log.e("MedASR", "WAV encryption failed", e)
                    }
                }

                sendEvent("onRecordingStop", null)
                sendEvent("onStatusChange", "ready")

                val result = Arguments.createMap().apply {
                    putString("transcript", fullTranscription.toString().trim())
                    putDouble("duration", totalDuration.toDouble())
                    putInt("chunks", chunkCount)
                    putString("sessionId", currentSessionId)
                    if (encryptedAudioPath != null) {
                        putString("encryptedAudioPath", encryptedAudioPath)
                    }
                }

                recorder = null
                currentTempWavFile = null
                promise.resolve(result)

            } catch (e: Exception) {
                promise.reject("STOP_ERROR", e.message, e)
            }
        }
    }

    // -----------------------------------------------------------------------
    // Encrypted transcript storage
    // -----------------------------------------------------------------------

    /**
     * Save an encrypted JSON transcript for the given session.
     */
    @ReactMethod
    fun saveEncryptedTranscript(sessionId: String, jsonContent: String, promise: Promise) {
        scope.launch(Dispatchers.IO) {
            try {
                val sessionDir = File(
                    SecureFileManager.sessionsDir(reactApplicationContext), sessionId
                )
                sessionDir.mkdirs()
                val transcriptFile = File(sessionDir, "transcript.enc")
                SecureFileManager.writeEncryptedString(
                    reactApplicationContext, transcriptFile, jsonContent
                )
                promise.resolve(transcriptFile.absolutePath)
            } catch (e: Exception) {
                promise.reject("ENCRYPT_ERROR", e.message, e)
            }
        }
    }

    /**
     * Read an encrypted transcript JSON.
     */
    @ReactMethod
    fun readEncryptedTranscript(sessionId: String, promise: Promise) {
        scope.launch(Dispatchers.IO) {
            try {
                val transcriptFile = File(
                    SecureFileManager.sessionsDir(reactApplicationContext),
                    "$sessionId/transcript.enc"
                )
                if (!transcriptFile.exists()) {
                    promise.reject("NOT_FOUND", "Transcript not found for session $sessionId")
                    return@launch
                }
                val content = SecureFileManager.readEncryptedString(
                    reactApplicationContext, transcriptFile
                )
                promise.resolve(content)
            } catch (e: Exception) {
                promise.reject("DECRYPT_ERROR", e.message, e)
            }
        }
    }

    /**
     * List all session IDs.
     */
    @ReactMethod
    fun listSessions(promise: Promise) {
        scope.launch(Dispatchers.IO) {
            try {
                val sessions = SecureFileManager.listSessions(reactApplicationContext)
                val arr = Arguments.createArray()
                sessions.forEach { arr.pushString(it) }
                promise.resolve(arr)
            } catch (e: Exception) {
                promise.reject("LIST_ERROR", e.message, e)
            }
        }
    }

    // -----------------------------------------------------------------------
    // Demo playback from asset WAV
    // -----------------------------------------------------------------------

    private var demoJob: Job? = null

    @ReactMethod
    fun playDemoFromAsset(assetName: String, promise: Promise) {
        if (!isModelLoaded) {
            promise.reject("NOT_INITIALIZED", "Models not loaded. Call initialize() first.")
            return
        }
        if (demoJob?.isActive == true) {
            promise.reject("ALREADY_RUNNING", "Demo is already playing")
            return
        }

        demoJob = scope.launch {
            var audioTrack: android.media.AudioTrack? = null
            var audioFile: File? = null
            try {
                chunkCount = 0
                fullTranscription.clear()
                previousChunkWords = emptyList()

                sendEvent("onStatusChange", "recording")
                sendEvent("onRecordingStart", null)

                audioFile = copyAssetToCache(assetName)
                val audio = withContext(Dispatchers.IO) {
                    WavLoader.load(audioFile.absolutePath)
                }

                val sampleRate = 16000
                val chunkSamples = 5 * sampleRate
                val searchWindow = sampleRate  // search last 1s for silence
                val frameSize = sampleRate / 10  // 100ms energy window
                val totalSamples = audio.size
                var offset = 0

                audioTrack = android.media.AudioTrack.Builder()
                    .setAudioAttributes(
                        android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    .setAudioFormat(
                        android.media.AudioFormat.Builder()
                            .setSampleRate(sampleRate)
                            .setEncoding(android.media.AudioFormat.ENCODING_PCM_16BIT)
                            .setChannelMask(android.media.AudioFormat.CHANNEL_OUT_MONO)
                            .build()
                    )
                    .setBufferSizeInBytes(sampleRate * 2)
                    .setTransferMode(android.media.AudioTrack.MODE_STREAM)
                    .build()
                audioTrack!!.play()

                var playbackJob: Job? = null
                playbackJob = scope.launch(Dispatchers.IO) {
                    val pcm16 = ShortArray(audio.size)
                    for (i in audio.indices) {
                        pcm16[i] = (audio[i] * 32767f).toInt().coerceIn(-32768, 32767).toShort()
                    }
                    audioTrack!!.write(pcm16, 0, pcm16.size)
                }

                // delay to simulate first 5 second chunk appearing
                delay(4000)

                while (offset < totalSamples && isActive) {
                    val rawEnd = minOf(offset + chunkSamples, totalSamples)

                    val splitAt = if (rawEnd < totalSamples) {
                        findSilenceSplitInRange(audio, maxOf(offset, rawEnd - searchWindow), rawEnd, frameSize)
                    } else {
                        rawEnd
                    }

                    val chunk = audio.copyOfRange(offset, splitAt)
                    val startTimeSec = offset.toDouble() / sampleRate
                    val endTimeSec = splitAt.toDouble() / sampleRate
                    val isFinal = splitAt >= totalSamples

                    if (offset > 0) {
                        delay(chunk.size * 1000L / sampleRate)
                    }

                    if (chunk.size >= sampleRate / 2) {
                        processChunk(chunk, isFinal, startTimeSec, endTimeSec)
                    }

                    offset = splitAt
                }

                playbackJob?.cancel()
                try { audioTrack?.stop(); audioTrack?.release() } catch (_: Exception) {}

                sendEvent("onRecordingStop", null)
                sendEvent("onStatusChange", "ready")

                // Encrypt the demo WAV so timestamp playback works
                var encryptedPath: String? = null
                try {
                    val demoSessionId = "demo_${System.currentTimeMillis()}"
                    val sessionDir = File(
                        SecureFileManager.sessionsDir(reactApplicationContext),
                        demoSessionId
                    )
                    sessionDir.mkdirs()
                    val encryptedFile = File(sessionDir, "audio.enc")
                    withContext(Dispatchers.IO) {
                        SecureFileManager.encryptFile(
                            reactApplicationContext, audioFile, encryptedFile
                        )
                    }
                    encryptedPath = encryptedFile.absolutePath
                } catch (e: Exception) {
                    android.util.Log.e("MedASR", "Demo audio encryption failed", e)
                }

                promise.resolve(Arguments.createMap().apply {
                    putString("transcript", fullTranscription.toString().trim())
                    putDouble("duration", totalSamples.toDouble() / sampleRate)
                    putInt("chunks", chunkCount)
                    if (encryptedPath != null) {
                        putString("encryptedAudioPath", encryptedPath)
                    }
                })
            } catch (e: CancellationException) {
                try { audioTrack?.stop(); audioTrack?.release() } catch (_: Exception) {}
                sendEvent("onRecordingStop", null)
                sendEvent("onStatusChange", "ready")

                // Encrypt the demo audio even on cancellation so timestamp playback works
                var encryptedPath: String? = null
                if (audioFile != null && audioFile!!.exists()) {
                    try {
                        val demoSessionId = "demo_${System.currentTimeMillis()}"
                        val sessionDir = File(
                            SecureFileManager.sessionsDir(reactApplicationContext),
                            demoSessionId
                        )
                        sessionDir.mkdirs()
                        val encryptedFile = File(sessionDir, "audio.enc")
                        withContext(Dispatchers.IO + kotlinx.coroutines.NonCancellable) {
                            SecureFileManager.encryptFile(
                                reactApplicationContext, audioFile!!, encryptedFile
                            )
                        }
                        encryptedPath = encryptedFile.absolutePath
                    } catch (encErr: Exception) {
                        android.util.Log.e("MedASR", "Demo audio encryption on cancel failed", encErr)
                    }
                }

                promise.resolve(Arguments.createMap().apply {
                    putString("transcript", fullTranscription.toString().trim())
                    putBoolean("cancelled", true)
                    if (encryptedPath != null) {
                        putString("encryptedAudioPath", encryptedPath)
                    }
                })
            } catch (e: Exception) {
                sendEvent("onStatusChange", "ready")
                promise.reject("DEMO_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun stopDemo(promise: Promise) {
        demoJob?.cancel()
        demoJob = null
        promise.resolve(true)
    }

    // -----------------------------------------------------------------------
    // Test with sample
    // -----------------------------------------------------------------------

    @ReactMethod
    fun testWithSample(promise: Promise) {
        if (!isModelLoaded) {
            promise.reject("NOT_INITIALIZED", "Models not loaded")
            return
        }
        scope.launch {
            try {
                sendEvent("onStatusChange", "processing")

                val audioFile = copyAssetToCache("test_audio.wav")
                val audio = withContext(Dispatchers.IO) {
                    WavLoader.load(audioFile.absolutePath)
                }

                val duration = audio.size / 16000.0
                val startTime = System.currentTimeMillis()

                val logits = withContext(Dispatchers.Default) {
                    pipeline!!.transcribe(audio)
                }

                val text = decoder!!.greedyDecode(logits)
                val processTime = System.currentTimeMillis() - startTime
                val rtf = processTime / 1000.0 / duration

                sendEvent("onStatusChange", "ready")

                val result = Arguments.createMap().apply {
                    putString("transcript", text)
                    putDouble("duration", duration)
                    putInt("processTimeMs", processTime.toInt())
                    putDouble("speedMultiplier", 1.0 / rtf)
                }
                promise.resolve(result)

            } catch (e: Exception) {
                sendEvent("onStatusChange", "ready")
                promise.reject("TEST_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun isInitialized(promise: Promise) {
        promise.resolve(isModelLoaded)
    }

    @ReactMethod
    fun isRecording(promise: Promise) {
        promise.resolve(recorder?.isRecording() ?: false)
    }

    // -----------------------------------------------------------------------
    // ASR chunk processing
    // -----------------------------------------------------------------------

    private suspend fun processChunk(
        audio: FloatArray,
        isFinal: Boolean,
        chunkStartTimeSec: Double,
        chunkEndTimeSec: Double,
    ) {
        val pipeline = this.pipeline ?: return
        val decoder = this.decoder ?: return

        chunkCount++
        val duration = audio.size / 16000.0

        try {
            val startTime = System.currentTimeMillis()

            android.util.Log.d("MedASR", "processChunk#$chunkCount: ${audio.size} samples, running ASR...")
            val logits = withContext(Dispatchers.Default) {
                pipeline.transcribe(audio)
            }

            val rawText = decoder.greedyDecode(logits)

            val beamResults = withContext(Dispatchers.Default) {
                decoder.beamSearch(logits, beamWidth = 5, topK = 3)
            }
            val rawAnnotated = decoder.annotateWithAlternatives(beamResults)
            for ((i, hyp) in beamResults.withIndex()) {
                android.util.Log.d("MedASR", "Chunk#$chunkCount beam[$i]: score=${String.format("%.2f", hyp.score)} \"${hyp.text.take(120)}\"")
            }

            val text = deduplicateOverlap(rawText.trim(), previousChunkWords)
            val annotatedText = deduplicateOverlap(rawAnnotated.trim(), previousChunkWords)

            val currentWords = text.trim().split(Regex("\\s+"))
            previousChunkWords = if (currentWords.size > 5) currentWords.takeLast(5) else currentWords

            if (annotatedText != text) {
                android.util.Log.d("MedASR", "Chunk#$chunkCount annotated: \"${annotatedText.take(150)}\"")
            }

            val processTime = System.currentTimeMillis() - startTime

            if (text.isNotBlank()) {
                fullTranscription.append(text).append(" ")

                val chunkForLlm = if (annotatedText.isNotBlank()) annotatedText else text
                val event = Arguments.createMap().apply {
                    putString("transcript", fullTranscription.toString().trim())
                    putString("chunkText", chunkForLlm)
                    putInt("chunkNumber", chunkCount)
                    putDouble("chunkDuration", duration)
                    putDouble("chunkStartTimeSec", chunkStartTimeSec)
                    putDouble("chunkEndTimeSec", chunkEndTimeSec)
                    putInt("processTimeMs", processTime.toInt())
                    putBoolean("isFinal", isFinal)
                }

                sendEvent("onTranscript", event)
            }
        } catch (e: Exception) {
            val event = Arguments.createMap().apply {
                putString("error", e.message)
                putInt("chunkNumber", chunkCount)
            }
            sendEvent("onError", event)
        }
    }

    // -----------------------------------------------------------------------
    // Silence-based splitting for demo WAV
    // -----------------------------------------------------------------------

    private fun findSilenceSplitInRange(audio: FloatArray, searchStart: Int, searchEnd: Int, frameSize: Int): Int {
        if (searchEnd - searchStart < frameSize) return searchEnd

        var bestEnergy = Float.MAX_VALUE
        var bestIdx = searchEnd

        var pos = searchStart
        while (pos + frameSize <= searchEnd) {
            var energy = 0f
            for (i in pos until pos + frameSize) {
                energy += audio[i] * audio[i]
            }
            energy /= frameSize

            if (energy < bestEnergy) {
                bestEnergy = energy
                bestIdx = pos + frameSize / 2
            }
            pos += frameSize / 2
        }

        // Only split early at actual silence (RMS < ~-60dB)
        return if (bestEnergy < 0.001f) bestIdx else searchEnd
    }

    // -----------------------------------------------------------------------
    // Overlap deduplication
    // -----------------------------------------------------------------------

    /**
     * Remove overlapping prefix from newText by finding the longest suffix
     * of previousWords that matches a prefix of newText's words.
     * Handles [alt1|alt2] annotated tokens by stripping brackets for comparison.
     */
    private fun deduplicateOverlap(newText: String, previousWords: List<String>): String {
        if (previousWords.isEmpty() || newText.isBlank()) return newText

        val newWords = newText.split(Regex("\\s+"))
        if (newWords.isEmpty()) return newText

        // Strip brackets for comparison: "[foo|bar]" → "foo"
        fun normalize(w: String): String {
            val s = w.lowercase().replace(Regex("[.,!?;:-]+$"), "")
            return if (s.startsWith("[")) s.substringAfter("[").substringBefore("|").substringBefore("]") else s
        }

        val prevNorm = previousWords.map { normalize(it) }
        val newNorm = newWords.map { normalize(it) }

        // Find longest match: try matching last N words of prev with first N words of new
        var bestMatch = 0
        for (matchLen in minOf(prevNorm.size, newNorm.size) downTo 1) {
            val prevTail = prevNorm.takeLast(matchLen)
            val newHead = newNorm.take(matchLen)
            if (prevTail == newHead) {
                bestMatch = matchLen
                break
            }
        }

        return if (bestMatch > 0) {
            newWords.drop(bestMatch).joinToString(" ")
        } else {
            newText
        }
    }

    // -----------------------------------------------------------------------
    // Utilities
    // -----------------------------------------------------------------------

    private suspend fun copyAssetToCache(assetName: String): File {
        return withContext(Dispatchers.IO) {
            val outFile = File(reactApplicationContext.cacheDir, assetName)
            // Use a version marker to detect when assets change across APK updates
            val versionFile = File(reactApplicationContext.cacheDir, "$assetName.v")
            val pkgInfo = reactApplicationContext.packageManager.getPackageInfo(
                reactApplicationContext.packageName, 0
            )
            val currentVersion = pkgInfo.lastUpdateTime.toString()
            val cachedVersion = if (versionFile.exists()) versionFile.readText() else ""

            if (!outFile.exists() || cachedVersion != currentVersion) {
                reactApplicationContext.assets.open(assetName).use { input ->
                    outFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
                versionFile.writeText(currentVersion)
            }
            outFile
        }
    }

    private fun sendEvent(eventName: String, params: Any?) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    override fun invalidate() {
        super.invalidate()
        scope.launch {
            wavWriterJob?.cancel()
            wavWriter?.abort()
            recorder?.stop()
        }
        pipeline?.close()
        scope.cancel()
    }
}
