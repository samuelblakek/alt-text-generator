import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
  status TEXT NOT NULL,
  image_count INTEGER NOT NULL DEFAULT 0,
  done_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS image_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  image_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  existing_description TEXT,
  sort_order INTEGER NOT NULL,
  slot_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  generated_alt_text TEXT,
  edited_alt_text TEXT,
  validation_flags TEXT,
  error TEXT,
  reviewer_hint TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_image_records_job_id ON image_records(job_id);
`;

export function createDb(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  try {
    db.exec('ALTER TABLE image_records ADD COLUMN reviewer_hint TEXT');
  } catch {
    // Column already exists (either from SCHEMA on a fresh db, or a prior migration), so this is safe to ignore.
  }
  try {
    db.exec("ALTER TABLE jobs ADD COLUMN model TEXT NOT NULL DEFAULT 'gemini-3.5-flash'");
  } catch {
    // Column already exists, so this is safe to ignore.
  }
  return db;
}

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DEFAULT_DB_PATH = path.join(dataDir, 'alt-text-generator.db');

export const db = createDb(DEFAULT_DB_PATH);
