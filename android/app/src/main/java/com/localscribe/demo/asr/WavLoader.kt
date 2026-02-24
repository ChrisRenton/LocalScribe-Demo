package com.localscribe.demo.asr

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Simple WAV file loader for Android
 */
object WavLoader {
    
    fun load(filePath: String): FloatArray {
        val file = File(filePath)
        RandomAccessFile(file, "r").use { raf ->
            val riff = ByteArray(4)
            raf.read(riff)
            require(String(riff) == "RIFF") { "Not a RIFF file" }
            
            raf.skipBytes(4)
            
            val wave = ByteArray(4)
            raf.read(wave)
            require(String(wave) == "WAVE") { "Not a WAVE file" }
            
            var audioFormat = 0
            var numChannels = 0
            var sampleRate = 0
            var bitsPerSample = 0
            
            while (raf.filePointer < raf.length()) {
                val chunkId = ByteArray(4)
                raf.read(chunkId)
                val chunkSize = readInt(raf)
                
                when (String(chunkId)) {
                    "fmt " -> {
                        audioFormat = readShort(raf)
                        numChannels = readShort(raf)
                        sampleRate = readInt(raf)
                        raf.skipBytes(4)
                        raf.skipBytes(2)
                        bitsPerSample = readShort(raf)
                        val remaining = chunkSize - 16
                        if (remaining > 0) raf.skipBytes(remaining)
                    }
                    "data" -> {
                        require(audioFormat == 1) { "Only PCM format supported" }
                        require(sampleRate == 16000) { "Expected 16kHz, got $sampleRate" }
                        
                        val bytesPerSample = bitsPerSample / 8
                        val numSamples = chunkSize / (bytesPerSample * numChannels)
                        
                        val samples = FloatArray(numSamples)
                        val buffer = ByteArray(bytesPerSample * numChannels)
                        
                        for (i in 0 until numSamples) {
                            raf.read(buffer)
                            val sample = when (bitsPerSample) {
                                16 -> {
                                    val bb = ByteBuffer.wrap(buffer).order(ByteOrder.LITTLE_ENDIAN)
                                    if (numChannels == 1) {
                                        bb.short.toFloat() / 32768f
                                    } else {
                                        val left = bb.short.toFloat()
                                        val right = bb.short.toFloat()
                                        (left + right) / 2f / 32768f
                                    }
                                }
                                else -> throw IllegalArgumentException("Unsupported bits: $bitsPerSample")
                            }
                            samples[i] = sample
                        }
                        
                        return samples
                    }
                    else -> {
                        raf.skipBytes(chunkSize)
                    }
                }
            }
            
            throw IllegalArgumentException("No data chunk found")
        }
    }
    
    private fun readInt(raf: RandomAccessFile): Int {
        val bytes = ByteArray(4)
        raf.read(bytes)
        return ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).int
    }
    
    private fun readShort(raf: RandomAccessFile): Int {
        val bytes = ByteArray(2)
        raf.read(bytes)
        return ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).short.toInt()
    }
}
