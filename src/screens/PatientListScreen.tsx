import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import SafeScreen from '../components/SafeScreen';
import {Patient} from '../types';
import MicIcon from '../components/MicIcon';
import GearIcon from '../components/GearIcon';
import AddPatientModal from '../components/AddPatientModal';
import databaseService, {PatientRow} from '../services/DatabaseService';

interface PatientListScreenProps {
  onSelectPatient: (patient: Patient) => void;
  onStartRecording: (patient: Patient) => void;
  onOpenSettings: () => void;
  onStartDemo: () => void;
  onStartDictationDemo: () => void;
}

function rowToPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    mrn: row.mrn,
    dob: row.dob,
  };
}

export default function PatientListScreen({
  onSelectPatient,
  onStartRecording,
  onOpenSettings,
  onStartDemo,
  onStartDictationDemo,
}: PatientListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);

  const loadPatients = useCallback(async () => {
    try {
      if (!databaseService.isReady()) return;
      const rows = await databaseService.getPatients();
      setPatients(rows.map(rowToPatient));
    } catch (e) {
      console.error('[PatientList] Failed to load patients:', e);
    }
  }, []);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  const filteredPatients = searchQuery
    ? patients.filter(p =>
        `${p.firstName} ${p.lastName} ${p.mrn}`
          .toLowerCase()
          .includes(searchQuery.toLowerCase()),
      )
    : patients;

  const handleAddPatient = async (data: {
    firstName: string;
    lastName: string;
    mrn: string;
    dob: string;
  }) => {
    try {
      const id = `patient_${Date.now()}`;
      await databaseService.addPatient({
        id,
        first_name: data.firstName,
        last_name: data.lastName,
        mrn: data.mrn,
        dob: data.dob,
      });
      setShowAddModal(false);
      await loadPatients(); // Refresh list
    } catch (e: any) {
      console.error('[PatientList] Failed to add patient:', e);
    }
  };

  return (
    <SafeScreen>
      <View style={s.header}>
        <View style={{flex: 1}}>
          <Text style={s.title}>LocalScribe — DEMO</Text>
          <Text style={s.subtitle}>On-Device Medical Scribe</Text>
        </View>
        <TouchableOpacity
          onPress={onOpenSettings}
          style={{padding: 8}}
          activeOpacity={0.7}>
          <GearIcon size={22} color="#666" />
        </TouchableOpacity>
      </View>

      <View style={s.searchBar}>
        <TextInput
          style={s.searchInput}
          placeholder="Search patients..."
          placeholderTextColor="#ccc"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <Text style={s.sectionLabel}>
        {searchQuery ? 'SEARCH RESULTS' : 'RECENT PATIENTS'}
      </Text>

      {/* Patient list */}
      <ScrollView style={{flex: 1, paddingHorizontal: 20}}>
        {filteredPatients.length === 0 ? (
          <View style={{alignItems: 'center', paddingVertical: 40}}>
            <Text style={{fontSize: 15, color: '#999'}}>
              {searchQuery ? 'No patients found' : 'No patients yet'}
            </Text>
          </View>
        ) : (
          filteredPatients.map(patient => (
            <View key={patient.id} style={s.card}>
              <TouchableOpacity
                style={s.cardContent}
                onPress={() => onSelectPatient(patient)}
                activeOpacity={0.7}>
                <View style={s.avatar}>
                  <Text style={s.avatarText}>
                    {patient.firstName.charAt(0)}
                    {patient.lastName.charAt(0)}
                  </Text>
                </View>
                <View style={{flex: 1}}>
                  <Text style={s.patientName}>
                    {patient.firstName} {patient.lastName}
                  </Text>
                  <Text style={s.patientMeta}>
                    MRN: {patient.mrn}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.micButton}
                onPress={() => onStartRecording(patient)}
                activeOpacity={0.8}>
                <View style={s.micCircle}>
                  <MicIcon size={20} color="#FF3B30" />
                </View>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>

      <View style={s.bottomActions}>
        <View style={{flexDirection: 'row', gap: 8}}>
          <TouchableOpacity
            style={[s.demoButton, {flex: 1}]}
            onPress={onStartDemo}
            activeOpacity={0.8}>
            <Text style={s.demoButtonText}>Demo Conversation</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.demoButton, {flex: 1}]}
            onPress={onStartDictationDemo}
            activeOpacity={0.8}>
            <Text style={s.demoButtonText}>Demo Dictation</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={s.addButton}
          onPress={() => setShowAddModal(true)}
          activeOpacity={0.8}>
          <Text style={s.addButtonText}>+ Add New Patient</Text>
        </TouchableOpacity>
      </View>

      {/* Add patient modal */}
      <AddPatientModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddPatient}
      />
    </SafeScreen>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  title: {
    fontSize: 24,
    fontWeight: '300',
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 2,
  },
  searchBar: {
    marginHorizontal: 20,
    marginVertical: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  searchInput: {
    paddingVertical: 12,
    color: '#1a1a1a',
    fontSize: 15,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    overflow: 'hidden',
  },
  cardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  patientName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  patientMeta: {
    fontSize: 13,
    color: '#999',
  },
  micButton: {
    paddingRight: 14,
    paddingVertical: 14,
  },
  micCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  bottomActions: {
    padding: 20,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  addButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  demoButton: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    marginBottom: 8,
  },
  demoButtonText: {
    color: '#4338CA',
    fontSize: 16,
    fontWeight: '600',
  },
});
