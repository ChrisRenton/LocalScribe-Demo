import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  PermissionsAndroid,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import SafeScreen from '../components/SafeScreen';
import {Patient, SessionFinishData} from '../types';
import {useMedASR} from '../hooks/useMedASR';
import {useTranscriptProcessor} from '../hooks/useTranscriptProcessor';
import {AnnotatedText} from '../components/AnnotatedText';
import RecordingAnimation from '../components/RecordingAnimation';
import MicIcon from '../components/MicIcon';
import PauseIcon from '../components/PauseIcon';
import noteTemplateService, {
  NoteTemplate,
} from '../services/NoteTemplateService';

type RecordingState = 'idle' | 'recording' | 'paused';


interface RecordingScreenProps {
  patient: Patient;
  onBack: () => void;
  onFinish: (action: 'save_note' | 'save' | 'discard', data?: SessionFinishData) => void;
  completeFn: ((prompt: string, options: any) => Promise<any>) | null;
  demoMode?: boolean;
  demoAssetName?: string;
}

export default function RecordingScreen({
  patient,
  onBack,
  onFinish,
  completeFn,
  demoMode = false,
  demoAssetName = 'GOOD_CONVO.wav',
}: RecordingScreenProps) {
  const [recState, setRecState] = useState<RecordingState>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [rawTranscript, setRawTranscript] = useState('');
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('soap');
  const [showTemplates, setShowTemplates] = useState(false);
  const [contextModal, setContextModal] = useState<{
    label: string;
    matchText: string;
    batchText: string;
  } | null>(null);
  const [showLegend, setShowLegend] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  const accumulatedTimeRef = useRef(0);
  const segmentStartRef = useRef(0);
  const encryptedAudioPathRef = useRef<string | undefined>(undefined);

  const {
    isReady: asrReady,
    isRecording,
    transcript,
    error: asrError,
    sessionId,
    initialize: initASR,
    startRecording,
    stopRecording,
    playDemo,
    stopDemo,
    onChunkRef,
  } = useMedASR();

  const {
    segments: annotatedSegments,
    symptoms,
    medications,
    processedBatches,
    isProcessing,
    processingText,
    addChunk,
    flush: flushProcessor,
    clear: clearProcessor,
  } = useTranscriptProcessor({
    minChunksFirst: 1,
    minChunksLater: 2,
    completeFn,
  });

  useEffect(() => {
    noteTemplateService.getAll().then(setTemplates);
  }, []);

  useEffect(() => {
    initASR();
  }, [initASR]);

  useEffect(() => {
    if (recState !== 'recording') return;
    segmentStartRef.current = Date.now();
    const t = setInterval(() => {
      const segmentTime = Math.floor(
        (Date.now() - segmentStartRef.current) / 1000,
      );
      setElapsedSec(accumulatedTimeRef.current + segmentTime);
    }, 1000);
    return () => clearInterval(t);
  }, [recState]);

  useEffect(() => {
    onChunkRef.current = (text, startTimeSec, endTimeSec) => {
      if (text.trim().length > 0) {
        addChunk(text.trim(), startTimeSec, endTimeSec);
      }
    };
    return () => { onChunkRef.current = null; };
  }, [onChunkRef, addChunk]);

  const lastTranscriptRef = useRef('');
  useEffect(() => {
    if (transcript && transcript !== lastTranscriptRef.current) {
      const newText = transcript.slice(lastTranscriptRef.current.length).trim();
      if (newText.length > 0) {
        setRawTranscript(prev => (prev ? prev + ' ' + newText : newText));
      }
      lastTranscriptRef.current = transcript;
    }
  }, [transcript]);

  const demoStartedRef = useRef(false);
  useEffect(() => {
    if (!demoMode || !asrReady || demoStartedRef.current) return;
    demoStartedRef.current = true;
    setRecState('recording');
    playDemo(demoAssetName).then((result) => {
      if (result?.encryptedAudioPath) {
        encryptedAudioPathRef.current = result.encryptedAudioPath;
      }
      accumulatedTimeRef.current = elapsedSec;
      setRecState('paused');
      flushProcessor();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, asrReady]);

  useEffect(() => {
    return () => {
      if (demoStartedRef.current) {
        stopDemo();
        demoStartedRef.current = false;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = useCallback(async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
    }
    clearProcessor();
    setRawTranscript('');
    setElapsedSec(0);
    accumulatedTimeRef.current = 0;
    lastTranscriptRef.current = '';
    await startRecording();
    setRecState('recording');
  }, [startRecording, clearProcessor]);

  const handlePause = useCallback(async () => {
    if (demoMode) {
      await stopDemo();
    } else {
      const result = await stopRecording();
      if (result?.encryptedAudioPath) {
        encryptedAudioPathRef.current = result.encryptedAudioPath;
      }
    }
    accumulatedTimeRef.current = elapsedSec;
    setRecState('paused');
    flushProcessor();
  }, [demoMode, stopDemo, stopRecording, elapsedSec, flushProcessor]);

  const handleResume = useCallback(async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
    }
    await startRecording();
    setRecState('recording');
  }, [startRecording]);

  const buildTimestampedTranscript = useCallback((): string => {
    if (processedBatches.length === 0) return rawTranscript;
    return processedBatches
      .map(batch => {
        const m = Math.floor(batch.batchStartTimeSec / 60);
        const s = Math.floor(batch.batchStartTimeSec % 60);
        const ts = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `[${ts}] ${batch.plainText}`;
      })
      .join('\n');
  }, [processedBatches, rawTranscript]);

  const buildSessionData = useCallback((templateId?: string): SessionFinishData => ({
    sessionId: sessionId || `session_${Date.now()}`,
    durationSec: elapsedSec,
    encryptedAudioPath: encryptedAudioPathRef.current,
    timestampedTranscript: buildTimestampedTranscript(),
    plainTranscript: rawTranscript,
    templateId,
    symptoms,
    medications,
  }), [sessionId, elapsedSec, buildTimestampedTranscript, rawTranscript, symptoms, medications]);

  const handleFinished = useCallback(() => {
    const hasContent = rawTranscript.trim().length > 0;
    if (!hasContent) {
      Alert.alert('No Recording', 'There is nothing to save.', [
        {text: 'OK', onPress: () => onFinish('discard')},
      ]);
      return;
    }

    Alert.alert('Finish Recording', 'What would you like to do?', [
      {
        text: 'Save & Create Note',
        onPress: () => onFinish('save_note', buildSessionData(selectedTemplateId)),
      },
      {
        text: 'Just Save',
        onPress: () => onFinish('save', buildSessionData()),
      },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            'Discard Recording?',
            'This will permanently delete this recording and transcript.',
            [
              {text: 'Cancel', style: 'cancel'},
              {
                text: 'Discard',
                style: 'destructive',
                onPress: () => onFinish('discard'),
              },
            ],
          );
        },
      },
      {text: 'Cancel', style: 'cancel'},
    ]);
  }, [rawTranscript, selectedTemplateId, onFinish, buildSessionData]);

  const fmtTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleTagLongPress = useCallback(
    (label: string, matchText: string) => {
      const beamRe = /<beam\s+pos="\d+">(.*?)<\/beam>/g;
      const strip = (t: string) => t.replace(beamRe, (_m, c: string) => c.split('|')[0]);
      const matchLower = matchText.toLowerCase();
      for (const batch of processedBatches) {
        const clean = strip(batch.originalText);
        if (clean.toLowerCase().includes(matchLower)) {
          setContextModal({label, matchText, batchText: clean});
          return;
        }
      }
    },
    [processedBatches],
  );

  const currentTemplate =
    templates.find(t => t.id === selectedTemplateId) || templates[0];

  const BEAM_RE = /<beam\s+pos="\d+">(.*?)<\/beam>/g;

  const stripBeamTags = (text: string): string =>
    text.replace(BEAM_RE, (_m, candidates: string) => candidates.split('|')[0]);

  const renderBeamAware = (text: string, baseColor?: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    const re = /<beam\s+pos="\d+">(.*?)<\/beam>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        parts.push(
          <Text key={last} style={baseColor ? {color: baseColor} : undefined}>
            {text.slice(last, m.index)}
          </Text>,
        );
      }
      parts.push(
        <Text key={m.index} style={{color: '#D97706', fontWeight: '600'}}>
          {m[1].split('|')[0]}
        </Text>,
      );
      last = re.lastIndex;
    }
    if (last < text.length) {
      parts.push(
        <Text key={last} style={baseColor ? {color: baseColor} : undefined}>
          {text.slice(last)}
        </Text>,
      );
    }
    return parts.length > 0 ? <>{parts}</> : null;
  };

  const renderTranscript = () => {
    const annotatedPlain =
      annotatedSegments.length > 0
        ? annotatedSegments.map(seg => seg.text).join('')
        : '';
    const annotatedCharCount = annotatedPlain.replace(/\s+/g, ' ').trim().length;
    const rawStripped = stripBeamTags(rawTranscript).trim();

    let remainingRaw = '';
    if (rawStripped.length > annotatedCharCount && annotatedCharCount > 0) {
      const rawWords = rawStripped.split(/\s+/);
      const annotatedWords = annotatedPlain
        .replace(/\s+/g, ' ')
        .trim()
        .split(/\s+/);
      const coveredWordCount = annotatedWords.filter(w => w.length > 0).length;
      if (coveredWordCount < rawWords.length) {
        remainingRaw = ' ' + rawWords.slice(coveredWordCount).join(' ');
      }
    } else if (annotatedCharCount === 0) {
      remainingRaw = rawTranscript.trim();
    }

    if (!rawStripped && annotatedSegments.length === 0) {
      return (
        <View style={{alignItems: 'center', paddingVertical: 40}}>
          <Text style={{fontSize: 15, color: '#999'}}>
            {demoMode
              ? 'Starting demo conversation...'
              : asrReady
              ? 'Tap the mic button to start recording'
              : asrError
              ? `ASR Error: ${asrError}`
              : 'Initializing speech recognition...'}
          </Text>
        </View>
      );
    }

    return (
      <View>
        <Text style={s.transcriptText}>
          {annotatedSegments.length > 0 && (
            <AnnotatedText
              segments={annotatedSegments}
              baseStyle={s.transcriptText}
            />
          )}
          {remainingRaw ? (
            processingText ? (() => {
              const procWordCount = stripBeamTags(processingText).trim().split(/\s+/).length;
              const strippedRemaining = stripBeamTags(remainingRaw).trim();
              const words = strippedRemaining.split(/\s+/);
              const greenWordCount = Math.min(procWordCount, words.length);

              const leading = remainingRaw.startsWith(' ') ? ' ' : '';
              const tokens = remainingRaw.trim().split(/(\s+)/);
              let wordIdx = 0;
              const greenParts: string[] = [];
              const grayParts: string[] = [];
              for (const tok of tokens) {
                if (/^\s+$/.test(tok)) {
                  (wordIdx < greenWordCount ? greenParts : grayParts).push(tok);
                } else {
                  const stripped = stripBeamTags(tok);
                  const isWord = stripped.trim().length > 0;
                  (wordIdx < greenWordCount ? greenParts : grayParts).push(tok);
                  if (isWord) wordIdx++;
                }
              }
              const greenText = greenParts.join('');
              const grayText = grayParts.join('');
              return (
                <>
                  {greenText ? renderBeamAware(leading + greenText, '#065F46') : null}
                  {grayText ? <>{renderBeamAware(' ' + grayText)}</> : null}
                </>
              );
            })() : (
              renderBeamAware(remainingRaw)
            )
          ) : null}
        </Text>
        {recState === 'recording' && (
          <Text style={{color: '#999', fontSize: 15}}>|</Text>
        )}
      </View>
    );
  };

  const renderHighlightedContext = (text: string, match: string) => {
    const idx = text.toLowerCase().indexOf(match.toLowerCase());
    if (idx === -1) return <Text>{text}</Text>;
    const before = text.slice(0, idx);
    const highlighted = text.slice(idx, idx + match.length);
    const after = text.slice(idx + match.length);
    return (
      <>
        {before ? <Text>{before}</Text> : null}
        <Text style={{backgroundColor: '#FEF08A', fontWeight: '700'}}>{highlighted}</Text>
        {after ? <Text>{after}</Text> : null}
      </>
    );
  };

  const renderControls = () => {
    if (recState === 'idle') {
      return (
        <TouchableOpacity
          style={[s.micBtn, !asrReady && {opacity: 0.4}]}
          onPress={handleStart}
          disabled={!asrReady}
          activeOpacity={0.8}>
          <MicIcon size={28} color="#FF3B30" />
        </TouchableOpacity>
      );
    }

    if (recState === 'recording') {
      return (
        <TouchableOpacity
          style={s.pauseBtn}
          onPress={handlePause}
          activeOpacity={0.8}>
          <PauseIcon size={28} color="#FF3B30" />
        </TouchableOpacity>
      );
    }

    return (
      <View style={{alignItems: 'center', width: '100%'}}>
        {/* Template selector */}
        <View style={s.templateRow}>
          <Text style={s.templateLabel}>Note template:</Text>
          <TouchableOpacity
            style={s.templateSelector}
            onPress={() => setShowTemplates(!showTemplates)}
            activeOpacity={0.8}>
            <Text style={s.templateText}>
              {currentTemplate?.name || 'Select...'}
            </Text>
            <Text style={{color: '#999', fontSize: 12}}>
              {showTemplates ? '▲' : '▼'}
            </Text>
          </TouchableOpacity>
        </View>

        {showTemplates && (
          <View style={s.templateDropdown}>
            {templates.map(tmpl => (
              <TouchableOpacity
                key={tmpl.id}
                style={[
                  s.templateOption,
                  tmpl.id === selectedTemplateId && s.templateOptionSelected,
                ]}
                onPress={() => {
                  setSelectedTemplateId(tmpl.id);
                  setShowTemplates(false);
                }}>
                <Text
                  style={[
                    s.templateOptionText,
                    tmpl.id === selectedTemplateId && {color: '#FF3B30'},
                  ]}>
                  {tmpl.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Action buttons */}
        <View style={s.pausedActions}>
          <TouchableOpacity
            style={s.micBtn}
            onPress={handleResume}
            activeOpacity={0.8}>
            <MicIcon size={28} color="#FF3B30" />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.finishedBtn}
            onPress={handleFinished}
            activeOpacity={0.8}>
            <Text style={s.finishedBtnText}>Finished</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeScreen>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => {
            if (recState !== 'idle' && rawTranscript.trim().length > 0) {
              Alert.alert(
                'Leave Recording?',
                'You have an active recording. What would you like to do?',
                [
                  {text: 'Continue Recording', style: 'cancel'},
                  {
                    text: 'Save & Leave',
                    onPress: () => onFinish('save'),
                  },
                  {
                    text: 'Discard & Leave',
                    style: 'destructive',
                    onPress: () => onFinish('discard'),
                  },
                ],
              );
            } else {
              onBack();
            }
          }}
          style={{padding: 4}}>
          <Text style={{fontSize: 24, color: '#1a1a1a'}}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={{fontSize: 15, fontWeight: '600', color: '#1a1a1a'}}>
          {patient.firstName} {patient.lastName}
        </Text>
        <View style={{width: 32}} />
      </View>

      <View style={s.recordingSection}>
        <Text style={s.timerDisplay}>{fmtTimer(elapsedSec)}</Text>
        <Text
          style={[
            s.recordingStatus,
            recState === 'paused' && {color: '#F59E0B'},
            recState === 'idle' && {color: '#999'},
          ]}>
          {recState === 'recording'
            ? demoMode
              ? isProcessing
                ? 'Demo — Annotating...'
                : 'Demo - Actively listening'
              : isProcessing
              ? 'Recording & Annotating...'
              : 'Recording...'
            : recState === 'paused'
            ? demoMode
              ? 'Demo Complete'
              : 'Paused'
            : 'Ready'}
        </Text>
        <RecordingAnimation isActive={recState === 'recording'} size={80} />
      </View>

      <ScrollView ref={scrollRef} style={{flex: 1}}>
        {/* AI Detected pills */}
        {(symptoms.length > 0 || medications.length > 0) && (
          <View style={s.aiSection}>
            <Text style={s.sectionLabel}>AI DETECTED</Text>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
              {symptoms.map((sym, i) => (
                <TouchableOpacity
                  key={`s-${i}`}
                  style={[
                    s.pill,
                    {backgroundColor: sym.confirmed === 'confirmed' ? '#D1FAE5' : sym.confirmed === 'denied' ? '#FEE2E2' : '#FFF3CD'},
                  ]}
                  activeOpacity={0.7}
                  onLongPress={() => handleTagLongPress(sym.name, sym.text)}>
                  <Text style={{fontSize: 12}}>{sym.confirmed === 'confirmed' ? '\u2705' : sym.confirmed === 'denied' ? '\u274C' : '\u2753'}</Text>
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: '500',
                      color: sym.confirmed === 'confirmed' ? '#065F46' : sym.confirmed === 'denied' ? '#991B1B' : '#856404',
                    }}>
                    {sym.name}
                  </Text>
                </TouchableOpacity>
              ))}
              {medications.map((med, i) => (
                <TouchableOpacity
                  key={`m-${i}`}
                  style={[s.pill, {backgroundColor: '#D1ECF1'}]}
                  activeOpacity={0.7}
                  onLongPress={() => handleTagLongPress(med.genericName, med.text)}>
                  <Text style={{fontSize: 12}}>{'\uD83D\uDC8A'}</Text>
                  <Text style={{fontSize: 13, fontWeight: '500', color: '#0C5460'}}>
                    {med.genericName}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {showLegend && (
          <View style={s.legend}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
              <Text style={s.legendTitle}>How it works</Text>
              <TouchableOpacity onPress={() => setShowLegend(false)} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <Text style={{fontSize: 14, color: '#94A3B8', lineHeight: 14}}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.legendDesc}>
              Speech is transcribed in real-time by the on-device <Text style={{fontWeight: '600'}}>MedASR</Text> model with CTC beam search — multiple hypotheses are generated and <Text style={{color: '#D97706', fontWeight: '600'}}>amber words</Text> indicate beam candidates awaiting resolution. Each chunk is then sent to <Text style={{fontWeight: '600'}}>MedGemma 1.5 4B</Text> which resolves beam alternatives, extracts symptoms, medications, and corrects ASR errors. <Text style={{color: '#1a472a', fontWeight: '600'}}>Green text</Text> is actively being analysed by the LLM. Detected findings appear as colour-coded pills above. Long-press any pill for transcript context.
            </Text>
          </View>
        )}

        {/* Live transcript */}
        <View style={s.transcriptSection}>
          <Text style={s.sectionLabel}>LIVE TRANSCRIPT</Text>
          {renderTranscript()}
        </View>
      </ScrollView>

      {/* Bottom controls */}
      <View style={s.controls}>{renderControls()}</View>

      {/* Context modal */}
      <Modal
        visible={!!contextModal}
        transparent
        animationType="fade"
        onRequestClose={() => setContextModal(null)}>
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setContextModal(null)}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>{contextModal?.label}</Text>
            <Text style={s.modalText}>
              {contextModal &&
                renderHighlightedContext(
                  contextModal.batchText,
                  contextModal.matchText,
                )}
            </Text>
            <Text style={s.modalHint}>Tap anywhere to dismiss</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeScreen>
  );
}

const s = StyleSheet.create({
  legend: {paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0'},
  legendTitle: {fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 2},
  legendDesc: {fontSize: 11, lineHeight: 16, color: '#64748B'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  recordingSection: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
    alignItems: 'center',
  },
  timerDisplay: {
    fontSize: 48,
    fontWeight: '300',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  recordingStatus: {
    fontSize: 16,
    color: '#FF3B30',
    fontWeight: '500',
    marginBottom: 12,
  },
  aiSection: {
    padding: 15,
    paddingHorizontal: 20,
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  sectionLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  transcriptSection: {
    padding: 20,
  },
  transcriptText: {
    fontSize: 15,
    lineHeight: 24,
    color: '#1a1a1a',
  },
  controls: {
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e5e5',
    alignItems: 'center',
  },
  micBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  pauseBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  pausedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    marginTop: 12,
  },
  finishedBtn: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 35,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  finishedBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    marginBottom: 4,
  },
  templateLabel: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  templateSelector: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  templateText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  templateDropdown: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    marginBottom: 4,
    overflow: 'hidden',
  },
  templateOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  templateOptionSelected: {
    backgroundColor: '#FFF5F5',
  },
  templateOptionText: {
    fontSize: 14,
    color: '#1a1a1a',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxHeight: '60%',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  modalText: {
    fontSize: 15,
    lineHeight: 24,
    color: '#374151',
  },
  modalHint: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 16,
  },
});
