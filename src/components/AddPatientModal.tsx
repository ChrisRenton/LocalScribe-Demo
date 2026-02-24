import React, {useState} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';

interface AddPatientModalProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (patient: {
    firstName: string;
    lastName: string;
    mrn: string;
    dob: string;
  }) => void;
}

export default function AddPatientModal({
  visible,
  onClose,
  onAdd,
}: AddPatientModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mrn, setMrn] = useState('');
  const [dob, setDob] = useState('');
  const [error, setError] = useState('');

  const handleAdd = () => {
    setError('');
    if (!firstName.trim()) {
      setError('First name is required');
      return;
    }
    if (!lastName.trim()) {
      setError('Last name is required');
      return;
    }
    if (!mrn.trim()) {
      setError('MRN is required');
      return;
    }
    if (!dob.trim()) {
      setError('Date of birth is required');
      return;
    }

    onAdd({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      mrn: mrn.trim(),
      dob: dob.trim(),
    });

    setFirstName('');
    setLastName('');
    setMrn('');
    setDob('');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.overlay}>
        <View style={s.modal}>
          <View style={s.header}>
            <TouchableOpacity onPress={onClose}>
              <Text style={{fontSize: 16, color: '#FF3B30'}}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.headerTitle}>New Patient</Text>
            <TouchableOpacity onPress={handleAdd}>
              <Text style={{fontSize: 16, fontWeight: '600', color: '#007AFF'}}>
                Add
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{flex: 1}}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{padding: 20, gap: 16}}>
            {error ? (
              <Text style={s.error}>{error}</Text>
            ) : null}

            <View>
              <Text style={s.label}>FIRST NAME</Text>
              <TextInput
                style={s.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="John"
                placeholderTextColor="#ccc"
                autoCapitalize="words"
                autoFocus
              />
            </View>

            <View>
              <Text style={s.label}>LAST NAME</Text>
              <TextInput
                style={s.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Doe"
                placeholderTextColor="#ccc"
                autoCapitalize="words"
              />
            </View>

            <View>
              <Text style={s.label}>MRN (MEDICAL RECORD NUMBER)</Text>
              <TextInput
                style={s.input}
                value={mrn}
                onChangeText={setMrn}
                placeholder="MRN-006"
                placeholderTextColor="#ccc"
                autoCapitalize="characters"
              />
            </View>

            <View>
              <Text style={s.label}>DATE OF BIRTH</Text>
              <TextInput
                style={s.input}
                value={dob}
                onChangeText={setDob}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#ccc"
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: 400,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  error: {
    color: '#DC2626',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 4,
  },
});
