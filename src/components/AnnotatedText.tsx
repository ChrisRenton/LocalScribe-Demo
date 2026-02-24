/**
 * AnnotatedText - Renders medical XML-annotated text with coloured highlights.
 *
 * Symptom tags       -> teal/green background
 * Med tags           -> blue/purple background
 * Corrections        -> amber dotted underline (stripped for display, shows corrected text)
 * Audio references   -> tappable with play icon; children rendered with own styles
 * Plain text         -> normal rendering
 */

import React from 'react';
import {Text, StyleSheet, TouchableOpacity, View} from 'react-native';
import {AnnotatedSegment, AudioReferenceSegment} from '../utils/medicalXmlParser';
interface AnnotatedTextProps {
  segments: AnnotatedSegment[];
  baseStyle?: any;
  /** Called when user taps an audio_reference segment */
  onAudioPress?: (startTime: string, endTime: string) => void;
}

/**
 * Render segments with inline highlighting.
 */
export function AnnotatedText({
  segments,
  baseStyle,
  onAudioPress,
}: AnnotatedTextProps) {
  if (!segments || segments.length === 0) return null;

  return (
    <Text style={baseStyle}>
      {segments.map((seg, i) => renderSegment(seg, i, onAudioPress))}
    </Text>
  );
}

function renderSegment(
  seg: AnnotatedSegment,
  key: number,
  onAudioPress?: (startTime: string, endTime: string) => void,
): React.ReactNode {
  switch (seg.type) {
    case 'symptom':
      return (
        <Text key={key} style={seg.confirmed === 'confirmed' ? styles.symptomConfirmed : seg.confirmed === 'denied' ? styles.symptomDenied : styles.symptom}>
          {seg.confirmed === 'confirmed' ? '\u2713 ' : seg.confirmed === 'denied' ? '\u2717 ' : '? '}{seg.text}
        </Text>
      );

    case 'med':
      return (
        <Text key={key} style={styles.med}>
          {seg.text}
        </Text>
      );

    case 'correction':
      // Show both original (strikethrough) and corrected text
      return (
        <Text key={key}>
          {seg.originalText ? (
            <>
              <Text style={styles.correctionOriginal}>{seg.originalText}</Text>
              <Text style={styles.correctionArrow}> → </Text>
            </>
          ) : null}
          <Text style={styles.correction}>{seg.text}</Text>
        </Text>
      );

    case 'audio_reference':
      return renderAudioReference(
        seg as AudioReferenceSegment,
        key,
        onAudioPress,
      );

    case 'text':
    default:
      return <Text key={key}>{seg.text}</Text>;
  }
}

function renderAudioReference(
  seg: AudioReferenceSegment,
  key: number,
  onAudioPress?: (startTime: string, endTime: string) => void,
): React.ReactNode {
  const handlePress = () => {
    onAudioPress?.(seg.startTime, seg.endTime);
  };

  // Render children with their own styles, wrapped in a tappable container
  return (
    <Text
      key={key}
      style={styles.audioRefContainer}
      onPress={onAudioPress ? handlePress : undefined}>
      <Text style={styles.audioRefTimestamp}>[{seg.startTime}] </Text>
      {seg.children.map((child, j) => renderSegment(child, j, onAudioPress))}
      {onAudioPress && <Text style={styles.audioRefPlayIcon}> ▶</Text>}
    </Text>
  );
}

const styles = StyleSheet.create({
  symptom: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    color: '#92400E',
    borderRadius: 3,
    paddingHorizontal: 2,
    fontWeight: '600',
  },
  symptomConfirmed: {
    backgroundColor: 'rgba(5, 150, 105, 0.15)',
    color: '#065F46',
    borderRadius: 3,
    paddingHorizontal: 2,
    fontWeight: '600',
  },
  symptomDenied: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    color: '#991B1B',
    borderRadius: 3,
    paddingHorizontal: 2,
    fontWeight: '600',
  },
  med: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    color: '#3730A3',
    borderRadius: 3,
    paddingHorizontal: 2,
    fontWeight: '600',
  },
  correction: {
    color: '#065F46',
    fontWeight: '600',
    backgroundColor: 'rgba(5, 150, 105, 0.08)',
    borderRadius: 2,
    paddingHorizontal: 1,
  },
  correctionOriginal: {
    textDecorationLine: 'line-through',
    color: '#9CA3AF',
    fontSize: 11,
  },
  correctionArrow: {
    color: '#D97706',
    fontSize: 10,
  },
  audioRefContainer: {
    // Subtle left border effect via background tint
    backgroundColor: 'rgba(14, 165, 233, 0.05)',
    borderRadius: 3,
    paddingHorizontal: 1,
  },
  audioRefTimestamp: {
    fontSize: 9,
    color: '#0284C7',
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  audioRefPlayIcon: {
    fontSize: 10,
    color: '#0284C7',
  },
});

export default AnnotatedText;
