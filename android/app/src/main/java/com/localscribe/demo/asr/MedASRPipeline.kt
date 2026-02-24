package com.localscribe.demo.asr

import ai.onnxruntime.*
import java.nio.FloatBuffer

/**
 * MedASR Split Pipeline for Android
 * 
 * Uses two ONNX models:
 * 1. Mel Extractor: audio → mel spectrogram features
 * 2. ASR Encoder: mel features → token IDs
 */
class MedASRPipeline(
    melModelPath: String,
    asrModelPath: String
) : AutoCloseable {
    
    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val melSession: OrtSession
    private val asrSession: OrtSession
    
    private val melInputName: String
    private val melOutputName: String
    private val asrMelInputName: String
    private val asrMaskInputName: String
    private val asrOutputName: String
    
    init {
        melSession = createSession(melModelPath, "MelExtractor(fp32)")
        melInputName = melSession.inputNames.first()
        melOutputName = melSession.outputNames.first()
        
        asrSession = createSession(asrModelPath, "ASREncoder(int8)")
        asrMelInputName = asrSession.inputNames.find { it.contains("mel") || it.contains("feature") }
            ?: asrSession.inputNames.first()
        asrMaskInputName = asrSession.inputNames.find { it.contains("mask") || it.contains("attention") }
            ?: asrSession.inputNames.last()
        asrOutputName = asrSession.outputNames.first()
    }
    
    private fun createSession(modelPath: String, modelName: String): OrtSession {
        val opts = OrtSession.SessionOptions().apply {
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        }
        val session = env.createSession(modelPath, opts)
        android.util.Log.i("MedASR", "$modelName: CPU execution provider")
        return session
    }
    
    fun extractMelFeatures(audio: FloatArray): Array<Array<FloatArray>> {
        val inputShape = longArrayOf(1, audio.size.toLong())
        val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(audio), inputShape)
        
        val inputs = mapOf(melInputName to inputTensor)
        val results = melSession.run(inputs)
        
        @Suppress("UNCHECKED_CAST")
        val melFeatures = results[0].value as Array<Array<FloatArray>>
        
        inputTensor.close()
        results.close()
        
        return melFeatures
    }
    
    /**
     * Full transcription pipeline: audio → logits [frames, vocab_size]
     */
    fun transcribe(audio: FloatArray): Array<FloatArray> {
        val melFeatures = extractMelFeatures(audio)
        val numFrames = melFeatures[0].size
        val attentionMask = arrayOf(BooleanArray(numFrames) { true })
        return runAsrEncoder(melFeatures, attentionMask)
    }

    fun runAsrEncoder(
        melFeatures: Array<Array<FloatArray>>,
        attentionMask: Array<BooleanArray>
    ): Array<FloatArray> {
        val batchSize = melFeatures.size
        val numFrames = melFeatures[0].size
        val numMels = melFeatures[0][0].size

        val flatMel = FloatArray(batchSize * numFrames * numMels)
        var idx = 0
        for (batch in melFeatures) {
            for (frame in batch) {
                for (mel in frame) {
                    flatMel[idx++] = mel
                }
            }
        }

        val melShape = longArrayOf(batchSize.toLong(), numFrames.toLong(), numMels.toLong())
        val melTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(flatMel), melShape)
        val maskTensor = OnnxTensor.createTensor(env, attentionMask)

        val inputs = mapOf(
            asrMelInputName to melTensor,
            asrMaskInputName to maskTensor
        )
        val results = asrSession.run(inputs)

        val tensor = results[0]
        val output = tensor.value

        melTensor.close()
        maskTensor.close()
        results.close()

        @Suppress("UNCHECKED_CAST")
        return when (output) {
            is Array<*> -> {
                val batch = output
                if (batch.isNotEmpty() && batch[0] is Array<*>) {
                    (batch as Array<Array<FloatArray>>)[0]
                } else {
                    output as Array<FloatArray>
                }
            }
            else -> {
                android.util.Log.e("MedASR", "Unexpected output type: ${output?.javaClass?.name}")
                throw IllegalStateException("Unexpected output type: ${output?.javaClass}")
            }
        }
    }
    
    override fun close() {
        melSession.close()
        asrSession.close()
        env.close()
    }
}
