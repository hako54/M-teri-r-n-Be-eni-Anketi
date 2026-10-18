const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { db, tx, modelCode, modelImages, isAbTest, TEST_KONULARI } = require('./db');
const auth = require('./auth');
const views = require('./views');
const { closesAt, formatTR } = require('./time');
const { computeResults, resultsCsv, firstImage } = require('./results');
const { smtpReady } = require('./mail');
const surveys = require('./surveys');
const kirilim = require('./kirilim');
const outlook = require('./outlook');

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
// q: numara, kumaş, içerik veya kırılım içinde arar; marka: ilk kırılım seviyesine göre süzer.
const modelList = (q = '', marka = '') => {
  const like = `%${q}%`;
  return db.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM model_images i WHERE i.model_id = m.id) AS image_count
    FROM models m
    WHERE (? = '' OR m.ana_kumas LIKE ? OR m.icerik LIKE ? OR m.kirilim LIKE ? OR printf('MDL-%04d', m.id) LIKE ?)
      AND (? = '' OR json_extract(m.kirilim, '$[0]') = ?)
    ORDER BY m.id DESC`).all(q, like, like, like, like, marka, marka)
    .map((m) => ({ ...m, image: firstImage(m.id), kirilim: kirilim.parse(m.kirilim) }));
};

const usedMarkas = () => db.prepare(`SELECT DISTINCT json_extract(kirilim, '$[0]') AS v FROM models
  WHERE json_extract(kirilim, '$[0]') IS NOT NULL`).all().map((r) => r.v).sort(new Intl.Collator('tr').compare);

const nextModelCode = () => {
  const row = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'models'").get();
  return modelCode((row ? row.seq : 0) + 1);
};

function removeFiles(files = []) {
  for (const f of files) fs.rm(f.path, { force: true }, () => {});
}

app.get('/modeller', auth.requireUser, (req, res) => {
  const q = field(req.query.q, 60);
  const marka = field(req.query.marka, 120);
  send(res, views.modelsPage({ user: req.user, models: modelList(q, marka), q, marka, markas: usedMarkas() }));
});

app.get('/modeller/yeni', auth.requireUser, (req, res) => send(res, views.modelFormPage({ user: req.user, nextCode: nextModelCode() })));

// A/B ayarı: görseller aynı modelin alternatifleriyse (renk, desen, doku…) ayrı ayrı oylanır.
function abFields(body) {
  const ab = body.ab_test === '1';
  const konu = field(body.test_konusu, 60);
  return { ab_test: ab ? 1 : 0, test_konusu: ab && TEST_KONULARI.includes(konu) ? konu : null };
}

// Kırılım seçimleri k0, k1, … alanlarından gelir; listede olmayan bir yol reddedilir.
function kirilimField(body) {
  const path = kirilim.normalize(kirilim.levels.map((_, i) => body[`k${i}`]));
  return path === null ? null : JSON.stringify(path);
}

// Kırılım seçeneklerini sırayla getirir; model formundaki açılır listeler bunu kullanır.
app.get('/kirilim', auth.requireUser, (req, res) => {
  const prefix = [].concat(req.query.p || []).map(String);
  res.json({ options: kirilim.options(prefix) });
});

app.post('/modeller', auth.requireUser, upload.array('images'), (req, res) => {
  const values = { ana_kumas: field(req.body.ana_kumas, 120), icerik: field(req.body.icerik, 200), ...abFields(req.body), kirilim: kirilimField(req.body) };
  const labels = [].concat(req.body.labels || []);
  const errs = [];
  if (!req.files || !req.files.length) errs.push('En az bir görsel ekleyin (JPG, PNG, WEBP, HEIC).');
  if (!values.ana_kumas) errs.push('Ana kumaşı yazın.');
  if (!values.icerik) errs.push('İçeriği yazın.');
  if (values.ab_test && (!req.files || req.files.length < 2)) errs.push('A/B testi için en az iki görsel ekleyin; her görsel bir seçenek olur.');
  if (values.ab_test && !values.test_konusu) errs.push('A/B testinde neyin karşılaştırıldığını seçin.');
  if (values.kirilim === null) errs.push('Kırılım seçimi listede bulunamadı; seçimleri yeniden yapın.');
  if (errs.length) {
    removeFiles(req.files);
    return send(res, views.modelFormPage({ user: req.user, nextCode: nextModelCode(), values: { ...values, kirilim: null }, errs }), 400);
  }
  const id = tx(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO models (user_id, ana_kumas, icerik, ab_test, test_konusu, kirilim) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, values.ana_kumas, values.icerik, values.ab_test, values.test_konusu, values.kirilim);
    const addImg = db.prepare('INSERT INTO model_images (model_id, filename, label, sort_order) VALUES (?, ?, ?, ?)');
    req.files.forEach((f, i) => addImg.run(lastInsertRowid, f.filename, field(labels[i], 80) || null, i));
    return lastInsertRowid;
  });
  res.redirect(`/modeller/${id}`);
});

const getModel = (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(Number(id) || 0);

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
  const ab = abFields(req.body);
  const kir = kirilimField(req.body);
  const images = modelImages(model.id);
  const errs = [];
  if (kir === null) errs.push('Kırılım seçimi listede bulunamadı; seçimleri yeniden yapın.');
  if (!ana || !icerik) errs.push('Ana kumaş ve içerik boş bırakılamaz.');
  if (ab.ab_test && images.length + (req.files || []).length < 2) errs.push('A/B testi için en az iki görsel gerekli.');
  if (ab.ab_test && !ab.test_konusu) errs.push('A/B testinde neyin karşılaştırıldığını seçin.');
  if (errs.length) {
    removeFiles(req.files);
    return send(res, views.modelFormPage({ user: req.user, model: { ...model, ...ab }, images, errs }), 400);
  }
  const labels = [].concat(req.body.labels || []);
  tx(() => {
    db.prepare('UPDATE models SET ana_kumas = ?, icerik = ?, ab_test = ?, test_konusu = ?, kirilim = ? WHERE id = ?')
      .run(ana, icerik, ab.ab_test, ab.test_konusu, kir, model.id);
    const setLabel = db.prepare('UPDATE model_images SET label = ? WHERE id = ?');
    for (const im of images) {
      if (`label_${im.id}` in req.body) setLabel.run(field(req.body[`label_${im.id}`], 80) || null, im.id);
    }
    const start = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM model_images WHERE model_id = ?').get(model.id).n;
    const addImg = db.prepare('INSERT INTO model_images (model_id, filename, label, sort_order) VALUES (?, ?, ?, ?)');
    (req.files || []).forEach((f, i) => addImg.run(model.id, f.filename, field(labels[i], 80) || null, start + i));
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
      (SELECT COUNT(*) FROM invitations i WHERE i.survey_id = s.id AND i.invited = 1) AS invited,
      (SELECT COUNT(*) FROM invitations i WHERE i.survey_id = s.id AND i.completed_at IS NOT NULL) AS completed
    FROM surveys s WHERE s.user_id = ? ORDER BY s.id DESC`).all(req.user.id);
  send(res, views.surveysPage({ user: req.user, surveys: list }));
});

app.get('/anketler/yeni', auth.requireUser, (req, res) => {
  const pre = req.query.model ? [Number(req.query.model)] : [];
  send(res, views.newSurveyPage({ user: req.user, models: modelList(), values: { modelIds: pre } }));
});

app.post('/anketler', auth.requireUser, (req, res) => {
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
  if (!errs.length && new Date(closesAt(values.days, values.hour)) <= new Date()) {
    errs.push('Bitiş zamanı geçmişte kalıyor; gün sayısını artırın veya daha geç bir saat seçin.');
  }
  if (errs.length) return send(res, views.newSurveyPage({ user: req.user, models: modelList(), values, errs }), 400);

  const id = surveys.createSurvey({
    userId: req.user.id, title: values.title, modelIds: existing, emails: emails.valid,
    resultEmails: resultEmails.valid, days: values.days, hour: values.hour,
  });
  // "Oluştur ve gönder": hemen canlıya alır ve Outlook'u açar; "Taslak olarak kaydet": sonra gönderilir.
  if (req.body.action === 'gonder') {
    const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(id);
    return res.redirect(`/anketler/${id}?m=${surveys.publishSurvey(survey) ? 'yayinda' : 'gecmis'}`);
  }
  res.redirect(`/anketler/${id}?m=taslak`);
});

const ownSurvey = (req) => db.prepare('SELECT * FROM surveys WHERE id = ? AND user_id = ?').get(Number(req.params.id) || 0, req.user.id);
const invitedEmails = (surveyId) => db.prepare('SELECT email FROM invitations WHERE survey_id = ? AND invited = 1 ORDER BY id').all(surveyId).map((r) => r.email);

app.get('/anketler/:id', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey) return res.redirect('/anketler');
  const flashes = {
    taslak: 'Anket taslak olarak kaydedildi. Hazır olduğunuzda “Gönder” ile canlıya alın.',
    yayinda: 'Anket canlıda. Outlook açıldıysa maili kontrol edip gönderin; açılmadıysa “Outlook’ta aç” düğmesini kullanın.',
    gecmis: 'Bitiş zamanı geçmişte kalıyor. Anketi yeniden oluşturun ya da daha uzun süre seçin.',
    kapatildi: 'Anket kapatıldı, sonuç hazır.',
    hata: 'Sonuç maili gönderilemedi. Sistem birkaç dakika içinde tekrar deneyecek.',
  };
  const results = computeResults(survey.id);
  const owner = { name: req.user.username, email: req.user.email };
  send(res, views.surveyDetailPage({
    user: req.user,
    isAdmin: Boolean(req.user.is_admin),
    draftExpiresAt: surveys.draftExpiresAt(survey),
    results,
    invitations: db.prepare('SELECT * FROM invitations WHERE survey_id = ? ORDER BY completed_at IS NULL, invited DESC, email').all(survey.id),
    smtpReady,
    flash: flashes[req.query.m],
    autoOpenOutlook: req.query.m === 'yayinda',
    links: {
      test: `${config.baseUrl}/t/${survey.test_token}`,
      public: `${config.baseUrl}/k/${survey.public_token}`,
      result: `${config.baseUrl}/sonuc/${survey.result_token}`,
    },
    invite: survey.published_at ? outlook.inviteMailto({
      survey, modelCount: results.models.length, ownerName: owner.name, ownerEmail: owner.email, emails: invitedEmails(survey.id),
    }) : null,
    invitedEmails: invitedEmails(survey.id),
    resultMailto: outlook.resultMailto({ results, to: survey.result_emails.split(',').filter(Boolean) }),
    testMailto: req.user.is_admin ? outlook.testMailto({ survey, link: `${config.baseUrl}/t/${survey.test_token}`, to: config.adminEmails }) : null,
  }));
});

app.post('/anketler/:id/yayinla', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey) return res.redirect('/anketler');
  if (survey.published_at) return res.redirect(`/anketler/${survey.id}`);
  const closes = surveys.publishSurvey(survey);
  res.redirect(`/anketler/${survey.id}?m=${closes ? 'yayinda' : 'gecmis'}`);
});

app.post('/anketler/:id/kapat', auth.requireUser, async (req, res) => {
  const survey = ownSurvey(req);
  if (!survey || !survey.published_at) return res.redirect('/anketler');
  try {
    await surveys.closeAndReport(survey.id);
    res.redirect(`/anketler/${survey.id}?m=kapatildi`);
  } catch (err) {
    console.error(err);
    res.redirect(`/anketler/${survey.id}?m=hata`);
  }
});

app.get('/anketler/:id/sonuclar.csv', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey) return res.redirect('/anketler');
  res.type('text/csv; charset=utf-8')
    .attachment(`anket-${survey.id}-sonuclar.csv`)
    .send(resultsCsv(computeResults(survey.id)));
});

// ---------- Katılımcı (giriş gerekmez) ----------
const isOpen = (survey) => Boolean(survey.published_at) && !survey.closed_at && new Date(survey.closes_at) > new Date();
const closedText = (survey) => `Bu anket ${formatTR(survey.closed_at || survey.closes_at)} tarihinde kapandı.`;

function participantModels(surveyId) {
  return surveys.surveyModels(surveyId).map((m) => {
    const images = modelImages(m.id);
    return { ...m, images, ab: isAbTest(m, images) };
  });
}

// Formdaki yanıtları okur; eksik varsa ilgili model numarasını döner.
function parseAnswers(surveyId, body) {
  const parseRating = (value) => {
    const r = String(value || '');
    if (r === 'nms') return { score: null, notMyStyle: true };
    if (/^[1-5]$/.test(r)) return { score: Number(r), notMyStyle: false };
    return null;
  };
  const answers = [];
  for (const m of surveys.surveyModels(surveyId)) {
    const images = modelImages(m.id);
    const answer = { modelId: m.id, ratings: [], comment: field(body[`c_${m.id}`], 1000) };
    if (isAbTest(m, images)) {
      for (const im of images) {
        const rating = parseRating(body[`r_${m.id}_${im.id}`]);
        if (!rating) return { missing: m.code };
        answer.ratings.push({ imageId: im.id, ...rating });
      }
      const pick = Number(body[`p_${m.id}`]);
      if (body[`p_${m.id}`] === undefined || !(pick === 0 || images.some((im) => im.id === pick))) return { missing: m.code };
      answer.pick = pick;
    } else {
      const rating = parseRating(body[`r_${m.id}`]);
      if (!rating) return { missing: m.code };
      answer.ratings.push({ imageId: 0, ...rating });
    }
    answers.push(answer);
  }
  return { answers };
}

const missingPage = (res, code) => send(res, views.messagePage({ title: 'Eksik yanıt', text: `${code} için bütün seçenekleri değerlendirin. Geri dönüp tamamlayabilirsiniz.` }), 400);

// Ortak link (Outlook mailindeki): katılımcı e-postasını yazar, kendine ait ankete yönlenir.
const surveyByPublic = (token) => db.prepare('SELECT * FROM surveys WHERE public_token = ?').get(String(token));

app.get('/k/:token', (req, res) => {
  const survey = surveyByPublic(req.params.token);
  if (!survey) return send(res, views.messagePage({ title: 'Link geçersiz', text: 'Bu anket linki bulunamadı. Maildeki linki eksiksiz açtığınızdan emin olun.' }), 404);
  if (!survey.published_at) return send(res, views.messagePage({ title: 'Anket henüz başlamadı', text: 'Bu anket henüz canlıya alınmadı.' }));
  if (!isOpen(survey)) return send(res, views.messagePage({ title: 'Anket kapandı', text: closedText(survey) }));
  send(res, views.joinPage({ survey, modelCount: surveys.surveyModels(survey.id).length }));
});

app.post('/k/:token', (req, res) => {
  const survey = surveyByPublic(req.params.token);
  if (!survey || !isOpen(survey)) return res.redirect(`/k/${encodeURIComponent(req.params.token)}`);
  const email = field(req.body.email, 120).toLowerCase();
  if (!surveys.parseEmails(email).valid.length) {
    return send(res, views.joinPage({ survey, modelCount: surveys.surveyModels(survey.id).length, email, errs: ['Geçerli bir e-posta adresi yazın.'] }), 400);
  }
  const invitation = surveys.joinSurvey(survey.id, email);
  res.redirect(`/a/${invitation.token}`);
});

function loadInvitation(token) {
  const invitation = db.prepare('SELECT * FROM invitations WHERE token = ?').get(String(token));
  if (!invitation) return {};
  return { invitation, survey: db.prepare('SELECT * FROM surveys WHERE id = ?').get(invitation.survey_id) };
}

app.get('/a/:token', (req, res) => {
  const { invitation, survey } = loadInvitation(req.params.token);
  if (!invitation) return send(res, views.messagePage({ title: 'Link geçersiz', text: 'Bu anket linki bulunamadı.' }), 404);
  if (invitation.completed_at) return send(res, views.messagePage({ title: 'Teşekkürler', text: 'Bu anketi tamamladınız. Görüşleriniz kaydedildi.' }));
  if (!isOpen(survey)) return send(res, views.messagePage({ title: 'Anket kapandı', text: closedText(survey) }));
  send(res, views.participantPage({ survey, models: participantModels(survey.id), email: invitation.email }));
});

app.post('/a/:token', (req, res) => {
  const { invitation, survey } = loadInvitation(req.params.token);
  if (!invitation || invitation.completed_at || !isOpen(survey)) return res.redirect(`/a/${encodeURIComponent(req.params.token)}`);
  const { answers, missing } = parseAnswers(survey.id, req.body);
  if (missing) return missingPage(res, missing);
  surveys.submitResponses(invitation.id, answers);
  send(res, views.messagePage({ title: 'Teşekkürler', text: `Görüşleriniz kaydedildi. Anket ${formatTR(survey.closes_at)} tarihinde kapanacak.` }));
});

// Test linki: yalnızca admin; anketi canlıya almadan önce ve sonra denemek için. Yanıtlar kaydedilmez.
const surveyByTest = (token) => db.prepare('SELECT * FROM surveys WHERE test_token = ?').get(String(token));

app.get('/t/:token', auth.requireAdmin, (req, res) => {
  const survey = surveyByTest(req.params.token);
  if (!survey) return send(res, views.messagePage({ title: 'Link geçersiz', text: 'Bu test linki bulunamadı.' }), 404);
  send(res, views.participantPage({ survey, models: participantModels(survey.id), test: true }));
});

app.post('/t/:token', auth.requireAdmin, (req, res) => {
  const survey = surveyByTest(req.params.token);
  if (!survey) return res.redirect(`/t/${encodeURIComponent(req.params.token)}`);
  const { missing } = parseAnswers(survey.id, req.body);
  if (missing) return missingPage(res, missing);
  send(res, views.messagePage({
    title: 'Test tamamlandı',
    text: 'Anket sorunsuz çalışıyor. Bu test yanıtları kaydedilmedi ve sonuçlara katılmaz.',
    link: { href: `/t/${survey.test_token}`, label: 'Testi tekrarla' },
  }));
});

// Sonuç sayfası: giriş gerektirmez, anket kapandıktan sonra açılır. Outlook ile paylaşılan sonuç mailindeki link.
app.get('/sonuc/:token', (req, res) => {
  const survey = db.prepare('SELECT * FROM surveys WHERE result_token = ?').get(String(req.params.token));
  if (!survey) return send(res, views.messagePage({ title: 'Link geçersiz', text: 'Bu sonuç linki bulunamadı.' }), 404);
  if (isOpen(survey) || !survey.published_at) {
    return send(res, views.messagePage({ title: 'Sonuç henüz hazır değil', text: `Anket ${formatTR(survey.closes_at)} tarihinde kapanınca sonuçlar burada görünecek.` }));
  }
  send(res, views.publicResultPage({ results: computeResults(survey.id) }));
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
