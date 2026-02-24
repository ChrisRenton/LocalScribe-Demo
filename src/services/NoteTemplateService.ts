import RNFS from 'react-native-fs';

export interface NoteTemplateSection {
  heading: string;
  instructions: string; // What to put in this section
  defaultContent: string; // Starter text/placeholders
}

export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  sections: NoteTemplateSection[];
  isDefault: boolean; // true for built-in templates
  createdAt: string;
  updatedAt: string;
}

const TEMPLATES_FILE = `${RNFS.DocumentDirectoryPath}/note_templates.json`;

// ── Default templates ──────────────────────────────────────────────

const DEFAULT_TEMPLATES: NoteTemplate[] = [
  {
    id: 'soap',
    name: 'SOAP Note',
    description:
      'Standard Subjective-Objective-Assessment-Plan format used for most clinical encounters.',
    sections: [
      {
        heading: 'Subjective',
        instructions:
          'What the patient SAID: their complaints, symptoms, history, onset, duration, severity, medications they report taking, allergies. Only what the patient stated.',
        defaultContent: '',
      },
      {
        heading: 'Objective',
        instructions:
          'What was OBSERVED or MEASURED: vitals, physical exam findings, test results. Only if explicitly stated in the transcript. Use dash (-) if none mentioned.',
        defaultContent: '',
      },
      {
        heading: 'Assessment',
        instructions:
          'Clinical impression or diagnosis discussed during the encounter. Only include what was explicitly stated. Use dash (-) if none discussed.',
        defaultContent: '',
      },
      {
        heading: 'Plan',
        instructions:
          'Treatment discussed: medications prescribed, tests ordered, referrals, follow-up instructions. Only what was explicitly discussed. Use dash (-) if none.',
        defaultContent: '',
      },
    ],
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'hp',
    name: 'H&P Note',
    description:
      'Comprehensive History and Physical examination note, typically used for new patient encounters or hospital admissions.',
    sections: [
      {
        heading: 'Chief Complaint',
        instructions: 'Brief statement of the primary reason for the visit in the patient\'s own words.',
        defaultContent: '',
      },
      {
        heading: 'History of Present Illness',
        instructions:
          'Detailed chronological narrative of the presenting problem. Include onset, location, duration, characteristics, aggravating/alleviating factors, radiation, timing, and severity (OLDCARTS).',
        defaultContent:
          'Onset:\nLocation:\nDuration:\nCharacteristics:\nAggravating factors:\nRelieving factors:\nTiming:\nSeverity (1-10):',
      },
      {
        heading: 'Past Medical History',
        instructions: 'List significant past illnesses, surgeries, hospitalizations.',
        defaultContent: 'Medical conditions:\n\nSurgical history:\n\nHospitalizations:',
      },
      {
        heading: 'Medications',
        instructions: 'List current medications with dose and frequency.',
        defaultContent: '',
      },
      {
        heading: 'Allergies',
        instructions: 'Document drug allergies and reactions.',
        defaultContent: '',
      },
      {
        heading: 'Social History',
        instructions: 'Tobacco, alcohol, drug use, occupation, living situation.',
        defaultContent: 'Tobacco:\nAlcohol:\nOccupation:\nLiving situation:',
      },
      {
        heading: 'Family History',
        instructions: 'Relevant family medical history.',
        defaultContent: '',
      },
      {
        heading: 'Review of Systems',
        instructions: 'Systematic review of each organ system.',
        defaultContent:
          'Constitutional:\nHEENT:\nCardiovascular:\nRespiratory:\nGI:\nGU:\nMusculoskeletal:\nNeurological:\nPsychiatric:\nSkin:',
      },
      {
        heading: 'Physical Examination',
        instructions: 'Findings from physical exam.',
        defaultContent:
          'General:\nVitals:\nHEENT:\nNeck:\nLungs:\nCardiovascular:\nAbdomen:\nExtremities:\nNeurological:',
      },
      {
        heading: 'Assessment & Plan',
        instructions: 'Summary diagnosis and treatment plan.',
        defaultContent: 'Assessment:\n\nPlan:',
      },
    ],
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'progress',
    name: 'Progress Note',
    description:
      'Concise note for follow-up visits documenting interval changes and ongoing management.',
    sections: [
      {
        heading: 'Interval History',
        instructions:
          'What has changed since the last visit? New symptoms, response to treatment, side effects.',
        defaultContent: 'Since last visit:\n\nResponse to treatment:\n\nNew symptoms:',
      },
      {
        heading: 'Current Medications',
        instructions: 'List current medications and any changes.',
        defaultContent: '',
      },
      {
        heading: 'Examination',
        instructions: 'Focused physical exam relevant to the conditions being followed.',
        defaultContent: 'Vitals:\n\nFocused exam:',
      },
      {
        heading: 'Assessment',
        instructions: 'Current status of each active problem.',
        defaultContent: 'Problem list:\n1.\n2.',
      },
      {
        heading: 'Plan',
        instructions: 'Changes to treatment, new orders, follow-up schedule.',
        defaultContent: 'Medication changes:\n\nNew orders:\n\nFollow-up:',
      },
    ],
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'brief',
    name: 'Brief Summary',
    description:
      'A short summary note for quick documentation. Useful for brief encounters, phone calls, or simple follow-ups.',
    sections: [
      {
        heading: 'Summary',
        instructions:
          'Provide a concise summary of the encounter including the reason for visit, key findings, and actions taken.',
        defaultContent:
          'Reason for encounter:\n\nKey findings:\n\nActions taken:\n\nFollow-up:',
      },
    ],
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
];

// ── Service ────────────────────────────────────────────────────────

class NoteTemplateService {
  private templates: NoteTemplate[] = [];
  private loaded = false;

  async load(): Promise<NoteTemplate[]> {
    if (this.loaded) return this.templates;

    try {
      const exists = await RNFS.exists(TEMPLATES_FILE);
      if (exists) {
        const json = await RNFS.readFile(TEMPLATES_FILE, 'utf8');
        this.templates = JSON.parse(json);
      } else {
        this.templates = [...DEFAULT_TEMPLATES];
        await this.save();
      }
    } catch {
      this.templates = [...DEFAULT_TEMPLATES];
    }

    this.loaded = true;
    return this.templates;
  }

  private async save(): Promise<void> {
    await RNFS.writeFile(TEMPLATES_FILE, JSON.stringify(this.templates, null, 2), 'utf8');
  }

  async getAll(): Promise<NoteTemplate[]> {
    return this.load();
  }

  async getById(id: string): Promise<NoteTemplate | undefined> {
    const all = await this.load();
    return all.find(t => t.id === id);
  }

  async add(template: Omit<NoteTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<NoteTemplate> {
    await this.load();
    const newTemplate: NoteTemplate = {
      ...template,
      id: `custom_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.templates.push(newTemplate);
    await this.save();
    return newTemplate;
  }

  async update(id: string, updates: Partial<NoteTemplate>): Promise<void> {
    await this.load();
    const idx = this.templates.findIndex(t => t.id === id);
    if (idx >= 0) {
      this.templates[idx] = {
        ...this.templates[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      await this.save();
    }
  }

  async remove(id: string): Promise<void> {
    await this.load();
    this.templates = this.templates.filter(t => t.id !== id);
    await this.save();
  }

  async duplicate(id: string): Promise<NoteTemplate | null> {
    await this.load();
    const source = this.templates.find(t => t.id === id);
    if (!source) return null;

    const copy: NoteTemplate = {
      ...JSON.parse(JSON.stringify(source)),
      id: `custom_${Date.now()}`,
      name: `${source.name} (Copy)`,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.templates.push(copy);
    await this.save();
    return copy;
  }

  /**
   * Convert a NoteTemplate into a markdown system prompt instruction
   */
  toMarkdownPrompt(template: NoteTemplate): string {
    let md = `Generate a **${template.name}**.\n\nSECTION GUIDE (use ## for each heading in the output):\n`;
    for (const section of template.sections) {
      md += `- **${section.heading}**: ${section.instructions}\n`;
    }
    md += '\n';
    return md;
  }

  async resetToDefaults(): Promise<void> {
    this.templates = [...DEFAULT_TEMPLATES];
    await this.save();
  }
}

export default new NoteTemplateService();
