import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import SafeScreen from '../components/SafeScreen';
import {Patient} from '../types';
import databaseService, {SessionRow, NoteRow} from '../services/DatabaseService';

interface PatientDetailScreenProps {
  patient: Patient;
  onBack: () => void;
  onStartRecording: () => void;
  onViewSession: (session: SessionRow) => void;
  onViewNote: (note: NoteRow, session: SessionRow) => void;
  onGenerateNote: (session: SessionRow) => void;
}

type SessionWithNotes = SessionRow & {notes: NoteRow[]};

export default function PatientDetailScreen({
  patient,
  onBack,
  onStartRecording,
  onViewSession,
  onViewNote,
  onGenerateNote,
}: PatientDetailScreenProps) {
  const [sessions, setSessions] = useState<SessionWithNotes[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const rows = await databaseService.getSessionsForPatient(patient.id);
      const withNotes: SessionWithNotes[] = await Promise.all(
        rows.map(async (s) => {
          const notes = await databaseService.getNotesForSession(s.id);
          return {...s, notes};
        }),
      );
      setSessions(withNotes);
    } catch (err) {
      console.error('[PatientDetail] Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }, [patient.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  return (
    <SafeScreen>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={{padding: 4}}>
          <Text style={{fontSize: 24, color: '#1a1a1a'}}>{'<'}</Text>
        </TouchableOpacity>
        <View style={{flex: 1, marginLeft: 12}}>
          <Text style={s.patientName}>
            {patient.firstName} {patient.lastName}
          </Text>
          <Text style={s.patientMeta}>
            MRN: {patient.mrn} | DOB: {patient.dob}
          </Text>
        </View>
      </View>

      <ScrollView style={{flex: 1}}>
        <Text style={s.sectionLabel}>RECORDINGS & NOTES</Text>

        {loading ? (
          <View style={s.emptyState}>
            <ActivityIndicator size="small" color="#2563EB" />
          </View>
        ) : sessions.length === 0 ? (
          <View style={s.emptyState}>
            <Text style={{fontSize: 15, color: '#999', textAlign: 'center'}}>
              No recordings yet.{'\n'}Start a recording to create one.
            </Text>
          </View>
        ) : (
          sessions.map(session => (
            <TouchableOpacity
              key={session.id}
              style={s.sessionCard}
              onPress={() => onViewSession(session)}
              activeOpacity={0.7}>
              <View style={s.sessionHeader}>
                <Text style={s.sessionDate}>{fmtDate(session.date)}</Text>
                <Text style={s.sessionDuration}>
                  {fmtDuration(session.duration_sec)}
                </Text>
              </View>

              <Text style={s.transcriptPreview} numberOfLines={2}>
                {session.transcript_plain || 'No transcript available'}
              </Text>

              {session.notes.length > 0 ? (
                <View style={s.notesSection}>
                  <Text style={s.notesLabel}>
                    {session.notes.length} NOTE{session.notes.length > 1 ? 'S' : ''}
                  </Text>
                  {session.notes.map(note => (
                    <TouchableOpacity
                      key={note.id}
                      style={s.noteBadge}
                      onPress={() => onViewNote(note, session)}>
                      <Text style={s.noteBadgeIcon}>
                        {note.status === 'generating' ? '⏳' :
                         note.status === 'awaiting_confirm' ? '⚠️' :
                         note.status === 'confirmed' ? '✅' :
                         note.status === 'done' ? '📋' : '📄'}
                      </Text>
                      <Text style={s.noteBadgeText} numberOfLines={1}>
                        {note.template_name || 'Note'}
                      </Text>
                      {note.status === 'generating' ? (
                        <ActivityIndicator size="small" color="#2563EB" style={{marginLeft: 4}} />
                      ) : (
                        <Text style={s.noteBadgeDate}>
                          {fmtDate(note.created_at)}
                        </Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              <TouchableOpacity
                style={s.genNoteBtn}
                onPress={() => onGenerateNote(session)}>
                <Text style={s.genNoteBtnText}>+ Generate Note</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}

        <View style={{height: 20}} />
      </ScrollView>

      <View style={s.bottomActions}>
        <TouchableOpacity
          style={s.recordButton}
          onPress={onStartRecording}
          activeOpacity={0.8}>
          <View style={s.recordDot} />
          <Text style={s.recordButtonText}>New Recording</Text>
        </TouchableOpacity>
      </View>
    </SafeScreen>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  patientName: {fontSize: 18, fontWeight: '500', color: '#1a1a1a'},
  patientMeta: {fontSize: 13, color: '#999', marginTop: 2},
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  emptyState: {
    paddingVertical: 60,
    paddingHorizontal: 40,
    alignItems: 'center',
  },
  sessionCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sessionDate: {fontSize: 14, fontWeight: '500', color: '#1a1a1a'},
  sessionDuration: {fontSize: 13, color: '#999'},
  transcriptPreview: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 8,
  },
  notesSection: {
    marginTop: 4,
    marginBottom: 8,
  },
  notesLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2563EB',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  noteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F7FF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 4,
  },
  noteBadgeIcon: {fontSize: 14, marginRight: 8},
  noteBadgeText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#1E293B',
  },
  noteBadgeDate: {fontSize: 11, color: '#94A3B8', marginLeft: 8},
  genNoteBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  genNoteBtnText: {fontSize: 12, fontWeight: '600', color: '#2563EB'},
  bottomActions: {
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  recordButton: {
    backgroundColor: '#FF3B30',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF3B30',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  recordDot: {
    width: 20,
    height: 20,
    backgroundColor: '#fff',
    borderRadius: 10,
    marginRight: 10,
  },
  recordButtonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
});
