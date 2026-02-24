import React, {useState, useRef, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  Linking,
} from 'react-native';
import SafeScreen from '../components/SafeScreen';
import {Patient} from '../types';
import databaseService, {NoteRow, NoteStatus, SessionRow} from '../services/DatabaseService';
import audioPlaybackService from '../services/AudioPlaybackService';

interface NoteViewScreenProps {
  patient: Patient;
  note: NoteRow;
  session: SessionRow;
  onBack: () => void;
}

export default function NoteViewScreen({
  patient,
  note,
  session,
  onBack,
}: NoteViewScreenProps) {
  const [noteStatus, setNoteStatus] = useState<NoteStatus>(note.status || 'awaiting_confirm');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerModal, setPlayerModal] = useState<{visible: boolean; startSec: number; label: string}>({visible: false, startSec: 0, label: ''});
  const [playerPos, setPlayerPos] = useState(0);
  const playerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const fmtDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return dateStr; }
  };

  const handleTimestampPress = useCallback((timestamp: string) => {
    if (!session.audio_file_path) {
      Alert.alert('No Audio', 'No audio recording available for playback.');
      return;
    }
    const parts = timestamp.split(':');
    const startSec = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    setPlayerPos(startSec);
    setPlayerModal({visible: true, startSec, label: `[${timestamp}]`});
  }, [session.audio_file_path]);

  const startPlayback = useCallback(async (fromSec: number) => {
    if (!session.audio_file_path) return;
    await audioPlaybackService.stop().catch(() => {});
    if (playerTimerRef.current) clearInterval(playerTimerRef.current);

    const endSec = Math.min(fromSec + 30, session.duration_sec);
    setIsPlaying(true);
    setPlayerPos(fromSec);

    audioPlaybackService.setCallbacks({
      onComplete: () => { setIsPlaying(false); if (playerTimerRef.current) clearInterval(playerTimerRef.current); },
      onError: () => { setIsPlaying(false); if (playerTimerRef.current) clearInterval(playerTimerRef.current); },
    });

    try {
      await audioPlaybackService.playSegment(session.audio_file_path, fromSec, endSec);
      playerTimerRef.current = setInterval(() => {
        setPlayerPos(prev => {
          if (prev >= endSec) { if (playerTimerRef.current) clearInterval(playerTimerRef.current); return prev; }
          return prev + 1;
        });
      }, 1000);
    } catch { setIsPlaying(false); }
  }, [session.audio_file_path, session.duration_sec]);

  const stopPlayback = useCallback(async () => {
    await audioPlaybackService.stop().catch(() => {});
    setIsPlaying(false);
    if (playerTimerRef.current) clearInterval(playerTimerRef.current);
  }, []);

  const seekBy = useCallback(async (deltaSec: number) => {
    const newPos = Math.max(0, Math.min(playerPos + deltaSec, session.duration_sec));
    setPlayerPos(newPos);
    if (isPlaying) await startPlayback(newPos);
  }, [playerPos, session.duration_sec, isPlaying, startPlayback]);

  const closePlayer = useCallback(async () => {
    await stopPlayback();
    setPlayerModal({visible: false, startSec: 0, label: ''});
  }, [stopPlayback]);

  const handleConfirm = useCallback(async () => {
    await databaseService.updateNoteStatus(note.id, 'confirmed').catch(() => {});
    setNoteStatus('confirmed');
  }, [note.id]);

  const handleDone = useCallback(async () => {
    await databaseService.updateNoteStatus(note.id, 'done').catch(() => {});
    setNoteStatus('done');
  }, [note.id]);

  const handleShare = useCallback(() => {
    Alert.alert(
      'Data Responsibility Notice',
      'You are responsible for ensuring that any patient data leaving this device is handled in compliance with your local legislation (e.g. HIPAA, GDPR) and your organisation\'s data governance policies.\n\nProceed with sharing?',
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Share via Email', onPress: () => {
          const subject = encodeURIComponent(`Clinical Note - ${patient.firstName} ${patient.lastName} (${patient.mrn})`);
          const body = encodeURIComponent(note.content);
          Linking.openURL(`mailto:?subject=${subject}&body=${body}`).catch(() => {
            Alert.alert('Error', 'Unable to open email client.');
          });
        }},
      ],
    );
  }, [patient, note.content]);

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
    if (!note.content) return null;
    const lines = note.content.split('\n');
    const elements: React.ReactNode[] = [];
    let lastTimestamp: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') { elements.push(<View key={i} style={{height: 8}} />); continue; }
      if (line.startsWith('### ')) { elements.push(<Text key={i} style={st.h3}>{line.slice(4)}</Text>); continue; }
      if (line.startsWith('## ')) { elements.push(<Text key={i} style={st.h2}>{line.slice(3)}</Text>); continue; }
      if (line.startsWith('# ')) { elements.push(<Text key={i} style={st.h1}>{line.slice(2)}</Text>); continue; }

      const lineTs = line.match(/\[(\d{2}:\d{2})\]/);
      if (lineTs) lastTimestamp = lineTs[1];
      let displayText = line.replace(/\[\d{2}:\d{2}\]\s*/g, '').trim();

      const bulletMatch = displayText.match(/^[-•]\s+(.*)$/);
      const numberedMatch = displayText.match(/^(\d+)[.)]\s+(.*)$/);
      if (bulletMatch) displayText = bulletMatch[1];
      if (numberedMatch) displayText = numberedMatch[2];

      if (!displayText) { elements.push(<View key={i} style={{height: 4}} />); continue; }

      const capturedTs = lastTimestamp;
      const bodyContent = renderInlineMarkdown(displayText, st.body);
      const prefix = bulletMatch ? '  •  ' : numberedMatch ? `  ${numberedMatch[1]}.  ` : '';

      elements.push(
        <TouchableOpacity
          key={i}
          disabled={!capturedTs || !session.audio_file_path}
          onPress={() => capturedTs && handleTimestampPress(capturedTs)}
          activeOpacity={0.7}
          style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center'}}>
          {prefix ? <Text style={st.body}>{prefix}</Text> : null}
          {bodyContent}
        </TouchableOpacity>,
      );
    }
    return elements;
  };

  return (
    <SafeScreen>
      <View style={st.header}>
        <TouchableOpacity onPress={onBack} style={{padding: 4}}>
          <Text style={{fontSize: 16, color: '#2563EB', fontWeight: '500'}}>← Back</Text>
        </TouchableOpacity>
        <View style={{flex: 1, marginLeft: 12}}>
          <Text style={st.headerTitle}>{note.template_name || 'Note'}</Text>
          <Text style={st.headerSub}>
            {patient.firstName} {patient.lastName} — {fmtDate(note.created_at)}
          </Text>
        </View>
      </View>

      <View style={st.statusBar}>
        <View style={[st.statusBadge, noteStatus === 'awaiting_confirm' && st.statusAwait, noteStatus === 'confirmed' && st.statusConfirmed, noteStatus === 'done' && st.statusDone]}>
          <Text style={st.statusBadgeText}>
            {noteStatus === 'generating' ? '⏳ Generating' :
             noteStatus === 'awaiting_confirm' ? '⚠️ Awaiting Confirmation' :
             noteStatus === 'confirmed' ? '✅ Confirmed' : '📋 Done'}
          </Text>
        </View>
        <View style={{flexDirection: 'row', gap: 8}}>
          {noteStatus === 'awaiting_confirm' && (
            <TouchableOpacity style={st.actionBtn} onPress={handleConfirm}>
              <Text style={st.actionBtnText}>Confirm</Text>
            </TouchableOpacity>
          )}
          {noteStatus === 'confirmed' && (
            <TouchableOpacity style={[st.actionBtn, {backgroundColor: '#2563EB'}]} onPress={handleDone}>
              <Text style={st.actionBtnText}>Mark Done</Text>
            </TouchableOpacity>
          )}
          {(noteStatus === 'confirmed' || noteStatus === 'done') && (
            <TouchableOpacity style={[st.actionBtn, {backgroundColor: '#8B5CF6'}]} onPress={handleShare}>
              <Text style={st.actionBtnText}>Share</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={{flex: 1}} contentContainerStyle={{padding: 16, paddingBottom: 32}}>
        {renderNote()}
      </ScrollView>

      {/* Audio player modal */}
      <Modal visible={playerModal.visible} transparent animationType="slide" onRequestClose={closePlayer}>
        <View style={st.modalOverlay}>
          <View style={st.modalContent}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>Audio Verification</Text>
              <TouchableOpacity onPress={closePlayer}><Text style={st.modalCloseBtn}>✕</Text></TouchableOpacity>
            </View>
            <Text style={st.refLabel}>Referenced at {playerModal.label}</Text>
            <View style={st.timeline}>
              <Text style={st.timeLabel}>{fmtTime(playerPos)}</Text>
              <View style={st.timeBar}>
                <View style={[st.timeProgress, {width: session.duration_sec > 0 ? `${(playerPos / session.duration_sec) * 100}%` : '0%'}]} />
                <View style={[st.timeMarker, {left: session.duration_sec > 0 ? `${(playerModal.startSec / session.duration_sec) * 100}%` : '0%'}]} />
              </View>
              <Text style={st.timeLabel}>{fmtTime(session.duration_sec)}</Text>
            </View>
            <View style={st.controls}>
              <TouchableOpacity style={st.seekBtn} onPress={() => seekBy(-60)}><Text style={st.seekText}>-60s</Text></TouchableOpacity>
              <TouchableOpacity style={st.seekBtn} onPress={() => seekBy(-10)}><Text style={st.seekText}>-10s</Text></TouchableOpacity>
              <TouchableOpacity style={[st.playBtn, isPlaying && st.playBtnActive]} onPress={() => isPlaying ? stopPlayback() : startPlayback(playerPos)}>
                <Text style={st.playBtnText}>{isPlaying ? '■' : '▶'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.seekBtn} onPress={() => seekBy(10)}><Text style={st.seekText}>+10s</Text></TouchableOpacity>
              <TouchableOpacity style={st.seekBtn} onPress={() => seekBy(60)}><Text style={st.seekText}>+60s</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeScreen>
  );
}

const st = StyleSheet.create({
  statusBar: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0'},
  statusBadge: {paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#FEF3C7'},
  statusAwait: {backgroundColor: '#FEF3C7'},
  statusConfirmed: {backgroundColor: '#D1FAE5'},
  statusDone: {backgroundColor: '#DBEAFE'},
  statusBadgeText: {fontSize: 12, fontWeight: '600'},
  actionBtn: {backgroundColor: '#10B981', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6},
  actionBtnText: {color: '#FFF', fontSize: 13, fontWeight: '600'},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0'},
  headerTitle: {fontSize: 18, fontWeight: '700', color: '#1E293B'},
  headerSub: {fontSize: 13, color: '#64748B', marginTop: 2},
  h1: {fontSize: 22, fontWeight: '800', color: '#0F172A', marginTop: 16, marginBottom: 8},
  h2: {fontSize: 18, fontWeight: '700', color: '#1E293B', marginTop: 14, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingBottom: 4},
  h3: {fontSize: 15, fontWeight: '700', color: '#334155', marginTop: 10, marginBottom: 4},
  body: {fontSize: 14, lineHeight: 22, color: '#334155'},
  tsBadge: {backgroundColor: '#DBEAFE', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, alignSelf: 'flex-start'},
  tsText: {fontSize: 12, fontWeight: '700', color: '#1D4ED8', fontFamily: 'monospace'},
  modalOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'},
  modalContent: {backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36},
  modalHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12},
  modalTitle: {fontSize: 18, fontWeight: '700', color: '#1E293B'},
  modalCloseBtn: {fontSize: 22, color: '#94A3B8', padding: 4},
  refLabel: {fontSize: 14, color: '#1D4ED8', fontWeight: '600', fontFamily: 'monospace', textAlign: 'center', marginBottom: 16},
  timeline: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20},
  timeLabel: {fontSize: 12, fontFamily: 'monospace', color: '#64748B', width: 40},
  timeBar: {flex: 1, height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'visible', position: 'relative'},
  timeProgress: {height: '100%', backgroundColor: '#2563EB', borderRadius: 4},
  timeMarker: {position: 'absolute', top: -4, width: 3, height: 16, backgroundColor: '#EF4444', borderRadius: 1},
  controls: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12},
  seekBtn: {backgroundColor: '#F1F5F9', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8},
  seekText: {fontSize: 14, fontWeight: '600', color: '#475569'},
  playBtn: {backgroundColor: '#2563EB', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center'},
  playBtnActive: {backgroundColor: '#DC2626'},
  playBtnText: {fontSize: 22, color: '#FFF'},
});
