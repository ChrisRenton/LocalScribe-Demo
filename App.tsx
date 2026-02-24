import React, {useState, useEffect, useCallback} from 'react';
import {Alert, BackHandler} from 'react-native';
import {useLlama} from './src/hooks/useLlama';
import {useMedASR} from './src/hooks/useMedASR';
import {Patient, Screen, SessionFinishData} from './src/types';

// Services
import encryptionService from './src/services/EncryptionService';
import databaseService, {SessionRow, NoteRow} from './src/services/DatabaseService';
import audioStorageService from './src/services/AudioStorageService';
import noteGenService from './src/services/NoteGenerationService';

// Screens
import LoadingScreen from './src/screens/LoadingScreen';
import PatientListScreen from './src/screens/PatientListScreen';
import RecordingScreen from './src/screens/RecordingScreen';
import PatientDetailScreen from './src/screens/PatientDetailScreen';
import SessionDetailScreen from './src/screens/SessionDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import NoteScreen from './src/screens/NoteScreen';
import NoteViewScreen from './src/screens/NoteViewScreen';

type ExtendedScreen = Screen | 'settings';

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<ExtendedScreen>('loading');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteRow | null>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [demoAsset, setDemoAsset] = useState('GOOD_CONVO.wav');
  const [noteSessionData, setNoteSessionData] = useState<SessionFinishData | null>(null);

  const [encryptionStatus, setEncryptionStatus] = useState<
    'pending' | 'ready' | 'error'
  >('pending');
  const [encryptionError, setEncryptionError] = useState<string | null>(null);

  const {
    status: asrStatus,
    isReady: asrReady,
    error: asrError,
    initialize: initASR,
  } = useMedASR();

  const {
    complete: llmComplete,
    stopCompletion: llmStopCompletion,
    removeLoraAdapters: llmRemoveLora,
    applyLoraAdapters: llmApplyLora,
    isReady: llmReady,
    status: llmStatus,
    downloadProgress: llmDownloadProgress,
    loadProgress: llmLoadProgress,
    error: llmError,
  } = useLlama(true);

  useEffect(() => {
    (async () => {
      try {
        console.log('[App] Initializing encryption...');
        await encryptionService.initialize();

        console.log('[App] Initializing encrypted database...');
        await databaseService.initialize();

        console.log('[App] Initializing audio storage...');
        await audioStorageService.initialize();

        await databaseService.seedDemoPatients();

        setEncryptionStatus('ready');
        console.log('[App] All encryption services ready');

        const stats = await databaseService.getStats();
        console.log(
          `[App] DB stats: ${stats.patients} patients, ${stats.sessions} sessions, ${stats.auditEntries} audit entries`,
        );
      } catch (error: any) {
        console.error('[App] Encryption init failed:', error);
        setEncryptionStatus('error');
        setEncryptionError(error.message || 'Encryption initialization failed');
      }
    })();
  }, []);

  useEffect(() => {
    if (encryptionStatus === 'ready' && (llmStatus === 'loading' || llmStatus === 'ready')) {
      initASR();
    }
  }, [encryptionStatus, llmStatus, initASR]);

  const retryStuckNotes = useCallback(async () => {
    if (noteGenService.isActive()) return;
    try {
      const stuck = await databaseService.getStuckGeneratingNotes();
      if (stuck.length === 0) return;
      const note = stuck[0];
      const session = await databaseService.getSession(note.session_id);
      if (!session) return;
      const patient = await databaseService.getPatientById(note.patient_id);
      console.log(`[App] Retrying stuck note ${note.id} for session ${session.id}`);
      if (patient) {
        setSelectedPatient({
          id: patient.id,
          firstName: patient.first_name,
          lastName: patient.last_name,
          mrn: patient.mrn,
          dob: patient.dob,
        });
      }
      const data: SessionFinishData = {
        sessionId: session.id,
        durationSec: session.duration_sec,
        encryptedAudioPath: session.audio_file_path || undefined,
        timestampedTranscript: session.transcript_plain,
        plainTranscript: session.transcript_plain,
        templateId: note.template_id || 'soap',
        symptoms: [],
        medications: [],
      };
      setSelectedSession(session);
      setNoteSessionData(data);
      setScreen('note');
    } catch (e) {
      console.warn('[App] retryStuckNotes error:', e);
    }
  }, []);

  useEffect(() => {
    noteGenService.setCompletionCallback((sessionId) => {
      if (screen !== 'note') {
        Alert.alert(
          'Note Ready',
          'Your clinical note has been generated.',
          [{text: 'View Note', onPress: async () => {
            try {
              const notes = await databaseService.getNotesForSession(sessionId);
              const session = await databaseService.getSession(sessionId);
              if (notes.length > 0 && session) {
                const patient = await databaseService.getPatientById(session.patient_id);
                if (patient) {
                  setSelectedPatient({
                    id: patient.id,
                    firstName: patient.first_name,
                    lastName: patient.last_name,
                    mrn: patient.mrn,
                    dob: patient.dob,
                  });
                }
                setSelectedSession(session);
                setSelectedNote(notes[0]);
                setScreen('noteView');
              }
            } catch (e) {
              console.warn('[App] Failed to load completed note:', e);
            }
          }}, {text: 'Later', style: 'cancel'}],
        );
      }
      // After a note completes, check for any stuck 'generating' notes
      setTimeout(() => retryStuckNotes(), 3000);
    });
  }, [screen, retryStuckNotes]);

  useEffect(() => {
    if (asrReady && llmReady && encryptionStatus === 'ready' && !modelsReady) {
      const timer = setTimeout(() => {
        setModelsReady(true);
        setScreen('patients');
        Alert.alert(
          'Tech Demo',
          'This application is a tech demo and has not yet been fully validated for clinical use. Please do not rely on this system for medical decision-making or real patient care.',
          [{text: 'I Understand'}],
        );
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [asrReady, llmReady, encryptionStatus, modelsReady]);

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'noteView') {
        setSelectedNote(null);
        setScreen('sessionDetail');
        return true;
      }
      if (screen === 'note') {
        if (noteGenService.isActive()) {
          setScreen('patientDetail');
        } else {
          setNoteSessionData(null);
          setScreen(selectedSession ? 'sessionDetail' : 'patientDetail');
        }
        return true;
      }
      if (screen === 'sessionDetail') {
        setSelectedSession(null);
        setScreen('patientDetail');
        return true;
      }
      if (screen === 'recording') {
        setScreen(selectedPatient ? 'patientDetail' : 'patients');
        return true;
      }
      if (screen === 'patientDetail') {
        setScreen('patients');
        setSelectedPatient(null);
        return true;
      }
      if (screen === 'settings') {
        setScreen('patients');
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, [screen, selectedPatient, selectedSession]);

  // Navigation handlers
  const handleSelectPatient = useCallback((patient: Patient) => {
    setSelectedPatient(patient);
    setScreen('patientDetail');
  }, []);

  const handleStartRecording = useCallback(async (patient: Patient) => {
    if (noteGenService.isActive()) {
      console.log('[App] Aborting background note generation for new recording');
      await llmStopCompletion().catch(() => {});
      noteGenService.setStatus('error');
      await llmApplyLora().catch(() => {});
    }
    setDemoMode(false);
    setSelectedPatient(patient);
    setScreen('recording');
  }, [llmStopCompletion, llmApplyLora]);

  const handleStartDemo = useCallback(async (assetName?: string) => {
    if (noteGenService.isActive()) {
      console.log('[App] Aborting background note generation for demo');
      await llmStopCompletion().catch(() => {});
      noteGenService.setStatus('error');
      await llmApplyLora().catch(() => {});
    }
    setDemoMode(true);
    setDemoAsset(assetName || 'GOOD_CONVO.wav');
    setSelectedPatient({
      id: 'demo',
      firstName: 'Demo',
      lastName: 'Patient',
      mrn: 'DEMO-001',
      dob: '1985-03-15',
    });
    setScreen('recording');
  }, [llmStopCompletion, llmApplyLora]);

  const handleBackFromRecording = useCallback(() => {
    setScreen(selectedPatient ? 'patientDetail' : 'patients');
  }, [selectedPatient]);

  const handleFinishRecording = useCallback(
    async (
      action: 'save_note' | 'save' | 'discard',
      data?: SessionFinishData,
    ) => {
      if (action === 'save_note' && data) {
        console.log(`[App] Saving session + generating note (template: ${data.templateId})`);
        try {
          await databaseService.addSession({
            id: data.sessionId,
            patient_id: selectedPatient?.id || '',
            date: new Date().toISOString(),
            duration_sec: data.durationSec,
            transcript_plain: data.plainTranscript,
            annotated_xml: null,
            generated_report: null,
            audio_file_path: data.encryptedAudioPath || null,
            template_id: data.templateId || null,
          });
          console.log(`[App] Session saved: ${data.sessionId}`);
        } catch (err) {
          console.error('[App] Session save error:', err);
        }
        setNoteSessionData(data);
        setScreen('note');
        return;
      }

      if (action === 'save' && data) {
        console.log('[App] Saving session');
        try {
          await databaseService.addSession({
            id: data.sessionId,
            patient_id: selectedPatient?.id || '',
            date: new Date().toISOString(),
            duration_sec: data.durationSec,
            transcript_plain: data.plainTranscript,
            annotated_xml: null,
            generated_report: null,
            audio_file_path: data.encryptedAudioPath || null,
            template_id: null,
          });
          console.log(`[App] Session saved: ${data.sessionId}`);
        } catch (err) {
          console.error('[App] Session save error:', err);
        }
      } else {
        console.log('[App] Discarding session');
      }

      setScreen(selectedPatient ? 'patientDetail' : 'patients');
      // After finishing a recording, check for stuck notes
      setTimeout(() => retryStuckNotes(), 2000);
    },
    [selectedPatient, retryStuckNotes],
  );

  const handleViewSession = useCallback((session: SessionRow) => {
    setSelectedSession(session);
    setScreen('sessionDetail');
  }, []);

  const handleViewNote = useCallback((note: NoteRow, session?: SessionRow) => {
    setSelectedNote(note);
    if (session) setSelectedSession(session);
    setScreen('noteView');
  }, []);

  /**
   * Generate a note for an existing session. Builds SessionFinishData from
   * the DB row so NoteScreen can work with it.
   */
  const handleGenerateNoteForSession = useCallback((session: SessionRow, templateId?: string) => {
    const data: SessionFinishData = {
      sessionId: session.id,
      durationSec: session.duration_sec,
      encryptedAudioPath: session.audio_file_path || undefined,
      timestampedTranscript: session.transcript_plain,
      plainTranscript: session.transcript_plain,
      templateId: templateId || session.template_id || 'soap',
      symptoms: [],
      medications: [],
    };
    setSelectedSession(session);
    setNoteSessionData(data);
    setScreen('note');
  }, []);

  const handleBackFromDetail = useCallback(() => {
    setScreen('patients');
    setSelectedPatient(null);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setScreen('settings');
  }, []);

  if (screen === 'loading' || !modelsReady) {
    return (
      <LoadingScreen
        asrStatus={asrStatus}
        llmStatus={llmStatus}
        downloadProgress={llmDownloadProgress}
        loadProgress={llmLoadProgress}
        llmError={llmError || encryptionError}
        asrError={asrError}
        encryptionStatus={encryptionStatus}
      />
    );
  }

  if (screen === 'settings') {
    return <SettingsScreen onBack={() => setScreen('patients')} />;
  }

  if (screen === 'patients') {
    return (
      <PatientListScreen
        onSelectPatient={handleSelectPatient}
        onStartRecording={handleStartRecording}
        onOpenSettings={handleOpenSettings}
        onStartDemo={() => handleStartDemo()}
        onStartDictationDemo={() => handleStartDemo('GOOD_note.wav')}
      />
    );
  }

  if (screen === 'noteView' && selectedPatient && selectedNote && selectedSession) {
    return (
      <NoteViewScreen
        patient={selectedPatient}
        note={selectedNote}
        session={selectedSession}
        onBack={() => {
          setSelectedNote(null);
          setScreen('sessionDetail');
        }}
      />
    );
  }

  if (screen === 'note' && selectedPatient && noteSessionData && llmComplete) {
    return (
      <NoteScreen
        patient={selectedPatient}
        sessionData={noteSessionData}
        completeFn={llmComplete}
        stopCompletionFn={llmStopCompletion}
        removeLoraFn={llmRemoveLora}
        applyLoraFn={llmApplyLora}
        onBack={async () => {
          if (!noteGenService.isActive()) {
            await llmApplyLora().catch(() => {});
          }
          setNoteSessionData(null);
          setScreen(selectedSession ? 'sessionDetail' : 'patientDetail');
        }}
        onBackground={() => {
          setScreen('patientDetail');
        }}
      />
    );
  }

  if (screen === 'sessionDetail' && selectedPatient && selectedSession) {
    return (
      <SessionDetailScreen
        patient={selectedPatient}
        session={selectedSession}
        onBack={() => {
          setSelectedSession(null);
          setScreen('patientDetail');
        }}
        onViewNote={(note) => handleViewNote(note, selectedSession)}
        onGenerateNote={(session, templateId) => handleGenerateNoteForSession(session, templateId)}
      />
    );
  }

  if (screen === 'recording' && selectedPatient) {
    return (
      <RecordingScreen
        patient={selectedPatient}
        onBack={handleBackFromRecording}
        onFinish={handleFinishRecording}
        completeFn={llmReady ? llmComplete : null}
        demoMode={demoMode}
        demoAssetName={demoAsset}
      />
    );
  }

  if (screen === 'patientDetail' && selectedPatient) {
    return (
      <PatientDetailScreen
        patient={selectedPatient}
        onBack={handleBackFromDetail}
        onStartRecording={() => {
          setDemoMode(false);
          setScreen('recording');
        }}
        onViewSession={handleViewSession}
        onViewNote={(note, session) => {
          setSelectedSession(session);
          handleViewNote(note, session);
        }}
        onGenerateNote={(session) => handleGenerateNoteForSession(session)}
      />
    );
  }

  return (
    <PatientListScreen
      onSelectPatient={handleSelectPatient}
      onStartRecording={handleStartRecording}
      onOpenSettings={handleOpenSettings}
      onStartDemo={() => handleStartDemo()}
      onStartDictationDemo={() => handleStartDemo('GOOD_note.wav')}
    />
  );
}
