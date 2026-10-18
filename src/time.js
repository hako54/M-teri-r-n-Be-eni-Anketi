const config = require('./config');

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const OFFSET_MS = config.tzOffsetMinutes * 60000;

// Bugünden `days` gün sonra, Türkiye saatiyle `hhmm` saatinde kapanış (UTC ISO döner).
function closesAt(days, hhmm, now = new Date()) {
  const [h, m] = hhmm.split(':').map(Number);
  const local = new Date(now.getTime() + OFFSET_MS);
  const utcMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, h, m) - OFFSET_MS;
  return new Date(utcMs).toISOString();
}

function formatTR(iso, withTime = true) {
  const d = new Date(new Date(iso).getTime() + OFFSET_MS);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (!withTime) return date;
  return `${date}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

module.exports = { closesAt, formatTR };
