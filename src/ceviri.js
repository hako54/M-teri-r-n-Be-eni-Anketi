// İngilizce anketler için Türkçe metinlerin çevirisi (DeepL). Her metin bir kez çevrilip saklanır;
// elle düzeltilen çeviri bir daha üzerine yazılmaz. DEEPL_API_KEY yoksa çeviriler anket sayfasında elle yazılır.
const config = require('./config');
const { db, modelImages, isAbTest } = require('./db');

const enabled = () => Boolean(config.deeplKey);

// DeepL'e metinlerin ne olduğunu anlatır: kumaş ve tuşe terimleri moda bağlamında çevrilsin.
const CONTEXT = 'Product survey for a fashion retail collection. Texts are garment names, fabric types, '
  + 'fiber compositions (e.g. "%100 Pamuk" = "100% cotton"), fabric hand feel (tuşe) and colour/pattern options.';

function lookup(source) {
  const row = db.prepare('SELECT en FROM translations WHERE source = ?').get(source);
  return row ? row.en : null;
}

function setManual(source, en) {
  const value = String(en || '').trim();
  if (!value) {
    db.prepare("DELETE FROM translations WHERE source = ? AND engine = 'elle'").run(source);
    return;
  }
  db.prepare(`INSERT INTO translations (source, en, engine) VALUES (?, ?, 'elle')
    ON CONFLICT (source) DO UPDATE SET en = excluded.en, engine = 'elle', updated_at = datetime('now')`).run(source, value);
}

async function deepl(texts) {
  const host = config.deeplKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const res = await fetch(`${host}/v2/translate`, {
    method: 'POST',
    headers: { authorization: `DeepL-Auth-Key ${config.deeplKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: texts, source_lang: 'TR', target_lang: 'EN-US', context: CONTEXT }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`DeepL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.translations.map((t) => t.text);
}

// Eksik çevirileri DeepL ile tamamlar. Hata olursa anket akışı durmaz; eksikler elle yazılabilir.
async function translateMissing(sources) {
  const missing = [...new Set(sources.filter(Boolean))].filter((s) => lookup(s) === null);
  if (!missing.length) return { translated: 0 };
  if (!enabled()) return { translated: 0, error: 'DeepL anahtarı ayarlı değil' };
  try {
    const save = db.prepare(`INSERT INTO translations (source, en, engine) VALUES (?, ?, 'deepl')
      ON CONFLICT (source) DO NOTHING`);
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50);
      const out = await deepl(chunk);
      chunk.forEach((s, k) => save.run(s, out[k]));
    }
    return { translated: missing.length };
  } catch (err) {
    console.error('Çeviri yapılamadı:', err.message);
    return { translated: 0, error: err.message };
  }
}

// Bir anketin katılımcıya görünen Türkçe metinleri: başlık, model bilgileri, A/B konusu ve seçenek adları.
function surveyTexts(survey) {
  const models = db.prepare(`SELECT m.* FROM survey_models sm JOIN models m ON m.id = sm.model_id
    WHERE sm.survey_id = ? ORDER BY sm.sort_order`).all(survey.id);
  const texts = [{ source: survey.title, label: 'Anket adı' }];
  for (const m of models) {
    const code = 'MDL-' + String(m.id).padStart(4, '0');
    texts.push({ source: m.ana_kumas, label: `${code} · ana kumaş` }, { source: m.icerik, label: `${code} · içerik` });
    if (m.ozellik) texts.push({ source: m.ozellik, label: `${code} · tuşe / özellik` });
    const images = modelImages(m.id);
    if (isAbTest(m, images)) {
      if (m.test_konusu) texts.push({ source: m.test_konusu, label: `${code} · A/B konusu` });
      for (const im of images) if (im.label) texts.push({ source: im.label, label: `${code} · seçenek ${im.letter}` });
    }
  }
  const seen = new Set();
  return texts.filter((t) => t.source && !seen.has(t.source) && seen.add(t.source))
    .map((t) => ({ ...t, en: lookup(t.source) }));
}

const translateSurvey = (survey) => translateMissing(surveyTexts(survey).map((t) => t.source));
const missingFor = (survey) => surveyTexts(survey).filter((t) => !t.en);

// Katılımcıya gösterilecek metin: İngilizce ankette çevirisi, yoksa Türkçesi.
const tr2 = (lang) => (text) => (lang === 'en' && text ? lookup(text) || text : text);

module.exports = { enabled, lookup, setManual, translateMissing, translateSurvey, surveyTexts, missingFor, tr2 };
