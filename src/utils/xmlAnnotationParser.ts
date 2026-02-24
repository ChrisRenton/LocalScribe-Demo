/**
 * xmlAnnotationParser.ts
 *
 * Parses the XML output from the v3 annotation LoRA model and maps extracted
 * medical terms back onto the original transcript text as AnnotatedSegments.
 *
 * Expected LLM output format (self-closing XML tags):
 *   <beam pos="N">correct_word</beam>
 *   <symptom text="exact_input" term="medical_term" confirmed="confirmed|denied|mentioned"/>
 *   <med text="exact_input" generic="generic_name" confirmed="confirmed|denied"/>
 *   <none/>
 *
 * The input text may contain <beam pos="N">opt1|opt2|...</beam> markers from
 * ASR beam search. The LLM resolves these, and we apply the resolutions before
 * matching annotations.
 */

import {
  AnnotatedSegment,
  SymptomInfo,
  MedicationInfo,
  CorrectionInfo,
  ParseResult,
  ConfirmationStatus,
} from './medicalXmlParser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Annotation {
  start: number;
  end: number;
  segment: AnnotatedSegment;
  symptom?: SymptomInfo;
  medication?: MedicationInfo;
  correction?: CorrectionInfo;
}

interface BeamResolution {
  pos: number;
  chosen: string;
}

interface SymptomTag {
  text: string;
  term: string;
  confirmed: ConfirmationStatus;
}

interface MedTag {
  text: string;
  generic: string;
  confirmed: 'confirmed' | 'denied';
}

// ---------------------------------------------------------------------------
// XML tag extraction
// ---------------------------------------------------------------------------

/**
 * Extract <beam pos="N">word</beam> resolutions from LLM output.
 */
function extractBeamResolutions(xml: string): BeamResolution[] {
  const results: BeamResolution[] = [];
  const re = /<beam\s+pos=["'](\d+)["']>([^<]*)<\/beam>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push({pos: parseInt(m[1], 10), chosen: m[2].trim()});
  }
  return results;
}

/**
 * Extract self-closing <symptom .../> tags.
 */
function extractSymptomTags(xml: string): SymptomTag[] {
  const results: SymptomTag[] = [];
  const re = /<symptom\s+([^>]*?)\/>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = parseAttributes(m[1]);
    const text = attrs.text;
    const term = attrs.term;
    if (!text || !term) continue;

    const confirmed = (['confirmed', 'denied', 'mentioned'].includes(attrs.confirmed)
      ? attrs.confirmed
      : 'mentioned') as ConfirmationStatus;

    results.push({text, term, confirmed});
  }
  return results;
}

/**
 * Extract self-closing <med .../> tags.
 */
function extractMedTags(xml: string): MedTag[] {
  const results: MedTag[] = [];
  const re = /<med\s+([^>]*?)\/>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = parseAttributes(m[1]);
    const text = attrs.text;
    const generic = attrs.generic;
    if (!text || !generic) continue;

    const confirmed = (attrs.confirmed === 'denied' ? 'denied' : 'confirmed') as 'confirmed' | 'denied';
    results.push({text, generic, confirmed});
  }
  return results;
}

/**
 * Parse HTML-style attributes from a string like: text="headache" term="headache" confirmed="confirmed"
 */
function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_][\w_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? '';
  }
  return attrs;
}

// ---------------------------------------------------------------------------
// Beam resolution: apply <beam> choices to input text
// ---------------------------------------------------------------------------

/**
 * Resolve <beam pos="N">opt1|opt2|...</beam> markers in the original text
 * using the LLM's chosen resolutions. Falls back to the first option.
 */
function resolveBeams(
  text: string,
  resolutions: BeamResolution[],
): string {
  const resMap = new Map<number, string>();
  for (const r of resolutions) {
    resMap.set(r.pos, r.chosen);
  }

  return text.replace(/<beam\s+pos=["'](\d+)["']>([^<]*)<\/beam>/gi, (_match, posStr, candidates) => {
    const pos = parseInt(posStr, 10);
    const chosen = resMap.get(pos);
    if (chosen) return chosen;
    const options = candidates.split('|');
    return options[0]?.trim() || candidates;
  });
}

// ---------------------------------------------------------------------------
// Text matching
// ---------------------------------------------------------------------------

function findInText(
  inputLower: string,
  needle: string,
  claimed: Set<number>,
): {start: number; end: number} | null {
  const needleLower = needle.toLowerCase();
  let searchFrom = 0;

  while (searchFrom <= inputLower.length - needleLower.length) {
    const idx = inputLower.indexOf(needleLower, searchFrom);
    if (idx === -1) return null;

    let overlap = false;
    for (let i = idx; i < idx + needleLower.length; i++) {
      if (claimed.has(i)) {
        overlap = true;
        break;
      }
    }

    if (!overlap) {
      return {start: idx, end: idx + needle.length};
    }

    searchFrom = idx + 1;
  }

  return null;
}

function claimRange(claimed: Set<number>, start: number, end: number): void {
  for (let i = start; i < end; i++) {
    claimed.add(i);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse annotation XML output (v3 LoRA format) and map terms back onto the
 * original text to produce AnnotatedSegments compatible with the existing UI.
 */
export function parseAnnotationXml(
  xmlStr: string,
  originalText: string,
): ParseResult {
  const empty: ParseResult = {
    segments: [{type: 'text', text: originalText}],
    plainText: originalText,
    symptoms: [],
    medications: [],
    corrections: [],
    hasAudioReferences: false,
  };

  if (!xmlStr || xmlStr.trim() === '<none/>') return empty;

  // 1. Extract beam resolutions from LLM output
  const beamResolutions = extractBeamResolutions(xmlStr);

  // 2. Apply beam resolutions to original text (which has <beam> markers)
  const cleanText = resolveBeams(originalText, beamResolutions);

  empty.segments = [{type: 'text', text: cleanText}];
  empty.plainText = cleanText;

  // 3. Extract symptom and med tags from LLM output
  const symptomTags = extractSymptomTags(xmlStr);
  const medTags = extractMedTags(xmlStr);

  if (symptomTags.length === 0 && medTags.length === 0) return empty;

  // 4. Match annotations against the resolved text
  const annotations: Annotation[] = [];
  const claimed = new Set<number>();
  const inputLower = cleanText.toLowerCase();

  const symptoms: SymptomInfo[] = [];
  const medications: MedicationInfo[] = [];

  for (const tag of symptomTags) {
    const pos = findInText(inputLower, tag.text, claimed);
    if (!pos) continue;

    claimRange(claimed, pos.start, pos.end);
    const sym: SymptomInfo = {
      name: tag.term,
      confirmed: tag.confirmed,
      text: cleanText.slice(pos.start, pos.end),
    };
    symptoms.push(sym);
    annotations.push({
      ...pos,
      segment: {
        type: 'symptom',
        text: cleanText.slice(pos.start, pos.end),
        name: tag.term,
        confirmed: tag.confirmed,
      },
      symptom: sym,
    });
  }

  for (const tag of medTags) {
    const pos = findInText(inputLower, tag.text, claimed);
    if (!pos) continue;

    claimRange(claimed, pos.start, pos.end);
    const med: MedicationInfo = {
      genericName: tag.generic,
      text: cleanText.slice(pos.start, pos.end),
      confirmed: tag.confirmed,
    };
    medications.push(med);
    annotations.push({
      ...pos,
      segment: {
        type: 'med',
        text: cleanText.slice(pos.start, pos.end),
        genericName: tag.generic,
        confirmed: tag.confirmed,
      },
      medication: med,
    });
  }

  if (annotations.length === 0) return empty;

  // 5. Sort by position and build segment array
  annotations.sort((a, b) => a.start - b.start);

  const segments: AnnotatedSegment[] = [];
  let cursor = 0;

  for (const ann of annotations) {
    if (ann.start > cursor) {
      segments.push({type: 'text', text: cleanText.slice(cursor, ann.start)});
    }
    segments.push(ann.segment);
    cursor = ann.end;
  }

  if (cursor < cleanText.length) {
    segments.push({type: 'text', text: cleanText.slice(cursor)});
  }

  const plainText = segments.map(s => s.text).join('');

  return {
    segments,
    plainText,
    symptoms,
    medications,
    corrections: [],
    hasAudioReferences: false,
  };
}

export default parseAnnotationXml;
