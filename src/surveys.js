const crypto = require('node:crypto');
const { db, tx, modelCode } = require('./db');
const { computeResults, resultsCsv, commentsCsv, firstImage } = require('./results');
const { sendMail, resultEmail } = require('./mail');
const { closesAt } = require('./time');

const newToken = () => crypto.randomBytes(16).toString('base64url');

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// Virgül, noktalı virgül, boşluk veya satır sonu ile ayrılmış listeyi temizler.
function parseEmails(text) {
  const all = String(text || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const valid = [...new Set(all.filter((e) => EMAIL_RE.test(e)))];
  const invalid = all.filter((e) => !EMAIL_RE.test(e));
  return { valid, invalid };
}

// Anket taslak olarak oluşur: yalnızca test linki çalışır, kapanış zamanı canlıya alınınca hesaplanır.
function createSurvey({ userId, title, modelIds, emails, resultEmails, days, hour }) {
  return tx(() => {
    const { lastInsertRowid: surveyId } = db.prepare(`
      INSERT INTO surveys (user_id, title, closes_at, result_emails, open_days, open_hour, public_token, test_token, result_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, title, closesAt(days, hour), resultEmails.join(','), days, hour, newToken(), newToken(), newToken());
    const addModel = db.prepare('INSERT INTO survey_models (survey_id, model_id, sort_order) VALUES (?, ?, ?)');
    modelIds.forEach((id, i) => addModel.run(surveyId, id, i));
    const addInvite = db.prepare('INSERT INTO invitations (survey_id, email, token) VALUES (?, ?, ?)');
    for (const email of emails) addInvite.run(surveyId, email, newToken());
    return Number(surveyId);
  });
}

// Canlıya alır: kapanış, şu andan itibaren belirlenen gün ve saatle yeniden hesaplanır.
function publishSurvey(survey, now = new Date()) {
  const closes = closesAt(survey.open_days, survey.open_hour, now);
  if (new Date(closes) <= now) return null;
  db.prepare('UPDATE surveys SET published_at = ?, closes_at = ? WHERE id = ? AND published_at IS NULL')
    .run(now.toISOString(), closes, survey.id);
  return closes;
}

// Ortak linkten gelen katılımcı e-postasıyla tanınır; listede yoksa da katılabilir ve öyle işaretlenir.
function joinSurvey(surveyId, email) {
  const existing = db.prepare('SELECT * FROM invitations WHERE survey_id = ? AND email = ?').get(surveyId, email);
  if (existing) return existing;
  db.prepare('INSERT INTO invitations (survey_id, email, token, invited) VALUES (?, ?, ?, 0)').run(surveyId, email, newToken());
  return db.prepare('SELECT * FROM invitations WHERE survey_id = ? AND email = ?').get(surveyId, email);
}

function surveyModels(surveyId) {
  return db.prepare(`
    SELECT m.* FROM survey_models sm JOIN models m ON m.id = sm.model_id
    WHERE sm.survey_id = ? ORDER BY sm.sort_order`).all(surveyId)
    .map((m) => ({ ...m, code: modelCode(m.id), image: firstImage(m.id) }));
}

// answers: [{ modelId, ratings: [{ imageId, score, notMyStyle }], pick (A/B: görsel id, 0 = hiçbiri), comment }]
function submitResponses(invitationId, answers) {
  tx(() => {
    for (const table of ['responses', 'comments', 'picks']) {
      db.prepare(`DELETE FROM ${table} WHERE invitation_id = ?`).run(invitationId);
    }
    const rate = db.prepare('INSERT INTO responses (invitation_id, model_id, image_id, score, not_my_style) VALUES (?, ?, ?, ?, ?)');
    const comment = db.prepare('INSERT INTO comments (invitation_id, model_id, text) VALUES (?, ?, ?)');
    const pick = db.prepare('INSERT INTO picks (invitation_id, model_id, image_id) VALUES (?, ?, ?)');
    for (const a of answers) {
      for (const r of a.ratings) rate.run(invitationId, a.modelId, r.imageId, r.score, r.notMyStyle ? 1 : 0);
      if (a.comment) comment.run(invitationId, a.modelId, a.comment);
      if (a.pick !== undefined) pick.run(invitationId, a.modelId, a.pick);
    }
    db.prepare('UPDATE invitations SET completed_at = ? WHERE id = ?').run(new Date().toISOString(), invitationId);
  });
}

// Anketi kapatır ve sonuç mailini gönderir. Gönderim başarısız olursa bir sonraki turda yeniden dener.
async function closeAndReport(surveyId) {
  db.prepare('UPDATE surveys SET closed_at = COALESCE(closed_at, ?) WHERE id = ?').run(new Date().toISOString(), surveyId);
  const results = computeResults(surveyId);
  const to = results.survey.result_emails.split(',').filter(Boolean);
  await sendMail({
    to: to.join(', '),
    subject: `Anket sonucu: ${results.survey.title}`,
    html: resultEmail(results),
    attachments: [
      { filename: 'sonuclar.csv', content: resultsCsv(results), contentType: 'text/csv; charset=utf-8' },
      { filename: 'yorumlar.csv', content: commentsCsv(results), contentType: 'text/csv; charset=utf-8' },
    ],
  });
  db.prepare('UPDATE surveys SET result_sent_at = ? WHERE id = ?').run(new Date().toISOString(), surveyId);
}

// Gönderilmeyen taslaklar bu süreden sonra silinir.
const DRAFT_DAYS = 7;

function draftExpiresAt(survey) {
  if (survey.published_at) return null;
  return new Date(new Date(survey.created_at.replace(' ', 'T') + 'Z').getTime() + DRAFT_DAYS * 86400000).toISOString();
}

function deleteExpiredDrafts(now = new Date()) {
  const cutoff = new Date(now.getTime() - DRAFT_DAYS * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  return db.prepare('DELETE FROM surveys WHERE published_at IS NULL AND created_at <= ?').run(cutoff).changes;
}

let running = false;
async function tick(now = new Date()) {
  if (running) return;
  running = true;
  try {
    deleteExpiredDrafts(now);
    const due = db.prepare(`SELECT id FROM surveys WHERE published_at IS NOT NULL AND result_sent_at IS NULL
      AND (closes_at <= ? OR closed_at IS NOT NULL)`)
      .all(now.toISOString());
    for (const { id } of due) {
      try {
        await closeAndReport(id);
      } catch (err) {
        console.error(`Anket ${id} sonucu gönderilemedi:`, err.message);
      }
    }
  } finally {
    running = false;
  }
}

function startScheduler(intervalMs = 30000) {
  tick();
  return setInterval(tick, intervalMs);
}

module.exports = { DRAFT_DAYS, draftExpiresAt, deleteExpiredDrafts, parseEmails, createSurvey, publishSurvey, joinSurvey, surveyModels, submitResponses, closeAndReport, tick, startScheduler };
