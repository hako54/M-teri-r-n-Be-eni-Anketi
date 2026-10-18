const { db, modelCode } = require('./db');

function firstImage(modelId) {
  const row = db.prepare('SELECT filename FROM model_images WHERE model_id = ? ORDER BY sort_order, id LIMIT 1').get(modelId);
  return row ? row.filename : null;
}

// "Tarzım değil" yanıtları ortalamaya ve puan sayısına katılmaz, ayrı sayılır.
function computeResults(surveyId) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  if (!survey) return null;

  const invited = db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE survey_id = ?').get(surveyId).n;
  const completed = db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE survey_id = ? AND completed_at IS NOT NULL').get(surveyId).n;

  const models = db.prepare(`
    SELECT m.* FROM survey_models sm JOIN models m ON m.id = sm.model_id
    WHERE sm.survey_id = ? ORDER BY sm.sort_order, m.id`).all(surveyId);

  const responsesFor = db.prepare(`
    SELECT r.score, r.not_my_style, r.comment, i.email FROM responses r
    JOIN invitations i ON i.id = r.invitation_id
    WHERE i.survey_id = ? AND r.model_id = ? AND i.completed_at IS NOT NULL`);

  const rows = models.map((m) => {
    const responses = responsesFor.all(surveyId, m.id);
    const dist = [0, 0, 0, 0, 0];
    let sum = 0;
    let scored = 0;
    let notMyStyle = 0;
    const comments = [];
    for (const r of responses) {
      if (r.not_my_style) notMyStyle++;
      else if (r.score) { dist[r.score - 1]++; sum += r.score; scored++; }
      if (r.comment && r.comment.trim()) {
        comments.push({ email: r.email, text: r.comment.trim(), score: r.score, notMyStyle: !!r.not_my_style });
      }
    }
    return {
      id: m.id,
      code: modelCode(m.id),
      ana_kumas: m.ana_kumas,
      icerik: m.icerik,
      image: firstImage(m.id),
      avg: scored ? sum / scored : null,
      scored,
      notMyStyle,
      dist,
      comments,
    };
  });

  const ranked = [...rows].sort((a, b) => {
    if (a.avg === null && b.avg === null) return 0;
    if (a.avg === null) return 1;
    if (b.avg === null) return -1;
    return b.avg - a.avg || b.scored - a.scored;
  });

  return { survey, invited, completed, models: ranked };
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

function resultsCsv(results) {
  const header = ['Sıra', 'Model No', 'Ana Kumaş', 'İçerik', 'Ortalama', 'Puan Veren', 'Tarzım Değil', '1', '2', '3', '4', '5'];
  const body = results.models.map((m, i) => [
    i + 1, m.code, m.ana_kumas, m.icerik, formatAvg(m.avg), m.scored, m.notMyStyle, ...m.dist,
  ]);
  return toCsv([header, ...body]);
}

function commentsCsv(results) {
  const header = ['Model No', 'Katılımcı', 'Puan', 'Yorum'];
  const body = [];
  for (const m of results.models) {
    for (const c of m.comments) body.push([m.code, c.email, c.notMyStyle ? 'Tarzım değil' : c.score, c.text]);
  }
  return toCsv([header, ...body]);
}

module.exports = { computeResults, formatAvg, resultsCsv, commentsCsv, firstImage };
