// İngilizce anketler için Türkçe metinlerin çevirisi. DEEPL_API_KEY varsa DeepL, yoksa (ya da DeepL hata verirse)
// geçici olarak Google Çeviri kullanılır. Her metin bir kez çevrilip saklanır; elle düzeltilen çeviri bir daha
// üzerine yazılmaz. DeepL anahtarı sonradan eklenirse Google ile yapılmış çeviriler DeepL ile yenilenir.
const config = require('./config');
const { db, modelImages } = require('./db');

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

// Google Çeviri'nin anahtarsız uçları; DeepL anahtarı eklenene kadar geçici çözüm. Biri sınır koyarsa (429) diğeri denenir.
const GOOGLE = [
  (q) => 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=tr&tl=en&dt=t&q=' + encodeURIComponent(q),
  (q) => 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=tr&tl=en&q=' + encodeURIComponent(q),
];

// İki uç farklı biçimde döner: [[["çeviri","kaynak"],…],…] ya da [["çeviri","tr"]] / ["çeviri"].
function googleText(data) {
  if (Array.isArray(data) && Array.isArray(data[0]) && Array.isArray(data[0][0])) return data[0].map((p) => p[0]).join('');
  const first = Array.isArray(data) ? data[0] : null;
  return Array.isArray(first) ? first[0] : first;
}

async function google(text) {
  const errors = [];
  for (const url of GOOGLE) {
    try {
      const res = await fetch(url(text), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Google ${res.status}`);
      const out = String(googleText(await res.json()) || '').trim();
      if (out) return out;
      throw new Error('Google boş çeviri döndü');
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(errors.join(', '));
}

// Yeni çeviri boşsa ya da daha iyi bir çeviriyle (Türkçesinin kopyası → Google → DeepL) yenileniyorsa yazılır;
// elle düzeltilen hiçbir zaman ezilmez.
const save = (source, en, engine) => db.prepare(`INSERT INTO translations (source, en, engine) VALUES (?, ?, ?)
  ON CONFLICT (source) DO UPDATE SET en = excluded.en, engine = excluded.engine, updated_at = datetime('now')
  WHERE (translations.engine = 'kopya' AND excluded.engine IN ('google', 'deepl'))
     OR (translations.engine = 'google' AND excluded.engine = 'deepl')`).run(source, en, engine);

// Eksik çevirileri tamamlar: önce DeepL, olmazsa Google. Çevrilemeyen metin Türkçesiyle yazılır ('kopya'),
// böylece anket beklemeden gönderilebilir; kopyalar "Eksikleri otomatik çevir" (retry) ya da DeepL ile yeniden denenir.
async function translateMissing(sources, { retry = false } = {}) {
  const missing = [...new Set(sources.filter(Boolean))].filter((s) => {
    const r = row(s);
    if (!r) return true;
    if (r.engine === 'kopya') return retry || deeplEnabled();
    return deeplEnabled() && r.engine === 'google';
  });
  if (!missing.length) return { translated: 0 };
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
    }
  }
  const rest = missing.filter((s) => [null, 'kopya'].includes(row(s)?.engine ?? null));
  let googleOk = true;
  let copied = 0;
  for (const s of rest) {
    if (googleOk) {
      try {
        save(s, await google(s), 'google');
        continue;
      } catch (err) {
        errors.push(err.message);
        googleOk = false; // sınır konduysa kalanlar için tekrar denenmez
      }
    }
    save(s, s, 'kopya');
    copied++;
  }
  if (errors.length) console.error('Çeviri yapılamadı:', errors.join(' / '));
  return { translated: missing.length - copied, copied };
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
    if (m.ab_test && images.length >= 2) {
      if (m.test_konusu) texts.push({ source: m.test_konusu, label: `${code} · A/B konusu` });
      for (const im of images) if (im.label) texts.push({ source: im.label, label: `${code} · seçenek ${im.letter}` });
    }
    for (const im of images) {
      texts.push({ source: im.ana_kumas, label: `${code} · ${im.letter} ana kumaş` }, { source: im.icerik, label: `${code} · ${im.letter} içerik` },
        { source: im.ozellik, label: `${code} · ${im.letter} tuşe / özellik` });
    }
  }
  const seen = new Set();
  return texts.filter((t) => t.source && !seen.has(t.source) && seen.add(t.source))
    .map((t) => {
      const r = row(t.source);
      return { ...t, en: r ? r.en : null, copied: r?.engine === 'kopya' };
    });
}

const translateSurvey = (survey, opts) => translateMissing(surveyTexts(survey).map((t) => t.source), opts);
const missingFor = (survey) => surveyTexts(survey).filter((t) => !t.en);

// Katılımcıya gösterilecek metin: İngilizce ankette çevirisi, yoksa Türkçesi.
const tr2 = (lang) => (text) => (lang === 'en' && text ? lookup(text) || text : text);

module.exports = { enabled, deeplEnabled, engineName, lookup, setManual, translateMissing, translateSurvey, surveyTexts, missingFor, tr2 };
