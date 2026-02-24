package com.localscribe.demo.asr

import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlin.math.exp
import kotlin.math.ln

data class BeamHypothesis(val text: String, val score: Float)

/**
 * CTC Decoder with greedy and beam search support.
 */
class CtcDecoder(
    private val vocabulary: Map<Int, String>,
    private val blankId: Int = 0
) {

    /** Greedy decode from token IDs (for backward compatibility) */
    fun decodeTokens(tokenIds: LongArray): String {
        return decodeTokens(tokenIds.map { it.toInt() }.toIntArray())
    }

    fun decodeTokens(tokenIds: IntArray): String {
        val decoded = mutableListOf<Int>()
        var prev = -1
        for (tokenId in tokenIds) {
            if (tokenId != blankId && tokenId != prev) {
                decoded.add(tokenId)
            }
            prev = tokenId
        }
        return decoded.mapNotNull { vocabulary[it] }.joinToString("")
    }

    /** Greedy decode from logits: argmax per frame then CTC collapse */
    fun greedyDecode(logits: Array<FloatArray>): String {
        val tokenIds = IntArray(logits.size) { frame ->
            var maxIdx = 0
            var maxVal = logits[frame][0]
            for (j in 1 until logits[frame].size) {
                if (logits[frame][j] > maxVal) {
                    maxVal = logits[frame][j]
                    maxIdx = j
                }
            }
            maxIdx
        }
        return decodeTokens(tokenIds)
    }

    /**
     * CTC prefix beam search.
     * Returns top-k hypotheses with log-probability scores.
     */
    fun beamSearch(logits: Array<FloatArray>, beamWidth: Int = 10, topK: Int = 3): List<BeamHypothesis> {
        val numFrames = logits.size
        if (numFrames == 0) return listOf(BeamHypothesis("", 0f))

        val vocabSize = logits[0].size

        var beams = mutableMapOf<List<Int>, FloatArray>()
        beams[emptyList()] = floatArrayOf(0f, Float.NEGATIVE_INFINITY)

        for (t in 0 until numFrames) {
            val logProbs = logSoftmax(logits[t])
            val nextBeams = mutableMapOf<List<Int>, FloatArray>()

            for ((prefix, probs) in beams) {
                val pBlank = probs[0]
                val pNonBlank = probs[1]
                val pTotal = logAdd(pBlank, pNonBlank)

                val key = prefix
                val existing = nextBeams.getOrPut(key) { floatArrayOf(Float.NEGATIVE_INFINITY, Float.NEGATIVE_INFINITY) }
                existing[0] = logAdd(existing[0], pTotal + logProbs[blankId])

                for (c in 0 until vocabSize) {
                    if (c == blankId) continue
                    val pChar = logProbs[c]
                    val newPrefix = if (prefix.isNotEmpty() && prefix.last() == c) {
                        val ext = nextBeams.getOrPut(prefix) { floatArrayOf(Float.NEGATIVE_INFINITY, Float.NEGATIVE_INFINITY) }
                        ext[1] = logAdd(ext[1], pBlank + pChar)
                        continue
                    } else {
                        prefix + c
                    }
                    val ext = nextBeams.getOrPut(newPrefix) { floatArrayOf(Float.NEGATIVE_INFINITY, Float.NEGATIVE_INFINITY) }
                    ext[1] = logAdd(ext[1], pTotal + pChar)
                }
            }

            beams = nextBeams.entries
                .sortedByDescending { logAdd(it.value[0], it.value[1]) }
                .take(beamWidth)
                .associate { it.key to it.value }
                .toMutableMap()
        }

        return beams.entries
            .map { (prefix, probs) ->
                val text = prefix.mapNotNull { vocabulary[it] }.joinToString("")
                val score = logAdd(probs[0], probs[1])
                BeamHypothesis(text, score)
            }
            .sortedByDescending { it.score }
            .take(topK)
    }

    private fun logSoftmax(logits: FloatArray): FloatArray {
        val maxVal = logits.max()
        val shifted = FloatArray(logits.size) { logits[it] - maxVal }
        val logSumExp = ln(shifted.sumOf { exp(it.toDouble()) }.toFloat())
        return FloatArray(logits.size) { shifted[it] - logSumExp }
    }

    private fun logAdd(a: Float, b: Float): Float {
        if (a == Float.NEGATIVE_INFINITY) return b
        if (b == Float.NEGATIVE_INFINITY) return a
        return if (a > b) {
            a + ln(1f + exp(b - a))
        } else {
            b + ln(1f + exp(a - b))
        }
    }
    
    /**
     * Compare beam hypotheses and annotate genuine disagreements
     * with <beam pos="N">opt1|opt2|...</beam> XML format.
     * Uses word-level alignment to handle insertions/deletions.
     */
    fun annotateWithAlternatives(hypotheses: List<BeamHypothesis>): String {
        if (hypotheses.size < 2) return hypotheses.firstOrNull()?.text?.trim() ?: ""

        val baseWords = hypotheses[0].text.trim().split(Regex("\\s+"))
        if (baseWords.isEmpty()) return ""

        val altsPerPosition = Array(baseWords.size) { mutableSetOf<String>() }

        for (alt in hypotheses.drop(1)) {
            val altWords = alt.text.trim().split(Regex("\\s+"))
            val aligned = alignWords(baseWords, altWords)
            for ((baseIdx, altWord) in aligned) {
                if (altWord != null && altWord != baseWords[baseIdx]) {
                    altsPerPosition[baseIdx].add(altWord)
                }
            }
        }

        val result = StringBuilder()
        var beamPos = 0
        for (i in baseWords.indices) {
            if (result.isNotEmpty()) result.append(' ')
            val alts = altsPerPosition[i]
            if (alts.isEmpty()) {
                result.append(baseWords[i])
            } else {
                result.append("<beam pos=\"$beamPos\">")
                result.append(baseWords[i])
                for (a in alts) result.append('|').append(a)
                result.append("</beam>")
                beamPos++
            }
        }
        return result.toString()
    }

    /**
     * Align altWords to baseWords using longest common subsequence.
     * Returns list of (baseIndex, altWord?) pairs for positions where
     * the alt hypothesis has a different word than the base.
     */
    private fun alignWords(
        base: List<String>,
        alt: List<String>
    ): List<Pair<Int, String?>> {
        val n = base.size
        val m = alt.size

        if (n == m) {
            return base.indices.map { i -> i to alt[i] }
        }

        val dp = Array(n + 1) { IntArray(m + 1) }
        for (i in 1..n) {
            for (j in 1..m) {
                dp[i][j] = if (base[i - 1].lowercase() == alt[j - 1].lowercase()) {
                    dp[i - 1][j - 1] + 1
                } else {
                    maxOf(dp[i - 1][j], dp[i][j - 1])
                }
            }
        }

        val result = mutableListOf<Pair<Int, String?>>()
        var i = n; var j = m
        val aligned = mutableMapOf<Int, String>()

        while (i > 0 && j > 0) {
            when {
                base[i - 1].lowercase() == alt[j - 1].lowercase() -> {
                    aligned[i - 1] = alt[j - 1]
                    i--; j--
                }
                dp[i - 1][j] >= dp[i][j - 1] -> i--
                else -> j--
            }
        }

        for (idx in base.indices) {
            val altWord = aligned[idx]
            result.add(idx to altWord)
        }

        return result
    }

    companion object {
        fun loadVocabulary(tokenizerJson: String): Map<Int, String> {
            val vocab = mutableMapOf<Int, String>()
            
            val gson = Gson()
            val json = gson.fromJson(tokenizerJson, JsonObject::class.java)
            
            val modelVocab = json.getAsJsonObject("model")?.getAsJsonArray("vocab")
            modelVocab?.forEachIndexed { index, element ->
                val pair = element.asJsonArray
                val token = pair[0].asString
                vocab[index] = decodeToken(token)
            }
            
            val addedTokens = json.getAsJsonArray("added_tokens")
            addedTokens?.forEach { element ->
                val obj = element.asJsonObject
                val id = obj.get("id").asInt
                val content = obj.get("content").asString
                vocab[id] = decodeToken(content)
            }
            
            return vocab
        }
        
        private fun decodeToken(token: String): String {
            return when {
                token.startsWith("<") && token.endsWith(">") -> ""
                token == "▁" -> " "
                token.startsWith("▁") -> " " + token.drop(1)
                else -> token
            }
        }
    }
}
