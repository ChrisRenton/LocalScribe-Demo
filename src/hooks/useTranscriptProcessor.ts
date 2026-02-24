import {useState, useCallback, useRef, useEffect} from 'react';
import {
  TranscriptProcessor,
  ProcessedChunk,
} from '../services/TranscriptProcessor';
import {
  AnnotatedSegment,
  SymptomInfo,
  MedicationInfo,
  CorrectionInfo,
} from '../utils/medicalXmlParser';

export interface UseTranscriptProcessorResult {
  /** Segments for coloured rendering (may include audio_reference with children) */
  segments: AnnotatedSegment[];
  /** Plain text (tags stripped, corrections applied) */
  plainText: string;
  /** All extracted symptoms */
  symptoms: SymptomInfo[];
  /** All extracted medications */
  medications: MedicationInfo[];
  /** All corrections found */
  corrections: CorrectionInfo[];
  /** All processed batches with timestamp data (for storage) */
  processedBatches: ProcessedChunk[];
  /** Processing status */
  isProcessing: boolean;
  /** Text currently being processed by the LLM (empty when idle) */
  processingText: string;
  /** Add a timestamped chunk to be processed */
  addChunk: (
    text: string,
    startTimeSec?: number,
    endTimeSec?: number,
    chunkNumber?: number,
  ) => Promise<void>;
  /** Force process remaining chunks */
  flush: () => Promise<void>;
  /** Clear all state */
  clear: () => void;
}

interface UseTranscriptProcessorOptions {
  /** @deprecated Use minChunksFirst/minChunksLater instead */
  chunksPerReview?: number;
  minChunksFirst?: number;
  minChunksLater?: number;
  maxInputChars?: number;
  contextTokens?: number;
  completeFn: ((prompt: string, options: any) => Promise<any>) | null;
}

export function useTranscriptProcessor(
  options: UseTranscriptProcessorOptions,
): UseTranscriptProcessorResult {
  const {completeFn} = options;

  const [segments, setSegments] = useState<AnnotatedSegment[]>([]);
  const [plainText, setPlainText] = useState('');
  const [corrections, setCorrections] = useState<CorrectionInfo[]>([]);
  const [symptoms, setSymptoms] = useState<SymptomInfo[]>([]);
  const [medications, setMedications] = useState<MedicationInfo[]>([]);
  const [processedBatches, setProcessedBatches] = useState<ProcessedChunk[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingText, setProcessingText] = useState('');

  const processorRef = useRef<TranscriptProcessor | null>(null);
  const processedChunksRef = useRef<ProcessedChunk[]>([]);

  // Track the current streaming batch index for partial updates
  const streamingBatchIdxRef = useRef<number>(-1);
  const streamingSegmentsRef = useRef<AnnotatedSegment[]>([]);

  // Initialize processor
  useEffect(() => {
    const processor = new TranscriptProcessor({
      minChunksFirst: options.minChunksFirst,
      minChunksLater: options.minChunksLater,
      maxInputChars: options.maxInputChars,
      contextTokens: options.contextTokens,

      onProcessingStart: (text: string) => {
        setProcessingText(text);
      },

      // Streaming: partial results as tags complete during LLM generation
      onPartialSegments: (partialSegs, batchIdx) => {
        streamingBatchIdxRef.current = batchIdx;
        streamingSegmentsRef.current = partialSegs;

        // Combine completed batches + current streaming batch
        const allSegments: AnnotatedSegment[] = [];
        for (let i = 0; i < processedChunksRef.current.length; i++) {
          if (i > 0) {
            allSegments.push({type: 'text', text: ' '});
          }
          allSegments.push(...processedChunksRef.current[i].segments);
        }
        // Append streaming partial segments
        if (partialSegs.length > 0) {
          if (allSegments.length > 0) {
            allSegments.push({type: 'text', text: ' '});
          }
          allSegments.push(...partialSegs);
        }
        setSegments(allSegments);
      },

      onProcessed: result => {
        // Clear streaming state since this batch is now finalized
        streamingBatchIdxRef.current = -1;
        streamingSegmentsRef.current = [];

        processedChunksRef.current.push(result);

        // Expose all batches for storage
        setProcessedBatches([...processedChunksRef.current]);

        // Combine all finalized segments
        const allSegments: AnnotatedSegment[] = [];
        for (let i = 0; i < processedChunksRef.current.length; i++) {
          if (i > 0) {
            allSegments.push({type: 'text', text: ' '});
          }
          allSegments.push(...processedChunksRef.current[i].segments);
        }
        setSegments(allSegments);

        // Combine plain text
        const allPlain = processedChunksRef.current
          .map(c => c.plainText)
          .join(' ');
        setPlainText(allPlain);

        // Aggregate corrections (dedupe)
        const allCorrections = processedChunksRef.current.flatMap(
          c => c.corrections,
        );
        const uniqueCorrections = allCorrections.filter(
          (c, i, arr) =>
            arr.findIndex(
              x =>
                x.original === c.original && x.corrected === c.corrected,
            ) === i,
        );
        setCorrections(uniqueCorrections);

        // Aggregate symptoms (dedupe by name)
        const allSymptoms = processedChunksRef.current.flatMap(
          c => c.symptoms,
        );
        const uniqueSymptoms = allSymptoms.filter(
          (s, i, arr) => arr.findIndex(x => x.name === s.name) === i,
        );
        setSymptoms(uniqueSymptoms);

        // Aggregate medications (dedupe by genericName)
        const allMeds = processedChunksRef.current.flatMap(
          c => c.medications,
        );
        const uniqueMeds = allMeds.filter(
          (m, i, arr) =>
            arr.findIndex(x => x.genericName === m.genericName) === i,
        );
        setMedications(uniqueMeds);

        setProcessingText('');
        setIsProcessing(false);
      },
    });

    processorRef.current = processor;

    return () => {
      processor.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.minChunksFirst, options.minChunksLater, options.maxInputChars, options.contextTokens]);

  // Update completeFn when it changes
  useEffect(() => {
    if (processorRef.current && completeFn) {
      processorRef.current.setCompleteFn(completeFn);
    }
  }, [completeFn]);

  const addChunk = useCallback(
    async (
      text: string,
      startTimeSec: number = 0,
      endTimeSec: number = 0,
      chunkNumber: number = 0,
    ) => {
      console.log(`[useTranscriptProcessor] addChunk: processor=${!!processorRef.current}, completeFn=${!!completeFn}, text="${text.slice(0, 40)}"`);
      if (!processorRef.current || !completeFn) {
        console.log('[useTranscriptProcessor] addChunk SKIPPED: missing processor or completeFn');
        return;
      }

      const willProcess = await processorRef.current.addChunk(
        text,
        startTimeSec,
        endTimeSec,
        chunkNumber,
      );
      if (willProcess) {
        setIsProcessing(true);
      }
    },
    [completeFn],
  );

  const flush = useCallback(async () => {
    if (!processorRef.current) return;
    setIsProcessing(true);
    await processorRef.current.flush();
  }, []);

  const clear = useCallback(() => {
    processorRef.current?.clear();
    processedChunksRef.current = [];
    setSegments([]);
    setPlainText('');
    setCorrections([]);
    setSymptoms([]);
    setMedications([]);
    setProcessedBatches([]);
    setProcessingText('');
    setIsProcessing(false);
  }, []);

  return {
    segments,
    plainText,
    corrections,
    symptoms,
    medications,
    processedBatches,
    isProcessing,
    processingText,
    addChunk,
    flush,
    clear,
  };
}

export default useTranscriptProcessor;
