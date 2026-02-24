import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';
import SafeScreen from '../components/SafeScreen';
import {Patient} from '../types';
import databaseService, {SessionRow, NoteRow} from '../services/DatabaseService';
import noteTemplateService, {NoteTemplate} from '../services/NoteTemplateService';

interface SessionDetailScreenProps {
  patient: Patient;
  session: SessionRow;
  onBack: () => void;
  onViewNote: (note: NoteRow) => void;
  onGenerateNote: (session: SessionRow, templateId: string) => void;
}

export default function SessionDetailScreen({
  patient,
  session,
  onBack,
  onViewNote,
  onGenerateNote,
}: SessionDetailScreenProps) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [templatePicker, setTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);

  const loadNotes = useCallback(async () => {
    try {
      const rows = await databaseService.getNotesForSession(session.id);
      setNotes(rows);
    } catch (err) {
      console.error('[SessionDetail] Failed to load notes:', err);
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const fmtDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  const fmtDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const handleGenerateNote = async () => {
    const tmpl = await noteTemplateService.getAll();
    setTemplates(tmpl);
    setTemplatePicker(true);
  };

  return (
    <SafeScreen>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={{padding: 4}}>
          <Text style={{fontSize: 24, color: '#1a1a1a'}}>{'<'}</Text>
        </TouchableOpacity>
        <View style={{flex: 1, marginLeft: 12}}>
          <Text style={s.headerTitle}>Recording Details</Text>
          <Text style={s.headerSub}>
            {patient.firstName} {patient.lastName} — {fmtDate(session.date)} — {fmtDuration(session.duration_sec)}
          </Text>
        </View>
      </View>

      <ScrollView style={{flex: 1}} contentContainerStyle={{padding: 16, paddingBottom: 32}}>
        <Text style={s.sectionLabel}>TRANSCRIPT</Text>
        <View style={s.transcriptBox}>
          <Text style={s.transcriptText}>
            {session.transcript_plain || 'No transcript available.'}
          </Text>
        </View>

        <Text style={[s.sectionLabel, {marginTop: 20}]}>
          NOTES ({notes.length})
        </Text>

        {loading ? (
          <ActivityIndicator size="small" color="#2563EB" style={{marginTop: 12}} />
        ) : notes.length === 0 ? (
          <Text style={s.emptyText}>
            No notes generated yet for this recording.
          </Text>
        ) : (
          notes.map(note => (
            <TouchableOpacity
              key={note.id}
              style={s.noteCard}
              onPress={() => onViewNote(note)}
              activeOpacity={0.7}>
              <View style={s.noteCardHeader}>
                <Text style={s.noteCardTitle}>
                  📄 {note.template_name || 'Note'}
                </Text>
                <Text style={s.noteCardDate}>{fmtDate(note.created_at)}</Text>
              </View>
              <Text style={s.noteCardPreview} numberOfLines={3}>
                {note.content}
              </Text>
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity
          style={s.genBtn}
          onPress={handleGenerateNote}
          activeOpacity={0.8}>
          <Text style={s.genBtnText}>+ Generate New Note</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={templatePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setTemplatePicker(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Select Note Format</Text>
              <TouchableOpacity onPress={() => setTemplatePicker(false)}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {templates.map(tmpl => (
              <TouchableOpacity
                key={tmpl.id}
                style={s.templateRow}
                onPress={() => {
                  setTemplatePicker(false);
                  onGenerateNote(session, tmpl.id);
                }}>
                <Text style={s.templateName}>{tmpl.name}</Text>
                <Text style={s.templateDesc}>{tmpl.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </SafeScreen>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: {fontSize: 18, fontWeight: '700', color: '#1E293B'},
  headerSub: {fontSize: 13, color: '#64748B', marginTop: 2},
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  transcriptBox: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  transcriptText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 22,
  },
  emptyText: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    paddingVertical: 16,
  },
  noteCard: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  noteCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  noteCardTitle: {fontSize: 14, fontWeight: '600', color: '#1E293B'},
  noteCardDate: {fontSize: 11, color: '#94A3B8'},
  noteCardPreview: {fontSize: 13, color: '#64748B', lineHeight: 20},
  genBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  genBtnText: {color: '#FFF', fontSize: 15, fontWeight: '600'},
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {fontSize: 18, fontWeight: '700', color: '#1E293B'},
  modalClose: {fontSize: 22, color: '#94A3B8', padding: 4},
  templateRow: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  templateName: {fontSize: 15, fontWeight: '600', color: '#1E293B'},
  templateDesc: {fontSize: 13, color: '#64748B', marginTop: 4},
});
