const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { db, tx, modelCode } = require('./db');
const auth = require('./auth');
const views = require('./views');
const { closesAt, formatTR } = require('./time');
const { computeResults, resultsCsv, firstImage } = require('./results');
const { smtpReady } = require('./mail');
const surveys = require('./surveys');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', immutable: true }));
app.use(auth.loadUser);

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heif', 'image/avif': '.avif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + (EXT[file.mimetype] || '.img')),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 60 },
  fileFilter: (req, file, cb) => cb(null, Boolean(EXT[file.mimetype])),
});

const send = (res, page, status = 200) => res.status(status).type('html').send(String(page));
const field = (v, max) => String(v ?? '').trim().slice(0, max);

// ---------- Hesap ----------
app.get('/', (req, res) => res.redirect(req.user ? '/modeller' : '/giris'));

app.get('/kayit', (req, res) => send(res, views.authPage({ mode: 'kayit', needsCode: Boolean(process.env.REGISTRATION_CODE) })));
app.post('/kayit', (req, res) => {
  const values = { username: field(req.body.username, 40), email: field(req.body.email, 120).toLowerCase(), code: field(req.body.code, 80) };
  const password = String(req.body.password || '');
  const errs = [];
  if (!/^[\p{L}\p{N}._-]{3,40}$/u.test(values.username)) errs.push('Kullanıcı adı en az 3 karakter olmalı; harf, rakam, nokta, tire kullanabilirsiniz.');
  if (!surveys.parseEmails(values.email).valid.length) errs.push('Geçerli bir e-posta adresi girin.');
  if (password.length < 8) errs.push('Şifre en az 8 karakter olmalı.');
  if (process.env.REGISTRATION_CODE && values.code !== process.env.REGISTRATION_CODE) errs.push('Kayıt kodu hatalı.');
  if (!errs.length && db.prepare('SELECT 1 FROM users WHERE username = ?').get(values.username)) errs.push('Bu kullanıcı adı alınmış.');
  if (errs.length) return send(res, views.authPage({ mode: 'kayit', values, errs, needsCode: Boolean(process.env.REGISTRATION_CODE) }), 400);
  const { lastInsertRowid } = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
    .run(values.username, values.email, auth.hashPassword(password));
  auth.startSession(req, res, Number(lastInsertRowid));
  res.redirect('/modeller');
});

app.get('/giris', (req, res) => (req.user ? res.redirect('/modeller') : send(res, views.authPage({ mode: 'giris' }))));
app.post('/giris', (req, res) => {
  const username = field(req.body.username, 40);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash)) {
    return send(res, views.authPage({ mode: 'giris', values: { username }, errs: ['Kullanıcı adı veya şifre hatalı.'] }), 401);
  }
  auth.startSession(req, res, user.id);
  res.redirect('/modeller');
});

app.post('/cikis', (req, res) => { auth.endSession(req, res); res.redirect('/giris'); });

// ---------- Modeller ----------
const modelList = (q) => {
  const like = `%${q}%`;
  return db.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM model_images i WHERE i.model_id = m.id) AS image_count
    FROM models m
    WHERE ? = '' OR m.ana_kumas LIKE ? OR m.icerik LIKE ? OR printf('MDL-%04d', m.id) LIKE ?
    ORDER BY m.id DESC`).all(q, like, like, like).map((m) => ({ ...m, image: firstImage(m.id) }));
};

const nextModelCode = () => {
  const row = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'models'").get();
  return modelCode((row ? row.seq : 0) + 1);
};

function removeFiles(files = []) {
  for (const f of files) fs.rm(f.path, { force: true }, () => {});
}

app.get('/modeller', auth.requireUser, (req, res) => {
  const q = field(req.query.q, 60);
  send(res, views.modelsPage({ user: req.user, models: modelList(q), q }));
});

app.get('/modeller/yeni', auth.requireUser, (req, res) => send(res, views.modelFormPage({ user: req.user, nextCode: nextModelCode() })));

app.post('/modeller', auth.requireUser, upload.array('images'), (req, res) => {
  const values = { ana_kumas: field(req.body.ana_kumas, 120), icerik: field(req.body.icerik, 200) };
  const errs = [];
  if (!req.files || !req.files.length) errs.push('En az bir görsel ekleyin (JPG, PNG, WEBP, HEIC).');
  if (!values.ana_kumas) errs.push('Ana kumaşı yazın.');
  if (!values.icerik) errs.push('İçeriği yazın.');
  if (errs.length) {
    removeFiles(req.files);
    return send(res, views.modelFormPage({ user: req.user, nextCode: nextModelCode(), values, errs }), 400);
  }
  const id = tx(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO models (user_id, ana_kumas, icerik) VALUES (?, ?, ?)')
      .run(req.user.id, values.ana_kumas, values.icerik);
    const addImg = db.prepare('INSERT INTO model_images (model_id, filename, sort_order) VALUES (?, ?, ?)');
    req.files.forEach((f, i) => addImg.run(lastInsertRowid, f.filename, i));
    return lastInsertRowid;
  });
  res.redirect(`/modeller/${id}`);
});

const getModel = (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(Number(id) || 0);
const modelImages = (id) => db.prepare('SELECT * FROM model_images WHERE model_id = ? ORDER BY sort_order, id').all(id);

app.get('/modeller/:id', auth.requireUser, (req, res) => {
  const model = getModel(req.params.id);
  if (!model) return res.redirect('/modeller');
  send(res, views.modelFormPage({ user: req.user, model, images: modelImages(model.id) }));
});

app.post('/modeller/:id', auth.requireUser, upload.array('images'), (req, res) => {
  const model = getModel(req.params.id);
  if (!model) { removeFiles(req.files); return res.redirect('/modeller'); }
  const ana = field(req.body.ana_kumas, 120);
  const icerik = field(req.body.icerik, 200);
  if (!ana || !icerik) {
    removeFiles(req.files);
    return send(res, views.modelFormPage({ user: req.user, model, images: modelImages(model.id), errs: ['Ana kumaş ve içerik boş bırakılamaz.'] }), 400);
  }
  tx(() => {
    db.prepare('UPDATE models SET ana_kumas = ?, icerik = ? WHERE id = ?').run(ana, icerik, model.id);
    const start = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM model_images WHERE model_id = ?').get(model.id).n;
    const addImg = db.prepare('INSERT INTO model_images (model_id, filename, sort_order) VALUES (?, ?, ?)');
    (req.files || []).forEach((f, i) => addImg.run(model.id, f.filename, start + i));
  });
  res.redirect(`/modeller/${model.id}`);
});

app.post('/modeller/:id/gorsel/:imageId/sil', auth.requireUser, (req, res) => {
  const img = db.prepare('SELECT * FROM model_images WHERE id = ? AND model_id = ?').get(Number(req.params.imageId) || 0, Number(req.params.id) || 0);
  // Son görsel silinmez; ankette her modelin en az bir görseli olmalı.
  if (img && modelImages(img.model_id).length > 1) {
    db.prepare('DELETE FROM model_images WHERE id = ?').run(img.id);
    fs.rm(path.join(config.uploadDir, img.filename), { force: true }, () => {});
  }
  res.redirect(`/modeller/${req.params.id}`);
});

// ---------- Anketler ----------
app.get('/anketler', auth.requireUser, (req, res) => {
  const list = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM survey_models sm WHERE sm.survey_id = s.id) AS model_count,
      (SELECT COUNT(*) FROM invitations i WHERE i.survey_id = s.id) AS invited,
      (SELECT COUNT(*) FROM invitations i WHERE i.survey_id = s.id AND i.completed_at IS NOT NULL) AS completed
    FROM surveys s WHERE s.user_id = ? ORDER BY s.id DESC`).all(req.user.id);
  send(res, views.surveysPage({ user: req.user, surveys: list }));
});

app.get('/anketler/yeni', auth.requireUser, (req, res) => {
  const pre = req.query.model ? [Number(req.query.model)] : [];
  send(res, views.newSurveyPage({ user: req.user, models: modelList(''), values: { modelIds: pre } }));
});

app.post('/anketler', auth.requireUser, async (req, res) => {
  const rawIds = [].concat(req.body.models || []);
  const values = {
    title: field(req.body.title, 120),
    modelIds: rawIds.map(Number).filter(Boolean),
    emails: field(req.body.emails, 20000),
    days: Number(req.body.days),
    hour: field(req.body.hour, 5),
    result_emails: field(req.body.result_emails, 1000),
  };
  const errs = [];
  const emails = surveys.parseEmails(values.emails);
  const resultEmails = surveys.parseEmails(values.result_emails);
  const existing = values.modelIds.filter((id) => getModel(id));
  if (!values.title) errs.push('Anket adını yazın.');
  if (!existing.length) errs.push('En az bir model seçin.');
  if (!emails.valid.length) errs.push('En az bir geçerli e-posta adresi girin.');
  if (emails.invalid.length) errs.push(`Şu adresler geçersiz: ${emails.invalid.join(', ')}`);
  if (!resultEmails.valid.length || resultEmails.invalid.length) errs.push('Sonucun gönderileceği adresi kontrol edin.');
  if (!Number.isInteger(values.days) || values.days < 0 || values.days > 60) errs.push('Süre 0 ile 60 gün arasında olmalı.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.hour)) errs.push('Bitiş saatini SS:DD biçiminde girin.');
  let closes;
  if (!errs.length) {
    closes = closesAt(values.days, values.hour);
    if (new Date(closes) <= new Date()) errs.push('Bitiş zamanı geçmişte kalıyor; gün sayısını artırın veya daha geç bir saat seçin.');
  }
  if (errs.length) return send(res, views.newSurveyPage({ user: req.user, models: modelList(''), values, errs }), 400);

  const id = surveys.createSurvey({
    userId: req.user.id, title: values.title, modelIds: existing, emails: emails.valid,
    resultEmails: resultEmails.valid, closesAt: closes,
  });
  // Davetler arka planda gönderilir; durum anket sayfasındaki katılımcı tablosunda görünür.
  surveys.sendInvitations(id).catch((err) => console.error(err));
  res.redirect(`/anketler/${id}?m=gonderildi`);
});

const ownSurvey = (req) => db.prepare('SELECT * FROM surveys WHERE id = ? AND user_id = ?').get(Number(req.params.id) || 0, req.user.id);

app.get('/anketler/:id', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey) return res.redirect('/anketler');
  const flashes = {
    gonderildi: 'Anket oluşturuldu, davetler gönderiliyor. Durumu aşağıdaki katılımcı listesinden izleyebilirsiniz.',
    kapatildi: 'Anket kapatıldı, sonuç maili gönderildi.',
    tekrar: 'Gönderilemeyen davetler tekrar denendi.',
    hata: 'Sonuç maili gönderilemedi. Mail ayarlarını kontrol edin; sistem birkaç dakika içinde tekrar deneyecek.',
  };
  send(res, views.surveyDetailPage({
    user: req.user,
    results: computeResults(survey.id),
    invitations: db.prepare('SELECT * FROM invitations WHERE survey_id = ? ORDER BY completed_at IS NULL, email').all(survey.id),
    smtpReady,
    flash: flashes[req.query.m],
  }));
});

app.post('/anketler/:id/kapat', auth.requireUser, async (req, res) => {
  const survey = ownSurvey(req);
  if (!survey) return res.redirect('/anketler');
  try {
    await surveys.closeAndReport(survey.id);
    res.redirect(`/anketler/${survey.id}?m=kapatildi`);
  } catch (err) {
    console.error(err);
    res.redirect(`/anketler/${survey.id}?m=hata`);
  }
});

app.post('/anketler/:id/yeniden-gonder', auth.requireUser, async (req, res) => {
  const survey = ownSurvey(req);
  if (!survey) return res.redirect('/anketler');
  await surveys.sendInvitations(survey.id);
  res.redirect(`/anketler/${survey.id}?m=tekrar`);
});

app.get('/anketler/:id/sonuclar.csv', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey) return res.redirect('/anketler');
  res.type('text/csv; charset=utf-8')
    .attachment(`anket-${survey.id}-sonuclar.csv`)
    .send(resultsCsv(computeResults(survey.id)));
});

// ---------- Katılımcı (giriş gerekmez, kişiye özel link) ----------
function loadInvitation(token) {
  const invitation = db.prepare('SELECT * FROM invitations WHERE token = ?').get(String(token));
  if (!invitation) return {};
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(invitation.survey_id);
  const isOpen = !survey.closed_at && new Date(survey.closes_at) > new Date();
  return { invitation, survey, isOpen };
}

app.get('/a/:token', (req, res) => {
  const { invitation, survey, isOpen } = loadInvitation(req.params.token);
  if (!invitation) return send(res, views.messagePage({ title: 'Link geçersiz', text: 'Bu anket linki bulunamadı. Maildeki linki eksiksiz açtığınızdan emin olun.' }), 404);
  if (invitation.completed_at) return send(res, views.messagePage({ title: 'Teşekkürler', text: 'Bu anketi tamamladınız. Görüşleriniz kaydedildi.' }));
  if (!isOpen) return send(res, views.messagePage({ title: 'Anket kapandı', text: `Bu anket ${formatTR(survey.closed_at || survey.closes_at)} tarihinde kapandı.` }));
  const models = surveys.surveyModels(survey.id).map((m) => ({ ...m, images: modelImages(m.id).map((i) => i.filename) }));
  send(res, views.participantPage({ survey, invitation, models }));
});

app.post('/a/:token', (req, res) => {
  const { invitation, survey, isOpen } = loadInvitation(req.params.token);
  if (!invitation) return res.redirect(`/a/${encodeURIComponent(req.params.token)}`);
  if (invitation.completed_at || !isOpen) return res.redirect(`/a/${encodeURIComponent(req.params.token)}`);
  const models = surveys.surveyModels(survey.id);
  const answers = [];
  for (const m of models) {
    const r = String(req.body[`r_${m.id}`] || '');
    const comment = field(req.body[`c_${m.id}`], 1000);
    if (r === 'nms') answers.push({ modelId: m.id, score: null, notMyStyle: true, comment });
    else if (/^[1-5]$/.test(r)) answers.push({ modelId: m.id, score: Number(r), notMyStyle: false, comment });
    else return send(res, views.messagePage({ title: 'Eksik yanıt', text: `${m.code} için bir puan ya da “Tarzım değil” seçin. Geri dönüp tamamlayabilirsiniz.` }), 400);
  }
  surveys.submitResponses(invitation.id, answers);
  send(res, views.messagePage({ title: 'Teşekkürler', text: `Görüşleriniz kaydedildi. Anket ${formatTR(survey.closes_at)} tarihinde kapanacak.` }));
});

// ---------- Giden kutusu (SMTP yokken) ----------
app.get('/giden-kutusu', auth.requireUser, (req, res) => {
  send(res, views.outboxPage({ user: req.user, mails: db.prepare('SELECT id, to_addr, subject, created_at FROM outbox ORDER BY id DESC LIMIT 200').all() }));
});
app.get('/giden-kutusu/:id', auth.requireUser, (req, res) => {
  const mail = db.prepare('SELECT * FROM outbox WHERE id = ?').get(Number(req.params.id) || 0);
  if (!mail) return res.redirect('/giden-kutusu');
  res.type('html').send(mail.html);
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const text = err.code === 'LIMIT_FILE_SIZE' ? 'Bir görsel 20 MB sınırını aşıyor.' : 'Görseller yüklenemedi.';
    return send(res, views.messagePage({ title: 'Yükleme hatası', text }), 400);
  }
  console.error(err);
  send(res, views.messagePage({ title: 'Bir sorun oluştu', text: 'İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin.' }), 500);
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Model Beğeni Anketi çalışıyor: ${config.baseUrl}`);
    if (!smtpReady) console.log('SMTP ayarlı değil: mailler /giden-kutusu sayfasına yazılacak.');
    surveys.startScheduler();
  });
}

module.exports = app;
