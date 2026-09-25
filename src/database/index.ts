import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'stats.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS installations (
    id TEXT PRIMARY KEY,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    server_software TEXT,
    minecraft_version TEXT,
    java_version TEXT,
    coretuff_version TEXT,
    is_folia INTEGER DEFAULT 0,
    is_online_mode INTEGER DEFAULT 1,
    player_count INTEGER DEFAULT 0,
    max_players INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    installation_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    player_count INTEGER DEFAULT 0,
    max_players INTEGER DEFAULT 0,
    server_software TEXT,
    minecraft_version TEXT,
    java_version TEXT,
    coretuff_version TEXT,
    is_folia INTEGER DEFAULT 0,
    is_online_mode INTEGER DEFAULT 1,
    tps REAL,
    FOREIGN KEY (installation_id) REFERENCES installations(id)
  );

  CREATE TABLE IF NOT EXISTS snapshot_modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL,
    module_name TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS snapshot_integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL,
    integration_name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots(timestamp);
  CREATE INDEX IF NOT EXISTS idx_snapshots_installation ON snapshots(installation_id);
  CREATE INDEX IF NOT EXISTS idx_installations_active ON installations(is_active);
  CREATE INDEX IF NOT EXISTS idx_installations_last_seen ON installations(last_seen);
`);

export default db;
