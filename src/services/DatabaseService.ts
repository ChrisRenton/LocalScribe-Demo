/**
 * DatabaseService - HIPAA-compliant encrypted SQLite database
 *
 * Uses OP-SQLite with SQLCipher (AES-256) for transparent encryption
 * of all patient data, transcripts, annotations, and reports.
 */

import {open, type DB} from '@op-engineering/op-sqlite';
import encryptionService from './EncryptionService';

// ── Types ──────────────────────────────────────────────────────────

export interface PatientRow {
  id: string;
  first_name: string;
  last_name: string;
  mrn: string;
  dob: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  patient_id: string;
  date: string;
  duration_sec: number;
  transcript_plain: string;
  annotated_xml: string | null;
  generated_report: string | null;
  audio_file_path: string | null;
  template_id: string | null;
  created_at: string;
}

export interface TimestampRow {
  id: number;
  session_id: string;
  chunk_index: number;
  start_sec: number;
  end_sec: number;
  text: string;
}

export type NoteStatus = 'generating' | 'awaiting_confirm' | 'confirmed' | 'done';

export interface NoteRow {
  id: string;
  session_id: string;
  template_id: string | null;
  template_name: string;
  content: string;
  status: NoteStatus;
  created_at: string;
  updated_at: string;
}

export interface AuditRow {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string | null;
  timestamp: string;
}

// ── Service ────────────────────────────────────────────────────────

class DatabaseService {
  private db: DB | null = null;
  private ready = false;

  /**
   * Open the encrypted database and create tables if needed.
   * Must be called after EncryptionService.initialize().
   */
  async initialize(): Promise<void> {
    if (this.ready) return;

    const encKey = encryptionService.getDatabaseKey();

    this.db = open({
      name: 'localscribe.db',
      encryptionKey: encKey,
    });

    await this.createTables();
    await this.migrateReportsToNotes();
    this.ready = true;
    console.log('[Database] Encrypted database initialized (AES-256 SQLCipher)');
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('DB not open');

    // Patients
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        mrn TEXT UNIQUE NOT NULL,
        dob TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Recording sessions
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        duration_sec INTEGER NOT NULL DEFAULT 0,
        transcript_plain TEXT NOT NULL DEFAULT '',
        annotated_xml TEXT,
        generated_report TEXT,
        audio_file_path TEXT,
        template_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // ASR chunk timestamps (for audio scrubbing)
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS timestamps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        start_sec REAL NOT NULL,
        end_sec REAL NOT NULL,
        text TEXT NOT NULL
      )
    `);

    // Notes (multiple per session, different templates)
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        template_id TEXT,
        template_name TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'generating',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Migrate: add status column if missing (existing DBs)
    try {
      await this.db.execute(`ALTER TABLE notes ADD COLUMN status TEXT NOT NULL DEFAULT 'awaiting_confirm'`);
    } catch (_) { /* column already exists */ }

    // HIPAA audit log
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        details TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Indices
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_sessions_patient ON sessions(patient_id)`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_timestamps_session ON timestamps(session_id)`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id)`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)`,
    );
  }

  /**
   * One-time migration: move any existing generated_report data from
   * sessions table into the new notes table.
   */
  private async migrateReportsToNotes(): Promise<void> {
    if (!this.db) return;
    const result = await this.db.execute(
      `SELECT id, generated_report, template_id FROM sessions
       WHERE generated_report IS NOT NULL AND generated_report != ''
       AND id NOT IN (SELECT session_id FROM notes)`,
    );
    const rows = (result.rows || []) as SessionRow[];
    for (const row of rows) {
      const noteId = `migrated_${row.id}`;
      await this.db.execute(
        `INSERT OR IGNORE INTO notes (id, session_id, template_id, template_name, content) VALUES (?, ?, ?, ?, ?)`,
        [noteId, row.id, row.template_id || null, 'Migrated Report', row.generated_report],
      );
    }
    if (rows.length > 0) {
      console.log(`[Database] Migrated ${rows.length} report(s) to notes table`);
    }
  }

  // ── Audit logging ────────────────────────────────────────────────

  private async audit(
    action: string,
    entityType: string,
    entityId: string,
    details?: string,
  ): Promise<void> {
    if (!this.db) return;
    await this.db.execute(
      `INSERT INTO audit_log (action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)`,
      [action, entityType, entityId, details || null],
    );
  }

  // ── Patients ─────────────────────────────────────────────────────

  async addPatient(
    patient: Omit<PatientRow, 'created_at' | 'updated_at'>,
  ): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');
    await this.db.execute(
      `INSERT INTO patients (id, first_name, last_name, mrn, dob) VALUES (?, ?, ?, ?, ?)`,
      [patient.id, patient.first_name, patient.last_name, patient.mrn, patient.dob],
    );
    await this.audit('CREATE', 'patient', patient.id);
  }

  async getPatients(): Promise<PatientRow[]> {
    if (!this.db) throw new Error('DB not initialized');
    const result = await this.db.execute(
      'SELECT * FROM patients ORDER BY updated_at DESC',
    );
    return (result.rows || []) as PatientRow[];
  }

  async getPatientById(id: string): Promise<PatientRow | null> {
    if (!this.db) throw new Error('DB not initialized');
    const result = await this.db.execute(
      'SELECT * FROM patients WHERE id = ?',
      [id],
    );
    const rows = result.rows || [];
    if (rows.length === 0) return null;
    await this.audit('READ', 'patient', id);
    return rows[0] as PatientRow;
  }

  async updatePatient(
    id: string,
    updates: Partial<Pick<PatientRow, 'first_name' | 'last_name' | 'mrn' | 'dob'>>,
  ): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.first_name !== undefined) {
      fields.push('first_name = ?');
      values.push(updates.first_name);
    }
    if (updates.last_name !== undefined) {
      fields.push('last_name = ?');
      values.push(updates.last_name);
    }
    if (updates.mrn !== undefined) {
      fields.push('mrn = ?');
      values.push(updates.mrn);
    }
    if (updates.dob !== undefined) {
      fields.push('dob = ?');
      values.push(updates.dob);
    }
    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    await this.db.execute(
      `UPDATE patients SET ${fields.join(', ')} WHERE id = ?`,
      values,
    );
    await this.audit('UPDATE', 'patient', id, JSON.stringify(Object.keys(updates)));
  }

  async deletePatient(id: string): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');
    await this.db.execute('DELETE FROM patients WHERE id = ?', [id]);
    await this.audit('DELETE', 'patient', id);
  }

  async searchPatients(query: string): Promise<PatientRow[]> {
    if (!this.db) throw new Error('DB not initialized');
    const like = `%${query}%`;
    const result = await this.db.execute(
      `SELECT * FROM patients WHERE first_name LIKE ? OR last_name LIKE ? OR mrn LIKE ? ORDER BY updated_at DESC`,
      [like, like, like],
    );
    return (result.rows || []) as PatientRow[];
  }

  // ── Sessions ─────────────────────────────────────────────────────

  async addSession(session: Omit<SessionRow, 'created_at'>): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');
    await this.db.execute(
      `INSERT INTO sessions (id, patient_id, date, duration_sec, transcript_plain, annotated_xml, generated_report, audio_file_path, template_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.patient_id,
        session.date,
        session.duration_sec,
        session.transcript_plain,
        session.annotated_xml || null,
        session.generated_report || null,
        session.audio_file_path || null,
        session.template_id || null,
      ],
    );
    await this.audit('CREATE', 'session', session.id, `patient:${session.patient_id}`);
  }

  async getSessionsForPatient(patientId: string): Promise<SessionRow[]> {
    if (!this.db) throw new Error('DB not initialized');
    const result = await this.db.execute(
      'SELECT * FROM sessions WHERE patient_id = ? ORDER BY date DESC',
      [patientId],
    );
    await this.audit('READ', 'sessions_list', patientId);
    return (result.rows || []) as SessionRow[];
  }

  async getSession(id: string): Promise<SessionRow | null> {
    if (!this.db) throw new Error('DB not initialized');
    const result = await this.db.execute(
      'SELECT * FROM sessions WHERE id = ?',
      [id],
    );
    const rows = result.rows || [];
    if (rows.length === 0) return null;
    await this.audit('READ', 'session', id);
    return rows[0] as SessionRow;
  }

  async updateSession(
    id: string,
    updates: Partial<
      Pick<
        SessionRow,
        | 'transcript_plain'
        | 'annotated_xml'
        | 'generated_report'
        | 'duration_sec'
        | 'audio_file_path'
        | 'template_id'
      >
    >,
  ): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (fields.length === 0) return;
    values.push(id);
    await this.db.execute(
      `UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`,
      values,
    );
    await this.audit('UPDATE', 'session', id, JSON.stringify(Object.keys(updates)));
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');
    await this.db.execute('DELETE FROM sessions WHERE id = ?', [id]);
    await this.audit('DELETE', 'session', id);
  }

  // ── Notes ────────────────────────────────────────────────────────

  async addNote(note: Omit<NoteRow, 'created_at' | 'updated_at'>): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');
    await this.db.execute(
      `INSERT INTO notes (id, session_id, template_id, template_name, content, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [note.id, note.session_id, note.template_id || null, note.template_name, note.content, note.status || 'generating'],
    );
    await this.audit('CREATE', 'note', note.id, `session:${note.session_id}`);
  }

  async getNotesForSession(sessionId: string): Promise<NoteRow[]> {
    if (!this.db) throw new Error('DB not initialized');
    const result = await this.db.execute(
      'SELECT * FROM notes WHERE session_id = ? ORDER BY created_at DESC',
      [sessionId],
    );
    return (result.rows || []) as NoteRow[];
  }

  async getNotesForPatient(patientId: string): Promise<(NoteRow & {session_date: string})[]> {
    if (!this.db) throw new Error('DB not initialized');
    const result = await this.db.execute(
      `SELECT n.*, s.date as session_date FROM notes n
       JOIN sessions s ON n.session_id = s.id
       WHERE s.patient_id = ? ORDER BY n.created_at DESC`,
      [patientId],
    );
    return (result.rows || []) as (NoteRow & {session_date: string})[];
  }

  async getStuckGeneratingNotes(): Promise<(NoteRow & {patient_id: string})[]> {
    if (!this.db) throw new Error('DB not initialized');
    const result = await this.db.execute(
      `SELECT n.*, s.patient_id FROM notes n
       JOIN sessions s ON n.session_id = s.id
       WHERE n.status = 'generating' ORDER BY n.created_at ASC LIMIT 1`,
    );
    return (result.rows || []) as (NoteRow & {patient_id: string})[];
  }

  async updateNoteStatus(id: string, status: NoteStatus): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');
    await this.db.execute(
      `UPDATE notes SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, id],
    );
    await this.audit('UPDATE', 'note', id, `status:${status}`);
  }

  async updateNote(id: string, content: string): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');
    await this.db.execute(
      `UPDATE notes SET content = ?, updated_at = datetime('now') WHERE id = ?`,
      [content, id],
    );
    await this.audit('UPDATE', 'note', id);
  }

  async deleteNote(id: string): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');
    await this.db.execute('DELETE FROM notes WHERE id = ?', [id]);
    await this.audit('DELETE', 'note', id);
  }

  // ── Timestamps ───────────────────────────────────────────────────

  async addTimestamp(ts: Omit<TimestampRow, 'id'>): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');
    await this.db.execute(
      `INSERT INTO timestamps (session_id, chunk_index, start_sec, end_sec, text)
       VALUES (?, ?, ?, ?, ?)`,
      [ts.session_id, ts.chunk_index, ts.start_sec, ts.end_sec, ts.text],
    );
  }

  async addTimestampsBatch(timestamps: Omit<TimestampRow, 'id'>[]): Promise<void> {
    if (!this.db || timestamps.length === 0) return;
    const commands = timestamps.map(ts => [
      'INSERT INTO timestamps (session_id, chunk_index, start_sec, end_sec, text) VALUES (?, ?, ?, ?, ?)',
      [ts.session_id, ts.chunk_index, ts.start_sec, ts.end_sec, ts.text],
    ]);
    await this.db.executeBatch(commands as any);
  }

  async getTimestampsForSession(sessionId: string): Promise<TimestampRow[]> {
    if (!this.db) throw new Error('DB not initialized');
    const result = await this.db.execute(
      'SELECT * FROM timestamps WHERE session_id = ? ORDER BY chunk_index',
      [sessionId],
    );
    return (result.rows || []) as TimestampRow[];
  }

  // ── Audit Log ────────────────────────────────────────────────────

  async getAuditLog(limit = 100): Promise<AuditRow[]> {
    if (!this.db) throw new Error('DB not initialized');
    const result = await this.db.execute(
      'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?',
      [limit],
    );
    return (result.rows || []) as AuditRow[];
  }

  // ── Utility ──────────────────────────────────────────────────────

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Seed demo patients if the database is empty (first launch only).
   */
  async seedDemoPatients(): Promise<boolean> {
    if (!this.db) throw new Error('DB not initialized');
    const result = await this.db.execute('SELECT COUNT(*) as count FROM patients');
    const count = (result.rows?.[0] as any)?.count || 0;
    if (count > 0) {
      console.log(`[Database] Already have ${count} patients, skipping seed`);
      return false;
    }

    const demoPatients = [
      {id: 'demo_1', first_name: 'James', last_name: 'Wilson', mrn: 'MRN-001', dob: '1965-03-15'},
      {id: 'demo_2', first_name: 'Maria', last_name: 'Garcia', mrn: 'MRN-002', dob: '1978-11-22'},
      {id: 'demo_3', first_name: 'Robert', last_name: 'Chen', mrn: 'MRN-003', dob: '1952-07-08'},
      {id: 'demo_4', first_name: 'Sarah', last_name: 'Patel', mrn: 'MRN-004', dob: '1990-01-30'},
      {id: 'demo_5', first_name: 'David', last_name: 'Thompson', mrn: 'MRN-005', dob: '1948-09-12'},
    ];

    for (const p of demoPatients) {
      await this.addPatient(p);
    }
    console.log(`[Database] Seeded ${demoPatients.length} demo patients`);
    return true;
  }

  async getStats(): Promise<{
    patients: number;
    sessions: number;
    auditEntries: number;
  }> {
    if (!this.db) throw new Error('DB not initialized');
    const p = await this.db.execute('SELECT COUNT(*) as count FROM patients');
    const s = await this.db.execute('SELECT COUNT(*) as count FROM sessions');
    const a = await this.db.execute('SELECT COUNT(*) as count FROM audit_log');
    return {
      patients: (p.rows?.[0] as any)?.count || 0,
      sessions: (s.rows?.[0] as any)?.count || 0,
      auditEntries: (a.rows?.[0] as any)?.count || 0,
    };
  }
}

export default new DatabaseService();
