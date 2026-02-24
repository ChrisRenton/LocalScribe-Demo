import {SymptomInfo, MedicationInfo} from '../utils/medicalXmlParser';

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string;
  dob: string;
  lastVisitDate?: string;
}

export interface SessionFinishData {
  sessionId: string;
  durationSec: number;
  encryptedAudioPath?: string;
  /** Formatted transcript with [MM:SS] markers at each batch boundary */
  timestampedTranscript: string;
  plainTranscript: string;
  templateId?: string;
  symptoms: SymptomInfo[];
  medications: MedicationInfo[];
}

export type Screen = 'loading' | 'patients' | 'recording' | 'patientDetail' | 'sessionDetail' | 'note' | 'noteView';
