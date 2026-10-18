const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new DatabaseSync(path.join(config.dataDir, 'anket.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- Model numarası (MDL-0001) id üzerinden üretilir; AUTOINCREMENT silinen numaraların
-- tekrar kullanılmasını engeller.
CREATE TABLE IF NOT EXISTS models (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  ana_kumas      TEXT NOT NULL,
  icerik         TEXT NOT NULL,
  buyer_grup     TEXT,
  merch_alt_grup TEXT,
  klasman        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS model_images (
  id         INTEGER PRIMARY KEY,
  model_id   INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS surveys (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  closes_at      TEXT NOT NULL,          -- UTC ISO
  result_emails  TEXT NOT NULL,          -- virgülle ayrılmış
  closed_at      TEXT,
  result_sent_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS survey_models (
  survey_id  INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  model_id   INTEGER NOT NULL REFERENCES models(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (survey_id, model_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id           INTEGER PRIMARY KEY,
  survey_id    INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  token        TEXT NOT NULL UNIQUE,
  sent_at      TEXT,
  send_error   TEXT,
  completed_at TEXT,
  UNIQUE (survey_id, email)
);

-- score NULL ve not_my_style = 1 ise "Tarzım değil": ortalamaya katılmaz.
CREATE TABLE IF NOT EXISTS responses (
  invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  model_id      INTEGER NOT NULL REFERENCES models(id),
  score         INTEGER CHECK (score BETWEEN 1 AND 5),
  not_my_style  INTEGER NOT NULL DEFAULT 0,
  comment       TEXT,
  PRIMARY KEY (invitation_id, model_id)
);

-- SMTP ayarlanmadığında giden mailler burada saklanır ve /giden-kutusu sayfasında görünür.
CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY,
  to_addr    TEXT NOT NULL,
  subject    TEXT NOT NULL,
  html       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function modelCode(id) {
  return 'MDL-' + String(id).padStart(4, '0');
}

module.exports = { db, tx, modelCode };
