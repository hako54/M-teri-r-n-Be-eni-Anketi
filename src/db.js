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
  reset_requested_at TEXT,               -- "Şifremi unuttum" ile adminlerden sıfırlama istendiğinde
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
  ozellik        TEXT,                   -- isteğe bağlı: tuşe ve diğer model özellikleri
  kirilim        TEXT,                   -- JSON dizi: [Marka Müdürlüğü, Buyer Grup, Merch Alt Grup, Klasman, …]
  -- ab_test = 1: görseller aynı modelin alternatifleri (renk, desen, doku…) ve ayrı ayrı değerlendirilir.
  ab_test        INTEGER NOT NULL DEFAULT 0,
  test_konusu    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS model_images (
  id         INTEGER PRIMARY KEY,
  model_id   INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  label      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS surveys (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  closes_at      TEXT NOT NULL,          -- UTC ISO
  result_emails  TEXT NOT NULL,          -- virgülle ayrılmış
  lang           TEXT NOT NULL DEFAULT 'tr',  -- katılımcı dili: 'tr' ya da 'en' (metinler çevrilir)
  open_days      INTEGER,
  open_hour      TEXT,
  published_at   TEXT,                   -- NULL: taslak; yalnızca test linki çalışır
  public_token   TEXT,                   -- katılımcı linki
  test_token     TEXT,                   -- yanıtları kaydetmeyen test linki
  result_token   TEXT,                   -- giriş gerektirmeyen sonuç sayfası
  closed_at      TEXT,
  result_opened_at TEXT,                 -- sonuç maili Outlook'ta ilk açıldığında
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
  invited      INTEGER NOT NULL DEFAULT 1,  -- 0: davet listesinde yoktu, linkle kendisi katıldı
  UNIQUE (survey_id, email)
);

-- score NULL ve not_my_style = 1 ise "Tarzım değil": ortalamaya katılmaz.
-- image_id = 0 modelin tamamına verilen puan; A/B testinde her varyant (görsel) için ayrı satır.
CREATE TABLE IF NOT EXISTS responses (
  invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  model_id      INTEGER NOT NULL REFERENCES models(id),
  image_id      INTEGER NOT NULL DEFAULT 0,
  score         INTEGER CHECK (score BETWEEN 1 AND 5),
  not_my_style  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (invitation_id, model_id, image_id)
);

CREATE TABLE IF NOT EXISTS comments (
  invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  model_id      INTEGER NOT NULL REFERENCES models(id),
  text          TEXT NOT NULL,
  PRIMARY KEY (invitation_id, model_id)
);

-- Türkçe metinlerin İngilizce karşılıkları; bir metin bir kez çevrilir, elle düzeltilen çeviri korunur.
CREATE TABLE IF NOT EXISTS translations (
  source     TEXT PRIMARY KEY,
  en         TEXT NOT NULL,
  engine     TEXT NOT NULL,              -- 'deepl' ya da 'elle'
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin tarafından oluşturulan tek kullanımlık şifre sıfırlama linkleri.
CREATE TABLE IF NOT EXISTS password_resets (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

-- Günlük yedekler: diske alınan kopya ve depolama alanına (bucket) gönderim durumu.
CREATE TABLE IF NOT EXISTS backups (
  id         INTEGER PRIMARY KEY,
  day        TEXT NOT NULL,              -- Türkiye tarihi, YYYY-MM-DD
  file       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  remote     TEXT,                       -- 'ok', 'kapalı' veya hata mesajı
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Depolama alanına yüklenmiş görseller (her görsel bir kez yüklenir).
CREATE TABLE IF NOT EXISTS backup_files (
  filename    TEXT PRIMARY KEY,
  uploaded_at TEXT NOT NULL
);

-- A/B testinde "Koleksiyonda hangisinin olmasını istersiniz?" cevabı; image_id = 0 "Hiçbiri".
CREATE TABLE IF NOT EXISTS picks (
  invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  model_id      INTEGER NOT NULL REFERENCES models(id),
  image_id      INTEGER NOT NULL,
  PRIMARY KEY (invitation_id, model_id)
);
`);

// Önceki sürümle oluşturulmuş veritabanlarına eksik sütunları ekler.
function addColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('models', 'kirilim', 'TEXT');
addColumn('users', 'reset_requested_at', 'TEXT');
addColumn('models', 'ozellik', 'TEXT');
addColumn('surveys', 'lang', "TEXT NOT NULL DEFAULT 'tr'");
for (const col of ['result_opened_at TEXT', 'open_days INTEGER', 'open_hour TEXT', 'published_at TEXT', 'public_token TEXT', 'test_token TEXT', 'result_token TEXT']) {
  const [name, type] = col.split(' ');
  addColumn('surveys', name, type);
}
addColumn('invitations', 'invited', 'INTEGER NOT NULL DEFAULT 1');
// Eski anketler zaten gönderilmişti: yayında sayılır ve linkleri üretilir.
db.exec(`
  UPDATE surveys SET published_at = created_at WHERE published_at IS NULL AND open_days IS NULL;
  UPDATE surveys SET public_token = lower(hex(randomblob(16))) WHERE public_token IS NULL;
  UPDATE surveys SET test_token = lower(hex(randomblob(16))) WHERE test_token IS NULL;
  UPDATE surveys SET result_token = lower(hex(randomblob(16))) WHERE result_token IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS surveys_public_token ON surveys(public_token);
  CREATE UNIQUE INDEX IF NOT EXISTS surveys_test_token ON surveys(test_token);
  CREATE UNIQUE INDEX IF NOT EXISTS surveys_result_token ON surveys(result_token);
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

const TEST_KONULARI = [
  'Model rengi',
  'Kumaş tasarımı / jakar deseni',
  'Çizgi renkleri ve yerleşimi',
  'Kumaş dokusu',
  'Ekose renkleri',
  'Baskı / desen',
  'Diğer',
];

const variantLetter = (i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');

function modelImages(modelId) {
  return db.prepare('SELECT * FROM model_images WHERE model_id = ? ORDER BY sort_order, id').all(modelId)
    .map((im, i) => ({ ...im, letter: variantLetter(i) }));
}

// A/B testi ancak en az iki görsel varsa anlamlıdır; tek görselde normal değerlendirmeye düşer.
function isAbTest(model, images) {
  return Boolean(model.ab_test) && images.length >= 2;
}

module.exports = { db, tx, modelCode, modelImages, isAbTest, TEST_KONULARI };
