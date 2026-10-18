// Günlük otomatik yedek: her gün 03:00'ten sonra (Türkiye saati) veritabanının anlık kopyası diske alınır,
// depolama alanı ayarlıysa oraya da gönderilir; yeni görseller de bir kez yüklenir.
// Diskte 14, depolama alanında 30 günlük veritabanı kopyası tutulur; görseller depolama alanında silinmez.
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { db } = require('./db');
const s3 = require('./s3');

const LOCAL_DAYS = 14;
const REMOTE_DAYS = 30;
const HOUR = 3;
const OFFSET_MS = config.tzOffsetMinutes * 60000;

const trDay = (date) => new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
const trHour = (date) => new Date(date.getTime() + OFFSET_MS).getUTCHours();
const dayBefore = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const fileFor = (day) => `anket-${day}.db`;

const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.heif': 'image/heif', '.avif': 'image/avif' };

async function uploadNewImages() {
  const done = new Set(db.prepare('SELECT filename FROM backup_files').all().map((r) => r.filename));
  const mark = db.prepare('INSERT OR IGNORE INTO backup_files (filename, uploaded_at) VALUES (?, ?)');
  let count = 0;
  for (const name of fs.readdirSync(config.uploadDir)) {
    if (done.has(name)) continue;
    const body = fs.readFileSync(path.join(config.uploadDir, name));
    await s3.putObject(`gorseller/${name}`, body, IMAGE_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream');
    mark.run(name, new Date().toISOString());
    count++;
  }
  return count;
}

function pruneLocal(day) {
  const keep = new Set(Array.from({ length: LOCAL_DAYS }, (_, i) => fileFor(dayBefore(day, i))));
  for (const name of fs.readdirSync(config.backupDir)) {
    if (/^anket-\d{4}-\d{2}-\d{2}\.db$/.test(name) && !keep.has(name)) fs.rmSync(path.join(config.backupDir, name), { force: true });
  }
}

async function runBackup(now = new Date()) {
  const day = trDay(now);
  fs.mkdirSync(config.backupDir, { recursive: true });
  const file = fileFor(day);
  const target = path.join(config.backupDir, file);
  fs.rmSync(target, { force: true });
  // VACUUM INTO, uygulama çalışırken bile tutarlı bir kopya üretir.
  db.prepare('VACUUM INTO ?').run(target);
  const size = fs.statSync(target).size;
  pruneLocal(day);

  let remote = 'kapalı';
  if (s3.enabled()) {
    try {
      await s3.putObject(`veritabani/${file}`, fs.readFileSync(target));
      const images = await uploadNewImages();
      await s3.deleteObject(`veritabani/${fileFor(dayBefore(day, REMOTE_DAYS))}`);
      remote = `ok · ${images} yeni görsel`;
    } catch (err) {
      remote = `hata: ${err.message}`.slice(0, 300);
      console.error('Yedek depolama alanına gönderilemedi:', err.message);
    }
  }
  db.prepare('INSERT INTO backups (day, file, size, remote) VALUES (?, ?, ?, ?)').run(day, file, size, remote);
  console.log(`Yedek alındı: ${file} (${Math.round(size / 1024)} KB), depolama alanı: ${remote}`);
  return { day, file, size, remote };
}

let running = false;
// Zamanlayıcıdan çağrılır: bugünün yedeği yoksa ve saat 03:00'ü geçtiyse yedek alır.
async function backupIfDue(now = new Date()) {
  if (running || trHour(now) < HOUR) return null;
  if (db.prepare('SELECT 1 FROM backups WHERE day = ?').get(trDay(now))) return null;
  running = true;
  try {
    return await runBackup(now);
  } catch (err) {
    console.error('Yedek alınamadı:', err.message);
    return null;
  } finally {
    running = false;
  }
}

function listBackups(limit = 20) {
  return db.prepare('SELECT * FROM backups ORDER BY id DESC LIMIT ?').all(limit)
    .map((b) => ({ ...b, available: fs.existsSync(path.join(config.backupDir, b.file)) }));
}

module.exports = { runBackup, backupIfDue, listBackups, LOCAL_DAYS, REMOTE_DAYS };
