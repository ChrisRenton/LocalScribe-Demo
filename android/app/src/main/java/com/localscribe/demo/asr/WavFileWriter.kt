package com.localscribe.demo.asr

import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Streaming WAV file writer.
 *
 * Writes a standard 16-bit PCM WAV header up-front with placeholder sizes,
 * then appends PCM-16 samples as they arrive. Call [finish] to patch the
 * header with the correct byte counts.
 *
 * Format: 16 kHz, mono, 16-bit signed little-endian PCM.
 */
class WavFileWriter(
    private val file: File,
    private val sampleRate: Int = 16000,
    private val channels: Int = 1,
    private val bitsPerSample: Int = 16,
) {
    private var fos: FileOutputStream? = null
    var totalSamplesWritten: Long = 0L
        private set

    /**
     * Open the file and write the WAV header (sizes set to placeholder 0).
     */
    fun start() {
        fos = FileOutputStream(file)
        writeHeader(fos!!, dataSize = 0)
        totalSamplesWritten = 0
    }

    /**
     * Convert float samples [-1.0, 1.0] to 16-bit PCM and append to file.
     */
    fun writeSamples(samples: FloatArray) {
        val os = fos ?: return
        val buf = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (s in samples) {
            val pcm = (s * 32767f).toInt().coerceIn(-32768, 32767).toShort()
            buf.putShort(pcm)
        }
        os.write(buf.array())
        totalSamplesWritten += samples.size
    }

    /**
     * Finalise the WAV: flush, patch header sizes, close.
     */
    fun finish() {
        fos?.flush()
        fos?.close()
        fos = null

        val dataBytes = totalSamplesWritten * (bitsPerSample / 8) * channels
        val raf = RandomAccessFile(file, "rw")
        try {
            raf.seek(4)
            raf.writeIntLE((dataBytes + 36).toInt())

            raf.seek(40)
            raf.writeIntLE(dataBytes.toInt())
        } finally {
            raf.close()
        }
    }

    /**
     * Abort writing and close without finalising header (partial file).
     */
    fun abort() {
        try { fos?.close() } catch (_: Exception) {}
        fos = null
    }

    // -----------------------------------------------------------------------

    private fun writeHeader(os: FileOutputStream, dataSize: Int) {
        val byteRate = sampleRate * channels * (bitsPerSample / 8)
        val blockAlign = channels * (bitsPerSample / 8)

        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray())
        header.putInt(dataSize + 36) // placeholder
        header.put("WAVE".toByteArray())
        header.put("fmt ".toByteArray())
        header.putInt(16) // sub-chunk size
        header.putShort(1) // PCM format
        header.putShort(channels.toShort())
        header.putInt(sampleRate)
        header.putInt(byteRate)
        header.putShort(blockAlign.toShort())
        header.putShort(bitsPerSample.toShort())
        header.put("data".toByteArray())
        header.putInt(dataSize) // placeholder
        os.write(header.array())
    }

    private fun RandomAccessFile.writeIntLE(value: Int) {
        val buf = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN)
        buf.putInt(value)
        write(buf.array())
    }
}
