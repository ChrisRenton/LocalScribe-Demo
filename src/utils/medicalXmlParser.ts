/**
 * medicalXmlParser.ts
 *
 * Type definitions for medical annotation XML segments.
 *
 * Known tags:
 *   <symptom name='...' confirmed='confirmed|denied|mentioned'>text</symptom>
 *   <med generic_name='...' confirmed='confirmed|denied'>text</med>
 *   <corr original_text='...'>corrected text</corr>
 *   <audio_reference starttime='MM:SS' endtime='MM:SS'>...nested content...</audio_reference>
 *   <beam pos='N'>correct_word</beam>
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SegmentType = 'text' | 'symptom' | 'med' | 'correction' | 'audio_reference';

export interface TextSegment {
  type: 'text';
  text: string;
}

export type ConfirmationStatus = 'confirmed' | 'denied' | 'mentioned';

export interface SymptomSegment {
  type: 'symptom';
  text: string;
  name?: string;
  confirmed?: ConfirmationStatus;
}

export interface MedSegment {
  type: 'med';
  text: string;
  genericName?: string;
  confirmed?: 'confirmed' | 'denied';
}

export interface CorrectionSegment {
  type: 'correction';
  text: string; // the corrected text (what to display)
  originalText?: string; // what was originally said (misspelled)
}

export interface AudioReferenceSegment {
  type: 'audio_reference';
  text: string; // flattened inner text
  startTime: string; // 'MM:SS'
  endTime: string; // 'MM:SS'
  /** Preserved child segments (may contain symptom, med, etc.) */
  children: AnnotatedSegment[];
}

export type AnnotatedSegment =
  | TextSegment
  | SymptomSegment
  | MedSegment
  | CorrectionSegment
  | AudioReferenceSegment;

export interface ParseResult {
  segments: AnnotatedSegment[];
  plainText: string;
  symptoms: SymptomInfo[];
  medications: MedicationInfo[];
  corrections: CorrectionInfo[];
  hasAudioReferences: boolean;
}

export interface SymptomInfo {
  name: string;
  confirmed: ConfirmationStatus;
  text: string;
}

export interface MedicationInfo {
  genericName: string;
  text: string;
  confirmed?: 'confirmed' | 'denied';
}

export interface CorrectionInfo {
  original: string;
  corrected: string;
}
