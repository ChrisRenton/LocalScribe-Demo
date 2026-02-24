package com.localscribe.demo.asr

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AutomaticGainControl
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/**
 * AudioRecorder for live speech recognition.
 *
 * Records 16 kHz mono audio and emits:
 *   - [audioBuffers]: raw 100 ms float buffers (for WAV file writing)
 *   - [timestampedChunks]: 5-second chunks with precise start/end sample positions
 */
class AudioRecorder {

    companion object {
        const val SAMPLE_RATE = 16000
        const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_FLOAT

        // Buffer sizes
        const val BUFFER_SIZE_MS = 100
        val BUFFER_SIZE_SAMPLES = SAMPLE_RATE * BUFFER_SIZE_MS / 1000

        // Chunk size for ASR processing (5 seconds for responsive updates)
        const val CHUNK_SIZE_SECONDS = 5
        val CHUNK_SIZE_SAMPLES = SAMPLE_RATE * CHUNK_SIZE_SECONDS

        // Silence detection: search the last SEARCH_WINDOW for the quietest FRAME to split at
        val SEARCH_WINDOW_SAMPLES = SAMPLE_RATE  // search last 1 second
        val SILENCE_FRAME_SAMPLES = SAMPLE_RATE / 10  // 100ms energy window

        // Software gain multiplier for ambient mic sensitivity (1.0 = no boost)
        const val GAIN_BOOST = 2.5f

        private const val TAG = "AudioRecorder"
    }

    /** A chunk of audio with its precise position in the recording. */
    data class TimestampedChunk(
        val audio: FloatArray,
        val startSample: Long,
        val endSample: Long,
    ) {
        val startTimeSec: Double get() = startSample.toDouble() / SAMPLE_RATE
        val endTimeSec: Double get() = endSample.toDouble() / SAMPLE_RATE
    }

    private var audioRecord: AudioRecord? = null
    private var agc: AutomaticGainControl? = null
    private var recordingJob: Job? = null
    private var isRecording = false

    // Flow for raw 100 ms buffers (used by WAV writer)
    private val _audioBuffers = MutableSharedFlow<FloatArray>(extraBufferCapacity = 64)
    val audioBuffers: SharedFlow<FloatArray> = _audioBuffers

    // Accumulated audio for chunk processing
    private val audioChunk = mutableListOf<Float>()

    // Flow for 5-second chunks with timestamps (used by ASR)
    private val _timestampedChunks = MutableSharedFlow<TimestampedChunk>(extraBufferCapacity = 8)
    val timestampedChunks: SharedFlow<TimestampedChunk> = _timestampedChunks

    // Legacy flow kept for compatibility
    private val _audioChunks = MutableSharedFlow<FloatArray>(extraBufferCapacity = 8)
    val audioChunks: SharedFlow<FloatArray> = _audioChunks

    // Cumulative sample tracking
    var totalSamplesRecorded = 0L
        private set

    /** Number of samples emitted in completed chunks so far. */
    private var samplesEmittedSoFar: Long = 0L

    val recordingDurationSeconds: Float
        get() = totalSamplesRecorded / SAMPLE_RATE.toFloat()

    /**
     * Start recording audio. Returns true if started successfully.
     */
    @Suppress("MissingPermission")
    fun start(): Boolean {
        if (isRecording) return false

        try {
            val minBufferSize = AudioRecord.getMinBufferSize(
                SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT
            )

            val bufferSize = maxOf(minBufferSize * 4, BUFFER_SIZE_SAMPLES * 4 * 4)

            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                bufferSize
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                audioRecord?.release()
                audioRecord = null
                return false
            }

            // Attach hardware AGC to auto-boost quiet ambient audio
            try {
                val sessionId = audioRecord!!.audioSessionId
                if (AutomaticGainControl.isAvailable()) {
                    agc = AutomaticGainControl.create(sessionId)
                    agc?.enabled = true
                    Log.d(TAG, "AGC enabled on session $sessionId")
                } else {
                    Log.w(TAG, "AGC not available on this device")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to enable AGC: ${e.message}")
            }

            audioRecord?.startRecording()
            isRecording = true
            totalSamplesRecorded = 0
            samplesEmittedSoFar = 0
            audioChunk.clear()

            recordingJob = CoroutineScope(Dispatchers.IO).launch {
                val buffer = FloatArray(BUFFER_SIZE_SAMPLES)

                while (isActive && isRecording) {
                    val read = audioRecord?.read(
                        buffer, 0, buffer.size, AudioRecord.READ_BLOCKING
                    ) ?: 0

                    if (read > 0) {
                        // Apply software gain boost for ambient sensitivity
                        if (GAIN_BOOST != 1.0f) {
                            for (i in 0 until read) {
                                buffer[i] = (buffer[i] * GAIN_BOOST).coerceIn(-1.0f, 1.0f)
                            }
                        }

                        val samples = buffer.copyOf(read)
                        totalSamplesRecorded += read

                        _audioBuffers.emit(samples)
                        audioChunk.addAll(samples.toList())

                        if (audioChunk.size >= CHUNK_SIZE_SAMPLES) {
                            val allAudio = audioChunk.toFloatArray()
                            val splitIdx = findSilenceSplit(allAudio)
                            val chunk = allAudio.copyOfRange(0, splitIdx)
                            val chunkStartSample = samplesEmittedSoFar
                            samplesEmittedSoFar += chunk.size

                            audioChunk.clear()
                            if (splitIdx < allAudio.size) {
                                audioChunk.addAll(
                                    allAudio.drop(splitIdx)
                                )
                            }

                            _timestampedChunks.emit(
                                TimestampedChunk(
                                    audio = chunk,
                                    startSample = chunkStartSample,
                                    endSample = chunkStartSample + chunk.size,
                                )
                            )
                            _audioChunks.emit(chunk)
                        }
                    }
                }
            }

            return true
        } catch (e: Exception) {
            e.printStackTrace()
            return false
        }
    }

    /**
     * Stop recording and return any remaining audio with its timestamp,
     * or null if no leftover exists.
     */
    suspend fun stop(): TimestampedChunk? {
        if (!isRecording) return null

        isRecording = false
        recordingJob?.cancelAndJoin()
        recordingJob = null

        audioRecord?.stop()
        agc?.release()
        agc = null
        audioRecord?.release()
        audioRecord = null

        return if (audioChunk.isNotEmpty()) {
            val chunk = audioChunk.toFloatArray()
            val chunkStartSample = samplesEmittedSoFar
            samplesEmittedSoFar += chunk.size
            audioChunk.clear()
            TimestampedChunk(chunk, chunkStartSample, chunkStartSample + chunk.size)
        } else {
            null
        }
    }

    fun isRecording(): Boolean = isRecording
    fun getCurrentChunkSize(): Int = audioChunk.size
    fun getCurrentChunkDuration(): Float = audioChunk.size / SAMPLE_RATE.toFloat()

    /**
     * Find the best split point in the audio by locating the quietest
     * 100ms frame in the last 1 second. Only splits at silence if the
     * energy is below a threshold (actual pause in speech). Otherwise
     * returns the full audio length (no early split).
     */
    private fun findSilenceSplit(audio: FloatArray): Int {
        val searchStart = maxOf(0, audio.size - SEARCH_WINDOW_SAMPLES)
        val frameSize = SILENCE_FRAME_SAMPLES

        if (audio.size - searchStart < frameSize) return audio.size

        var bestEnergy = Float.MAX_VALUE
        var bestIdx = audio.size

        var pos = searchStart
        while (pos + frameSize <= audio.size) {
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

        // Only split early if the quietest spot is actually near-silence
        // RMS energy < 0.001 (~-60dB) indicates a real pause
        return if (bestEnergy < 0.001f) bestIdx else audio.size
    }
}
