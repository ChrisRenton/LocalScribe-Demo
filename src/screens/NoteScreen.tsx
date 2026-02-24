import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import SafeScreen from '../components/SafeScreen';
import {Patient, SessionFinishData} from '../types';
import noteTemplateService, {NoteTemplate} from '../services/NoteTemplateService';
import audioPlaybackService from '../services/AudioPlaybackService';
import databaseService from '../services/DatabaseService';
import noteGenService from '../services/NoteGenerationService';

const THINKING_MESSAGES = [
  'Reading the transcript...',
  'Identifying symptoms and conditions...',
  'Checking medications mentioned...',
  'Cross-referencing medical terminology...',
  'Mapping timestamps to key findings...',
  'Structuring clinical observations...',
  'Reviewing patient history details...',
  'Organising findings by section...',
  'Verifying facts against transcript...',
  'Preparing the clinical note...',
];

interface NoteScreenProps {
  patient: Patient;
  sessionData: SessionFinishData;
  completeFn: (prompt: string, options: any) => Promise<any>;
  stopCompletionFn: () => Promise<void>;
  removeLoraFn: () => Promise<void>;
  applyLoraFn: () => Promise<void>;
  onBack: () => void;
  onBackground: () => void;
}

const NOTE_SYSTEM_PROMPT_PREFIX = `Medical scribe. Reorganize transcript into a clinical note. Use ONLY what is stated — never fabricate. No repetition. Start each sentence with [MM:SS]. Empty sections: write "-". Use ## for headings.

`;

export default function NoteScreen({
  patient,
  sessionData,
  completeFn,
  stopCompletionFn,
  removeLoraFn,
  applyLoraFn,
  onBack,
  onBackground,
}: NoteScreenProps) {
  const [noteText, setNoteText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [template, setTemplate] = useState<NoteTemplate | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerModal, setPlayerModal] = useState<{visible: boolean; startSec: number; label: string}>({visible: false, startSec: 0, label: ''});
  const [playerPos, setPlayerPos] = useState(0);
  const [editInput, setEditInput] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [changedLines, setChangedLines] = useState<Set<number>>(new Set());
  const [noteStatus, setNoteStatus] = useState<'generating' | 'awaiting_confirm' | 'confirmed' | 'done'>('generating');
  const [genPhase, setGenPhase] = useState<'idle' | 'waiting' | 'thinking' | 'writing'>('idle');
  const [thinkingMsg, setThinkingMsg] = useState(0);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const noteTextRef = useRef('');
  const noteIdRef = useRef(`note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const genPhaseRef = useRef<'idle' | 'waiting' | 'thinking' | 'writing'>('idle');
  const previousNoteRef = useRef('');

  useEffect(() => {
    if (genPhase === 'thinking') {
      setThinkingMsg(0);
      thinkingTimerRef.current = setInterval(() => {
        setThinkingMsg(prev => (prev + 1) % THINKING_MESSAGES.length);
      }, 4000);
    } else {
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    }
    return () => {
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    };
  }, [genPhase]);

  // Restore state from background service
  useEffect(() => {
    if (noteGenService.sessionId === sessionData.sessionId) {
      if (noteGenService.status === 'complete') {
        setNoteText(noteGenService.text);
        noteTextRef.current = noteGenService.text;
        setIsComplete(true);
        return;
      }
      if (noteGenService.isActive()) {
        setNoteText(noteGenService.text);
        noteTextRef.current = noteGenService.text;
        setIsGenerating(true);
      }
    }
    // Subscribe for live updates
    noteGenService.subscribe((text, status) => {
      setNoteText(text);
      noteTextRef.current = text;
      if (status === 'complete') {
        setIsComplete(true);
        setIsGenerating(false);
      }
    });
    return () => noteGenService.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sessionData.templateId) {
      noteTemplateService.getById(sessionData.templateId).then(t => {
        setTemplate(t || null);
      });
    }
  }, [sessionData.templateId]);

  useEffect(() => {
    if (!template || isGenerating || isComplete) return;
    if (noteGenService.sessionId === sessionData.sessionId && (noteGenService.isActive() || noteGenService.status === 'complete')) return;
    generateNote(template);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const generateNote = async (tmpl: NoteTemplate) => {
    setIsGenerating(true);
    setGenPhase('waiting');
    setNoteText('');
    noteTextRef.current = '';
    noteGenService.reset();
    noteGenService.sessionId = sessionData.sessionId;
    noteGenService.setStatus('waiting');

    setNoteStatus('generating');

    // Re-use existing 'generating' note for this session if one exists (retry scenario)
    try {
      const existing = await databaseService.getNotesForSession(sessionData.sessionId);
      const stuck = existing.find(n => n.status === 'generating');
      if (stuck) {
        noteIdRef.current = stuck.id;
      } else {
        await databaseService.addNote({
          id: noteIdRef.current,
          session_id: sessionData.sessionId,
          template_id: sessionData.templateId || null,
          template_name: tmpl.name,
          content: '',
          status: 'generating',
        });
      }
    } catch (e) {
      console.warn('[NoteScreen] Note create/lookup warning:', e);
    }

    const templatePrompt = noteTemplateService.toMarkdownPrompt(tmpl);
    const systemPrompt = NOTE_SYSTEM_PROMPT_PREFIX + templatePrompt;

    const userPrompt = `Generate the clinical note for this encounter.

PATIENT: ${patient.firstName} ${patient.lastName} (MRN: ${patient.mrn})
DATE: ${new Date().toLocaleDateString()}
DURATION: ${Math.floor(sessionData.durationSec / 60)} minutes

TIMESTAMPED TRANSCRIPT:
${sessionData.timestampedTranscript}`;

    const completionOpts = {
      systemPrompt,
      maxTokens: (1024*6),
      enableThinking: true,
      temperature: 0.1,
      topP: 0.9,
      penaltyRepeat: 1.1,
      onToken: (_token: string, parsed: {response: string}) => {
        const text = parsed.response || '';
        if (!text && genPhaseRef.current !== 'writing') {
          // Tokens arriving but no response text yet = model is thinking
          if (genPhaseRef.current !== 'thinking') {
            genPhaseRef.current = 'thinking';
            setGenPhase('thinking');
          }
        } else if (text) {
          if (genPhaseRef.current !== 'writing') {
            genPhaseRef.current = 'writing';
            setGenPhase('writing');
          }
          noteTextRef.current = text;
          noteGenService.updateText(text);
          setNoteText(text);
        }
      },
    };

    console.log('[NoteScreen] Stopping in-flight completions...');
    await stopCompletionFn().catch(() => {});

    let loraRemoved = false;
    for (let wait = 0; wait < 20; wait++) {
      console.log(`[NoteScreen] Waiting for LLM (${wait + 1}/20)...`);
      await new Promise<void>(r => setTimeout(r, 2000));

      try {
        await removeLoraFn();
        loraRemoved = true;
        console.log('[NoteScreen] Context is free, LoRA removed');
        break;
      } catch (e) {
        await stopCompletionFn().catch(() => {});
      }
    }

    if (!loraRemoved) {
      console.warn('[NoteScreen] Could not free context, proceeding with LoRA');
    }

    noteTextRef.current = '';
    genPhaseRef.current = 'thinking';
    setGenPhase('thinking');
    noteGenService.updateText('');
    noteGenService.setStatus('generating');

    console.log(`[NoteScreen] Generating note: template=${tmpl.name}, transcript=${sessionData.timestampedTranscript.length} chars`);

    try {
      await completeFn(userPrompt, completionOpts);
      console.log(`[NoteScreen] Note generated: ${noteTextRef.current.length} chars`);

      // Update note content and status
      await databaseService.updateNote(noteIdRef.current, noteTextRef.current)
        .catch(e => console.warn('[NoteScreen] Note update warning:', e));
      await databaseService.updateNoteStatus(noteIdRef.current, 'awaiting_confirm')
        .catch(e => console.warn('[NoteScreen] Status update warning:', e));
      setNoteStatus('awaiting_confirm');

      await databaseService.updateSession(sessionData.sessionId, {
        generated_report: noteTextRef.current,
      }).catch(e => console.warn('[NoteScreen] Session update warning:', e));

      noteGenService.markComplete();
      setIsComplete(true);
      setIsGenerating(false);
      genPhaseRef.current = 'idle';
      setGenPhase('idle');
    } catch (error) {
      console.error('[NoteScreen] Generation error:', error);
      noteGenService.setStatus('error');
      setIsGenerating(false);
      genPhaseRef.current = 'idle';
      setGenPhase('idle');
    }

    if (loraRemoved) {
      await applyLoraFn().catch(() => {});
    }
  };

  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleTimestampPress = useCallback((timestamp: string) => {
    if (!sessionData.encryptedAudioPath) {
      Alert.alert('No Audio', 'No audio recording available for playback.');
      return;
    }
    const parts = timestamp.split(':');
    const startSec = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    setPlayerPos(startSec);
    setPlayerModal({visible: true, startSec, label: `[${timestamp}]`});
  }, [sessionData.encryptedAudioPath]);

  const startPlayback = useCallback(async (fromSec: number) => {
    if (!sessionData.encryptedAudioPath) return;

    await audioPlaybackService.stop().catch(() => {});
    if (playerTimerRef.current) clearInterval(playerTimerRef.current);

    const endSec = Math.min(fromSec + 30, sessionData.durationSec);
    setIsPlaying(true);
    setPlayerPos(fromSec);

    audioPlaybackService.setCallbacks({
      onComplete: () => {
        setIsPlaying(false);
        if (playerTimerRef.current) clearInterval(playerTimerRef.current);
      },
      onError: (err) => {
        setIsPlaying(false);
        if (playerTimerRef.current) clearInterval(playerTimerRef.current);
        console.error('[NoteScreen] Playback error:', err);
      },
    });

    try {
      await audioPlaybackService.playSegment(sessionData.encryptedAudioPath, fromSec, endSec);
      playerTimerRef.current = setInterval(() => {
        setPlayerPos(prev => {
          if (prev >= endSec) {
            if (playerTimerRef.current) clearInterval(playerTimerRef.current);
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (error) {
      setIsPlaying(false);
      console.error('[NoteScreen] Playback error:', error);
    }
  }, [sessionData.encryptedAudioPath, sessionData.durationSec]);

  const stopPlayback = useCallback(async () => {
    await audioPlaybackService.stop().catch(() => {});
    setIsPlaying(false);
    if (playerTimerRef.current) clearInterval(playerTimerRef.current);
  }, []);

  const seekBy = useCallback(async (deltaSec: number) => {
    const newPos = Math.max(0, Math.min(playerPos + deltaSec, sessionData.durationSec));
    setPlayerPos(newPos);
    if (isPlaying) {
      await startPlayback(newPos);
    }
  }, [playerPos, sessionData.durationSec, isPlaying, startPlayback]);

  const closePlayer = useCallback(async () => {
    await stopPlayback();
    setPlayerModal({visible: false, startSec: 0, label: ''});
  }, [stopPlayback]);

  const computeChangedLines = (oldText: string, newText: string): Set<number> => {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const changed = new Set<number>();
    for (let i = 0; i < newLines.length; i++) {
      const oldTrimmed = i < oldLines.length ? oldLines[i].trim() : '';
      const newTrimmed = newLines[i].trim();
      if (newTrimmed && (i >= oldLines.length || oldTrimmed !== newTrimmed)) {
        changed.add(i);
      }
    }
    return changed;
  };

  const handleEditSubmit = useCallback(async () => {
    const instruction = editInput.trim();
    if (!instruction || isEditing) return;

    setIsEditing(true);
    previousNoteRef.current = noteTextRef.current;
    const currentNote = noteTextRef.current;
    setEditInput('');

    const editPrompt = `Below is a clinical note. Make ONLY the change the clinician requested. Copy every other line EXACTLY as-is (same headings, timestamps, wording, whitespace).

CURRENT NOTE:
${currentNote}

CLINICIAN'S REQUEST:
${instruction}

RULES:
- Output the COMPLETE note with the requested change applied
- Do NOT rephrase, reformat, or reorder any line that is not affected by the request
- Preserve all [MM:SS] timestamps and section headings exactly
- Start with the first ## heading, same as the original`;

    noteTextRef.current = '';
    setNoteText('');
    setChangedLines(new Set());

    console.log(`[NoteScreen] Edit requested: "${instruction}"`);

    try {
      await removeLoraFn();
      await completeFn(editPrompt, {
        systemPrompt: 'You are a medical note editor. Make ONLY the requested change. Copy all other lines verbatim — do not rephrase, reorder, or reformat anything else.',
        maxTokens: (1024*6), // 6x the context window
        enableThinking: true,
        temperature: 0.1,
        topP: 0.9,
        penaltyRepeat: 1.1,
        onToken: (_: string, parsed: {response: string}) => {
          const text = parsed.response || '';
          noteTextRef.current = text;
          setNoteText(text);
        },
      });

      const changed = computeChangedLines(previousNoteRef.current, noteTextRef.current);
      setChangedLines(changed);
      await applyLoraFn();
      console.log(`[NoteScreen] Edit complete: ${changed.size} lines changed`);

      // Save updated note to database
      await databaseService.updateNote(noteIdRef.current, noteTextRef.current)
        .catch(e => console.warn('[NoteScreen] Note update warning:', e));
      await databaseService.updateSession(sessionData.sessionId, {
        generated_report: noteTextRef.current,
      }).catch(e => console.warn('[NoteScreen] Session update warning:', e));
    } catch (error) {
      console.error('[NoteScreen] Edit error:', error);
      noteTextRef.current = currentNote;
      setNoteText(currentNote);
      Alert.alert('Error', 'Failed to apply edit. Previous note restored.');
    } finally {
      setIsEditing(false);
    }
  }, [editInput, isEditing, completeFn, removeLoraFn, applyLoraFn]);

  const handleStopEdit = useCallback(async () => {
    await stopCompletionFn().catch(() => {});
    setIsEditing(false);
    if (noteTextRef.current.length < 10) {
      noteTextRef.current = previousNoteRef.current;
      setNoteText(previousNoteRef.current);
    }
  }, [stopCompletionFn]);

  const handleConfirmNote = useCallback(async () => {
    await databaseService.updateNoteStatus(noteIdRef.current, 'confirmed')
      .catch(e => console.warn('[NoteScreen] Confirm status warning:', e));
    setNoteStatus('confirmed');
  }, []);

  const handleMarkDone = useCallback(async () => {
    await databaseService.updateNoteStatus(noteIdRef.current, 'done')
      .catch(e => console.warn('[NoteScreen] Done status warning:', e));
    setNoteStatus('done');
  }, []);

  const handleShareNote = useCallback(() => {
    Alert.alert(
      'Data Responsibility Notice',
      'You are responsible for ensuring that any patient data leaving this device is handled in compliance with your local legislation (e.g. HIPAA, GDPR) and your organisation\'s data governance policies.\n\nProceed with sharing?',
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Share via Email', onPress: () => {
          const subject = encodeURIComponent(
            `Clinical Note - ${patient.firstName} ${patient.lastName} (${patient.mrn})`,
          );
          const body = encodeURIComponent(noteTextRef.current);
          Linking.openURL(`mailto:?subject=${subject}&body=${body}`).catch(() => {
            Alert.alert('Error', 'Unable to open email client.');
          });
        }},
      ],
    );
  }, [patient]);

  useEffect(() => {
    return () => {
      if (playerTimerRef.current) clearInterval(playerTimerRef.current);
      audioPlaybackService.stop().catch(() => {});
    };
  }, []);

  const renderInlineMarkdown = (text: string, baseStyle: any) => {
    const parts: React.ReactNode[] = [];
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
    let last = 0;
    let match;
    let idx = 0;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) parts.push(<Text key={idx++} style={baseStyle}>{text.slice(last, match.index)}</Text>);
      if (match[2]) parts.push(<Text key={idx++} style={[baseStyle, {fontWeight: '700'}]}>{match[2]}</Text>);
      else if (match[3]) parts.push(<Text key={idx++} style={[baseStyle, {fontStyle: 'italic'}]}>{match[3]}</Text>);
      last = re.lastIndex;
    }
    if (last < text.length) parts.push(<Text key={idx++} style={baseStyle}>{text.slice(last)}</Text>);
    return parts.length === 1 ? parts[0] : <Text>{parts}</Text>;
  };

  const renderNote = () => {
    if (!noteText) return null;

    const allLines = noteText.split('\n');
    const elements: React.ReactNode[] = [];
    let lastTimestamp: string | null = null;

    for (let lineNum = 0; lineNum < allLines.length; lineNum++) {
      const line = allLines[lineNum];
      const isChanged = changedLines.has(lineNum);
      const bgStyle = isChanged ? styles.changedLine : undefined;

      if (line.trim() === '') {
        elements.push(<View key={lineNum} style={{height: 8}} />);
        continue;
      }

      if (line.startsWith('### ')) {
        elements.push(
          <View key={lineNum} style={bgStyle}>
            <Text style={styles.heading3}>{line.slice(4)}</Text>
          </View>,
        );
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(
          <View key={lineNum} style={bgStyle}>
            <Text style={styles.heading2}>{line.slice(3)}</Text>
          </View>,
        );
        continue;
      }
      if (line.startsWith('# ')) {
        elements.push(
          <View key={lineNum} style={bgStyle}>
            <Text style={styles.heading1}>{line.slice(2)}</Text>
          </View>,
        );
        continue;
      }

      const lineTs = line.match(/\[(\d{2}:\d{2})\]/);
      if (lineTs) lastTimestamp = lineTs[1];
      let displayText = line.replace(/\[\d{2}:\d{2}\]\s*/g, '').trim();

      const bulletMatch = displayText.match(/^[-•]\s+(.*)$/);
      const numberedMatch = displayText.match(/^(\d+)[.)]\s+(.*)$/);
      if (bulletMatch) displayText = bulletMatch[1];
      if (numberedMatch) displayText = numberedMatch[2];

      if (!displayText) { elements.push(<View key={lineNum} style={{height: 4}} />); continue; }

      const capturedTs = lastTimestamp;
      const bodyContent = renderInlineMarkdown(displayText, styles.noteBody);
      const prefix = bulletMatch ? '  •  ' : numberedMatch ? `  ${numberedMatch[1]}.  ` : '';

      elements.push(
        <TouchableOpacity
          key={lineNum}
          disabled={!capturedTs || !sessionData.encryptedAudioPath}
          onPress={() => capturedTs && handleTimestampPress(capturedTs)}
          activeOpacity={0.7}
          style={[{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center'}, bgStyle]}>
          {prefix ? <Text style={styles.noteBody}>{prefix}</Text> : null}
          {bodyContent}
        </TouchableOpacity>,
      );
    }

    return elements;
  };

  return (
    <SafeScreen>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <View style={{flex: 1}}>
            <Text style={styles.headerTitle}>
              {template?.name || 'Clinical Note'}
            </Text>
            <Text style={styles.headerSubtitle}>
              {patient.firstName} {patient.lastName} — {patient.mrn}
            </Text>
          </View>
          {isGenerating && (
            <TouchableOpacity onPress={onBackground} style={styles.bgBtn}>
              <Text style={styles.bgBtnText}>Minimize</Text>
            </TouchableOpacity>
          )}
          {isPlaying && (
            <TouchableOpacity onPress={stopPlayback} style={styles.stopBtn}>
              <Text style={styles.stopBtnText}>■ Stop</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Status bar */}
        {isComplete && !isEditing && (
          <View style={styles.statusBar}>
            <View style={[styles.statusBadge, noteStatus === 'awaiting_confirm' && styles.statusAwait, noteStatus === 'confirmed' && styles.statusConfirmed, noteStatus === 'done' && styles.statusDone]}>
              <Text style={styles.statusBadgeText}>
                {noteStatus === 'generating' ? '⏳ Generating' :
                 noteStatus === 'awaiting_confirm' ? '⚠️ Awaiting Confirmation' :
                 noteStatus === 'confirmed' ? '✅ Confirmed' : '📋 Done'}
              </Text>
            </View>
            <View style={{flexDirection: 'row', gap: 8}}>
              {noteStatus === 'awaiting_confirm' && (
                <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmNote}>
                  <Text style={styles.confirmBtnText}>Confirm</Text>
                </TouchableOpacity>
              )}
              {noteStatus === 'confirmed' && (
                <TouchableOpacity style={styles.doneBtn} onPress={handleMarkDone}>
                  <Text style={styles.doneBtnText}>Mark Done</Text>
                </TouchableOpacity>
              )}
              {(noteStatus === 'confirmed' || noteStatus === 'done') && (
                <TouchableOpacity style={styles.shareBtn} onPress={handleShareNote}>
                  <Text style={styles.shareBtnText}>Share</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Loading indicator */}
        {isGenerating && !noteText && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2563EB" />
            <Text style={styles.loadingText}>
              {genPhase === 'waiting' ? 'Waiting for AI model...' :
               genPhase === 'thinking' ? THINKING_MESSAGES[thinkingMsg] :
               'Generating note...'}
            </Text>
            {(genPhase === 'thinking' || genPhase === 'waiting') && (
              <Text style={styles.loadingSubtext}>
                You can minimise to run in the background
              </Text>
            )}
          </View>
        )}

        {/* Note content */}
        <ScrollView
          ref={scrollRef}
          style={styles.noteScroll}
          contentContainerStyle={styles.noteContent}
          onContentSizeChange={() => {
            if (isGenerating) {
              scrollRef.current?.scrollToEnd({animated: false});
            }
          }}>
          {renderNote()}
          {isGenerating && noteText && (
            <ActivityIndicator
              size="small"
              color="#2563EB"
              style={{marginTop: 8}}
            />
          )}
        </ScrollView>

        {/* Edit bar */}
        {(isComplete || isEditing) && (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={0}>
            <View style={styles.editBar}>
              {isEditing ? (
                <View style={styles.editingRow}>
                  <ActivityIndicator size="small" color="#2563EB" />
                  <Text style={styles.editingText}>Applying edit...</Text>
                  <TouchableOpacity onPress={handleStopEdit} style={styles.editStopBtn}>
                    <Text style={styles.editStopBtnText}>Stop</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.editInputRow}>
                  <TextInput
                    style={styles.editInput}
                    value={editInput}
                    onChangeText={setEditInput}
                    placeholder="Request changes to the note..."
                    placeholderTextColor="#94A3B8"
                    multiline
                    maxLength={500}
                    editable={!isGenerating}
                  />
                  <TouchableOpacity
                    style={[styles.editSendBtn, !editInput.trim() && styles.editSendBtnDisabled]}
                    onPress={handleEditSubmit}
                    disabled={!editInput.trim() || isGenerating}>
                    <Text style={styles.editSendBtnText}>Send</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        )}

        {/* Audio player modal */}
        <Modal
          visible={playerModal.visible}
          transparent
          animationType="slide"
          onRequestClose={closePlayer}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Audio Verification</Text>
                <TouchableOpacity onPress={closePlayer}>
                  <Text style={styles.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modalTimestamp}>
                Referenced at {playerModal.label}
              </Text>

              <View style={styles.timelineContainer}>
                <Text style={styles.timeLabel}>{fmtTime(playerPos)}</Text>
                <View style={styles.timelineBar}>
                  <View
                    style={[
                      styles.timelineProgress,
                      {width: sessionData.durationSec > 0
                        ? `${(playerPos / sessionData.durationSec) * 100}%`
                        : '0%'},
                    ]}
                  />
                  <View
                    style={[
                      styles.timelineMarker,
                      {left: sessionData.durationSec > 0
                        ? `${(playerModal.startSec / sessionData.durationSec) * 100}%`
                        : '0%'},
                    ]}
                  />
                </View>
                <Text style={styles.timeLabel}>{fmtTime(sessionData.durationSec)}</Text>
              </View>

              <View style={styles.controls}>
                <TouchableOpacity
                  style={styles.seekBtn}
                  onPress={() => seekBy(-60)}>
                  <Text style={styles.seekBtnText}>-60s</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.seekBtn}
                  onPress={() => seekBy(-10)}>
                  <Text style={styles.seekBtnText}>-10s</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.playBtn, isPlaying && styles.playBtnActive]}
                  onPress={() => isPlaying ? stopPlayback() : startPlayback(playerPos)}>
                  <Text style={styles.playBtnText}>
                    {isPlaying ? '■' : '▶'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.seekBtn}
                  onPress={() => seekBy(10)}>
                  <Text style={styles.seekBtnText}>+10s</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.seekBtn}
                  onPress={() => seekBy(60)}>
                  <Text style={styles.seekBtnText}>+60s</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#F8FAFC'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {marginRight: 12},
  backBtnText: {fontSize: 16, color: '#2563EB', fontWeight: '500'},
  headerTitle: {fontSize: 18, fontWeight: '700', color: '#1E293B'},
  headerSubtitle: {fontSize: 13, color: '#64748B', marginTop: 2},
  bgBtn: {
    backgroundColor: '#64748B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  bgBtnText: {color: '#FFF', fontWeight: '600', fontSize: 13},
  stopBtn: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  stopBtnText: {color: '#FFF', fontWeight: '600', fontSize: 13},
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {fontSize: 16, color: '#64748B'},
  loadingSubtext: {fontSize: 12, color: '#94A3B8', marginTop: 4, textAlign: 'center' as const},
  statusBar: {flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0'},
  statusBadge: {paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#FEF3C7'},
  statusAwait: {backgroundColor: '#FEF3C7'},
  statusConfirmed: {backgroundColor: '#D1FAE5'},
  statusDone: {backgroundColor: '#DBEAFE'},
  statusBadgeText: {fontSize: 12, fontWeight: '600' as const},
  confirmBtn: {backgroundColor: '#10B981', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6},
  confirmBtnText: {color: '#FFF', fontSize: 13, fontWeight: '600' as const},
  doneBtn: {backgroundColor: '#2563EB', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6},
  doneBtnText: {color: '#FFF', fontSize: 13, fontWeight: '600' as const},
  shareBtn: {backgroundColor: '#8B5CF6', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6},
  shareBtnText: {color: '#FFF', fontSize: 13, fontWeight: '600' as const},
  noteScroll: {flex: 1},
  noteContent: {padding: 16, paddingBottom: 32},
  heading1: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 16,
    marginBottom: 8,
  },
  heading2: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 14,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 4,
  },
  heading3: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
    marginTop: 10,
    marginBottom: 4,
  },
  noteBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#334155',
  },
  timestampBadge: {
    backgroundColor: '#DBEAFE',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignSelf: 'flex-start',
  },
  timestampText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D4ED8',
    fontFamily: 'monospace',
  },
  changedLine: {
    backgroundColor: '#DCFCE7',
    borderRadius: 3,
    paddingHorizontal: 4,
    marginHorizontal: -4,
  },
  editBar: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  editInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  editInput: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1E293B',
    maxHeight: 80,
  },
  editSendBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  editSendBtnDisabled: {opacity: 0.4},
  editSendBtnText: {color: '#FFF', fontWeight: '600', fontSize: 14},
  editingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  editingText: {fontSize: 14, color: '#64748B'},
  editStopBtn: {
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  editStopBtnText: {color: '#FFF', fontWeight: '600', fontSize: 13},
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {fontSize: 18, fontWeight: '700', color: '#1E293B'},
  modalClose: {fontSize: 22, color: '#94A3B8', padding: 4},
  modalTimestamp: {
    fontSize: 14,
    color: '#1D4ED8',
    fontWeight: '600',
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 16,
  },
  timelineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  timeLabel: {fontSize: 12, fontFamily: 'monospace', color: '#64748B', width: 40},
  timelineBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'visible',
    position: 'relative',
  },
  timelineProgress: {
    height: '100%',
    backgroundColor: '#2563EB',
    borderRadius: 4,
  },
  timelineMarker: {
    position: 'absolute',
    top: -4,
    width: 3,
    height: 16,
    backgroundColor: '#EF4444',
    borderRadius: 1,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  seekBtn: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  seekBtnText: {fontSize: 14, fontWeight: '600', color: '#475569'},
  playBtn: {
    backgroundColor: '#2563EB',
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playBtnActive: {backgroundColor: '#DC2626'},
  playBtnText: {fontSize: 22, color: '#FFFFFF'},
});
