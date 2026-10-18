// Ürün kırılımı (Marka Müdürlüğü > Buyer Grup > Merch Alt Grup > Klasman …).
// Başlıklar ve satırlar src/kirilim.json'dan gelir; seviye sayısı sabit değildir, yeni başlık eklemek için
// scripts/kirilim_excel_to_json.py ile dosyayı yeniden üretmek yeterlidir.
const data = require('./kirilim.json');

const collator = new Intl.Collator('tr');
const levels = data.levels;

// Seçili üst seviyelere göre bir sonraki seviyenin seçenekleri.
function options(prefix) {
  if (prefix.length >= levels.length) return [];
  const set = new Set();
  for (const row of data.rows) {
    if (row.length > prefix.length && prefix.every((v, i) => row[i] === v)) set.add(row[prefix.length]);
  }
  return [...set].sort(collator.compare);
}

// Formdan gelen değerleri doğrular: soldan sağa dolu ve listede var olan bir yol olmalı.
// Boş bırakılan ilk seviyeden sonrası atılır. Geçersizse null döner.
function normalize(values) {
  const path = [];
  for (const raw of values.slice(0, levels.length)) {
    const v = String(raw ?? '').trim();
    if (!v) break;
    if (!options(path).includes(v)) return null;
    path.push(v);
  }
  return path;
}

function parse(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

module.exports = { levels, options, normalize, parse };
