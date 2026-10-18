// İngilizce anketler için Türkçe metinlerin çevirisi. DEEPL_API_KEY varsa DeepL, yoksa (ya da DeepL hata verirse)
// geçici olarak Google Çeviri kullanılır. Her metin bir kez çevrilip saklanır; elle düzeltilen çeviri bir daha
// üzerine yazılmaz. DeepL anahtarı sonradan eklenirse Google ile yapılmış çeviriler DeepL ile yenilenir.
const config = require('./config');
const { db, modelImages, isAbTest } = require('./db');

const deeplEnabled = () => Boolean(config.deeplKey);
// Otomatik çeviri her zaman denenir: DeepL yoksa Google'a düşer.
const enabled = () => true;
const engineName = () => (deeplEnabled() ? 'DeepL' : 'Google Çeviri');

// DeepL'e metinlerin ne olduğunu anlatır: kumaş ve tuşe terimleri moda bağlamında çevrilsin.
const CONTEXT = 'Product survey for a fashion retail collection. Texts are garment names, fabric types, '
  + 'fiber compositions (e.g. "%100 Pamuk" = "100% cotton"), fabric hand feel (tuşe) and colour/pattern options.';

const row = (source) => db.prepare('SELECT en, engine FROM translations WHERE source = ?').get(source);

function lookup(source) {
  const r = row(source);
  return r ? r.en : null;
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

// Google Çeviri'nin anahtarsız ucu; DeepL anahtarı eklenene kadar geçici çözüm.
async function google(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=tr&tl=en&dt=t&q=' + encodeURIComponent(text);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Google ${res.status}`);
  const data = await res.json();
  const out = (data[0] || []).map((part) => part[0]).join('').trim();
  if (!out) throw new Error('Google boş çeviri döndü');
  return out;
}

// Yeni çeviri yalnızca boşsa ya da Google çevirisini DeepL ile yeniliyorsa yazılır; elle düzeltilen korunur.
const save = (source, en, engine) => db.prepare(`INSERT INTO translations (source, en, engine) VALUES (?, ?, ?)
  ON CONFLICT (source) DO UPDATE SET en = excluded.en, engine = excluded.engine, updated_at = datetime('now')
  WHERE translations.engine = 'google' AND excluded.engine = 'deepl'`).run(source, en, engine);

// Eksik çevirileri tamamlar: önce DeepL, olmazsa Google. Hata olursa anket akışı durmaz; eksikler elle yazılabilir.
async function translateMissing(sources) {
  const missing = [...new Set(sources.filter(Boolean))].filter((s) => {
    const r = row(s);
    return !r || (deeplEnabled() && r.engine === 'google');
  });
  if (!missing.length) return { translated: 0 };
  let rest = missing;
  const errors = [];
  if (deeplEnabled()) {
    try {
      for (let i = 0; i < missing.length; i += 50) {
        const chunk = missing.slice(i, i + 50);
        const out = await deepl(chunk);
        chunk.forEach((s, k) => save(s, out[k], 'deepl'));
      }
      return { translated: missing.length };
    } catch (err) {
      errors.push(err.message);
      rest = missing.filter((s) => lookup(s) === null);
    }
  }
  let done = missing.length - rest.length;
  for (const s of rest) {
    try {
      save(s, await google(s), 'google');
      done++;
    } catch (err) {
      errors.push(err.message);
      break;
    }
  }
  if (errors.length) console.error('Çeviri yapılamadı:', errors.join(' / '));
  return done === missing.length ? { translated: done } : { translated: done, error: errors.join(' / ') };
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

module.exports = { enabled, deeplEnabled, engineName, lookup, setManual, translateMissing, translateSurvey, surveyTexts, missingFor, tr2 };
