const { db, modelCode, modelImages, isAbTest, imageInfo, infoLine } = require('./db');
const kirilim = require('./kirilim');

function firstImage(modelId) {
  const row = db.prepare('SELECT filename FROM model_images WHERE model_id = ? ORDER BY sort_order, id LIMIT 1').get(modelId);
  return row ? row.filename : null;
}

// "Tarzım değil" yanıtları ortalamaya ve puan sayısına katılmaz, ayrı sayılır.
function summarize(responses) {
  const dist = [0, 0, 0, 0, 0];
  let sum = 0;
  let scored = 0;
  let notMyStyle = 0;
  for (const r of responses) {
    if (r.not_my_style) notMyStyle++;
    else if (r.score) { dist[r.score - 1]++; sum += r.score; scored++; }
  }
  return { avg: scored ? sum / scored : null, scored, notMyStyle, dist };
}

const byAvg = (a, b) => {
  if (a.avg === null && b.avg === null) return 0;
  if (a.avg === null) return 1;
  if (b.avg === null) return -1;
  return b.avg - a.avg || b.scored - a.scored;
};

function computeResults(surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  if (!survey) return null;

  const invited = db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE survey_id = ? AND invited = 1').get(surveyId).n;
  const completed = db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE survey_id = ? AND completed_at IS NOT NULL').get(surveyId).n;

  const models = db.prepare(`
    SELECT m.* FROM survey_models sm JOIN models m ON m.id = sm.model_id
    WHERE sm.survey_id = ? ORDER BY sm.sort_order, m.id`).all(surveyId);

  const done = 'i.survey_id = ? AND i.completed_at IS NOT NULL';
  const responsesFor = db.prepare(`
    SELECT r.score, r.not_my_style FROM responses r JOIN invitations i ON i.id = r.invitation_id
    WHERE ${done} AND r.model_id = ? AND r.image_id = ?`);
  const commentsFor = db.prepare(`
    SELECT c.text, c.invitation_id, i.email FROM comments c JOIN invitations i ON i.id = c.invitation_id
    WHERE ${done} AND c.model_id = ?`);
  const picksFor = db.prepare(`
    SELECT p.image_id, p.invitation_id FROM picks p JOIN invitations i ON i.id = p.invitation_id
    WHERE ${done} AND p.model_id = ?`);
  const ownAnswer = db.prepare(`
    SELECT r.score, r.not_my_style FROM responses r WHERE r.invitation_id = ? AND r.model_id = ? AND r.image_id = ?`);

  const rows = models.map((m) => {
    const images = modelImages(m.id);
    const ab = isAbTest(m, images);
    const base = {
      id: m.id,
      code: modelCode(m.id),
      ana_kumas: m.ana_kumas,
      icerik: m.icerik,
      ozellik: m.ozellik || '',
      kirilim: kirilim.parse(m.kirilim),
      image: images[0] ? images[0].filename : null,
      ab,
      test_konusu: ab ? m.test_konusu : null,
    };

    if (!ab) {
      const comments = commentsFor.all(surveyId, m.id).map((c) => {
        const own = ownAnswer.get(c.invitation_id, m.id, 0) || {};
        return { email: c.email, text: c.text, note: own.not_my_style ? 'Tarzım değil' : own.score ? `${own.score} puan` : '' };
      });
      // A/B değilse görseller tek model sayılır; görsele özel bilgiler ayrıca listelenir.
      const imageInfos = images.map((im) => ({ letter: im.letter, ...variantInfo(m, im) })).filter((x) => x.info);
      return { ...base, ...summarize(responsesFor.all(surveyId, m.id, 0)), comments, variants: [], imageInfos };
    }

    const picks = picksFor.all(surveyId, m.id);
    const pickCount = (imageId) => picks.filter((p) => p.image_id === imageId).length;
    const variants = images.map((im) => ({
      imageId: im.id,
      letter: im.letter,
      label: im.label || '',
      ...variantInfo(m, im),
      filename: im.filename,
      picks: pickCount(im.id),
      ...summarize(responsesFor.all(surveyId, m.id, im.id)),
    }));
    // Kazanan: en çok "koleksiyonda olsun" tercihi; eşitlikte yüksek ortalama.
    const winner = [...variants].sort((a, b) => b.picks - a.picks || byAvg(a, b))[0];
    const hasVotes = variants.some((v) => v.picks || v.scored);
    const letterOf = (imageId) => (variants.find((v) => v.imageId === imageId) || {}).letter;
    const comments = commentsFor.all(surveyId, m.id).map((c) => {
      const pick = picks.find((p) => p.invitation_id === c.invitation_id);
      return { email: c.email, text: c.text, note: pick ? (pick.image_id ? `seçimi ${letterOf(pick.image_id)}` : 'hiçbirini seçmedi') : '' };
    });
    return {
      ...base,
      image: hasVotes ? winner.filename : base.image,
      avg: winner.avg,
      scored: variants.reduce((n, v) => n + v.scored, 0),
      notMyStyle: variants.reduce((n, v) => n + v.notMyStyle, 0),
      dist: winner.dist,
      variants,
      winner: hasVotes ? winner : null,
      noPick: pickCount(0),
      comments,
    };
  });

  return { survey, invited, completed, models: [...rows].sort(byAvg) };
}

// Seçeneğin kendi kumaş bilgisi; yalnızca modelden farklı yazıldıysa info dolu gelir.
function variantInfo(m, im) {
  const i = imageInfo(m, im);
  return { ana_kumas: i.ana_kumas, icerik: i.icerik, ozellik: i.ozellik, info: i.custom ? infoLine(i) : '' };
}

function formatAvg(avg) {
  return avg === null ? '–' : avg.toFixed(1).replace('.', ',');
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Türkçe Excel ";" ayırıcı ve UTF-8 BOM ile doğru açar.
function toCsv(rows) {
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

// A/B modellerinde her varyant ayrı satırdır.
function resultsCsv(results) {
  const header = ['Sıra', 'Model No', 'Ana Kumaş', 'İçerik', 'Tuşe / Özellik', ...kirilim.levels, 'Test Konusu', 'Varyant', 'Varyant Adı', 'Ortalama', 'Puan Veren', 'Tarzım Değil', '1', '2', '3', '4', '5', 'Koleksiyon Tercihi', 'Kazanan'];
  const body = [];
  results.models.forEach((m, i) => {
    const head = [i + 1, m.code, m.ana_kumas, m.icerik, m.ozellik, ...kirilim.levels.map((_, k) => m.kirilim[k] || '')];
    if (!m.ab) {
      body.push([...head, '', '', '', formatAvg(m.avg), m.scored, m.notMyStyle, ...m.dist, '', '']);
      return;
    }
    for (const v of m.variants) {
      body.push([i + 1, m.code, v.ana_kumas, v.icerik, v.ozellik, ...head.slice(5), m.test_konusu, v.letter, v.label, formatAvg(v.avg), v.scored, v.notMyStyle, ...v.dist,
        v.picks, m.winner && m.winner.imageId === v.imageId ? 'Evet' : '']);
    }
    body.push([...head, m.test_konusu, '–', 'Hiçbiri', '', '', '', '', '', '', '', '', m.noPick, '']);
  });
  return toCsv([header, ...body]);
}

function commentsCsv(results) {
  const header = ['Model No', 'Katılımcı', 'Puan / Seçim', 'Yorum'];
  const body = [];
  for (const m of results.models) {
    for (const c of m.comments) body.push([m.code, c.email, c.note, c.text]);
  }
  return toCsv([header, ...body]);
}

module.exports = { computeResults, formatAvg, resultsCsv, commentsCsv, firstImage };
