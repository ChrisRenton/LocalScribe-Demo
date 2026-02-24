import React, {useState} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import SafeScreen from '../components/SafeScreen';
import {NoteTemplate, NoteTemplateSection} from '../services/NoteTemplateService';

interface TemplateEditorScreenProps {
  template: NoteTemplate;
  onSave: (template: NoteTemplate) => void;
  onCancel: () => void;
}

export default function TemplateEditorScreen({
  template,
  onSave,
  onCancel,
}: TemplateEditorScreenProps) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [sections, setSections] = useState<NoteTemplateSection[]>(
    JSON.parse(JSON.stringify(template.sections)),
  );

  const updateSection = (
    index: number,
    field: keyof NoteTemplateSection,
    value: string,
  ) => {
    const updated = [...sections];
    updated[index] = {...updated[index], [field]: value};
    setSections(updated);
  };

  const addSection = () => {
    setSections([
      ...sections,
      {
        heading: `Section ${sections.length + 1}`,
        instructions: '',
        defaultContent: '',
      },
    ]);
  };

  const removeSection = (index: number) => {
    if (sections.length <= 1) {
      Alert.alert('Cannot Remove', 'A template must have at least one section.');
      return;
    }
    Alert.alert('Remove Section', `Remove "${sections[index].heading}"?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          const updated = [...sections];
          updated.splice(index, 1);
          setSections(updated);
        },
      },
    ]);
  };

  const moveSection = (index: number, direction: 'up' | 'down') => {
    const newIdx = direction === 'up' ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= sections.length) return;
    const updated = [...sections];
    [updated[index], updated[newIdx]] = [updated[newIdx], updated[index]];
    setSections(updated);
  };

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Missing Name', 'Please enter a template name.');
      return;
    }
    if (sections.some(sec => !sec.heading.trim())) {
      Alert.alert(
        'Missing Heading',
        'Each section must have a heading.',
      );
      return;
    }
    onSave({
      ...template,
      name: name.trim(),
      description: description.trim(),
      sections,
    });
  };

  const previewMarkdown = () => {
    let md = `# ${name}\n\n`;
    if (description) md += `> ${description}\n\n`;
    for (const sec of sections) {
      md += `## ${sec.heading}\n`;
      if (sec.instructions) md += `*${sec.instructions}*\n\n`;
      if (sec.defaultContent) md += `${sec.defaultContent}\n\n`;
    }
    Alert.alert('Markdown Preview', md);
  };

  return (
    <SafeScreen>
      <View style={s.header}>
        <TouchableOpacity onPress={onCancel} style={{padding: 4}}>
          <Text style={{fontSize: 16, color: '#FF3B30'}}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Edit Template</Text>
        <TouchableOpacity onPress={handleSave} style={{padding: 4}}>
          <Text style={{fontSize: 16, fontWeight: '600', color: '#007AFF'}}>
            Save
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{flex: 1}} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.fieldLabel}>TEMPLATE NAME</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. SOAP Note"
            placeholderTextColor="#ccc"
          />

          <Text style={[s.fieldLabel, {marginTop: 16}]}>DESCRIPTION</Text>
          <Text style={s.fieldHint}>
            A brief description of when to use this template.
          </Text>
          <TextInput
            style={[s.input, s.multilineInput]}
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. Standard format for most clinical encounters"
            placeholderTextColor="#ccc"
            multiline
          />
        </View>

        <View style={s.sectionsHeader}>
          <Text style={s.sectionTitle}>SECTIONS</Text>
          <Text style={s.fieldHint}>
            Each section becomes a heading in the generated note. The AI uses
            the instructions to know what content to include.
          </Text>
        </View>

        {sections.map((section, idx) => (
          <View key={idx} style={s.sectionCard}>
            <View style={s.sectionCardHeader}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                <Text style={s.sectionNumber}>{idx + 1}</Text>
                <View style={{flexDirection: 'row', gap: 4}}>
                  <TouchableOpacity
                    onPress={() => moveSection(idx, 'up')}
                    disabled={idx === 0}
                    style={[s.moveBtn, idx === 0 && {opacity: 0.3}]}>
                    <Text style={s.moveBtnText}>▲</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => moveSection(idx, 'down')}
                    disabled={idx === sections.length - 1}
                    style={[
                      s.moveBtn,
                      idx === sections.length - 1 && {opacity: 0.3},
                    ]}>
                    <Text style={s.moveBtnText}>▼</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TouchableOpacity onPress={() => removeSection(idx)}>
                <Text style={{color: '#DC2626', fontSize: 14, fontWeight: '500'}}>
                  Remove
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={s.fieldLabel}>HEADING</Text>
            <Text style={s.fieldHint}>
              This appears as the section title in the note (e.g. "Subjective",
              "Assessment").
            </Text>
            <TextInput
              style={s.input}
              value={section.heading}
              onChangeText={v => updateSection(idx, 'heading', v)}
              placeholder="Section heading"
              placeholderTextColor="#ccc"
            />

            <Text style={[s.fieldLabel, {marginTop: 14}]}>
              AI INSTRUCTIONS
            </Text>
            <Text style={s.fieldHint}>
              Tell the AI what to include in this section. Be specific about
              the type of information you want extracted from the transcript.
            </Text>
            <TextInput
              style={[s.input, s.multilineInput]}
              value={section.instructions}
              onChangeText={v => updateSection(idx, 'instructions', v)}
              placeholder="e.g. Document the patient's chief complaint and history of present illness..."
              placeholderTextColor="#ccc"
              multiline
            />

            <Text style={[s.fieldLabel, {marginTop: 14}]}>
              DEFAULT STRUCTURE (OPTIONAL)
            </Text>
            <Text style={s.fieldHint}>
              Pre-fill template with common sub-headings or placeholders. Uses
              markdown formatting (line breaks, bullets, etc).
            </Text>
            <TextInput
              style={[s.input, s.multilineInput, {minHeight: 100}]}
              value={section.defaultContent}
              onChangeText={v => updateSection(idx, 'defaultContent', v)}
              placeholder={'e.g.\nChief Complaint:\n\nHistory of Present Illness:\n- Onset:\n- Duration:'}
              placeholderTextColor="#ccc"
              multiline
            />
          </View>
        ))}

        <TouchableOpacity
          style={s.addSectionBtn}
          onPress={addSection}
          activeOpacity={0.8}>
          <Text style={s.addSectionBtnText}>+ Add Section</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.previewBtn}
          onPress={previewMarkdown}
          activeOpacity={0.8}>
          <Text style={s.previewBtnText}>Preview as Markdown</Text>
        </TouchableOpacity>

        <View style={{height: 40}} />
      </ScrollView>
    </SafeScreen>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  card: {
    margin: 20,
    marginBottom: 0,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  fieldHint: {
    fontSize: 12,
    color: '#999',
    lineHeight: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  sectionsHeader: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  sectionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  sectionNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FF3B30',
  },
  moveBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moveBtnText: {
    fontSize: 12,
    color: '#666',
  },
  addSectionBtn: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e5e5',
    borderStyle: 'dashed',
    padding: 16,
    alignItems: 'center',
  },
  addSectionBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
  },
  previewBtn: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 14,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  previewBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
});
