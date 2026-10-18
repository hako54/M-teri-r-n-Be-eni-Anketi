const crypto = require('node:crypto');
const { db, tx, modelCode } = require('./db');
const { computeResults, resultsCsv, commentsCsv, firstImage } = require('./results');
const { sendMail, inviteEmail, resultEmail } = require('./mail');

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// Virgül, noktalı virgül, boşluk veya satır sonu ile ayrılmış listeyi temizler.
function parseEmails(text) {
  const all = String(text || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const valid = [...new Set(all.filter((e) => EMAIL_RE.test(e)))];
  const invalid = all.filter((e) => !EMAIL_RE.test(e));
  return { valid, invalid };
}

function createSurvey({ userId, title, modelIds, emails, resultEmails, closesAt }) {
  return tx(() => {
    const { lastInsertRowid: surveyId } = db.prepare(
      'INSERT INTO surveys (user_id, title, closes_at, result_emails) VALUES (?, ?, ?, ?)',
    ).run(userId, title, closesAt, resultEmails.join(','));
    const addModel = db.prepare('INSERT INTO survey_models (survey_id, model_id, sort_order) VALUES (?, ?, ?)');
    modelIds.forEach((id, i) => addModel.run(surveyId, id, i));
    const addInvite = db.prepare('INSERT INTO invitations (survey_id, email, token) VALUES (?, ?, ?)');
    for (const email of emails) addInvite.run(surveyId, email, crypto.randomBytes(18).toString('base64url'));
    return Number(surveyId);
  });
}

function surveyModels(surveyId) {
  return db.prepare(`
    SELECT m.* FROM survey_models sm JOIN models m ON m.id = sm.model_id
    WHERE sm.survey_id = ? ORDER BY sm.sort_order`).all(surveyId)
    .map((m) => ({ ...m, code: modelCode(m.id), image: firstImage(m.id) }));
}

// Aynı anket için eşzamanlı iki gönderim aynı kişiye iki mail atmasın.
const sending = new Map();
function sendInvitations(surveyId) {
  if (!sending.has(surveyId)) {
    sending.set(surveyId, sendPending(surveyId).finally(() => sending.delete(surveyId)));
  }
  return sending.get(surveyId);
}

async function sendPending(surveyId) {
  const survey = db.prepare('SELECT s.*, u.username FROM surveys s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(surveyId);
  const models = surveyModels(surveyId);
  const invites = db.prepare(
    'SELECT * FROM invitations WHERE survey_id = ? AND sent_at IS NULL AND completed_at IS NULL',
  ).all(surveyId);
  const markSent = db.prepare('UPDATE invitations SET sent_at = ?, send_error = NULL WHERE id = ?');
  const markFail = db.prepare('UPDATE invitations SET send_error = ? WHERE id = ?');
  for (const inv of invites) {
    try {
      await sendMail({
        to: inv.email,
        subject: `Görüşünüz önemli: ${survey.title}`,
        html: inviteEmail({ survey, ownerName: survey.username, token: inv.token, models }),
      });
      markSent.run(new Date().toISOString(), inv.id);
    } catch (err) {
      markFail.run(String(err.message || err).slice(0, 300), inv.id);
    }
  }
}

function submitResponses(invitationId, answers) {
  tx(() => {
    const save = db.prepare(`
      INSERT INTO responses (invitation_id, model_id, score, not_my_style, comment) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (invitation_id, model_id) DO UPDATE SET score = excluded.score,
        not_my_style = excluded.not_my_style, comment = excluded.comment`);
    for (const a of answers) save.run(invitationId, a.modelId, a.score, a.notMyStyle ? 1 : 0, a.comment || null);
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

let running = false;
async function tick(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const due = db.prepare('SELECT id FROM surveys WHERE result_sent_at IS NULL AND (closes_at <= ? OR closed_at IS NOT NULL)')
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

module.exports = { parseEmails, createSurvey, surveyModels, sendInvitations, submitResponses, closeAndReport, tick, startScheduler };
