import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import SafeScreen from '../components/SafeScreen';
import noteTemplateService, {NoteTemplate} from '../services/NoteTemplateService';
import TemplateEditorScreen from './TemplateEditorScreen';

interface SettingsScreenProps {
  onBack: () => void;
}

export default function SettingsScreen({onBack}: SettingsScreenProps) {
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<NoteTemplate | null>(
    null,
  );
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const loadTemplates = useCallback(async () => {
    const all = await noteTemplateService.getAll();
    setTemplates([...all]);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleDuplicate = async (template: NoteTemplate) => {
    await noteTemplateService.duplicate(template.id);
    await loadTemplates();
  };

  const handleDelete = (template: NoteTemplate) => {
    if (template.isDefault) {
      Alert.alert(
        'Cannot Delete',
        'Default templates cannot be deleted. You can duplicate and modify them instead.',
      );
      return;
    }
    Alert.alert(
      'Delete Template',
      `Are you sure you want to delete "${template.name}"?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await noteTemplateService.remove(template.id);
            await loadTemplates();
          },
        },
      ],
    );
  };

  const handleSaveTemplate = async (template: NoteTemplate) => {
    if (isCreatingNew) {
      await noteTemplateService.add({
        name: template.name,
        description: template.description,
        sections: template.sections,
        isDefault: false,
      });
    } else {
      await noteTemplateService.update(template.id, {
        name: template.name,
        description: template.description,
        sections: template.sections,
      });
    }
    setEditingTemplate(null);
    setIsCreatingNew(false);
    await loadTemplates();
  };

  const handleCreateNew = () => {
    setIsCreatingNew(true);
    setEditingTemplate({
      id: '',
      name: 'New Template',
      description: '',
      sections: [
        {
          heading: 'Section 1',
          instructions: 'Describe what should go in this section.',
          defaultContent: '',
        },
      ],
      isDefault: false,
      createdAt: '',
      updatedAt: '',
    });
  };

  if (editingTemplate) {
    return (
      <TemplateEditorScreen
        template={editingTemplate}
        onSave={handleSaveTemplate}
        onCancel={() => {
          setEditingTemplate(null);
          setIsCreatingNew(false);
        }}
      />
    );
  }

  return (
    <SafeScreen>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={{padding: 4}}>
          <Text style={{fontSize: 24, color: '#1a1a1a'}}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Settings</Text>
        <View style={{width: 32}} />
      </View>

      <ScrollView style={{flex: 1}}>
        {/* Note Templates section */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>NOTE TEMPLATES</Text>
          <Text style={s.sectionDesc}>
            Templates define the structure of clinical notes generated from your
            recordings. Each section includes instructions that guide the AI.
          </Text>
        </View>

        {templates.map(template => (
          <View key={template.id} style={s.templateCard}>
            <TouchableOpacity
              style={s.templateContent}
              onPress={() => setEditingTemplate(template)}
              activeOpacity={0.7}>
              <View style={{flex: 1}}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                  <Text style={s.templateName}>{template.name}</Text>
                  {template.isDefault && (
                    <View style={s.defaultBadge}>
                      <Text style={s.defaultBadgeText}>DEFAULT</Text>
                    </View>
                  )}
                </View>
                <Text style={s.templateDesc} numberOfLines={2}>
                  {template.description}
                </Text>
                <Text style={s.templateMeta}>
                  {template.sections.length} section
                  {template.sections.length !== 1 ? 's' : ''}
                </Text>
              </View>
              <Text style={{color: '#ccc', fontSize: 18}}>{'>'}</Text>
            </TouchableOpacity>

            {/* Actions row */}
            <View style={s.actionsRow}>
              <TouchableOpacity
                style={s.actionBtn}
                onPress={() => handleDuplicate(template)}>
                <Text style={s.actionBtnText}>Duplicate</Text>
              </TouchableOpacity>
              {!template.isDefault && (
                <TouchableOpacity
                  style={[s.actionBtn, {borderColor: '#FFD2D2'}]}
                  onPress={() => handleDelete(template)}>
                  <Text style={[s.actionBtnText, {color: '#DC2626'}]}>
                    Delete
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}

        {/* Add new template */}
        <TouchableOpacity
          style={s.addTemplateBtn}
          onPress={handleCreateNew}
          activeOpacity={0.8}>
          <Text style={s.addTemplateBtnText}>+ Create New Template</Text>
        </TouchableOpacity>

        {/* Reset to defaults */}
        <TouchableOpacity
          style={s.resetBtn}
          onPress={() =>
            Alert.alert(
              'Reset Templates',
              'This will restore all default templates and remove any custom ones. Continue?',
              [
                {text: 'Cancel', style: 'cancel'},
                {
                  text: 'Reset',
                  style: 'destructive',
                  onPress: async () => {
                    await noteTemplateService.resetToDefaults();
                    await loadTemplates();
                  },
                },
              ],
            )
          }>
          <Text style={s.resetBtnText}>Reset to Defaults</Text>
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
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  sectionDesc: {
    fontSize: 14,
    color: '#999',
    lineHeight: 20,
  },
  templateCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    overflow: 'hidden',
  },
  templateContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  templateName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  defaultBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  defaultBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2E7D32',
  },
  templateDesc: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
    lineHeight: 18,
  },
  templateMeta: {
    fontSize: 12,
    color: '#999',
    marginTop: 6,
  },
  actionsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#666',
  },
  addTemplateBtn: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  addTemplateBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  resetBtn: {
    marginHorizontal: 20,
    alignItems: 'center',
    padding: 12,
  },
  resetBtnText: {
    fontSize: 14,
    color: '#999',
  },
});
