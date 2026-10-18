const crypto = require('node:crypto');
const { db, tx, modelCode } = require('./db');
const { firstImage } = require('./results');
const { closesAt } = require('./time');
const { toAddress } = require('./kullanici');

const newToken = () => crypto.randomBytes(16).toString('base64url');

// Virgül, noktalı virgül, boşluk veya satır sonu ile ayrılmış listeyi temizler.
// Kullanıcı adları (alihakan.baykal) şirket adresine çevrilir; "Ad Soyad <adres>" biçimindeki Outlook kopyaları da okunur.
function parseEmails(text) {
  const cleaned = String(text || '').replace(/[^<>,;\n]*<([^>]+)>/g, ' $1 ');
  const all = cleaned.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
  const valid = [];
  const invalid = [];
  for (const item of all) {
    const address = toAddress(item);
    if (address) { if (!valid.includes(address)) valid.push(address); } else invalid.push(item);
  }
  return { valid, invalid };
}

// Anket taslak olarak oluşur: yalnızca test linki çalışır, kapanış zamanı canlıya alınınca hesaplanır.
function createSurvey({ userId, title, modelIds, emails, resultEmails, days, hour, lang = 'tr' }) {
  return tx(() => {
    const { lastInsertRowid: surveyId } = db.prepare(`
      INSERT INTO surveys (user_id, title, closes_at, result_emails, open_days, open_hour, public_token, test_token, result_token, lang)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, title, closesAt(days, hour), resultEmails.join(','), days, hour, newToken(), newToken(), newToken(), lang);
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

// Anketi kapatır. Sonuç maili sunucudan gitmez; oluşturan kişi kendi Outlook'undan gönderir.
function closeSurvey(surveyId, now = new Date()) {
  db.prepare('UPDATE surveys SET closed_at = COALESCE(closed_at, ?) WHERE id = ?').run(now.toISOString(), surveyId);
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

function tick(now = new Date()) {
  try {
    deleteExpiredDrafts(now);
    const due = db.prepare('SELECT id FROM surveys WHERE published_at IS NOT NULL AND closed_at IS NULL AND closes_at <= ?')
      .all(now.toISOString());
    for (const { id } of due) closeSurvey(id, now);
  } catch (err) {
    console.error('Zamanlayıcı hatası:', err.message);
  }
}

function startScheduler(intervalMs = 30000) {
  tick();
  return setInterval(tick, intervalMs);
}

module.exports = { DRAFT_DAYS, draftExpiresAt, deleteExpiredDrafts, parseEmails, createSurvey, publishSurvey, joinSurvey, surveyModels, submitResponses, closeSurvey, tick, startScheduler };
