/**
 * TranscriptProcessor - LLM-based transcript annotation using LoRA-adapted MedGemma
 *
 * Reviews ASR output every N chunks and extracts:
 * 1. Symptoms/conditions (confirmed/denied/mentioned)
 * 2. Medications (with generic drug names, confirmed/denied)
 * 3. Beam search resolutions
 *
 * The v3 annotation LoRA outputs self-closing XML tags with beam resolution.
 */

import {
  AnnotatedSegment,
  SymptomInfo,
  MedicationInfo,
  CorrectionInfo,
} from '../utils/medicalXmlParser';
import {parseAnnotationXml} from '../utils/xmlAnnotationParser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimestampedChunk {
  text: string;
  startTimeSec: number;
  endTimeSec: number;
  chunkNumber: number;
}

export interface ProcessedChunk {
  originalText: string;
  /** The raw LLM JSON output */
  rawProcessedText: string;
  /** @deprecated Kept for interface compat; empty for JSON output */
  annotatedXml: string;
  /** Parsed segments for coloured rendering */
  segments: AnnotatedSegment[];
  /** Plain text with corrections applied */
  plainText: string;
  /** Extracted corrections */
  corrections: CorrectionInfo[];
  /** Extracted symptoms */
  symptoms: SymptomInfo[];
  /** Extracted medications */
  medications: MedicationInfo[];
  /** Time range of this batch */
  batchStartTimeSec: number;
  batchEndTimeSec: number;
  /** Which ASR chunk numbers contributed to this batch */
  chunkNumbers: number[];
}

export interface TranscriptProcessorConfig {
  /** Min chunks before triggering review (used only for first batch; default 1) */
  minChunksFirst?: number;
  /** Min chunks for subsequent batches (default 3, but overridden by maxInputChars) */
  minChunksLater?: number;
  /** Max input characters per batch (~4 chars per token; default ~1500 chars ≈ 375 tokens) */
  maxInputChars?: number;
  /** Model context size in tokens (default 2048) */
  contextTokens?: number;
  /** Called when a complete batch is done */
  onProcessed?: (result: ProcessedChunk) => void;
  /** Called during streaming when completed tags are detected (partial results) */
  onPartialSegments?: (segments: AnnotatedSegment[], batchIndex: number) => void;
  /** Called when a batch starts processing with its combined text */
  onProcessingStart?: (text: string) => void;
}

// ---------------------------------------------------------------------------
// System prompt - JSON annotation format
// ---------------------------------------------------------------------------

const ANNOTATION_SYSTEM_PROMPT = `Annotate medical terms in the transcript. Output ONLY self-closing XML tags.

When the transcript contains <beam pos="N">candidate1|candidate2|...</beam> tags, also output the correct candidate for each beam position.

OUTPUT FORMAT:
<beam pos="N">correct_word</beam>     ← for each beam position (if any)
<symptom text="exact_input" term="medical_term" confirmed="confirmed|denied|mentioned"/>
<med text="exact_input" generic="generic_name" confirmed="confirmed|denied"/>

RULES:
- <beam>: output the correct word from the beam candidates
- <symptom>: text is EXACT words from transcript (preserve ASR errors), term is standard medical name
  - confirmed="confirmed" if patient has it / doctor references it as existing condition
  - confirmed="denied" if patient explicitly says they do NOT have it
  - confirmed="mentioned" if asked about but not clearly confirmed or denied
- <med>: text is exact input words, generic is the generic/class drug name
  - confirmed="confirmed" if patient is taking it
  - confirmed="denied" if patient explicitly says they are NOT taking it
- Omit tag types with no entries
- No medical terms found: <none/>
- Output XML tags only, no wrapper element, no explanation, no thinking`;

// ---------------------------------------------------------------------------
// TranscriptProcessor
// ---------------------------------------------------------------------------

export class TranscriptProcessor {
  private pendingChunks: TimestampedChunk[] = [];
  private config: Required<Omit<TranscriptProcessorConfig, 'onProcessed' | 'onPartialSegments' | 'onProcessingStart'>> & Pick<TranscriptProcessorConfig, 'onProcessed' | 'onPartialSegments' | 'onProcessingStart'>;
  private completeFn:
    | ((prompt: string, options: any) => Promise<any>)
    | null = null;
  private isProcessing = false;
  private batchCount = 0;

  /**
   * Smart chunking defaults:
   *   - First batch: send 1 chunk immediately (warms prompt cache)
   *   - Later batches: take ALL pending chunks up to context limit
   *   - maxInputChars: ~1500 chars ≈ 375 tokens (leaves room for system prompt + output)
   */
  constructor(config: TranscriptProcessorConfig = {}) {
    // System prompt is ~700 chars ≈ 175 tokens. Template overhead ~20 tokens.
    // The 4B model at Q4_K_M works best with shorter inputs (~50-70 words).
    // Cap at 400 chars to keep quality high; this means more batches but each is better.
    const contextTokens = config.contextTokens ?? 2048;
    const maxInputChars = config.maxInputChars ?? 400; // ~60-70 words, sweet spot for 4B model

    this.config = {
      minChunksFirst: config.minChunksFirst ?? 1,
      minChunksLater: config.minChunksLater ?? 2,
      maxInputChars,
      contextTokens,
      onProcessed: config.onProcessed,
      onPartialSegments: config.onPartialSegments,
      onProcessingStart: config.onProcessingStart,
    };

    console.log(`[TranscriptProcessor] Init: first=${this.config.minChunksFirst}, later=${this.config.minChunksLater}, maxChars=${this.config.maxInputChars}, streaming=${!!this.config.onPartialSegments}`);
  }

  /** Set the LLM completion function */
  setCompleteFn(fn: (prompt: string, options: any) => Promise<any>) {
    this.completeFn = fn;
  }

  /**
   * Add a new ASR chunk for review, with timestamps.
   * Returns true if review was triggered.
   *
   * Strategy:
   * - First batch: triggers after minChunksFirst (default 1) to warm prompt cache fast
   * - Later: triggers after minChunksLater (default 2), but processChunks will
   *   greedily take ALL pending chunks up to maxInputChars
   */
  async addChunk(
    chunkText: string,
    startTimeSec: number = 0,
    endTimeSec: number = 0,
    chunkNumber: number = 0,
  ): Promise<boolean> {
    this.pendingChunks.push({
      text: chunkText,
      startTimeSec,
      endTimeSec,
      chunkNumber,
    });

    const threshold = this.batchCount === 0
      ? this.config.minChunksFirst
      : this.config.minChunksLater;

    console.log(`[TranscriptProcessor] addChunk #${chunkNumber}: pending=${this.pendingChunks.length}/${threshold}, batch#=${this.batchCount}, isProcessing=${this.isProcessing}`);

    if (
      this.pendingChunks.length >= threshold &&
      !this.isProcessing
    ) {
      console.log('[TranscriptProcessor] Triggering processChunks...');
      await this.processChunks();
      return true;
    }
    return false;
  }

  /** Force processing of any remaining chunks */
  async flush(): Promise<void> {
    if (this.pendingChunks.length > 0 && !this.isProcessing) {
      await this.processChunks();
    }
  }

  /**
   * Process accumulated chunks through LLM.
   *
   * Greedily takes as many pending chunks as will fit within maxInputChars,
   * then processes them as a single batch. Repeats until no chunks remain.
   */
  private async processChunks(): Promise<void> {
    console.log(`[TranscriptProcessor] processChunks: completeFn=${!!this.completeFn}, pending=${this.pendingChunks.length}`);
    if (!this.completeFn || this.pendingChunks.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.pendingChunks.length > 0) {
      // Greedily take chunks up to maxInputChars
      let charCount = 0;
      let takeCount = 0;
      for (let i = 0; i < this.pendingChunks.length; i++) {
        const chunkChars = this.pendingChunks[i].text.length + 1; // +1 for space separator
        if (charCount + chunkChars > this.config.maxInputChars && takeCount > 0) {
          break; // Would exceed limit and we already have at least 1 chunk
        }
        charCount += chunkChars;
        takeCount++;
      }

      const chunksToProcess = this.pendingChunks.splice(0, takeCount);
      this.batchCount++;
      console.log(`[TranscriptProcessor] Batch #${this.batchCount}: ${chunksToProcess.length} chunks (${charCount} chars), ${this.pendingChunks.length} remaining`);
      await this.processBatch(chunksToProcess);
    }

    this.isProcessing = false;
  }

  /** Process a single batch of chunks through LLM */
  private async processBatch(chunksToProcess: TimestampedChunk[]): Promise<void> {
    if (!this.completeFn || chunksToProcess.length === 0) return;

    const batchStartTime = chunksToProcess[0].startTimeSec;
    const batchEndTime =
      chunksToProcess[chunksToProcess.length - 1].endTimeSec;

    const combinedText = chunksToProcess.map(c => c.text).join(' ');
    this.config.onProcessingStart?.(combinedText);

    console.log(`[TranscriptProcessor] LLM input (${combinedText.length} chars): ${combinedText.substring(0, 120)}`);

    try {
      let processedText = '';
      let lastEmittedLen = 0;

      await this.completeFn(combinedText, {
        systemPrompt: ANNOTATION_SYSTEM_PROMPT,
        maxTokens: 256,
        enableThinking: false,
        responsePrefix: '<',
        temperature: 0.2,
        topP: 0.9,
        penaltyRepeat: 1.1,
        onToken: (_: string, parsed: {response: string}) => {
          processedText = parsed.response || '';
          // Emit partial results when a complete tag is detected
          if (
            this.config.onPartialSegments &&
            processedText.length > lastEmittedLen &&
            (processedText.endsWith('/>') || processedText.endsWith('</beam>'))
          ) {
            lastEmittedLen = processedText.length;
            const partial = parseAnnotationXml(processedText, combinedText);
            this.config.onPartialSegments(partial.segments, this.batchCount);
          }
        },
      });

      console.log(`[TranscriptProcessor] LLM raw output (${processedText.length} chars): ${processedText.substring(0, 300)}`);

      // Final parse of complete output
      const parseResult = parseAnnotationXml(processedText, combinedText);

      const result: ProcessedChunk = {
        originalText: parseResult.plainText,
        rawProcessedText: processedText,
        annotatedXml: '',
        segments: parseResult.segments,
        plainText: parseResult.plainText,
        corrections: parseResult.corrections,
        symptoms: parseResult.symptoms,
        medications: parseResult.medications,
        batchStartTimeSec: batchStartTime,
        batchEndTimeSec: batchEndTime,
        chunkNumbers: chunksToProcess.map(c => c.chunkNumber),
      };

      this.config.onPartialSegments?.(parseResult.segments, this.batchCount);
      this.config.onProcessed?.(result);
    } catch (error) {
      console.error('TranscriptProcessor batch error:', error);
      this.config.onProcessed?.({
        originalText: combinedText,
        rawProcessedText: combinedText,
        annotatedXml: '',
        segments: [{type: 'text', text: combinedText}],
        plainText: combinedText,
        corrections: [],
        symptoms: [],
        medications: [],
        batchStartTimeSec: batchStartTime,
        batchEndTimeSec: batchEndTime,
        chunkNumbers: chunksToProcess.map(c => c.chunkNumber),
      });
    }
  }

  /** Clear pending chunks */
  clear(): void {
    this.pendingChunks = [];
    this.isProcessing = false;
  }

  /** Get count of pending chunks */
  getPendingCount(): number {
    return this.pendingChunks.length;
  }
}

export default TranscriptProcessor;
